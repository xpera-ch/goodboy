import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { GoodBoyManifest } from '../types/index.js';
import type { RegistryEntry } from '../lib/registry-entry.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));
vi.mock('../lib/goodboy-file.js', () => ({
  readGoodBoyJson: vi.fn(),
  getLockedVersion: vi.fn().mockResolvedValue(null),
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
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  sanitiseError: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

import { existsSync, readFileSync } from 'node:fs';
import { readGoodBoyJson, getLockedVersion } from '../lib/goodboy-file.js';
import { readRegistryEntry } from '../lib/registry-entry.js';
import { readManifest } from '../lib/manifest.js';
import { logger } from '../lib/logger.js';
import { registerSkillStatus } from './skill-status.js';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReadGoodBoyJson = vi.mocked(readGoodBoyJson);
const mockGetLockedVersion = vi.mocked(getLockedVersion);
const mockReadRegistryEntry = vi.mocked(readRegistryEntry);
const mockReadManifest = vi.mocked(readManifest);
const mockLogger = vi.mocked(logger);

const REGISTRY_PATH = '/mock/registry';
const CWD = process.cwd();
const SKILLS_BASE = join(CWD, '.claude', 'skills');
const GLOBAL_SKILLS_BASE = join(homedir(), '.goodboy', 'skills');
const GLOBAL_MANIFEST_DIR = join(homedir(), '.goodboy');

function manifestFor(name: string, version: string): GoodBoyManifest {
  return {
    name,
    version,
    description: 'A test skill',
    author: { name: 'Test' },
    license: 'MIT',
    schema_version: '1.0.0',
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
  });

  function tableOutput(): string {
    return stripAnsi(stdoutChunks.join(''));
  }

  it('shows "up to date" for matching installed and registry', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: { 'skill-a': '^1.0.0' } });
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path.includes('manifest.json') || path.includes('SKILL.md');
    });
    mockReadManifest.mockResolvedValue(manifestFor('skill-a', '1.0.0'));
    mockReadRegistryEntry.mockResolvedValue(entryFor('skill-a', '1.0.0'));
    mockReadFileSync.mockReturnValue('same content');

    await buildProgram().parseAsync(['status'], { from: 'user' });

    expect(tableOutput()).toContain('up to date');
  });

  it('shows "upgrade available" when registry has newer version', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: { 'skill-b': '^1.0.0' } });
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path.includes('manifest.json') || path.includes('SKILL.md');
    });
    mockReadManifest.mockResolvedValue(manifestFor('skill-b', '1.0.0'));
    mockReadRegistryEntry.mockResolvedValue(entryFor('skill-b', '2.0.0'));
    mockReadFileSync.mockReturnValue('irrelevant');

    await buildProgram().parseAsync(['status'], { from: 'user' });

    expect(tableOutput()).toContain('upgrade available');
  });

  it('shows "modified" when installed SKILL.md differs from registry', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: { 'skill-c': '^1.0.0' } });
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path.includes('manifest.json') || path.includes('SKILL.md');
    });
    mockReadManifest.mockResolvedValue(manifestFor('skill-c', '1.0.0'));
    mockReadRegistryEntry.mockResolvedValue(entryFor('skill-c', '1.0.0'));
    mockReadFileSync.mockImplementation((p) => {
      const path = String(p);
      return path.startsWith(SKILLS_BASE) ? 'edited content' : 'original content';
    });

    await buildProgram().parseAsync(['status'], { from: 'user' });

    expect(tableOutput()).toContain('modified');
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
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path.includes('manifest.json') || path.includes('SKILL.md');
    });
    mockReadManifest.mockResolvedValue(manifestFor('skill-c', '1.0.0'));
    mockReadRegistryEntry.mockResolvedValue(entryFor('skill-c', '1.0.0'));
    mockReadFileSync.mockImplementation((p) => {
      const path = String(p);
      return path.startsWith(SKILLS_BASE) ? 'edited content' : 'original content';
    });

    await buildProgram().parseAsync(['status'], { from: 'user' });

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Modified skills will lose changes'),
    );
  });

  it('shows upgrade hint when upgrades available', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: { 'skill-b': '^1.0.0' } });
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path.includes('manifest.json') || path.includes('SKILL.md');
    });
    mockReadManifest.mockResolvedValue(manifestFor('skill-b', '1.0.0'));
    mockReadRegistryEntry.mockResolvedValue(entryFor('skill-b', '2.0.0'));
    mockReadFileSync.mockReturnValue('irrelevant');

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

  it('handles empty skills in goodboy.json', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: {} });

    await buildProgram().parseAsync(['status'], { from: 'user' });

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('No skills listed'));
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('-g flag reads from global scope', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: { 'skill-a': '^1.0.0' } });
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path.includes('manifest.json') || path.includes('SKILL.md');
    });
    mockReadManifest.mockResolvedValue(manifestFor('skill-a', '1.0.0'));
    mockReadRegistryEntry.mockResolvedValue(entryFor('skill-a', '1.0.0'));
    mockReadFileSync.mockReturnValue('same content');

    await buildProgram().parseAsync(['status', '--global'], { from: 'user' });

    expect(mockReadGoodBoyJson).toHaveBeenCalledWith(GLOBAL_MANIFEST_DIR);
    expect(mockGetLockedVersion).toHaveBeenCalledWith(GLOBAL_MANIFEST_DIR, 'skill-a');
    expect(mockExistsSync).toHaveBeenCalledWith(join(GLOBAL_SKILLS_BASE, 'skill-a', 'manifest.json'));
  });
});
