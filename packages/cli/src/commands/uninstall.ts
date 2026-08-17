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
import { removeFromStore, getGoodboyHome } from '../lib/store.js';

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
    // removeAgentSymlinks returns false when a shared-path confirmation was
    // declined — then nothing at all was removed, and deleting the store
    // content the kept symlink points at would leave a corpse link. Abort
    // the whole uninstall instead (docs/decisions.md, 2026-08-13). The
    // confirmation is interactive, so the spinner stops first — otherwise
    // its redraw and inquirer's prompt fight for the same terminal line
    // (the stop/start shape mirrors install.ts's consent prompt).
    spinner.stop();
    const removed = await removeAgentSymlinks(name, Object.keys(AGENT_SKILL_DIRS));
    if (!removed) {
      spinner.warn(`Uninstall cancelled — nothing was removed for "${name}"`);
      return;
    }
    spinner.start(
      `Removing "${name}" from the store and updating goodboy.json/goodboy.lock…`,
    );

    removeFromStore(name);

    const goodboyHome = getGoodboyHome();
    await removeSkillFromManifest(goodboyHome, name);
    await removeSkillFromLock(goodboyHome, name);
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
