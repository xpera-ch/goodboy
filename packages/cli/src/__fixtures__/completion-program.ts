import { Command } from 'commander';
import { initCommand } from '../commands/init.js';
import { installCommand } from '../commands/install.js';
import { upgradeCommand } from '../commands/upgrade.js';
import { uninstallCommand } from '../commands/uninstall.js';
import { listCommand } from '../commands/list.js';
import { searchCommand } from '../commands/search.js';
import { addCommand } from '../commands/add.js';
import { adoptCommand } from '../commands/adopt.js';
import { registryCommand } from '../commands/registry-cmd.js';
import { verifyCommand } from '../commands/verify.js';
import { registerSkillCommand } from '../commands/skill.js';
import {
  completionCommand,
  completeProtocolCommand,
} from '../commands/completion.js';

/**
 * A program assembled from the real command objects, mirroring index.ts's
 * registrations — so the completion engine's source map is exercised
 * against the live surface (argument and option declarations included),
 * not a hand-written lookalike that could drift from it. The hidden
 * `completion`/`__complete` pair registers exactly as index.ts does.
 */
export function createCompletionProgram(): Command {
  const program = new Command()
    .name('goodboy')
    .version('0.3.0', '-v, --version', 'Print version number');
  program.addCommand(initCommand);
  program.addCommand(installCommand);
  program.addCommand(upgradeCommand);
  program.addCommand(uninstallCommand);
  program.addCommand(listCommand);
  program.addCommand(searchCommand);
  program.addCommand(addCommand);
  program.addCommand(adoptCommand);
  program.addCommand(registryCommand);
  program.addCommand(verifyCommand);
  registerSkillCommand(program);
  program.addCommand(completionCommand, { hidden: true });
  program.addCommand(completeProtocolCommand, { hidden: true });
  return program;
}
