import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { computeSkillIntegrity } from './integrity.js';

let dirA: string;
let dirB: string;

beforeEach(() => {
  dirA = mkdtempSync(join(tmpdir(), 'goodboy-integrity-a-'));
  dirB = mkdtempSync(join(tmpdir(), 'goodboy-integrity-b-'));
});

afterEach(() => {
  rmSync(dirA, { recursive: true, force: true });
  rmSync(dirB, { recursive: true, force: true });
});

function writeSkill(dir: string, files: Record<string, string>): void {
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(dir, relPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }
}

describe('computeSkillIntegrity()', () => {
  it('is deterministic: identical directory contents produce identical hashes', async () => {
    writeSkill(dirA, {
      'manifest.json': '{"name":"test"}',
      'SKILL.md': '# Test skill',
      'scripts/run.sh': '#!/bin/sh\necho hi',
    });
    writeSkill(dirB, {
      'manifest.json': '{"name":"test"}',
      'SKILL.md': '# Test skill',
      'scripts/run.sh': '#!/bin/sh\necho hi',
    });
    expect(await computeSkillIntegrity(dirA)).toBe(await computeSkillIntegrity(dirB));
  });

  it('is independent of filesystem enumeration / creation order', async () => {
    // dirA: created in one order
    writeSkill(dirA, { 'a.txt': '1', 'b.txt': '2', 'c/d.txt': '3' });

    // dirB: same final content, deliberately created in reverse order
    mkdirSync(join(dirB, 'c'), { recursive: true });
    writeFileSync(join(dirB, 'c', 'd.txt'), '3');
    writeFileSync(join(dirB, 'b.txt'), '2');
    writeFileSync(join(dirB, 'a.txt'), '1');

    expect(await computeSkillIntegrity(dirA)).toBe(await computeSkillIntegrity(dirB));
  });

  it('changes when a single byte changes in a top-level file', async () => {
    writeSkill(dirA, { 'manifest.json': '{"name":"test"}' });
    writeSkill(dirB, { 'manifest.json': '{"name":"Test"}' });
    expect(await computeSkillIntegrity(dirA)).not.toBe(await computeSkillIntegrity(dirB));
  });

  it('changes when a byte changes in a scripts/ file', async () => {
    writeSkill(dirA, { 'scripts/run.sh': 'echo hi' });
    writeSkill(dirB, { 'scripts/run.sh': 'echo HI' });
    expect(await computeSkillIntegrity(dirA)).not.toBe(await computeSkillIntegrity(dirB));
  });

  it('changes when a byte changes in a bundled markdown file', async () => {
    writeSkill(dirA, { 'references/notes.md': '# Notes\nSome content.' });
    writeSkill(dirB, { 'references/notes.md': '# Notes\nSome Content.' });
    expect(await computeSkillIntegrity(dirA)).not.toBe(await computeSkillIntegrity(dirB));
  });

  it('changes when a file is added', async () => {
    writeSkill(dirA, { 'a.txt': '1' });
    writeSkill(dirB, { 'a.txt': '1', 'b.txt': '2' });
    expect(await computeSkillIntegrity(dirA)).not.toBe(await computeSkillIntegrity(dirB));
  });

  it('changes when a file is removed', async () => {
    writeSkill(dirA, { 'a.txt': '1', 'b.txt': '2' });
    writeSkill(dirB, { 'a.txt': '1' });
    expect(await computeSkillIntegrity(dirA)).not.toBe(await computeSkillIntegrity(dirB));
  });

  it('changes when a file is moved/renamed (same content, different path)', async () => {
    writeSkill(dirA, { 'scripts/run.sh': 'echo hi' });
    writeSkill(dirB, { 'scripts/other.sh': 'echo hi' });
    expect(await computeSkillIntegrity(dirA)).not.toBe(await computeSkillIntegrity(dirB));
  });

  it('handles a permitted internal symlink: stable hash across repeated runs, no crash', async () => {
    writeSkill(dirA, { 'SKILL.md': '# Test' });
    symlinkSync('SKILL.md', join(dirA, 'link-to-skill-md'));
    const first = await computeSkillIntegrity(dirA);
    const second = await computeSkillIntegrity(dirA);
    expect(first).toBe(second);
  });

  it('retargeting an internal symlink changes the hash', async () => {
    writeSkill(dirA, { 'SKILL.md': '# Test', 'other.md': '# Other' });
    symlinkSync('SKILL.md', join(dirA, 'link'));
    const before = await computeSkillIntegrity(dirA);

    rmSync(join(dirA, 'link'));
    symlinkSync('other.md', join(dirA, 'link'));
    const after = await computeSkillIntegrity(dirA);

    expect(before).not.toBe(after);
  });

  it('does not infinite-loop or crash on a symlink pointing back at an ancestor directory', async () => {
    mkdirSync(join(dirA, 'subdir'), { recursive: true });
    writeFileSync(join(dirA, 'subdir', 'file.txt'), 'x');
    // Permitted per scanForSymlinks: resolves to dirA itself, still "inside".
    symlinkSync('..', join(dirA, 'subdir', 'up-link'));
    await expect(computeSkillIntegrity(dirA)).resolves.toMatch(/^sha256-/);
  });

  it('a file and a symlink at different paths with colliding string content do not collide', async () => {
    // Same "content" string, but one is a real file and the other is a
    // symlink target string -- the entry-type marker must keep these apart.
    writeSkill(dirA, { 'a.txt': 'SKILL.md' });
    writeFileSync(join(dirA, 'target-for-b'), 'unused');
    writeSkill(dirB, { 'a.txt': 'SKILL.md' });
    symlinkSync('SKILL.md', join(dirB, 'b-link'));
    expect(await computeSkillIntegrity(dirA)).not.toBe(await computeSkillIntegrity(dirB));
  });

  it('proves unambiguous construction: a path/content-swap pair produces different hashes', async () => {
    // A naive "marker + path + content" concatenation would collide here:
    // "file" + "ab" + "cd" === "file" + "abc" + "d" === "fileabcd".
    writeSkill(dirA, { ab: 'cd' });
    writeSkill(dirB, { abc: 'd' });
    expect(await computeSkillIntegrity(dirA)).not.toBe(await computeSkillIntegrity(dirB));
  });

  it('produces a valid SRI sha256- string using standard base64', async () => {
    writeSkill(dirA, { 'manifest.json': '{}' });
    const hash = await computeSkillIntegrity(dirA);
    expect(hash).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/);
    const decoded = Buffer.from(hash.slice('sha256-'.length), 'base64');
    expect(decoded.length).toBe(32); // a sha256 digest is always 32 bytes
  });

  it('excludes .git directories from hashing', async () => {
    writeSkill(dirA, { 'manifest.json': '{}' });
    const before = await computeSkillIntegrity(dirA);
    mkdirSync(join(dirA, '.git'), { recursive: true });
    writeFileSync(join(dirA, '.git', 'config'), 'some git internals');
    const after = await computeSkillIntegrity(dirA);
    expect(before).toBe(after);
  });

  it('excludes .DS_Store files from hashing, including nested ones', async () => {
    writeSkill(dirA, { 'scripts/run.sh': 'echo hi' });
    const before = await computeSkillIntegrity(dirA);
    writeFileSync(join(dirA, '.DS_Store'), 'mac metadata junk');
    writeFileSync(join(dirA, 'scripts', '.DS_Store'), 'mac metadata junk');
    const after = await computeSkillIntegrity(dirA);
    expect(before).toBe(after);
  });

  it('does NOT exclude other dotfiles: a .gitignore change is hashed like any other file', async () => {
    writeSkill(dirA, { 'manifest.json': '{}', '.gitignore': 'node_modules/' });
    const before = await computeSkillIntegrity(dirA);
    writeFileSync(join(dirA, '.gitignore'), 'dist/');
    const after = await computeSkillIntegrity(dirA);
    expect(before).not.toBe(after);
  });
});
