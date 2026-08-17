/**
 * Internal module — command files should prefer RegistryAdapter via
 * createRegistryAdapter() for the reads it covers (listing, resolution).
 * Two deliberate direct-use exceptions, both because the adapter has no
 * equivalent: writeSkillVersionToRegistry (no write method — `add` and
 * `adopt` share this one write path, see docs/decisions.md, 2026-08-17),
 * and a by-name registry-entry read (no read-by-name; the adapter offers
 * only listRegistry()), which is how `adopt` checks whether a skill is
 * already registered.
 * @internal
 */
import { existsSync, mkdirSync, cpSync, readdirSync } from 'node:fs';
import { join, resolve, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { readManifest, validateManifest, writeManifest } from './manifest.js';
import { SEMVER_VERSION_PATTERN } from './schema-version.js';
import {
  readRegistryEntry,
  writeRegistryEntry,
  createRegistryEntry,
  addVersionToEntry,
  resolveLatestVersion,
  resolveVersionPath,
} from './registry-entry.js';
import type { RegistryEntry } from './registry-entry.js';
import { logger } from './logger.js';
import { SKILL_NAME_RE } from './validation.js';
import type { GoodBoyManifest } from '../types/index.js';

export function getRegistryPath(): string {
  const env = process.env['GOODBOY_REGISTRY'];

  if (env !== undefined && env.length > 0) {
    // Reject traversal sequences before any filesystem call
    if (env.includes('..')) {
      throw new Error(`GOODBOY_REGISTRY must not contain path traversal sequences`);
    }
    if (!isAbsolute(env)) {
      throw new Error(`GOODBOY_REGISTRY must be an absolute path`);
    }
    if (!existsSync(env)) {
      logger.warn(`GOODBOY_REGISTRY path does not exist: "${env}". Falling back to default.`);
      return join(homedir(), '.goodboy', 'registry');
    }
    return resolve(env);
  }

  return join(homedir(), '.goodboy', 'registry');
}

export function getSkillsPath(): string {
  return join(homedir(), '.goodboy', 'skills');
}

export function ensureRegistryExists(): void {
  const registryPath = getRegistryPath();
  if (!existsSync(registryPath)) {
    mkdirSync(registryPath, { recursive: true, mode: 0o700 });
  }
}

export interface WriteSkillVersionResult {
  skillRegistryDir: string;
  versionAbsPath: string;
  overwritten: boolean;
}

/**
 * Shared by `add` and `adopt`: writes one version of a skill into the local
 * registry. The manifest is passed in, never re-read from disk — that is the
 * seam that lets adopt write a synthesized in-memory manifest. When
 * `manifestToWrite` is set, the manifest is written into the copied tree
 * (adopt: the source has none); when absent, the copied tree's own
 * manifest.json is left byte-identical (add).
 *
 * This function is the security boundary of the exported write API, not the
 * callers: `manifest.name` is validated against SKILL_NAME_RE and
 * `manifest.version` against SEMVER_VERSION_PATTERN before any filesystem
 * call (ensureRegistryExists included), and the resolved version path is
 * asserted to stay inside the registry root. Callers may pre-validate for
 * better messages, but must not rely on having done so. A colliding version
 * throws unless `force` is set; `overwritten` reports it so the caller can
 * surface it in its own words. A version directory on disk with no entry
 * for it (what a failed write leaves behind) is refused rather than merged
 * over, again unless `force` is set. `mustBeNew` refuses any pre-existing
 * entry regardless of version — adopt's write-time backstop against an
 * entry appearing between its pre-check and the write.
 */
export async function writeSkillVersionToRegistry(opts: {
  sourceDir: string;
  manifest: GoodBoyManifest;
  force?: boolean;
  manifestToWrite?: boolean;
  mustBeNew?: boolean;
}): Promise<WriteSkillVersionResult> {
  // The two manifest fields that become filesystem paths are validated here
  // before anything touches disk — security-sensitive.json: "All resolved
  // paths are checked with startsWith(base + sep) before use".
  if (!SKILL_NAME_RE.test(opts.manifest.name)) {
    throw new Error(
      `Invalid skill name "${opts.manifest.name}": must match ^[a-z0-9-]+$`,
    );
  }
  if (!SEMVER_VERSION_PATTERN.test(opts.manifest.version)) {
    throw new Error(
      `Invalid version "${opts.manifest.version}": must match ^\\d+\\.\\d+\\.\\d+$`,
    );
  }

  ensureRegistryExists();
  const registryPath = getRegistryPath();
  const skillRegistryDir = join(registryPath, opts.manifest.name);
  const versionRelPath = join('versions', opts.manifest.version);
  const versionAbsPath = join(skillRegistryDir, versionRelPath);

  // Traversal guard, mirroring resolveSkill()'s: the resolved version path
  // must stay inside the registry root. The name/version checks above
  // already block every traversal character, so this is unreachable —
  // defense-in-depth for the exported API.
  const expectedPrefix = registryPath + sep;

  /* c8 ignore next 3 — defense-in-depth: SKILL_NAME_RE + SEMVER_VERSION_PATTERN above block all traversal chars, this is unreachable through the exported API */
  if (!versionAbsPath.startsWith(expectedPrefix) || !resolve(versionAbsPath).startsWith(expectedPrefix)) {
    throw new Error(`Refused: resolved skill path escapes the registry directory`);
  }

  const existingEntry = await readRegistryEntry(skillRegistryDir);

  if (opts.mustBeNew && existingEntry) {
    throw new Error(
      `Skill "${opts.manifest.name}" is already in the local registry — adopt only registers skills the registry does not know yet. Use 'goodboy skill version' to add a new version.`,
    );
  }

  const overwritten = existingEntry?.versions[opts.manifest.version] !== undefined;

  if (overwritten && !opts.force) {
    throw new Error(
      `Version "${opts.manifest.version}" of skill "${opts.manifest.name}" already exists. Use --force to overwrite.`,
    );
  }

  // Orphaned state: the version directory exists on disk but the entry does
  // not list it — exactly what a failed write leaves behind (copy
  // succeeded, manifest/entry write did not). Refuse to silently merge over
  // it; force is add's deliberate escape hatch.
  if (existsSync(versionAbsPath) && !overwritten && !opts.force) {
    throw new Error(
      `Version "${opts.manifest.version}" of skill "${opts.manifest.name}" exists on disk but has no registry entry — a previous write may have failed partway. Use --force to replace it.`,
    );
  }

  mkdirSync(versionAbsPath, { recursive: true, mode: 0o700 });
  cpSync(opts.sourceDir, versionAbsPath, { recursive: true });

  if (opts.manifestToWrite) {
    await writeManifest(join(versionAbsPath, 'manifest.json'), opts.manifest);
  }

  const entry = existingEntry
    ? addVersionToEntry(existingEntry, opts.manifest.version, versionRelPath)
    : createRegistryEntry(opts.manifest.name, opts.manifest.version, versionRelPath);

  await writeRegistryEntry(skillRegistryDir, entry);

  return { skillRegistryDir, versionAbsPath, overwritten };
}

export async function resolveSkill(name: string, version?: string): Promise<string> {
  // Normalize to detect URL-encoded traversal (e.g. ..%2F) and null bytes
  // before any filesystem operation.
  const nullStripped = name.replace(/\0/g, '');
  let decoded: string;
  try {
    decoded = decodeURIComponent(nullStripped);
  } catch {
    decoded = nullStripped;
  }
  const normalized = decoded.trim();

  if (normalized !== name) {
    throw new Error(`Skill name contains invalid characters`);
  }

  if (!SKILL_NAME_RE.test(name)) {
    throw new Error(`Invalid skill name "${name}": must match ^[a-z0-9-]+$`);
  }

  const registryPath = getRegistryPath();
  const skillDir = resolve(join(registryPath, name));

  // Traversal guard: resolved path must be directly inside the registry dir.
  const expectedPrefix = registryPath + sep;

  /* c8 ignore next 3 — defense-in-depth: SKILL_NAME_RE blocks all traversal chars, this is unreachable through the public API */
  if (!skillDir.startsWith(expectedPrefix) || !resolve(skillDir).startsWith(expectedPrefix)) {
    throw new Error(`Refused: resolved skill path escapes the registry directory`);
  }

  const entry = await readRegistryEntry(skillDir);
  if (!entry) {
    throw new Error(`Skill "${name}" not found in registry`);
  }

  const resolvedVersion = version ?? resolveLatestVersion(entry);
  if (!resolvedVersion) {
    throw new Error(`Skill "${name}" has no available versions`);
  }

  return resolveVersionPath(entry, resolvedVersion, skillDir);
}

export async function listRegistry(): Promise<RegistryEntry[]> {
  const registryPath = getRegistryPath();

  if (!existsSync(registryPath)) return [];

  const dirEntries = readdirSync(registryPath, { withFileTypes: true });
  const results: RegistryEntry[] = [];

  for (const dirEntry of dirEntries) {
    if (!dirEntry.isDirectory()) continue;
    const skillDir = join(registryPath, dirEntry.name);
    const entry = await readRegistryEntry(skillDir);
    if (entry) results.push(entry);
  }

  return results;
}

export async function listInstalled(): Promise<GoodBoyManifest[]> {
  const skillsPath = getSkillsPath();

  if (!existsSync(skillsPath)) {
    // 0o700: skills are user-private, no group/world read
    mkdirSync(skillsPath, { recursive: true, mode: 0o700 });
    return [];
  }

  const entries = readdirSync(skillsPath, { withFileTypes: true });
  const manifests: GoodBoyManifest[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const manifestPath = join(skillsPath, entry.name, 'manifest.json');

    try {
      const data = await readManifest(manifestPath);
      manifests.push(validateManifest(data));
    } catch (err) {
      logger.warn(
        `Skipping "${entry.name}": ${err instanceof Error ? err.message : 'invalid manifest'}`,
      );
    }
  }

  return manifests;
}
