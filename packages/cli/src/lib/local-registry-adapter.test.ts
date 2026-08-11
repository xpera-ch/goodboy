import { describe, it, expect, vi, beforeEach } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { GoodBoyManifest } from '../types/index.js';

vi.mock('./registry.js');
vi.mock('./manifest.js');
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { getRegistryPath, getSkillsPath, resolveSkill, listInstalled, listRegistry } from './registry.js';
import { readManifest, validateManifest } from './manifest.js';
import { logger } from './logger.js';
import { LocalRegistryAdapter } from './local-registry-adapter.js';
import { createRegistryAdapter } from './registry-adapter.js';
import { loadFixture } from '../__fixtures__/index.js';
import type { RegistryEntry } from './registry-entry.js';

const mockGetRegistryPath = vi.mocked(getRegistryPath);
const mockGetSkillsPath = vi.mocked(getSkillsPath);
const mockResolveSkill = vi.mocked(resolveSkill);
const mockListInstalled = vi.mocked(listInstalled);
const mockListRegistry = vi.mocked(listRegistry);
const mockReadManifest = vi.mocked(readManifest);
const mockValidateManifest = vi.mocked(validateManifest);
const mockLogger = vi.mocked(logger);

const DEFAULT_REGISTRY = join(homedir(), '.goodboy', 'registry');
const DEFAULT_SKILLS = join(homedir(), '.goodboy', 'skills');

function makeRegistryEntry(name: string, version = '0.1.0'): RegistryEntry {
  return {
    name,
    latest: version,
    versions: {
      [version]: {
        path: `versions/${version}`,
        addedAt: '2026-01-01T00:00:00Z',
        yanked: false,
      },
    },
  };
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
    expect(typeof adapter.listRegistry).toBe('function');
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

  it('listRegistry() delegates to registry.listRegistry()', async () => {
    const entry = makeRegistryEntry('test-skill');
    mockListRegistry.mockResolvedValue([entry]);
    const result = await adapter.listRegistry();
    expect(mockListRegistry).toHaveBeenCalled();
    expect(result).toEqual([entry]);
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

  it('returns [] when listRegistry() throws', async () => {
    mockListRegistry.mockRejectedValue(new Error('registry error'));
    const result = await adapter.search('anything');
    expect(result).toEqual([]);
  });

  it('returns [] when the registry is empty', async () => {
    mockListRegistry.mockResolvedValue([]);
    const result = await adapter.search('test');
    expect(result).toEqual([]);
  });

  it('returns [] when getRegistryPath() throws after listRegistry() succeeds', async () => {
    mockListRegistry.mockResolvedValue([makeRegistryEntry('test-skill')]);
    mockGetRegistryPath.mockImplementation(() => { throw new Error('no registry'); });
    const result = await adapter.search('test');
    expect(result).toEqual([]);
  });

  it('warns and skips skills with unreadable manifests', async () => {
    mockListRegistry.mockResolvedValue([makeRegistryEntry('bad-skill')]);
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
    mockReadManifest.mockRejectedValue(new Error('not found'));
    const result = await adapter.search('bad');
    expect(result).toEqual([]);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('"bad-skill"'));
  });

  it('skips skills whose latest version is yanked', async () => {
    const entry: RegistryEntry = {
      name: 'yanked-skill',
      latest: '1.0.0',
      versions: {
        '1.0.0': { path: 'versions/1.0.0', addedAt: '2026-01-01T00:00:00Z', yanked: true },
      },
    };
    mockListRegistry.mockResolvedValue([entry]);
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
    const result = await adapter.search('yanked');
    expect(result).toEqual([]);
    expect(mockReadManifest).not.toHaveBeenCalled();
  });

  it('returns matching skills by name', async () => {
    const fixture = loadFixture('valid-minimal') as GoodBoyManifest;
    mockListRegistry.mockResolvedValue([makeRegistryEntry('test-skill')]);
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
    mockReadManifest.mockResolvedValue(fixture);
    mockValidateManifest.mockReturnValue(fixture);

    const result = await adapter.search('test');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(fixture);
  });

  it('returns matching skills by description', async () => {
    const fixture = loadFixture('valid-minimal') as GoodBoyManifest;
    mockListRegistry.mockResolvedValue([makeRegistryEntry('some-skill')]);
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
    mockReadManifest.mockResolvedValue(fixture);
    mockValidateManifest.mockReturnValue(fixture);

    // valid-minimal has description "A minimal test skill for unit testing"
    const result = await adapter.search('minimal');
    expect(result).toHaveLength(1);
  });

  it('returns matching skills by keyword', async () => {
    const fixture = loadFixture('valid-complete') as GoodBoyManifest;
    mockListRegistry.mockResolvedValue([makeRegistryEntry('complete-skill')]);
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
    mockReadManifest.mockResolvedValue(fixture);
    mockValidateManifest.mockReturnValue(fixture);

    // valid-complete has keywords: ["test", "example", "complete"]
    const result = await adapter.search('example');
    expect(result).toHaveLength(1);
  });

  it('returns matching skills by category', async () => {
    const fixture = loadFixture('valid-complete') as GoodBoyManifest;
    mockListRegistry.mockResolvedValue([makeRegistryEntry('complete-skill')]);
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
    mockReadManifest.mockResolvedValue(fixture);
    mockValidateManifest.mockReturnValue(fixture);

    // valid-complete has category: "code"
    const result = await adapter.search('code');
    expect(result).toHaveLength(1);
  });

  it('excludes non-matching skills', async () => {
    const fixture = loadFixture('valid-minimal') as GoodBoyManifest;
    mockListRegistry.mockResolvedValue([makeRegistryEntry('test-skill')]);
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
    mockReadManifest.mockResolvedValue(fixture);
    mockValidateManifest.mockReturnValue(fixture);

    const result = await adapter.search('zzznomatchzzz');
    expect(result).toEqual([]);
  });

  it('is case-insensitive', async () => {
    const fixture = loadFixture('valid-minimal') as GoodBoyManifest;
    mockListRegistry.mockResolvedValue([makeRegistryEntry('test-skill')]);
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
    mockReadManifest.mockResolvedValue(fixture);
    mockValidateManifest.mockReturnValue(fixture);

    const result = await adapter.search('TEST');
    expect(result).toHaveLength(1);
  });

  it('returns manifests in registry order', async () => {
    const fixture = loadFixture('valid-minimal') as GoodBoyManifest;
    const fixture2: GoodBoyManifest = { ...fixture, name: 'test-skill-2', description: 'Another test skill' };
    mockListRegistry.mockResolvedValue([
      makeRegistryEntry('test-skill'),
      makeRegistryEntry('test-skill-2'),
    ]);
    mockGetRegistryPath.mockReturnValue(DEFAULT_REGISTRY);
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
