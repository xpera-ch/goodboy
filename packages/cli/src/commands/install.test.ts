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
  mkdirSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  statSync: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(''),
  appendFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/registry-adapter.js');
vi.mock('../lib/manifest.js');
vi.mock('../lib/consent.js');
vi.mock('../lib/fs-security.js');
vi.mock('../lib/goodboy-file.js', () => ({
  readGoodBoyJson: vi.fn().mockResolvedValue(null),
  addSkillToManifest: vi.fn().mockResolvedValue(undefined),
  addSkillToLock: vi.fn().mockResolvedValue(undefined),
  removeSkillFromManifest: vi.fn().mockResolvedValue(undefined),
  removeSkillFromLock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/agents.js', () => ({
  resolveAgentFlags: vi.fn().mockReturnValue(['claude-code']),
  createAgentSymlinks: vi.fn().mockResolvedValue(undefined),
  AGENT_SKILL_DIRS: { 'claude-code': '/mock/.claude/skills' },
}));
vi.mock('../lib/store.js', () => ({
  installToStore: vi.fn().mockResolvedValue('/mock/.goodboy/skills/test-skill'),
  getStorePath: vi.fn().mockReturnValue('/mock/.goodboy/skills'),
  ensureStoreExists: vi.fn(),
  removeFromStore: vi.fn(),
}));
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  sanitiseError: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

import ora from 'ora';
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { createRegistryAdapter } from '../lib/registry-adapter.js';
import { readManifest, validateManifest } from '../lib/manifest.js';
import { requestConsent } from '../lib/consent.js';
import { scanForSymlinks } from '../lib/fs-security.js';
import { logger } from '../lib/logger.js';
import {
  readGoodBoyJson,
  addSkillToManifest,
  addSkillToLock,
} from '../lib/goodboy-file.js';
import { installToStore } from '../lib/store.js';
import { resolveAgentFlags, createAgentSymlinks } from '../lib/agents.js';
import { installNamed, installFromManifest, installCommand } from './install.js';
import type { InstallOptions } from './install.js';

const mockCreateRegistryAdapter = vi.mocked(createRegistryAdapter);
const mockReadManifest = vi.mocked(readManifest);
const mockValidateManifest = vi.mocked(validateManifest);
const mockRequestConsent = vi.mocked(requestConsent);
const mockScanForSymlinks = vi.mocked(scanForSymlinks);
const mockLogger = vi.mocked(logger);
const mockCpSync = vi.mocked(cpSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockExistsSync = vi.mocked(existsSync);
const mockReadGoodBoyJson = vi.mocked(readGoodBoyJson);
const mockAddSkillToManifest = vi.mocked(addSkillToManifest);
const mockAddSkillToLock = vi.mocked(addSkillToLock);
const mockInstallToStore = vi.mocked(installToStore);
const mockCreateAgentSymlinks = vi.mocked(createAgentSymlinks);
const mockResolveAgentFlags = vi.mocked(resolveAgentFlags);

const SKILL_PATH = '/fake/registry/test-skill';
const CWD = '/test/project';
const PROJECT_SKILLS = join(CWD, '.claude', 'skills');

const MANIFEST: GoodBoyManifest = {
  name: 'test-skill',
  version: '0.1.0',
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

const DEFAULT_OPTS: InstallOptions = {};

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(false);
  mockCreateRegistryAdapter.mockReturnValue(mockAdapter());
  mockReadManifest.mockResolvedValue({});
  mockValidateManifest.mockReturnValue(MANIFEST);
  mockScanForSymlinks.mockResolvedValue(undefined);
  mockRequestConsent.mockResolvedValue(true);
  mockResolveAgentFlags.mockReturnValue(['claude-code']);
  mockInstallToStore.mockResolvedValue('/mock/.goodboy/skills/test-skill');
  mockAddSkillToManifest.mockResolvedValue(undefined);
  mockAddSkillToLock.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// installNamed — project install (default)
// ---------------------------------------------------------------------------

describe('installNamed — project install', () => {
  it('passes the validated manifest to requestConsent', async () => {
    await installNamed('test-skill', DEFAULT_OPTS, CWD);
    expect(mockRequestConsent).toHaveBeenCalledWith(MANIFEST);
  });

  it('copies skill to .claude/skills/<name>/', async () => {
    await installNamed('test-skill', DEFAULT_OPTS, CWD);
    expect(mockCpSync).toHaveBeenCalledWith(
      SKILL_PATH,
      join(PROJECT_SKILLS, 'test-skill'),
      { recursive: true },
    );
  });

  it('creates project skills dir with 0o755', async () => {
    await installNamed('test-skill', DEFAULT_OPTS, CWD);
    expect(mockMkdirSync).toHaveBeenCalledWith(PROJECT_SKILLS, {
      recursive: true,
      mode: 0o755,
    });
  });

  it('updates goodboy.json and goodboy.lock', async () => {
    await installNamed('test-skill', DEFAULT_OPTS, CWD);
    expect(mockAddSkillToManifest).toHaveBeenCalledWith(CWD, 'test-skill', '0.1.0');
    expect(mockAddSkillToLock).toHaveBeenCalledWith(
      CWD,
      'test-skill',
      '0.1.0',
      join(PROJECT_SKILLS, 'test-skill'),
    );
  });

  it('aborts with no filesystem writes when consent is declined', async () => {
    mockRequestConsent.mockResolvedValue(false);
    await installNamed('test-skill', DEFAULT_OPTS, CWD);
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });

  it('does not expose filesystem paths when symlink scan rejects', async () => {
    mockScanForSymlinks.mockRejectedValue(
      new Error(
        'Security: skill contains a symlink pointing outside its directory: ' +
          '/real/path/skill/bad-link → /etc/passwd. Installation aborted.',
      ),
    );

    await expect(installNamed('test-skill', DEFAULT_OPTS, CWD)).rejects.toThrow(
      'Skill rejected: symlink pointing outside skill directory detected',
    );
  });

  it('rejects invalid skill names', async () => {
    await expect(installNamed('Bad_Name!', DEFAULT_OPTS, CWD)).rejects.toThrow(
      'Invalid skill name',
    );
    expect(mockCreateRegistryAdapter).not.toHaveBeenCalled();
  });

  it('stops spinner before consent and restarts after', async () => {
    await installNamed('test-skill', DEFAULT_OPTS, CWD);
    type SpinnerMock = { stop: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> };
    const spinnerInstance = vi.mocked(ora).mock.results[0]?.value as SpinnerMock;
    const stopOrder    = spinnerInstance.stop.mock.invocationCallOrder[0]!;
    const consentOrder = mockRequestConsent.mock.invocationCallOrder[0]!;
    const restartOrder = spinnerInstance.start.mock.invocationCallOrder[1]!;
    expect(stopOrder).toBeLessThan(consentOrder);
    expect(consentOrder).toBeLessThan(restartOrder);
  });
});

// ---------------------------------------------------------------------------
// installNamed — global install (-g)
// ---------------------------------------------------------------------------

describe('installNamed — global install', () => {
  const GLOBAL_OPTS: InstallOptions = { global: true };

  it('calls installToStore instead of cpSync', async () => {
    await installNamed('test-skill', GLOBAL_OPTS, CWD);
    expect(mockInstallToStore).toHaveBeenCalledWith('test-skill', SKILL_PATH);
    expect(mockCpSync).not.toHaveBeenCalled();
  });

  it('calls createAgentSymlinks with the store path', async () => {
    await installNamed('test-skill', GLOBAL_OPTS, CWD);
    expect(mockCreateAgentSymlinks).toHaveBeenCalledWith({
      agents: ['claude-code'],
      skillName: 'test-skill',
      storePath: '/mock/.goodboy/skills/test-skill',
    });
  });

  it('does not update goodboy.json/lock on global install', async () => {
    await installNamed('test-skill', GLOBAL_OPTS, CWD);
    expect(mockAddSkillToManifest).not.toHaveBeenCalled();
    expect(mockAddSkillToLock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// installNamed — --no-commit (commit === false)
// ---------------------------------------------------------------------------

describe('installNamed — no-commit', () => {
  const NO_COMMIT_OPTS: InstallOptions = { commit: false };

  it('still copies the skill', async () => {
    await installNamed('test-skill', NO_COMMIT_OPTS, CWD);
    expect(mockCpSync).toHaveBeenCalled();
  });

  it('skips goodboy.json/lock updates', async () => {
    await installNamed('test-skill', NO_COMMIT_OPTS, CWD);
    expect(mockAddSkillToManifest).not.toHaveBeenCalled();
    expect(mockAddSkillToLock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// installFromManifest — restore from goodboy.json
// ---------------------------------------------------------------------------

describe('installFromManifest', () => {
  it('throws when no goodboy.json is found', async () => {
    mockReadGoodBoyJson.mockResolvedValue(null);
    await expect(installFromManifest(DEFAULT_OPTS, CWD)).rejects.toThrow(
      'No goodboy.json found',
    );
  });

  it('installs missing skills listed in goodboy.json', async () => {
    mockReadGoodBoyJson.mockResolvedValue({
      schema: '1.0.0',
      skills: { 'test-skill': '^0.1.0' },
    });
    await installFromManifest(DEFAULT_OPTS, CWD);
    expect(mockCpSync).toHaveBeenCalled();
  });

  it('does nothing when all skills are already installed', async () => {
    mockReadGoodBoyJson.mockResolvedValue({
      schema: '1.0.0',
      skills: { 'test-skill': '^0.1.0' },
    });
    mockExistsSync.mockReturnValue(true);
    await installFromManifest(DEFAULT_OPTS, CWD);
    expect(mockCpSync).not.toHaveBeenCalled();
  });

  it('reports when no skills to install', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: {} });
    await installFromManifest(DEFAULT_OPTS, CWD);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('No skills listed'),
    );
  });
});

// ---------------------------------------------------------------------------
// installCommand — Commander integration smoke tests
// ---------------------------------------------------------------------------

describe('installCommand — Commander registration', () => {
  it('is aliased as "i"', () => {
    expect(installCommand.aliases()).toContain('i');
  });

  it('has a --global flag', () => {
    const globalOpt = installCommand.options.find((o) => o.long === '--global');
    expect(globalOpt).toBeDefined();
  });

  it('has a --no-commit flag', () => {
    const opt = installCommand.options.find((o) => o.long === '--no-commit');
    expect(opt).toBeDefined();
  });
});
