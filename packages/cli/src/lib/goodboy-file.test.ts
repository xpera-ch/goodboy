import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises');

import { readFile, writeFile, appendFile } from 'node:fs/promises';
import {
  readGoodBoyJson,
  writeGoodBoyJson,
  readGoodBoyLock,
  writeGoodBoyLock,
  addSkillToManifest,
  addSkillToLock,
  removeSkillFromManifest,
  removeSkillFromLock,
  getLockedVersion,
} from './goodboy-file.js';
import type { GoodBoyJson, GoodBoyLock } from './goodboy-file.js';

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);

const DIR = '/project';

const VALID_JSON: GoodBoyJson = {
  schema: '1.0.0',
  skills: { 'my-skill': '^1.0.0' },
};

const VALID_LOCK: GoodBoyLock = {
  schema: '1.0.0',
  generated: '2026-01-01T00:00:00.000Z',
  skills: {
    'my-skill': { version: '1.0.0', resolved: '/store/my-skill' },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// readGoodBoyJson
// ---------------------------------------------------------------------------

describe('readGoodBoyJson', () => {
  it('returns null when file does not exist', async () => {
    const err = Object.assign(new Error('not found'), { code: 'ENOENT' });
    (mockReadFile as ReturnType<typeof vi.fn>).mockRejectedValue(err);
    await expect(readGoodBoyJson(DIR)).resolves.toBeNull();
  });

  it('returns parsed data for a valid goodboy.json', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(VALID_JSON));
    const result = await readGoodBoyJson(DIR);
    expect(result).toEqual(VALID_JSON);
  });

  it('throws on invalid JSON', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue('not json {{{');
    await expect(readGoodBoyJson(DIR)).rejects.toThrow('goodboy.json contains invalid JSON');
  });

  it('throws on unsupported schema version', async () => {
    const bad = { schema: '2.0.0', skills: {} };
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(bad));
    await expect(readGoodBoyJson(DIR)).rejects.toThrow('unsupported schema version');
  });

  it('rethrows non-ENOENT errors', async () => {
    const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    (mockReadFile as ReturnType<typeof vi.fn>).mockRejectedValue(err);
    await expect(readGoodBoyJson(DIR)).rejects.toThrow('permission denied');
  });
});

// ---------------------------------------------------------------------------
// writeGoodBoyJson
// ---------------------------------------------------------------------------

describe('writeGoodBoyJson', () => {
  it('writes JSON with 2-space indent and trailing newline', async () => {
    (mockWriteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await writeGoodBoyJson(DIR, VALID_JSON);
    const [, content] = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];
    expect(content).toBe(JSON.stringify(VALID_JSON, null, 2) + '\n');
  });
});

// ---------------------------------------------------------------------------
// readGoodBoyLock
// ---------------------------------------------------------------------------

describe('readGoodBoyLock', () => {
  it('returns null when file does not exist', async () => {
    const err = Object.assign(new Error('not found'), { code: 'ENOENT' });
    (mockReadFile as ReturnType<typeof vi.fn>).mockRejectedValue(err);
    await expect(readGoodBoyLock(DIR)).resolves.toBeNull();
  });

  it('returns parsed data for a valid goodboy.lock', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(VALID_LOCK));
    const result = await readGoodBoyLock(DIR);
    expect(result).toEqual(VALID_LOCK);
  });

  it('throws on invalid JSON', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue('{bad json');
    await expect(readGoodBoyLock(DIR)).rejects.toThrow('goodboy.lock contains invalid JSON');
  });

  it('rethrows non-ENOENT errors', async () => {
    const err = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    (mockReadFile as ReturnType<typeof vi.fn>).mockRejectedValue(err);
    await expect(readGoodBoyLock(DIR)).rejects.toThrow('disk full');
  });
});

// ---------------------------------------------------------------------------
// writeGoodBoyLock
// ---------------------------------------------------------------------------

describe('writeGoodBoyLock', () => {
  it('updates the generated timestamp and writes indented JSON', async () => {
    (mockWriteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const before = Date.now();
    await writeGoodBoyLock(DIR, VALID_LOCK);
    const after = Date.now();

    const [, content] = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(content) as GoodBoyLock;
    const ts = new Date(parsed.generated).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
    expect(parsed.skills).toEqual(VALID_LOCK.skills);
    expect(content.endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// addSkillToManifest
// ---------------------------------------------------------------------------

describe('addSkillToManifest', () => {
  it('creates a new goodboy.json when none exists', async () => {
    const enoent = Object.assign(new Error(), { code: 'ENOENT' });
    (mockReadFile as ReturnType<typeof vi.fn>).mockRejectedValue(enoent);
    (mockWriteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await addSkillToManifest(DIR, 'new-skill', '1.2.3');

    const [, content] = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(content) as GoodBoyJson;
    expect(parsed.skills['new-skill']).toBe('^1.2.3');
  });

  it('updates an existing goodboy.json', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(VALID_JSON));
    (mockWriteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await addSkillToManifest(DIR, 'another-skill', '2.0.0');

    const [, content] = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(content) as GoodBoyJson;
    expect(parsed.skills['my-skill']).toBe('^1.0.0');
    expect(parsed.skills['another-skill']).toBe('^2.0.0');
  });
});

// ---------------------------------------------------------------------------
// addSkillToLock
// ---------------------------------------------------------------------------

describe('addSkillToLock', () => {
  it('creates a new goodboy.lock when none exists', async () => {
    const enoent = Object.assign(new Error(), { code: 'ENOENT' });
    (mockReadFile as ReturnType<typeof vi.fn>).mockRejectedValue(enoent);
    (mockWriteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await addSkillToLock(DIR, 'new-skill', '1.2.3', '/store/new-skill');

    const [, content] = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(content) as GoodBoyLock;
    expect(parsed.skills['new-skill']).toEqual({
      version: '1.2.3',
      resolved: '/store/new-skill',
    });
  });

  it('updates an existing goodboy.lock', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(VALID_LOCK));
    (mockWriteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await addSkillToLock(DIR, 'extra', '0.5.0', '/store/extra');

    const [, content] = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(content) as GoodBoyLock;
    expect(parsed.skills['my-skill']).toBeDefined();
    expect(parsed.skills['extra']).toEqual({ version: '0.5.0', resolved: '/store/extra' });
  });
});

// ---------------------------------------------------------------------------
// removeSkillFromManifest
// ---------------------------------------------------------------------------

describe('removeSkillFromManifest', () => {
  it('removes the skill from an existing manifest', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(VALID_JSON));
    (mockWriteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await removeSkillFromManifest(DIR, 'my-skill');

    const [, content] = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(content) as GoodBoyJson;
    expect(parsed.skills['my-skill']).toBeUndefined();
  });

  it('is a no-op when goodboy.json does not exist', async () => {
    const enoent = Object.assign(new Error(), { code: 'ENOENT' });
    (mockReadFile as ReturnType<typeof vi.fn>).mockRejectedValue(enoent);

    await expect(removeSkillFromManifest(DIR, 'my-skill')).resolves.toBeUndefined();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('keeps the file even when skills becomes empty', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(VALID_JSON));
    (mockWriteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await removeSkillFromManifest(DIR, 'my-skill');

    expect(mockWriteFile).toHaveBeenCalledOnce();
    const [, content] = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(content) as GoodBoyJson;
    expect(parsed.skills).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// removeSkillFromLock
// ---------------------------------------------------------------------------

describe('removeSkillFromLock', () => {
  it('removes the skill from an existing lock', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(VALID_LOCK));
    (mockWriteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await removeSkillFromLock(DIR, 'my-skill');

    const [, content] = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(content) as GoodBoyLock;
    expect(parsed.skills['my-skill']).toBeUndefined();
  });

  it('is a no-op when goodboy.lock does not exist', async () => {
    const enoent = Object.assign(new Error(), { code: 'ENOENT' });
    (mockReadFile as ReturnType<typeof vi.fn>).mockRejectedValue(enoent);

    await expect(removeSkillFromLock(DIR, 'my-skill')).resolves.toBeUndefined();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getLockedVersion
// ---------------------------------------------------------------------------

describe('getLockedVersion', () => {
  it('returns the version for a locked skill', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(VALID_LOCK));
    await expect(getLockedVersion(DIR, 'my-skill')).resolves.toBe('1.0.0');
  });

  it('returns null when the lock does not exist', async () => {
    const enoent = Object.assign(new Error(), { code: 'ENOENT' });
    (mockReadFile as ReturnType<typeof vi.fn>).mockRejectedValue(enoent);
    await expect(getLockedVersion(DIR, 'my-skill')).resolves.toBeNull();
  });

  it('returns null when the skill is not in the lock', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(VALID_LOCK));
    await expect(getLockedVersion(DIR, 'unknown-skill')).resolves.toBeNull();
  });
});
