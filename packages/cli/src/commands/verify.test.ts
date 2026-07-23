import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { GoodBoyLock } from '../lib/goodboy-file.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));
vi.mock('../lib/goodboy-file.js', () => ({
  readGoodBoyJson: vi.fn(),
  readGoodBoyLock: vi.fn(),
}));
vi.mock('../lib/verify.js', () => ({
  verifySkillIntegrity: vi.fn(),
}));
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  sanitiseError: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

import { existsSync } from 'node:fs';
import { readGoodBoyJson, readGoodBoyLock } from '../lib/goodboy-file.js';
import { verifySkillIntegrity } from '../lib/verify.js';
import { logger } from '../lib/logger.js';
import { runVerify, verifyCommand, assertWithin } from './verify.js';

const mockExistsSync = vi.mocked(existsSync);
const mockReadGoodBoyJson = vi.mocked(readGoodBoyJson);
const mockReadGoodBoyLock = vi.mocked(readGoodBoyLock);
const mockVerifySkillIntegrity = vi.mocked(verifySkillIntegrity);
const mockLogger = vi.mocked(logger);

const CWD = process.cwd();
const SKILLS_BASE = join(CWD, '.claude', 'skills');
const GLOBAL_SKILLS_BASE = join(homedir(), '.goodboy', 'skills');
const GLOBAL_MANIFEST_DIR = join(homedir(), '.goodboy');

function lockFor(skillName: string, version: string, integrity?: string): GoodBoyLock {
  return {
    schema: '1.0.0',
    generated: '2026-01-01T00:00:00.000Z',
    skills: {
      [skillName]: {
        version,
        resolved: join(SKILLS_BASE, skillName),
        ...(integrity ? { integrity } : {}),
      },
    },
  };
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

describe('runVerify', () => {
  let stdoutChunks: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    stdoutChunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  function tableOutput(): string {
    return stripAnsi(stdoutChunks.join(''));
  }

  it('reports "verified" for a skill whose recomputed hash matches, exit code stays 0', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadGoodBoyLock.mockResolvedValue(lockFor('skill-a', '1.0.0', 'sha256-abc=='));
    mockVerifySkillIntegrity.mockResolvedValue('verified');

    await runVerify('skill-a', {});

    expect(tableOutput()).toContain('verified');
    expect(process.exitCode).toBeUndefined();
  });

  it('reports "mismatch" and sets a non-zero exit code', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadGoodBoyLock.mockResolvedValue(lockFor('skill-a', '1.0.0', 'sha256-abc=='));
    mockVerifySkillIntegrity.mockResolvedValue('mismatch');

    await runVerify('skill-a', {});

    expect(tableOutput()).toContain('mismatch');
    expect(process.exitCode).toBe(1);
  });

  it('reports "not verified" for a lock entry with no integrity, and does not affect the exit code', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadGoodBoyLock.mockResolvedValue(lockFor('skill-a', '1.0.0'));
    mockVerifySkillIntegrity.mockResolvedValue('not-verified');

    await runVerify('skill-a', {});

    expect(tableOutput()).toContain('not verified');
    expect(process.exitCode).toBeUndefined();
  });

  it('shows "—" for version when there is no lock at all for the installed skill', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadGoodBoyLock.mockResolvedValue(null);
    mockVerifySkillIntegrity.mockResolvedValue('not-verified');

    await runVerify('skill-a', {});

    expect(mockVerifySkillIntegrity).toHaveBeenCalledWith(expect.stringContaining('skill-a'), null);
    expect(tableOutput()).toContain('—');
    expect(tableOutput()).toContain('not verified');
  });

  it('errors clearly, without crashing, for a named skill that is not installed', async () => {
    mockExistsSync.mockReturnValue(false);

    await expect(runVerify('ghost-skill', {})).rejects.toThrow('Skill "ghost-skill" is not installed');
  });

  it('rejects an invalid skill name', async () => {
    await expect(runVerify('Bad_Name!', {})).rejects.toThrow('Invalid skill name');
  });

  it('-g verifies the globally installed skill and reads the global lock', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadGoodBoyLock.mockResolvedValue(lockFor('skill-a', '1.0.0', 'sha256-abc=='));
    mockVerifySkillIntegrity.mockResolvedValue('verified');

    await runVerify('skill-a', { global: true });

    expect(mockExistsSync).toHaveBeenCalledWith(join(GLOBAL_SKILLS_BASE, 'skill-a'));
    expect(mockReadGoodBoyLock).toHaveBeenCalledWith(GLOBAL_MANIFEST_DIR);
  });

  it('without a skill name, warns and returns when there is no goodboy.json', async () => {
    mockReadGoodBoyJson.mockResolvedValue(null);

    await runVerify(undefined, {});

    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('No goodboy.json found'));
  });

  it('without a skill name, reports when goodboy.json lists no skills', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: {} });

    await runVerify(undefined, {});

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('No skills listed'));
  });

  it('without a skill name, classifies every listed skill and sets exit code on any mismatch', async () => {
    mockReadGoodBoyJson.mockResolvedValue({
      schema: '1.0.0',
      skills: { 'skill-a': '^1.0.0', 'skill-b': '^1.0.0', 'skill-c': '^1.0.0' },
    });
    mockExistsSync.mockReturnValue(true);
    mockReadGoodBoyLock.mockImplementation(async () => ({
      schema: '1.0.0',
      generated: '2026-01-01T00:00:00.000Z',
      skills: {
        'skill-a': { version: '1.0.0', resolved: 'x', integrity: 'sha256-a==' },
        'skill-b': { version: '1.0.0', resolved: 'x', integrity: 'sha256-b==' },
        'skill-c': { version: '1.0.0', resolved: 'x' },
      },
    }));
    mockVerifySkillIntegrity.mockImplementation(async (_path, entry) => {
      if (!entry?.integrity) return 'not-verified';
      return entry.integrity === 'sha256-a==' ? 'verified' : 'mismatch';
    });

    await runVerify(undefined, {});

    const output = tableOutput();
    expect(output).toContain('skill-a');
    expect(output).toContain('skill-b');
    expect(output).toContain('skill-c');
    expect(output).toContain('verified');
    expect(output).toContain('mismatch');
    expect(output).toContain('not verified');
    expect(process.exitCode).toBe(1);
  });

  it('without a skill name, reads goodboy.lock exactly once no matter how many skills are checked', async () => {
    mockReadGoodBoyJson.mockResolvedValue({
      schema: '1.0.0',
      skills: { 'skill-a': '^1.0.0', 'skill-b': '^1.0.0', 'skill-c': '^1.0.0' },
    });
    mockExistsSync.mockReturnValue(true);
    mockReadGoodBoyLock.mockResolvedValue({
      schema: '1.0.0',
      generated: '2026-01-01T00:00:00.000Z',
      skills: {
        'skill-a': { version: '1.0.0', resolved: 'x', integrity: 'sha256-a==' },
        'skill-b': { version: '1.0.0', resolved: 'x', integrity: 'sha256-b==' },
        'skill-c': { version: '1.0.0', resolved: 'x', integrity: 'sha256-c==' },
      },
    });
    mockVerifySkillIntegrity.mockResolvedValue('verified');

    await runVerify(undefined, {});

    expect(mockReadGoodBoyLock).toHaveBeenCalledTimes(1);
  });

  it('without a skill name, skips (and warns about) an invalid name found in goodboy.json', async () => {
    mockReadGoodBoyJson.mockResolvedValue({ schema: '1.0.0', skills: { 'Bad_Name!': '^1.0.0' } });

    await runVerify(undefined, {});

    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Skipping invalid skill name'));
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('No installed skills to verify'));
  });

  it('without a skill name, skips (and warns about) a listed skill that is not installed, without affecting the exit code', async () => {
    mockReadGoodBoyJson.mockResolvedValue({
      schema: '1.0.0',
      skills: { 'skill-a': '^1.0.0', 'skill-missing': '^1.0.0' },
    });
    mockExistsSync.mockImplementation((p) => !String(p).includes('skill-missing'));
    mockReadGoodBoyLock.mockResolvedValue(lockFor('skill-a', '1.0.0', 'sha256-abc=='));
    mockVerifySkillIntegrity.mockResolvedValue('verified');

    await runVerify(undefined, {});

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping "skill-missing": not installed'),
    );
    expect(tableOutput()).toContain('skill-a');
    expect(tableOutput()).not.toContain('skill-missing');
    expect(process.exitCode).toBeUndefined();
  });
});

describe('assertWithin', () => {
  it('does not throw when the target is inside the base directory', () => {
    expect(() => assertWithin('/base/skills/skill-a', '/base/skills', 'skill path')).not.toThrow();
  });

  it('throws when the target escapes the base directory via ../', () => {
    expect(() => assertWithin('/base/skills/../../etc', '/base/skills', 'skill path')).toThrow(
      'Refused: skill path escapes the expected directory',
    );
  });

  it('throws when the target is a sibling directory with a shared prefix', () => {
    expect(() => assertWithin('/base/skills-evil', '/base/skills', 'skill path')).toThrow(
      'Refused: skill path escapes the expected directory',
    );
  });
});

describe('verifyCommand — Commander registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  it('has a --global flag', () => {
    const globalOpt = verifyCommand.options.find((o) => o.long === '--global');
    expect(globalOpt).toBeDefined();
  });

  it('dispatches to runVerify and reports a thrown error via logger.error + process.exit(1)', async () => {
    mockExistsSync.mockReturnValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    await verifyCommand.parseAsync(['ghost-skill'], { from: 'user' }).catch(() => {});

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('is not installed'));
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('dispatches to runVerify and completes without invoking the error path on success', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadGoodBoyLock.mockResolvedValue(lockFor('skill-a', '1.0.0', 'sha256-abc=='));
    mockVerifySkillIntegrity.mockResolvedValue('verified');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    await verifyCommand.parseAsync(['skill-a'], { from: 'user' });

    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
