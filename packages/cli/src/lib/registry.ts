import { existsSync, mkdirSync, readdirSync } from 'node:fs';
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
  // Validate name before any filesystem operation
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error(`Invalid skill name "${name}": must match ^[a-z0-9-]+$`);
  }

  const registryPath = getRegistryPath();
  const skillPath = resolve(join(registryPath, name));

  // Traversal guard: resolved path must be directly inside the registry dir
  const expectedPrefix = registryPath.endsWith(sep)
    ? registryPath
    : registryPath + sep;

  if (!skillPath.startsWith(expectedPrefix)) {
    throw new Error(`Refused: resolved skill path escapes the registry directory`);
  }

  if (!existsSync(skillPath)) {
    throw new Error(`Skill "${name}" not found in registry`);
  }

  return skillPath;
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
