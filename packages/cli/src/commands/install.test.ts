import { describe, it, expect, vi, beforeEach } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { GoodBoyManifest, ExecutableSkillManifest } from '../types/index.js';

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    text: '',
  })),
}));
vi.mock('node:fs', () => ({
  cpSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  statSync: vi.fn(),
}));
vi.mock('../lib/registry-adapter.js');
vi.mock('../lib/manifest.js');
vi.mock('../lib/hooks.js');
vi.mock('../lib/consent.js');
vi.mock('../lib/registry.js');
vi.mock('../lib/fs-security.js');
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import ora from 'ora';
import { cpSync, mkdirSync } from 'node:fs';
import { createRegistryAdapter } from '../lib/registry-adapter.js';
import { readManifest, validateManifest } from '../lib/manifest.js';
import { runHooks } from '../lib/hooks.js';
import { requestConsent } from '../lib/consent.js';
import { scanForSymlinks } from '../lib/fs-security.js';
import { installCommand } from './install.js';

const mockCreateRegistryAdapter = vi.mocked(createRegistryAdapter);
const mockReadManifest = vi.mocked(readManifest);
const mockValidateManifest = vi.mocked(validateManifest);
const mockRunHooks = vi.mocked(runHooks);
const mockRequestConsent = vi.mocked(requestConsent);
const mockScanForSymlinks = vi.mocked(scanForSymlinks);
const mockCpSync = vi.mocked(cpSync);
const mockMkdirSync = vi.mocked(mkdirSync);

const SKILL_PATH = '/fake/registry/test-skill';
const SKILLS_DIR = join(homedir(), '.goodboy', 'skills');

const PASSIVE_MANIFEST: GoodBoyManifest = {
  kind: 'passive',
  name: 'test-skill',
  version: '0.1.0',
  description: 'A passive skill',
  author: { name: 'Test' },
  license: 'MIT',
  content: 'SKILL.md',
  schema_version: '1.0.0',
  status: 'experimental',
};

const EXEC_BASE: ExecutableSkillManifest = {
  kind: 'executable',
  name: 'test-skill',
  version: '0.1.0',
  description: 'An executable skill',
  author: { name: 'Test' },
  license: 'MIT',
  entry: 'index.ts',
  language: 'typescript',
  hooks: {},
  schema_version: '1.0.0',
  status: 'experimental',
};

describe('install command — hook dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called unexpectedly');
    });

    mockCreateRegistryAdapter.mockReturnValue({
      resolveSkill: vi.fn().mockResolvedValue(SKILL_PATH),
      getSkillsLocation: vi.fn().mockReturnValue(SKILLS_DIR),
      listInstalled: vi.fn(),
      search: vi.fn(),
      getRegistryLocation: vi.fn(),
    } as unknown as ReturnType<typeof createRegistryAdapter>);

    mockReadManifest.mockResolvedValue({});
    mockScanForSymlinks.mockResolvedValue(undefined);
    mockRunHooks.mockResolvedValue(undefined);
    mockRequestConsent.mockResolvedValue(true);
  });

  it('installs a passive skill without calling runHooks', async () => {
    mockValidateManifest.mockReturnValue(PASSIVE_MANIFEST);
    await installCommand.parseAsync(['test-skill'], { from: 'user' });
    expect(mockRunHooks).not.toHaveBeenCalled();
  });

  it('runs preinstall hook for an executable skill', async () => {
    const manifest: ExecutableSkillManifest = {
      ...EXEC_BASE,
      hooks: { preinstall: { script: 'hooks/setup.sh' } },
    };
    mockValidateManifest.mockReturnValue(manifest);
    await installCommand.parseAsync(['test-skill'], { from: 'user' });
    expect(mockRunHooks).toHaveBeenCalledWith(
      manifest,
      ['preinstall'],
      expect.objectContaining({ skillName: 'test-skill', skillPath: SKILL_PATH }),
    );
  });

  it('runs postinstall hook for an executable skill', async () => {
    const manifest: ExecutableSkillManifest = {
      ...EXEC_BASE,
      hooks: { postinstall: { script: 'hooks/teardown.sh' } },
    };
    mockValidateManifest.mockReturnValue(manifest);
    await installCommand.parseAsync(['test-skill'], { from: 'user' });
    expect(mockRunHooks).toHaveBeenCalledWith(
      manifest,
      ['postinstall'],
      expect.objectContaining({ skillName: 'test-skill', skillPath: join(SKILLS_DIR, 'test-skill') }),
    );
  });

  it('installs an executable skill with no hooks without calling runHooks', async () => {
    mockValidateManifest.mockReturnValue(EXEC_BASE);
    await installCommand.parseAsync(['test-skill'], { from: 'user' });
    expect(mockRunHooks).not.toHaveBeenCalled();
  });

  it('passes the validated manifest to requestConsent', async () => {
    mockValidateManifest.mockReturnValue(EXEC_BASE);
    await installCommand.parseAsync(['test-skill'], { from: 'user' });
    expect(mockRequestConsent).toHaveBeenCalledWith(EXEC_BASE);
  });

  it('aborts with no filesystem writes when consent is declined', async () => {
    mockValidateManifest.mockReturnValue(EXEC_BASE);
    mockRequestConsent.mockResolvedValue(false);
    await installCommand.parseAsync(['test-skill'], { from: 'user' });
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockScanForSymlinks).not.toHaveBeenCalled();
    expect(mockRunHooks).not.toHaveBeenCalled();
  });

  it('does not throw when consent is declined', async () => {
    mockValidateManifest.mockReturnValue(EXEC_BASE);
    mockRequestConsent.mockResolvedValue(false);
    await expect(
      installCommand.parseAsync(['test-skill'], { from: 'user' }),
    ).resolves.toBeDefined();
  });

  it('stops the spinner before calling requestConsent and restarts it after', async () => {
    mockValidateManifest.mockReturnValue(EXEC_BASE);
    await installCommand.parseAsync(['test-skill'], { from: 'user' });

    type SpinnerMock = { stop: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> };
    const spinnerInstance = vi.mocked(ora).mock.results[0]?.value as SpinnerMock;

    // invocationCallOrder is a Vitest global counter that increments with every mock call
    // across all vi.fn() instances within a test. Comparing values across different mocks
    // gives a strict happens-before ordering guarantee — a count-only check cannot do this.
    //
    // Expected sequence:
    //   start[0]  (ora(...).start() chain at construction)
    //   stop[0]   (before consent prompt)
    //   consent[0](requestConsent called)
    //   start[1]  (restart after consent granted)
    const stopOrder    = spinnerInstance.stop.mock.invocationCallOrder[0]!;
    const consentOrder = mockRequestConsent.mock.invocationCallOrder[0]!;
    const restartOrder = spinnerInstance.start.mock.invocationCallOrder[1]!;

    expect(stopOrder).toBeDefined();
    expect(consentOrder).toBeDefined();
    expect(restartOrder).toBeDefined();
    expect(stopOrder).toBeLessThan(consentOrder);    // stop fires before consent is requested
    expect(consentOrder).toBeLessThan(restartOrder); // restart fires only after consent resolves
  });
});
