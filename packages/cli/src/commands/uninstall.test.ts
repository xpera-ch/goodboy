import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import ora from 'ora';

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    text: '',
  })),
}));
vi.mock('node:fs', () => ({
  rmSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
}));
vi.mock('../lib/goodboy-file.js', () => ({
  removeSkillFromManifest: vi.fn().mockResolvedValue(undefined),
  removeSkillFromLock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/agents.js')>();
  return {
    ...actual,
    // Only the side-effecting function is mocked. AGENT_SKILL_DIRS comes
    // through from the real module, so Object.keys(...) in uninstall.ts can
    // never drift from the real key set again (a hand-copied map here is a
    // second source of truth that already went stale once).
    removeAgentSymlinks: vi.fn().mockResolvedValue(true),
  };
});
vi.mock('../lib/store.js', () => ({
  removeFromStore: vi.fn(),
  getStorePath: vi.fn().mockReturnValue('/mock/.goodboy/skills'),
  getGoodboyHome: vi.fn().mockReturnValue('/mock/.goodboy'),
  installToStore: vi.fn(),
  ensureStoreExists: vi.fn(),
}));
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  sanitiseError: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

import { rmSync, existsSync } from 'node:fs';
import { removeSkillFromManifest, removeSkillFromLock } from '../lib/goodboy-file.js';
import { removeAgentSymlinks } from '../lib/agents.js';
import { removeFromStore } from '../lib/store.js';
import { logger } from '../lib/logger.js';
import { resetCommandOptions } from '../__fixtures__/index.js';
import { uninstallCommand } from './uninstall.js';

const mockRmSync = vi.mocked(rmSync);
const mockExistsSync = vi.mocked(existsSync);
const mockRemoveSkillFromManifest = vi.mocked(removeSkillFromManifest);
const mockRemoveSkillFromLock = vi.mocked(removeSkillFromLock);
const mockRemoveAgentSymlinks = vi.mocked(removeAgentSymlinks);
const mockRemoveFromStore = vi.mocked(removeFromStore);
const mockLogger = vi.mocked(logger);

const CWD = process.cwd();
const PROJECT_SKILL_PATH = join(CWD, '.claude', 'skills', 'my-skill');

describe('uninstall command — project', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCommandOptions(uninstallCommand);
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    mockExistsSync.mockReturnValue(true);
  });

  it('removes the skill directory from .claude/skills/', async () => {
    await uninstallCommand.parseAsync(['my-skill'], { from: 'user' });
    expect(mockRmSync).toHaveBeenCalledWith(PROJECT_SKILL_PATH, {
      recursive: true,
      force: true,
    });
  });

  it('removes skill from goodboy.json and goodboy.lock', async () => {
    await uninstallCommand.parseAsync(['my-skill'], { from: 'user' });
    expect(mockRemoveSkillFromManifest).toHaveBeenCalledWith(CWD, 'my-skill');
    expect(mockRemoveSkillFromLock).toHaveBeenCalledWith(CWD, 'my-skill');
  });

  it('warns when skill is not installed in project', async () => {
    mockExistsSync.mockReturnValue(false);
    await uninstallCommand.parseAsync(['my-skill'], { from: 'user' });
    expect(mockRmSync).not.toHaveBeenCalled();
    expect(mockRemoveSkillFromManifest).not.toHaveBeenCalled();
  });

  it('rejects invalid skill names', async () => {
    await uninstallCommand.parseAsync(['Bad_Name!'], { from: 'user' }).catch(() => {});
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid skill name'),
    );
  });

  it('does not call removeFromStore on project uninstall', async () => {
    await uninstallCommand.parseAsync(['my-skill'], { from: 'user' });
    expect(mockRemoveFromStore).not.toHaveBeenCalled();
  });
});

describe('uninstall command — global (-g)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCommandOptions(uninstallCommand);
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    // clearAllMocks does not reset mockResolvedValue implementations — a
    // test that declines the shared-path prompt must not leak its false
    // into the tests that follow.
    mockRemoveAgentSymlinks.mockResolvedValue(true);
  });

  it('removes agent symlinks for all agents', async () => {
    await uninstallCommand.parseAsync(['my-skill', '--global'], { from: 'user' });
    // The real four-key map — not the pre-list-map two-key shape.
    expect(mockRemoveAgentSymlinks).toHaveBeenCalledWith('my-skill', [
      'claude-code',
      'codex',
      'gemini',
      'agents',
    ]);
  });

  it('removes from the global store', async () => {
    await uninstallCommand.parseAsync(['my-skill', '--global'], { from: 'user' });
    expect(mockRemoveFromStore).toHaveBeenCalledWith('my-skill');
  });

  it('aborts with no removal anywhere when the shared-path confirmation is declined', async () => {
    mockRemoveAgentSymlinks.mockResolvedValue(false);

    await uninstallCommand.parseAsync(['my-skill', '--global'], { from: 'user' });

    // All three explicitly: a test checking only one could pass while the
    // other two still ran. Also implicitly no process.exit(1) — the exit
    // spy throws, so parseAsync resolving is itself the proof of "nothing
    // failed, nothing happened".
    expect(mockRemoveFromStore).not.toHaveBeenCalled();
    expect(mockRemoveSkillFromManifest).not.toHaveBeenCalled();
    expect(mockRemoveSkillFromLock).not.toHaveBeenCalled();

    const spinnerInstance = vi.mocked(ora).mock.results[0]?.value as {
      warn: ReturnType<typeof vi.fn>;
    };
    expect(spinnerInstance.warn).toHaveBeenCalledWith(
      'Uninstall cancelled — nothing was removed for "my-skill"',
    );
  });

  it('stops the spinner before the shared-path prompt and warns on decline', async () => {
    mockRemoveAgentSymlinks.mockResolvedValue(false);

    await uninstallCommand.parseAsync(['my-skill', '--global'], { from: 'user' });

    type SpinnerMock = { stop: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
    const spinnerInstance = vi.mocked(ora).mock.results[0]?.value as SpinnerMock;
    const stopOrder = spinnerInstance.stop.mock.invocationCallOrder[0]!;
    const callOrder = mockRemoveAgentSymlinks.mock.invocationCallOrder[0]!;
    const warnOrder = spinnerInstance.warn.mock.invocationCallOrder[0]!;
    expect(stopOrder).toBeLessThan(callOrder);
    expect(callOrder).toBeLessThan(warnOrder);
  });

  it('stops the spinner before the prompt and restarts it after approval, before success', async () => {
    await uninstallCommand.parseAsync(['my-skill', '--global'], { from: 'user' });

    type SpinnerMock = {
      stop: ReturnType<typeof vi.fn>;
      start: ReturnType<typeof vi.fn>;
      succeed: ReturnType<typeof vi.fn>;
    };
    const spinnerInstance = vi.mocked(ora).mock.results[0]?.value as SpinnerMock;
    const stopOrder    = spinnerInstance.stop.mock.invocationCallOrder[0]!;
    const callOrder    = mockRemoveAgentSymlinks.mock.invocationCallOrder[0]!;
    const restartOrder = spinnerInstance.start.mock.invocationCallOrder[1]!;
    const succeedOrder = spinnerInstance.succeed.mock.invocationCallOrder[0]!;
    expect(stopOrder).toBeLessThan(callOrder);
    expect(callOrder).toBeLessThan(restartOrder);
    expect(restartOrder).toBeLessThan(succeedOrder);
    // start call #1 is the initial ora(...).start(); #2 is the restart with
    // the remaining work after the confirmation is through.
    expect(spinnerInstance.start).toHaveBeenNthCalledWith(
      2,
      'Removing "my-skill" from the store and updating goodboy.json/goodboy.lock…',
    );
  });

  it('removes skill from the global goodboy.json/lock (in ~/.goodboy)', async () => {
    await uninstallCommand.parseAsync(['my-skill', '--global'], { from: 'user' });
    expect(mockRemoveSkillFromManifest).toHaveBeenCalledWith('/mock/.goodboy', 'my-skill');
    expect(mockRemoveSkillFromLock).toHaveBeenCalledWith('/mock/.goodboy', 'my-skill');
  });

  it('does not rmSync project files on global uninstall', async () => {
    await uninstallCommand.parseAsync(['my-skill', '--global'], { from: 'user' });
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  it('supports the "rm" alias', async () => {
    await uninstallCommand.parseAsync(['my-skill', '--global'], { from: 'user' });
    expect(uninstallCommand.aliases()).toContain('rm');
  });
});
