/**
 * Global skill store: ~/.goodboy/skills/<skill-name>/
 * Skills are stored here once and symlinked into agent directories.
 * @internal
 */
import { existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join, sep } from 'node:path';
import { homedir } from 'node:os';
import { scanForSymlinks } from './fs-security.js';
import { SKILL_NAME_RE } from './validation.js';

export function getStorePath(): string {
  return join(homedir(), '.goodboy', 'skills');
}

export function ensureStoreExists(): void {
  const storePath = getStorePath();
  if (!existsSync(storePath)) {
    mkdirSync(storePath, { recursive: true, mode: 0o700 });
  }
}

function assertValidSkillName(skillName: string): void {
  if (!SKILL_NAME_RE.test(skillName)) {
    throw new Error(
      `Invalid skill name: "${skillName}". Must match ^[a-z0-9-]+$.`,
    );
  }
}

function assertWithinStore(target: string): void {
  const storePath = getStorePath();
  /* c8 ignore next 3 */
  if (!target.startsWith(storePath + sep) && target !== storePath) {
    throw new Error(`Refused: path escapes the store directory`);
  }
}

/**
 * Copy a skill from `sourcePath` into the store.
 * Returns the absolute path of the installed store entry.
 */
export async function installToStore(
  skillName: string,
  sourcePath: string,
): Promise<string> {
  assertValidSkillName(skillName);

  const storePath = getStorePath();
  const dest = join(storePath, skillName);

  assertWithinStore(dest);

  await scanForSymlinks(sourcePath);

  ensureStoreExists();
  mkdirSync(dest, { recursive: true, mode: 0o700 });
  cpSync(sourcePath, dest, { recursive: true });

  return dest;
}

/**
 * Remove a skill from the store.
 * No-op if the skill is not present.
 */
export function removeFromStore(skillName: string): void {
  assertValidSkillName(skillName);

  const storePath = getStorePath();
  const dest = join(storePath, skillName);

  assertWithinStore(dest);

  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }
}
