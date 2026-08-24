import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ExitPromptError } from '@inquirer/core';

vi.mock('node:fs/promises');
vi.mock('@inquirer/prompts', () => ({ confirm: vi.fn() }));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { mkdir, lstat, symlink, unlink, readlink } from 'node:fs/promises';
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
const mockConfirm  = vi.mocked(confirm);

const HOME          = homedir();
const CLAUDE_SKILLS = join(HOME, '.claude', 'skills');
const AGENTS_SKILLS = join(HOME, '.agents', 'skills');
const GEMINI_SKILLS = join(HOME, '.gemini', 'skills');
const CODEX_SKILLS  = join(HOME, '.codex', 'skills');
const STORE_PATH    = join(HOME, '.goodboy', 'skills', 'my-skill');

const ENOENT = () => Object.assign(new Error(), { code: 'ENOENT' });
const SYMLINK_STAT = { isSymbolicLink: () => true } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdir.mockResolvedValue(undefined as never);
  mockSymlink.mockResolvedValue(undefined);
  mockUnlink.mockResolvedValue(undefined);
  mockConfirm.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// AGENT_SKILL_DIRS
// ---------------------------------------------------------------------------

describe('AGENT_SKILL_DIRS', () => {
  it('maps each agent to exactly its list of directories', () => {
    expect(AGENT_SKILL_DIRS['claude-code']).toEqual([CLAUDE_SKILLS]);
    expect(AGENT_SKILL_DIRS['codex']).toEqual([AGENTS_SKILLS, CODEX_SKILLS]);
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

  it('installing for codex alone creates exactly two symlinks, in list order, both logged with paths', async () => {
    mockLstat.mockRejectedValue(ENOENT());

    await createAgentSymlinks({ ...OPTS, agents: ['codex'] });

    // Shared convention first, then Codex's own skills home (map order).
    expect(mockSymlink).toHaveBeenCalledTimes(2);
    expect(mockSymlink).toHaveBeenNthCalledWith(1, STORE_PATH, join(AGENTS_SKILLS, 'my-skill'));
    expect(mockSymlink).toHaveBeenNthCalledWith(2, STORE_PATH, join(CODEX_SKILLS, 'my-skill'));
    expect(vi.mocked(logger.success)).toHaveBeenNthCalledWith(
      1,
      `Linked to codex: ${join(AGENTS_SKILLS, 'my-skill')}`,
    );
    expect(vi.mocked(logger.success)).toHaveBeenNthCalledWith(
      2,
      `Linked to codex: ${join(CODEX_SKILLS, 'my-skill')}`,
    );
  });

  it('second codex run: both targets already linked — two distinguishable lines, each with its own path', async () => {
    mockLstat.mockResolvedValue(SYMLINK_STAT);
    mockReadlink.mockResolvedValue(STORE_PATH);

    await createAgentSymlinks({ ...OPTS, agents: ['codex'] });

    expect(mockSymlink).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
    // The polish: each already-linked line carries its own path, so the two
    // codex lines are distinguishable instead of two identical "codex:
    // already linked correctly" lines.
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      `codex: already linked correctly: ${join(AGENTS_SKILLS, 'my-skill')}`,
    );
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      `codex: already linked correctly: ${join(CODEX_SKILLS, 'my-skill')}`,
    );
  });

  it('installing for gemini alone creates exactly two symlinks, to both paths', async () => {
    mockLstat.mockRejectedValue(ENOENT());

    await createAgentSymlinks({ ...OPTS, agents: ['gemini'] });

    expect(mockSymlink).toHaveBeenCalledTimes(2);
    expect(mockSymlink).toHaveBeenCalledWith(STORE_PATH, join(AGENTS_SKILLS, 'my-skill'));
    expect(mockSymlink).toHaveBeenCalledWith(STORE_PATH, join(GEMINI_SKILLS, 'my-skill'));
  });

  it('links to all agents: one call per path in each list (5 paths across 3 agents)', async () => {
    mockLstat.mockRejectedValue(ENOENT());

    await createAgentSymlinks({
      ...OPTS,
      agents: ['claude-code', 'codex', 'gemini'],
    });

    // claude-code: 1 path, codex: 2 paths, gemini: 2 paths = 5 calls. The
    // shared ~/.agents/skills/ path is written by both codex and gemini —
    // overlapping writes are safe because each path is idempotent (the
    // already-linked check below), not because they are deduplicated.
    expect(mockSymlink).toHaveBeenCalledTimes(5);
    expect(mockSymlink).toHaveBeenCalledWith(STORE_PATH, join(CLAUDE_SKILLS, 'my-skill'));
    expect(mockSymlink).toHaveBeenCalledWith(STORE_PATH, join(AGENTS_SKILLS, 'my-skill'));
    expect(mockSymlink).toHaveBeenCalledWith(STORE_PATH, join(CODEX_SKILLS, 'my-skill'));
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

  it('does not re-link already-correct targets — one distinguishable line per (agent, path)', async () => {
    mockLstat.mockResolvedValue(SYMLINK_STAT);
    mockReadlink.mockResolvedValue(STORE_PATH);

    await createAgentSymlinks({ ...OPTS, agents: ['codex', 'gemini'] });

    // All four targets (codex: 2 paths, gemini: 2) exist and point at the
    // store: the idempotency check is what makes the overlapping codex/gemini
    // lists safe, and every already-linked line carries its own path so the
    // two codex lines and the shared-path line are distinguishable.
    expect(mockSymlink).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
    expect(vi.mocked(logger.info)).toHaveBeenCalledTimes(4);
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      `codex: already linked correctly: ${join(AGENTS_SKILLS, 'my-skill')}`,
    );
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      `codex: already linked correctly: ${join(CODEX_SKILLS, 'my-skill')}`,
    );
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      `gemini: already linked correctly: ${join(AGENTS_SKILLS, 'my-skill')}`,
    );
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      `gemini: already linked correctly: ${join(GEMINI_SKILLS, 'my-skill')}`,
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
    expect(agentsSharingPath(CODEX_SKILLS)).toEqual(['codex']);
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
  it('describes the shared convention directory — never names a co-reader agent', () => {
    expect(formatOtherReaders()).toBe(
      `part of the shared ${AGENT_SKILL_DIRS['agents'][0]} convention`,
    );
  });

  it('returns the same message no matter which agents share the path', () => {
    // The naming branch and the parameters it depended on were removed
    // (2026-08-17): "multiple real co-readers" and "only the internal agents
    // key differs" now produce the same message by construction — the
    // message never varies with the owner list, because GoodBoy cannot know
    // which other tools actually read a directory.
    const message = formatOtherReaders();
    expect(message).not.toMatch(/claude-code|codex|gemini/);
    expect(message).toBe(`part of the shared ${AGENT_SKILL_DIRS['agents'][0]} convention`);
  });
});

// ---------------------------------------------------------------------------
// removeAgentSymlinks
// ---------------------------------------------------------------------------

describe('removeAgentSymlinks', () => {
  // Targets exist as symlinks unless the mock says otherwise. `unlinked`
  // mirrors the real filesystem so later lstat calls see the symlink gone.
  let unlinked: Set<string>;
  function mockExistingSymlinks(): void {
    unlinked = new Set();
    mockUnlink.mockImplementation(async (p: string) => {
      unlinked.add(String(p));
    });
    mockLstat.mockImplementation((p: string) => {
      if (unlinked.has(String(p))) return Promise.reject(ENOENT());
      return Promise.resolve(SYMLINK_STAT);
    });
  }

  it('removes an existing symlink from an exclusive path with no prompt', async () => {
    mockExistingSymlinks();

    await expect(removeAgentSymlinks('my-skill', ['claude-code'])).resolves.toBe(true);

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockUnlink).toHaveBeenCalledWith(join(CLAUDE_SKILLS, 'my-skill'));
    // Exclusive paths have exactly one possible owner — the agent-named line
    // is accurate there and stays (only shared paths go generic).
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      `Removed claude-code symlink: ${join(CLAUDE_SKILLS, 'my-skill')}`,
    );
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

  it('dual-link removal: one prompt for the shared path only; both codex links unlinked on confirm', async () => {
    mockExistingSymlinks();
    mockConfirm.mockResolvedValue(true);

    await expect(removeAgentSymlinks('my-skill', ['codex'])).resolves.toBe(true);

    // The shared ~/.agents/skills/ target prompts once, describing the shared
    // convention — never naming a co-reader agent, since GoodBoy cannot know
    // which other tools actually read the directory; the exclusive
    // ~/.codex/skills/ target needs no confirmation. Exact equality pins all
    // of that at once.
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: `${join(AGENTS_SKILLS, 'my-skill')} is part of the shared ${AGENT_SKILL_DIRS['agents'][0]} convention. Remove anyway?`,
      }),
    );
    expect(mockUnlink).toHaveBeenCalledWith(join(AGENTS_SKILLS, 'my-skill'));
    expect(mockUnlink).toHaveBeenCalledWith(join(CODEX_SKILLS, 'my-skill'));
  });

  it('declining the shared path aborts the whole call: zero unlinks, even the exclusive codex link', async () => {
    mockExistingSymlinks();
    mockConfirm.mockResolvedValue(false);

    await expect(removeAgentSymlinks('my-skill', ['codex'])).resolves.toBe(false);

    // F1 contract under the dual-link map: ~/.codex/skills/ needed no
    // confirmation, but removing it while the shared symlink stays would be
    // a partial uninstall of one physical skill. Zero unlinks, one prompt,
    // false.
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockUnlink).not.toHaveBeenCalled();
    // The decline-abort log reads the same PlannedRemoval.otherReaders as the
    // prompt — exact equality pins that the convention wording (never a
    // co-reader name) reaches the log line too.
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      `Removal declined: ${join(AGENTS_SKILLS, 'my-skill')} is part of the shared ${AGENT_SKILL_DIRS['agents'][0]} convention. Nothing was uninstalled.`,
    );
  });

  it('a force-closed shared-path confirmation refuses loudly: names the shared convention and the interactive remedy, zero unlinks', async () => {
    mockExistingSymlinks();
    mockConfirm.mockRejectedValue(
      new ExitPromptError('User force closed the prompt with SIGINT'),
    );

    // Same abort as a decline — the throw happens in the confirmation phase,
    // before any unlink — but as a loud refusal (uninstall turns it into a
    // non-zero exit) instead of a silent false (C9, decided 2026-08-24).
    await expect(removeAgentSymlinks('my-skill', ['codex'])).rejects.toThrow(
      `${join(AGENTS_SKILLS, 'my-skill')} is part of the shared ${AGENT_SKILL_DIRS['agents'][0]} convention. ` +
        `Cannot confirm removal without an interactive prompt — run 'goodboy uninstall -g my-skill' interactively to remove it.`,
    );

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockUnlink).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it('a non-force-close rejection from the shared-path confirmation propagates unchanged', async () => {
    mockExistingSymlinks();
    mockConfirm.mockRejectedValue(new Error('disk on fire'));

    await expect(removeAgentSymlinks('my-skill', ['codex'])).rejects.toThrow('disk on fire');

    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('handles multiple agents', async () => {
    mockExistingSymlinks();

    await expect(
      removeAgentSymlinks('my-skill', ['claude-code', 'codex']),
    ).resolves.toBe(true);

    expect(mockUnlink).toHaveBeenCalledTimes(3);
    expect(mockUnlink).toHaveBeenCalledWith(join(CLAUDE_SKILLS, 'my-skill'));
    expect(mockUnlink).toHaveBeenCalledWith(join(AGENTS_SKILLS, 'my-skill'));
    expect(mockUnlink).toHaveBeenCalledWith(join(CODEX_SKILLS, 'my-skill'));
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
    // plan rather than re-prompted or unlinked. The exclusive codex path is
    // planned without a prompt and unlinked in the commit pass.
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockUnlink).toHaveBeenCalledTimes(4);
    expect(mockUnlink).toHaveBeenCalledWith(join(CLAUDE_SKILLS, 'my-skill'));
    expect(mockUnlink).toHaveBeenCalledWith(join(AGENTS_SKILLS, 'my-skill'));
    expect(mockUnlink).toHaveBeenCalledWith(join(CODEX_SKILLS, 'my-skill'));
    expect(mockUnlink).toHaveBeenCalledWith(join(GEMINI_SKILLS, 'my-skill'));
    // Removal log lines: the shared path is never attributed to an agent —
    // codex is always first in plan order for ~/.agents/skills/, so the old
    // "Removed codex symlink" line was wrong even for skills installed with
    // --agents alone. Exclusive paths keep naming their unambiguous agent.
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      `Removed shared symlink: ${join(AGENTS_SKILLS, 'my-skill')}`,
    );
    expect(vi.mocked(logger.info)).not.toHaveBeenCalledWith(
      `Removed codex symlink: ${join(AGENTS_SKILLS, 'my-skill')}`,
    );
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      `Removed claude-code symlink: ${join(CLAUDE_SKILLS, 'my-skill')}`,
    );
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      `Removed codex symlink: ${join(CODEX_SKILLS, 'my-skill')}`,
    );
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      `Removed gemini symlink: ${join(GEMINI_SKILLS, 'my-skill')}`,
    );
  });

  it('regression: skill installed only for --agents — the shared removal line names no agent', async () => {
    // Bruno's repro: `goodboy uninstall -g` on a skill whose only symlink is
    // the shared ~/.agents/skills/ path (as if installed with --agents
    // alone); nothing exists under codex's, gemini's, or claude-code's own
    // directories.
    mockUnlink.mockResolvedValue(undefined);
    mockLstat.mockImplementation((p: string) =>
      String(p) === join(AGENTS_SKILLS, 'my-skill')
        ? Promise.resolve(SYMLINK_STAT)
        : Promise.reject(ENOENT()),
    );

    await expect(
      removeAgentSymlinks('my-skill', Object.keys(AGENT_SKILL_DIRS)),
    ).resolves.toBe(true);

    // Exactly one removal, and its single log line is the generic shared
    // one — no agent name appears anywhere in it.
    expect(mockUnlink).toHaveBeenCalledTimes(1);
    expect(mockUnlink).toHaveBeenCalledWith(join(AGENTS_SKILLS, 'my-skill'));
    expect(vi.mocked(logger.info)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      `Removed shared symlink: ${join(AGENTS_SKILLS, 'my-skill')}`,
    );
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
