import { Command } from 'commander';
import { existsSync, mkdirSync, cpSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import ora from 'ora';
import { SKILL_NAME_RE, isRemoteRefArgument } from '../lib/validation.js';
import { validateSkillDirectory, formatValidationResult } from '../lib/skill-validator.js';
import { readManifest, validateManifest } from '../lib/manifest.js';
import { scanForSymlinks } from '../lib/fs-security.js';
import { getRegistryPath, ensureRegistryExists } from '../lib/registry.js';
import {
  readRegistryEntry,
  writeRegistryEntry,
  createRegistryEntry,
  addVersionToEntry,
} from '../lib/registry-entry.js';
import { logger } from '../lib/logger.js';

/**
 * Marks a failure branch that has already logged its own specific message
 * (and, for validation failures, already printed the full issue list).
 * The catch block below checks for this to avoid re-logging a second,
 * misleading message before exiting.
 */
class HandledFailure extends Error {}

export const addCommand = new Command('add')
  .description('Add a skill to the local registry')
  .argument('<skill-path>', 'Local path to the skill directory')
  .option('-f, --force', 'Overwrite an existing version')
  .action(async (skillPathArg: string, options: { force?: boolean }) => {
    const spinner = ora('Adding skill...').start();

    try {
      if (isRemoteRefArgument(skillPathArg)) {
        spinner.fail();
        logger.error(
          `"${skillPathArg}" looks like a URL, not a local path. ` +
            `'goodboy add' only accepts a local skill directory — clone or download the skill first, ` +
            `then run 'goodboy add <local-dir>', or 'goodboy adopt <local-dir>' if it has no manifest.json yet.`,
        );
        throw new HandledFailure();
      }

      const skillPath = resolve(skillPathArg);

      if (!existsSync(skillPath)) {
        spinner.fail();
        logger.error(`Skill path not found: "${skillPathArg}"`);
        throw new HandledFailure();
      }

      const dirName = basename(skillPath);

      if (!SKILL_NAME_RE.test(dirName)) {
        spinner.fail();
        logger.error(
          `Invalid skill directory name "${dirName}": must match ^[a-z0-9-]+$`,
        );
        throw new HandledFailure();
      }

      spinner.text = 'Validating skill directory...';
      const result = await validateSkillDirectory(skillPath);

      if (!result.valid) {
        spinner.fail('Skill validation failed');
        formatValidationResult(result, dirName);
        throw new HandledFailure();
      }

      if (result.issues.some((i) => i.severity === 'warning')) {
        spinner.stop();
        formatValidationResult(result, dirName);
        spinner.start('Continuing...');
      }

      spinner.text = 'Reading manifest...';
      const rawManifest = await readManifest(join(skillPath, 'manifest.json'));
      const manifest = validateManifest(rawManifest);

      if (manifest.name !== dirName) {
        spinner.fail();
        logger.error(
          `Manifest name "${manifest.name}" does not match directory name "${dirName}"`,
        );
        throw new HandledFailure();
      }

      const version = manifest.version;

      spinner.text = 'Scanning for symlinks...';
      await scanForSymlinks(skillPath);

      ensureRegistryExists();
      const registryPath = getRegistryPath();
      const skillRegistryDir = join(registryPath, manifest.name);
      const versionRelPath = join('versions', version);
      const versionAbsPath = join(skillRegistryDir, versionRelPath);

      const existingEntry = await readRegistryEntry(skillRegistryDir);

      if (existingEntry?.versions[version] !== undefined) {
        if (!options.force) {
          spinner.fail();
          logger.error(
            `Version "${version}" of skill "${manifest.name}" already exists. Use --force to overwrite.`,
          );
          throw new HandledFailure();
        }
        logger.warn(
          `Overwriting existing version "${version}" of skill "${manifest.name}".`,
        );
      }

      spinner.text = 'Copying skill files...';
      mkdirSync(versionAbsPath, { recursive: true, mode: 0o700 });
      cpSync(skillPath, versionAbsPath, { recursive: true });

      if (!existsSync(skillRegistryDir)) {
        mkdirSync(skillRegistryDir, { recursive: true, mode: 0o700 });
      }

      const entry = existingEntry
        ? addVersionToEntry(existingEntry, version, versionRelPath)
        : createRegistryEntry(manifest.name, version, versionRelPath);

      await writeRegistryEntry(skillRegistryDir, entry);

      spinner.succeed(`Skill "${manifest.name}@${version}" added to registry`);
    } catch (err) {
      if (!(err instanceof HandledFailure)) {
        spinner.fail();
        if (err instanceof Error && err.message.toLowerCase().includes('symlink')) {
          logger.error('Skill rejected: symlink pointing outside skill directory detected');
        } else {
          logger.error(err instanceof Error ? err.message : 'Unknown error');
        }
      }
      process.exit(1);
    }
  });
