import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import Table from 'cli-table3';
import chalk from 'chalk';
import { readGoodBoyJson, getLockedVersion, readGoodBoyLock } from '../lib/goodboy-file.js';
import { getRegistryPath } from '../lib/registry.js';
import { readRegistryEntry, resolveLatestVersion } from '../lib/registry-entry.js';
import { readManifest, validateManifest } from '../lib/manifest.js';
import { verifySkillIntegrity } from '../lib/verify.js';
import { SKILL_NAME_RE } from '../lib/validation.js';
import { logger, sanitiseError } from '../lib/logger.js';

interface SkillStatusOptions {
  global?: boolean;
}

type State = 'not installed' | 'upgrade available' | 'modified' | 'not verified' | 'up to date';

interface SkillStatusRow {
  name: string;
  installedVersion: string | null;
  registryLatest: string | null;
  lockedVersion: string | null;
  state: State;
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

function stateColor(state: State): string {
  switch (state) {
    case 'up to date':        return chalk.green(state);
    case 'upgrade available': return chalk.cyan(state);
    case 'modified':          return chalk.yellow(state);
    case 'not verified':      return chalk.gray(state);
    case 'not installed':     return chalk.red(state);
  }
}

async function getInstalledVersion(skillsBase: string, skillName: string): Promise<string | null> {
  const manifestPath = join(skillsBase, skillName, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    const raw = await readManifest(manifestPath);
    const manifest = validateManifest(raw);
    return manifest.version;
  } catch {
    return null;
  }
}

async function computeRow(
  skillName: string,
  skillsBase: string,
  manifestDir: string,
): Promise<SkillStatusRow> {
  const installedVersion = await getInstalledVersion(skillsBase, skillName);
  const lockedVersion = await getLockedVersion(manifestDir, skillName);

  const registryPath = getRegistryPath();
  const skillDir = join(registryPath, skillName);
  const entry = await readRegistryEntry(skillDir);
  const registryLatest = entry ? resolveLatestVersion(entry) : null;

  let state: State;
  if (installedVersion === null) {
    state = 'not installed';
  } else if (registryLatest !== null && installedVersion !== registryLatest) {
    state = 'upgrade available';
  } else {
    const installedDir = join(skillsBase, skillName);
    const lock = await readGoodBoyLock(manifestDir);
    const lockEntry = lock?.skills[skillName] ?? null;
    const verifyState = await verifySkillIntegrity(installedDir, lockEntry);
    if (verifyState === 'mismatch') {
      state = 'modified';
    } else if (verifyState === 'not-verified') {
      state = 'not verified';
    } else {
      state = 'up to date';
    }
  }

  return { name: skillName, installedVersion, registryLatest, lockedVersion, state };
}

async function run(options: SkillStatusOptions): Promise<void> {
  const skillsBase = options.global
    ? join(homedir(), '.goodboy', 'skills')
    : join(process.cwd(), '.claude', 'skills');
  const manifestDir = options.global ? join(homedir(), '.goodboy') : process.cwd();

  const goodboy = await readGoodBoyJson(manifestDir);
  if (!goodboy) {
    logger.warn("No goodboy.json found. Run 'goodboy init' to initialise GoodBoy.");
    return;
  }

  const skillNames = Object.keys(goodboy.skills);
  if (skillNames.length === 0) {
    logger.info('No skills listed in goodboy.json.');
    return;
  }

  const rows: SkillStatusRow[] = [];
  for (const name of skillNames) {
    if (!SKILL_NAME_RE.test(name)) {
      logger.warn(`Skipping invalid skill name in goodboy.json: "${name}"`);
      continue;
    }
    const skillDir = join(skillsBase, name);
    assertWithin(skillDir, skillsBase, 'skill path');
    rows.push(await computeRow(name, skillsBase, manifestDir));
  }

  const table = new Table({
    head: ['Skill', 'Installed', 'Registry', 'Locked', 'State'].map((h) => chalk.bold(h)),
    style: { head: [], border: [] },
  });

  for (const row of rows) {
    table.push([
      row.name,
      row.installedVersion ?? '—',
      row.registryLatest ?? '—',
      row.lockedVersion ?? '—',
      stateColor(row.state),
    ]);
  }

  process.stdout.write(table.toString() + '\n');

  if (rows.some((r) => r.state === 'modified')) {
    logger.warn("\n⚠  Modified skills will lose changes on 'goodboy upgrade'.");
    logger.info("Run 'goodboy skill diff <name>' to see what changed.");
  }
  if (rows.some((r) => r.state === 'upgrade available')) {
    logger.info("\nRun 'goodboy upgrade' to install latest versions.");
  }
}

export function registerSkillStatus(program: Command): void {
  program
    .command('status')
    .description('Show installed skills with version and drift state')
    .option('-g, --global', 'Show global skills status')
    .action(async (options: SkillStatusOptions) => {
      try {
        await run(options);
      } catch (err) {
        logger.error(sanitiseError(err));
        process.exit(1);
      }
    });
}
