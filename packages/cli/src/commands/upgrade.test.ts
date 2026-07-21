import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import type { GoodBoyManifest } from '../types/index.js';

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
  cpSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
}));
vi.mock('../lib/registry-adapter.js');
vi.mock('../lib/manifest.js');
vi.mock('../lib/fs-security.js');
vi.mock('../lib/goodboy-file.js', () => ({
  readGoodBoyJson: vi.fn().mockResolvedValue(null),
  getLockedVersion: vi.fn().mockResolvedValue(null),
  addSkillToManifest: vi.fn().mockResolvedValue(undefined),
  addSkillToLock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/store.js', () => ({
  getStorePath: vi.fn().mockReturnValue('/mock/.goodboy/skills'),
  getGoodboyHome: vi.fn().mockReturnValue('/mock/.goodboy'),
}));
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  sanitiseError: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

import { cpSync, existsSync } from 'node:fs';
import { createRegistryAdapter } from '../lib/registry-adapter.js';
import { readManifest, validateManifestDetailed } from '../lib/manifest.js';
import { scanForSymlinks } from '../lib/fs-security.js';
import { logger } from '../lib/logger.js';
import {
  readGoodBoyJson,
  getLockedVersion,
  addSkillToManifest,
  addSkillToLock,
} from '../lib/goodboy-file.js';
import { upgradeSkill, upgradeAll, upgradeCommand } from './upgrade.js';
import type { UpgradeOptions } from './upgrade.js';

const mockCreateRegistryAdapter = vi.mocked(createRegistryAdapter);
const mockReadManifest = vi.mocked(readManifest);
const mockValidateManifestDetailed = vi.mocked(validateManifestDetailed);
const mockScanForSymlinks = vi.mocked(scanForSymlinks);
const mockLogger = vi.mocked(logger);
const mockCpSync = vi.mocked(cpSync);
const mockExistsSync = vi.mocked(existsSync);
const mockReadGoodBoyJson = vi.mocked(readGoodBoyJson);
const mockGetLockedVersion = vi.mocked(getLockedVersion);
const mockAddSkillToManifest = vi.mocked(addSkillToManifest);
const mockAddSkillToLock = vi.mocked(addSkillToLock);

const SKILL_PATH = '/fake/registry/test-skill';
const CWD = '/test/project';
const PROJECT_SKILLS = join(CWD, '.claude', 'skills');

const MANIFEST: GoodBoyManifest = {
  name: 'test-skill',
  version: '0.2.0',
  description: 'A test skill',
  author: { name: 'Test' },
  license: 'MIT',
  schema_version: '1.0.0',
  status: 'experimental',
};

function mockAdapter() {
  return {
    resolveSkill: vi.fn().mockResolvedValue(SKILL_PATH),
    getSkillsLocation: vi.fn().mockReturnValue('/mock/.goodboy/skills'),
    listInstalled: vi.fn(),
    search: vi.fn(),
    getRegistryLocation: vi.fn(),
    listRegistry: vi.fn(),
  } as unknown as ReturnType<typeof createRegistryAdapter>;
}

const DEFAULT_OPTS: UpgradeOptions = {};

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(true);
  mockCreateRegistryAdapter.mockReturnValue(mockAdapter());
  mockReadManifest.mockResolvedValue({});
  mockValidateManifestDetailed.mockReturnValue({ manifest: MANIFEST, warnings: [] });
  mockScanForSymlinks.mockResolvedValue(undefined);
  mockGetLockedVersion.mockResolvedValue(null);
  mockAddSkillToManifest.mockResolvedValue(undefined);
  mockAddSkillToLock.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// upgradeSkill — project scope (default)
// ---------------------------------------------------------------------------

describe('upgradeSkill — project scope', () => {
  it('copies the skill to .claude/skills/<name>/, overwriting the existing copy', async () => {
    await upgradeSkill('test-skill', DEFAULT_OPTS, CWD);
    expect(mockCpSync).toHaveBeenCalledWith(SKILL_PATH, join(PROJECT_SKILLS, 'test-skill'), {
      recursive: true,
      force: true,
    });
  });

  it('updates goodboy.json and goodboy.lock with the new version', async () => {
    await upgradeSkill('test-skill', DEFAULT_OPTS, CWD);
    expect(mockAddSkillToManifest).toHaveBeenCalledWith(CWD, 'test-skill', '0.2.0');
    expect(mockAddSkillToLock).toHaveBeenCalledWith(
      CWD,
      'test-skill',
      '0.2.0',
      join(PROJECT_SKILLS, 'test-skill'),
    );
  });

  it('skips the upgrade when already at the latest locked version', async () => {
    mockGetLockedVersion.mockResolvedValue('0.2.0');
    await upgradeSkill('test-skill', DEFAULT_OPTS, CWD);
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockAddSkillToManifest).not.toHaveBeenCalled();
  });

  it('logs a warning when the manifest uses a tolerated newer-minor schema version', async () => {
    mockValidateManifestDetailed.mockReturnValue({
      manifest: MANIFEST,
      warnings: [
        'manifest uses schema 1.5.0; this GoodBoy CLI knows 1.0.0. Unknown fields were ignored — upgrade GoodBoy to use them.',
      ],
    });
    await upgradeSkill('test-skill', DEFAULT_OPTS, CWD);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('schema 1.5.0'));
  });

  it('does not warn when the manifest has no tolerance warnings', async () => {
    await upgradeSkill('test-skill', DEFAULT_OPTS, CWD);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('rejects invalid skill names', async () => {
    await expect(upgradeSkill('Bad_Name!', DEFAULT_OPTS, CWD)).rejects.toThrow(
      'Invalid skill name',
    );
    expect(mockCreateRegistryAdapter).not.toHaveBeenCalled();
  });

  it('throws when the skill is not currently installed', async () => {
    mockExistsSync.mockReturnValue(false);
    await expect(upgradeSkill('test-skill', DEFAULT_OPTS, CWD)).rejects.toThrow('is not installed');
    expect(mockCpSync).not.toHaveBeenCalled();
  });

  it('does not expose filesystem paths when symlink scan rejects', async () => {
    mockScanForSymlinks.mockRejectedValue(
      new Error(
        'Security: skill contains a symlink pointing outside its directory: ' +
          '/real/path/skill/bad-link → /etc/passwd.',
      ),
    );
    await expect(upgradeSkill('test-skill', DEFAULT_OPTS, CWD)).rejects.toThrow(
      'Skill rejected: symlink pointing outside skill directory detected',
    );
  });
});

// ---------------------------------------------------------------------------
// upgradeSkill — global scope (-g)
// ---------------------------------------------------------------------------

describe('upgradeSkill — global scope', () => {
  const GLOBAL_OPTS: UpgradeOptions = { global: true };

  it('copies into the global store path', async () => {
    await upgradeSkill('test-skill', GLOBAL_OPTS, CWD);
    expect(mockCpSync).toHaveBeenCalledWith(SKILL_PATH, '/mock/.goodboy/skills/test-skill', {
      recursive: true,
      force: true,
    });
  });

  it('updates the global goodboy.json/lock (in ~/.goodboy)', async () => {
    await upgradeSkill('test-skill', GLOBAL_OPTS, CWD);
    expect(mockAddSkillToManifest).toHaveBeenCalledWith('/mock/.goodboy', 'test-skill', '0.2.0');
    expect(mockAddSkillToLock).toHaveBeenCalledWith(
      '/mock/.goodboy',
      'test-skill',
      '0.2.0',
      '/mock/.goodboy/skills/test-skill',
    );
  });
});

// ---------------------------------------------------------------------------
// upgradeAll — upgrade everything listed in goodboy.json
// ---------------------------------------------------------------------------

describe('upgradeAll', () => {
  it('throws when no goodboy.json is found', async () => {
    mockReadGoodBoyJson.mockResolvedValue(null);
    await expect(upgradeAll(DEFAULT_OPTS, CWD)).rejects.toThrow('No goodboy.json found');
  });

  it('reports when no skills are listed', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: {} });
    await upgradeAll(DEFAULT_OPTS, CWD);
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('No skills listed'));
  });

  it('upgrades every skill listed in goodboy.json', async () => {
    mockReadGoodBoyJson.mockResolvedValue({
      schema: '1.0.0',
      skills: { 'test-skill': '^0.1.0' },
    });
    await upgradeAll(DEFAULT_OPTS, CWD);
    expect(mockCpSync).toHaveBeenCalledWith(SKILL_PATH, join(PROJECT_SKILLS, 'test-skill'), {
      recursive: true,
      force: true,
    });
  });
});

// ---------------------------------------------------------------------------
// upgradeCommand — Commander integration smoke tests
// ---------------------------------------------------------------------------

describe('upgradeCommand — Commander registration', () => {
  it('has a --global flag', () => {
    const globalOpt = upgradeCommand.options.find((o) => o.long === '--global');
    expect(globalOpt).toBeDefined();
  });

  it('dispatches to upgradeSkill when a skill name is given, reporting failures via logger.error', async () => {
    mockExistsSync.mockReturnValue(false); // forces upgradeSkill to reject
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    await upgradeCommand.parseAsync(['test-skill'], { from: 'user' }).catch(() => {});
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('is not installed'));
    exitSpy.mockRestore();
  });
});
