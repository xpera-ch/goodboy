import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import Table from 'cli-table3';
import chalk from 'chalk';
import { readGoodBoyJson, readGoodBoyLock } from '../lib/goodboy-file.js';
import { verifySkillIntegrity } from '../lib/verify.js';
import type { VerifyState } from '../lib/verify.js';
import { SKILL_NAME_RE } from '../lib/validation.js';
import { logger, sanitiseError } from '../lib/logger.js';

export interface VerifyOptions {
  global?: boolean;
}

interface VerifyRow {
  name: string;
  version: string | null;
  state: VerifyState;
}

// Exported for direct unit testing: SKILL_NAME_RE already blocks every
// traversal character through the public API, so this guard's throw path is
// otherwise unreachable in practice — tested directly rather than left
// uncovered behind an ignore comment (see skill-version.ts's assertWithin).
export function assertWithin(target: string, base: string, label: string): void {
  const resolvedTarget = resolve(target);
  const resolvedBase = resolve(base);
  if (!resolvedTarget.startsWith(resolvedBase + sep)) {
    throw new Error(`Refused: ${label} escapes the expected directory`);
  }
}

function stateLabel(state: VerifyState): string {
  switch (state) {
    case 'verified':
      return chalk.green('verified');
    case 'mismatch':
      return chalk.red('mismatch');
    case 'not-verified':
      return chalk.yellow('not verified');
  }
}

export async function runVerify(skillName: string | undefined, options: VerifyOptions): Promise<void> {
  const skillsBase = options.global
    ? join(homedir(), '.goodboy', 'skills')
    : join(process.cwd(), '.claude', 'skills');
  const manifestDir = options.global ? join(homedir(), '.goodboy') : process.cwd();

  const namedOnly = skillName !== undefined;
  let names: string[];

  if (namedOnly) {
    if (!SKILL_NAME_RE.test(skillName)) {
      throw new Error(`Invalid skill name "${skillName}": must match ^[a-z0-9-]+$`);
    }
    names = [skillName];
  } else {
    const goodboy = await readGoodBoyJson(manifestDir);
    if (!goodboy) {
      logger.warn("No goodboy.json found. Run 'goodboy init' to initialise GoodBoy.");
      return;
    }
    names = Object.keys(goodboy.skills);
    if (names.length === 0) {
      logger.info('No skills listed in goodboy.json.');
      return;
    }
  }

  const rows: VerifyRow[] = [];
  for (const name of names) {
    if (!SKILL_NAME_RE.test(name)) {
      logger.warn(`Skipping invalid skill name in goodboy.json: "${name}"`);
      continue;
    }

    const installedDir = join(skillsBase, name);
    assertWithin(installedDir, skillsBase, 'skill path');

    if (!existsSync(installedDir)) {
      if (namedOnly) {
        throw new Error(`Skill "${name}" is not installed`);
      }
      logger.warn(`Skipping "${name}": not installed`);
      continue;
    }

    const lock = await readGoodBoyLock(manifestDir);
    const lockEntry = lock?.skills[name] ?? null;
    const state = await verifySkillIntegrity(installedDir, lockEntry);
    rows.push({ name, version: lockEntry?.version ?? null, state });
  }

  if (rows.length === 0) {
    logger.info('No installed skills to verify.');
    return;
  }

  const table = new Table({
    head: ['Skill', 'Version', 'State'].map((h) => chalk.bold(h)),
    style: { head: [], border: [] },
  });

  for (const row of rows) {
    table.push([row.name, row.version ?? '—', stateLabel(row.state)]);
  }

  process.stdout.write(table.toString() + '\n');

  if (rows.some((r) => r.state === 'mismatch')) {
    logger.error(
      'Integrity mismatch detected — one or more installed skills do not match their recorded hash.',
    );
    process.exitCode = 1;
  }
}

export const verifyCommand = new Command('verify')
  .description('Verify installed skills against their recorded content-integrity hash')
  .argument('[skill-name]', 'Verify only this skill')
  .option('-g, --global', 'Verify globally installed skills')
  .action(async (skillName: string | undefined, options: VerifyOptions) => {
    try {
      await runVerify(skillName, options);
    } catch (err) {
      logger.error(sanitiseError(err));
      process.exit(1);
    }
  });
