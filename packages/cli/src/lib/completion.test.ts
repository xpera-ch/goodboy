import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RegistryEntry } from './registry-entry.js';
import { createCompletionProgram } from '../__fixtures__/completion-program.js';

vi.mock('../lib/registry-adapter.js', () => ({
  createRegistryAdapter: vi.fn(),
}));
vi.mock('../lib/goodboy-file.js', () => ({
  readGoodBoyJson: vi.fn(),
  readGoodBoyLock: vi.fn(),
}));
vi.mock('../lib/store.js', () => ({
  getGoodboyHome: vi.fn(() => '/home/test/.goodboy'),
}));

import { createRegistryAdapter } from '../lib/registry-adapter.js';
import { readGoodBoyJson, readGoodBoyLock } from '../lib/goodboy-file.js';
import { complete } from './completion.js';

const mockCreateRegistryAdapter = vi.mocked(createRegistryAdapter);
const mockReadGoodBoyJson = vi.mocked(readGoodBoyJson);
const mockReadGoodBoyLock = vi.mocked(readGoodBoyLock);
const mockListRegistry = vi.fn();

const CWD = process.cwd();
const GLOBAL = '/home/test/.goodboy';

function entry(name: string): RegistryEntry {
  return { name, latest: '1.0.0', versions: {} };
}

const REGISTRY_NAMES = ['skill-a', 'skill-b'];

beforeEach(() => {
  mockListRegistry.mockReset();
  mockCreateRegistryAdapter.mockReturnValue({ listRegistry: mockListRegistry });
  mockReadGoodBoyJson.mockReset();
  mockReadGoodBoyLock.mockReset();
});

describe('complete — tree walking', () => {
  it('completes top-level subcommand names, excluding the protocol command', async () => {
    const program = createCompletionProgram();
    const names = await complete(program, ['']);
    expect(names).toContain('skill');
    expect(names).toContain('registry');
    expect(names).toContain('completion');
    expect(names).not.toContain('__complete');
  });

  it('filters top-level names by prefix and sorts', async () => {
    const program = createCompletionProgram();
    expect(await complete(program, ['in'])).toEqual(['init', 'install']);
  });

  it('descending into skill offers its subcommands', async () => {
    const program = createCompletionProgram();
    expect(await complete(program, ['skill', ''])).toEqual([
      'create',
      'diff',
      'open',
      'status',
      'version',
    ]);
  });

  it('descending into registry offers its subcommands, prefix-filtered', async () => {
    const program = createCompletionProgram();
    expect(await complete(program, ['registry', 'i'])).toEqual(['info']);
  });

  it('a fully-typed subcommand path reaches the skill-name position', async () => {
    mockListRegistry.mockResolvedValue([
      entry('skill-a'),
      entry('skill-b'),
      entry('other'),
    ]);
    const program = createCompletionProgram();
    expect(await complete(program, ['skill', 'version', 'skill-'])).toEqual([
      'skill-a',
      'skill-b',
    ]);
  });

  it('an unknown word does not crash the walk and matches nothing', async () => {
    const program = createCompletionProgram();
    expect(await complete(program, ['bogus', 'x'])).toEqual([]);
  });

  it('no words at all yields no candidates', async () => {
    const program = createCompletionProgram();
    expect(await complete(program, [])).toEqual([]);
  });
});

describe('complete — options', () => {
  it('offers long and short forms when the current word starts with -', async () => {
    const program = createCompletionProgram();
    const names = await complete(program, ['install', '-']);
    expect(names).toContain('-g');
    expect(names).toContain('--global');
    expect(names).toContain('--no-commit');
  });

  it('applies the prefix filter to options too', async () => {
    const program = createCompletionProgram();
    expect(await complete(program, ['install', '-g', '--c'])).toEqual([
      '--claude-code',
      '--codex',
    ]);
  });

  it('top level offers the program version option (short and long)', async () => {
    const program = createCompletionProgram();
    expect(await complete(program, ['--'])).toEqual(['--version']);
    // Lexicographic sort: '-' (0x2D) < 'v' (0x76), so --version leads.
    expect(await complete(program, ['-'])).toEqual(['--version', '-v']);
  });
});

describe('complete — skill names by source', () => {
  beforeEach(() => {
    mockListRegistry.mockResolvedValue(REGISTRY_NAMES.map(entry));
  });

  it('install completes registry names', async () => {
    const program = createCompletionProgram();
    expect(await complete(program, ['install', ''])).toEqual(REGISTRY_NAMES);
  });

  it('upgrade completes registry names, prefix-filtered', async () => {
    const program = createCompletionProgram();
    expect(await complete(program, ['upgrade', 'skill-'])).toEqual(
      REGISTRY_NAMES,
    );
  });

  it('skill diff completes registry names', async () => {
    const program = createCompletionProgram();
    expect(await complete(program, ['skill', 'diff', ''])).toEqual(
      REGISTRY_NAMES,
    );
  });

  it('skill version completes registry names', async () => {
    const program = createCompletionProgram();
    expect(await complete(program, ['skill', 'version', ''])).toEqual(
      REGISTRY_NAMES,
    );
  });

  it('registry info completes registry names', async () => {
    const program = createCompletionProgram();
    expect(await complete(program, ['registry', 'info', ''])).toEqual(
      REGISTRY_NAMES,
    );
  });

  it('registry validate completes registry names', async () => {
    const program = createCompletionProgram();
    expect(await complete(program, ['registry', 'validate', ''])).toEqual(
      REGISTRY_NAMES,
    );
  });

  it('registry remove completes registry names', async () => {
    const program = createCompletionProgram();
    expect(await complete(program, ['registry', 'remove', ''])).toEqual(
      REGISTRY_NAMES,
    );
  });

  it('dedupes and sorts registry names', async () => {
    mockListRegistry.mockResolvedValue([entry('b'), entry('a'), entry('b')]);
    const program = createCompletionProgram();
    expect(await complete(program, ['install', ''])).toEqual(['a', 'b']);
  });

  it('uninstall reads goodboy.json keys from the project directory', async () => {
    mockReadGoodBoyJson.mockResolvedValue({
      schema: '1.0.0',
      skills: { 'installed-a': '^1.0.0', 'installed-b': '^2.0.0' },
    });
    const program = createCompletionProgram();
    expect(await complete(program, ['uninstall', ''])).toEqual([
      'installed-a',
      'installed-b',
    ]);
    expect(mockReadGoodBoyJson).toHaveBeenCalledWith(CWD);
  });

  it('uninstall -g reads goodboy.json keys from the global directory', async () => {
    mockReadGoodBoyJson.mockResolvedValue({
      schema: '1.0.0',
      skills: { 'global-skill': '^1.0.0' },
    });
    const program = createCompletionProgram();
    expect(await complete(program, ['uninstall', '-g', ''])).toEqual([
      'global-skill',
    ]);
    expect(mockReadGoodBoyJson).toHaveBeenCalledWith(GLOBAL);
  });

  it('uninstall --global flips scope through the substring check', async () => {
    mockReadGoodBoyJson.mockResolvedValue({
      schema: '1.0.0',
      skills: { 'global-skill': '^1.0.0' },
    });
    const program = createCompletionProgram();
    expect(await complete(program, ['uninstall', '--global', ''])).toEqual([
      'global-skill',
    ]);
    expect(mockReadGoodBoyJson).toHaveBeenCalledWith(GLOBAL);
  });

  it('skill open reads goodboy.json keys', async () => {
    mockReadGoodBoyJson.mockResolvedValue({
      schema: '1.0.0',
      skills: { 'installed-a': '^1.0.0' },
    });
    const program = createCompletionProgram();
    expect(await complete(program, ['skill', 'open', ''])).toEqual([
      'installed-a',
    ]);
  });

  it('verify reads goodboy.lock keys from the project directory', async () => {
    mockReadGoodBoyLock.mockResolvedValue({
      schema: '1.0.0',
      generated: '2026-01-01T00:00:00.000Z',
      skills: { 'locked-a': { version: '1.0.0' } },
    });
    const program = createCompletionProgram();
    expect(await complete(program, ['verify', ''])).toEqual(['locked-a']);
    expect(mockReadGoodBoyLock).toHaveBeenCalledWith(CWD);
  });

  it('verify -g reads goodboy.lock keys from the global directory', async () => {
    mockReadGoodBoyLock.mockResolvedValue({
      schema: '1.0.0',
      generated: '2026-01-01T00:00:00.000Z',
      skills: { 'global-locked': { version: '1.0.0' } },
    });
    const program = createCompletionProgram();
    expect(await complete(program, ['verify', '-g', ''])).toEqual([
      'global-locked',
    ]);
    expect(mockReadGoodBoyLock).toHaveBeenCalledWith(GLOBAL);
  });
});

describe('complete — position logic', () => {
  it('a value-taking option consumes the following word, so the skill-name position stays open', async () => {
    mockListRegistry.mockResolvedValue([entry('skill-a')]);
    const program = createCompletionProgram();
    // skill version <skill-name> --bump <level>: 'patch' is --bump's value,
    // not a positional, so the still-unfilled skill-name argument completes.
    expect(await complete(program, ['skill', 'version', '--bump', 'patch', ''])).toEqual([
      'skill-a',
    ]);
  });

  it('an inline option value does not consume the next word', async () => {
    mockListRegistry.mockResolvedValue([entry('skill-a')]);
    const program = createCompletionProgram();
    expect(await complete(program, ['skill', 'version', '--bump=patch', ''])).toEqual([
      'skill-a',
    ]);
  });

  it('an unknown flag is skipped without error', async () => {
    mockListRegistry.mockResolvedValue([entry('skill-a')]);
    const program = createCompletionProgram();
    expect(await complete(program, ['install', '--bogus', ''])).toEqual([
      'skill-a',
    ]);
  });

  it('no candidates once the declared argument is filled', async () => {
    mockReadGoodBoyJson.mockResolvedValue({
      schema: '1.0.0',
      skills: { 'installed-a': '^1.0.0' },
    });
    const program = createCompletionProgram();
    expect(await complete(program, ['uninstall', 'installed-a', ''])).toEqual(
      [],
    );
  });

  it('a command with no skill-name argument and no source yields nothing', async () => {
    mockListRegistry.mockResolvedValue([entry('skill-a')]);
    const program = createCompletionProgram();
    expect(await complete(program, ['skill', 'status', ''])).toEqual([]);
  });

  it('registry remove --version <v> consumed its value; the filled argument yields nothing', async () => {
    mockListRegistry.mockResolvedValue([entry('skill-a')]);
    const program = createCompletionProgram();
    expect(
      await complete(program, ['registry', 'remove', 'skill-a', '--version', '1.2.3', '']),
    ).toEqual([]);
  });
});

describe('complete — failure paths degrade to empty', () => {
  it('a registry listing that throws yields nothing', async () => {
    mockListRegistry.mockRejectedValue(new Error('registry exploded'));
    const program = createCompletionProgram();
    expect(await complete(program, ['install', ''])).toEqual([]);
  });

  it('goodboy.json that throws yields nothing', async () => {
    mockReadGoodBoyJson.mockRejectedValue(new Error('invalid JSON'));
    const program = createCompletionProgram();
    expect(await complete(program, ['uninstall', ''])).toEqual([]);
  });

  it('absent goodboy.json (null) yields nothing', async () => {
    mockReadGoodBoyJson.mockResolvedValue(null);
    const program = createCompletionProgram();
    expect(await complete(program, ['uninstall', ''])).toEqual([]);
  });

  it('goodboy.lock that returns null yields nothing', async () => {
    mockReadGoodBoyLock.mockResolvedValue(null);
    const program = createCompletionProgram();
    expect(await complete(program, ['verify', ''])).toEqual([]);
  });

  it('goodboy.lock that throws yields nothing', async () => {
    mockReadGoodBoyLock.mockRejectedValue(new Error('unreadable lock'));
    const program = createCompletionProgram();
    expect(await complete(program, ['verify', ''])).toEqual([]);
  });
});
