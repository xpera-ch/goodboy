import { Command } from 'commander';
import { cp } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import ora from 'ora';
import { getRegistryPath } from '../lib/registry.js';
import {
  readRegistryEntry,
  writeRegistryEntry,
  resolveLatestVersion,
  resolveVersionPath,
  addVersionToEntry,
} from '../lib/registry-entry.js';
import {
  readManifest,
  writeManifest,
  validateManifestDetailed,
  FIELD_INTRODUCED_IN,
  KNOWN_SCHEMA_VERSION,
} from '../lib/manifest.js';
import { SKILL_NAME_RE } from '../lib/validation.js';
import { logger, sanitiseError } from '../lib/logger.js';

const BUMP_LEVELS = ['patch', 'minor', 'major'] as const;
type BumpLevel = (typeof BUMP_LEVELS)[number];

interface SkillVersionOptions {
  bump?: string;
}

export function bumpVersion(version: string, level: BumpLevel): string {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map((n) => parseInt(n, 10));

  switch (level) {
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'major': return `${major + 1}.0.0`;
  }
}

function assertWithin(target: string, base: string, label: string): void {
  const resolvedTarget = resolve(target);
  const resolvedBase = resolve(base);
  if (!resolvedTarget.startsWith(resolvedBase + sep)) {
    throw new Error(`Refused: ${label} escapes the expected directory`);
  }
}

async function showVersionInfo(skillName: string): Promise<void> {
  const registryPath = getRegistryPath();
  const skillDir = join(registryPath, skillName);
  assertWithin(skillDir, registryPath, 'skill path');

  const entry = await readRegistryEntry(skillDir);
  if (!entry) {
    throw new Error(`Skill "${skillName}" not found in registry`);
  }

  const versions = Object.keys(entry.versions).sort((a, b) => {
    const [aMaj = 0, aMin = 0, aPat = 0] = a.split('.').map(Number);
    const [bMaj = 0, bMin = 0, bPat = 0] = b.split('.').map(Number);
    return bMaj - aMaj || bMin - aMin || bPat - aPat;
  });

  logger.info(`Registry: ${registryPath}`);
  logger.info('');
  logger.info(`${skillName} versions:`);
  logger.info('');

  for (const version of versions) {
    const v = entry.versions[version]!;
    const tag = version === entry.latest ? ' (latest)' : '';
    const yanked = v.yanked ? ' [yanked]' : '';
    const added = new Date(v.addedAt).toLocaleDateString();
    logger.info(`  ${version}${tag}${yanked}  —  added ${added}`);
  }

  logger.info('');
  logger.info(`To create a new version: goodboy skill version ${skillName} --bump patch`);
}

async function createNewVersion(skillName: string, bump: string): Promise<void> {
  if (!(BUMP_LEVELS as readonly string[]).includes(bump)) {
    throw new Error(`Invalid bump level "${bump}": must be one of ${BUMP_LEVELS.join(', ')}`);
  }
  const level = bump as BumpLevel;

  const registryPath = getRegistryPath();
  const skillDir = join(registryPath, skillName);
  assertWithin(skillDir, registryPath, 'skill path');

  const entry = await readRegistryEntry(skillDir);
  if (!entry) {
    throw new Error(`Skill "${skillName}" not found in registry`);
  }

  const currentLatest = resolveLatestVersion(entry);
  if (!currentLatest) {
    throw new Error('No installable version found (all versions are yanked)');
  }

  const newVersion = bumpVersion(currentLatest, level);

  if (entry.versions[newVersion]) {
    throw new Error(
      `Version ${newVersion} already exists in registry. ` +
        `The registry uses immutable versions — existing versions cannot be replaced.`,
    );
  }

  const sourceVersionDir = resolveVersionPath(entry, currentLatest, skillDir);
  const newVersionDir = join(skillDir, 'versions', newVersion);
  assertWithin(newVersionDir, skillDir, 'new version path');

  const spinner = ora(`Creating ${skillName}@${newVersion}...`).start();

  try {
    await cp(sourceVersionDir, newVersionDir, { recursive: true });

    const manifestPath = join(newVersionDir, 'manifest.json');
    const rawManifest = await readManifest(manifestPath);
    const { manifest, warnings } = validateManifestDetailed(rawManifest);

    // Refuse rather than persist a lossy write. S1's tolerant path returns a
    // manifest with unknown top-level fields already stripped and the warning
    // about it discarded by the thin validateManifest() wrapper — "stripped
    // fields are invisible downstream" is a safe guarantee for read-only
    // consumers (list, skill-status, ...), but this is the one path that
    // WRITES a validated manifest back to disk. Persisting the stripped
    // object here would silently delete fields a newer-minor manifest
    // declared and silently downgrade its schema_version, with no warning
    // ever surfaced to the author. Fail closed instead: require a real
    // GoodBoy upgrade before this skill can be bumped.
    if (warnings.length > 0) {
      throw new Error(
        `${skillName}/manifest.json declares schema_version ${manifest.schema_version}, which is newer than ` +
          `this GoodBoy CLI knows (${KNOWN_SCHEMA_VERSION}). Upgrade GoodBoy to bump this skill — bumping now ` +
          `would discard fields this version does not understand.`,
      );
    }

    manifest.version = newVersion;
    // Stamp the lowest schema version this manifest actually needs. This only
    // ever runs on a manifest that already validated strictly (no warnings,
    // checked above) — it normalizes an already-valid, possibly over-stamped
    // manifest down to its minimum (e.g. requires present but stamped higher
    // than 1.1.0 -> 1.1.0; requires absent -> 1.0.0). It does NOT rescue an
    // under-stamped, invalid manifest (schema_version below what a field it
    // uses requires) — that already failed earlier, in manifest.ts's own
    // feature-stamping gate, before this function was ever called; fixing it
    // requires a manual schema_version edit, by design.
    manifest.schema_version = manifest.requires ? FIELD_INTRODUCED_IN['requires']! : '1.0.0';
    await writeManifest(manifestPath, manifest);

    const updatedEntry = addVersionToEntry(entry, newVersion, join('versions', newVersion));
    await writeRegistryEntry(skillDir, updatedEntry);

    spinner.succeed();
  } catch (err) {
    spinner.fail();
    throw err;
  }

  logger.success(`Created ${skillName}@${newVersion} from ${currentLatest}`);
  logger.info('');
  logger.info(`Edit:    goodboy skill open ${skillName}`);
  logger.info(`Install: goodboy upgrade ${skillName}`);
}

export function registerSkillVersion(program: Command): void {
  program
    .command('version <skill-name>')
    .description('Show version info or create a new version of a registry skill')
    .option('--bump <level>', 'Create a new version: patch | minor | major')
    .action(async (skillName: string, options: SkillVersionOptions) => {
      try {
        if (!SKILL_NAME_RE.test(skillName)) {
          throw new Error(`Invalid skill name "${skillName}": must match ^[a-z0-9-]+$`);
        }

        if (options.bump) {
          await createNewVersion(skillName, options.bump);
        } else {
          await showVersionInfo(skillName);
        }
      } catch (err) {
        logger.error(sanitiseError(err));
        process.exit(1);
      }
    });
}
