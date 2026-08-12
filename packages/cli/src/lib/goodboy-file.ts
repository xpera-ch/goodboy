import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';

export interface GoodBoyJson {
  schema: '1.0.0';
  registry?: string;
  skills: Record<string, string>;
}

export interface GoodBoyLockEntry {
  version: string;
  integrity?: string;
}

export interface GoodBoyLock {
  schema: '1.0.0';
  generated: string;
  skills: Record<string, GoodBoyLockEntry>;
}

const GOODBOY_JSON = 'goodboy.json';
const GOODBOY_LOCK = 'goodboy.lock';

function safeDir(dir: string): string {
  const resolved = resolve(dir);
  /* c8 ignore next 3 */
  if (!isAbsolute(resolved)) {
    throw new Error(`Invalid directory path: "${dir}"`);
  }
  return resolved;
}

export async function readGoodBoyJson(dir: string): Promise<GoodBoyJson | null> {
  const filePath = join(safeDir(dir), GOODBOY_JSON);
  try {
    const raw = await readFile(filePath, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`goodboy.json contains invalid JSON`);
    }
    const data = parsed as Record<string, unknown>;
    if (data['schema'] !== '1.0.0') {
      throw new Error(`goodboy.json has unsupported schema version: "${String(data['schema'])}"`);
    }
    return data as unknown as GoodBoyJson;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeGoodBoyJson(dir: string, data: GoodBoyJson): Promise<void> {
  const filePath = join(safeDir(dir), GOODBOY_JSON);
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export async function readGoodBoyLock(dir: string): Promise<GoodBoyLock | null> {
  const filePath = join(safeDir(dir), GOODBOY_LOCK);
  try {
    const raw = await readFile(filePath, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`goodboy.lock contains invalid JSON`);
    }
    return parsed as GoodBoyLock;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeGoodBoyLock(dir: string, data: GoodBoyLock): Promise<void> {
  const filePath = join(safeDir(dir), GOODBOY_LOCK);
  const updated: GoodBoyLock = { ...data, generated: new Date().toISOString() };
  await writeFile(filePath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
}

export async function addSkillToManifest(
  dir: string,
  skillName: string,
  version: string,
): Promise<void> {
  const existing = await readGoodBoyJson(dir);
  const manifest: GoodBoyJson = existing ?? { schema: '1.0.0', skills: {} };
  manifest.skills[skillName] = `^${version}`;
  await writeGoodBoyJson(dir, manifest);
}

export async function addSkillToLock(
  dir: string,
  skillName: string,
  version: string,
  integrity: string,
): Promise<void> {
  const existing = await readGoodBoyLock(dir);
  const lock: GoodBoyLock = existing ?? {
    schema: '1.0.0',
    generated: new Date().toISOString(),
    skills: {},
  };
  lock.skills[skillName] = { version, integrity };
  await writeGoodBoyLock(dir, lock);
}

export async function removeSkillFromManifest(dir: string, skillName: string): Promise<void> {
  const existing = await readGoodBoyJson(dir);
  if (!existing) return;
  delete existing.skills[skillName];
  await writeGoodBoyJson(dir, existing);
}

export async function removeSkillFromLock(dir: string, skillName: string): Promise<void> {
  const existing = await readGoodBoyLock(dir);
  if (!existing) return;
  delete existing.skills[skillName];
  await writeGoodBoyLock(dir, existing);
}

export async function getLockedVersion(
  dir: string,
  skillName: string,
): Promise<string | null> {
  const lock = await readGoodBoyLock(dir);
  if (!lock) return null;
  return lock.skills[skillName]?.version ?? null;
}
