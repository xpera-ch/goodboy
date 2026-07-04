import { Command } from 'commander';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { createRegistryAdapter } from '../lib/registry-adapter.js';
import { validateSkillDirectory, formatValidationResult } from '../lib/skill-validator.js';
import {
  getRegistryPath,
  resolveSkill,
} from '../lib/registry.js';
import {
  readRegistryEntry,
  writeRegistryEntry,
  resolveLatestVersion,
} from '../lib/registry-entry.js';
import { SKILL_NAME_RE } from '../lib/validation.js';
import { logger } from '../lib/logger.js';

export const registryCommand = new Command('registry')
  .description('Manage the local skill registry');

registryCommand
  .command('list')
  .description('List all registered skills')
  .action(async () => {
    const adapter = createRegistryAdapter();
    const entries = await adapter.listRegistry();

    if (entries.length === 0) {
      logger.info('Registry is empty. Use `goodboy add <skill-path>` to add skills.');
      return;
    }

    for (const entry of entries) {
      const latest = resolveLatestVersion(entry) ?? '(none)';
      const versionCount = Object.keys(entry.versions).length;
      logger.info(`${entry.name}  latest: ${latest}  (${versionCount} version${versionCount === 1 ? '' : 's'})`);
    }
  });

registryCommand
  .command('info <skill>')
  .description('Show details about a registered skill')
  .action(async (skillName: string) => {
    if (!SKILL_NAME_RE.test(skillName)) {
      logger.error(`Invalid skill name "${skillName}": must match ^[a-z0-9-]+$`);
      process.exit(1);
    }

    const registryPath = getRegistryPath();
    const skillDir = join(registryPath, skillName);
    const entry = await readRegistryEntry(skillDir);

    if (!entry) {
      logger.error(`Skill "${skillName}" not found in registry`);
      process.exit(1);
    }

    logger.info(`Name:    ${entry.name}`);
    logger.info(`Latest:  ${entry.latest}`);
    logger.info('Versions:');
    for (const [ver, info] of Object.entries(entry.versions)) {
      const yankedLabel = info.yanked ? ' [yanked]' : '';
      logger.info(`  ${ver}${yankedLabel}  added: ${info.addedAt}`);
    }
  });

registryCommand
  .command('validate <skill>')
  .description('Validate a registered skill\'s structure')
  .action(async (skillName: string) => {
    if (!SKILL_NAME_RE.test(skillName)) {
      logger.error(`Invalid skill name "${skillName}": must match ^[a-z0-9-]+$`);
      process.exit(1);
    }

    let skillPath: string;
    try {
      skillPath = await resolveSkill(skillName);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : `Skill "${skillName}" not found`);
      process.exit(1);
    }

    const result = await validateSkillDirectory(skillPath);
    formatValidationResult(result, skillName);

    if (result.valid) {
      logger.success(`Skill "${skillName}" is valid`);
    } else {
      process.exit(1);
    }
  });

registryCommand
  .command('remove <skill>')
  .description('Remove a skill (or specific version) from the registry')
  .option('--version <version>', 'Remove only this version (default: remove all versions)')
  .action(async (skillName: string, options: { version?: string }) => {
    if (!SKILL_NAME_RE.test(skillName)) {
      logger.error(`Invalid skill name "${skillName}": must match ^[a-z0-9-]+$`);
      process.exit(1);
    }

    const registryPath = getRegistryPath();
    const skillDir = join(registryPath, skillName);
    const entry = await readRegistryEntry(skillDir);

    if (!entry) {
      logger.error(`Skill "${skillName}" not found in registry`);
      process.exit(1);
    }

    if (options.version) {
      const ver = options.version;
      if (!entry.versions[ver]) {
        logger.error(`Version "${ver}" of skill "${skillName}" not found in registry`);
        process.exit(1);
      }

      const versionPath = join(skillDir, entry.versions[ver]!.path);
      if (existsSync(versionPath)) {
        rmSync(versionPath, { recursive: true, force: true });
      }

      const { [ver]: _removed, ...remainingVersions } = entry.versions;
      const remainingKeys = Object.keys(remainingVersions);

      if (remainingKeys.length === 0) {
        rmSync(skillDir, { recursive: true, force: true });
        logger.success(`Skill "${skillName}" removed from registry (last version deleted)`);
      } else {
        const newLatest = resolveLatestVersion({ ...entry, versions: remainingVersions }) ?? remainingKeys[0]!;
        await writeRegistryEntry(skillDir, {
          ...entry,
          latest: newLatest,
          versions: remainingVersions,
        });
        logger.success(`Version "${ver}" of skill "${skillName}" removed`);
      }
    } else {
      rmSync(skillDir, { recursive: true, force: true });
      logger.success(`Skill "${skillName}" removed from registry`);
    }
  });
