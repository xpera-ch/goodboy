import { Command } from 'commander';
import chalk from 'chalk';
import { listInstalled } from '../lib/registry.js';
import { logger } from '../lib/logger.js';
import type { GoodBoyManifest } from '../types/index.js';

function highlight(text: string, query: string): string {
  if (!query) return text;
  const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return text.replace(re, (m) => chalk.bgYellow.black(m));
}

function matchesQuery(skill: GoodBoyManifest, queryLower: string): boolean {
  return (
    skill.name.toLowerCase().includes(queryLower) ||
    skill.description.toLowerCase().includes(queryLower) ||
    (Array.isArray(skill.keywords) &&
      skill.keywords.some((kw) => kw.toLowerCase().includes(queryLower))) ||
    (skill.category !== undefined && skill.category.toLowerCase().includes(queryLower))
  );
}

async function run(query: string): Promise<void> {
  const queryLower = query.toLowerCase();
  const all = await listInstalled();
  const results = all.filter((s) => matchesQuery(s, queryLower));

  if (results.length === 0) {
    logger.info(`No installed skills match "${query}".`);
    return;
  }

  for (const skill of results) {
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

  logger.info(`${results.length} of ${all.length} skills matched`);
}

export const searchCommand = new Command('search')
  .description('Search installed skills by name, description, or keyword')
  .argument('<query>', 'Search query')
  .action(async (query: string) => {
    try {
      await run(query);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
