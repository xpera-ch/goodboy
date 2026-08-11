import { Command } from 'commander';
import { input, select } from '@inquirer/prompts';
import ora from 'ora';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeManifest } from '../lib/manifest.js';
import { logger } from '../lib/logger.js';
import { SKILL_NAME_RE } from '../lib/validation.js';
import type { GoodBoyManifest } from '../types/index.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Schema enforces maxLength: 64 on name and maxLength: 1024 on description.
// These limits must stay in sync with manifest.schema.json.
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

type Category = NonNullable<GoodBoyManifest['category']>;

function buildSkillMd(name: string, description: string): string {
  return `---
name: ${name}
description: ${description}
---

# ${name}

## Instructions

Describe when and how this skill should be used, and provide the
assistant with step-by-step guidance for completing the task.
`;
}

async function run(): Promise<void> {
  const name = await input({
    message: 'Skill name:',
    validate: (v) => {
      const t = v.trim();
      if (!SKILL_NAME_RE.test(t)) {
        return 'Must match ^[a-z0-9-]+ (lowercase letters, numbers, hyphens only)';
      }
      if (t.length > MAX_NAME_LENGTH) {
        return `Name must be ${MAX_NAME_LENGTH} characters or fewer`;
      }
      return true;
    },
  });

  const skillDir = join(process.cwd(), name.trim());
  if (existsSync(skillDir)) {
    throw new Error(
      `Directory "${name.trim()}" already exists in the current directory. ` +
        `Choose a different skill name or remove the existing directory.`,
    );
  }

  const description = await input({
    message: 'Description:',
    validate: (v) => {
      const t = v.trim();
      if (t.length === 0) return 'Description is required';
      if (t.length > MAX_DESCRIPTION_LENGTH) {
        return `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`;
      }
      return true;
    },
  });

  const authorName = await input({
    message: 'Author name:',
    validate: (v) => (v.trim().length > 0 ? true : 'Author name is required'),
  });

  const authorEmail = await input({
    message: 'Author email (optional):',
    validate: (v) => {
      const t = v.trim();
      if (t.length === 0) return true;
      return EMAIL_RE.test(t) ? true : `"${t}" is not a valid email address`;
    },
  });

  const category = (await select({
    message: 'Category:',
    choices: [
      { value: 'code',          name: 'Code' },
      { value: 'writing',       name: 'Writing' },
      { value: 'data',          name: 'Data' },
      { value: 'devops',        name: 'DevOps' },
      { value: 'testing',       name: 'Testing' },
      { value: 'documentation', name: 'Documentation' },
      { value: 'productivity',  name: 'Productivity' },
      { value: 'security',      name: 'Security' },
      { value: 'research',      name: 'Research' },
      { value: 'other',         name: 'Other' },
    ],
  })) as Category;

  const license = await input({ message: 'License:', default: 'MIT' });

  const manifest: GoodBoyManifest = {
    name: name.trim(),
    version: '0.1.0',
    description: description.trim(),
    author: {
      name: authorName.trim(),
      ...(authorEmail.trim() ? { email: authorEmail.trim() } : {}),
    },
    license: license.trim() || 'MIT',
    category,
    schema_version: '2.0.0',
    status: 'experimental',
  };

  const manifestPath = join(skillDir, 'manifest.json');
  const skillMdPath = join(skillDir, 'SKILL.md');
  const spinner = ora('Creating skill scaffold…').start();

  try {
    mkdirSync(skillDir, { recursive: true });
    for (const sub of ['scripts', 'references', 'assets'] as const) {
      mkdirSync(join(skillDir, sub), { recursive: true });
    }
    await writeManifest(manifestPath, manifest);
    writeFileSync(skillMdPath, buildSkillMd(manifest.name, manifest.description), 'utf-8');
    spinner.succeed('Created skill scaffold');
  } catch (err) {
    spinner.fail('Failed to create skill scaffold');
    throw err;
  }

  logger.info('');
  logger.info(`  Name:    ${manifest.name}`);
  logger.info(`  Version: ${manifest.version}`);
  logger.info(`  Path:    ${skillDir}`);
  logger.info('  Created: manifest.json, SKILL.md, scripts/, references/, assets/');
  logger.info('');
  logger.info(`  Run 'goodboy add ./${manifest.name}' to add this skill to your local registry.`);
  logger.info(`  Run 'goodboy install ${manifest.name}' to install it.`);
  logger.success('Skill scaffold created');
}

export function registerSkillCreate(program: Command): void {
  program
    .command('create')
    .description('Create a new skill with SKILL.md and manifest.json')
    .action(async () => {
      try {
        await run();
      } catch (err) {
        if (err instanceof Error && /force closed|force-closed/i.test(err.message)) {
          process.exit(0);
        }
        logger.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
