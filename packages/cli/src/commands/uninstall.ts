import { Command } from 'commander';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import ora from 'ora';
import { logger, sanitiseError } from '../lib/logger.js';
import { SKILL_NAME_RE } from '../lib/validation.js';
import {
  removeSkillFromManifest,
  removeSkillFromLock,
} from '../lib/goodboy-file.js';
import { removeAgentSymlinks, AGENT_SKILL_DIRS } from '../lib/agents.js';
import { removeFromStore } from '../lib/store.js';

interface UninstallOptions {
  global?: boolean;
}

function getProjectSkillsPath(cwd: string): string {
  return join(cwd, '.claude', 'skills');
}

async function uninstallSkill(
  name: string,
  options: UninstallOptions,
  cwd: string,
): Promise<void> {
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error(`Invalid skill name: "${name}". Must match ^[a-z0-9-]+$.`);
  }

  const spinner = ora(`Uninstalling "${name}"…`).start();

  if (options.global) {
    await removeAgentSymlinks(name, Object.keys(AGENT_SKILL_DIRS));
    removeFromStore(name);
  } else {
    const destPath = join(getProjectSkillsPath(cwd), name);
    if (existsSync(destPath)) {
      rmSync(destPath, { recursive: true, force: true });
    } else {
      spinner.warn(`"${name}" is not installed in this project`);
      return;
    }

    await removeSkillFromManifest(cwd, name);
    await removeSkillFromLock(cwd, name);
  }

  spinner.succeed(`Uninstalled "${name}"`);
}

export const uninstallCommand = new Command('uninstall')
  .alias('rm')
  .description('Remove an installed skill')
  .argument('<skill-name>', 'Skill to remove')
  .option('-g, --global', 'Remove from global store and all agent symlinks')
  .action(async (skillName: string, options: UninstallOptions) => {
    const cwd = process.cwd();
    try {
      await uninstallSkill(skillName, options, cwd);
    } catch (err) {
      logger.error(sanitiseError(err));
      process.exit(1);
    }
  });
