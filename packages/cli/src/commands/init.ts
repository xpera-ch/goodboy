import { Command } from 'commander';
import { input, select } from '@inquirer/prompts';
import ora from 'ora';
import { join } from 'node:path';
import { writeManifest } from '../lib/manifest.js';
import { logger } from '../lib/logger.js';
import { SKILL_NAME_RE } from '../lib/validation.js';
import type { GoodBoyManifest } from '../types/index.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Schema enforces maxLength: 128 on name and maxLength: 280 on description.
// These limits must stay in sync with manifest.schema.json.
const MAX_NAME_LENGTH = 128;
const MAX_DESCRIPTION_LENGTH = 280;

type Language = NonNullable<Extract<GoodBoyManifest, { kind: 'executable' }>['language']>;
type Category = NonNullable<GoodBoyManifest['category']>;

function defaultEntry(language: Language): string {
  switch (language) {
    case 'python':     return 'index.py';
    case 'go':         return 'main.go';
    case 'java':       return 'Main.java';
    case 'cpp':        return 'main.cpp';
    case 'csharp':     return 'Program.cs';
    case 'javascript': return 'index.js';
    default:           return 'index.ts';
  }
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
      { value: 'other',         name: 'Other' },
    ],
  })) as Category;

  const license = await input({ message: 'License:', default: 'MIT' });

  const language = (await select({
    message: 'Language:',
    choices: [
      { value: 'typescript',  name: 'TypeScript' },
      { value: 'javascript',  name: 'JavaScript' },
      { value: 'python',      name: 'Python' },
      { value: 'java',        name: 'Java' },
      { value: 'go',          name: 'Go' },
      { value: 'cpp',         name: 'C++' },
      { value: 'csharp',      name: 'C#' },
      { value: 'other',       name: 'Other' },
    ],
  })) as Language;

  const manifest: GoodBoyManifest = {
    kind: 'executable',
    name: name.trim(),
    version: '0.1.0',
    description: description.trim(),
    author: {
      name: authorName.trim(),
      ...(authorEmail.trim() ? { email: authorEmail.trim() } : {}),
    },
    license: license.trim() || 'MIT',
    category,
    language,
    entry: defaultEntry(language),
    hooks: {},
    schema_version: '1.0.0',
    status: 'experimental',
    visibility: 'private',
  };

  const manifestPath = join(process.cwd(), 'manifest.json');
  const spinner = ora('Writing manifest.json…').start();

  try {
    await writeManifest(manifestPath, manifest);
    spinner.succeed('Created manifest.json');
  } catch (err) {
    spinner.fail('Failed to write manifest.json');
    throw err;
  }

  logger.info('');
  logger.info(`  Name:    ${manifest.name}`);
  logger.info(`  Version: ${manifest.version}`);
  logger.info(`  Path:    ${manifestPath}`);
  logger.info('');
  logger.success('Skill initialised');
}

export const initCommand = new Command('init')
  .description('Initialise a new skill in the current directory')
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
