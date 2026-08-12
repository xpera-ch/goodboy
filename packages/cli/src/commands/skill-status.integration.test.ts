import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeSkillIntegrity } from '../lib/integrity.js';
import { registerSkillStatus } from './skill-status.js';

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

// No mocks anywhere in this file: this proves the real, wired-together behavior,
// not an assumption about how the mocked pieces would compose.
describe('goodboy skill status — real-file regression: whole-tree drift detection', () => {
  let projectDir: string;
  let registryDir: string;
  let originalCwd: string;
  let originalRegistryEnv: string | undefined;
  let stdoutChunks: string[];
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalRegistryEnv = process.env['GOODBOY_REGISTRY'];

    projectDir = mkdtempSync(join(tmpdir(), 'goodboy-status-project-'));
    registryDir = mkdtempSync(join(tmpdir(), 'goodboy-status-registry-'));

    process.chdir(projectDir);
    process.env['GOODBOY_REGISTRY'] = registryDir;

    stdoutChunks = [];
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalRegistryEnv === undefined) {
      delete process.env['GOODBOY_REGISTRY'];
    } else {
      process.env['GOODBOY_REGISTRY'] = originalRegistryEnv;
    }
    stdoutSpy.mockRestore();
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(registryDir, { recursive: true, force: true });
  });

  function tableOutput(): string {
    return stripAnsi(stdoutChunks.join(''));
  }

  it('reports "modified" when a non-SKILL.md file drifts — the old SKILL.md-only check would have missed this', async () => {
    const skillName = 'regression-skill';
    const version = '1.0.0';

    // Registry: a minimal registry-entry.json declaring this version as latest,
    // so the row lands in the drift-check branch rather than "upgrade available".
    mkdirSync(join(registryDir, skillName, 'versions', version), { recursive: true });
    writeFileSync(
      join(registryDir, skillName, 'registry-entry.json'),
      JSON.stringify({
        name: skillName,
        latest: version,
        versions: {
          [version]: { path: `versions/${version}`, addedAt: new Date().toISOString(), yanked: false },
        },
      }),
    );

    // Installed skill under .claude/skills/<name>/.
    const installedDir = join(projectDir, '.claude', 'skills', skillName);
    mkdirSync(join(installedDir, 'scripts'), { recursive: true });
    writeFileSync(
      join(installedDir, 'manifest.json'),
      JSON.stringify({
        name: skillName,
        version,
        description: 'A regression-test skill',
        author: { name: 'Test' },
        license: 'MIT',
        schema_version: '2.0.0',
        status: 'experimental',
      }),
    );
    writeFileSync(join(installedDir, 'SKILL.md'), '---\nname: regression-skill\ndescription: test\n---\nBody');
    writeFileSync(join(installedDir, 'scripts', 'run.sh'), 'echo original');

    // The real hash of the tree exactly as installed, before any tampering —
    // this is what install/upgrade would have recorded in goodboy.lock.
    const integrity = await computeSkillIntegrity(installedDir);

    writeFileSync(
      join(projectDir, 'goodboy.json'),
      JSON.stringify({ schema: '1.0.0', skills: { [skillName]: `^${version}` } }) + '\n',
    );
    writeFileSync(
      join(projectDir, 'goodboy.lock'),
      JSON.stringify({
        schema: '1.0.0',
        generated: new Date().toISOString(),
        skills: { [skillName]: { version, integrity } },
      }) + '\n',
    );

    // Tamper with a file that is NOT SKILL.md. The old check only ever diffed
    // SKILL.md against the registry copy, so it would have reported this
    // installed skill as "up to date".
    writeFileSync(join(installedDir, 'scripts', 'run.sh'), 'echo tampered');

    const program = new Command();
    registerSkillStatus(program);
    await program.parseAsync(['status'], { from: 'user' });

    expect(tableOutput()).toContain('modified');
  });
});
