import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Table from 'cli-table3';
import chalk from 'chalk';
import { createRegistryAdapter } from '../lib/registry-adapter.js';
import { readManifest, validateManifest } from '../lib/manifest.js';
import { readGoodBoyJson } from '../lib/goodboy-file.js';
import { logger, sanitiseError } from '../lib/logger.js';
import type { GoodBoyManifest } from '../types/index.js';

type Scope = 'project' | 'global';

interface SkillRow {
  manifest: GoodBoyManifest;
  scope: Scope;
}

function statusColor(status: string): string {
  switch (status) {
    case 'stable':       return chalk.green(status);
    case 'experimental': return chalk.yellow(status);
    case 'deprecated':   return chalk.red(status);
    default:             return chalk.gray(status);
  }
}

function scopeColor(scope: Scope): string {
  return scope === 'project' ? chalk.cyan(scope) : chalk.magenta(scope);
}

async function readSkillsFromDir(
  dir: string,
  scope: Scope,
): Promise<SkillRow[]> {
  if (!existsSync(dir)) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const rows: SkillRow[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(dir, entry.name, 'manifest.json');
    try {
      const data = await readManifest(manifestPath);
      const manifest = validateManifest(data);
      rows.push({ manifest, scope });
    } catch {
      // silently skip unreadable/invalid skills
    }
  }

  return rows;
}

interface ListOptions {
  global?: boolean;
  all?: boolean;
}

async function run(options: ListOptions): Promise<void> {
  const cwd = process.cwd();
  const rows: SkillRow[] = [];

  const showProject = !options.global || options.all;
  const showGlobal = options.global === true || options.all === true;

  if (showProject) {
    const hasGoodBoyJson = (await readGoodBoyJson(cwd)) !== null;

    if (!hasGoodBoyJson) {
      if (options.all) {
        logger.info('Project skills: no goodboy.json in this directory');
      } else {
        logger.warn('No goodboy.json found in current directory.');
        logger.info("This doesn't look like a GoodBoy project.");
        logger.info('');
        logger.info("Run 'goodboy init' to initialise GoodBoy here.");
        logger.info("Run 'goodboy list -g' to see globally installed skills.");
        return;
      }
    } else {
      const projectSkillsPath = join(cwd, '.claude', 'skills');
      rows.push(...(await readSkillsFromDir(projectSkillsPath, 'project')));
    }
  }

  if (showGlobal) {
    const registry = createRegistryAdapter();
    const globalSkillsPath = registry.getSkillsLocation();
    rows.push(...(await readSkillsFromDir(globalSkillsPath, 'global')));
  }

  if (rows.length === 0) {
    logger.info('No skills installed. Run `goodboy install <name>` to get started.');
    return;
  }

  const table = new Table({
    head: ['Name', 'Version', 'Description', 'Status', 'Scope'].map((h) =>
      chalk.bold(h),
    ),
    colWidths: [20, 10, 36, 14, 10],
    wordWrap: true,
    style: { head: [], border: [] },
  });

  for (const { manifest, scope } of rows) {
    table.push([
      chalk.white(manifest.name),
      chalk.gray(manifest.version),
      manifest.description,
      statusColor(manifest.status),
      scopeColor(scope),
    ]);
  }

  process.stdout.write(table.toString() + '\n');
  logger.info(`\n${rows.length} skill${rows.length === 1 ? '' : 's'} installed`);
}

export const listCommand = new Command('list')
  .description('List installed skills')
  .option('-g, --global', 'List only globally installed skills')
  .option('-a, --all', 'List both project and global skills')
  .action(async (options: ListOptions) => {
    try {
      await run(options);
    } catch (err) {
      logger.error(sanitiseError(err));
      process.exit(1);
    }
  });
