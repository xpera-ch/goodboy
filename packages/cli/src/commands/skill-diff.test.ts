import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { RegistryEntry } from '../lib/registry-entry.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn(),
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
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  sanitiseError: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

import { existsSync, readFileSync } from 'node:fs';
import { readRegistryEntry } from '../lib/registry-entry.js';
import { logger } from '../lib/logger.js';
import { computeDiff, registerSkillDiff } from './skill-diff.js';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReadRegistryEntry = vi.mocked(readRegistryEntry);
const mockLogger = vi.mocked(logger);

const REGISTRY_PATH = '/mock/registry';
const SKILL_DIR = join(REGISTRY_PATH, 'my-skill');
const REGISTRY_SKILL_MD = join(SKILL_DIR, 'versions', '1.0.0', 'SKILL.md');
const CWD = process.cwd();
const INSTALLED_SKILL_MD = join(CWD, '.claude', 'skills', 'my-skill', 'SKILL.md');
const GLOBAL_SKILL_MD = join(homedir(), '.goodboy', 'skills', 'my-skill', 'SKILL.md');

function makeEntry(): RegistryEntry {
  return {
    name: 'my-skill',
    latest: '1.0.0',
    versions: {
      '1.0.0': { path: 'versions/1.0.0', addedAt: '2026-01-01T00:00:00.000Z', yanked: false },
    },
  };
}

function buildProgram(): Command {
  const program = new Command();
  registerSkillDiff(program);
  return program;
}

describe('computeDiff()', () => {
  it('returns empty when files identical', () => {
    expect(computeDiff('a\nb\nc', 'a\nb\nc', 'old', 'new')).toEqual([]);
  });

  it('shows added lines with + prefix', () => {
    const result = computeDiff('a\nb', 'a\nb\nc', 'old', 'new');
    expect(result.some((l) => l.includes('+') && l.includes('c'))).toBe(true);
  });

  it('shows removed lines with - prefix', () => {
    const result = computeDiff('a\nb\nc', 'a\nb', 'old', 'new');
    expect(result.some((l) => l.includes('-') && l.includes('c'))).toBe(true);
  });

  it('shows unchanged lines with space prefix', () => {
    const result = computeDiff('a\nb\nc', 'a\nX\nc', 'old', 'new');
    // 'a' and 'c' are unchanged context lines around the 'b'→'X' change
    expect(result.some((l) => l.startsWith('  a'))).toBe(true);
    expect(result.some((l) => l.startsWith('  c'))).toBe(true);
  });

  it('handles empty files', () => {
    expect(computeDiff('', '', 'old', 'new')).toEqual([]);
    const added = computeDiff('', 'line1\nline2', 'old', 'new');
    expect(added.length).toBe(2);
    expect(added.every((l) => l.includes('+'))).toBe(true);
  });

  it('handles completely different files', () => {
    const result = computeDiff('a\nb', 'x\ny', 'old', 'new');
    expect(result.some((l) => l.includes('-') && l.includes('a'))).toBe(true);
    expect(result.some((l) => l.includes('-') && l.includes('b'))).toBe(true);
    expect(result.some((l) => l.includes('+') && l.includes('x'))).toBe(true);
    expect(result.some((l) => l.includes('+') && l.includes('y'))).toBe(true);
  });
});

describe('goodboy skill diff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    mockExistsSync.mockReturnValue(true);
    mockReadRegistryEntry.mockResolvedValue(makeEntry());
  });

  it('reports clean when installed matches registry', async () => {
    mockReadFileSync.mockReturnValue('same content');
    await buildProgram().parseAsync(['diff', 'my-skill'], { from: 'user' });
    expect(mockLogger.success).toHaveBeenCalledWith(
      expect.stringContaining('installed copy matches registry@1.0.0'),
    );
  });

  it('shows diff when installed differs from registry', async () => {
    mockReadFileSync.mockImplementation((path) => {
      return path === INSTALLED_SKILL_MD ? 'installed content' : 'registry content';
    });
    await buildProgram().parseAsync(['diff', 'my-skill'], { from: 'user' });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('installed copy differs from registry@1.0.0'),
    );
    const infoCalls = mockLogger.info.mock.calls.map((c) => c[0]);
    expect(infoCalls.some((l) => l.includes('installed content'))).toBe(true);
    expect(infoCalls.some((l) => l.includes('registry content'))).toBe(true);
  });

  it('shows warning about upgrade overwriting changes', async () => {
    mockReadFileSync.mockImplementation((path) => {
      return path === INSTALLED_SKILL_MD ? 'installed content' : 'registry content';
    });
    await buildProgram().parseAsync(['diff', 'my-skill'], { from: 'user' });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("will be lost on 'goodboy upgrade'"),
    );
  });

  it('handles skill not installed gracefully', async () => {
    mockExistsSync.mockImplementation((path) => path !== INSTALLED_SKILL_MD);
    await buildProgram().parseAsync(['diff', 'my-skill'], { from: 'user' });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('is not installed in this scope'),
    );
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('validates skill name pattern', async () => {
    await expect(
      buildProgram().parseAsync(['diff', 'Bad_Name!'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Invalid skill name'));
    expect(mockReadRegistryEntry).not.toHaveBeenCalled();
  });

  it('-g flag reads from global skills path', async () => {
    mockReadFileSync.mockReturnValue('same content');
    await buildProgram().parseAsync(['diff', 'my-skill', '--global'], { from: 'user' });
    expect(mockExistsSync).toHaveBeenCalledWith(GLOBAL_SKILL_MD);
  });
});
