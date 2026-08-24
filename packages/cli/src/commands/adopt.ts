import { Command } from 'commander';
import { input, confirm } from '@inquirer/prompts';
import { ExitPromptError } from '@inquirer/core';
import ora from 'ora';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseFrontmatter } from '../lib/skill-validator.js';
import { scanForSymlinks } from '../lib/fs-security.js';
import { validateManifest } from '../lib/manifest.js';
import { getRegistryPath, writeSkillVersionToRegistry } from '../lib/registry.js';
import { readRegistryEntry } from '../lib/registry-entry.js';
import { SKILL_NAME_RE, isRemoteRefArgument } from '../lib/validation.js';
import { logger, sanitiseError } from '../lib/logger.js';
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

// The three prompt validate callbacks, lifted to module level so the flag
// path (--author/--email/--license) validates with the exact same rules and
// messages as the prompted path — a bad flag fails with the message its
// prompt would have shown.
function validateAuthorName(value: string): string | true {
  const t = value.trim();
  if (t.length === 0) return 'Author name is required';
  return t.length <= 128 ? true : 'Author name must be 128 characters or fewer';
}

function validateAuthorEmail(value: string): string | true {
  const t = value.trim();
  if (t.length === 0) return true;
  if (t.length > 254) return 'Email address must be 254 characters or fewer';
  return EMAIL_RE.test(t) ? true : `"${t}" is not a valid email address`;
}

function validateLicense(value: string): string | true {
  const t = value.trim();
  if (t.length === 0) return 'License is required';
  return t.length <= 64 ? true : 'License must be 64 characters or fewer';
}

/**
 * One adopt value: a supplied flag replaces its prompt, validated with the
 * prompt's own validate callback; an invalid flag value fails fast with the
 * same message the prompt would have shown. Values are trimmed, matching
 * what the interactive path trims at use.
 *
 * Without a flag, a non-interactive run never constructs a prompt (stdin is
 * closed — it would force-close immediately). Only the email value can
 * reach this: the gate above guarantees author and license flags whenever
 * they are required, and the email prompt accepts empty, so the empty
 * answer the prompt would have accepted is supplied by construction.
 */
async function valueOrPrompt(
  flag: string | undefined,
  promptMessage: string,
  validate: (value: string) => string | true,
): Promise<string> {
  if (flag !== undefined) {
    const error = validate(flag);
    if (error !== true) {
      logger.error(error);
      throw new HandledFailure();
    }
    return flag.trim();
  }
  if (process.stdin.isTTY !== true) return '';
  const answer = await input({ message: promptMessage, validate });
  return answer.trim();
}

interface AdoptOptions {
  author?: string;
  email?: string;
  license?: string;
  yes?: boolean;
}

async function run(pathArg: string, options: AdoptOptions): Promise<void> {
  if (isRemoteRefArgument(pathArg)) {
    logger.error(
      `"${pathArg}" looks like a URL, not a local path. ` +
        `'goodboy adopt' only accepts an existing local skill directory — clone or download the skill first, then run 'goodboy adopt <local-dir>'.`,
    );
    throw new HandledFailure();
  }

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
  if (fm.description.length > 1024) {
    logger.error(
      'The description in SKILL.md exceeds the 1024-character limit for manifest descriptions',
    );
    throw new HandledFailure();
  }

  const name = fm.name;
  if (!SKILL_NAME_RE.test(name)) {
    logger.error(`Invalid skill name "${name}" in SKILL.md frontmatter: must match ^[a-z0-9-]+$`);
    throw new HandledFailure();
  }
  if (name.length > 64) {
    logger.error(`Skill name "${name}" in SKILL.md frontmatter exceeds the 64-character limit`);
    throw new HandledFailure();
  }

  // Refuse before any interaction: adopt onboards a skill the registry does
  // not know yet. If registry-entry.json already exists for this name — any
  // version — the user wants a new version, which is `skill version`'s job
  // (docs/decisions.md, 2026-08-17). No --force for adopt, by design.
  const registryPath = getRegistryPath();
  const skillRegistryDir = join(registryPath, name);
  const existingEntry = await readRegistryEntry(skillRegistryDir);
  if (existingEntry) {
    logger.error(
      `Skill "${name}" is already in the local registry. ` +
        `To add a new version, run 'goodboy skill version ${name} --bump <patch|minor|major>'.`,
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

  // Non-interactive runs (piped or closed stdin — no TTY) cannot answer the
  // prompts, so adopt only proceeds when every value it needs is supplied by
  // flag and the confirmation is waived with --yes. Anything missing fails
  // fast here, before any prompt or filesystem write, naming exactly which
  // flags are missing — not a generic "requires a terminal"
  // (docs/backlog.md, "Interactive commands have no non-interactive story",
  // decided 2026-08-24). The email flag is deliberately absent from the
  // check: the email prompt accepts empty, so email is never required.
  if (process.stdin.isTTY !== true) {
    const missing: string[] = [];
    if (options.author === undefined) missing.push('--author <name>');
    if (!fm.license && options.license === undefined) missing.push('--license <spdx>');
    if (!options.yes) missing.push('--yes');
    if (missing.length > 0) {
      logger.error(
        `Cannot adopt non-interactively: missing ${missing.join(', ')}. ` +
          `Re-run with every missing flag supplied, or run 'goodboy adopt ${pathArg}' in an interactive terminal.`,
      );
      throw new HandledFailure();
    }
  }

  const authorName = await valueOrPrompt(options.author, 'Author name:', validateAuthorName);
  const authorEmail = await valueOrPrompt(options.email, 'Author email (optional):', validateAuthorEmail);

  let license = fm.license;
  if (!license) {
    license = await valueOrPrompt(options.license, 'License:', validateLicense);
  }
  if (license.trim().length > 64) {
    logger.error('The license in SKILL.md exceeds the 64-character limit for manifest licenses');
    throw new HandledFailure();
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
    schema_version: '2.0.0',
    status: 'experimental',
    category: 'other',
  };

  // Schema-check the synthesis in memory before showing it. Note:
  // validateSkillDirectory() is deliberately NOT used here — it reads
  // manifest.json from disk, and the source has none; the schema check on
  // the in-memory object is the applicable gate (and a construction bug in
  // the synthesis above fails here, never reaching the registry). Every
  // schema-bounded input (name, description, author name/email, license)
  // is pre-checked with its own input-attributed error above, so a failure
  // at this gate genuinely is a GoodBoy bug, not user input.
  let validated: GoodBoyManifest;
  try {
    validated = validateManifest(manifest);
  } catch (err) {
    logger.error(
      `Synthesized manifest failed schema validation (this is a GoodBoy bug, not a problem with the skill): ` +
        (err instanceof Error ? err.message : String(err)),
    );
    throw new HandledFailure();
  }

  logger.info('');
  logger.info('  Registering the following manifest:');
  logger.info(`  Name:            ${validated.name}`);
  logger.info(`  Version:         ${validated.version}`);
  logger.info(`  Description:     ${validated.description}`);
  logger.info(
    `  Author:          ${validated.author.name}${validated.author.email ? ` <${validated.author.email}>` : ''}`,
  );
  logger.info(`  License:         ${validated.license}`);
  logger.info(`  Schema version:  ${validated.schema_version}`);
  logger.info(`  Status:          ${validated.status}`);
  logger.info(`  Category:        ${validated.category}`);

  // Registry versions are immutable — a wrong license or typo'd author
  // would cost a `registry remove` or a version bump, so the confirmation
  // defaults to No (decisions.md, 2026-08-17). --yes waives it for
  // scripted runs; the interactive default stays No.
  const confirmed = options.yes ? true : await confirm({
    message: 'Register this skill?',
    default: false,
  });
  if (!confirmed) {
    logger.info('Nothing was registered — the source directory was not modified.');
    return;
  }

  const writeSpinner = ora('Copying skill files...').start();
  let result: Awaited<ReturnType<typeof writeSkillVersionToRegistry>>;
  try {
    result = await writeSkillVersionToRegistry({
      sourceDir: sourcePath,
      manifest: validated,
      manifestToWrite: true,
      mustBeNew: true,
    });
    writeSpinner.succeed('Adopted skill');
  } catch (err) {
    writeSpinner.fail('Failed to adopt skill');
    throw err;
  }

  logger.info('');
  logger.info(`  Name:    ${validated.name}`);
  logger.info(`  Version: ${validated.version}`);
  logger.info(`  Registry: ${result.skillRegistryDir}`);
  logger.info('  Created: manifest.json synthesized from SKILL.md, plus copied skill files');
  logger.info('  Source:  the source directory was not modified');
  logger.info('');
  logger.info(`  Next: run 'goodboy install ${validated.name}' to install this skill.`);
  logger.success(`Adopted skill "${validated.name}"`);
}

export const adoptCommand = new Command('adopt')
  .description('Onboard an existing SKILL.md-only skill (no manifest.json) into the local registry')
  .argument('<path>', 'Local path to an existing skill directory containing SKILL.md but no manifest.json')
  .option('--author <name>', 'Author name — skips the author name prompt')
  .option('--email <email>', 'Author email — skips the author email prompt (email stays optional)')
  .option('--license <spdx>', 'License — fills the gap when SKILL.md declares none, skipping the license prompt')
  .option('--yes', 'Skip the final "Register this skill?" confirmation')
  .action(async (pathArg: string, options: AdoptOptions) => {
    try {
      await run(pathArg, options);
    } catch (err) {
      if (!(err instanceof HandledFailure)) {
        if (err instanceof ExitPromptError) {
          // A force-closed prompt (stdin ended mid-dialogue, Ctrl-C/D) must
          // never exit 0 having done nothing — it exits non-zero naming the
          // cause and the remedy (docs/backlog.md, decided 2026-08-24).
          logger.error(
            'Input was force-closed before every prompt was answered (stdin ended mid-dialogue). ' +
              `Nothing was registered. Run 'goodboy adopt ${pathArg}' in an interactive terminal, ` +
              'or pass every required value as a flag: --author <name> --email <email> [--license <spdx>] --yes.',
          );
        } else {
          logger.error(sanitiseError(err));
        }
      }
      process.exit(1);
    }
  });
