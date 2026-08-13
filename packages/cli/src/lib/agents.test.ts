import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';

vi.mock('node:fs/promises');
vi.mock('@inquirer/prompts', () => ({ confirm: vi.fn() }));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { mkdir, lstat, symlink, unlink, readlink, readdir } from 'node:fs/promises';
import { confirm } from '@inquirer/prompts';
import {
  resolveAgentFlags,
  createAgentSymlinks,
  removeAgentSymlinks,
  agentsSharingPath,
  formatOtherReaders,
  AGENT_SKILL_DIRS,
} from './agents.js';
import { logger } from './logger.js';

const mockMkdir    = vi.mocked(mkdir);
const mockLstat    = vi.mocked(lstat);
const mockSymlink  = vi.mocked(symlink);
const mockUnlink   = vi.mocked(unlink);
const mockReadlink = vi.mocked(readlink);
const mockReaddir  = vi.mocked(readdir);
const mockConfirm  = vi.mocked(confirm);

const HOME          = homedir();
const CLAUDE_SKILLS = join(HOME, '.claude', 'skills');
const AGENTS_SKILLS = join(HOME, '.agents', 'skills');
const GEMINI_SKILLS = join(HOME, '.gemini', 'skills');
const CODEX_LEGACY  = join(HOME, '.codex', 'skills');
const STORE_PATH    = join(HOME, '.goodboy', 'skills', 'my-skill');

const ENOENT = () => Object.assign(new Error(), { code: 'ENOENT' });
const SYMLINK_STAT = { isSymbolicLink: () => true } as never;
// Dirent-shaped entries for noticeStaleCodexDir's withFileTypes readdir.
const SYMLINK_ENTRY = { name: 'stale-skill', isSymbolicLink: () => true };
const REAL_ENTRY = { name: 'notes.txt', isSymbolicLink: () => false };

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdir.mockResolvedValue(undefined as never);
  mockSymlink.mockResolvedValue(undefined);
  mockUnlink.mockResolvedValue(undefined);
  mockReaddir.mockResolvedValue([] as never);
  mockConfirm.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// AGENT_SKILL_DIRS
// ---------------------------------------------------------------------------

describe('AGENT_SKILL_DIRS', () => {
  it('maps each agent to exactly its list of directories', () => {
    expect(AGENT_SKILL_DIRS['claude-code']).toEqual([CLAUDE_SKILLS]);
    expect(AGENT_SKILL_DIRS['codex']).toEqual([AGENTS_SKILLS]);
    expect(AGENT_SKILL_DIRS['gemini']).toEqual([AGENTS_SKILLS, GEMINI_SKILLS]);
    expect(AGENT_SKILL_DIRS['agents']).toEqual([AGENTS_SKILLS]);
  });
});

// ---------------------------------------------------------------------------
// resolveAgentFlags
// ---------------------------------------------------------------------------

describe('resolveAgentFlags', () => {
  it('returns ["claude-code"] by default when no flags are set', () => {
    expect(resolveAgentFlags({})).toEqual(['claude-code']);
  });

  it('returns every dedicated agent but NOT the generic "agents" key for --all-agents', () => {
    const result = resolveAgentFlags({ allAgents: true });
    expect(result).toEqual(['claude-code', 'codex', 'gemini']);
    expect(result).not.toContain('agents');
  });

  it('returns only flagged agents, including the standalone agents flag', () => {
    expect(resolveAgentFlags({ claudeCode: true })).toEqual(['claude-code']);
    expect(resolveAgentFlags({ codex: true })).toEqual(['codex']);
    expect(resolveAgentFlags({ gemini: true })).toEqual(['gemini']);
    expect(resolveAgentFlags({ agents: true })).toEqual(['agents']);
  });

  it('returns multiple agents when multiple flags set', () => {
    expect(resolveAgentFlags({ claudeCode: true, codex: true })).toEqual(['claude-code', 'codex']);
    expect(resolveAgentFlags({ gemini: true, agents: true })).toEqual(['gemini', 'agents']);
  });

  it('allAgents overrides individual flags, including agents', () => {
    const result = resolveAgentFlags({ agents: true, allAgents: true });
    expect(result).toEqual(['claude-code', 'codex', 'gemini']);
    expect(result).not.toContain('agents');
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
    mockLstat.mockRejectedValue(ENOENT());

    await createAgentSymlinks(OPTS);

    expect(mockSymlink).toHaveBeenCalledWith(
      STORE_PATH,
      join(CLAUDE_SKILLS, 'my-skill'),
    );
  });

  it('installing for codex alone creates exactly one symlink, to ~/.agents/skills/', async () => {
    mockLstat.mockRejectedValue(ENOENT());

    await createAgentSymlinks({ ...OPTS, agents: ['codex'] });

    expect(mockSymlink).toHaveBeenCalledTimes(1);
    expect(mockSymlink).toHaveBeenCalledWith(STORE_PATH, join(AGENTS_SKILLS, 'my-skill'));
  });

  it('installing for gemini alone creates exactly two symlinks, to both paths', async () => {
    mockLstat.mockRejectedValue(ENOENT());

    await createAgentSymlinks({ ...OPTS, agents: ['gemini'] });

    expect(mockSymlink).toHaveBeenCalledTimes(2);
    expect(mockSymlink).toHaveBeenCalledWith(STORE_PATH, join(AGENTS_SKILLS, 'my-skill'));
    expect(mockSymlink).toHaveBeenCalledWith(STORE_PATH, join(GEMINI_SKILLS, 'my-skill'));
  });

  it('links to all agents: one call per path in each list (4 paths across 3 agents)', async () => {
    mockLstat.mockRejectedValue(ENOENT());

    await createAgentSymlinks({
      ...OPTS,
      agents: ['claude-code', 'codex', 'gemini'],
    });

    // claude-code: 1 path, codex: 1 path, gemini: 2 paths = 4 calls. The
    // shared ~/.agents/skills/ path is written by both codex and gemini —
    // overlapping writes are safe because each path is idempotent (the
    // already-linked check below), not because they are deduplicated.
    expect(mockSymlink).toHaveBeenCalledTimes(4);
    expect(mockSymlink).toHaveBeenCalledWith(STORE_PATH, join(CLAUDE_SKILLS, 'my-skill'));
    expect(mockSymlink).toHaveBeenCalledWith(STORE_PATH, join(AGENTS_SKILLS, 'my-skill'));
    expect(mockSymlink).toHaveBeenCalledWith(STORE_PATH, join(GEMINI_SKILLS, 'my-skill'));
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('skips when symlink already points to the correct storePath', async () => {
    mockLstat.mockResolvedValue(SYMLINK_STAT);
    mockReadlink.mockResolvedValue(STORE_PATH);

    await createAgentSymlinks(OPTS);

    expect(mockUnlink).not.toHaveBeenCalled();
    expect(mockSymlink).not.toHaveBeenCalled();
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      expect.stringContaining('already linked correctly'),
    );
  });

  it('does not re-link a shared path already correctly linked — both agents report already-linked', async () => {
    mockLstat.mockImplementation((p: string) =>
      p === CODEX_LEGACY ? Promise.reject(ENOENT()) : Promise.resolve(SYMLINK_STAT),
    );
    mockReadlink.mockResolvedValue(STORE_PATH);

    await createAgentSymlinks({ ...OPTS, agents: ['codex', 'gemini'] });

    // Both agents hit the shared path, both see it correctly linked: the
    // idempotency check is what makes the overlapping codex/gemini lists safe.
    // One "already linked" per path processed — codex has 1, gemini has 2.
    expect(mockSymlink).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
    expect(vi.mocked(logger.info)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      expect.stringContaining('codex: already linked correctly'),
    );
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      expect.stringContaining('gemini: already linked correctly'),
    );
  });

  it('replaces a stale symlink pointing to the wrong target', async () => {
    mockLstat.mockResolvedValue(SYMLINK_STAT);
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
});

// ---------------------------------------------------------------------------
// agentsSharingPath
// ---------------------------------------------------------------------------

describe('agentsSharingPath', () => {
  it('returns the single owner for a path present in only one list', () => {
    expect(agentsSharingPath(CLAUDE_SKILLS)).toEqual(['claude-code']);
    expect(agentsSharingPath(GEMINI_SKILLS)).toEqual(['gemini']);
  });

  it('returns every owner for a path shared by two or more lists', () => {
    expect(agentsSharingPath(AGENTS_SKILLS)).toEqual(['codex', 'gemini', 'agents']);
  });

  it('returns an empty list for a path in no list', () => {
    expect(agentsSharingPath(join(HOME, '.cursor', 'skills'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// formatOtherReaders
// ---------------------------------------------------------------------------

describe('formatOtherReaders', () => {
  it('lists the real co-readers, excluding the current agent and the internal agents key', () => {
    expect(formatOtherReaders(['codex', 'gemini', 'agents'], 'codex')).toBe(
      'also read by: gemini',
    );
    expect(formatOtherReaders(['codex', 'gemini'], 'gemini')).toBe(
      'also read by: codex',
    );
  });

  it('falls back to describing the shared convention when the agents key is the only other owner', () => {
    // Fabricated owner list: with today's map 'agents' is never the sole
    // co-owner, but the guard must hold anyway — never an empty reader list.
    const phrase = formatOtherReaders(['codex', 'agents'], 'codex');
    expect(phrase).toBe(`part of the shared ${AGENT_SKILL_DIRS['agents'][0]} convention`);
    expect(phrase).not.toMatch(/read by:\s*$/);
  });
});

// ---------------------------------------------------------------------------
// removeAgentSymlinks
// ---------------------------------------------------------------------------

describe('removeAgentSymlinks', () => {
  // Targets exist as symlinks unless the mock says otherwise; the legacy
  // codex dir is absent unless a test opts into the notice. `unlinked`
  // mirrors the real filesystem so later lstat calls see the symlink gone.
  let unlinked: Set<string>;
  function mockExistingSymlinks(): void {
    unlinked = new Set();
    mockUnlink.mockImplementation(async (p: string) => {
      unlinked.add(String(p));
    });
    mockLstat.mockImplementation((p: string) => {
      if (String(p) === CODEX_LEGACY) return Promise.reject(ENOENT());
      if (unlinked.has(String(p))) return Promise.reject(ENOENT());
      return Promise.resolve(SYMLINK_STAT);
    });
  }

  it('removes an existing symlink from an exclusive path with no prompt', async () => {
    mockExistingSymlinks();

    await expect(removeAgentSymlinks('my-skill', ['claude-code'])).resolves.toBe(true);

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockUnlink).toHaveBeenCalledWith(join(CLAUDE_SKILLS, 'my-skill'));
  });

  it('is a no-op when the symlink does not exist — still reports completion', async () => {
    mockLstat.mockRejectedValue(ENOENT());

    await expect(removeAgentSymlinks('my-skill', ['claude-code'])).resolves.toBe(true);

    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('skips real directories and emits a warning', async () => {
    mockLstat.mockResolvedValue({ isSymbolicLink: () => false } as never);

    await expect(removeAgentSymlinks('my-skill', ['claude-code'])).resolves.toBe(true);

    expect(mockUnlink).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('real directory'),
    );
  });

  it('warns and skips unknown agents', async () => {
    await expect(removeAgentSymlinks('my-skill', ['unknown-agent'])).resolves.toBe(true);

    expect(mockUnlink).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('Unknown agent'),
    );
  });

  it('prompts before removing a shared path and unlinks on confirmation', async () => {
    mockExistingSymlinks();
    mockConfirm.mockResolvedValue(true);

    await expect(removeAgentSymlinks('my-skill', ['codex'])).resolves.toBe(true);

    // 'agents' is GoodBoy's internal map key, not a tool — the message names
    // only the real co-reader (gemini) and never the internal key. Exact
    // equality pins both properties at once.
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: `${join(AGENTS_SKILLS, 'my-skill')} is also read by: gemini. Remove anyway?`,
      }),
    );
    expect(mockUnlink).toHaveBeenCalledWith(join(AGENTS_SKILLS, 'my-skill'));
  });

  it('declining a shared path aborts the whole call: returns false, unlinks nothing', async () => {
    mockExistingSymlinks();
    mockConfirm.mockResolvedValue(false);

    await expect(removeAgentSymlinks('my-skill', ['codex'])).resolves.toBe(false);

    expect(mockUnlink).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('Nothing was uninstalled'),
    );
  });

  it('handles multiple agents', async () => {
    mockExistingSymlinks();

    await expect(
      removeAgentSymlinks('my-skill', ['claude-code', 'codex']),
    ).resolves.toBe(true);

    expect(mockUnlink).toHaveBeenCalledTimes(2);
    expect(mockUnlink).toHaveBeenCalledWith(join(CLAUDE_SKILLS, 'my-skill'));
    expect(mockUnlink).toHaveBeenCalledWith(join(AGENTS_SKILLS, 'my-skill'));
  });

  it('uninstall -g call shape: full real key set, shared path confirmed once, no double prompt', async () => {
    mockExistingSymlinks();
    mockConfirm.mockResolvedValue(true);

    // Object.keys(AGENT_SKILL_DIRS) is exactly what uninstall.ts passes.
    await expect(
      removeAgentSymlinks('my-skill', Object.keys(AGENT_SKILL_DIRS)),
    ).resolves.toBe(true);

    // One prompt for the shared path (first hit via codex); gemini's and
    // agents' later hits of the same physical path are deduplicated in the
    // plan rather than re-prompted or unlinked.
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockUnlink).toHaveBeenCalledTimes(3);
    expect(mockUnlink).toHaveBeenCalledWith(join(CLAUDE_SKILLS, 'my-skill'));
    expect(mockUnlink).toHaveBeenCalledWith(join(AGENTS_SKILLS, 'my-skill'));
    expect(mockUnlink).toHaveBeenCalledWith(join(GEMINI_SKILLS, 'my-skill'));
  });

  it('uninstall -g call shape: shared path declined — nothing removed anywhere, not even exclusive paths', async () => {
    mockExistingSymlinks();
    mockConfirm.mockResolvedValue(false);

    // The decline aborts the whole call: claude-code's and gemini's own
    // exclusive paths needed no confirmation, but removing them while the
    // shared symlink stays would be a partial uninstall of one physical
    // skill. Zero unlinks, one prompt, false.
    await expect(
      removeAgentSymlinks('my-skill', Object.keys(AGENT_SKILL_DIRS)),
    ).resolves.toBe(false);

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockUnlink).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('Nothing was uninstalled'),
    );
  });

  it('tolerates a planned target that vanishes before the commit pass', async () => {
    mockExistingSymlinks();
    // The plan lstat (first call) sees the symlink; the commit-pass
    // re-lstat sees it gone — the prompt can sit on a human while another
    // process removes the target.
    mockLstat.mockImplementationOnce(() => Promise.resolve(SYMLINK_STAT));
    mockLstat.mockImplementation(() => Promise.reject(ENOENT()));

    await expect(removeAgentSymlinks('my-skill', ['claude-code'])).resolves.toBe(true);

    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('tolerates a planned target that stops being a symlink before the commit pass', async () => {
    mockExistingSymlinks();
    mockLstat.mockImplementationOnce(() => Promise.resolve(SYMLINK_STAT));
    mockLstat.mockImplementation(() =>
      Promise.resolve({ isSymbolicLink: () => false } as never),
    );

    await expect(removeAgentSymlinks('my-skill', ['claude-code'])).resolves.toBe(true);

    expect(mockUnlink).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Codex stale-symlink notice
// ---------------------------------------------------------------------------

describe('Codex stale-symlink notice', () => {
  const NOTICE = 'no longer read by Codex';
  const OPTS = { agents: ['codex'], skillName: 'my-skill', storePath: STORE_PATH };

  // Legacy dir lstat + readdir resolve per the given readdir result; the
  // target symlink lstat is ENOENT unless the test says otherwise. Entries
  // are Dirent-shaped (noticeStaleCodexDir reads withFileTypes).
  function mockLegacyDir(
    entries: Array<typeof SYMLINK_ENTRY | typeof REAL_ENTRY> | 'absent' | 'not-dir' | 'readdir-error',
  ): void {
    mockLstat.mockImplementation((p: string) => {
      if (String(p) === CODEX_LEGACY) {
        if (entries === 'absent') return Promise.reject(ENOENT());
        if (entries === 'not-dir') return Promise.resolve({ isDirectory: () => false } as never);
        return Promise.resolve({ isDirectory: () => true } as never);
      }
      return Promise.reject(ENOENT());
    });
    if (entries === 'readdir-error') {
      mockReaddir.mockRejectedValue(ENOENT());
    } else if (Array.isArray(entries)) {
      mockReaddir.mockResolvedValue(entries as never);
    }
  }

  it('prints the notice and touches nothing in ~/.codex/skills/ when it still has entries', async () => {
    mockLegacyDir([SYMLINK_ENTRY]);

    await createAgentSymlinks(OPTS);

    expect(mockReaddir).toHaveBeenCalledWith(CODEX_LEGACY, { withFileTypes: true });
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      expect.stringContaining(NOTICE),
    );
    // All entries verified as symlinks — the blanket claim is honest.
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      expect.stringContaining('It is safe to delete.'),
    );
    expect(mockUnlink).not.toHaveBeenCalled();
    // The new install still proceeds to the real target.
    expect(mockSymlink).toHaveBeenCalledWith(STORE_PATH, join(AGENTS_SKILLS, 'my-skill'));
  });

  it('qualifies the notice, not blanket safety, when the legacy directory holds non-symlink entries', async () => {
    mockLegacyDir([REAL_ENTRY]);

    await createAgentSymlinks(OPTS);

    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      expect.stringContaining(NOTICE),
    );
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      expect.stringContaining('Any GoodBoy-created links'),
    );
    expect(vi.mocked(logger.info)).not.toHaveBeenCalledWith(
      expect.stringContaining('It is safe to delete.'),
    );
  });

  it('prints no notice when the legacy directory is empty', async () => {
    mockLegacyDir([]);

    await createAgentSymlinks(OPTS);

    expect(vi.mocked(logger.info)).not.toHaveBeenCalledWith(
      expect.stringContaining(NOTICE),
    );
  });

  it('prints no notice when the legacy directory does not exist', async () => {
    mockLegacyDir('absent');

    await createAgentSymlinks(OPTS);

    expect(mockReaddir).not.toHaveBeenCalled();
    expect(vi.mocked(logger.info)).not.toHaveBeenCalledWith(
      expect.stringContaining(NOTICE),
    );
  });

  it('prints no notice when the legacy path is not a directory', async () => {
    mockLegacyDir('not-dir');

    await createAgentSymlinks(OPTS);

    expect(mockReaddir).not.toHaveBeenCalled();
    expect(vi.mocked(logger.info)).not.toHaveBeenCalledWith(
      expect.stringContaining(NOTICE),
    );
  });

  it('tolerates a readdir failure on the legacy directory', async () => {
    mockLegacyDir('readdir-error');

    await createAgentSymlinks(OPTS);

    expect(vi.mocked(logger.info)).not.toHaveBeenCalledWith(
      expect.stringContaining(NOTICE),
    );
    expect(mockSymlink).toHaveBeenCalledWith(STORE_PATH, join(AGENTS_SKILLS, 'my-skill'));
  });

  it('does not fire when only claude-code or gemini are processed', async () => {
    mockLstat.mockRejectedValue(ENOENT());

    await createAgentSymlinks({ ...OPTS, agents: ['claude-code', 'gemini'] });

    expect(mockReaddir).not.toHaveBeenCalled();
    expect(vi.mocked(logger.info)).not.toHaveBeenCalledWith(
      expect.stringContaining(NOTICE),
    );
  });

  it('fires on removal too, when codex is processed', async () => {
    mockLstat.mockImplementation((p: string) => {
      if (String(p) === CODEX_LEGACY) return Promise.resolve({ isDirectory: () => true } as never);
      return Promise.resolve(SYMLINK_STAT);
    });
    mockReaddir.mockResolvedValue([SYMLINK_ENTRY] as never);

    await expect(removeAgentSymlinks('my-skill', ['codex'])).resolves.toBe(true);

    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      expect.stringContaining(NOTICE),
    );
    expect(mockUnlink).toHaveBeenCalledWith(join(AGENTS_SKILLS, 'my-skill'));
  });

  it('fires exactly once during planning, even when the uninstall is later aborted by a decline', async () => {
    // Every target exists as a symlink; the legacy dir exists holding a
    // symlink entry; every confirmation is declined.
    mockLstat.mockImplementation((p: string) => {
      if (String(p) === CODEX_LEGACY) return Promise.resolve({ isDirectory: () => true } as never);
      return Promise.resolve(SYMLINK_STAT);
    });
    mockReaddir.mockResolvedValue([SYMLINK_ENTRY] as never);
    mockConfirm.mockResolvedValue(false);

    const result = await removeAgentSymlinks('my-skill', Object.keys(AGENT_SKILL_DIRS));

    // The notice is about a different, legacy directory than this
    // uninstall's targets — informational, so it fires during planning and
    // survives the abort. Exactly once for the single codex in the list.
    expect(result).toBe(false);
    expect(mockUnlink).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    const notices = vi
      .mocked(logger.info)
      .mock.calls.filter(([msg]) => String(msg).includes('no longer read by Codex'));
    expect(notices).toHaveLength(1);
  });
});
