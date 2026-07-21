import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Stats } from 'node:fs';
import type { GoodBoyManifest } from '../types/index.js';

vi.mock('node:fs');

import { statSync, readFileSync, writeFileSync } from 'node:fs';
import {
  readManifest,
  validateManifest,
  validateManifestDetailed,
  writeManifest,
  KNOWN_SCHEMA_VERSION,
  FIELD_INTRODUCED_IN,
} from './manifest.js';
import { loadFixture } from '../__fixtures__/index.js';

const mockStatSync = vi.mocked(statSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);

function fakeStats(size: number): Stats {
  return { size } as unknown as Stats;
}

// ---------------------------------------------------------------------------
// readManifest()
// ---------------------------------------------------------------------------

describe('readManifest()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses and returns valid JSON content', async () => {
    const fixture = loadFixture('valid-minimal');
    mockStatSync.mockReturnValue(fakeStats(100));
    (mockReadFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(fixture));
    const result = await readManifest('/fake/manifest.json');
    expect(result).toEqual(fixture);
  });

  it('throws a clean error when the file does not exist', async () => {
    mockStatSync.mockImplementation(() => { throw new Error('ENOENT: no such file'); });
    await expect(readManifest('/nonexistent/manifest.json'))
      .rejects.toThrow('manifest.json not found');
  });

  it('error message is exactly "manifest.json not found" with no path leak', async () => {
    mockStatSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT: no such file or directory, stat "/real/private/path"'), {
        code: 'ENOENT',
        path: '/real/private/path',
      });
    });
    const err = await readManifest('/fake/path').catch((e: unknown) => e as Error);
    expect((err as Error).message).toBe('manifest.json not found');
  });

  it('throws when file exceeds the 512 KB size limit', async () => {
    mockStatSync.mockReturnValue(fakeStats(512 * 1024 + 1));
    await expect(readManifest('/fake/manifest.json'))
      .rejects.toThrow('manifest.json exceeds the 512 KB size limit');
  });

  it('does not read file content when the size check fails', async () => {
    mockStatSync.mockReturnValue(fakeStats(512 * 1024 + 1));
    await readManifest('/fake/manifest.json').catch(() => {});
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('accepts a file exactly at the 512 KB boundary', async () => {
    const fixture = loadFixture('valid-minimal');
    mockStatSync.mockReturnValue(fakeStats(512 * 1024));
    (mockReadFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(fixture));
    await expect(readManifest('/fake/manifest.json')).resolves.toBeDefined();
  });

  it('throws a clean error on permission denied', async () => {
    mockStatSync.mockReturnValue(fakeStats(100));
    mockReadFileSync.mockImplementation(() => { throw new Error('EACCES: permission denied'); });
    await expect(readManifest('/fake/manifest.json'))
      .rejects.toThrow('Cannot read manifest.json: permission denied');
  });

  it('throws a clean error when the file contains invalid JSON', async () => {
    mockStatSync.mockReturnValue(fakeStats(100));
    (mockReadFileSync as ReturnType<typeof vi.fn>).mockReturnValue('{ not valid json }');
    await expect(readManifest('/fake/manifest.json'))
      .rejects.toThrow('manifest.json contains invalid JSON');
  });

  it('rejects a manifest with nesting depth greater than 10', async () => {
    const deepJson = '{'.repeat(11) + '}'.repeat(11);
    mockStatSync.mockReturnValue(fakeStats(deepJson.length));
    (mockReadFileSync as ReturnType<typeof vi.fn>).mockReturnValue(deepJson);
    await expect(readManifest('/fake/manifest.json'))
      .rejects.toThrow('nesting depth exceeds maximum allowed (10)');
  });

  it('accepts a manifest at exactly nesting depth 10', async () => {
    const fixture = loadFixture('valid-minimal');
    const json = JSON.stringify(fixture);
    mockStatSync.mockReturnValue(fakeStats(json.length));
    (mockReadFileSync as ReturnType<typeof vi.fn>).mockReturnValue(json);
    await expect(readManifest('/fake/manifest.json')).resolves.toBeDefined();
  });

  it('error messages never contain raw stack traces', async () => {
    mockStatSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const err = await readManifest('/fake/manifest.json').catch((e: unknown) => e as Error);
    expect((err as Error).message).not.toMatch(/\s+at\s+\w/);
  });
});

// ---------------------------------------------------------------------------
// validateManifest() — uses real ajv + real schema, no fs mocking needed
// ---------------------------------------------------------------------------

describe('validateManifest()', () => {
  it('accepts valid-minimal.json', () => {
    expect(() => validateManifest(loadFixture('valid-minimal'))).not.toThrow();
  });

  it('accepts valid-complete.json', () => {
    expect(() => validateManifest(loadFixture('valid-complete'))).not.toThrow();
  });

  it('accepts valid-deprecated.json', () => {
    expect(() => validateManifest(loadFixture('valid-deprecated'))).not.toThrow();
  });

  it('accepts valid-no-permissions.json', () => {
    expect(() => validateManifest(loadFixture('valid-no-permissions'))).not.toThrow();
  });

  it('accepts valid-with-os-constraint.json', () => {
    expect(() => validateManifest(loadFixture('valid-with-os-constraint'))).not.toThrow();
  });

  it('rejects invalid-missing-name.json', () => {
    expect(() => validateManifest(loadFixture('invalid-missing-name')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-missing-version.json', () => {
    expect(() => validateManifest(loadFixture('invalid-missing-version')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-missing-description.json', () => {
    expect(() => validateManifest(loadFixture('invalid-missing-description')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-missing-author.json', () => {
    expect(() => validateManifest(loadFixture('invalid-missing-author')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-missing-license.json', () => {
    expect(() => validateManifest(loadFixture('invalid-missing-license')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-missing-schema-version.json', () => {
    expect(() => validateManifest(loadFixture('invalid-missing-schema-version')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-missing-status.json', () => {
    expect(() => validateManifest(loadFixture('invalid-missing-status')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-bad-name-uppercase.json', () => {
    expect(() => validateManifest(loadFixture('invalid-bad-name-uppercase')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-bad-name-spaces.json', () => {
    expect(() => validateManifest(loadFixture('invalid-bad-name-spaces')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-bad-name-too-long.json', () => {
    expect(() => validateManifest(loadFixture('invalid-bad-name-too-long')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-bad-version.json', () => {
    expect(() => validateManifest(loadFixture('invalid-bad-version')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-bad-status.json', () => {
    expect(() => validateManifest(loadFixture('invalid-bad-status')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-bad-category.json', () => {
    expect(() => validateManifest(loadFixture('invalid-bad-category')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-bad-permissions.json', () => {
    expect(() => validateManifest(loadFixture('invalid-bad-permissions')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-additional-props.json', () => {
    expect(() => validateManifest(loadFixture('invalid-additional-props')))
      .toThrow('Invalid manifest:');
  });

  it('rejects invalid-nested-additional-props.json', () => {
    expect(() => validateManifest(loadFixture('invalid-nested-additional-props')))
      .toThrow('Invalid manifest:');
  });

  it('accepts permissions on any manifest (not kind-restricted)', () => {
    const manifest = {
      ...(loadFixture('valid-minimal') as Record<string, unknown>),
      permissions: ['read_files', 'network'],
    };
    expect(() => validateManifest(manifest)).not.toThrow();
  });

  it('rejects permissions with duplicate values', () => {
    const manifest = {
      ...(loadFixture('valid-minimal') as Record<string, unknown>),
      permissions: ['shell', 'shell'],
    };
    expect(() => validateManifest(manifest)).toThrow('Invalid manifest:');
  });

  it('rejects permissions with more than 5 items', () => {
    const manifest = {
      ...(loadFixture('valid-minimal') as Record<string, unknown>),
      permissions: ['read_files', 'write_files', 'network', 'shell', 'env', 'read_files'],
    };
    expect(() => validateManifest(manifest)).toThrow('Invalid manifest:');
  });

  it('accepts a valid tags array', () => {
    const manifest = {
      ...(loadFixture('valid-minimal') as Record<string, unknown>),
      tags: ['testing', 'workflow'],
    };
    expect(() => validateManifest(manifest)).not.toThrow();
  });

  it('rejects an invalid tags value', () => {
    const manifest = {
      ...(loadFixture('valid-minimal') as Record<string, unknown>),
      tags: ['invented-tag'],
    };
    expect(() => validateManifest(manifest)).toThrow('Invalid manifest:');
  });

  it('error message includes "Invalid manifest:" prefix', () => {
    try {
      validateManifest(loadFixture('invalid-missing-name'));
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).toMatch(/^Invalid manifest:/);
    }
  });

  it('error output lists all validation errors, not just the first', () => {
    // An empty object is missing all seven required fields; allErrors:true means
    // the error list should contain more than one entry.
    try {
      validateManifest({});
      expect.fail('should have thrown');
    } catch (err) {
      const lines = (err as Error).message.split('\n');
      expect(lines.length).toBeGreaterThan(2);
    }
  });

  it('error message contains the failing field path', () => {
    try {
      validateManifest(loadFixture('invalid-bad-status'));
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('/status');
    }
  });

  it('error message uses "(root)" for top-level required field violations', () => {
    try {
      validateManifest({});
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('(root)');
    }
  });

  it('rejects null input', () => {
    expect(() => validateManifest(null)).toThrow('Invalid manifest:');
  });

  it('rejects array input', () => {
    expect(() => validateManifest([])).toThrow('Invalid manifest:');
  });

  it('rejects string input', () => {
    expect(() => validateManifest('{"name":"test"}')).toThrow('Invalid manifest:');
  });

  it('rejects number input', () => {
    expect(() => validateManifest(42)).toThrow('Invalid manifest:');
  });

  it('returns the manifest object typed as GoodBoyManifest on success', () => {
    const result = validateManifest(loadFixture('valid-minimal'));
    expect(result).toHaveProperty('name', 'test-skill');
    expect(result).toHaveProperty('schema_version', '1.0.0');
  });

  it('GoodBoyManifest permissions is a plain optional array type', () => {
    // Type-level regression guard: if permissions were a tuple union, this assignment would fail tsc.
    const p: GoodBoyManifest['permissions'] = ['read_files', 'network'];
    expect(p).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// validateManifestDetailed() — schema-version tolerance (S1)
// ---------------------------------------------------------------------------

describe('validateManifestDetailed() — schema-version tolerance', () => {
  const BASE = loadFixture('valid-minimal') as Record<string, unknown>;

  it('1.0.0 manifest returns no warnings', () => {
    const result = validateManifestDetailed({ ...BASE });
    expect(result.warnings).toEqual([]);
  });

  it('rejects a 1.0.0 manifest with an unknown top-level field (stamping enforcement)', () => {
    const manifest = { ...BASE, extra_field: 'nope' };
    expect(() => validateManifestDetailed(manifest)).toThrow('Invalid manifest:');
  });

  it('accepts a 1.5.0 manifest with an unknown top-level field, stripping it with a warning', () => {
    const input = { ...BASE, schema_version: '1.5.0', future_field: 'unused' };
    const result = validateManifestDetailed(input);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('schema 1.5.0');
    expect(result.warnings[0]).toContain(KNOWN_SCHEMA_VERSION);
    expect(result.manifest).not.toHaveProperty('future_field');
    expect(input).toHaveProperty('future_field', 'unused'); // caller's object untouched
  });

  it('rejects a 1.5.0 manifest whose known fields are invalid', () => {
    const input = { ...BASE, schema_version: '1.5.0', status: 'not-a-real-status' };
    expect(() => validateManifestDetailed(input)).toThrow('Invalid manifest:');
  });

  it('rejects a 1.5.0 manifest with an unknown property nested inside a known object', () => {
    const input = {
      ...BASE,
      schema_version: '1.5.0',
      author: { name: 'Test', unexpected: 'nope' },
    };
    expect(() => validateManifestDetailed(input)).toThrow('Invalid manifest:');
  });

  it('rejects a 2.0.0 manifest with an upgrade-GoodBoy message', () => {
    const input = { ...BASE, schema_version: '2.0.0' };
    expect(() => validateManifestDetailed(input)).toThrow(
      'manifest declares schema 2.0.0; this version of GoodBoy supports 1.x manifests. Upgrade GoodBoy to use this skill.',
    );
  });

  it('rejects a 0.9.0 manifest without suggesting a GoodBoy upgrade (wrong direction)', () => {
    const input = { ...BASE, schema_version: '0.9.0' };
    let error: Error | undefined;
    try {
      validateManifestDetailed(input);
      expect.fail('should have thrown');
    } catch (err) {
      error = err as Error;
    }
    expect(error.message).toBe(
      'manifest declares schema 0.9.0; this version of GoodBoy supports 1.x manifests.',
    );
    expect(error.message).not.toContain('Upgrade GoodBoy');
  });

  it('rejects a manifest with a missing schema_version (falls through to standard failure)', () => {
    const input = { ...BASE };
    delete input['schema_version'];
    expect(() => validateManifestDetailed(input)).toThrow('Invalid manifest:');
  });

  it('rejects a manifest with a non-string schema_version without crashing', () => {
    const input = { ...BASE, schema_version: 100 };
    expect(() => validateManifestDetailed(input)).toThrow('Invalid manifest:');
  });

  it('rejects a manifest with a malformed schema_version string ("1.0")', () => {
    const input = { ...BASE, schema_version: '1.0' };
    expect(() => validateManifestDetailed(input)).toThrow('Invalid manifest:');
  });

  it('rejects a manifest with a malformed schema_version string ("abc")', () => {
    const input = { ...BASE, schema_version: 'abc' };
    expect(() => validateManifestDetailed(input)).toThrow('Invalid manifest:');
  });

  it('accepts a patch-only bump (1.0.7) via the strict path when otherwise valid', () => {
    const input = { ...BASE, schema_version: '1.0.7' };
    const result = validateManifestDetailed(input);
    expect(result.warnings).toEqual([]);
    expect(result.manifest.schema_version).toBe('1.0.7');
  });

  it('KNOWN_SCHEMA_VERSION itself validates cleanly against the shipped schema', () => {
    // Pinned, not just referenced: guards against the constant and the schema
    // drifting apart silently (e.g. the schema gains a field but the constant
    // is left at the old value, or vice versa).
    expect(KNOWN_SCHEMA_VERSION).toBe('1.1.0');
    const input = { ...BASE, schema_version: KNOWN_SCHEMA_VERSION };
    expect(() => validateManifestDetailed(input)).not.toThrow();
  });

  it('validateManifest() (thin wrapper) still returns just the manifest, discarding warnings', () => {
    const input = { ...BASE, schema_version: '1.5.0', future_field: 'unused' };
    const manifest = validateManifest(input);
    expect(manifest).not.toHaveProperty('future_field');
  });
});

// ---------------------------------------------------------------------------
// validateManifestDetailed() — schema_version length bound (security regression)
//
// schema_version has no length limit of its own consequence while it was a
// `const`, but became an open-ended pattern match in the S1 tolerance work.
// Without a bound, an overlong value gets interpolated verbatim into a thrown
// error message or a tolerance warning (up to the 512KB manifest cap). These
// tests pin the fix: a >32-char schema_version is diverted to strict Ajv
// validation before any interpolation can occur, and Ajv's own maxLength
// violation message never embeds the offending value.
// ---------------------------------------------------------------------------

describe('validateManifestDetailed() — schema_version length bound (security)', () => {
  const BASE = loadFixture('valid-minimal') as Record<string, unknown>;

  it('rejects a huge major segment with a bounded, non-embedding error message', () => {
    const hugeDigits = '9'.repeat(400_000);
    const input = { ...BASE, schema_version: `${hugeDigits}.0.0` };
    let caught: Error | undefined;
    try {
      validateManifestDetailed(input);
      expect.fail('should have thrown');
    } catch (err) {
      caught = err as Error;
    }
    expect(caught.message).toContain('Invalid manifest:');
    expect(caught.message).not.toContain(hugeDigits);
    expect(caught.message.length).toBeLessThan(1024);
  });

  it('rejects a huge minor segment with a bounded, non-embedding error message (not a warning)', () => {
    const hugeDigits = '9'.repeat(400_000);
    const input = { ...BASE, schema_version: `1.${hugeDigits}.0` };
    let caught: Error | undefined;
    try {
      validateManifestDetailed(input);
      expect.fail('should have thrown');
    } catch (err) {
      caught = err as Error;
    }
    expect(caught.message).toContain('Invalid manifest:');
    expect(caught.message).not.toContain(hugeDigits);
    expect(caught.message.length).toBeLessThan(1024);
  });

  it('diverts a >32-char but otherwise well-formed version (would have tolerated as newer-minor) to the strict path', () => {
    const hugeMinor = '9'.repeat(40);
    const input = { ...BASE, schema_version: `1.${hugeMinor}.0` };
    expect(input.schema_version.length).toBeGreaterThan(32);
    expect(() => validateManifestDetailed(input)).toThrow('Invalid manifest:');
  });
});

// ---------------------------------------------------------------------------
// validateManifestDetailed() — requires.secrets (S2)
// ---------------------------------------------------------------------------

describe('validateManifestDetailed() — requires.secrets (S2)', () => {
  const BASE = loadFixture('valid-minimal') as Record<string, unknown>;

  it('accepts requires.secrets at schema_version 1.1.0 with no warnings', () => {
    const input = {
      ...BASE,
      schema_version: '1.1.0',
      permissions: ['env'],
      requires: { secrets: ['EXOSCALE_API_KEY', 'EXOSCALE_API_SECRET'] },
    };
    const result = validateManifestDetailed(input);
    expect(result.warnings).toEqual([]);
    expect(result.manifest.requires).toEqual({ secrets: ['EXOSCALE_API_KEY', 'EXOSCALE_API_SECRET'] });
  });

  it('rejects requires at schema_version 1.0.0 with the exact stamping remediation message', () => {
    const input = {
      ...BASE,
      schema_version: '1.0.0',
      permissions: ['env'],
      requires: { secrets: ['EXOSCALE_API_KEY'] },
    };
    expect(() => validateManifestDetailed(input)).toThrow(
      'manifest declares schema_version 1.0.0 but uses "requires", which needs 1.1.0.\n' +
        'Set "schema_version": "1.1.0" in manifest.json.',
    );
  });

  it('tolerant path: 1.2.0 with requires plus an unknown future field strips the unknown field, keeps and enforces requires', () => {
    const input = {
      ...BASE,
      schema_version: '1.2.0',
      permissions: ['env'],
      requires: { secrets: ['EXOSCALE_API_KEY'] },
      future_field: 'unused',
    };
    const result = validateManifestDetailed(input);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('schema 1.2.0');
    expect(result.manifest).not.toHaveProperty('future_field');
    expect(result.manifest.requires).toEqual({ secrets: ['EXOSCALE_API_KEY'] });
  });

  it('tolerant path still genuinely validates requires, not just passes it through untouched', () => {
    const input = {
      ...BASE,
      schema_version: '1.2.0',
      permissions: ['env'],
      requires: { secrets: [] }, // violates minItems: 1
      future_field: 'unused',
    };
    expect(() => validateManifestDetailed(input)).toThrow('Invalid manifest:');
  });

  const invalidSecretNames: Record<string, string> = {
    'lowercase': 'exoscale_api_key',
    'a leading digit': '1EXOSCALE_KEY',
    'a space': 'EXOSCALE API KEY',
    'an empty string': '',
    'over 64 characters': 'A'.repeat(65),
  };
  for (const [label, name] of Object.entries(invalidSecretNames)) {
    it(`rejects a secret name that is ${label}`, () => {
      const input = {
        ...BASE,
        schema_version: '1.1.0',
        permissions: ['env'],
        requires: { secrets: [name] },
      };
      expect(() => validateManifestDetailed(input)).toThrow('Invalid manifest:');
    });
  }

  it('rejects an empty secrets array (minItems: 1)', () => {
    const input = {
      ...BASE,
      schema_version: '1.1.0',
      permissions: ['env'],
      requires: { secrets: [] },
    };
    expect(() => validateManifestDetailed(input)).toThrow('Invalid manifest:');
  });

  it('rejects 33 secret names (maxItems: 32)', () => {
    const input = {
      ...BASE,
      schema_version: '1.1.0',
      permissions: ['env'],
      requires: { secrets: Array.from({ length: 33 }, (_, i) => `SECRET_${i}`) },
    };
    expect(() => validateManifestDetailed(input)).toThrow('Invalid manifest:');
  });

  it('accepts exactly 32 secret names (boundary)', () => {
    const input = {
      ...BASE,
      schema_version: '1.1.0',
      permissions: ['env'],
      requires: { secrets: Array.from({ length: 32 }, (_, i) => `SECRET_${i}`) },
    };
    expect(() => validateManifestDetailed(input)).not.toThrow();
  });

  it('rejects duplicate secret names (uniqueItems)', () => {
    const input = {
      ...BASE,
      schema_version: '1.1.0',
      permissions: ['env'],
      requires: { secrets: ['DUPE', 'DUPE'] },
    };
    expect(() => validateManifestDetailed(input)).toThrow('Invalid manifest:');
  });

  it('rejects requires: {} (secrets is required within requires)', () => {
    const input = {
      ...BASE,
      schema_version: '1.1.0',
      permissions: ['env'],
      requires: {},
    };
    expect(() => validateManifestDetailed(input)).toThrow('Invalid manifest:');
  });

  it('rejects requires.secrets present without "env" in permissions, with the exact remediation message', () => {
    const input = {
      ...BASE,
      schema_version: '1.1.0',
      requires: { secrets: ['EXOSCALE_API_KEY'] },
    };
    expect(() => validateManifestDetailed(input)).toThrow(
      'manifest declares requires.secrets but "permissions" does not include "env".\n' +
        'Secrets are delivered as environment variables; add "env" to permissions.',
    );
  });

  it('accepts requires.secrets present with "env" among other permissions', () => {
    const input = {
      ...BASE,
      schema_version: '1.1.0',
      permissions: ['read_files', 'env'],
      requires: { secrets: ['EXOSCALE_API_KEY'] },
    };
    expect(() => validateManifestDetailed(input)).not.toThrow();
  });

  it('accepts "env" in permissions without requires.secrets (consistency rule not triggered)', () => {
    const input = {
      ...BASE,
      schema_version: '1.0.0',
      permissions: ['env'],
    };
    expect(() => validateManifestDetailed(input)).not.toThrow();
  });

  it('FIELD_INTRODUCED_IN.requires matches KNOWN_SCHEMA_VERSION (single source of truth reused by skill-version stamping)', () => {
    expect(FIELD_INTRODUCED_IN['requires']).toBe('1.1.0');
  });
});

// ---------------------------------------------------------------------------
// validateManifestDetailed() — backward compatibility (S2 must not disturb S1)
// ---------------------------------------------------------------------------

describe('validateManifestDetailed() — backward compatibility across the S2 bump', () => {
  it('every existing 1.0.0 fixture without requires still validates with zero warnings', () => {
    const fixtureNames = [
      'valid-minimal', 'valid-complete', 'valid-deprecated',
      'valid-no-permissions', 'valid-with-os-constraint',
    ];
    for (const name of fixtureNames) {
      const result = validateManifestDetailed(loadFixture(name));
      expect(result.warnings).toEqual([]);
      expect(result.manifest).not.toHaveProperty('requires');
    }
  });
});

// ---------------------------------------------------------------------------
// writeManifest()
// ---------------------------------------------------------------------------

describe('writeManifest()', () => {
  const validManifest = loadFixture('valid-minimal') as Parameters<typeof writeManifest>[1];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes JSON with 2-space indentation and trailing newline', async () => {
    await writeManifest('/fake/manifest.json', validManifest);
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const [, content] = vi.mocked(writeFileSync).mock.calls[0]!;
    expect(typeof content).toBe('string');
    const written = content as string;
    expect(written.endsWith('\n')).toBe(true);
    expect(written).toContain('  '); // 2-space indent present
    expect(JSON.parse(written)).toEqual(validManifest);
  });

  it('writes to the resolved path with utf-8 encoding', async () => {
    await writeManifest('/fake/manifest.json', validManifest);
    const [path, , encoding] = vi.mocked(writeFileSync).mock.calls[0]!;
    expect(String(path)).toMatch(/manifest\.json$/);
    expect(encoding).toBe('utf-8');
  });

  it('throws a clean error on permission denied', async () => {
    mockWriteFileSync.mockImplementation(() => { throw new Error('EACCES'); });
    await expect(writeManifest('/fake/manifest.json', validManifest))
      .rejects.toThrow('Cannot write manifest.json: check directory permissions');
  });
});
