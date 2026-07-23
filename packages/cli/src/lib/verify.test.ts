import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeSkillIntegrity } from './integrity.js';
import { verifySkillIntegrity } from './verify.js';
import type { GoodBoyLockEntry } from './goodboy-file.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'goodboy-verify-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function lockEntry(integrity?: string): GoodBoyLockEntry {
  return { version: '1.0.0', resolved: dir, ...(integrity !== undefined ? { integrity } : {}) };
}

describe('verifySkillIntegrity()', () => {
  it('returns not-verified when there is no lock entry at all', async () => {
    writeFileSync(join(dir, 'SKILL.md'), '# Test');
    const state = await verifySkillIntegrity(dir, null);
    expect(state).toBe('not-verified');
  });

  it('returns not-verified when the lock entry has no integrity field (pre-integrity install)', async () => {
    writeFileSync(join(dir, 'SKILL.md'), '# Test');
    const state = await verifySkillIntegrity(dir, lockEntry());
    expect(state).toBe('not-verified');
  });

  it('returns verified when the installed content matches the recorded hash', async () => {
    writeFileSync(join(dir, 'SKILL.md'), '# Test');
    writeFileSync(join(dir, 'manifest.json'), '{"name":"test"}');
    const integrity = await computeSkillIntegrity(dir);
    const state = await verifySkillIntegrity(dir, lockEntry(integrity));
    expect(state).toBe('verified');
  });

  it('returns mismatch when a file changes after the hash was recorded', async () => {
    writeFileSync(join(dir, 'SKILL.md'), '# Test');
    const integrity = await computeSkillIntegrity(dir);
    writeFileSync(join(dir, 'SKILL.md'), '# Tampered');
    const state = await verifySkillIntegrity(dir, lockEntry(integrity));
    expect(state).toBe('mismatch');
  });

  it('returns mismatch when an internal symlink is retargeted after the hash was recorded', async () => {
    writeFileSync(join(dir, 'SKILL.md'), '# Test');
    writeFileSync(join(dir, 'other.md'), '# Other');
    symlinkSync('SKILL.md', join(dir, 'link'));
    const integrity = await computeSkillIntegrity(dir);

    rmSync(join(dir, 'link'));
    symlinkSync('other.md', join(dir, 'link'));

    const state = await verifySkillIntegrity(dir, lockEntry(integrity));
    expect(state).toBe('mismatch');
  });

  it('returns mismatch when the recorded hash is simply stale/wrong', async () => {
    writeFileSync(join(dir, 'SKILL.md'), '# Test');
    const state = await verifySkillIntegrity(dir, lockEntry('sha256-not-a-real-hash=='));
    expect(state).toBe('mismatch');
  });
});
