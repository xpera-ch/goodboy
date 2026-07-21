import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GoodBoyManifest } from '../types/index.js';

vi.mock('@inquirer/prompts', () => ({ confirm: vi.fn() }));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { confirm } from '@inquirer/prompts';
import { logger } from './logger.js';
import { summarizePermissions, requestConsent } from './consent.js';

const mockConfirm = vi.mocked(confirm);
const mockLogger = vi.mocked(logger);

const MANIFEST: GoodBoyManifest = {
  name: 'test-skill',
  version: '0.1.0',
  description: 'A test skill',
  author: { name: 'Test' },
  license: 'MIT',
  schema_version: '1.0.0',
  status: 'experimental',
};

// ---------------------------------------------------------------------------
// summarizePermissions()
// ---------------------------------------------------------------------------

describe('summarizePermissions()', () => {
  it('returns [] when permissions field is absent', () => {
    expect(summarizePermissions(MANIFEST)).toEqual([]);
  });

  it('returns [] when permissions is an empty array', () => {
    const manifest: GoodBoyManifest = { ...MANIFEST, permissions: [] };
    expect(summarizePermissions(manifest)).toEqual([]);
  });

  it('returns all five lines in schema-declared order for a full permissions array', () => {
    // Input deliberately out of schema order to verify fixed output order
    const manifest: GoodBoyManifest = {
      ...MANIFEST,
      permissions: ['env', 'shell', 'network', 'write_files', 'read_files'],
    };
    expect(summarizePermissions(manifest)).toEqual([
      'Read files on disk',
      'Write files on disk',
      'Access the network',
      'Run shell commands',
      'Read environment variables',
    ]);
  });

  it('returns exactly one line for a single-permission array', () => {
    const manifest: GoodBoyManifest = { ...MANIFEST, permissions: ['network'] };
    expect(summarizePermissions(manifest)).toEqual(['Access the network']);
  });

  it('throws when a permission value is not in the lookup table (simulates schema/type drift)', () => {
    // Cast bypasses TypeScript to simulate a new enum value accepted by Ajv
    // but not yet in the generated types or PERMISSION_LABELS.
    const manifest = {
      ...MANIFEST,
      permissions: ['shell', 'exec_scripts'],
    } as unknown as GoodBoyManifest;
    expect(() => summarizePermissions(manifest)).toThrow(
      'Unknown permission value in manifest: "exec_scripts"',
    );
  });
});

// ---------------------------------------------------------------------------
// requestConsent()
// ---------------------------------------------------------------------------

describe('requestConsent()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true without calling confirm() when permission list is empty', async () => {
    const result = await requestConsent(MANIFEST);
    expect(result).toBe(true);
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('returns true when confirm() resolves true', async () => {
    mockConfirm.mockResolvedValue(true);
    const manifest: GoodBoyManifest = { ...MANIFEST, permissions: ['shell'] };
    const result = await requestConsent(manifest);
    expect(result).toBe(true);
  });

  it('returns false when confirm() resolves false', async () => {
    mockConfirm.mockResolvedValue(false);
    const manifest: GoodBoyManifest = { ...MANIFEST, permissions: ['shell'] };
    const result = await requestConsent(manifest);
    expect(result).toBe(false);
  });

  it('passes default: false to confirm()', async () => {
    mockConfirm.mockResolvedValue(true);
    const manifest: GoodBoyManifest = { ...MANIFEST, permissions: ['env'] };
    await requestConsent(manifest);
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ default: false }),
    );
  });

  it('shows required secret names, exact strings, alongside permissions', async () => {
    mockConfirm.mockResolvedValue(true);
    const manifest: GoodBoyManifest = {
      ...MANIFEST,
      schema_version: '1.1.0',
      permissions: ['env'],
      requires: { secrets: ['EXOSCALE_API_KEY', 'EXOSCALE_API_SECRET'] },
    };
    await requestConsent(manifest);
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Required secrets (names only — never resolved or read during install):',
    );
    expect(mockLogger.info).toHaveBeenCalledWith('  • EXOSCALE_API_KEY');
    expect(mockLogger.info).toHaveBeenCalledWith('  • EXOSCALE_API_SECRET');
  });

  it('does not show a secrets section for a manifest without requires', async () => {
    mockConfirm.mockResolvedValue(true);
    const manifest: GoodBoyManifest = { ...MANIFEST, permissions: ['shell'] };
    await requestConsent(manifest);
    const infoLines = mockLogger.info.mock.calls.map((c) => String(c[0]));
    expect(infoLines.some((line) => line.includes('Required secrets'))).toBe(false);
  });

  it('prompts when secrets are declared even if permissions is empty (condition is explicit, not inferred from the permissions/secrets consistency rule)', async () => {
    mockConfirm.mockResolvedValue(true);
    const manifest = {
      ...MANIFEST,
      permissions: [],
      requires: { secrets: ['SOME_SECRET'] },
    } as GoodBoyManifest;
    const result = await requestConsent(manifest);
    expect(mockConfirm).toHaveBeenCalled();
    expect(result).toBe(true);
  });
});
