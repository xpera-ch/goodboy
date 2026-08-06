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
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
}));
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
  cpSync: vi.fn(),
  readFileSync: vi.fn(),
}));
vi.mock('../lib/fs-security.js', () => ({
  scanForSymlinks: vi.fn(),
}));
vi.mock('../lib/manifest.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/manifest.js')>();
  return {
    ...actual,
    writeManifest: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { input } from '@inquirer/prompts';
import { existsSync, statSync, cpSync, readFileSync } from 'node:fs';
import { scanForSymlinks } from '../lib/fs-security.js';
import { writeManifest, validateManifest } from '../lib/manifest.js';
import { logger } from '../lib/logger.js';
import { adoptCommand } from './adopt.js';

const mockInput = vi.mocked(input);
const mockExistsSync = vi.mocked(existsSync);
const mockStatSync = vi.mocked(statSync);
const mockCpSync = vi.mocked(cpSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockScanForSymlinks = vi.mocked(scanForSymlinks);
const mockWriteManifest = vi.mocked(writeManifest);
const mockLogger = vi.mocked(logger);

const CWD = process.cwd();
const SOURCE_PATH = '/home/user/some-skill';
const SKILL_MD_PATH = join(SOURCE_PATH, 'SKILL.md');
const MANIFEST_PATH = join(SOURCE_PATH, 'manifest.json');
const TARGET_DIR = join(CWD, 'my-skill');

const SKILL_MD_WITH_LICENSE = `---
name: my-skill
description: A well-described skill for testing purposes
license: MIT
---

Body content here that is longer than fifty characters for sure.`;

const SKILL_MD_NO_LICENSE = `---
name: my-skill
description: A well-described skill for testing purposes
---

Body content here that is longer than fifty characters for sure.`;

const SKILL_MD_NO_OPENING_DELIMITER = 'name: my-skill\ndescription: something\n\nBody here.';
const SKILL_MD_NO_CLOSING_DELIMITER =
  '---\nname: my-skill\ndescription: something\nno closing delimiter';
const SKILL_MD_MISSING_NAME = '---\ndescription: A description\n---\n\nBody content here.';
const SKILL_MD_MISSING_DESCRIPTION = '---\nname: my-skill\n---\n\nBody content here.';

/** Configures existsSync per-path: source dir, SKILL.md, manifest.json, target dir. */
function mockFsForHappyPath(opts: {
  manifestExists?: boolean;
  targetExists?: boolean;
  skillMdExists?: boolean;
  skillMdSize?: number;
} = {}): void {
  mockExistsSync.mockImplementation((p: unknown) => {
    if (p === SOURCE_PATH) return true;
    if (p === SKILL_MD_PATH) return opts.skillMdExists ?? true;
    if (p === MANIFEST_PATH) return opts.manifestExists ?? false;
    if (p === TARGET_DIR) return opts.targetExists ?? false;
    return false;
  });
  mockStatSync.mockImplementation((p: unknown) => {
    if (p === SKILL_MD_PATH) {
      return { size: opts.skillMdSize ?? 1024 } as ReturnType<typeof statSync>;
    }
    return { isDirectory: () => true } as ReturnType<typeof statSync>;
  });
}

describe('adopt command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    mockFsForHappyPath();
    mockReadFileSync.mockReturnValue(SKILL_MD_WITH_LICENSE);
    mockScanForSymlinks.mockResolvedValue(undefined);
    mockWriteManifest.mockResolvedValue(undefined);
    mockInput.mockResolvedValueOnce('Test Author').mockResolvedValueOnce('');
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('adopts a skill whose SKILL.md declares a license without prompting for one', async () => {
    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' });

    // Exactly two prompts: author name, author email. No license prompt.
    expect(mockInput).toHaveBeenCalledTimes(2);
    expect(mockInput.mock.calls[0]![0]).toMatchObject({ message: 'Author name:' });
    expect(mockInput.mock.calls[1]![0]).toMatchObject({ message: 'Author email (optional):' });

    expect(mockCpSync).toHaveBeenCalledWith(SOURCE_PATH, TARGET_DIR, { recursive: true });
    expect(mockWriteManifest).toHaveBeenCalledOnce();
    const [manifestPath, manifest] = mockWriteManifest.mock.calls[0]! as [string, GoodBoyManifest];
    expect(manifestPath).toBe(join(TARGET_DIR, 'manifest.json'));
    expect(manifest.license).toBe('MIT');
    expect(() => validateManifest(manifest)).not.toThrow();
  });

  it('prompts for a license only when SKILL.md declares none', async () => {
    mockReadFileSync.mockReturnValue(SKILL_MD_NO_LICENSE);
    mockInput
      .mockReset()
      .mockResolvedValueOnce('Test Author')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('Apache-2.0');

    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' });

    expect(mockInput).toHaveBeenCalledTimes(3);
    expect(mockInput.mock.calls[2]![0]).toMatchObject({ message: 'License:' });
    const [, manifest] = mockWriteManifest.mock.calls[0]! as [string, GoodBoyManifest];
    expect(manifest.license).toBe('Apache-2.0');
  });

  it('writes a manifest with the exact silent defaults', async () => {
    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' });

    const [, manifest] = mockWriteManifest.mock.calls[0]! as [string, GoodBoyManifest];
    expect(manifest).toMatchObject({
      name: 'my-skill',
      version: '0.1.0',
      description: 'A well-described skill for testing purposes',
      schema_version: '1.0.0',
      status: 'experimental',
      visibility: 'private',
      category: 'other',
    });
  });

  it('omits author email from the manifest when left blank', async () => {
    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' });
    const [, manifest] = mockWriteManifest.mock.calls[0]! as [string, GoodBoyManifest];
    expect(manifest.author).not.toHaveProperty('email');
  });

  it('includes author email in the manifest when provided', async () => {
    mockInput.mockReset().mockResolvedValueOnce('Test Author').mockResolvedValueOnce('author@example.com');
    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' });
    const [, manifest] = mockWriteManifest.mock.calls[0]! as [string, GoodBoyManifest];
    expect(manifest.author).toMatchObject({ name: 'Test Author', email: 'author@example.com' });
  });

  // -------------------------------------------------------------------------
  // validate closures passed to input() — extracted from the mock's
  // recorded call arguments and invoked directly, since input() itself is
  // mocked wholesale and never runs its own validate callback.
  // -------------------------------------------------------------------------

  describe('validate closures', () => {
    it('author name: rejects empty and whitespace-only, accepts non-empty', async () => {
      await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' });

      const validate = mockInput.mock.calls[0]![0].validate!;
      expect(validate('')).toBe('Author name is required');
      expect(validate('   ')).toBe('Author name is required');
      expect(validate('Test Author')).toBe(true);
    });

    it('author email: accepts empty (optional), rejects malformed, accepts well-formed', async () => {
      await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' });

      const validate = mockInput.mock.calls[1]![0].validate!;
      expect(validate('')).toBe(true);
      expect(validate('not-an-email')).toBe('"not-an-email" is not a valid email address');
      expect(validate('author@example.com')).toBe(true);
    });

    it('license: rejects empty, accepts non-empty — only reachable when SKILL.md declares none', async () => {
      mockReadFileSync.mockReturnValue(SKILL_MD_NO_LICENSE);
      mockInput
        .mockReset()
        .mockResolvedValueOnce('Test Author')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('MIT');

      await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' });

      const validate = mockInput.mock.calls[2]![0].validate!;
      expect(validate('')).toBe('License is required');
      expect(validate('MIT')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Path validation
  // -------------------------------------------------------------------------

  it('exits with a clear error when the path does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('exits with a clear error when the path is not a directory', async () => {
    mockStatSync.mockReturnValue({ isDirectory: () => false } as ReturnType<typeof statSync>);

    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('not a directory'));
    expect(mockCpSync).not.toHaveBeenCalled();
  });

  it('exits with a clear error when SKILL.md is missing', async () => {
    mockFsForHappyPath({ skillMdExists: false });

    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('No SKILL.md found'));
    expect(mockCpSync).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // SKILL.md size cap (C1)
  // -------------------------------------------------------------------------

  it('accepts a SKILL.md exactly at the 512 KB boundary', async () => {
    mockFsForHappyPath({ skillMdSize: 512 * 1024 });

    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' });

    expect(mockCpSync).toHaveBeenCalledWith(SOURCE_PATH, TARGET_DIR, { recursive: true });
  });

  it('rejects a SKILL.md over the 512 KB size limit, with no directory created and no prompts run', async () => {
    mockFsForHappyPath({ skillMdSize: 512 * 1024 + 1 });

    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('512 KB'));
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockInput).not.toHaveBeenCalled();
  });

  it('exits with a clear error pointing at add when manifest.json already exists', async () => {
    mockFsForHappyPath({ manifestExists: true });

    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringMatching(/goodboy add/),
    );
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockInput).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Malformed frontmatter (wording mirrors validateSkillDirectory())
  // -------------------------------------------------------------------------

  it('exits with the standard error when frontmatter has no opening delimiter', async () => {
    mockReadFileSync.mockReturnValue(SKILL_MD_NO_OPENING_DELIMITER);
    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('no frontmatter'),
    );
    expect(mockCpSync).not.toHaveBeenCalled();
  });

  it('exits with the standard error when frontmatter has no closing delimiter', async () => {
    mockReadFileSync.mockReturnValue(SKILL_MD_NO_CLOSING_DELIMITER);
    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('not closed'),
    );
    expect(mockCpSync).not.toHaveBeenCalled();
  });

  it('exits with the standard error when frontmatter is missing name', async () => {
    mockReadFileSync.mockReturnValue(SKILL_MD_MISSING_NAME);
    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('missing the name field'),
    );
    expect(mockCpSync).not.toHaveBeenCalled();
  });

  it('exits with the standard error when frontmatter is missing description', async () => {
    mockReadFileSync.mockReturnValue(SKILL_MD_MISSING_DESCRIPTION);
    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('missing the description field'),
    );
    expect(mockCpSync).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Name validation and target-directory collision
  // -------------------------------------------------------------------------

  it('rejects an invalid name before creating any directory', async () => {
    mockReadFileSync.mockReturnValue(
      '---\nname: Not_Valid\ndescription: A well-described skill for testing purposes\n---\n\nBody content here that is longer than fifty characters for sure.',
    );
    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Invalid skill name'));
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockInput).not.toHaveBeenCalled();
  });

  it('refuses when ./<name>/ already exists in the current directory', async () => {
    mockFsForHappyPath({ targetExists: true });

    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('already exists in the current directory'),
    );
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockInput).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Symlink scan
  // -------------------------------------------------------------------------

  it('scans for symlinks before copying', async () => {
    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' });
    const scanOrder = mockScanForSymlinks.mock.invocationCallOrder[0]!;
    const copyOrder = mockCpSync.mock.invocationCallOrder[0]!;
    expect(scanOrder).toBeLessThan(copyOrder);
  });

  it('rejects a symlink escape before any copy or prompt, with zero filesystem writes', async () => {
    mockScanForSymlinks.mockRejectedValue(
      new Error('Security: skill contains a symlink pointing outside its directory'),
    );

    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('symlink'),
    );
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockWriteManifest).not.toHaveBeenCalled();
    expect(mockInput).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Source directory is never written to
  // -------------------------------------------------------------------------

  it('never targets the source directory in any write/copy call, across every failure path', async () => {
    const scenarios: Array<() => void> = [
      () => mockExistsSync.mockReturnValue(false),
      () => mockStatSync.mockReturnValue({ isDirectory: () => false } as ReturnType<typeof statSync>),
      () => mockFsForHappyPath({ skillMdExists: false }),
      () => mockFsForHappyPath({ manifestExists: true }),
      () => mockReadFileSync.mockReturnValue(SKILL_MD_NO_OPENING_DELIMITER),
      () => mockFsForHappyPath({ targetExists: true }),
      () =>
        mockScanForSymlinks.mockRejectedValue(
          new Error('Security: skill contains a symlink pointing outside its directory'),
        ),
    ];

    for (const setup of scenarios) {
      vi.clearAllMocks();
      mockFsForHappyPath();
      mockReadFileSync.mockReturnValue(SKILL_MD_WITH_LICENSE);
      mockScanForSymlinks.mockResolvedValue(undefined);
      setup();

      await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});

      expect(mockCpSync).not.toHaveBeenCalledWith(
        expect.anything(),
        SOURCE_PATH,
        expect.anything(),
      );
      for (const call of mockCpSync.mock.calls) {
        expect(call[0]).not.toBe(SOURCE_PATH);
        expect(call[1]).not.toBe(SOURCE_PATH);
      }
      expect(mockWriteManifest).not.toHaveBeenCalled();
    }
  });

  it('only reads from the source path on the happy path (existsSync, statSync, readFileSync, scanForSymlinks) — the one write call targets the copy', async () => {
    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' });

    expect(mockCpSync).toHaveBeenCalledTimes(1);
    expect(mockCpSync.mock.calls[0]![0]).toBe(SOURCE_PATH);
    expect(mockCpSync.mock.calls[0]![1]).toBe(TARGET_DIR);
    expect(mockCpSync.mock.calls[0]![1]).not.toBe(SOURCE_PATH);
  });

  // -------------------------------------------------------------------------
  // Failure after copy / top-level catch behavior
  // -------------------------------------------------------------------------

  it('reports failure and exits non-zero when writing the manifest fails after copy', async () => {
    mockWriteManifest.mockRejectedValue(new Error('disk full'));

    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('disk full'));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('exits 0 without an error message when the prompt is force-closed', async () => {
    mockInput.mockReset().mockRejectedValueOnce(new Error('User force closed the prompt'));

    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('logs "Unknown error" and exits 1 when a non-Error value is thrown (C3)', async () => {
    mockWriteManifest.mockRejectedValue({ notAnError: true });

    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith('Unknown error');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  // -------------------------------------------------------------------------
  // Trailer / success message (required behavior #11, C2)
  // -------------------------------------------------------------------------

  it('prints the trailer with name, version, path, and the goodboy add follow-up (C2)', async () => {
    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' });

    const infoLines = mockLogger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(infoLines).toContain('Name:    my-skill');
    expect(infoLines).toContain('Version: 0.1.0');
    expect(infoLines).toContain(`Path:    ${TARGET_DIR}`);
    expect(infoLines).toContain('manifest.json synthesized from SKILL.md');
    expect(infoLines).toContain("Run 'goodboy add ./my-skill' to add this skill to your local registry.");
    expect(mockLogger.success).toHaveBeenCalledWith('Adopted skill "my-skill"');
  });
});
