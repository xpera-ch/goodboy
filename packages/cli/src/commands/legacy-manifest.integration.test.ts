import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KNOWN_SCHEMA_VERSION } from '../lib/manifest.js';
import { loadFixture } from '../__fixtures__/index.js';
import { registerSkillStatus } from './skill-status.js';
import { listCommand } from './list.js';
import { resetCommandOptions } from '../__fixtures__/index.js';

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * F1/C7 regression, end-to-end. No mocks: a real manifest from the previous
 * schema major is written to a real directory and the real commands run
 * against it.
 *
 * This is the gap that let F1 ship. `manifest.test.ts` already covered the
 * version gate at unit level, but every fixture had been bulk-migrated to the
 * current major, so nothing exercised a real legacy skill reaching a command —
 * and `list` reported "No skills installed" to a user whose skills were all
 * present on disk.
 */
describe('a skill on the previous schema major, end-to-end', () => {
  let projectDir: string;
  let registryDir: string;
  let originalCwd: string;
  let originalRegistryEnv: string | undefined;
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  const legacy = loadFixture('legacy-v1-manifest') as Record<string, unknown>;
  const skillName = legacy['name'] as string;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalRegistryEnv = process.env['GOODBOY_REGISTRY'];

    projectDir = mkdtempSync(join(tmpdir(), 'goodboy-legacy-project-'));
    registryDir = mkdtempSync(join(tmpdir(), 'goodboy-legacy-registry-'));

    process.chdir(projectDir);
    process.env['GOODBOY_REGISTRY'] = registryDir;

    stdoutChunks = [];
    stderrChunks = [];
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    });

    resetCommandOptions(listCommand);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalRegistryEnv === undefined) {
      delete process.env['GOODBOY_REGISTRY'];
    } else {
      process.env['GOODBOY_REGISTRY'] = originalRegistryEnv;
    }
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(registryDir, { recursive: true, force: true });
  });

  function stdout(): string {
    return stripAnsi(stdoutChunks.join(''));
  }
  function stderr(): string {
    return stripAnsi(stderrChunks.join(''));
  }

  function installLegacySkill(): void {
    const installedDir = join(projectDir, '.claude', 'skills', skillName);
    mkdirSync(installedDir, { recursive: true });
    writeFileSync(join(installedDir, 'manifest.json'), JSON.stringify(legacy, null, 2) + '\n');
    writeFileSync(
      join(installedDir, 'SKILL.md'),
      `---\nname: ${skillName}\ndescription: legacy\n---\nBody`,
    );
    writeFileSync(
      join(projectDir, 'goodboy.json'),
      JSON.stringify({ schema: '1.0.0', skills: { [skillName]: '^0.2.0' } }) + '\n',
    );
  }

  // The structural guard. If a future schema major bulk-migrates the fixture
  // directory the way the 2.0.0 phase did, this fails immediately and loudly
  // rather than quietly removing the only end-to-end legacy coverage. When the
  // schema does major, ADD a new legacy fixture for the new previous major —
  // do not edit this one.
  it('the pinned fixture is exactly one major behind the current schema', () => {
    const fixtureMajor = Number(String(legacy['schema_version']).split('.')[0]);
    const knownMajor = Number(KNOWN_SCHEMA_VERSION.split('.')[0]);
    expect(fixtureMajor).toBe(knownMajor - 1);
  });

  it('goodboy list does not claim the user has no skills', async () => {
    installLegacySkill();

    await listCommand.parseAsync([], { from: 'user' });

    expect(stderr()).toContain(`Skipping "${skillName}" (project)`);
    expect(stderr()).toContain('supports 2.x manifests');
    expect(stdout()).not.toContain('No skills installed');
    expect(stderr()).not.toContain('No skills installed');
    expect(stderr()).toContain('installed but could not be read');
    // Names a remedy, not only the fault.
    expect(stdout()).toContain('goodboy add');
  });

  it('goodboy skill status reports the skill as unreadable, not absent', async () => {
    installLegacySkill();

    const program = new Command();
    registerSkillStatus(program);
    await program.parseAsync(['status'], { from: 'user' });

    expect(stdout()).toContain('unreadable');
    expect(stdout()).not.toContain('not installed');
    expect(stderr()).toContain('Installed but unreadable');
    expect(stderr()).toContain(skillName);
  });

  it('goodboy list still reports a genuinely empty project correctly', async () => {
    // The distinction the fix turns on: nothing there vs nothing readable.
    mkdirSync(join(projectDir, '.claude', 'skills'), { recursive: true });
    writeFileSync(
      join(projectDir, 'goodboy.json'),
      JSON.stringify({ schema: '1.0.0', skills: {} }) + '\n',
    );

    await listCommand.parseAsync([], { from: 'user' });

    expect(stdout()).toContain('No skills installed');
    expect(stderr()).not.toContain('could not be read');
  });
});
