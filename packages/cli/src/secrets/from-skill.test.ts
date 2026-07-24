import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';

vi.mock('../lib/goodboy-file.js', () => ({
  readGoodBoyJson: vi.fn(),
}));
vi.mock('../lib/manifest.js', () => ({
  readManifest: vi.fn(),
  validateManifest: vi.fn(),
}));

import { readGoodBoyJson } from '../lib/goodboy-file.js';
import { readManifest, validateManifest } from '../lib/manifest.js';
import { resolveInstalledSkillSecrets } from './from-skill.js';
import { GoodBoyError } from '../lib/errors.js';
import type { GoodBoyManifest } from '../types/index.js';

const mockReadGoodBoyJson = vi.mocked(readGoodBoyJson);
const mockReadManifest = vi.mocked(readManifest);
const mockValidateManifest = vi.mocked(validateManifest);

const CWD = '/project';

function manifestFor(overrides: Partial<GoodBoyManifest> = {}): GoodBoyManifest {
  return {
    name: 'demo-skill',
    version: '1.0.0',
    description: 'A demo skill',
    author: { name: 'Test' },
    license: 'MIT',
    schema_version: '1.0.0',
    status: 'experimental',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveInstalledSkillSecrets()', () => {
  it('throws E_SKILL_PROJECT_NOT_FOUND when there is no goodboy.json', async () => {
    mockReadGoodBoyJson.mockResolvedValue(null);

    let caught: GoodBoyError | undefined;
    try {
      await resolveInstalledSkillSecrets(CWD, 'demo-skill');
    } catch (err) {
      caught = err as GoodBoyError;
    }

    expect(caught?.code).toBe('E_SKILL_PROJECT_NOT_FOUND');
    expect(caught?.message).toContain('goodboy init');
  });

  it('throws E_SKILL_NOT_INSTALLED, naming the skill, when it is not a key in goodboy.json skills', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: { 'other-skill': '^1.0.0' } });

    let caught: GoodBoyError | undefined;
    try {
      await resolveInstalledSkillSecrets(CWD, 'demo-skill');
    } catch (err) {
      caught = err as GoodBoyError;
    }

    expect(caught?.code).toBe('E_SKILL_NOT_INSTALLED');
    expect(caught?.message).toContain('demo-skill');
  });

  it('returns requires.secrets when the manifest declares them, reading from the expected installed path', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: { 'demo-skill': '^1.0.0' } });
    mockReadManifest.mockResolvedValue({});
    mockValidateManifest.mockReturnValue(
      manifestFor({ requires: { secrets: ['API_KEY', 'API_SECRET'] }, permissions: ['env'] }),
    );

    const result = await resolveInstalledSkillSecrets(CWD, 'demo-skill');

    expect(result).toEqual(['API_KEY', 'API_SECRET']);
    expect(mockReadManifest).toHaveBeenCalledWith(
      join(CWD, '.claude', 'skills', 'demo-skill', 'manifest.json'),
    );
  });

  it('returns [] (not an error) when the manifest has no requires field at all', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: { 'demo-skill': '^1.0.0' } });
    mockReadManifest.mockResolvedValue({});
    mockValidateManifest.mockReturnValue(manifestFor());

    const result = await resolveInstalledSkillSecrets(CWD, 'demo-skill');
    expect(result).toEqual([]);
  });

  it('throws a clear E_SKILL_MANIFEST_UNREADABLE error, cause preserved, when the manifest is missing/corrupt on disk', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: { 'demo-skill': '^1.0.0' } });
    const readErr = new Error('manifest.json not found');
    mockReadManifest.mockRejectedValue(readErr);

    let caught: GoodBoyError | undefined;
    try {
      await resolveInstalledSkillSecrets(CWD, 'demo-skill');
    } catch (err) {
      caught = err as GoodBoyError;
    }

    expect(caught?.code).toBe('E_SKILL_MANIFEST_UNREADABLE');
    expect(caught?.cause).toBe(readErr);
    expect(caught?.message).toContain('demo-skill');
  });
});
