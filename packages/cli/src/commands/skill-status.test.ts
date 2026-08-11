import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { GoodBoyManifest } from '../types/index.js';
import type { RegistryEntry } from '../lib/registry-entry.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));
vi.mock('../lib/goodboy-file.js', () => ({
  readGoodBoyJson: vi.fn(),
  getLockedVersion: vi.fn().mockResolvedValue(null),
  readGoodBoyLock: vi.fn().mockResolvedValue(null),
}));
vi.mock('../lib/registry.js', () => ({
  getRegistryPath: vi.fn().mockReturnValue('/mock/registry'),
}));
vi.mock('../lib/registry-entry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/registry-entry.js')>();
  return {
    ...actual,
    readRegistryEntry: vi.fn(),
  };
});
vi.mock('../lib/manifest.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/manifest.js')>();
  return {
    ...actual,
    readManifest: vi.fn(),
  };
});
vi.mock('../lib/verify.js', () => ({
  verifySkillIntegrity: vi.fn(),
}));
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  sanitiseError: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

import { existsSync } from 'node:fs';
import { readGoodBoyJson, getLockedVersion, readGoodBoyLock } from '../lib/goodboy-file.js';
import { readRegistryEntry } from '../lib/registry-entry.js';
import { readManifest } from '../lib/manifest.js';
import { verifySkillIntegrity } from '../lib/verify.js';
import { logger } from '../lib/logger.js';
import { registerSkillStatus, assertWithin } from './skill-status.js';

const mockExistsSync = vi.mocked(existsSync);
const mockReadGoodBoyJson = vi.mocked(readGoodBoyJson);
const mockGetLockedVersion = vi.mocked(getLockedVersion);
const mockReadGoodBoyLock = vi.mocked(readGoodBoyLock);
const mockReadRegistryEntry = vi.mocked(readRegistryEntry);
const mockReadManifest = vi.mocked(readManifest);
const mockVerifySkillIntegrity = vi.mocked(verifySkillIntegrity);
const mockLogger = vi.mocked(logger);

const REGISTRY_PATH = '/mock/registry';
const GLOBAL_SKILLS_BASE = join(homedir(), '.goodboy', 'skills');
const GLOBAL_MANIFEST_DIR = join(homedir(), '.goodboy');

function manifestFor(name: string, version: string): GoodBoyManifest {
  return {
    name,
    version,
    description: 'A test skill',
    author: { name: 'Test' },
    license: 'MIT',
    schema_version: '2.0.0',
    status: 'experimental',
  };
}

function entryFor(name: string, latest: string): RegistryEntry {
  return {
    name,
    latest,
    versions: {
      [latest]: { path: `versions/${latest}`, addedAt: '2026-01-01T00:00:00.000Z', yanked: false },
    },
  };
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

function buildProgram(): Command {
  const program = new Command();
  registerSkillStatus(program);
  return program;
}

describe('goodboy skill status', () => {
  let stdoutChunks: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    stdoutChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    mockExistsSync.mockReturnValue(false);
    mockGetLockedVersion.mockResolvedValue(null);
    mockReadGoodBoyLock.mockResolvedValue(null);
    mockVerifySkillIntegrity.mockResolvedValue('verified');
  });

  function tableOutput(): string {
    return stripAnsi(stdoutChunks.join(''));
  }

  it('shows "up to date" for matching installed and registry', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: { 'skill-a': '^1.0.0' } });
    mockExistsSync.mockImplementation((p) => String(p).includes('manifest.json'));
    mockReadManifest.mockResolvedValue(manifestFor('skill-a', '1.0.0'));
    mockReadRegistryEntry.mockResolvedValue(entryFor('skill-a', '1.0.0'));
    mockVerifySkillIntegrity.mockResolvedValue('verified');

    await buildProgram().parseAsync(['status'], { from: 'user' });

    expect(tableOutput()).toContain('up to date');
  });

  it('shows "upgrade available" when registry has newer version', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: { 'skill-b': '^1.0.0' } });
    mockExistsSync.mockImplementation((p) => String(p).includes('manifest.json'));
    mockReadManifest.mockResolvedValue(manifestFor('skill-b', '1.0.0'));
    mockReadRegistryEntry.mockResolvedValue(entryFor('skill-b', '2.0.0'));

    await buildProgram().parseAsync(['status'], { from: 'user' });

    expect(tableOutput()).toContain('upgrade available');
    expect(mockVerifySkillIntegrity).not.toHaveBeenCalled();
  });

  it('shows "modified" when the recomputed integrity hash mismatches the recorded one', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: { 'skill-c': '^1.0.0' } });
    mockExistsSync.mockImplementation((p) => String(p).includes('manifest.json'));
    mockReadManifest.mockResolvedValue(manifestFor('skill-c', '1.0.0'));
    mockReadRegistryEntry.mockResolvedValue(entryFor('skill-c', '1.0.0'));
    mockVerifySkillIntegrity.mockResolvedValue('mismatch');

    await buildProgram().parseAsync(['status'], { from: 'user' });

    expect(tableOutput()).toContain('modified');
  });

  it('shows "not verified" for a lock entry with no recorded integrity hash, distinct from "up to date" and "modified"', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: { 'skill-e': '^1.0.0' } });
    mockExistsSync.mockImplementation((p) => String(p).includes('manifest.json'));
    mockReadManifest.mockResolvedValue(manifestFor('skill-e', '1.0.0'));
    mockReadRegistryEntry.mockResolvedValue(entryFor('skill-e', '1.0.0'));
    mockVerifySkillIntegrity.mockResolvedValue('not-verified');

    await buildProgram().parseAsync(['status'], { from: 'user' });

    const output = tableOutput();
    expect(output).toContain('not verified');
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Modified skills will lose changes'),
    );
  });

  it('shows "not installed" when skill in goodboy.json but not installed', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: { 'skill-d': '^1.0.0' } });
    mockExistsSync.mockReturnValue(false);
    mockReadRegistryEntry.mockResolvedValue(entryFor('skill-d', '1.0.0'));

    await buildProgram().parseAsync(['status'], { from: 'user' });

    expect(tableOutput()).toContain('not installed');
  });

  it('shows warning when modified skills detected', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: { 'skill-c': '^1.0.0' } });
    mockExistsSync.mockImplementation((p) => String(p).includes('manifest.json'));
    mockReadManifest.mockResolvedValue(manifestFor('skill-c', '1.0.0'));
    mockReadRegistryEntry.mockResolvedValue(entryFor('skill-c', '1.0.0'));
    mockVerifySkillIntegrity.mockResolvedValue('mismatch');

    await buildProgram().parseAsync(['status'], { from: 'user' });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Modified skills will lose changes'),
    );
  });

  it('shows upgrade hint when upgrades available', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: { 'skill-b': '^1.0.0' } });
    mockExistsSync.mockImplementation((p) => String(p).includes('manifest.json'));
    mockReadManifest.mockResolvedValue(manifestFor('skill-b', '1.0.0'));
    mockReadRegistryEntry.mockResolvedValue(entryFor('skill-b', '2.0.0'));

    await buildProgram().parseAsync(['status'], { from: 'user' });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("Run 'goodboy upgrade' to install latest versions"),
    );
  });

  it('handles missing goodboy.json gracefully', async () => {
    mockReadGoodBoyJson.mockResolvedValue(null);

    await buildProgram().parseAsync(['status'], { from: 'user' });

    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('No goodboy.json found'));
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('skips (and warns about) an invalid skill name found in goodboy.json', async () => {
    mockReadGoodBoyJson.mockResolvedValue({
      schema: '1.0.0',
      skills: { 'Bad_Name!': '^1.0.0', 'skill-a': '^1.0.0' },
    });
    mockExistsSync.mockImplementation((p) => String(p).includes('manifest.json'));
    mockReadManifest.mockResolvedValue(manifestFor('skill-a', '1.0.0'));
    mockReadRegistryEntry.mockResolvedValue(entryFor('skill-a', '1.0.0'));
    mockVerifySkillIntegrity.mockResolvedValue('verified');

    await buildProgram().parseAsync(['status'], { from: 'user' });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping invalid skill name in goodboy.json: "Bad_Name!"'),
    );
    expect(tableOutput()).toContain('skill-a');
  });

  it('reports an unexpected failure via logger.error and exits non-zero', async () => {
    mockReadGoodBoyJson.mockRejectedValue(new Error('goodboy.json contains invalid JSON'));

    await buildProgram().parseAsync(['status'], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('goodboy.json contains invalid JSON'),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('handles empty skills in goodboy.json', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: {} });

    await buildProgram().parseAsync(['status'], { from: 'user' });

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('No skills listed'));
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('treats a skill with a corrupt/invalid installed manifest as not installed', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: { 'skill-f': '^1.0.0' } });
    mockExistsSync.mockImplementation((p) => String(p).includes('manifest.json'));
    mockReadManifest.mockResolvedValue({ not: 'a valid manifest' });
    mockReadRegistryEntry.mockResolvedValue(null);

    await buildProgram().parseAsync(['status'], { from: 'user' });

    expect(tableOutput()).toContain('not installed');
  });

  it('still runs the integrity check (and shows "—" for Registry) when the skill has no matching registry entry', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: { 'skill-g': '^1.0.0' } });
    mockExistsSync.mockImplementation((p) => String(p).includes('manifest.json'));
    mockReadManifest.mockResolvedValue(manifestFor('skill-g', '1.0.0'));
    mockReadRegistryEntry.mockResolvedValue(null);
    mockVerifySkillIntegrity.mockResolvedValue('verified');

    await buildProgram().parseAsync(['status'], { from: 'user' });

    expect(mockVerifySkillIntegrity).toHaveBeenCalled();
    const output = tableOutput();
    expect(output).toContain('up to date');
    expect(output).toContain('—');
  });

  it('-g flag reads from global scope', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: { 'skill-a': '^1.0.0' } });
    mockExistsSync.mockImplementation((p) => String(p).includes('manifest.json'));
    mockReadManifest.mockResolvedValue(manifestFor('skill-a', '1.0.0'));
    mockReadRegistryEntry.mockResolvedValue(entryFor('skill-a', '1.0.0'));
    mockVerifySkillIntegrity.mockResolvedValue('verified');

    await buildProgram().parseAsync(['status', '--global'], { from: 'user' });

    expect(mockReadGoodBoyJson).toHaveBeenCalledWith(GLOBAL_MANIFEST_DIR);
    expect(mockGetLockedVersion).toHaveBeenCalledWith(GLOBAL_MANIFEST_DIR, 'skill-a');
    expect(mockReadGoodBoyLock).toHaveBeenCalledWith(GLOBAL_MANIFEST_DIR);
    expect(mockExistsSync).toHaveBeenCalledWith(join(GLOBAL_SKILLS_BASE, 'skill-a', 'manifest.json'));
  });
});

describe('assertWithin', () => {
  it('does not throw when the target is inside the base directory', () => {
    expect(() => assertWithin('/base/skills/skill-a', '/base/skills', 'skill path')).not.toThrow();
  });

  it('throws when the target escapes the base directory via ../', () => {
    expect(() => assertWithin('/base/skills/../../etc', '/base/skills', 'skill path')).toThrow(
      'Refused: skill path escapes the expected directory',
    );
  });

  it('throws when the target is a sibling directory with a shared prefix', () => {
    expect(() => assertWithin('/base/skills-evil', '/base/skills', 'skill path')).toThrow(
      'Refused: skill path escapes the expected directory',
    );
  });
});
