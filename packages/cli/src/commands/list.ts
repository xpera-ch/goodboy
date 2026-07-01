import { Command } from 'commander';
import Table from 'cli-table3';
import chalk from 'chalk';
import { listInstalled } from '../lib/registry.js';
import { logger } from '../lib/logger.js';

function statusColor(status: string): string {
  switch (status) {
    case 'stable':       return chalk.green(status);
    case 'experimental': return chalk.yellow(status);
    case 'deprecated':   return chalk.red(status);
    default:             return chalk.gray(status);
  }
}

function visibilityColor(visibility: string): string {
  return visibility === 'public' ? chalk.cyan(visibility) : chalk.gray(visibility);
}

async function run(): Promise<void> {
  const skills = await listInstalled();

  if (skills.length === 0) {
    logger.info('No skills installed. Run `goodboy install <name>` to get started.');
    return;
  }

  const table = new Table({
    head: ['Name', 'Version', 'Description', 'Status', 'Visibility'].map((h) =>
      chalk.bold(h),
    ),
    colWidths: [20, 10, 40, 14, 12],
    wordWrap: true,
    style: { head: [], border: [] },
  });

  for (const skill of skills) {
    table.push([
      chalk.white(skill.name),
      chalk.gray(skill.version),
      skill.description,
      statusColor(skill.status),
      visibilityColor(skill.visibility ?? ''),
    ]);
  }

  process.stdout.write(table.toString() + '\n');
  logger.info(`\n${skills.length} skill${skills.length === 1 ? '' : 's'} installed`);
}

export const listCommand = new Command('list')
  .description('List all installed skills')
  .action(async () => {
    try {
      await run();
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
