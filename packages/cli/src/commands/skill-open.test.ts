import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { join } from 'node:path';
import type { RegistryEntry } from '../lib/registry-entry.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
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

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readRegistryEntry } from '../lib/registry-entry.js';
import { logger } from '../lib/logger.js';
import { resolveEditor, registerSkillOpen } from './skill-open.js';

const mockSpawn = vi.mocked(spawn);
const mockSpawnSync = vi.mocked(spawnSync);
const mockExistsSync = vi.mocked(existsSync);
const mockReadRegistryEntry = vi.mocked(readRegistryEntry);
const mockLogger = vi.mocked(logger);

const REGISTRY_PATH = '/mock/registry';
const SKILL_DIR = join(REGISTRY_PATH, 'my-skill');

function makeEntry(): RegistryEntry {
  return {
    name: 'my-skill',
    latest: '1.0.0',
    versions: {
      '1.0.0': { path: 'versions/1.0.0', addedAt: '2026-01-01T00:00:00.000Z', yanked: false },
      '0.9.0': { path: 'versions/0.9.0', addedAt: '2025-12-01T00:00:00.000Z', yanked: false },
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeProc(closeCode: number | null): any {
  const proc = {
    on: vi.fn((event: string, cb: (code: number | null) => void) => {
      if (event === 'close') {
        Promise.resolve().then(() => cb(closeCode));
      }
      return proc;
    }),
  };
  return proc;
}

function buildProgram(): Command {
  const program = new Command();
  registerSkillOpen(program);
  return program;
}

describe('resolveEditor()', () => {
  const originalEditor = process.env['EDITOR'];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalEditor === undefined) {
      delete process.env['EDITOR'];
    } else {
      process.env['EDITOR'] = originalEditor;
    }
  });

  it('returns $EDITOR when set', () => {
    process.env['EDITOR'] = 'my-custom-editor';
    expect(resolveEditor()).toBe('my-custom-editor');
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('falls back to first available editor when $EDITOR not set', () => {
    delete process.env['EDITOR'];
    mockSpawnSync.mockImplementation((cmd) => {
      const status = cmd === 'nano' ? 0 : 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { status } as any;
    });
    expect(resolveEditor()).toBe('nano');
  });

  it('throws clean error when no editor found', () => {
    delete process.env['EDITOR'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockSpawnSync.mockReturnValue({ status: null } as any);
    expect(() => resolveEditor()).toThrow('No editor found');
  });
});

describe('goodboy skill open', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    process.env['EDITOR'] = 'my-editor';
    mockExistsSync.mockReturnValue(true);
    mockReadRegistryEntry.mockResolvedValue(makeEntry());
    mockSpawn.mockReturnValue(makeFakeProc(0));
  });

  afterEach(() => {
    delete process.env['EDITOR'];
  });

  it('resolves correct SKILL.md path for latest version', async () => {
    await buildProgram().parseAsync(['open', 'my-skill'], { from: 'user' });
    expect(mockSpawn).toHaveBeenCalledWith(
      'my-editor',
      [join(SKILL_DIR, 'versions', '1.0.0', 'SKILL.md')],
      { stdio: 'inherit' },
    );
  });

  it('resolves correct SKILL.md path for --version flag', async () => {
    await buildProgram().parseAsync(['open', 'my-skill', '--version', '0.9.0'], { from: 'user' });
    expect(mockSpawn).toHaveBeenCalledWith(
      'my-editor',
      [join(SKILL_DIR, 'versions', '0.9.0', 'SKILL.md')],
      { stdio: 'inherit' },
    );
  });

  it('calls spawn with correct editor and file path', async () => {
    await buildProgram().parseAsync(['open', 'my-skill'], { from: 'user' });
    expect(mockSpawn).toHaveBeenCalledOnce();
    const [editorArg, args, opts] = mockSpawn.mock.calls[0]!;
    expect(editorArg).toBe('my-editor');
    expect(args).toEqual([join(SKILL_DIR, 'versions', '1.0.0', 'SKILL.md')]);
    expect(opts).toEqual({ stdio: 'inherit' });
  });

  it('shows warning about not editing .claude/skills/', async () => {
    await buildProgram().parseAsync(['open', 'my-skill'], { from: 'user' });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Edit the registry copy only'),
    );
  });

  it('throws clean error when skill not in registry', async () => {
    mockReadRegistryEntry.mockResolvedValue(null);
    await expect(
      buildProgram().parseAsync(['open', 'my-skill'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('not found in registry'));
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('throws clean error when SKILL.md not found', async () => {
    mockExistsSync.mockReturnValue(false);
    await expect(
      buildProgram().parseAsync(['open', 'my-skill'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('SKILL.md not found'));
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('validates skill name pattern', async () => {
    await expect(
      buildProgram().parseAsync(['open', 'Bad_Name!'], { from: 'user' }),
    ).rejects.toThrow('process.exit called');
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Invalid skill name'));
    expect(mockReadRegistryEntry).not.toHaveBeenCalled();
  });
});
