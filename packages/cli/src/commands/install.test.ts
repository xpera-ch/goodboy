import { describe, it, expect, vi, beforeEach } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { GoodBoyManifest } from '../types/index.js';

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
import { requestConsent } from '../lib/consent.js';
import { scanForSymlinks } from '../lib/fs-security.js';
import { logger } from '../lib/logger.js';
import { installCommand } from './install.js';

const mockCreateRegistryAdapter = vi.mocked(createRegistryAdapter);
const mockReadManifest = vi.mocked(readManifest);
const mockValidateManifest = vi.mocked(validateManifest);
const mockRequestConsent = vi.mocked(requestConsent);
const mockScanForSymlinks = vi.mocked(scanForSymlinks);
const mockLogger = vi.mocked(logger);
const mockCpSync = vi.mocked(cpSync);
const mockMkdirSync = vi.mocked(mkdirSync);

const SKILL_PATH = '/fake/registry/test-skill';
const SKILLS_DIR = join(homedir(), '.goodboy', 'skills');

const MANIFEST: GoodBoyManifest = {
  name: 'test-skill',
  version: '0.1.0',
  description: 'A test skill',
  author: { name: 'Test' },
  license: 'MIT',
  schema_version: '1.0.0',
  status: 'experimental',
};

describe('install command', () => {
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
    mockRequestConsent.mockResolvedValue(true);
  });

  it('passes the validated manifest to requestConsent', async () => {
    mockValidateManifest.mockReturnValue(MANIFEST);
    await installCommand.parseAsync(['test-skill'], { from: 'user' });
    expect(mockRequestConsent).toHaveBeenCalledWith(MANIFEST);
  });

  it('aborts with no filesystem writes when consent is declined', async () => {
    mockValidateManifest.mockReturnValue(MANIFEST);
    mockRequestConsent.mockResolvedValue(false);
    await installCommand.parseAsync(['test-skill'], { from: 'user' });
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockScanForSymlinks).not.toHaveBeenCalled();
  });

  it('does not throw when consent is declined', async () => {
    mockValidateManifest.mockReturnValue(MANIFEST);
    mockRequestConsent.mockResolvedValue(false);
    await expect(
      installCommand.parseAsync(['test-skill'], { from: 'user' }),
    ).resolves.toBeDefined();
  });

  it('does not expose filesystem paths when symlink scan rejects', async () => {
    mockValidateManifest.mockReturnValue(MANIFEST);
    mockScanForSymlinks.mockRejectedValue(
      new Error(
        'Security: skill contains a symlink pointing outside its directory: ' +
          '/real/path/skill/bad-link → /etc/passwd. Installation aborted.',
      ),
    );

    // process.exit mock throws, so parseAsync rejects — swallow that
    await installCommand.parseAsync(['test-skill'], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    const logged = mockLogger.error.mock.calls[0]?.[0] as string;
    expect(logged).toBe('Skill rejected: symlink pointing outside skill directory detected');
    expect(logged).not.toContain('/real/path');
    expect(logged).not.toContain('/etc/passwd');
  });

  it('stops the spinner before calling requestConsent and restarts it after', async () => {
    mockValidateManifest.mockReturnValue(MANIFEST);
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
    expect(stopOrder).toBeLessThan(consentOrder);
    expect(consentOrder).toBeLessThan(restartOrder);
  });
});
