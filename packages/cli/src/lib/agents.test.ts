import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';

vi.mock('node:fs/promises');
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { mkdir, lstat, symlink, unlink, readlink } from 'node:fs/promises';
import {
  resolveAgentFlags,
  createAgentSymlinks,
  removeAgentSymlinks,
  AGENT_SKILL_DIRS,
} from './agents.js';
import { logger } from './logger.js';

const mockMkdir   = vi.mocked(mkdir);
const mockLstat   = vi.mocked(lstat);
const mockSymlink = vi.mocked(symlink);
const mockUnlink  = vi.mocked(unlink);
const mockReadlink = vi.mocked(readlink);

const HOME = homedir();
const CLAUDE_SKILLS = join(HOME, '.claude', 'skills');
const CODEX_SKILLS  = join(HOME, '.codex',  'skills');
const GEMINI_SKILLS = join(HOME, '.gemini', 'skills');
const STORE_PATH    = join(HOME, '.goodboy', 'skills', 'my-skill');

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdir.mockResolvedValue(undefined as never);
  mockSymlink.mockResolvedValue(undefined);
  mockUnlink.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// AGENT_SKILL_DIRS
// ---------------------------------------------------------------------------

describe('AGENT_SKILL_DIRS', () => {
  it('has entries for claude-code, codex, and gemini', () => {
    expect(AGENT_SKILL_DIRS['claude-code']).toBe(CLAUDE_SKILLS);
    expect(AGENT_SKILL_DIRS['codex']).toBe(CODEX_SKILLS);
    expect(AGENT_SKILL_DIRS['gemini']).toBe(GEMINI_SKILLS);
  });
});

// ---------------------------------------------------------------------------
// resolveAgentFlags
// ---------------------------------------------------------------------------

describe('resolveAgentFlags', () => {
  it('returns ["claude-code"] by default when no flags are set', () => {
    expect(resolveAgentFlags({})).toEqual(['claude-code']);
  });

  it('returns all agents when allAgents is true', () => {
    const result = resolveAgentFlags({ allAgents: true });
    expect(result).toEqual(Object.keys(AGENT_SKILL_DIRS));
  });

  it('returns only flagged agents', () => {
    expect(resolveAgentFlags({ claudeCode: true })).toEqual(['claude-code']);
    expect(resolveAgentFlags({ codex: true })).toEqual(['codex']);
    expect(resolveAgentFlags({ gemini: true })).toEqual(['gemini']);
  });

  it('returns multiple agents when multiple flags set', () => {
    const result = resolveAgentFlags({ claudeCode: true, codex: true });
    expect(result).toEqual(['claude-code', 'codex']);
  });

  it('allAgents overrides individual flags', () => {
    const result = resolveAgentFlags({ claudeCode: true, allAgents: true });
    expect(result).toEqual(Object.keys(AGENT_SKILL_DIRS));
  });
});

// ---------------------------------------------------------------------------
// createAgentSymlinks
// ---------------------------------------------------------------------------

describe('createAgentSymlinks', () => {
  const OPTS = { agents: ['claude-code'], skillName: 'my-skill', storePath: STORE_PATH };

  it('throws for unknown agent', async () => {
    await expect(
      createAgentSymlinks({ ...OPTS, agents: ['unknown-agent'] }),
    ).rejects.toThrow('Unknown agent: "unknown-agent"');
  });

  it('creates symlink when target does not exist', async () => {
    mockLstat.mockRejectedValue(Object.assign(new Error(), { code: 'ENOENT' }));

    await createAgentSymlinks(OPTS);

    expect(mockSymlink).toHaveBeenCalledWith(
      STORE_PATH,
      join(CLAUDE_SKILLS, 'my-skill'),
    );
  });

  it('skips when symlink already points to the correct storePath', async () => {
    mockLstat.mockResolvedValue({ isSymbolicLink: () => true } as never);
    mockReadlink.mockResolvedValue(STORE_PATH);

    await createAgentSymlinks(OPTS);

    expect(mockUnlink).not.toHaveBeenCalled();
    expect(mockSymlink).not.toHaveBeenCalled();
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      expect.stringContaining('already linked correctly'),
    );
  });

  it('replaces a stale symlink pointing to the wrong target', async () => {
    mockLstat.mockResolvedValue({ isSymbolicLink: () => true } as never);
    mockReadlink.mockResolvedValue('/old/store/path');

    await createAgentSymlinks(OPTS);

    expect(mockUnlink).toHaveBeenCalledWith(join(CLAUDE_SKILLS, 'my-skill'));
    expect(mockSymlink).toHaveBeenCalledWith(STORE_PATH, join(CLAUDE_SKILLS, 'my-skill'));
  });

  it('throws when target exists as a real directory', async () => {
    mockLstat.mockResolvedValue({ isSymbolicLink: () => false } as never);

    await expect(createAgentSymlinks(OPTS)).rejects.toThrow(
      'exists as a real directory',
    );
    expect(mockSymlink).not.toHaveBeenCalled();
  });

  it('links to all agents when multiple agents are passed', async () => {
    mockLstat.mockRejectedValue(Object.assign(new Error(), { code: 'ENOENT' }));

    await createAgentSymlinks({
      ...OPTS,
      agents: ['claude-code', 'codex', 'gemini'],
    });

    expect(mockSymlink).toHaveBeenCalledTimes(3);
    expect(mockSymlink).toHaveBeenCalledWith(STORE_PATH, join(CLAUDE_SKILLS, 'my-skill'));
    expect(mockSymlink).toHaveBeenCalledWith(STORE_PATH, join(CODEX_SKILLS, 'my-skill'));
    expect(mockSymlink).toHaveBeenCalledWith(STORE_PATH, join(GEMINI_SKILLS, 'my-skill'));
  });
});

// ---------------------------------------------------------------------------
// removeAgentSymlinks
// ---------------------------------------------------------------------------

describe('removeAgentSymlinks', () => {
  it('removes an existing symlink', async () => {
    mockLstat.mockResolvedValue({ isSymbolicLink: () => true } as never);

    await removeAgentSymlinks('my-skill', ['claude-code']);

    expect(mockUnlink).toHaveBeenCalledWith(join(CLAUDE_SKILLS, 'my-skill'));
  });

  it('is a no-op when the symlink does not exist', async () => {
    mockLstat.mockRejectedValue(Object.assign(new Error(), { code: 'ENOENT' }));

    await removeAgentSymlinks('my-skill', ['claude-code']);

    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('skips real directories and emits a warning', async () => {
    mockLstat.mockResolvedValue({ isSymbolicLink: () => false } as never);

    await removeAgentSymlinks('my-skill', ['claude-code']);

    expect(mockUnlink).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('real directory'),
    );
  });

  it('warns and skips unknown agents', async () => {
    await removeAgentSymlinks('my-skill', ['unknown-agent']);

    expect(mockUnlink).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('Unknown agent'),
    );
  });

  it('handles multiple agents', async () => {
    mockLstat
      .mockResolvedValueOnce({ isSymbolicLink: () => true } as never)
      .mockResolvedValueOnce({ isSymbolicLink: () => true } as never);

    await removeAgentSymlinks('my-skill', ['claude-code', 'codex']);

    expect(mockUnlink).toHaveBeenCalledTimes(2);
  });
});
