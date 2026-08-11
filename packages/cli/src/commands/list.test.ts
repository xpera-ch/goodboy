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
import { resetCommandOptions } from '../__fixtures__/index.js';
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
    schema_version: '2.0.0',
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
    resetCommandOptions(listCommand);
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

  describe('unreadable skills (F1 regression)', () => {
    // The bug: every skill on disk had a schema-1.x manifest, each threw, each
    // was silently dropped, and `list` printed "No skills installed" — telling
    // a user with six installed skills that they had none.
    function rejectAll(message: string): void {
      mockReadManifest.mockRejectedValue(new Error(message));
    }

    it('warns per unreadable skill, naming it and the reason', async () => {
      rejectAll('manifest declares schema 1.0.0; this version of GoodBoy supports 2.x manifests.');
      await listCommand.parseAsync(['-g'], { from: 'user' });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Skipping "global-skill" (global)'),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('supports 2.x manifests'),
      );
    });

    it('does NOT claim "No skills installed" when skills are present but unreadable', async () => {
      rejectAll('manifest declares schema 1.0.0; this version of GoodBoy supports 2.x manifests.');
      await listCommand.parseAsync(['-g'], { from: 'user' });
      const said = mockLogger.info.mock.calls
        .concat(mockLogger.warn.mock.calls)
        .map((c) => String(c[0]));
      expect(said.some((m) => m.includes('No skills installed'))).toBe(false);
      expect(said.some((m) => m.includes('installed but could not be read'))).toBe(true);
    });

    it('names a remedy, not just the fault', async () => {
      rejectAll('manifest declares schema 1.0.0; this version of GoodBoy supports 2.x manifests.');
      await listCommand.parseAsync(['-g'], { from: 'user' });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('goodboy add'),
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('"schema_version": "2.0.0"'),
      );
    });

    it('still reports the empty case correctly when the directory is genuinely empty', async () => {
      // §5.2 — the fix must distinguish "nothing there" from "nothing
      // readable", not replace one wrong answer with another.
      mockReaddir.mockResolvedValue([] as never);
      await listCommand.parseAsync(['-g'], { from: 'user' });
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('No skills installed'),
      );
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('lists readable skills and warns about unreadable ones in a mixed store', async () => {
      mockReaddir.mockImplementation(async (dir) => {
        if (dir === GLOBAL_SKILLS_PATH) {
          return [fakeDirent('good-skill'), fakeDirent('legacy-skill')] as never;
        }
        return [] as never;
      });
      mockReadManifest.mockImplementation(async (path) => {
        if (String(path).includes('good-skill')) return manifestFor('good-skill');
        throw new Error('manifest declares schema 1.0.0; this version of GoodBoy supports 2.x manifests.');
      });

      await listCommand.parseAsync(['-g'], { from: 'user' });

      expect(output()).toContain('good-skill');
      expect(output()).not.toContain('legacy-skill');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Skipping "legacy-skill"'),
      );
      // The count line must not silently under-report what is on disk.
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('1 skill installed'));
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('1 further skill installed but could not be read'),
      );
    });

    it('falls back to a generic reason when a non-Error is thrown', async () => {
      mockReadManifest.mockRejectedValue('not an Error instance');
      await listCommand.parseAsync(['-g'], { from: 'user' });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('invalid manifest'),
      );
    });

    it('pluralises correctly for multiple unreadable skills', async () => {
      mockReaddir.mockImplementation(async (dir) => {
        if (dir === GLOBAL_SKILLS_PATH) {
          return [fakeDirent('legacy-a'), fakeDirent('legacy-b')] as never;
        }
        return [] as never;
      });
      rejectAll('manifest declares schema 1.0.0; this version of GoodBoy supports 2.x manifests.');
      await listCommand.parseAsync(['-g'], { from: 'user' });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('2 skills are installed but could not be read'),
      );
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
