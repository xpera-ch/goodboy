import { Command } from 'commander';
import chalk from 'chalk';
import { createRegistryAdapter } from '../lib/registry-adapter.js';
import { logger } from '../lib/logger.js';
import type { GoodBoyManifest } from '../types/index.js';

function highlight(text: string, query: string): string {
  if (!query) return text;
  const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return text.replace(re, (m) => chalk.bgYellow.black(m));
}

function renderSkill(skill: GoodBoyManifest, query: string): void {
  const name = highlight(skill.name, query);
  const desc = highlight(skill.description, query);
  const version = chalk.gray(`v${skill.version}`);
  const category = skill.category !== undefined ? chalk.cyan(` [${skill.category}]`) : '';

  process.stdout.write(`  ${chalk.bold(name)} ${version}${category}\n`);
  process.stdout.write(`    ${desc}\n`);

  if (Array.isArray(skill.keywords) && skill.keywords.length > 0) {
    const kws = skill.keywords
      .map((kw) => highlight(kw, query))
      .join(chalk.gray(', '));
    process.stdout.write(`    ${chalk.gray('keywords:')} ${kws}\n`);
  }

  process.stdout.write('\n');
}

async function run(query: string): Promise<void> {
  const registry = createRegistryAdapter();
  const results = await registry.search(query);

  if (results.length === 0) {
    logger.info(`No skills in the registry match "${query}".`);
    return;
  }

  for (const skill of results) {
    renderSkill(skill, query);
  }

  logger.info(`${results.length} skill${results.length === 1 ? '' : 's'} matched`);
}

export const searchCommand = new Command('search')
  .description('Search available skills in the registry by name, description, or keyword')
  .argument('<query>', 'Search query')
  .action(async (query: string) => {
    try {
      await run(query);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
