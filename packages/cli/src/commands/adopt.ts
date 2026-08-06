import { Command } from 'commander';
import { input } from '@inquirer/prompts';
import ora from 'ora';
import { existsSync, statSync, cpSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseFrontmatter } from '../lib/skill-validator.js';
import { scanForSymlinks } from '../lib/fs-security.js';
import { writeManifest } from '../lib/manifest.js';
import { SKILL_NAME_RE } from '../lib/validation.js';
import { logger } from '../lib/logger.js';
import type { GoodBoyManifest } from '../types/index.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mirrors manifest.ts's MAX_MANIFEST_BYTES — a SKILL.md has no legitimate
// reason to be larger than a manifest.json.
const MAX_SKILL_MD_BYTES = 512 * 1024; // 512 KB

/**
 * Marks a failure branch that has already logged its own specific message,
 * mirroring add.ts's HandledFailure — avoids a second, misleading message
 * in the top-level catch below.
 */
class HandledFailure extends Error {}

async function run(pathArg: string): Promise<void> {
  const sourcePath = resolve(pathArg);

  if (!existsSync(sourcePath)) {
    logger.error(`Skill path not found: "${pathArg}"`);
    throw new HandledFailure();
  }

  if (!statSync(sourcePath).isDirectory()) {
    logger.error(`"${pathArg}" is not a directory`);
    throw new HandledFailure();
  }

  const skillMdPath = join(sourcePath, 'SKILL.md');
  if (!existsSync(skillMdPath)) {
    logger.error(`No SKILL.md found at "${pathArg}"`);
    throw new HandledFailure();
  }

  const manifestPath = join(sourcePath, 'manifest.json');
  if (existsSync(manifestPath)) {
    logger.error(
      `"${pathArg}" already has a manifest.json. Run 'goodboy add ${pathArg}' instead.`,
    );
    throw new HandledFailure();
  }

  if (statSync(skillMdPath).size > MAX_SKILL_MD_BYTES) {
    logger.error(`SKILL.md exceeds the 512 KB size limit`);
    throw new HandledFailure();
  }

  const content = readFileSync(skillMdPath, 'utf-8');
  const fm = parseFrontmatter(content);

  if (!fm.hasDelimiters) {
    logger.error('SKILL.md has no frontmatter (missing opening --- delimiter)');
    throw new HandledFailure();
  }
  if (!fm.hasClosingDelimiter) {
    logger.error('SKILL.md frontmatter is not closed (missing closing --- delimiter)');
    throw new HandledFailure();
  }
  if (!fm.name) {
    logger.error('SKILL.md frontmatter is missing the name field');
    throw new HandledFailure();
  }
  if (!fm.description) {
    logger.error('SKILL.md frontmatter is missing the description field');
    throw new HandledFailure();
  }

  const name = fm.name;
  if (!SKILL_NAME_RE.test(name)) {
    logger.error(`Invalid skill name "${name}" in SKILL.md frontmatter: must match ^[a-z0-9-]+$`);
    throw new HandledFailure();
  }

  const targetDir = join(process.cwd(), name);
  if (existsSync(targetDir)) {
    logger.error(
      `Directory "${name}" already exists in the current directory. ` +
        `Choose a different skill name or remove the existing directory.`,
    );
    throw new HandledFailure();
  }

  const scanSpinner = ora('Scanning for symlinks...').start();
  try {
    await scanForSymlinks(sourcePath);
    scanSpinner.succeed('Symlink scan passed');
  } catch {
    scanSpinner.fail();
    logger.error('Skill rejected: symlink pointing outside skill directory detected');
    throw new HandledFailure();
  }

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

  let license = fm.license;
  if (!license) {
    license = await input({
      message: 'License:',
      validate: (v) => (v.trim().length > 0 ? true : 'License is required'),
    });
  }

  const manifest: GoodBoyManifest = {
    name,
    version: '0.1.0',
    description: fm.description,
    author: {
      name: authorName.trim(),
      ...(authorEmail.trim() ? { email: authorEmail.trim() } : {}),
    },
    license: license.trim(),
    schema_version: '1.0.0',
    status: 'experimental',
    visibility: 'private',
    category: 'other',
  };

  const copySpinner = ora('Copying skill files...').start();
  try {
    cpSync(sourcePath, targetDir, { recursive: true });
    await writeManifest(join(targetDir, 'manifest.json'), manifest);
    copySpinner.succeed('Adopted skill');
  } catch (err) {
    copySpinner.fail('Failed to adopt skill');
    throw err;
  }

  logger.info('');
  logger.info(`  Name:    ${manifest.name}`);
  logger.info(`  Version: ${manifest.version}`);
  logger.info(`  Path:    ${targetDir}`);
  logger.info('  Created: manifest.json synthesized from SKILL.md, plus copied skill files');
  logger.info('');
  logger.info(`  Run 'goodboy add ./${manifest.name}' to add this skill to your local registry.`);
  logger.success(`Adopted skill "${manifest.name}"`);
}

export const adoptCommand = new Command('adopt')
  .description('Onboard an existing SKILL.md-only skill (no manifest.json) into a new local skill directory')
  .argument('<path>', 'Path to an existing skill directory containing SKILL.md but no manifest.json')
  .action(async (pathArg: string) => {
    try {
      await run(pathArg);
    } catch (err) {
      if (!(err instanceof HandledFailure)) {
        if (err instanceof Error && /force closed|force-closed/i.test(err.message)) {
          process.exit(0);
        }
        logger.error(err instanceof Error ? err.message : 'Unknown error');
      }
      process.exit(1);
    }
  });
