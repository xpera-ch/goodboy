import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { ExitPromptError } from '@inquirer/core';
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
  confirm: vi.fn(),
}));
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
  cpSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));
vi.mock('../lib/fs-security.js', () => ({
  scanForSymlinks: vi.fn(),
}));
// manifest.js is NOT auto-mocked: validateManifest forwards to the real
// Ajv schema check, so a broken synthesis is actually caught by the schema
// — while still being a mock, so a test can force it to throw a non-Error
// (mirroring how add.test.ts covers its equivalent fallback branch).
vi.mock('../lib/manifest.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/manifest.js')>();
  return {
    ...actual,
    validateManifest: vi.fn((data: unknown) => actual.validateManifest(data)),
    writeManifest: vi.fn().mockResolvedValue(undefined),
  };
});
// registry.js is NOT mocked at all: adopt writes through the real
// writeSkillVersionToRegistry (extracted to registry.ts in C5f), whose path
// is controlled via the GOODBOY_REGISTRY env var (set in beforeEach).
vi.mock('../lib/registry-entry.js', () => ({
  readRegistryEntry: vi.fn(),
  writeRegistryEntry: vi.fn(),
  createRegistryEntry: vi.fn((name: string, version: string, path: string) => ({
    name,
    latest: version,
    versions: {
      [version]: { path, addedAt: '2026-01-01T00:00:00Z', yanked: false },
    },
  })),
  addVersionToEntry: vi.fn(
    (entry: { name: string; versions: Record<string, unknown> }, version: string, path: string) => ({
      ...entry,
      latest: version,
      versions: { ...entry.versions, [version]: { path, addedAt: '2026-01-01T00:00:00Z', yanked: false } },
    }),
  ),
}));
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  // Mirrors sanitiseError()'s real three-way branch (Error / string / other)
  // rather than logger.test.ts's simpler `String(e)` fallback used in some
  // sibling command test suites, so the non-Error fallback text asserted in
  // the "C3" test below matches sanitiseError's actual production behavior.
  sanitiseError: vi.fn((e: unknown) =>
    e instanceof Error ? e.message : typeof e === 'string' ? e : 'An unexpected error occurred',
  ),
}));

import { input, confirm } from '@inquirer/prompts';
import { existsSync, statSync, cpSync, readFileSync, mkdirSync } from 'node:fs';
import { scanForSymlinks } from '../lib/fs-security.js';
import { writeManifest, validateManifest } from '../lib/manifest.js';
import {
  readRegistryEntry,
  writeRegistryEntry,
} from '../lib/registry-entry.js';
import { logger, sanitiseError } from '../lib/logger.js';
import { adoptCommand } from './adopt.js';

const mockInput = vi.mocked(input);
const mockConfirm = vi.mocked(confirm);
const mockExistsSync = vi.mocked(existsSync);
const mockStatSync = vi.mocked(statSync);
const mockCpSync = vi.mocked(cpSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockScanForSymlinks = vi.mocked(scanForSymlinks);
const mockWriteManifest = vi.mocked(writeManifest);
const mockReadRegistryEntry = vi.mocked(readRegistryEntry);
const mockWriteRegistryEntry = vi.mocked(writeRegistryEntry);
const mockLogger = vi.mocked(logger);
const mockSanitiseError = vi.mocked(sanitiseError);

const REGISTRY_PATH = '/registry';
const SOURCE_PATH = '/home/user/some-skill';
const SKILL_MD_PATH = join(SOURCE_PATH, 'SKILL.md');
const MANIFEST_PATH = join(SOURCE_PATH, 'manifest.json');
const SKILL_REGISTRY_DIR = join(REGISTRY_PATH, 'my-skill');
const VERSION_ABS_PATH = join(SKILL_REGISTRY_DIR, 'versions', '0.1.0');

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

/** Configures existsSync per-path: source dir, SKILL.md, manifest.json. */
function mockFsForHappyPath(opts: {
  manifestExists?: boolean;
  skillMdExists?: boolean;
  skillMdSize?: number;
} = {}): void {
  mockExistsSync.mockImplementation((p: unknown) => {
    if (p === REGISTRY_PATH) return true; // real getRegistryPath() env check
    if (p === SOURCE_PATH) return true;
    if (p === SKILL_MD_PATH) return opts.skillMdExists ?? true;
    if (p === MANIFEST_PATH) return opts.manifestExists ?? false;
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

    process.env['GOODBOY_REGISTRY'] = REGISTRY_PATH;
    mockFsForHappyPath();
    mockReadFileSync.mockReturnValue(SKILL_MD_WITH_LICENSE);
    mockScanForSymlinks.mockResolvedValue(undefined);
    mockWriteManifest.mockResolvedValue(undefined);
    mockReadRegistryEntry.mockResolvedValue(null);
    mockWriteRegistryEntry.mockResolvedValue(undefined);
    mockInput.mockResolvedValueOnce('Test Author').mockResolvedValueOnce('');
    mockConfirm.mockResolvedValue(true);
  });

  afterEach(() => {
    // Env leaks across test files sharing a worker process.
    delete process.env['GOODBOY_REGISTRY'];
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('registers the skill: copies into the registry version dir and writes a synthesized manifest', async () => {
    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' });

    // Exactly two prompts: author name, author email. No license prompt.
    expect(mockInput).toHaveBeenCalledTimes(2);
    expect(mockInput.mock.calls[0]![0]).toMatchObject({ message: 'Author name:' });
    expect(mockInput.mock.calls[1]![0]).toMatchObject({ message: 'Author email (optional):' });

    // One confirmation, defaulting to No.
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm.mock.calls[0]![0]).toMatchObject({
      message: 'Register this skill?',
      default: false,
    });

    expect(mockMkdirSync).toHaveBeenCalledWith(VERSION_ABS_PATH, {
      recursive: true,
      mode: 0o700,
    });
    expect(mockCpSync).toHaveBeenCalledWith(SOURCE_PATH, VERSION_ABS_PATH, { recursive: true });
    expect(mockWriteManifest).toHaveBeenCalledOnce();
    const [manifestPath, manifest] = mockWriteManifest.mock.calls[0]! as [string, GoodBoyManifest];
    expect(manifestPath).toBe(join(VERSION_ABS_PATH, 'manifest.json'));
    expect(manifest.license).toBe('MIT');
    expect(() => validateManifest(manifest)).not.toThrow();
    expect(mockWriteRegistryEntry).toHaveBeenCalledWith(
      SKILL_REGISTRY_DIR,
      expect.objectContaining({ name: 'my-skill', latest: '0.1.0' }),
    );

    // The source directory is untouched — the only write targeting its
    // subtree would be a manifest.json written into it, and none is.
    for (const call of mockWriteManifest.mock.calls) {
      expect(call[0]).not.toContain(SOURCE_PATH);
    }
    expect(process.exit).not.toHaveBeenCalled();
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
      schema_version: '2.0.0',
      status: 'experimental',
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

  it('adopts a skill whose directory name matches the frontmatter name, run from its parent (the old collision case)', async () => {
    // The regression this phase exists for: adopt run from the source's
    // parent used to compute targetDir = join(cwd, name) == the source
    // itself and refuse 100% of the time (backlog: "adopt collides with its
    // own source"). No cwd target exists anymore — the registry is the
    // destination — so this adoption must simply succeed.
    const sourceInParent = '/tmp/scratch/my-skill';
    mockExistsSync.mockImplementation((p: unknown) =>
      p === REGISTRY_PATH ||
      p === sourceInParent ||
      p === join(sourceInParent, 'SKILL.md'),
    );
    mockStatSync.mockImplementation((p: unknown) =>
      p === join(sourceInParent, 'SKILL.md')
        ? ({ size: 1024 } as ReturnType<typeof statSync>)
        : ({ isDirectory: () => true } as ReturnType<typeof statSync>),
    );

    await adoptCommand.parseAsync([sourceInParent], { from: 'user' });

    expect(mockCpSync).toHaveBeenCalledWith(sourceInParent, VERSION_ABS_PATH, {
      recursive: true,
    });
    expect(mockWriteRegistryEntry).toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Decline — zero writes, exit 0
  // -------------------------------------------------------------------------

  it('declining registers nothing: zero filesystem writes anywhere, exit 0', async () => {
    mockConfirm.mockResolvedValue(false);

    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' });

    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockWriteManifest).not.toHaveBeenCalled();
    expect(mockWriteRegistryEntry).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Nothing was registered — the source directory was not modified.',
    );
    expect(process.exit).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Already in the registry — refuse before any interaction
  // -------------------------------------------------------------------------

  it('refuses with a pointer to skill version --bump when the skill already has any registry entry', async () => {
    mockReadRegistryEntry.mockResolvedValue({
      name: 'my-skill',
      latest: '0.9.0',
      versions: { '0.9.0': { path: 'versions/0.9.0', addedAt: '2026-01-01T00:00:00Z', yanked: false } },
    });

    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('already in the local registry'),
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("goodboy skill version my-skill --bump <patch|minor|major>"),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
    // Refusal happens before prompts, scan, or any write.
    expect(mockInput).not.toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockWriteManifest).not.toHaveBeenCalled();
    expect(mockWriteRegistryEntry).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // validate closures passed to input() — extracted from the mock's
  // recorded call arguments and invoked directly, since input() itself is
  // mocked wholesale and never runs its own validate callback.
  // -------------------------------------------------------------------------

  describe('validate closures', () => {
    it('author name: rejects empty and whitespace-only, accepts non-empty (C3: 128-char bound)', async () => {
      await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' });

      const validate = mockInput.mock.calls[0]![0].validate!;
      expect(validate('')).toBe('Author name is required');
      expect(validate('   ')).toBe('Author name is required');
      expect(validate('x'.repeat(129))).toBe('Author name must be 128 characters or fewer');
      expect(validate('x'.repeat(128))).toBe(true);
      expect(validate('Test Author')).toBe(true);
    });

    it('author email: accepts empty (optional), rejects malformed, accepts well-formed (C3: 254-char bound)', async () => {
      await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' });

      const validate = mockInput.mock.calls[1]![0].validate!;
      expect(validate('')).toBe(true);
      expect(validate('a'.repeat(255))).toBe('Email address must be 254 characters or fewer');
      expect(validate('not-an-email')).toBe('"not-an-email" is not a valid email address');
      expect(validate(`${'a'.repeat(200)}@example.com`)).toBe(true);
      expect(validate('author@example.com')).toBe(true);
    });

    it('license: rejects empty, accepts non-empty — only reachable when SKILL.md declares none (C3: 64-char bound)', async () => {
      mockReadFileSync.mockReturnValue(SKILL_MD_NO_LICENSE);
      mockInput
        .mockReset()
        .mockResolvedValueOnce('Test Author')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('MIT');

      await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' });

      const validate = mockInput.mock.calls[2]![0].validate!;
      expect(validate('')).toBe('License is required');
      expect(validate('x'.repeat(65))).toBe('License must be 64 characters or fewer');
      expect(validate('x'.repeat(64))).toBe(true);
      expect(validate('MIT')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Synthesized-manifest schema gate (C5f; C5f-b: input pre-checks first)
  // -------------------------------------------------------------------------

  it('rejects a description over 1024 characters with an input-attributed error before any prompt (C3)', async () => {
    mockReadFileSync.mockReturnValue(
      `---\nname: my-skill\ndescription: ${'x'.repeat(1100)}\nlicense: MIT\n---\n\nBody content here.`,
    );

    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith(
      'The description in SKILL.md exceeds the 1024-character limit for manifest descriptions',
    );
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(mockInput).not.toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockWriteManifest).not.toHaveBeenCalled();
    expect(mockWriteRegistryEntry).not.toHaveBeenCalled();
  });

  it('rejects a broken synthesis against the schema when every pre-check passes', async () => {
    vi.mocked(validateManifest).mockImplementationOnce(() => {
      throw new Error('schema blew up');
    });

    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Synthesized manifest failed schema validation'),
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('schema blew up'),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockWriteManifest).not.toHaveBeenCalled();
    expect(mockWriteRegistryEntry).not.toHaveBeenCalled();
  });

  it('handles a non-Error thrown by the synthesis gate with the String fallback (C5f)', async () => {
    vi.mocked(validateManifest).mockImplementationOnce(() => {
      throw 'boom';
    });

    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Synthesized manifest failed schema validation'),
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('boom'),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(mockCpSync).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Remote-ref rejection (URL-shaped / scp-style arguments)
  // -------------------------------------------------------------------------

  describe('remote-ref rejection', () => {
    it('rejects a URL argument before touching the filesystem', async () => {
      await adoptCommand.parseAsync(['https://github.com/foo/bar'], { from: 'user' }).catch(() => {});

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('https://github.com/foo/bar'),
      );
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(mockExistsSync).not.toHaveBeenCalled();
      expect(mockStatSync).not.toHaveBeenCalled();
      expect(mockReadFileSync).not.toHaveBeenCalled();
      expect(mockCpSync).not.toHaveBeenCalled();
      expect(mockScanForSymlinks).not.toHaveBeenCalled();
    });

    it('rejects an scp-style git remote argument before touching the filesystem', async () => {
      await adoptCommand.parseAsync(['git@github.com:foo/bar.git'], { from: 'user' }).catch(() => {});

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('git@github.com:foo/bar.git'),
      );
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(mockExistsSync).not.toHaveBeenCalled();
      expect(mockStatSync).not.toHaveBeenCalled();
      expect(mockReadFileSync).not.toHaveBeenCalled();
      expect(mockCpSync).not.toHaveBeenCalled();
      expect(mockScanForSymlinks).not.toHaveBeenCalled();
    });

    it('never prompts the user when the argument is rejected as a remote ref', async () => {
      await adoptCommand.parseAsync(['https://github.com/foo/bar'], { from: 'user' }).catch(() => {});

      expect(mockInput).not.toHaveBeenCalled();
      expect(mockConfirm).not.toHaveBeenCalled();
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

    expect(mockCpSync).toHaveBeenCalledWith(SOURCE_PATH, VERSION_ABS_PATH, { recursive: true });
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
  // Name validation
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

  it('rejects a name over 64 characters with an input-attributed error before any prompt (C3)', async () => {
    mockReadFileSync.mockReturnValue(
      `---\nname: ${'a'.repeat(65)}\ndescription: A well-described skill for testing purposes\n---\n\nBody content here that is longer than fifty characters for sure.`,
    );
    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});
    expect(mockLogger.error).toHaveBeenCalledWith(
      `Skill name "${'a'.repeat(65)}" in SKILL.md frontmatter exceeds the 64-character limit`,
    );
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockInput).not.toHaveBeenCalled();
  });

  it('rejects a frontmatter license over 64 characters with an input-attributed error after the author prompts (C3)', async () => {
    mockReadFileSync.mockReturnValue(
      `---\nname: my-skill\ndescription: A well-described skill for testing purposes\nlicense: ${'a'.repeat(65)}\n---\n\nBody content here that is longer than fifty characters for sure.`,
    );
    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith(
      'The license in SKILL.md exceeds the 64-character limit for manifest licenses',
    );
    // The frontmatter-license check sits after the author prompts (the user
    // cannot fix the frontmatter from inside them), but the confirmation and
    // every write come later and must not run.
    expect(mockInput).toHaveBeenCalledTimes(2);
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockWriteManifest).not.toHaveBeenCalled();
    expect(mockWriteRegistryEntry).not.toHaveBeenCalled();
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
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // The source directory is never written to
  // -------------------------------------------------------------------------

  it('never writes to the source directory, across every failure path', async () => {
    const scenarios: Array<() => void> = [
      () => mockExistsSync.mockReturnValue(false),
      () => mockStatSync.mockReturnValue({ isDirectory: () => false } as ReturnType<typeof statSync>),
      () => mockFsForHappyPath({ skillMdExists: false }),
      () => mockFsForHappyPath({ manifestExists: true }),
      () => mockReadFileSync.mockReturnValue(SKILL_MD_NO_OPENING_DELIMITER),
      () =>
        mockScanForSymlinks.mockRejectedValue(
          new Error('Security: skill contains a symlink pointing outside its directory'),
        ),
      () =>
        mockReadRegistryEntry.mockResolvedValue({
          name: 'my-skill',
          latest: '0.9.0',
          versions: { '0.9.0': { path: 'versions/0.9.0', addedAt: '2026-01-01T00:00:00Z', yanked: false } },
        }),
      () =>
        mockReadFileSync.mockReturnValue(
          `---\nname: my-skill\ndescription: ${'x'.repeat(1100)}\nlicense: MIT\n---\n\nBody content here.`,
        ),
      () =>
        mockReadFileSync.mockReturnValue(
          `---\nname: ${'a'.repeat(65)}\ndescription: A well-described skill for testing purposes\n---\n\nBody content here.`,
        ),
      () =>
        mockReadFileSync.mockReturnValue(
          `---\nname: my-skill\ndescription: A well-described skill for testing purposes\nlicense: ${'a'.repeat(65)}\n---\n\nBody content here.`,
        ),
    ];

    for (const setup of scenarios) {
      vi.clearAllMocks();
      mockFsForHappyPath();
      mockReadFileSync.mockReturnValue(SKILL_MD_WITH_LICENSE);
      mockScanForSymlinks.mockResolvedValue(undefined);
      mockReadRegistryEntry.mockResolvedValue(null);
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
      expect(mockWriteRegistryEntry).not.toHaveBeenCalled();
    }
  });

  it('only reads from the source path on the happy path (existsSync, statSync, readFileSync, scanForSymlinks) — the one write call targets the registry', async () => {
    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' });

    expect(mockCpSync).toHaveBeenCalledTimes(1);
    expect(mockCpSync.mock.calls[0]![0]).toBe(SOURCE_PATH);
    expect(mockCpSync.mock.calls[0]![1]).toBe(VERSION_ABS_PATH);
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

  it('routes the top-level catch through sanitiseError() rather than logging err.message directly (F1)', async () => {
    mockSanitiseError.mockImplementationOnce(
      (e: unknown) => `SANITISED:${e instanceof Error ? e.message : String(e)}`,
    );
    mockWriteManifest.mockRejectedValue(new Error('disk full'));

    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});

    expect(mockSanitiseError).toHaveBeenCalledWith(expect.any(Error));
    expect(mockLogger.error).toHaveBeenCalledWith('SANITISED:disk full');
  });

  it('a force-closed prompt exits non-zero with a named cause and remedy — never exit 0 (C9 regression for the original defect)', async () => {
    mockInput.mockReset().mockRejectedValueOnce(
      new ExitPromptError('User force closed the prompt with SIGINT'),
    );

    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});

    // The message names the cause (force-closed / stdin ended mid-dialogue)
    // and the remedy (interactive run or the flags).
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('force-closed'),
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('--author <name> --email <email> [--license <spdx>] --yes'),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(mockCpSync).not.toHaveBeenCalled();
  });

  it('a force-closed confirmation prompt exits non-zero with nothing written — never exit 0', async () => {
    mockConfirm.mockRejectedValueOnce(
      new ExitPromptError('User force closed the prompt with SIGINT'),
    );

    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('force-closed'));
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });

  it('logs sanitiseError()\'s fallback text and exits 1 when a non-Error value is thrown (C3)', async () => {
    mockWriteManifest.mockRejectedValue({ notAnError: true });

    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith('An unexpected error occurred');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  // -------------------------------------------------------------------------
  // Manifest display + trailer / success message
  // -------------------------------------------------------------------------

  it('shows the synthesized manifest before asking for confirmation', async () => {
    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' });

    const infoLines = mockLogger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(infoLines).toContain('Name:            my-skill');
    expect(infoLines).toContain('Version:         0.1.0');
    expect(infoLines).toContain('Description:     A well-described skill for testing purposes');
    expect(infoLines).toContain('Author:          Test Author');
    expect(infoLines).toContain('License:         MIT');
    expect(infoLines).toContain('Schema version:  2.0.0');
    expect(infoLines).toContain('Status:          experimental');
    expect(infoLines).toContain('Category:        other');
  });

  it('includes author email in the displayed manifest when provided', async () => {
    mockInput.mockReset().mockResolvedValueOnce('Test Author').mockResolvedValueOnce('author@example.com');
    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' });

    const infoLines = mockLogger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(infoLines).toContain('Author:          Test Author <author@example.com>');
  });

  it('prints the trailer with name, version, registry path, source-unmodified, and the install follow-up (C2)', async () => {
    await adoptCommand.parseAsync([SOURCE_PATH], { from: 'user' });

    const infoLines = mockLogger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(infoLines).toContain('Name:    my-skill');
    expect(infoLines).toContain('Version: 0.1.0');
    expect(infoLines).toContain(`Registry: ${SKILL_REGISTRY_DIR}`);
    expect(infoLines).toContain('manifest.json synthesized from SKILL.md');
    expect(infoLines).toContain('the source directory was not modified');
    expect(infoLines).toContain("Next: run 'goodboy install my-skill' to install this skill.");
    expect(infoLines).not.toContain('goodboy add');
    expect(mockLogger.success).toHaveBeenCalledWith('Adopted skill "my-skill"');
  });
});
