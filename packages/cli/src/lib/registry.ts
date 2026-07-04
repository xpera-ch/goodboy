/**
 * Internal module — do not import directly from command files.
 * Use RegistryAdapter via createRegistryAdapter() instead.
 * @internal
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { readManifest, validateManifest } from './manifest.js';
import {
  readRegistryEntry,
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
