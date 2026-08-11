import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';

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
vi.mock('../lib/agents.js', () => ({
  removeAgentSymlinks: vi.fn().mockResolvedValue(undefined),
  AGENT_SKILL_DIRS: { 'claude-code': '/mock/.claude/skills', codex: '/mock/.codex/skills' },
}));
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
  });

  it('removes agent symlinks for all agents', async () => {
    await uninstallCommand.parseAsync(['my-skill', '--global'], { from: 'user' });
    expect(mockRemoveAgentSymlinks).toHaveBeenCalledWith('my-skill', ['claude-code', 'codex']);
  });

  it('removes from the global store', async () => {
    await uninstallCommand.parseAsync(['my-skill', '--global'], { from: 'user' });
    expect(mockRemoveFromStore).toHaveBeenCalledWith('my-skill');
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
