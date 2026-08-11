import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { join } from 'node:path';
import type { GoodBoyManifest } from '../types/index.js';
import type { RegistryEntry } from '../lib/registry-entry.js';

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: '',
  })),
}));
vi.mock('node:fs/promises', () => ({
  cp: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/registry.js', () => ({
  getRegistryPath: vi.fn().mockReturnValue('/mock/registry'),
}));
vi.mock('../lib/registry-entry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/registry-entry.js')>();
  return {
    ...actual,
    readRegistryEntry: vi.fn(),
    writeRegistryEntry: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock('../lib/manifest.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/manifest.js')>();
  return {
    ...actual,
    readManifest: vi.fn(),
    writeManifest: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  sanitiseError: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

import { cp, rm } from 'node:fs/promises';
import { readRegistryEntry, writeRegistryEntry } from '../lib/registry-entry.js';
import { readManifest, writeManifest } from '../lib/manifest.js';
import { logger } from '../lib/logger.js';
import { bumpVersion, assertWithin, registerSkillVersion } from './skill-version.js';

const mockCp = vi.mocked(cp);
const mockRm = vi.mocked(rm);
const mockReadRegistryEntry = vi.mocked(readRegistryEntry);
const mockWriteRegistryEntry = vi.mocked(writeRegistryEntry);
const mockReadManifest = vi.mocked(readManifest);
const mockWriteManifest = vi.mocked(writeManifest);
const mockLogger = vi.mocked(logger);

const REGISTRY_PATH = '/mock/registry';
const SKILL_DIR = join(REGISTRY_PATH, 'my-skill');

const MANIFEST: GoodBoyManifest = {
  name: 'my-skill',
  version: '1.0.0',
  description: 'A test skill',
  author: { name: 'Test' },
  license: 'MIT',
  schema_version: '2.0.0',
  status: 'experimental',
};

function makeEntry(): RegistryEntry {
  return {
    name: 'my-skill',
    latest: '1.0.0',
    versions: {
      '1.0.0': { path: 'versions/1.0.0', addedAt: '2026-01-01T00:00:00.000Z', yanked: false },
      '0.9.0': { path: 'versions/0.9.0', addedAt: '2025-12-01T00:00:00.000Z', yanked: true },
    },
  };
}

function buildProgram(): Command {
  const program = new Command();
  registerSkillVersion(program);
  return program;
}

describe('bumpVersion()', () => {
  it('patch bump: 1.0.0 → 1.0.1', () => {
    expect(bumpVersion('1.0.0', 'patch')).toBe('1.0.1');
  });
  it('minor bump: 1.0.0 → 1.1.0', () => {
    expect(bumpVersion('1.0.0', 'minor')).toBe('1.1.0');
  });
  it('major bump: 1.0.0 → 2.0.0', () => {
    expect(bumpVersion('1.0.0', 'major')).toBe('2.0.0');
  });
  it('patch bump resets nothing: 1.2.3 → 1.2.4', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
  });
  it('minor bump resets patch: 1.2.3 → 1.3.0', () => {
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
  });
  it('major bump resets minor and patch: 1.2.3 → 2.0.0', () => {
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
  });
});

describe('assertWithin()', () => {
  it('does not throw when target is inside base', () => {
    expect(() => assertWithin('/a/skills/my-skill', '/a/skills', 'test path')).not.toThrow();
  });

  it('throws with the exact message when target escapes base via ../', () => {
    expect(() => assertWithin('/a/skills/../evil', '/a/skills', 'test path')).toThrow(
      'Refused: test path escapes the expected directory',
    );
  });

  it('throws when target is a sibling directory outside base entirely', () => {
    expect(() => assertWithin('/a/other-dir', '/a/skills', 'test path')).toThrow(
      'Refused: test path escapes the expected directory',
    );
  });

  it('throws on a prefix-match-without-separator: base "/a/skills" vs target "/a/skills-evil"', () => {
    // Proves the `+ sep` in the startsWith check: without it, "/a/skills-evil"
    // would falsely pass since it textually starts with "/a/skills".
    expect(() => assertWithin('/a/skills-evil', '/a/skills', 'test path')).toThrow(
      'Refused: test path escapes the expected directory',
    );
  });

  it('does not throw when target equals base plus a nested subpath exactly', () => {
    expect(() => assertWithin('/a/skills/my-skill/versions/1.0.0', '/a/skills', 'test path')).not.toThrow();
  });
});

describe('goodboy skill version (no --bump)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  it('shows all versions for a skill in the registry', async () => {
    mockReadRegistryEntry.mockResolvedValue(makeEntry());
    await buildProgram().parseAsync(['version', 'my-skill'], { from: 'user' });
    const infoCalls = mockLogger.info.mock.calls.map((c) => c[0]);
    expect(infoCalls.some((l) => l.includes('1.0.0'))).toBe(true);
    expect(infoCalls.some((l) => l.includes('0.9.0'))).toBe(true);
  });

  it('shows latest tag on correct version', async () => {
    mockReadRegistryEntry.mockResolvedValue(makeEntry());
    await buildProgram().parseAsync(['version', 'my-skill'], { from: 'user' });
    const infoCalls = mockLogger.info.mock.calls.map((c) => c[0]);
    expect(infoCalls.some((l) => l.includes('1.0.0') && l.includes('(latest)'))).toBe(true);
    expect(infoCalls.some((l) => l.includes('0.9.0') && l.includes('(latest)'))).toBe(false);
  });

  it('shows yanked tag on yanked versions', async () => {
    mockReadRegistryEntry.mockResolvedValue(makeEntry());
    await buildProgram().parseAsync(['version', 'my-skill'], { from: 'user' });
    const infoCalls = mockLogger.info.mock.calls.map((c) => c[0]);
    expect(infoCalls.some((l) => l.includes('0.9.0') && l.includes('[yanked]'))).toBe(true);
  });

  it('throws clean error when skill not in registry', async () => {
    mockReadRegistryEntry.mockResolvedValue(null);
    await expect(
      buildProgram().parseAsync(['version', 'my-skill'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('not found in registry'));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('sorts by minor and patch when major (and minor) are tied, not just by major', async () => {
    // makeEntry() alone only ever compares differing majors (1 vs 0), which
    // short-circuits the "bMaj - aMaj || bMin - aMin || bPat - aPat" sort
    // comparator on its first term. These versions force every fallback: a
    // pair with equal majors (falls through to minor) and a pair with equal
    // major AND minor (falls all the way through to patch).
    mockReadRegistryEntry.mockResolvedValue({
      name: 'my-skill',
      latest: '1.1.1',
      versions: {
        '1.0.0': { path: 'versions/1.0.0', addedAt: '2026-01-01T00:00:00.000Z', yanked: false },
        '1.1.0': { path: 'versions/1.1.0', addedAt: '2026-02-01T00:00:00.000Z', yanked: false },
        '1.1.1': { path: 'versions/1.1.1', addedAt: '2026-03-01T00:00:00.000Z', yanked: false },
      },
    });
    await buildProgram().parseAsync(['version', 'my-skill'], { from: 'user' });
    const infoCalls = mockLogger.info.mock.calls.map((c) => String(c[0]));
    const order = infoCalls
      .map((l) => /^  (\d+\.\d+\.\d+)/.exec(l)?.[1])
      .filter((v): v is string => Boolean(v));
    expect(order).toEqual(['1.1.1', '1.1.0', '1.0.0']);
  });
});

describe('goodboy skill version --bump', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    mockReadRegistryEntry.mockResolvedValue(makeEntry());
    mockReadManifest.mockResolvedValue({ ...MANIFEST });
    mockWriteManifest.mockResolvedValue(undefined);
    mockWriteRegistryEntry.mockResolvedValue(undefined);
    mockCp.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
  });

  it('creates new version directory in registry', async () => {
    await buildProgram().parseAsync(['version', 'my-skill', '--bump', 'patch'], { from: 'user' });
    expect(mockCp).toHaveBeenCalledWith(
      join(SKILL_DIR, 'versions', '1.0.0'),
      join(SKILL_DIR, 'versions', '1.0.1'),
      { recursive: true },
    );
  });

  it('copies content from latest version', async () => {
    await buildProgram().parseAsync(['version', 'my-skill', '--bump', 'minor'], { from: 'user' });
    expect(mockCp).toHaveBeenCalledWith(
      join(SKILL_DIR, 'versions', '1.0.0'),
      join(SKILL_DIR, 'versions', '1.1.0'),
      { recursive: true },
    );
  });

  it('updates manifest.json version field in new directory', async () => {
    await buildProgram().parseAsync(['version', 'my-skill', '--bump', 'patch'], { from: 'user' });
    expect(mockWriteManifest).toHaveBeenCalledWith(
      join(SKILL_DIR, 'versions', '1.0.1', 'manifest.json'),
      expect.objectContaining({ version: '1.0.1' }),
    );
  });

  it("updates registry-entry.json latest pointer", async () => {
    await buildProgram().parseAsync(['version', 'my-skill', '--bump', 'patch'], { from: 'user' });
    expect(mockWriteRegistryEntry).toHaveBeenCalledWith(
      SKILL_DIR,
      expect.objectContaining({
        latest: '1.0.1',
        versions: expect.objectContaining({ '1.0.1': expect.any(Object) }),
      }),
    );
  });

  it('rejects invalid bump level', async () => {
    await expect(
      buildProgram().parseAsync(['version', 'my-skill', '--bump', 'wat'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Invalid bump level'));
    expect(mockCp).not.toHaveBeenCalled();
  });

  it('rejects --bump when the skill is not found in the registry (createNewVersion\'s own check, not showVersionInfo\'s)', async () => {
    mockReadRegistryEntry.mockResolvedValue(null);
    await expect(
      buildProgram().parseAsync(['version', 'my-skill', '--bump', 'patch'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('not found in registry'));
    expect(mockCp).not.toHaveBeenCalled();
  });

  it('rejects --bump when every version is yanked (no installable version to bump from)', async () => {
    const entry = makeEntry();
    entry.versions['1.0.0']!.yanked = true;
    entry.versions['0.9.0']!.yanked = true;
    mockReadRegistryEntry.mockResolvedValue(entry);
    await expect(
      buildProgram().parseAsync(['version', 'my-skill', '--bump', 'patch'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('No installable version found (all versions are yanked)'),
    );
    expect(mockCp).not.toHaveBeenCalled();
  });

  it('rejects bump when resulting version already exists', async () => {
    const entry = makeEntry();
    // Yanked so it doesn't itself become resolveLatestVersion()'s pick (which
    // would otherwise make currentLatest "1.0.1" and defeat the collision),
    // while still "existing" and blocking reuse of the version number.
    entry.versions['1.0.1'] = { path: 'versions/1.0.1', addedAt: '2026-02-01T00:00:00.000Z', yanked: true };
    mockReadRegistryEntry.mockResolvedValue(entry);
    await expect(
      buildProgram().parseAsync(['version', 'my-skill', '--bump', 'patch'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('already exists in registry'),
    );
    expect(mockCp).not.toHaveBeenCalled();
  });

  it('validates skill name pattern', async () => {
    await expect(
      buildProgram().parseAsync(['version', 'Bad_Name!', '--bump', 'patch'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Invalid skill name'));
    expect(mockReadRegistryEntry).not.toHaveBeenCalled();
  });

  it('prevents path traversal in skill name', async () => {
    await expect(
      buildProgram().parseAsync(['version', '../../etc', '--bump', 'patch'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Invalid skill name'));
    expect(mockCp).not.toHaveBeenCalled();
  });

  it('normalizes schema_version to the base version on bump', async () => {
    // As of schema 2.0.0 no field is feature-stamped, so the minimum any
    // manifest needs is always the major's base version.
    mockReadManifest.mockResolvedValue({ ...MANIFEST, schema_version: '2.0.0' });
    await buildProgram().parseAsync(['version', 'my-skill', '--bump', 'patch'], { from: 'user' });
    expect(mockWriteManifest).toHaveBeenCalledWith(
      join(SKILL_DIR, 'versions', '1.0.1', 'manifest.json'),
      expect.objectContaining({ schema_version: '2.0.0' }),
    );
  });

  it('refuses to bump a newer-minor (tolerated) manifest: validates before acting, no directory ever created', async () => {
    mockReadManifest.mockResolvedValue({ ...MANIFEST, schema_version: '2.5.0', future_field: 'unused' });
    await expect(
      buildProgram().parseAsync(['version', 'my-skill', '--bump', 'patch'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('which is newer than this GoodBoy CLI knows'),
    );
    // Proves validate-then-act ordering: cp() — the only thing that would
    // create versions/<newVersion>/ on disk — never ran, so no orphaned
    // directory is left behind. Not just "writeManifest wasn't called".
    expect(mockCp).not.toHaveBeenCalled();
    expect(mockWriteManifest).not.toHaveBeenCalled();
    // Nothing was ever created, so the cleanup path never runs either.
    expect(mockRm).not.toHaveBeenCalled();
  });

  it('reads the manifest from the SOURCE version directory, before any copy exists', async () => {
    mockReadManifest.mockResolvedValue({ ...MANIFEST, schema_version: '2.5.0' });
    await expect(
      buildProgram().parseAsync(['version', 'my-skill', '--bump', 'patch'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');
    expect(mockReadManifest).toHaveBeenCalledWith(
      join(SKILL_DIR, 'versions', '1.0.0', 'manifest.json'),
    );
  });

  describe('cleanup on failure after the copy', () => {
    it('writeManifest rejecting: removes newVersionDir, propagates the ORIGINAL error (not a cleanup error)', async () => {
      mockWriteManifest.mockRejectedValue(new Error('Cannot write manifest.json: check directory permissions'));
      await expect(
        buildProgram().parseAsync(['version', 'my-skill', '--bump', 'patch'], { from: 'user' }),
      ).rejects.toThrow('process.exit called');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Cannot write manifest.json'),
      );
      expect(mockRm).toHaveBeenCalledWith(
        join(SKILL_DIR, 'versions', '1.0.1'),
        expect.objectContaining({ recursive: true, force: true }),
      );
    });

    it('writeRegistryEntry rejecting: removes newVersionDir, propagates the ORIGINAL error', async () => {
      mockWriteRegistryEntry.mockRejectedValue(new Error('ENOSPC: no space left on device'));
      await expect(
        buildProgram().parseAsync(['version', 'my-skill', '--bump', 'patch'], { from: 'user' }),
      ).rejects.toThrow('process.exit called');
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('ENOSPC'));
      expect(mockRm).toHaveBeenCalledWith(
        join(SKILL_DIR, 'versions', '1.0.1'),
        expect.objectContaining({ recursive: true, force: true }),
      );
    });

    it('cleanup (rm) itself rejecting: the ORIGINAL write error still propagates, not the cleanup error', async () => {
      mockWriteManifest.mockRejectedValue(new Error('original write failure'));
      mockRm.mockRejectedValue(new Error('EACCES: permission denied removing directory'));
      await expect(
        buildProgram().parseAsync(['version', 'my-skill', '--bump', 'patch'], { from: 'user' }),
      ).rejects.toThrow('process.exit called');
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('original write failure'));
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        expect.stringContaining('EACCES'),
      );
      // The cleanup failure is only ever logged as a warning, never surfaces
      // as the command's own error.
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to clean up'),
      );
    });

    it('happy-path bump: rm is never called when nothing fails', async () => {
      await buildProgram().parseAsync(['version', 'my-skill', '--bump', 'patch'], { from: 'user' });
      expect(mockRm).not.toHaveBeenCalled();
    });
  });
});
