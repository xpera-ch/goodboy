import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GoodBoyManifest, ExecutableSkillManifest } from '../types/index.js';

vi.mock('@inquirer/prompts', () => ({ confirm: vi.fn() }));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { confirm } from '@inquirer/prompts';
import { summarizePermissions, requestConsent } from './consent.js';

const mockConfirm = vi.mocked(confirm);

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

// ---------------------------------------------------------------------------
// summarizePermissions()
// ---------------------------------------------------------------------------

describe('summarizePermissions()', () => {
  it('returns [] for a passive manifest', () => {
    expect(summarizePermissions(PASSIVE_MANIFEST)).toEqual([]);
  });

  it('returns [] for an executable manifest with no permissions field', () => {
    expect(summarizePermissions(EXEC_BASE)).toEqual([]);
  });

  it('returns [] for an executable manifest with permissions: []', () => {
    const manifest: ExecutableSkillManifest = { ...EXEC_BASE, permissions: [] };
    expect(summarizePermissions(manifest)).toEqual([]);
  });

  it('returns all five lines in schema-declared order for a full permissions array', () => {
    // Input deliberately out of schema order to verify fixed output order
    const manifest: ExecutableSkillManifest = {
      ...EXEC_BASE,
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
    const manifest: ExecutableSkillManifest = { ...EXEC_BASE, permissions: ['network'] };
    expect(summarizePermissions(manifest)).toEqual(['Access the network']);
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
    const result = await requestConsent(EXEC_BASE);
    expect(result).toBe(true);
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('returns true when confirm() resolves true', async () => {
    mockConfirm.mockResolvedValue(true);
    const manifest: ExecutableSkillManifest = { ...EXEC_BASE, permissions: ['shell'] };
    const result = await requestConsent(manifest);
    expect(result).toBe(true);
  });

  it('returns false when confirm() resolves false', async () => {
    mockConfirm.mockResolvedValue(false);
    const manifest: ExecutableSkillManifest = { ...EXEC_BASE, permissions: ['shell'] };
    const result = await requestConsent(manifest);
    expect(result).toBe(false);
  });

  it('passes default: false to confirm()', async () => {
    mockConfirm.mockResolvedValue(true);
    const manifest: ExecutableSkillManifest = { ...EXEC_BASE, permissions: ['env'] };
    await requestConsent(manifest);
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ default: false }),
    );
  });
});
