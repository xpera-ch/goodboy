import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureGitignoreEntry } from './gitignore.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'goodboy-gitignore-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function read(): string {
  return readFileSync(join(dir, '.gitignore'), 'utf-8');
}

describe('ensureGitignoreEntry()', () => {
  it('creates .gitignore with the entry when none exists yet', async () => {
    await ensureGitignoreEntry(dir, 'goodboy.local.json');
    expect(read()).toBe('goodboy.local.json\n');
  });

  it('appends the entry to an existing .gitignore, preserving existing content', async () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
    await ensureGitignoreEntry(dir, 'goodboy.local.json');
    expect(read()).toBe('node_modules/\ngoodboy.local.json\n');
  });

  it('adds a newline before appending when the existing file does not end with one', async () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/');
    await ensureGitignoreEntry(dir, 'goodboy.local.json');
    expect(read()).toBe('node_modules/\ngoodboy.local.json\n');
  });

  it('is idempotent: does not duplicate an entry that is already present', async () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\ngoodboy.local.json\n');
    await ensureGitignoreEntry(dir, 'goodboy.local.json');
    expect(read()).toBe('node_modules/\ngoodboy.local.json\n');
  });

  it('matches an existing entry regardless of surrounding whitespace, without appending a duplicate', async () => {
    writeFileSync(join(dir, '.gitignore'), '  goodboy.local.json  \n');
    await ensureGitignoreEntry(dir, 'goodboy.local.json');
    expect(read()).toBe('  goodboy.local.json  \n');
  });

  it('supports a different entry independently (e.g. install.ts using .claude/skills/)', async () => {
    await ensureGitignoreEntry(dir, '.claude/skills/');
    expect(read()).toBe('.claude/skills/\n');
  });
});
