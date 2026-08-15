#!/usr/bin/env node
import { Command } from 'commander';
import { createRequire } from 'node:module';
import { initCommand } from './commands/init.js';
import { registerSkillCommand } from './commands/skill.js';
import { installCommand } from './commands/install.js';
import { upgradeCommand } from './commands/upgrade.js';
import { uninstallCommand } from './commands/uninstall.js';
import { listCommand } from './commands/list.js';
import { searchCommand } from './commands/search.js';
import { addCommand } from './commands/add.js';
import { adoptCommand } from './commands/adopt.js';
import { registryCommand } from './commands/registry-cmd.js';
import { verifyCommand } from './commands/verify.js';
import {
  completionCommand,
  completeCommand,
  attachProgram,
} from './commands/completion.js';

const _require = createRequire(import.meta.url);
const pkg = _require('../package.json') as { version: string };

const program = new Command();

program
  .name('goodboy')
  .description('Personal skill registry and dispatcher for Claude Code')
  .version(pkg.version, '-v, --version', 'Print version number')
  .addHelpText('after', '\nDocs: https://github.com/xpera-ch/goodboy');

program.addCommand(initCommand);
registerSkillCommand(program);
program.addCommand(installCommand);
program.addCommand(upgradeCommand);
program.addCommand(uninstallCommand);
program.addCommand(listCommand);
program.addCommand(searchCommand);
program.addCommand(addCommand);
program.addCommand(adoptCommand);
program.addCommand(registryCommand);
program.addCommand(verifyCommand);
attachProgram(program);
program.addCommand(completionCommand, { hidden: true });
program.addCommand(completeCommand, { hidden: true });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(
    `Error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
