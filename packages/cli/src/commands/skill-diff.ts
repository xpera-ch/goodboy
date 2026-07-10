import { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import { getRegistryPath } from '../lib/registry.js';
import { readRegistryEntry, resolveLatestVersion, resolveVersionPath } from '../lib/registry-entry.js';
import { SKILL_NAME_RE } from '../lib/validation.js';
import { logger, sanitiseError } from '../lib/logger.js';

interface SkillDiffOptions {
  global?: boolean;
}

function assertWithin(target: string, base: string, label: string): void {
  const resolvedTarget = resolve(target);
  const resolvedBase = resolve(base);
  if (!resolvedTarget.startsWith(resolvedBase + sep)) {
    throw new Error(`Refused: ${label} escapes the expected directory`);
  }
}

/**
 * Naive LCS-based line diff. oldLabel/newLabel are accepted for signature
 * symmetry with the caller's own header lines but aren't embedded in the
 * returned lines — the caller prints "---"/"+++ " headers separately.
 */
export function computeDiff(
  oldContent: string,
  newContent: string,
  _oldLabel: string,
  _newLabel: string,
): string[] {
  if (oldContent === newContent) return [];

  const oldLines = oldContent.length > 0 ? oldContent.split('\n') : [];
  const newLines = newContent.length > 0 ? newContent.split('\n') : [];
  const m = oldLines.length;
  const n = newLines.length;

  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i]![j] =
        oldLines[i] === newLines[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const result: string[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      result.push(`  ${oldLines[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      result.push(chalk.red(`- ${oldLines[i]}`));
      i++;
    } else {
      result.push(chalk.green(`+ ${newLines[j]}`));
      j++;
    }
  }
  while (i < m) {
    result.push(chalk.red(`- ${oldLines[i]}`));
    i++;
  }
  while (j < n) {
    result.push(chalk.green(`+ ${newLines[j]}`));
    j++;
  }

  return result;
}

export function registerSkillDiff(program: Command): void {
  program
    .command('diff <skill-name>')
    .description('Show diff between installed skill and registry latest')
    .option('-g, --global', 'Diff against globally installed skill')
    .action(async (skillName: string, options: SkillDiffOptions) => {
      try {
        if (!SKILL_NAME_RE.test(skillName)) {
          throw new Error(`Invalid skill name "${skillName}": must match ^[a-z0-9-]+$`);
        }

        const installedBase = options.global
          ? join(homedir(), '.goodboy', 'skills')
          : join(process.cwd(), '.claude', 'skills');
        const installedPath = join(installedBase, skillName, 'SKILL.md');
        assertWithin(installedPath, installedBase, 'installed skill path');

        const registryBase = getRegistryPath();
        const skillDir = join(registryBase, skillName);
        assertWithin(skillDir, registryBase, 'skill path');

        const entry = await readRegistryEntry(skillDir);
        if (!entry) {
          throw new Error(`Skill "${skillName}" not found in registry`);
        }
        const latest = resolveLatestVersion(entry);
        if (!latest) {
          throw new Error(`Skill "${skillName}" has no available versions`);
        }
        const versionDir = resolveVersionPath(entry, latest, skillDir);
        const registrySkillMdPath = join(versionDir, 'SKILL.md');
        assertWithin(registrySkillMdPath, versionDir, 'registry SKILL.md path');

        if (!existsSync(installedPath)) {
          logger.warn(`${skillName} is not installed in this scope.`);
          logger.info(`Run 'goodboy install ${skillName}' to install it.`);
          return;
        }

        const installedContent = readFileSync(installedPath, 'utf-8');
        const registryContent = readFileSync(registrySkillMdPath, 'utf-8');

        if (installedContent === registryContent) {
          logger.success(`${skillName} — installed copy matches registry@${latest}`);
          return;
        }

        logger.warn(`${skillName} — installed copy differs from registry@${latest}`);
        logger.info(`--- installed (.claude/skills/${skillName}/SKILL.md)`);
        logger.info(`+++ registry  (${registrySkillMdPath})`);
        logger.info('');

        const diffLines = computeDiff(installedContent, registryContent, installedPath, registrySkillMdPath);
        for (const line of diffLines) {
          logger.info(line);
        }

        logger.warn("Changes in .claude/skills/ will be lost on 'goodboy upgrade'.");
        logger.info('To preserve changes: copy them to the registry version first,');
        logger.info(
          `then run 'goodboy skill version ${skillName} --bump patch' to create a new version.`,
        );
      } catch (err) {
        logger.error(sanitiseError(err));
        process.exit(1);
      }
    });
}
