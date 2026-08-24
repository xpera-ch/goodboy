import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { join } from 'node:path';
import { ExitPromptError } from '@inquirer/core';
import type { GoodBoyManifest } from '../types/index.js';

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: '',
  })),
}));
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
}));
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('../lib/manifest.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/manifest.js')>();
  return {
    ...actual,
    writeManifest: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { input, select } from '@inquirer/prompts';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { validateManifest, writeManifest } from '../lib/manifest.js';
import { logger } from '../lib/logger.js';
import { registerSkillCreate } from './skill-create.js';

const mockInput = vi.mocked(input);
const mockSelect = vi.mocked(select);
const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockWriteManifest = vi.mocked(writeManifest);
const mockLogger = vi.mocked(logger);

const CWD = process.cwd();

function buildProgram(): Command {
  const program = new Command();
  registerSkillCreate(program);
  return program;
}

describe('skill create — scaffolded skill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called unexpectedly');
    });
    mockExistsSync.mockReturnValue(false);
    mockWriteManifest.mockResolvedValue(undefined);
  });

  it('scaffolds a manifest that passes validateManifest and omits email when blank', async () => {
    // Exact call order from skill-create.ts: name, description, authorName, authorEmail, license
    mockInput
      .mockResolvedValueOnce('my-skill')
      .mockResolvedValueOnce('A test skill')
      .mockResolvedValueOnce('Test Author')
      .mockResolvedValueOnce('')    // blank email → key omitted from author object
      .mockResolvedValueOnce('MIT'); // license
    mockSelect
      .mockResolvedValueOnce('code'); // category

    await buildProgram().parseAsync(['create'], { from: 'user' });

    expect(mockWriteManifest).toHaveBeenCalledOnce();
    expect(mockWriteManifest.mock.calls[0]![0]).toBe(join(CWD, 'my-skill', 'manifest.json'));
    const captured = mockWriteManifest.mock.calls[0]![1] as GoodBoyManifest;
    expect(() => validateManifest(captured)).not.toThrow();
    expect(captured.author).not.toHaveProperty('email');
  });

  it('writes SKILL.md with matching frontmatter', async () => {
    mockInput
      .mockResolvedValueOnce('my-skill')
      .mockResolvedValueOnce('A test skill')
      .mockResolvedValueOnce('Test Author')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('MIT');
    mockSelect.mockResolvedValueOnce('code');

    await buildProgram().parseAsync(['create'], { from: 'user' });

    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const [skillMdPath, content] = mockWriteFileSync.mock.calls[0]!;
    expect(skillMdPath).toBe(join(CWD, 'my-skill', 'SKILL.md'));
    expect(content).toContain('---');
    expect(content).toContain('name: my-skill');
    expect(content).toContain('description: A test skill');
  });

  it('creates the skill directory and scripts/references/assets scaffold dirs', async () => {
    mockInput
      .mockResolvedValueOnce('my-skill')
      .mockResolvedValueOnce('A test skill')
      .mockResolvedValueOnce('Test Author')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('MIT');
    mockSelect.mockResolvedValueOnce('code');

    await buildProgram().parseAsync(['create'], { from: 'user' });

    const createdDirs = mockMkdirSync.mock.calls.map((c) => c[0]);
    expect(createdDirs).toEqual(
      expect.arrayContaining([
        join(CWD, 'my-skill'),
        join(CWD, 'my-skill', 'scripts'),
        join(CWD, 'my-skill', 'references'),
        join(CWD, 'my-skill', 'assets'),
      ]),
    );
  });

  it('refuses to overwrite an existing directory and writes nothing', async () => {
    mockExistsSync.mockReturnValue(true);
    mockInput.mockResolvedValueOnce('existing-skill');

    await expect(
      buildProgram().parseAsync(['create'], { from: 'user' }),
    ).rejects.toThrow('process.exit called unexpectedly');

    expect(mockWriteManifest).not.toHaveBeenCalled();
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('already exists'),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('a force-closed prompt exits non-zero with a named cause and remedy — never exit 0 (C9)', async () => {
    mockInput.mockReset().mockRejectedValueOnce(
      new ExitPromptError('User force closed the prompt with SIGINT'),
    );

    await expect(
      buildProgram().parseAsync(['create'], { from: 'user' }),
    ).rejects.toThrow('process.exit called unexpectedly');

    // All of create's prompts precede its first write, so nothing was
    // created; the message names the cause and the interactive remedy.
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockWriteManifest).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('force-closed'),
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('interactive terminal'),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
