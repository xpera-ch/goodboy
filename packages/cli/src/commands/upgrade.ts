import { Command } from 'commander';
import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import ora from 'ora';
import { createRegistryAdapter } from '../lib/registry-adapter.js';
import { readManifest, validateManifest } from '../lib/manifest.js';
import { scanForSymlinks } from '../lib/fs-security.js';
import { logger, sanitiseError } from '../lib/logger.js';
import { SKILL_NAME_RE } from '../lib/validation.js';
import {
  readGoodBoyJson,
  getLockedVersion,
  addSkillToManifest,
  addSkillToLock,
} from '../lib/goodboy-file.js';
import { getStorePath } from '../lib/store.js';

interface UpgradeOptions {
  global?: boolean;
}

function getProjectSkillsPath(cwd: string): string {
  return join(cwd, '.claude', 'skills');
}

async function upgradeSkill(
  name: string,
  options: UpgradeOptions,
  cwd: string,
): Promise<void> {
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error(`Invalid skill name: "${name}". Must match ^[a-z0-9-]+$.`);
  }

  const registry = createRegistryAdapter();
  const spinner = ora(`Upgrading "${name}"…`).start();

  let skillPath: string;
  try {
    skillPath = await registry.resolveSkill(name);
  } catch (err) {
    spinner.fail(`Cannot locate skill "${name}" in registry`);
    throw err;
  }

  let manifest;
  try {
    const data = await readManifest(join(skillPath, 'manifest.json'));
    manifest = validateManifest(data);
  } catch (err) {
    spinner.fail('Manifest validation failed');
    throw err;
  }

  const lockedVersion = await getLockedVersion(cwd, name);
  if (lockedVersion !== null && lockedVersion === manifest.version) {
    spinner.info(`"${name}" is already at the latest version (${manifest.version})`);
    return;
  }

  try {
    await scanForSymlinks(skillPath);
  } catch {
    spinner.fail('Symlink check failed');
    throw new Error('Skill rejected: symlink pointing outside skill directory detected');
  }

  const destPath = options.global
    ? join(getStorePath(), name)
    : join(getProjectSkillsPath(cwd), name);

  if (!existsSync(destPath)) {
    spinner.fail(`"${name}" is not installed`);
    throw new Error(`Skill "${name}" is not installed. Run "goodboy install ${name}" first.`);
  }

  try {
    cpSync(skillPath, destPath, { recursive: true, force: true });
  } catch (err) {
    spinner.fail('Failed to copy skill files');
    throw err;
  }

  if (!options.global) {
    await addSkillToManifest(cwd, name, manifest.version);
    await addSkillToLock(cwd, name, manifest.version, destPath);
  }

  const from = lockedVersion !== null ? `${lockedVersion} → ` : '';
  spinner.succeed(`Upgraded "${name}" (${from}${manifest.version})`);
}

async function upgradeAll(options: UpgradeOptions, cwd: string): Promise<void> {
  const goodboy = await readGoodBoyJson(cwd);
  if (!goodboy) {
    throw new Error('No goodboy.json found in current directory.');
  }

  const skills = Object.keys(goodboy.skills);
  if (skills.length === 0) {
    logger.info('No skills listed in goodboy.json.');
    return;
  }

  for (const name of skills) {
    await upgradeSkill(name, options, cwd);
  }
}

export const upgradeCommand = new Command('upgrade')
  .description('Upgrade installed skills to the latest registry version')
  .argument('[skill-name]', 'Skill to upgrade (omit to upgrade all from goodboy.json)')
  .option('-g, --global', 'Upgrade in global store (~/.goodboy/skills/)')
  .action(async (skillName: string | undefined, options: UpgradeOptions) => {
    const cwd = process.cwd();
    try {
      if (skillName !== undefined) {
        await upgradeSkill(skillName, options, cwd);
      } else {
        await upgradeAll(options, cwd);
      }
    } catch (err) {
      logger.error(sanitiseError(err));
      process.exit(1);
    }
  });
