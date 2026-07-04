import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';

vi.mock('node:fs/promises');

import { readFile, writeFile } from 'node:fs/promises';
import {
  readRegistryEntry,
  writeRegistryEntry,
  createRegistryEntry,
  addVersionToEntry,
  resolveLatestVersion,
  resolveVersionPath,
} from './registry-entry.js';
import type { RegistryEntry } from './registry-entry.js';

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);

const SKILL_DIR = '/registry/my-skill';

function makeEntry(overrides?: Partial<RegistryEntry>): RegistryEntry {
  return {
    name: 'my-skill',
    latest: '1.0.0',
    versions: {
      '1.0.0': { path: 'versions/1.0.0', addedAt: '2026-01-01T00:00:00Z', yanked: false },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// readRegistryEntry()
// ---------------------------------------------------------------------------

describe('readRegistryEntry()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns parsed entry when registry-entry.json exists', async () => {
    const entry = makeEntry();
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(entry));
    const result = await readRegistryEntry(SKILL_DIR);
    expect(result).toEqual(entry);
    expect(mockReadFile).toHaveBeenCalledWith(join(SKILL_DIR, 'registry-entry.json'), 'utf-8');
  });

  it('returns null when registry-entry.json does not exist (ENOENT)', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReadFile.mockRejectedValue(err);
    const result = await readRegistryEntry(SKILL_DIR);
    expect(result).toBeNull();
  });

  it('re-throws non-ENOENT errors', async () => {
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    mockReadFile.mockRejectedValue(err);
    await expect(readRegistryEntry(SKILL_DIR)).rejects.toThrow('EACCES');
  });
});

// ---------------------------------------------------------------------------
// writeRegistryEntry()
// ---------------------------------------------------------------------------

describe('writeRegistryEntry()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes serialized entry to registry-entry.json', async () => {
    const entry = makeEntry();
    mockWriteFile.mockResolvedValue(undefined);
    await writeRegistryEntry(SKILL_DIR, entry);
    expect(mockWriteFile).toHaveBeenCalledWith(
      join(SKILL_DIR, 'registry-entry.json'),
      expect.stringContaining('"name": "my-skill"'),
      'utf-8',
    );
  });

  it('writes JSON with newline at end', async () => {
    const entry = makeEntry();
    mockWriteFile.mockResolvedValue(undefined);
    await writeRegistryEntry(SKILL_DIR, entry);
    const written = (mockWriteFile.mock.calls[0]![1] as string);
    expect(written.endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createRegistryEntry()
// ---------------------------------------------------------------------------

describe('createRegistryEntry()', () => {
  it('creates an entry with the given name, version, and path', () => {
    const result = createRegistryEntry('my-skill', '1.0.0', 'versions/1.0.0');
    expect(result.name).toBe('my-skill');
    expect(result.latest).toBe('1.0.0');
    expect(result.versions['1.0.0']).toBeDefined();
    expect(result.versions['1.0.0']!.path).toBe('versions/1.0.0');
    expect(result.versions['1.0.0']!.yanked).toBe(false);
  });

  it('sets addedAt to a valid ISO string', () => {
    const result = createRegistryEntry('my-skill', '1.0.0', 'versions/1.0.0');
    expect(() => new Date(result.versions['1.0.0']!.addedAt)).not.toThrow();
    expect(new Date(result.versions['1.0.0']!.addedAt).toISOString()).toBe(
      result.versions['1.0.0']!.addedAt,
    );
  });

  it('creates exactly one version entry', () => {
    const result = createRegistryEntry('my-skill', '2.0.0', 'versions/2.0.0');
    expect(Object.keys(result.versions)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// addVersionToEntry()
// ---------------------------------------------------------------------------

describe('addVersionToEntry()', () => {
  it('does not mutate the original entry', () => {
    const original = makeEntry();
    const originalStr = JSON.stringify(original);
    addVersionToEntry(original, '2.0.0', 'versions/2.0.0');
    expect(JSON.stringify(original)).toBe(originalStr);
  });

  it('returns a new entry with the version added', () => {
    const original = makeEntry();
    const result = addVersionToEntry(original, '2.0.0', 'versions/2.0.0');
    expect(result.versions['1.0.0']).toBeDefined();
    expect(result.versions['2.0.0']).toBeDefined();
    expect(result.versions['2.0.0']!.path).toBe('versions/2.0.0');
    expect(result.versions['2.0.0']!.yanked).toBe(false);
  });

  it('updates latest to the new version', () => {
    const original = makeEntry();
    const result = addVersionToEntry(original, '2.0.0', 'versions/2.0.0');
    expect(result.latest).toBe('2.0.0');
  });

  it('preserves existing versions', () => {
    const original = makeEntry();
    const result = addVersionToEntry(original, '2.0.0', 'versions/2.0.0');
    expect(result.versions['1.0.0']).toEqual(original.versions['1.0.0']);
  });
});

// ---------------------------------------------------------------------------
// resolveLatestVersion()
// ---------------------------------------------------------------------------

describe('resolveLatestVersion()', () => {
  it('returns the single non-yanked version', () => {
    const entry = makeEntry();
    expect(resolveLatestVersion(entry)).toBe('1.0.0');
  });

  it('returns null when all versions are yanked', () => {
    const entry = makeEntry({
      versions: {
        '1.0.0': { path: 'versions/1.0.0', addedAt: '2026-01-01T00:00:00Z', yanked: true },
      },
    });
    expect(resolveLatestVersion(entry)).toBeNull();
  });

  it('returns the highest semver non-yanked version', () => {
    const entry = makeEntry({
      versions: {
        '1.0.0': { path: 'versions/1.0.0', addedAt: '2026-01-01T00:00:00Z', yanked: false },
        '2.0.0': { path: 'versions/2.0.0', addedAt: '2026-02-01T00:00:00Z', yanked: false },
        '1.5.0': { path: 'versions/1.5.0', addedAt: '2026-01-15T00:00:00Z', yanked: false },
      },
    });
    expect(resolveLatestVersion(entry)).toBe('2.0.0');
  });

  it('skips yanked versions when selecting latest', () => {
    const entry = makeEntry({
      versions: {
        '1.0.0': { path: 'versions/1.0.0', addedAt: '2026-01-01T00:00:00Z', yanked: false },
        '2.0.0': { path: 'versions/2.0.0', addedAt: '2026-02-01T00:00:00Z', yanked: true },
      },
    });
    expect(resolveLatestVersion(entry)).toBe('1.0.0');
  });

  it('compares patch versions correctly', () => {
    const entry = makeEntry({
      versions: {
        '1.0.1': { path: 'versions/1.0.1', addedAt: '2026-01-01T00:00:00Z', yanked: false },
        '1.0.9': { path: 'versions/1.0.9', addedAt: '2026-01-09T00:00:00Z', yanked: false },
        '1.0.10': { path: 'versions/1.0.10', addedAt: '2026-01-10T00:00:00Z', yanked: false },
      },
    });
    expect(resolveLatestVersion(entry)).toBe('1.0.10');
  });

  it('compares minor versions correctly', () => {
    const entry = makeEntry({
      versions: {
        '1.2.0': { path: 'versions/1.2.0', addedAt: '2026-01-01T00:00:00Z', yanked: false },
        '1.10.0': { path: 'versions/1.10.0', addedAt: '2026-01-10T00:00:00Z', yanked: false },
      },
    });
    expect(resolveLatestVersion(entry)).toBe('1.10.0');
  });
});

// ---------------------------------------------------------------------------
// resolveVersionPath()
// ---------------------------------------------------------------------------

describe('resolveVersionPath()', () => {
  it('joins registrySkillDir with relative path', () => {
    const entry = makeEntry();
    const result = resolveVersionPath(entry, '1.0.0', SKILL_DIR);
    expect(result).toBe(join(SKILL_DIR, 'versions/1.0.0'));
  });

  it('returns https:// URL as-is', () => {
    const entry = makeEntry({
      versions: {
        '1.0.0': { path: 'https://registry.example.com/skills/my-skill/1.0.0', addedAt: '2026-01-01T00:00:00Z', yanked: false },
      },
    });
    const result = resolveVersionPath(entry, '1.0.0', SKILL_DIR);
    expect(result).toBe('https://registry.example.com/skills/my-skill/1.0.0');
  });

  it('returns http:// URL as-is', () => {
    const entry = makeEntry({
      versions: {
        '1.0.0': { path: 'http://localhost:8080/skills/my-skill/1.0.0', addedAt: '2026-01-01T00:00:00Z', yanked: false },
      },
    });
    const result = resolveVersionPath(entry, '1.0.0', SKILL_DIR);
    expect(result).toBe('http://localhost:8080/skills/my-skill/1.0.0');
  });

  it('throws when the requested version does not exist in the entry', () => {
    const entry = makeEntry();
    expect(() => resolveVersionPath(entry, '9.9.9', SKILL_DIR)).toThrow(
      'Version "9.9.9" not found in registry entry for "my-skill"',
    );
  });
});
