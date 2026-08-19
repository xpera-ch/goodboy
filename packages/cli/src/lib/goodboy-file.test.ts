import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises');
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  sanitiseError: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

import { readFile, writeFile } from 'node:fs/promises';
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
import { logger } from './logger.js';

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockLogger = vi.mocked(logger);

const DIR = '/project';

const VALID_JSON: GoodBoyJson = {
  schema: '1.0.0',
  skills: { 'my-skill': '^1.0.0' },
};

const VALID_LOCK: GoodBoyLock = {
  schema: '1.0.0',
  generated: '2026-01-01T00:00:00.000Z',
  skills: {
    'my-skill': { version: '1.0.0' },
  },
};

// A lock written before `resolved` was removed. Its entries fail strict
// validation (additionalProperties: false), so the whole lock is treated as
// absent and regenerated on the next write.
const OLD_LOCK = {
  schema: '1.0.0',
  generated: '2026-01-01T00:00:00.000Z',
  skills: {
    'old-skill': { version: '1.0.0', resolved: '/some/path', integrity: 'sha256-x' },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// readGoodBoyJson — user intent: every unreadable state is a hard error
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

  it('throws on invalid JSON, naming the file', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue('not json {{{');
    await expect(readGoodBoyJson(DIR)).rejects.toThrow('goodboy.json contains invalid JSON');
  });

  it('throws on a same-major invalid shape, naming the field', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ schema: '1.0.0', skills: [] }),
    );
    await expect(readGoodBoyJson(DIR)).rejects.toThrow(/Invalid goodboy\.json:\n {2}\/skills:/);
  });

  it('throws on a non-object document at the root', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue('[]');
    await expect(readGoodBoyJson(DIR)).rejects.toThrow(/Invalid goodboy\.json:\n {2}\(root\):/);
  });

  it('throws on a document carrying the removed registry field', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ schema: '1.0.0', registry: 'https://example.com', skills: {} }),
    );
    await expect(readGoodBoyJson(DIR)).rejects.toThrow(
      /Invalid goodboy\.json:\n {2}\(root\): must NOT have additional properties/,
    );
  });

  it('rejects a newer-major schema with an upgrade hint', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ schema: '2.0.0', skills: {} }),
    );
    await expect(readGoodBoyJson(DIR)).rejects.toThrow(
      'goodboy.json declares schema 2.0.0; this version of GoodBoy supports 1.x. Upgrade GoodBoy to use this file.',
    );
  });

  it('rejects an older-major schema without an upgrade hint', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ schema: '0.9.0', skills: {} }),
    );
    await expect(readGoodBoyJson(DIR)).rejects.toThrow(
      'goodboy.json declares schema 0.9.0; this version of GoodBoy supports 1.x.',
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('validates a stripped copy but returns the original for a newer-minor schema', async () => {
    const newer = {
      schema: '1.1.0',
      skills: { 'my-skill': '^1.0.0' },
      futureField: { whatever: true },
    };
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(newer));
    const result = await readGoodBoyJson(DIR);
    expect(result).toEqual(newer);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'goodboy.json uses schema 1.1.0; this GoodBoy CLI knows 1.0.0. Unknown fields were ignored — upgrade GoodBoy to use them.',
    );
  });

  it('throws on a newer-minor document whose known fields are invalid', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ schema: '1.1.0', skills: { 'Bad_Name!': '^1.0.0' } }),
    );
    await expect(readGoodBoyJson(DIR)).rejects.toThrow(/Invalid goodboy\.json:\n {2}\/skills/);
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
// readGoodBoyLock — machine-generated: unreadable short of newer-major is
// warn + absent; a newer-major lock is a hard error
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
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('warns and returns null for invalid JSON', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue('{bad json');
    await expect(readGoodBoyLock(DIR)).resolves.toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'goodboy.lock contains invalid JSON — treating it as absent; it will be regenerated on the next install or upgrade.',
    );
  });

  it('warns and returns null for a same-major invalid shape, naming the field', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ schema: '1.0.0', generated: VALID_LOCK.generated, skills: [] }),
    );
    await expect(readGoodBoyLock(DIR)).resolves.toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('goodboy.lock could not be validated (/skills'),
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('treating it as absent — it will be regenerated on the next install or upgrade.'),
    );
  });

  it('warns and returns null for a non-object document at the root', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue('"not a lock"');
    await expect(readGoodBoyLock(DIR)).resolves.toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('goodboy.lock could not be validated ((root)'),
    );
  });

  it('treats an old-format lock carrying `resolved` as absent', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(OLD_LOCK));
    await expect(readGoodBoyLock(DIR)).resolves.toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('goodboy.lock could not be validated (/skills/old-skill'),
    );
  });

  it('throws on a newer-major schema', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ schema: '2.0.0', generated: VALID_LOCK.generated, skills: {} }),
    );
    await expect(readGoodBoyLock(DIR)).rejects.toThrow(
      'goodboy.lock declares schema 2.0.0; this version of GoodBoy supports 1.x. Upgrade GoodBoy to use this lock.',
    );
  });

  it('warns and returns null for an older-major schema', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ schema: '0.1.0', generated: VALID_LOCK.generated, skills: {} }),
    );
    await expect(readGoodBoyLock(DIR)).resolves.toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'goodboy.lock declares schema 0.1.0; this version of GoodBoy supports 1.x. Treating it as absent — it will be regenerated on the next install or upgrade.',
    );
  });

  it('validates a stripped copy but returns the original for a newer-minor schema', async () => {
    const newer = {
      schema: '1.1.0',
      generated: VALID_LOCK.generated,
      skills: { 'my-skill': { version: '1.0.0' } },
      futureField: { whatever: true },
    };
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(newer));
    const result = await readGoodBoyLock(DIR);
    expect(result).toEqual(newer);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'goodboy.lock uses schema 1.1.0; this GoodBoy CLI knows 1.0.0. Unknown fields were ignored — upgrade GoodBoy to use them.',
    );
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

  // The F1 seam: stripping is validation-time only. The read path validates a
  // stripped candidate and returns the original document, so a newer-minor
  // goodboy.json's unknown top-level fields must survive read-modify-write —
  // the fixture here carries one, which the strip path actually runs on.
  it('preserves a newer-minor goodboy.json\'s unknown top-level fields through a read-modify-write', async () => {
    const newer = {
      schema: '1.1.0',
      skills: { 'my-skill': '^1.0.0' },
      futureField: { whatever: true },
    };
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(newer));
    (mockWriteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await addSkillToManifest(DIR, 'another-skill', '2.0.0');

    const [, content] = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(content) as GoodBoyJson;
    expect(parsed).toEqual({
      schema: '1.1.0',
      skills: { 'my-skill': '^1.0.0', 'another-skill': '^2.0.0' },
      futureField: { whatever: true },
    });
  });

  it('keeps a newer-minor goodboy.json\'s unknown top-level field across two full round trips', async () => {
    const newer = {
      schema: '1.1.0',
      skills: { 'my-skill': '^1.0.0' },
      futureField: { whatever: true },
    };
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(newer));
    (mockWriteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await addSkillToManifest(DIR, 'second-skill', '2.0.0'); // pass 1
    const [, pass1] = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];

    // Pass 2 must consume what pass 1 wrote — the same unknown field must
    // survive a second read → write cycle (catches shallow-copy fixes that
    // would only survive one pass).
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(pass1);
    await addSkillToManifest(DIR, 'third-skill', '3.0.0');
    const [, pass2] = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls[1] as [string, string, string];

    expect(JSON.parse(pass2) as GoodBoyJson).toEqual({
      schema: '1.1.0',
      skills: { 'my-skill': '^1.0.0', 'second-skill': '^2.0.0', 'third-skill': '^3.0.0' },
      futureField: { whatever: true },
    });
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

    await addSkillToLock(DIR, 'new-skill', '1.2.3', 'sha256-abc123==');

    const [, content] = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(content) as GoodBoyLock;
    expect(parsed.skills['new-skill']).toEqual({
      version: '1.2.3',
      integrity: 'sha256-abc123==',
    });
  });

  it('updates an existing goodboy.lock', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(VALID_LOCK));
    (mockWriteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await addSkillToLock(DIR, 'extra', '0.5.0', 'sha256-def456==');

    const [, content] = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(content) as GoodBoyLock;
    expect(parsed.skills['my-skill']).toBeDefined();
    expect(parsed.skills['extra']).toEqual({
      version: '0.5.0',
      integrity: 'sha256-def456==',
    });
  });

  it('regenerates an old-format lock fresh instead of writing on top of it', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(OLD_LOCK));
    (mockWriteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await addSkillToLock(DIR, 'new-skill', '2.0.0', 'sha256-new==');

    const [, content] = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(content) as GoodBoyLock;
    expect(parsed.skills['new-skill']).toEqual({ version: '2.0.0', integrity: 'sha256-new==' });
    expect(parsed.skills['old-skill']).toBeUndefined();
    expect(parsed.schema).toBe('1.0.0');
  });

  it('preserves a newer-minor lock\'s declared schema when writing on top of it', async () => {
    const newer = {
      schema: '1.1.0',
      generated: VALID_LOCK.generated,
      skills: { 'my-skill': { version: '1.0.0' } },
    };
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(newer));
    (mockWriteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await addSkillToLock(DIR, 'extra', '0.5.0', 'sha256-def456==');

    const [, content] = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(content) as GoodBoyLock;
    expect(parsed.schema).toBe('1.1.0');
    expect(parsed.skills['my-skill']).toBeDefined();
    expect(parsed.skills['extra']).toEqual({ version: '0.5.0', integrity: 'sha256-def456==' });
  });

  // The F1 seam: this fixture carries an unknown top-level field, so the
  // strip path runs during the read — and the field must still reach disk.
  it('preserves a newer-minor lock\'s unknown top-level fields through a read-modify-write', async () => {
    const newer = {
      schema: '1.1.0',
      generated: VALID_LOCK.generated,
      skills: { 'my-skill': { version: '1.0.0' } },
      futureField: { whatever: true },
    };
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(newer));
    (mockWriteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await addSkillToLock(DIR, 'extra', '0.5.0', 'sha256-def456==');

    const [, content] = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(content) as GoodBoyLock;
    expect(parsed).toEqual({
      schema: '1.1.0',
      generated: expect.any(String),
      skills: {
        'my-skill': { version: '1.0.0' },
        extra: { version: '0.5.0', integrity: 'sha256-def456==' },
      },
      futureField: { whatever: true },
    });
  });

  it('keeps a newer-minor lock\'s unknown top-level field across two full round trips', async () => {
    const newer = {
      schema: '1.1.0',
      generated: VALID_LOCK.generated,
      skills: { 'my-skill': { version: '1.0.0' } },
      futureField: { whatever: true },
    };
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(newer));
    (mockWriteFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await addSkillToLock(DIR, 'second', '0.5.0', 'sha256-def456=='); // pass 1
    const [, pass1] = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];

    // Pass 2 must consume what pass 1 wrote — the unknown field must survive
    // a second read → write cycle (catches shallow-copy fixes that would only
    // survive one pass).
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(pass1);
    await addSkillToLock(DIR, 'third', '1.0.0', 'sha256-ghi789==');
    const [, pass2] = (mockWriteFile as ReturnType<typeof vi.fn>).mock.calls[1] as [string, string, string];

    expect(JSON.parse(pass2) as GoodBoyLock).toEqual({
      schema: '1.1.0',
      generated: expect.any(String),
      skills: {
        'my-skill': { version: '1.0.0' },
        second: { version: '0.5.0', integrity: 'sha256-def456==' },
        third: { version: '1.0.0', integrity: 'sha256-ghi789==' },
      },
      futureField: { whatever: true },
    });
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

  it('returns null for an old-format lock, which is treated as absent', async () => {
    (mockReadFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify(OLD_LOCK));
    await expect(getLockedVersion(DIR, 'old-skill')).resolves.toBeNull();
  });
});
