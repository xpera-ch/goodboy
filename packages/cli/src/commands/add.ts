import { Command } from 'commander';
import { existsSync, mkdirSync, cpSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import ora from 'ora';
import { SKILL_NAME_RE } from '../lib/validation.js';
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

export const addCommand = new Command('add')
  .description('Add a skill to the local registry')
  .argument('<skill-path>', 'Path to the skill directory')
  .option('-f, --force', 'Overwrite an existing version')
  .action(async (skillPathArg: string, options: { force?: boolean }) => {
    const spinner = ora('Adding skill...').start();

    try {
      const skillPath = resolve(skillPathArg);

      if (!existsSync(skillPath)) {
        spinner.fail();
        logger.error(`Skill path not found: "${skillPathArg}"`);
        process.exit(1);
      }

      const dirName = basename(skillPath);

      if (!SKILL_NAME_RE.test(dirName)) {
        spinner.fail();
        logger.error(
          `Invalid skill directory name "${dirName}": must match ^[a-z0-9-]+$`,
        );
        process.exit(1);
      }

      spinner.text = 'Validating skill directory...';
      const result = await validateSkillDirectory(skillPath);

      if (!result.valid) {
        spinner.fail('Skill validation failed');
        formatValidationResult(result, dirName);
        process.exit(1);
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
        process.exit(1);
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
          process.exit(1);
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
      spinner.fail();
      if (err instanceof Error && err.message.toLowerCase().includes('symlink')) {
        logger.error('Skill rejected: symlink pointing outside skill directory detected');
      } else {
        logger.error(err instanceof Error ? err.message : 'Unknown error');
      }
      process.exit(1);
    }
  });
