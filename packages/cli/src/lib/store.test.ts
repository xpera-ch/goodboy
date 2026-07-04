import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';

vi.mock('node:fs');
vi.mock('./fs-security.js');

import { existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { scanForSymlinks } from './fs-security.js';
import {
  getStorePath,
  ensureStoreExists,
  installToStore,
  removeFromStore,
} from './store.js';

const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync  = vi.mocked(mkdirSync);
const mockCpSync     = vi.mocked(cpSync);
const mockRmSync     = vi.mocked(rmSync);
const mockScanForSymlinks = vi.mocked(scanForSymlinks);

const HOME       = homedir();
const STORE_PATH = join(HOME, '.goodboy', 'skills');
const SOURCE     = '/registry/my-skill/versions/1.0.0';

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(false);
  mockMkdirSync.mockReturnValue(undefined as never);
  mockCpSync.mockReturnValue(undefined as never);
  mockRmSync.mockReturnValue(undefined);
  mockScanForSymlinks.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// getStorePath
// ---------------------------------------------------------------------------

describe('getStorePath', () => {
  it('returns ~/.goodboy/skills', () => {
    expect(getStorePath()).toBe(STORE_PATH);
  });
});

// ---------------------------------------------------------------------------
// ensureStoreExists
// ---------------------------------------------------------------------------

describe('ensureStoreExists', () => {
  it('creates the store directory when it does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    ensureStoreExists();
    expect(mockMkdirSync).toHaveBeenCalledWith(STORE_PATH, {
      recursive: true,
      mode: 0o700,
    });
  });

  it('is a no-op when the store already exists', () => {
    mockExistsSync.mockReturnValue(true);
    ensureStoreExists();
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// installToStore
// ---------------------------------------------------------------------------

describe('installToStore', () => {
  it('scans for symlinks before copying', async () => {
    await installToStore('my-skill', SOURCE);
    expect(mockScanForSymlinks).toHaveBeenCalledWith(SOURCE);
    expect(mockCpSync).toHaveBeenCalled();
  });

  it('returns the store destination path', async () => {
    const result = await installToStore('my-skill', SOURCE);
    expect(result).toBe(join(STORE_PATH, 'my-skill'));
  });

  it('creates the destination directory with 0o700', async () => {
    await installToStore('my-skill', SOURCE);
    expect(mockMkdirSync).toHaveBeenCalledWith(
      join(STORE_PATH, 'my-skill'),
      { recursive: true, mode: 0o700 },
    );
  });

  it('copies source into destination', async () => {
    await installToStore('my-skill', SOURCE);
    expect(mockCpSync).toHaveBeenCalledWith(
      SOURCE,
      join(STORE_PATH, 'my-skill'),
      { recursive: true },
    );
  });

  it('throws for invalid skill name', async () => {
    await expect(installToStore('../escape', SOURCE)).rejects.toThrow(
      'Invalid skill name',
    );
    expect(mockScanForSymlinks).not.toHaveBeenCalled();
  });

  it('throws for skill name with uppercase letters', async () => {
    await expect(installToStore('MySkill', SOURCE)).rejects.toThrow(
      'Invalid skill name',
    );
  });

  it('propagates scanForSymlinks errors', async () => {
    mockScanForSymlinks.mockRejectedValue(new Error('symlink detected'));
    await expect(installToStore('my-skill', SOURCE)).rejects.toThrow('symlink detected');
    expect(mockCpSync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// removeFromStore
// ---------------------------------------------------------------------------

describe('removeFromStore', () => {
  it('removes the skill directory when it exists', () => {
    mockExistsSync.mockReturnValue(true);
    removeFromStore('my-skill');
    expect(mockRmSync).toHaveBeenCalledWith(
      join(STORE_PATH, 'my-skill'),
      { recursive: true, force: true },
    );
  });

  it('is a no-op when the skill is not in the store', () => {
    mockExistsSync.mockReturnValue(false);
    removeFromStore('my-skill');
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  it('throws for invalid skill name', () => {
    expect(() => removeFromStore('Bad_Name')).toThrow('Invalid skill name');
    expect(mockRmSync).not.toHaveBeenCalled();
  });
});
