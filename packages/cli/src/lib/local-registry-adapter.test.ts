import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Dirent } from 'node:fs';
import type { GoodBoyManifest } from '../types/index.js';

vi.mock('node:fs');
vi.mock('./registry.js');
vi.mock('./manifest.js');
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { existsSync, readdirSync } from 'node:fs';
import { getRegistryPath, getSkillsPath, resolveSkill, listInstalled } from './registry.js';
import { readManifest, validateManifest } from './manifest.js';
import { logger } from './logger.js';
import { LocalRegistryAdapter } from './local-registry-adapter.js';
import { createRegistryAdapter } from './registry-adapter.js';
import { loadFixture } from '../__fixtures__/index.js';

const mockExistsSync = vi.mocked(existsSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockGetRegistryPath = vi.mocked(getRegistryPath);
const mockGetSkillsPath = vi.mocked(getSkillsPath);
const mockResolveSkill = vi.mocked(resolveSkill);
const mockListInstalled = vi.mocked(listInstalled);
const mockReadManifest = vi.mocked(readManifest);
const mockValidateManifest = vi.mocked(validateManifest);
const mockLogger = vi.mocked(logger);

const DEFAULT_REGISTRY = join(homedir(), '.goodboy', 'registry');
const DEFAULT_SKILLS = join(homedir(), '.goodboy', 'skills');

function makeDirent(name: string, isDir: boolean): Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    path: DEFAULT_REGISTRY,
    parentPath: DEFAULT_REGISTRY,
  } as unknown as Dirent;
}

// ---------------------------------------------------------------------------
// createRegistryAdapter()
// ---------------------------------------------------------------------------

describe('createRegistryAdapter()', () => {
  it('returns a LocalRegistryAdapter instance', () => {
    const adapter = createRegistryAdapter();
    expect(adapter).toBeInstanceOf(LocalRegistryAdapter);
  });

  it('returns an object implementing the RegistryAdapter interface', () => {
    const adapter = createRegistryAdapter();
    expect(typeof adapter.resolveSkill).toBe('function');
    expect(typeof adapter.listInstalled).toBe('function');
    expect(typeof adapter.search).toBe('function');
    expect(typeof adapter.getRegistryLocation).toBe('function');
    expect(typeof adapter.getSkillsLocation).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// LocalRegistryAdapter delegation
// ---------------------------------------------------------------------------

describe('LocalRegistryAdapter — delegation to registry.ts', () => {
  let adapter: LocalRegistryAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new LocalRegistryAdapter();
  });

  it('resolveSkill() delegates to registry.resolveSkill()', async () => {
    mockResolveSkill.mockResolvedValue('/some/path/test-skill');
    const result = await adapter.resolveSkill('test-skill');
    expect(mockResolveSkill).toHaveBeenCalledWith('test-skill');
    expect(result).toBe('/some/path/test-skill');
  });

  it('listInstalled() delegates to registry.listInstalled()', async () => {
    const fixture = loadFixture('valid-minimal') as GoodBoyManifest;
    mockListInstalled.mockResolvedValue([fixture]);
    const result = await adapter.listInstalled();
    expect(mockListInstalled).toHaveBeenCalled();
    expect(result).toEqual([fixture]);
  });

  it('getRegistryLocation() delegates to registry.getRegistryPath()', () => {
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
    expect(adapter.getRegistryLocation()).toBe(DEFAULT_REGISTRY);
    expect(mockGetRegistryPath).toHaveBeenCalled();
  });

  it('getSkillsLocation() delegates to registry.getSkillsPath()', () => {
    mockGetSkillsPath.mockReturnValue(DEFAULT_SKILLS);
    expect(adapter.getSkillsLocation()).toBe(DEFAULT_SKILLS);
    expect(mockGetSkillsPath).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// LocalRegistryAdapter.search()
// ---------------------------------------------------------------------------

describe('LocalRegistryAdapter.search()', () => {
  let adapter: LocalRegistryAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new LocalRegistryAdapter();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns [] when getRegistryPath() throws', async () => {
    mockGetRegistryPath.mockImplementation(() => { throw new Error('no registry'); });
    const result = await adapter.search('anything');
    expect(result).toEqual([]);
  });

  it('returns [] when the registry directory does not exist', async () => {
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
    mockExistsSync.mockReturnValue(false);
    const result = await adapter.search('test');
    expect(result).toEqual([]);
  });

  it('returns [] when registry is empty', async () => {
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);
    const result = await adapter.search('test');
    expect(result).toEqual([]);
  });

  it('skips non-directory entries', async () => {
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([makeDirent('readme.txt', false)] as unknown as ReturnType<typeof readdirSync>);
    const result = await adapter.search('readme');
    expect(result).toEqual([]);
    expect(mockReadManifest).not.toHaveBeenCalled();
  });

  it('warns and skips skills with unreadable manifests', async () => {
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([makeDirent('bad-skill', true)] as unknown as ReturnType<typeof readdirSync>);
    mockReadManifest.mockRejectedValue(new Error('not found'));
    const result = await adapter.search('bad');
    expect(result).toEqual([]);
    // No not.toContain(path) check needed: readManifest/validateManifest errors are
    // hardcoded static strings that never interpolate the resolved filesystem path.
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('"bad-skill"'));
  });

  it('returns matching skills by name', async () => {
    const fixture = loadFixture('valid-minimal') as GoodBoyManifest;
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([makeDirent('test-skill', true)] as unknown as ReturnType<typeof readdirSync>);
    mockReadManifest.mockResolvedValue(fixture);
    mockValidateManifest.mockReturnValue(fixture);

    const result = await adapter.search('test');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(fixture);
  });

  it('returns matching skills by description', async () => {
    const fixture = loadFixture('valid-minimal') as GoodBoyManifest;
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([makeDirent('some-skill', true)] as unknown as ReturnType<typeof readdirSync>);
    mockReadManifest.mockResolvedValue(fixture);
    mockValidateManifest.mockReturnValue(fixture);

    // valid-minimal has description "A minimal test skill for unit testing"
    const result = await adapter.search('minimal');
    expect(result).toHaveLength(1);
  });

  it('returns matching skills by keyword', async () => {
    const fixture = loadFixture('valid-complete') as GoodBoyManifest;
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([makeDirent('complete-skill', true)] as unknown as ReturnType<typeof readdirSync>);
    mockReadManifest.mockResolvedValue(fixture);
    mockValidateManifest.mockReturnValue(fixture);

    // valid-complete has keywords: ["test", "example", "complete"]
    const result = await adapter.search('example');
    expect(result).toHaveLength(1);
  });

  it('returns matching skills by category', async () => {
    const fixture = loadFixture('valid-complete') as GoodBoyManifest;
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([makeDirent('complete-skill', true)] as unknown as ReturnType<typeof readdirSync>);
    mockReadManifest.mockResolvedValue(fixture);
    mockValidateManifest.mockReturnValue(fixture);

    // valid-complete has category: "code"
    const result = await adapter.search('code');
    expect(result).toHaveLength(1);
  });

  it('returns matching skills by tag', async () => {
    const fixture = loadFixture('valid-complete') as GoodBoyManifest;
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([makeDirent('complete-skill', true)] as unknown as ReturnType<typeof readdirSync>);
    mockReadManifest.mockResolvedValue(fixture);
    mockValidateManifest.mockReturnValue(fixture);

    // valid-complete has tags: ["testing", "workflow"]
    const result = await adapter.search('testing');
    expect(result).toHaveLength(1);
  });

  it('excludes non-matching skills', async () => {
    const fixture = loadFixture('valid-minimal') as GoodBoyManifest;
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([makeDirent('test-skill', true)] as unknown as ReturnType<typeof readdirSync>);
    mockReadManifest.mockResolvedValue(fixture);
    mockValidateManifest.mockReturnValue(fixture);

    const result = await adapter.search('zzznomatchzzz');
    expect(result).toEqual([]);
  });

  it('is case-insensitive', async () => {
    const fixture = loadFixture('valid-minimal') as GoodBoyManifest;
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([makeDirent('test-skill', true)] as unknown as ReturnType<typeof readdirSync>);
    mockReadManifest.mockResolvedValue(fixture);
    mockValidateManifest.mockReturnValue(fixture);

    // query uppercase, name is lowercase
    const result = await adapter.search('TEST');
    expect(result).toHaveLength(1);
  });

  it('matches skill without keywords against keyword query (no match)', async () => {
    const fixture = loadFixture('valid-minimal') as GoodBoyManifest;
    // valid-minimal has no keywords field
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([makeDirent('test-skill', true)] as unknown as ReturnType<typeof readdirSync>);
    mockReadManifest.mockResolvedValue(fixture);
    mockValidateManifest.mockReturnValue(fixture);

    // "keyword-only" won't match name, description, or category
    const result = await adapter.search('keyword-only-query-xyz');
    expect(result).toEqual([]);
  });

  it('returns manifests in the order they appear in the registry directory', async () => {
    const fixture = loadFixture('valid-minimal') as GoodBoyManifest;
    const fixture2: GoodBoyManifest = { ...fixture, name: 'test-skill-2', description: 'Another test skill' };
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([
      makeDirent('test-skill', true),
      makeDirent('test-skill-2', true),
    ] as unknown as ReturnType<typeof readdirSync>);
    mockReadManifest
      .mockResolvedValueOnce(fixture)
      .mockResolvedValueOnce(fixture2);
    mockValidateManifest
      .mockReturnValueOnce(fixture)
      .mockReturnValueOnce(fixture2);

    const result = await adapter.search('test');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(fixture);
    expect(result[1]).toEqual(fixture2);
  });
});
