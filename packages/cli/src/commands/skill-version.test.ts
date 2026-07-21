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

import { cp } from 'node:fs/promises';
import { readRegistryEntry, writeRegistryEntry } from '../lib/registry-entry.js';
import { readManifest, writeManifest } from '../lib/manifest.js';
import { logger } from '../lib/logger.js';
import { bumpVersion, registerSkillVersion } from './skill-version.js';

const mockCp = vi.mocked(cp);
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
  schema_version: '1.0.0',
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

  it('stamps schema_version 1.1.0 on the written manifest when it declares requires', async () => {
    mockReadManifest.mockResolvedValue({
      ...MANIFEST,
      schema_version: '1.1.0',
      permissions: ['env'],
      requires: { secrets: ['EXOSCALE_API_KEY'] },
    });
    await buildProgram().parseAsync(['version', 'my-skill', '--bump', 'patch'], { from: 'user' });
    expect(mockWriteManifest).toHaveBeenCalledWith(
      join(SKILL_DIR, 'versions', '1.0.1', 'manifest.json'),
      expect.objectContaining({ schema_version: '1.1.0' }),
    );
  });

  it('normalizes schema_version to 1.0.0 on bump for a strictly-valid, over-stamped manifest with no requires', async () => {
    // 1.1.0 is within the known range (no tolerance warning) but is more than
    // this manifest actually needs, since it declares no `requires`.
    mockReadManifest.mockResolvedValue({ ...MANIFEST, schema_version: '1.1.0' });
    await buildProgram().parseAsync(['version', 'my-skill', '--bump', 'patch'], { from: 'user' });
    expect(mockWriteManifest).toHaveBeenCalledWith(
      join(SKILL_DIR, 'versions', '1.0.1', 'manifest.json'),
      expect.objectContaining({ schema_version: '1.0.0' }),
    );
  });

  it('refuses to bump a newer-minor (tolerated) manifest: throws, writeManifest never called', async () => {
    mockReadManifest.mockResolvedValue({ ...MANIFEST, schema_version: '1.5.0', future_field: 'unused' });
    await expect(
      buildProgram().parseAsync(['version', 'my-skill', '--bump', 'patch'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('which is newer than this GoodBoy CLI knows'),
    );
    expect(mockWriteManifest).not.toHaveBeenCalled();
  });
});
