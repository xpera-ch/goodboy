import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import type { GoodBoyManifest } from '../types/index.js';

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: '',
  })),
}));
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  cpSync: vi.fn(),
}));
vi.mock('../lib/validation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/validation.js')>();
  return actual;
});
vi.mock('../lib/skill-validator.js');
vi.mock('../lib/manifest.js');
vi.mock('../lib/fs-security.js');
vi.mock('../lib/registry.js');
vi.mock('../lib/registry-entry.js');
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import ora from 'ora';
import { existsSync, mkdirSync, cpSync } from 'node:fs';
import { validateSkillDirectory, formatValidationResult } from '../lib/skill-validator.js';
import { readManifest, validateManifest } from '../lib/manifest.js';
import { scanForSymlinks } from '../lib/fs-security.js';
import { getRegistryPath, ensureRegistryExists } from '../lib/registry.js';
import {
  readRegistryEntry,
  writeRegistryEntry,
  createRegistryEntry,
  addVersionToEntry,
} from '../lib/registry-entry.js';
import { logger } from '../lib/logger.js';
import { resetCommandOptions } from '../__fixtures__/index.js';
import { addCommand } from './add.js';

const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockCpSync = vi.mocked(cpSync);
const mockValidateSkillDirectory = vi.mocked(validateSkillDirectory);
const mockFormatValidationResult = vi.mocked(formatValidationResult);
const mockReadManifest = vi.mocked(readManifest);
const mockValidateManifest = vi.mocked(validateManifest);
const mockScanForSymlinks = vi.mocked(scanForSymlinks);
const mockGetRegistryPath = vi.mocked(getRegistryPath);
const mockEnsureRegistryExists = vi.mocked(ensureRegistryExists);
const mockReadRegistryEntry = vi.mocked(readRegistryEntry);
const mockWriteRegistryEntry = vi.mocked(writeRegistryEntry);
const mockCreateRegistryEntry = vi.mocked(createRegistryEntry);
const mockAddVersionToEntry = vi.mocked(addVersionToEntry);
const mockLogger = vi.mocked(logger);

const REGISTRY_PATH = '/registry';
const SKILL_PATH = '/home/user/my-skill';

const MANIFEST: GoodBoyManifest = {
  name: 'my-skill',
  version: '1.0.0',
  description: 'A test skill',
  author: { name: 'Test' },
  license: 'MIT',
  schema_version: '1.0.0',
  status: 'experimental',
};

function validResult() {
  return { valid: true, issues: [] };
}

describe('add command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCommandOptions(addCommand);
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    mockExistsSync.mockReturnValue(true);
    mockValidateSkillDirectory.mockResolvedValue(validResult());
    mockReadManifest.mockResolvedValue({});
    mockValidateManifest.mockReturnValue(MANIFEST);
    mockScanForSymlinks.mockResolvedValue(undefined);
    mockGetRegistryPath.mockReturnValue(REGISTRY_PATH);
    mockEnsureRegistryExists.mockReturnValue(undefined);
    mockReadRegistryEntry.mockResolvedValue(null);
    mockWriteRegistryEntry.mockResolvedValue(undefined);
    mockCreateRegistryEntry.mockReturnValue({
      name: 'my-skill',
      latest: '1.0.0',
      versions: { '1.0.0': { path: 'versions/1.0.0', addedAt: '2026-01-01T00:00:00Z', yanked: false } },
    });
  });

  describe('remote-ref rejection', () => {
    it('rejects a URL argument before any filesystem or registry access', async () => {
      await addCommand.parseAsync(['https://github.com/foo/bar'], { from: 'user' }).catch(() => {});

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('https://github.com/foo/bar'),
      );
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(process.exit).toHaveBeenCalledTimes(1);
      expect(process.exit).toHaveBeenCalledWith(1);

      type SpinnerMock = { fail: ReturnType<typeof vi.fn> };
      const spinnerInstance = vi.mocked(ora).mock.results[0]?.value as SpinnerMock;
      expect(spinnerInstance.fail).toHaveBeenCalled();

      expect(mockExistsSync).not.toHaveBeenCalled();
      expect(mockValidateSkillDirectory).not.toHaveBeenCalled();
      expect(mockReadManifest).not.toHaveBeenCalled();
      expect(mockScanForSymlinks).not.toHaveBeenCalled();
      expect(mockEnsureRegistryExists).not.toHaveBeenCalled();
      expect(mockCpSync).not.toHaveBeenCalled();
    });

    it('rejects an scp-style git remote argument before any filesystem or registry access', async () => {
      await addCommand.parseAsync(['git@github.com:foo/bar.git'], { from: 'user' }).catch(() => {});

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('git@github.com:foo/bar.git'),
      );
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(process.exit).toHaveBeenCalledTimes(1);

      expect(mockExistsSync).not.toHaveBeenCalled();
      expect(mockEnsureRegistryExists).not.toHaveBeenCalled();
      expect(mockCpSync).not.toHaveBeenCalled();
    });
  });

  it('exits when the skill path does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    await addCommand.parseAsync([SKILL_PATH], { from: 'user' }).catch(() => {});
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
    // Regression guard: an exit call inside this try block must not re-enter
    // the same catch and log a second, misleading message (or exit twice).
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(process.exit).toHaveBeenCalledTimes(1);
  });

  it('exits when the directory name is invalid', async () => {
    await addCommand.parseAsync(['/home/user/My_Skill'], { from: 'user' }).catch(() => {});
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Invalid skill directory name'));
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(process.exit).toHaveBeenCalledTimes(1);
  });

  it('exits when skill validation fails', async () => {
    mockValidateSkillDirectory.mockResolvedValue({
      valid: false,
      issues: [{ severity: 'error', message: 'manifest.json not found' }],
    });
    await addCommand.parseAsync([SKILL_PATH], { from: 'user' }).catch(() => {});
    expect(mockFormatValidationResult).toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledTimes(1);
  });

  it('shows warnings but continues when validation has only warnings', async () => {
    mockValidateSkillDirectory.mockResolvedValue({
      valid: true,
      issues: [{ severity: 'warning', message: 'manifest has no keywords' }],
    });
    await addCommand.parseAsync([SKILL_PATH], { from: 'user' });
    expect(mockFormatValidationResult).toHaveBeenCalled();
    expect(mockCpSync).toHaveBeenCalled();
  });

  it('shows the info line for a warning-free skill with declared secrets, mirroring registry-validate behavior', async () => {
    mockValidateSkillDirectory.mockResolvedValue({
      valid: true,
      issues: [{ severity: 'info', message: 'declares 1 required secret' }],
    });
    await addCommand.parseAsync([SKILL_PATH], { from: 'user' });
    expect(mockFormatValidationResult).toHaveBeenCalled();
    expect(mockCpSync).toHaveBeenCalled();
  });

  it('exits when manifest name does not match directory name', async () => {
    mockValidateManifest.mockReturnValue({ ...MANIFEST, name: 'different-skill' });
    await addCommand.parseAsync([SKILL_PATH], { from: 'user' }).catch(() => {});
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('does not match directory name'),
    );
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(process.exit).toHaveBeenCalledTimes(1);
  });

  it('scans for symlinks before copying', async () => {
    await addCommand.parseAsync([SKILL_PATH], { from: 'user' });
    const scanOrder = mockScanForSymlinks.mock.invocationCallOrder[0]!;
    const copyOrder = mockCpSync.mock.invocationCallOrder[0]!;
    expect(scanOrder).toBeLessThan(copyOrder);
  });

  it('exits when symlink scan rejects', async () => {
    mockScanForSymlinks.mockRejectedValue(
      new Error('Security: skill contains a symlink pointing outside its directory'),
    );
    await addCommand.parseAsync([SKILL_PATH], { from: 'user' }).catch(() => {});
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Skill rejected: symlink pointing outside skill directory detected',
    );
    expect(mockCpSync).not.toHaveBeenCalled();
  });

  it('exits when version already exists without --force', async () => {
    mockReadRegistryEntry.mockResolvedValue({
      name: 'my-skill',
      latest: '1.0.0',
      versions: { '1.0.0': { path: 'versions/1.0.0', addedAt: '2026-01-01T00:00:00Z', yanked: false } },
    });
    await addCommand.parseAsync([SKILL_PATH], { from: 'user' }).catch(() => {});
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('already exists'));
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(process.exit).toHaveBeenCalledTimes(1);
    expect(mockCpSync).not.toHaveBeenCalled();
  });

  it('overwrites existing version with --force', async () => {
    mockReadRegistryEntry.mockResolvedValue({
      name: 'my-skill',
      latest: '1.0.0',
      versions: { '1.0.0': { path: 'versions/1.0.0', addedAt: '2026-01-01T00:00:00Z', yanked: false } },
    });
    mockAddVersionToEntry.mockReturnValue({
      name: 'my-skill',
      latest: '1.0.0',
      versions: { '1.0.0': { path: 'versions/1.0.0', addedAt: '2026-01-01T00:00:00Z', yanked: false } },
    });
    await addCommand.parseAsync([SKILL_PATH, '--force'], { from: 'user' });
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Overwriting'));
    expect(mockCpSync).toHaveBeenCalled();
  });

  it('copies skill to versioned path', async () => {
    await addCommand.parseAsync([SKILL_PATH], { from: 'user' });
    const expectedDest = join(REGISTRY_PATH, 'my-skill', 'versions', '1.0.0');
    expect(mockCpSync).toHaveBeenCalledWith(
      SKILL_PATH,
      expectedDest,
      { recursive: true },
    );
  });

  it('creates versioned directory with 0o700', async () => {
    await addCommand.parseAsync([SKILL_PATH], { from: 'user' });
    const expectedPath = join(REGISTRY_PATH, 'my-skill', 'versions', '1.0.0');
    expect(mockMkdirSync).toHaveBeenCalledWith(
      expectedPath,
      expect.objectContaining({ recursive: true, mode: 0o700 }),
    );
  });

  it('writes registry entry after copy', async () => {
    await addCommand.parseAsync([SKILL_PATH], { from: 'user' });
    expect(mockWriteRegistryEntry).toHaveBeenCalled();
    const writeOrder = mockWriteRegistryEntry.mock.invocationCallOrder[0]!;
    const copyOrder = mockCpSync.mock.invocationCallOrder[0]!;
    expect(copyOrder).toBeLessThan(writeOrder);
  });

  it('calls addVersionToEntry when the skill already has other versions', async () => {
    mockReadRegistryEntry.mockResolvedValue({
      name: 'my-skill',
      latest: '0.9.0',
      versions: { '0.9.0': { path: 'versions/0.9.0', addedAt: '2026-01-01T00:00:00Z', yanked: false } },
    });
    mockAddVersionToEntry.mockReturnValue({
      name: 'my-skill',
      latest: '1.0.0',
      versions: {
        '0.9.0': { path: 'versions/0.9.0', addedAt: '2026-01-01T00:00:00Z', yanked: false },
        '1.0.0': { path: 'versions/1.0.0', addedAt: '2026-07-01T00:00:00Z', yanked: false },
      },
    });
    await addCommand.parseAsync([SKILL_PATH], { from: 'user' });
    expect(mockAddVersionToEntry).toHaveBeenCalled();
    expect(mockCreateRegistryEntry).not.toHaveBeenCalled();
  });

  it('calls createRegistryEntry for a new skill', async () => {
    await addCommand.parseAsync([SKILL_PATH], { from: 'user' });
    expect(mockCreateRegistryEntry).toHaveBeenCalled();
    expect(mockAddVersionToEntry).not.toHaveBeenCalled();
  });

  describe('skill registry directory creation', () => {
    const SKILL_REGISTRY_DIR = join(REGISTRY_PATH, 'my-skill');
    const VERSION_ABS_PATH = join(SKILL_REGISTRY_DIR, 'versions', '1.0.0');

    it('creates the skill registry directory when it does not yet exist', async () => {
      mockExistsSync.mockImplementation((path) => path !== SKILL_REGISTRY_DIR);

      await addCommand.parseAsync([SKILL_PATH], { from: 'user' });

      expect(mockMkdirSync).toHaveBeenCalledWith(
        SKILL_REGISTRY_DIR,
        expect.objectContaining({ recursive: true, mode: 0o700 }),
      );
      expect(mockWriteRegistryEntry).toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('does not recreate the skill registry directory when it already exists', async () => {
      await addCommand.parseAsync([SKILL_PATH], { from: 'user' });

      expect(mockMkdirSync).toHaveBeenCalledWith(
        VERSION_ABS_PATH,
        expect.objectContaining({ recursive: true, mode: 0o700 }),
      );
      expect(mockMkdirSync).not.toHaveBeenCalledWith(SKILL_REGISTRY_DIR, expect.anything());
    });
  });

  describe('top-level catch handler', () => {
    it('recognises a symlink error message regardless of casing', async () => {
      mockScanForSymlinks.mockRejectedValue(new Error('SYMLINK escape DETECTED'));

      await addCommand.parseAsync([SKILL_PATH], { from: 'user' }).catch(() => {});

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Skill rejected: symlink pointing outside skill directory detected',
      );
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(process.exit).toHaveBeenCalledTimes(1);
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('logs the raw error message for a non-symlink Error', async () => {
      mockWriteRegistryEntry.mockRejectedValue(new Error('registry entry write failed: disk quota exceeded'));

      await addCommand.parseAsync([SKILL_PATH], { from: 'user' }).catch(() => {});

      expect(mockLogger.error).toHaveBeenCalledWith('registry entry write failed: disk quota exceeded');
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(process.exit).toHaveBeenCalledTimes(1);
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('falls back to "Unknown error" for a non-Error thrown value', async () => {
      mockWriteRegistryEntry.mockRejectedValue('boom');

      await addCommand.parseAsync([SKILL_PATH], { from: 'user' }).catch(() => {});

      expect(mockLogger.error).toHaveBeenCalledWith('Unknown error');
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(process.exit).toHaveBeenCalledTimes(1);
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});
