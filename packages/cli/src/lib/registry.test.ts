import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import type { Dirent } from 'node:fs';

vi.mock('node:fs');
vi.mock('node:fs/promises');
vi.mock('./manifest.js');
vi.mock('./registry-entry.js');
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { readManifest, validateManifest } from './manifest.js';
import {
  readRegistryEntry,
  resolveLatestVersion,
  resolveVersionPath,
} from './registry-entry.js';
import { logger } from './logger.js';
import {
  getRegistryPath,
  getSkillsPath,
  resolveSkill,
  ensureRegistryExists,
  listRegistry,
  listInstalled,
} from './registry.js';
import type { RegistryEntry } from './registry-entry.js';
import { loadFixture } from '../__fixtures__/index.js';

const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockReadManifest = vi.mocked(readManifest);
const mockValidateManifest = vi.mocked(validateManifest);
const mockReadRegistryEntry = vi.mocked(readRegistryEntry);
const mockResolveLatestVersion = vi.mocked(resolveLatestVersion);
const mockResolveVersionPath = vi.mocked(resolveVersionPath);
const mockLoggerWarn = vi.mocked(logger.warn);

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
    path: DEFAULT_SKILLS,
    parentPath: DEFAULT_SKILLS,
  } as unknown as Dirent;
}

function makeRegistryEntry(name = 'my-skill', version = '1.0.0'): RegistryEntry {
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
// getRegistryPath()
// ---------------------------------------------------------------------------

describe('getRegistryPath()', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('returns the default path when GOODBOY_REGISTRY is not set', () => {
    vi.stubEnv('GOODBOY_REGISTRY', '');
    expect(getRegistryPath()).toBe(DEFAULT_REGISTRY);
  });

  it('returns the default path when GOODBOY_REGISTRY is undefined', () => {
    delete process.env['GOODBOY_REGISTRY'];
    expect(getRegistryPath()).toBe(DEFAULT_REGISTRY);
  });

  it('rejects path traversal sequences', () => {
    vi.stubEnv('GOODBOY_REGISTRY', '/valid/path/../../../etc');
    expect(() => getRegistryPath())
      .toThrow('GOODBOY_REGISTRY must not contain path traversal sequences');
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it('rejects relative paths', () => {
    vi.stubEnv('GOODBOY_REGISTRY', 'relative/path/registry');
    expect(() => getRegistryPath())
      .toThrow('GOODBOY_REGISTRY must be an absolute path');
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it('warns and falls back to default when the absolute path does not exist', () => {
    vi.stubEnv('GOODBOY_REGISTRY', '/nonexistent/registry');
    mockExistsSync.mockReturnValue(false);
    const result = getRegistryPath();
    expect(result).toBe(DEFAULT_REGISTRY);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('/nonexistent/registry'),
    );
  });

  it('returns the resolved path when the env var points to an existing directory', () => {
    vi.stubEnv('GOODBOY_REGISTRY', '/custom/registry');
    mockExistsSync.mockReturnValue(true);
    expect(getRegistryPath()).toBe('/custom/registry');
  });

  it('rejects traversal before calling existsSync', () => {
    vi.stubEnv('GOODBOY_REGISTRY', '/valid/../../etc');
    expect(() => getRegistryPath()).toThrow('path traversal');
    expect(mockExistsSync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getSkillsPath()
// ---------------------------------------------------------------------------

describe('getSkillsPath()', () => {
  it('returns the default skills path', () => {
    expect(getSkillsPath()).toBe(DEFAULT_SKILLS);
  });
});

// ---------------------------------------------------------------------------
// ensureRegistryExists()
// ---------------------------------------------------------------------------

describe('ensureRegistryExists()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['GOODBOY_REGISTRY'];
  });

  it('creates the registry directory with mode 0o700 when it does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    ensureRegistryExists();
    expect(mockMkdirSync).toHaveBeenCalledWith(
      DEFAULT_REGISTRY,
      expect.objectContaining({ recursive: true, mode: 0o700 }),
    );
  });

  it('does not create the directory when it already exists', () => {
    mockExistsSync.mockReturnValue(true);
    ensureRegistryExists();
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resolveSkill()
// ---------------------------------------------------------------------------

describe('resolveSkill()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['GOODBOY_REGISTRY'];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the versioned skill path for a valid name that exists', async () => {
    const entry = makeRegistryEntry();
    mockReadRegistryEntry.mockResolvedValue(entry);
    mockResolveLatestVersion.mockReturnValue('1.0.0');
    mockResolveVersionPath.mockReturnValue(join(DEFAULT_REGISTRY, 'my-skill', 'versions', '1.0.0'));

    const result = await resolveSkill('my-skill');
    expect(result).toBe(join(DEFAULT_REGISTRY, 'my-skill', 'versions', '1.0.0'));
    expect(mockReadRegistryEntry).toHaveBeenCalledWith(join(DEFAULT_REGISTRY, 'my-skill'));
  });

  it('resolves a specific version when provided', async () => {
    const entry = makeRegistryEntry('my-skill', '2.0.0');
    mockReadRegistryEntry.mockResolvedValue(entry);
    mockResolveVersionPath.mockReturnValue(join(DEFAULT_REGISTRY, 'my-skill', 'versions', '2.0.0'));

    const result = await resolveSkill('my-skill', '2.0.0');
    expect(result).toBe(join(DEFAULT_REGISTRY, 'my-skill', 'versions', '2.0.0'));
    expect(mockResolveLatestVersion).not.toHaveBeenCalled();
  });

  it('rejects names with uppercase letters', async () => {
    await expect(resolveSkill('MySkill'))
      .rejects.toThrow('Invalid skill name "MySkill": must match ^[a-z0-9-]+$');
    expect(mockReadRegistryEntry).not.toHaveBeenCalled();
  });

  it('rejects names with underscores', async () => {
    await expect(resolveSkill('my_skill'))
      .rejects.toThrow('Invalid skill name "my_skill"');
  });

  it('rejects names with path separators', async () => {
    await expect(resolveSkill('foo/bar'))
      .rejects.toThrow('Invalid skill name "foo/bar"');
    expect(mockReadRegistryEntry).not.toHaveBeenCalled();
  });

  it('rejects names with dots', async () => {
    await expect(resolveSkill('..'))
      .rejects.toThrow('Invalid skill name ".."');
    expect(mockReadRegistryEntry).not.toHaveBeenCalled();
  });

  it('rejects empty string name', async () => {
    await expect(resolveSkill(''))
      .rejects.toThrow('Invalid skill name ""');
    expect(mockReadRegistryEntry).not.toHaveBeenCalled();
  });

  it('rejects names with spaces', async () => {
    await expect(resolveSkill('my skill'))
      .rejects.toThrow('Invalid skill name "my skill"');
  });

  it('rejects names with shell metacharacters', async () => {
    await expect(resolveSkill('my;skill'))
      .rejects.toThrow('Invalid skill name "my;skill"');
  });

  it('throws when the skill is not found in the registry', async () => {
    mockReadRegistryEntry.mockResolvedValue(null);
    await expect(resolveSkill('missing-skill'))
      .rejects.toThrow('Skill "missing-skill" not found in registry');
  });

  it('throws when all versions are yanked', async () => {
    const entry = makeRegistryEntry();
    mockReadRegistryEntry.mockResolvedValue(entry);
    mockResolveLatestVersion.mockReturnValue(null);
    await expect(resolveSkill('my-skill'))
      .rejects.toThrow('Skill "my-skill" has no available versions');
  });

  it('resolves to a path that starts with registryPath + separator', async () => {
    const entry = makeRegistryEntry();
    const versionedPath = join(DEFAULT_REGISTRY, 'some-skill', 'versions', '1.0.0');
    mockReadRegistryEntry.mockResolvedValue(entry);
    mockResolveLatestVersion.mockReturnValue('1.0.0');
    mockResolveVersionPath.mockReturnValue(versionedPath);

    const result = await resolveSkill('some-skill');
    expect(result.startsWith(DEFAULT_REGISTRY + sep)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveSkill() — name normalisation hardening (HARDENING 5)
// ---------------------------------------------------------------------------

describe('resolveSkill() — name normalisation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['GOODBOY_REGISTRY'];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects a URL-encoded path traversal (..%2F)', async () => {
    await expect(resolveSkill('..%2Fetc'))
      .rejects.toThrow('Skill name contains invalid characters');
    expect(mockReadRegistryEntry).not.toHaveBeenCalled();
  });

  it('rejects a name containing a null byte', async () => {
    await expect(resolveSkill('my-skill\x00evil'))
      .rejects.toThrow('Skill name contains invalid characters');
    expect(mockReadRegistryEntry).not.toHaveBeenCalled();
  });

  it('rejects a name with leading whitespace', async () => {
    await expect(resolveSkill(' my-skill'))
      .rejects.toThrow('Skill name contains invalid characters');
    expect(mockReadRegistryEntry).not.toHaveBeenCalled();
  });

  it('rejects a name with trailing whitespace', async () => {
    await expect(resolveSkill('my-skill '))
      .rejects.toThrow('Skill name contains invalid characters');
    expect(mockReadRegistryEntry).not.toHaveBeenCalled();
  });

  it('rejects %2F (forward slash encoding)', async () => {
    await expect(resolveSkill('foo%2Fbar'))
      .rejects.toThrow('Skill name contains invalid characters');
  });

  it('rejects a malformed percent sequence (bare %) via SKILL_NAME_RE after decode fails', async () => {
    await expect(resolveSkill('%'))
      .rejects.toThrow('Invalid skill name "%"');
    expect(mockReadRegistryEntry).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listRegistry()
// ---------------------------------------------------------------------------

describe('listRegistry()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['GOODBOY_REGISTRY'];
  });

  it('returns [] when registry directory does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const result = await listRegistry();
    expect(result).toEqual([]);
  });

  it('returns [] when registry directory is empty', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);
    const result = await listRegistry();
    expect(result).toEqual([]);
  });

  it('skips non-directory entries', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([makeDirent('readme.txt', false)] as unknown as ReturnType<typeof readdirSync>);
    const result = await listRegistry();
    expect(result).toHaveLength(0);
    expect(mockReadRegistryEntry).not.toHaveBeenCalled();
  });

  it('returns entries for skills with registry-entry.json', async () => {
    const entry = makeRegistryEntry();
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([makeDirent('my-skill', true)] as unknown as ReturnType<typeof readdirSync>);
    mockReadRegistryEntry.mockResolvedValue(entry);

    const result = await listRegistry();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(entry);
  });

  it('skips skill directories with no registry-entry.json', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([makeDirent('orphan-skill', true)] as unknown as ReturnType<typeof readdirSync>);
    mockReadRegistryEntry.mockResolvedValue(null);

    const result = await listRegistry();
    expect(result).toHaveLength(0);
  });

  it('reads registry-entry.json from <registryPath>/<skillName>', async () => {
    const entry = makeRegistryEntry();
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([makeDirent('my-skill', true)] as unknown as ReturnType<typeof readdirSync>);
    mockReadRegistryEntry.mockResolvedValue(entry);

    await listRegistry();
    expect(mockReadRegistryEntry).toHaveBeenCalledWith(join(DEFAULT_REGISTRY, 'my-skill'));
  });
});

// ---------------------------------------------------------------------------
// listInstalled()
// ---------------------------------------------------------------------------

describe('listInstalled()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['GOODBOY_REGISTRY'];
  });

  it('creates the skills directory with mode 0o700 when it does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    await listInstalled();
    expect(mockMkdirSync).toHaveBeenCalledWith(
      DEFAULT_SKILLS,
      expect.objectContaining({ recursive: true, mode: 0o700 }),
    );
  });

  it('returns an empty array when the skills directory does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const result = await listInstalled();
    expect(result).toEqual([]);
  });

  it('returns an empty array when the skills directory is empty', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);
    const result = await listInstalled();
    expect(result).toEqual([]);
  });

  it('returns manifests for valid skill directories', async () => {
    const fixture = loadFixture('valid-minimal');
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([makeDirent('test-skill', true)] as unknown as ReturnType<typeof readdirSync>);
    mockReadManifest.mockResolvedValue(fixture);
    mockValidateManifest.mockReturnValue(fixture as ReturnType<typeof validateManifest>);

    const result = await listInstalled();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(fixture);
  });

  it('skips non-directory entries', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([
      makeDirent('some-file.txt', false),
    ] as unknown as ReturnType<typeof readdirSync>);

    const result = await listInstalled();
    expect(result).toHaveLength(0);
    expect(mockReadManifest).not.toHaveBeenCalled();
  });

  it('skips directories with invalid manifests and logs a warning', async () => {
    const fixture = loadFixture('valid-minimal');
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([
      makeDirent('bad-skill', true),
      makeDirent('good-skill', true),
    ] as unknown as ReturnType<typeof readdirSync>);

    mockReadManifest
      .mockRejectedValueOnce(new Error('manifest.json not found'))
      .mockResolvedValueOnce(fixture);
    mockValidateManifest.mockReturnValue(fixture as ReturnType<typeof validateManifest>);

    const result = await listInstalled();
    expect(result).toHaveLength(1);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('bad-skill'),
    );
  });

  it('includes the error message in the warning when a manifest is invalid', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([makeDirent('broken', true)] as unknown as ReturnType<typeof readdirSync>);
    mockReadManifest.mockRejectedValue(new Error('manifest.json contains invalid JSON'));

    await listInstalled();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('manifest.json contains invalid JSON'),
    );
  });

  it('does not re-throw when some manifests fail — returns valid ones only', async () => {
    const fixture = loadFixture('valid-minimal');
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([
      makeDirent('bad-1', true),
      makeDirent('bad-2', true),
      makeDirent('good', true),
    ] as unknown as ReturnType<typeof readdirSync>);

    mockReadManifest
      .mockRejectedValueOnce(new Error('bad-1 broken'))
      .mockRejectedValueOnce(new Error('bad-2 broken'))
      .mockResolvedValueOnce(fixture);
    mockValidateManifest.mockReturnValue(fixture as ReturnType<typeof validateManifest>);

    await expect(listInstalled()).resolves.toHaveLength(1);
  });

  it('reads manifests from <skillsPath>/<dirName>/manifest.json', async () => {
    const fixture = loadFixture('valid-minimal');
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([makeDirent('my-skill', true)] as unknown as ReturnType<typeof readdirSync>);
    mockReadManifest.mockResolvedValue(fixture);
    mockValidateManifest.mockReturnValue(fixture as ReturnType<typeof validateManifest>);

    await listInstalled();
    expect(mockReadManifest).toHaveBeenCalledWith(
      join(DEFAULT_SKILLS, 'my-skill', 'manifest.json'),
    );
  });

  it('logs a generic warning when a non-Error is thrown during manifest loading', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([makeDirent('weird', true)] as unknown as ReturnType<typeof readdirSync>);
    mockReadManifest.mockRejectedValue('a plain string error');

    await listInstalled();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('invalid manifest'),
    );
  });
});
