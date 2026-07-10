import { Command } from 'commander';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve, sep, basename } from 'node:path';
import { getRegistryPath } from '../lib/registry.js';
import { readRegistryEntry, resolveLatestVersion, resolveVersionPath } from '../lib/registry-entry.js';
import { SKILL_NAME_RE } from '../lib/validation.js';
import { logger, sanitiseError } from '../lib/logger.js';

const EDITOR_CANDIDATES = ['code', 'cursor', 'nano', 'vim', 'vi'];

interface SkillOpenOptions {
  version?: string;
}

function assertWithin(target: string, base: string, label: string): void {
  const resolvedTarget = resolve(target);
  const resolvedBase = resolve(base);
  if (!resolvedTarget.startsWith(resolvedBase + sep)) {
    throw new Error(`Refused: ${label} escapes the expected directory`);
  }
}

export function resolveEditor(): string {
  const envEditor = process.env['EDITOR'];
  if (envEditor && envEditor.trim().length > 0) {
    return envEditor;
  }

  for (const candidate of EDITOR_CANDIDATES) {
    const result = spawnSync(candidate, ['--version'], { stdio: 'ignore', timeout: 2000 });
    if (result.status === 0) {
      return candidate;
    }
  }

  throw new Error(
    'No editor found. Set the EDITOR environment variable:\n' +
      '  export EDITOR=nano\n' +
      '  export EDITOR=code',
  );
}

export function registerSkillOpen(program: Command): void {
  program
    .command('open <skill-name>')
    .description('Open the latest registry version of a skill in your editor')
    .option('--version <version>', 'Open a specific version instead of latest')
    .action(async (skillName: string, options: SkillOpenOptions) => {
      try {
        if (!SKILL_NAME_RE.test(skillName)) {
          throw new Error(`Invalid skill name "${skillName}": must match ^[a-z0-9-]+$`);
        }

        const registryPath = getRegistryPath();
        const skillDir = join(registryPath, skillName);
        assertWithin(skillDir, registryPath, 'skill path');

        const entry = await readRegistryEntry(skillDir);
        if (!entry) {
          throw new Error(`Skill "${skillName}" not found in registry`);
        }

        const version = options.version ?? resolveLatestVersion(entry);
        if (!version) {
          throw new Error(`Skill "${skillName}" has no available versions`);
        }

        const versionDir = resolveVersionPath(entry, version, skillDir);
        const skillMdPath = join(versionDir, 'SKILL.md');
        assertWithin(skillMdPath, versionDir, 'SKILL.md path');

        if (!existsSync(skillMdPath)) {
          throw new Error(`SKILL.md not found for "${skillName}@${version}"`);
        }

        const editor = resolveEditor();

        logger.info(`Opening ${skillName}@${version} in ${basename(editor)}...`);
        logger.info(`File: ${skillMdPath}`);
        logger.warn(
          '⚠  Edit the registry copy only. Changes to .claude/skills/ will be overwritten by upgrade.',
        );

        const proc = spawn(editor, [skillMdPath], { stdio: 'inherit' });

        await new Promise<void>((resolvePromise, reject) => {
          proc.on('close', (code) => {
            if (code === 0 || code === null) resolvePromise();
            else reject(new Error(`${editor} exited with code ${code}`));
          });
          proc.on('error', reject);
        });

        logger.info('');
        logger.success(`Done editing ${skillName}@${version}`);
        logger.info(`Run 'goodboy upgrade ${skillName}' to install the updated version.`);
        logger.info(`Run 'goodboy skill diff ${skillName}' to see what changed.`);
      } catch (err) {
        logger.error(sanitiseError(err));
        process.exit(1);
      }
    });
}
