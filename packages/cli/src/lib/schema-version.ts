/**
 * The version policy shared by every goodboy document — manifest, goodboy.json
 * and goodboy.lock — for how a CLI that knows version X treats a document
 * declaring version Y:
 *
 *  - newer minor  -> 'newer-minor': the document is treated as valid; unknown
 *                    TOP-LEVEL fields are stripped (with a warning) before
 *                    strict validation, so additive changes at the top level
 *                    keep working on older CLIs. Stripping is a
 *                    validation-time concern only — callers keep the original
 *                    object, so unknown fields survive read-modify-write
 *                    untouched. A field added INSIDE a nested object is NOT
 *                    tolerated: it fails strict validation, and each document
 *                    type applies its own failure semantics (goodboy.json and
 *                    manifests: hard error; goodboy.lock: warn + treated as
 *                    absent, then regenerated on the next write).
 *  - newer major  -> 'newer-major': refuse. An older CLI must not interpret
 *                    or overwrite a newer tool's output.
 *  - older major  -> 'older-major': a distinct outcome so each document type
 *                    decides for itself whether an old file is an error
 *                    (goodboy.json is user intent) or disposable state to
 *                    regenerate (goodboy.lock is machine-generated).
 *  - anything else -> 'strict': parseable-and-current, or not parseable at
 *                    all; the caller falls through to strict Ajv validation,
 *                    which reports the standard error for the malformed cases.
 */

export type VersionPolicyResult =
  | { outcome: 'strict' }
  | { outcome: 'newer-minor'; version: string }
  | { outcome: 'newer-major'; version: string }
  | { outcome: 'older-major'; version: string };

// Mirrors the maxLength: 32 on every schema's version field. The gate must run
// before any interpolation of the declared version into a message: an overlong
// value falls straight through to strict Ajv validation, which rejects it via
// maxLength without ever embedding the value in the error text.
const MAX_VERSION_LENGTH = 32;

export const SEMVER_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

export function applyVersionPolicy(
  data: unknown,
  versionField: string,
  knownVersion: string,
): VersionPolicyResult {
  const knownParts = knownVersion.split('.').map(Number);
  const knownMajor = knownParts[0]!;
  const knownMinor = knownParts[1]!;

  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const rawVersion = (data as Record<string, unknown>)[versionField];
    if (typeof rawVersion === 'string' && rawVersion.length <= MAX_VERSION_LENGTH) {
      const match = SEMVER_VERSION_PATTERN.exec(rawVersion);
      if (match) {
        const major = Number(match[1]);
        const minor = Number(match[2]);
        if (major !== knownMajor) {
          return major > knownMajor
            ? { outcome: 'newer-major', version: rawVersion }
            : { outcome: 'older-major', version: rawVersion };
        }
        if (minor > knownMinor) return { outcome: 'newer-minor', version: rawVersion };
      }
    }
  }
  return { outcome: 'strict' };
}

/**
 * Returns a copy of `data` keeping only the keys in `knownKeys`. Used for the
 * newer-minor path: unknown top-level fields are stripped before strict
 * validation. Never mutates the caller's object.
 */
export function stripToKnownKeys(
  data: Record<string, unknown>,
  knownKeys: Set<string>,
): Record<string, unknown> {
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (knownKeys.has(key)) stripped[key] = value;
  }
  return stripped;
}
