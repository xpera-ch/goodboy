import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import type { Dirent } from 'node:fs';

vi.mock('node:fs');
vi.mock('node:fs/promises');
vi.mock('./manifest.js');
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { readdir, readlink } from 'node:fs/promises';
import { readManifest, validateManifest } from './manifest.js';
import { logger } from './logger.js';
import {
  getRegistryPath,
  getSkillsPath,
  resolveSkill,
  listInstalled,
  scanForSymlinks,
} from './registry.js';
import { loadFixture } from '../__fixtures__/index.js';

const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockReaddir = vi.mocked(readdir);
const mockReadlink = vi.mocked(readlink);
const mockReadManifest = vi.mocked(readManifest);
const mockValidateManifest = vi.mocked(validateManifest);
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

  it('throws if the absolute path does not exist', () => {
    vi.stubEnv('GOODBOY_REGISTRY', '/nonexistent/registry');
    mockExistsSync.mockReturnValue(false);
    expect(() => getRegistryPath())
      .toThrow('GOODBOY_REGISTRY path does not exist: "/nonexistent/registry"');
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

  it('returns the full skill path for a valid name that exists', async () => {
    mockExistsSync.mockReturnValue(true);
    const result = await resolveSkill('my-skill');
    expect(result).toBe(join(DEFAULT_REGISTRY, 'my-skill'));
  });

  it('rejects names with uppercase letters', async () => {
    await expect(resolveSkill('MySkill'))
      .rejects.toThrow('Invalid skill name "MySkill": must match ^[a-z0-9-]+$');
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it('rejects names with underscores', async () => {
    await expect(resolveSkill('my_skill'))
      .rejects.toThrow('Invalid skill name "my_skill"');
  });

  it('rejects names with path separators', async () => {
    await expect(resolveSkill('foo/bar'))
      .rejects.toThrow('Invalid skill name "foo/bar"');
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it('rejects names with dots', async () => {
    await expect(resolveSkill('..'))
      .rejects.toThrow('Invalid skill name ".."');
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it('rejects empty string name', async () => {
    await expect(resolveSkill(''))
      .rejects.toThrow('Invalid skill name ""');
    expect(mockExistsSync).not.toHaveBeenCalled();
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
    mockExistsSync.mockReturnValue(false);
    await expect(resolveSkill('missing-skill'))
      .rejects.toThrow('Skill "missing-skill" not found in registry');
  });

  it('resolves to a path that starts with registryPath + separator', async () => {
    mockExistsSync.mockReturnValue(true);
    const result = await resolveSkill('some-skill');
    expect(result.startsWith(DEFAULT_REGISTRY + sep)).toBe(true);
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
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it('rejects a name containing a null byte', async () => {
    await expect(resolveSkill('my-skill\x00evil'))
      .rejects.toThrow('Skill name contains invalid characters');
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it('rejects a name with leading whitespace', async () => {
    await expect(resolveSkill(' my-skill'))
      .rejects.toThrow('Skill name contains invalid characters');
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it('rejects a name with trailing whitespace', async () => {
    await expect(resolveSkill('my-skill '))
      .rejects.toThrow('Skill name contains invalid characters');
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it('rejects %2F (forward slash encoding)', async () => {
    await expect(resolveSkill('foo%2Fbar'))
      .rejects.toThrow('Skill name contains invalid characters');
  });

  it('rejects a malformed percent sequence (bare %) via SKILL_NAME_RE after decode fails', async () => {
    // decodeURIComponent('%') throws URIError; catch sets decoded = '%'
    // normalized = '%', which then fails SKILL_NAME_RE
    await expect(resolveSkill('%'))
      .rejects.toThrow('Invalid skill name "%"');
    expect(mockExistsSync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// scanForSymlinks() — HARDENING 2
// ---------------------------------------------------------------------------

function makeFsDirent(
  name: string,
  opts: { isDir?: boolean; isSymlink?: boolean },
): Dirent {
  return {
    name,
    isDirectory: () => !!opts.isDir,
    isFile: () => !opts.isDir && !opts.isSymlink,
    isSymbolicLink: () => !!opts.isSymlink,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    path: '/skill',
    parentPath: '/skill',
  } as unknown as Dirent;
}

describe('scanForSymlinks()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves without error when the directory has no symlinks', async () => {
    mockReaddir.mockResolvedValue([
      makeFsDirent('file.ts', { isDir: false }),
    ] as unknown as Awaited<ReturnType<typeof readdir>>);
    await expect(scanForSymlinks('/skill')).resolves.toBeUndefined();
  });

  it('recurses into subdirectories', async () => {
    mockReaddir
      .mockResolvedValueOnce([
        makeFsDirent('sub', { isDir: true }),
      ] as unknown as Awaited<ReturnType<typeof readdir>>)
      .mockResolvedValueOnce([
        makeFsDirent('inner.ts', { isDir: false }),
      ] as unknown as Awaited<ReturnType<typeof readdir>>);
    await expect(scanForSymlinks('/skill')).resolves.toBeUndefined();
    expect(mockReaddir).toHaveBeenCalledTimes(2);
  });

  it('throws when a symlink points outside the skill directory', async () => {
    mockReaddir.mockResolvedValue([
      makeFsDirent('evil-link', { isSymlink: true }),
    ] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockReadlink.mockResolvedValue('/etc/passwd');

    await expect(scanForSymlinks('/skill')).rejects.toThrow(
      'Security: skill contains a symlink pointing outside its directory',
    );
  });

  it('error message includes the symlink path and resolved target', async () => {
    mockReaddir.mockResolvedValue([
      makeFsDirent('link', { isSymlink: true }),
    ] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockReadlink.mockResolvedValue('/etc/secret');

    const err = await scanForSymlinks('/skill').catch((e: unknown) => e as Error);
    expect((err as Error).message).toContain('/skill/link');
    expect((err as Error).message).toContain('/etc/secret');
  });

  it('permits a symlink pointing inside the skill directory', async () => {
    mockReaddir.mockResolvedValue([
      makeFsDirent('internal-link', { isSymlink: true }),
    ] as unknown as Awaited<ReturnType<typeof readdir>>);
    // Relative target resolves to /skill/target — inside /skill
    mockReadlink.mockResolvedValue('target');

    await expect(scanForSymlinks('/skill')).resolves.toBeUndefined();
  });

  it('rejects a symlink with a relative target that escapes the directory', async () => {
    mockReaddir.mockResolvedValue([
      makeFsDirent('escape-link', { isSymlink: true }),
    ] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockReadlink.mockResolvedValue('../../etc/passwd');

    await expect(scanForSymlinks('/skill')).rejects.toThrow(
      'Security: skill contains a symlink pointing outside its directory',
    );
  });
});
