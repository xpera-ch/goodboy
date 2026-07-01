/**
 * Internal module — do not import directly from command files.
 * Use RegistryAdapter via createRegistryAdapter() instead.
 * @internal
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { readdir, readlink } from 'node:fs/promises';
import { join, resolve, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { readManifest, validateManifest } from './manifest.js';
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
      throw new Error(`GOODBOY_REGISTRY path does not exist: "${env}"`);
    }
    return resolve(env);
  }

  return join(homedir(), '.goodboy', 'registry');
}

export function getSkillsPath(): string {
  return join(homedir(), '.goodboy', 'skills');
}

export async function resolveSkill(name: string): Promise<string> {
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
  const skillPath = resolve(join(registryPath, name));

  // Traversal guard: resolved path must be directly inside the registry dir.
  // resolve() always strips trailing separators, so we always append sep.
  const expectedPrefix = registryPath + sep;

  /* c8 ignore next 3 — defense-in-depth: SKILL_NAME_RE blocks all traversal chars, this is unreachable through the public API */
  if (!skillPath.startsWith(expectedPrefix) || !resolve(skillPath).startsWith(expectedPrefix)) {
    throw new Error(`Refused: resolved skill path escapes the registry directory`);
  }

  if (!existsSync(skillPath)) {
    throw new Error(`Skill "${name}" not found in registry`);
  }

  return skillPath;
}

/**
 * Recursively scan `dirPath` for symlinks that point outside `dirPath`.
 * Symlinks whose resolved target starts with `dirPath + sep` are permitted
 * (internal cross-references within the skill). All other symlinks abort
 * with a security error so a malicious skill cannot use them to escape the
 * skill sandbox during copy.
 */
export async function scanForSymlinks(dirPath: string): Promise<void> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isSymbolicLink()) {
      const linkTarget = await readlink(fullPath);
      const resolvedTarget = resolve(dirPath, linkTarget);
      if (!resolvedTarget.startsWith(dirPath + sep) && resolvedTarget !== dirPath) {
        throw new Error(
          `Security: skill contains a symlink pointing outside its directory: ` +
            `${fullPath} → ${resolvedTarget}. Installation aborted.`,
        );
      }
      // Symlink points inside the skill directory — permitted
    } else if (entry.isDirectory()) {
      await scanForSymlinks(fullPath);
    }
  }
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
