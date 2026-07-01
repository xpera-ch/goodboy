#!/usr/bin/env node
import { Command } from 'commander';
import { createRequire } from 'node:module';
import { initCommand } from './commands/init.js';
import { installCommand } from './commands/install.js';
import { listCommand } from './commands/list.js';
import { searchCommand } from './commands/search.js';

const _require = createRequire(import.meta.url);
const pkg = _require('../package.json') as { version: string };

const program = new Command();

program
  .name('goodboy')
  .description('Personal skill registry and dispatcher for Claude Code')
  .version(pkg.version, '-v, --version', 'Print version number')
  .addHelpText('after', '\nDocs: https://github.com/xpera/goodboy');

program.addCommand(initCommand);
program.addCommand(installCommand);
program.addCommand(listCommand);
program.addCommand(searchCommand);

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(
    `Error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
