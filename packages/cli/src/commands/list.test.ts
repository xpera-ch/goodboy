import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import type { GoodBoyManifest } from '../types/index.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));
vi.mock('node:fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue([]),
}));
vi.mock('../lib/registry-adapter.js', () => ({
  createRegistryAdapter: vi.fn(),
}));
vi.mock('../lib/manifest.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/manifest.js')>();
  return {
    ...actual,
    readManifest: vi.fn(),
  };
});
vi.mock('../lib/goodboy-file.js', () => ({
  readGoodBoyJson: vi.fn(),
}));
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  sanitiseError: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createRegistryAdapter } from '../lib/registry-adapter.js';
import { readManifest } from '../lib/manifest.js';
import { readGoodBoyJson } from '../lib/goodboy-file.js';
import { logger } from '../lib/logger.js';
import { listCommand } from './list.js';

const mockExistsSync = vi.mocked(existsSync);
const mockReaddir = vi.mocked(readdir);
const mockCreateRegistryAdapter = vi.mocked(createRegistryAdapter);
const mockReadManifest = vi.mocked(readManifest);
const mockReadGoodBoyJson = vi.mocked(readGoodBoyJson);
const mockLogger = vi.mocked(logger);

const CWD = process.cwd();
const PROJECT_SKILLS_PATH = join(CWD, '.claude', 'skills');
const GLOBAL_SKILLS_PATH = '/mock/.goodboy/skills';

function manifestFor(name: string): GoodBoyManifest {
  return {
    name,
    version: '1.0.0',
    description: 'A test skill',
    author: { name: 'Test' },
    license: 'MIT',
    schema_version: '1.0.0',
    status: 'stable',
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeDirent(name: string): any {
  return { name, isDirectory: () => true };
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

describe('goodboy list', () => {
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

    mockExistsSync.mockReturnValue(true);
    mockCreateRegistryAdapter.mockReturnValue({
      resolveSkill: vi.fn(),
      listInstalled: vi.fn(),
      search: vi.fn(),
      getRegistryLocation: vi.fn(),
      getSkillsLocation: vi.fn().mockReturnValue(GLOBAL_SKILLS_PATH),
      listRegistry: vi.fn(),
    });
    mockReaddir.mockImplementation(async (dir) => {
      if (dir === PROJECT_SKILLS_PATH) return [fakeDirent('project-skill')] as never;
      if (dir === GLOBAL_SKILLS_PATH) return [fakeDirent('global-skill')] as never;
      return [] as never;
    });
    mockReadManifest.mockImplementation(async (path) => {
      if (String(path).includes('project-skill')) return manifestFor('project-skill');
      if (String(path).includes('global-skill')) return manifestFor('global-skill');
      throw new Error('unexpected manifest path');
    });
  });

  function output(): string {
    return stripAnsi(stdoutChunks.join(''));
  }

  describe('goodboy list (no flags)', () => {
    it('shows warning when no goodboy.json in cwd', async () => {
      mockReadGoodBoyJson.mockResolvedValue(null);
      await listCommand.parseAsync([], { from: 'user' });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No goodboy.json found in current directory'),
      );
    });

    it("shows 'goodboy init' hint when no goodboy.json", async () => {
      mockReadGoodBoyJson.mockResolvedValue(null);
      await listCommand.parseAsync([], { from: 'user' });
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("goodboy init"));
    });

    it("shows 'goodboy list -g' hint when no goodboy.json", async () => {
      mockReadGoodBoyJson.mockResolvedValue(null);
      await listCommand.parseAsync([], { from: 'user' });
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('goodboy list -g'));
    });

    it('does NOT show any skills when no goodboy.json', async () => {
      mockReadGoodBoyJson.mockResolvedValue(null);
      await listCommand.parseAsync([], { from: 'user' });
      expect(mockReaddir).not.toHaveBeenCalled();
      expect(output()).toBe('');
    });

    it('exits cleanly (no error) when no goodboy.json', async () => {
      mockReadGoodBoyJson.mockResolvedValue(null);
      await listCommand.parseAsync([], { from: 'user' });
      expect(mockLogger.error).not.toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('shows project skills when goodboy.json exists', async () => {
      mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: {} });
      await listCommand.parseAsync([], { from: 'user' });
      expect(output()).toContain('project-skill');
      expect(output()).toContain('project');
    });

    it('does not read the global skills path', async () => {
      mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: {} });
      await listCommand.parseAsync([], { from: 'user' });
      expect(mockReaddir).not.toHaveBeenCalledWith(GLOBAL_SKILLS_PATH, expect.anything());
      expect(output()).not.toContain('global-skill');
    });

    it('shows empty state when goodboy.json exists but no skills installed', async () => {
      mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: {} });
      mockReaddir.mockResolvedValue([] as never);
      await listCommand.parseAsync([], { from: 'user' });
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('No skills installed'));
    });
  });

  describe('goodboy list -g', () => {
    it('does not check for goodboy.json', async () => {
      await listCommand.parseAsync(['-g'], { from: 'user' });
      expect(mockReadGoodBoyJson).not.toHaveBeenCalled();
    });

    it('reads only the global skills path', async () => {
      await listCommand.parseAsync(['-g'], { from: 'user' });
      expect(output()).toContain('global-skill');
      expect(output()).not.toContain('project-skill');
    });

    it('labels results with scope "global"', async () => {
      await listCommand.parseAsync(['-g'], { from: 'user' });
      expect(output()).toContain('global');
    });

    it('shows empty state when global store is empty', async () => {
      mockReaddir.mockResolvedValue([] as never);
      await listCommand.parseAsync(['-g'], { from: 'user' });
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('No skills installed'));
    });
  });

  describe('goodboy list --all', () => {
    it('shows a project-skills notice and still shows global skills when no goodboy.json', async () => {
      mockReadGoodBoyJson.mockResolvedValue(null);
      await listCommand.parseAsync(['--all'], { from: 'user' });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Project skills: no goodboy.json in this directory'),
      );
      expect(output()).toContain('global-skill');
      expect(output()).not.toContain('project-skill');
    });

    it('shows both project and global skills with correct scope when goodboy.json exists', async () => {
      mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: {} });
      await listCommand.parseAsync(['--all'], { from: 'user' });
      expect(output()).toContain('project-skill');
      expect(output()).toContain('global-skill');
    });
  });
});
