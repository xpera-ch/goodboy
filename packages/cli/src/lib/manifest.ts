import { createRequire } from 'node:module';
import { statSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ajv } from 'ajv';
import * as addFormatsPkg from 'ajv-formats';
import type { GoodBoyManifest } from '../types/index.js';

const addFormats = (addFormatsPkg as unknown as { default: (ajv: Ajv) => Ajv }).default;
const _require = createRequire(import.meta.url);

const MAX_MANIFEST_BYTES = 512 * 1024; // 512 KB
const MAX_NESTING_DEPTH = 10;

/**
 * The manifest schema version this CLI validates strictly against. Manifests
 * declaring a newer minor are tolerated (unknown top-level fields stripped,
 * with a warning); a newer major is rejected. See validateManifestDetailed().
 */
export const KNOWN_SCHEMA_VERSION = '1.1.0';

// Feature-driven stamping: a top-level field may only be used by a manifest
// that declares a schema_version at or above the version that introduced it.
// Without this, a manifest stamped e.g. "1.0.0" that uses a field only the
// known schema (now on a later minor) recognizes would validate successfully
// under Ajv — but an older, tolerant CLI that has never heard of the field
// would reject it with a confusing additionalProperties error. Enforced here,
// in code, because remediation text like this needs to name the exact field
// and the exact version to stamp — not something Ajv's own error shapes give us.
export const FIELD_INTRODUCED_IN: Record<string, string> = {
  requires: '1.1.0',
};

const SCHEMA_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

let _schema: Record<string, unknown> | null = null;
let _validator: ReturnType<Ajv['compile']> | null = null;

function getSchema(): Record<string, unknown> {
  if (_schema) return _schema;
  _schema = _require('@goodboyjs/schema/src/manifest.schema.json') as Record<string, unknown>;
  return _schema;
}

function getValidator(): ReturnType<Ajv['compile']> {
  if (_validator) return _validator;
  const ajv = new Ajv({ strict: true, allErrors: true });
  addFormats(ajv);
  _validator = ajv.compile(getSchema());
  return _validator;
}

// Top-level property names the known schema recognizes. Used only to strip
// unknown top-level fields from a newer-minor manifest before strict
// validation — never to loosen validation of known fields.
function getKnownTopLevelKeys(): Set<string> {
  /* c8 ignore next -- the shipped schema always has a root "properties" key; ?? fallback is unreachable. Fail-closed if ever violated: an empty Set would strip every field, and every existing manifest test would fail immediately. */
  const properties = (getSchema()['properties'] ?? {}) as Record<string, unknown>;
  return new Set(Object.keys(properties));
}

function throwValidationError(validate: ReturnType<Ajv['compile']>): never {
  /* c8 ignore next 2 -- ajv always populates errors[] after a failed validate(); ?? fallbacks are unreachable */
  const lines = (validate.errors ?? []).map(
    (e) => `  ${e.instancePath || '(root)'}: ${e.message ?? 'validation failed'}`,
  );
  throw new Error(`Invalid manifest:\n${lines.join('\n')}`);
}

function parseSemverTriple(version: string): [number, number, number] | null {
  const match = SCHEMA_VERSION_PATTERN.exec(version);
  /* c8 ignore next -- both call sites only ever pass an already-valid version string; null is a defensive return, not a reachable case */
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isVersionAtLeast(declared: [number, number, number], required: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (declared[i]! !== required[i]!) return declared[i]! > required[i]!;
  }
  return true;
}

// Runs after a manifest has already passed Ajv validation (so schema_version
// is guaranteed to match the schema's own pattern). Rejects a manifest that
// uses a field its declared schema_version predates.
function assertFeatureStamping(manifest: GoodBoyManifest): void {
  const declared = parseSemverTriple(manifest.schema_version);
  /* c8 ignore next -- schema_version already satisfied Ajv's own pattern check by this point, so it always parses */
  if (!declared) return;
  for (const key of Object.keys(manifest)) {
    const introducedIn = FIELD_INTRODUCED_IN[key];
    if (!introducedIn) continue;
    const required = parseSemverTriple(introducedIn)!;
    if (!isVersionAtLeast(declared, required)) {
      throw new Error(
        `manifest declares schema_version ${manifest.schema_version} but uses "${key}", which needs ${introducedIn}.\n` +
          `Set "schema_version": "${introducedIn}" in manifest.json.`,
      );
    }
  }
}

// Hard-error consistency rule (concept doc §7.1): requires.secrets is only
// ever visible to a skill-installing user via the "env" permission on a
// tolerant older CLI that doesn't know about `requires` at all — so the two
// fields must never disagree. Fail closed rather than silently trusting one.
function assertPermissionsConsistency(manifest: GoodBoyManifest): void {
  const secrets = manifest.requires?.secrets;
  if (!secrets || secrets.length === 0) return;
  const permissions = manifest.permissions ?? [];
  if (!permissions.includes('env')) {
    throw new Error(
      'manifest declares requires.secrets but "permissions" does not include "env".\n' +
        'Secrets are delivered as environment variables; add "env" to permissions.',
    );
  }
}

// Heuristic nesting depth check: counts opening brackets/braces.
// This is intentionally fast and runs before JSON.parse() to guard against
// deeply nested payloads that could exhaust the stack. Brackets inside
// string values inflate the count slightly but legitimate manifests are
// well within the limit.
function estimateNestingDepth(jsonString: string): number {
  let depth = 0;
  let maxDepth = 0;
  for (const ch of jsonString) {
    if (ch === '{' || ch === '[') {
      depth++;
      if (depth > maxDepth) maxDepth = depth;
    } else if (ch === '}' || ch === ']') {
      depth--;
    }
  }
  return maxDepth;
}

export async function readManifest(filePath: string): Promise<unknown> {
  const resolved = resolve(filePath);

  let size: number;
  try {
    size = statSync(resolved).size;
  } catch {
    throw new Error(`manifest.json not found`);
  }

  if (size > MAX_MANIFEST_BYTES) {
    throw new Error(`manifest.json exceeds the 512 KB size limit`);
  }

  let raw: string;
  try {
    raw = readFileSync(resolved, 'utf-8');
  } catch {
    throw new Error(`Cannot read manifest.json: permission denied`);
  }

  if (estimateNestingDepth(raw) > MAX_NESTING_DEPTH) {
    throw new Error(
      `Manifest structure is invalid: nesting depth exceeds maximum allowed (${MAX_NESTING_DEPTH})`,
    );
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`manifest.json contains invalid JSON`);
  }
}

export interface ManifestValidationResult {
  manifest: GoodBoyManifest;
  warnings: string[];
}

/**
 * Validates a manifest, tolerating a newer-minor `schema_version` than this
 * CLI knows: unknown top-level fields are stripped (never mutating the
 * caller's object) and a warning is returned instead of a hard failure. A
 * newer major is always rejected. Manifests at or below the known minor take
 * the exact same strict path as before this tolerance existed.
 */
export function validateManifestDetailed(data: unknown): ManifestValidationResult {
  const validate = getValidator();
  const knownParts = KNOWN_SCHEMA_VERSION.split('.').map(Number);
  const knownMajor = knownParts[0]!;
  const knownMinor = knownParts[1]!;

  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const rawVersion = (data as Record<string, unknown>)['schema_version'];
    // The length gate (mirrors the schema's own maxLength: 32) must run before any
    // interpolation of rawVersion into a message: an overlong value falls straight
    // through to strict Ajv validation, which rejects it via maxLength without ever
    // embedding the value in the error text.
    if (typeof rawVersion === 'string' && rawVersion.length <= 32) {
      const match = SCHEMA_VERSION_PATTERN.exec(rawVersion);
      if (match) {
        const major = Number(match[1]);
        const minor = Number(match[2]);

        if (major !== knownMajor) {
          const upgradeHint = major > knownMajor ? ' Upgrade GoodBoy to use this skill.' : '';
          throw new Error(
            `manifest declares schema ${rawVersion}; this version of GoodBoy supports ${knownMajor}.x manifests.${upgradeHint}`,
          );
        }

        if (minor > knownMinor) {
          const known = getKnownTopLevelKeys();
          const stripped: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
            if (known.has(key)) stripped[key] = value;
          }
          if (!validate(stripped)) throwValidationError(validate);
          const manifest = stripped as unknown as GoodBoyManifest;
          assertFeatureStamping(manifest);
          assertPermissionsConsistency(manifest);
          return {
            manifest,
            warnings: [
              `manifest uses schema ${rawVersion}; this GoodBoy CLI knows ${KNOWN_SCHEMA_VERSION}. Unknown fields were ignored — upgrade GoodBoy to use them.`,
            ],
          };
        }
        // minor <= knownMinor: fall through to strict validation below, unchanged.
      }
      // non-matching string: fall through; Ajv's pattern check reports the standard error.
    }
    // missing/non-string schema_version: fall through; Ajv's required/type check reports the standard error.
  }

  if (!validate(data)) throwValidationError(validate);
  const manifest = data as GoodBoyManifest;
  assertFeatureStamping(manifest);
  assertPermissionsConsistency(manifest);
  return { manifest, warnings: [] };
}

export function validateManifest(data: unknown): GoodBoyManifest {
  return validateManifestDetailed(data).manifest;
}

export async function writeManifest(filePath: string, data: GoodBoyManifest): Promise<void> {
  const resolved = resolve(filePath);
  try {
    writeFileSync(resolved, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  } catch {
    throw new Error(`Cannot write manifest.json: check directory permissions`);
  }
}
