import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { Ajv } from 'ajv';
import * as addFormatsPkg from 'ajv-formats';
import { applyVersionPolicy, stripToKnownKeys } from './schema-version.js';
import { logger } from './logger.js';

const addFormats = (addFormatsPkg as unknown as { default: (ajv: Ajv) => Ajv }).default;
const _require = createRequire(import.meta.url);

export interface GoodBoyJson {
  schema: string;
  registry?: string;
  skills: Record<string, string>;
}

export interface GoodBoyLockEntry {
  version: string;
  integrity?: string;
}

export interface GoodBoyLock {
  schema: string;
  generated: string;
  skills: Record<string, GoodBoyLockEntry>;
}

const GOODBOY_JSON = 'goodboy.json';
const GOODBOY_LOCK = 'goodboy.lock';

/**
 * Read contract for the two goodboy documents, enforced here and nowhere else:
 *
 * - ENOENT returns null from both readers — callers depend on this (install
 *   into a fresh project; verify of a never-locked skill).
 * - goodboy.json is USER INTENT: anything unreadable is a hard error that
 *   names the file and the field. It is never silently discarded.
 * - goodboy.lock is MACHINE-GENERATED, disposable state: anything unreadable
 *   short of a newer-major declaration is a warning + null, so the next write
 *   regenerates it (verify degrades to not-verified, never false-verified).
 *   A newer-major lock is a hard error — an older CLI must not overwrite a
 *   newer tool's output. A same-major lock that fails strict validation
 *   (including every 0.2.0-era lock whose entries carry `resolved`) is
 *   regenerated wholesale on the next install/upgrade, losing entries that
 *   will be re-added when their skill is next installed.
 * - Version tolerance (newer-minor strip + warn, newer-major reject) is the
 *   shared policy from schema-version.ts; writes preserve the parsed `schema`
 *   value, so an older CLI never downgrades a newer document's declaration.
 * - Stripping is a VALIDATION-TIME concern only: the readers validate the
 *   stripped candidate and return the original document, so unknown top-level
 *   fields of a newer-minor file survive read-modify-write untouched. The
 *   tolerance is top-level only — a field added inside a nested object fails
 *   strict validation (goodboy.json: hard error; goodboy.lock: warn + absent).
 *
 * Each family versions independently; these are the versions this CLI knows.
 */
const KNOWN_GOODBOY_JSON_SCHEMA_VERSION = '1.0.0';
const KNOWN_GOODBOY_LOCK_SCHEMA_VERSION = '1.0.0';

type DocumentFamily = 'json' | 'lock';

interface Family {
  validator: ReturnType<Ajv['compile']>;
  knownKeys: Set<string>;
}

const families: Partial<Record<DocumentFamily, Family>> = {};

function getFamily(family: DocumentFamily): Family {
  const cached = families[family];
  if (cached) return cached;
  const schema = _require(
    `@goodboyjs/schema/src/goodboy-${family}.schema.json`,
  ) as Record<string, unknown>;
  const ajv = new Ajv({ strict: true, allErrors: true });
  addFormats(ajv);
  const loaded: Family = {
    validator: ajv.compile(schema),
    /* c8 ignore next -- the shipped schemas always have a root "properties" key; ?? fallback is unreachable. Fail-closed if ever violated: an empty Set would strip every field, and the validation tests would fail immediately. */
    knownKeys: new Set(Object.keys((schema['properties'] ?? {}) as Record<string, unknown>)),
  };
  families[family] = loaded;
  return loaded;
}

function majorLabel(knownVersion: string): string {
  return `${knownVersion.split('.')[0]!}.x`;
}

function throwValidationError(validate: ReturnType<Ajv['compile']>, file: string): never {
  /* c8 ignore next 2 -- ajv always populates errors[] after a failed validate(); ?? fallbacks are unreachable */
  const lines = (validate.errors ?? []).map(
    (e) => `  ${e.instancePath || '(root)'}: ${e.message ?? 'validation failed'}`,
  );
  throw new Error(`Invalid ${file}:\n${lines.join('\n')}`);
}

function firstValidationError(validate: ReturnType<Ajv['compile']>): string {
  /* c8 ignore start -- the call site only runs this after validate() returned false, when errors[] and message are always populated; the ?? / || fallbacks are unreachable */
  const first = validate.errors?.[0];
  const where = first?.instancePath || '(root)';
  const message = first?.message ?? 'validation failed';
  return `${where}: ${message}`;
  /* c8 ignore stop */
}

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

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`goodboy.json contains invalid JSON`);
  }

  const family = getFamily('json');
  const policy = applyVersionPolicy(parsed, 'schema', KNOWN_GOODBOY_JSON_SCHEMA_VERSION);

  if (policy.outcome === 'newer-major' || policy.outcome === 'older-major') {
    const upgradeHint =
      policy.outcome === 'newer-major' ? ' Upgrade GoodBoy to use this file.' : '';
    throw new Error(
      `goodboy.json declares schema ${policy.version}; this version of GoodBoy supports ${majorLabel(KNOWN_GOODBOY_JSON_SCHEMA_VERSION)}.${upgradeHint}`,
    );
  }

  let candidate = parsed;
  if (policy.outcome === 'newer-minor') {
    candidate = stripToKnownKeys(parsed as Record<string, unknown>, family.knownKeys);
    logger.warn(
      `goodboy.json uses schema ${policy.version}; this GoodBoy CLI knows ${KNOWN_GOODBOY_JSON_SCHEMA_VERSION}. Unknown fields were ignored — upgrade GoodBoy to use them.`,
    );
  }

  // Validate the stripped candidate; return the ORIGINAL document so unknown
  // top-level fields survive read-modify-write untouched (see header note).
  if (!family.validator(candidate)) throwValidationError(family.validator, 'goodboy.json');
  return parsed as GoodBoyJson;
}

export async function writeGoodBoyJson(dir: string, data: GoodBoyJson): Promise<void> {
  const filePath = join(safeDir(dir), GOODBOY_JSON);
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export async function readGoodBoyLock(dir: string): Promise<GoodBoyLock | null> {
  const filePath = join(safeDir(dir), GOODBOY_LOCK);

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn(
      `goodboy.lock contains invalid JSON — treating it as absent; it will be regenerated on the next install or upgrade.`,
    );
    return null;
  }

  const family = getFamily('lock');
  const policy = applyVersionPolicy(parsed, 'schema', KNOWN_GOODBOY_LOCK_SCHEMA_VERSION);

  if (policy.outcome === 'newer-major') {
    throw new Error(
      `goodboy.lock declares schema ${policy.version}; this version of GoodBoy supports ${majorLabel(KNOWN_GOODBOY_LOCK_SCHEMA_VERSION)}. Upgrade GoodBoy to use this lock.`,
    );
  }

  if (policy.outcome === 'older-major') {
    logger.warn(
      `goodboy.lock declares schema ${policy.version}; this version of GoodBoy supports ${majorLabel(KNOWN_GOODBOY_LOCK_SCHEMA_VERSION)}. Treating it as absent — it will be regenerated on the next install or upgrade.`,
    );
    return null;
  }

  let candidate = parsed;
  if (policy.outcome === 'newer-minor') {
    candidate = stripToKnownKeys(parsed as Record<string, unknown>, family.knownKeys);
    logger.warn(
      `goodboy.lock uses schema ${policy.version}; this GoodBoy CLI knows ${KNOWN_GOODBOY_LOCK_SCHEMA_VERSION}. Unknown fields were ignored — upgrade GoodBoy to use them.`,
    );
  }

  // Validate the stripped candidate; return the ORIGINAL document so unknown
  // top-level fields survive read-modify-write untouched (see header note).
  if (!family.validator(candidate)) {
    logger.warn(
      `goodboy.lock could not be validated (${firstValidationError(family.validator)}); treating it as absent — it will be regenerated on the next install or upgrade.`,
    );
    return null;
  }
  return parsed as GoodBoyLock;
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
