import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resetCommandOptions,
  createIntegrationWorld,
  destroyIntegrationWorld,
} from '../__fixtures__/index.js';
import type { IntegrationWorld } from '../__fixtures__/integration-world.js';

// The global-scope test needs a temp HOME: the store (~/.goodboy/skills/)
// and the agent symlink directories are all derived from os.homedir(), and
// HOME must be redirected BEFORE the command module is imported —
// AGENT_SKILL_DIRS (lib/agents.ts) is computed at import time. Hence the
// dynamic import, and hence HOME stays redirected for this file's lifetime
// and is restored in afterAll. The path is realpath'd so every assertion
// compares resolved paths (see integration-world.ts for why).
const originalHome = process.env['HOME'];
const homeDir = realpathSync(mkdtempSync(join(tmpdir(), 'goodboy-home-')));
process.env['HOME'] = homeDir;
const { installCommand } = await import('./install.js');

// A registry seed: one version of a skill with a manifest that declares NO
// permissions — requestConsent() returns true without prompting for such a
// manifest, which is the install path that needs no TTY and no mock.
function seedRegistry(registryDir: string, name: string, version: string): void {
  const versionDir = join(registryDir, name, 'versions', version);
  mkdirSync(versionDir, { recursive: true });
  writeFileSync(
    join(versionDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: A registry skill for integration tests\n---\n\nSkill body`,
  );
  writeFileSync(
    join(versionDir, 'manifest.json'),
    JSON.stringify({
      name,
      version,
      description: 'A registry skill for integration tests',
      author: { name: 'Test Author' },
      license: 'MIT',
      schema_version: '2.0.0',
      status: 'experimental',
    }),
  );
  writeFileSync(
    join(registryDir, name, 'registry-entry.json'),
    JSON.stringify({
      name,
      latest: version,
      versions: {
        [version]: { path: `versions/${version}`, addedAt: new Date().toISOString(), yanked: false },
      },
    }),
  );
}

// No mocks anywhere in this file: install's purpose is a filesystem effect
// (files land in the project or the store, symlinks land where agents read
// them), so the effect is asserted on a real filesystem — see
// CONTRIBUTING.md, "A filesystem command's effect is asserted on a real
// filesystem".
describe('goodboy install — project scope, real filesystem', () => {
  let world: IntegrationWorld;

  beforeEach(() => {
    resetCommandOptions(installCommand);
    world = createIntegrationWorld();
  });

  afterEach(() => {
    destroyIntegrationWorld(world);
  });

  it('installs a skill from the registry into the project: files land on disk and goodboy.json/lock record it', async () => {
    const name = 'proj-skill';
    const version = '1.0.0';
    seedRegistry(world.registryDir, name, version);

    await installCommand.parseAsync([name], { from: 'user' });

    const installedDir = join(world.projectDir, '.claude', 'skills', name);
    expect(existsSync(join(installedDir, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(installedDir, 'manifest.json'))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(world.projectDir, 'goodboy.json'), 'utf-8'));
    expect(manifest.skills[name]).toBe('^1.0.0');

    const lock = JSON.parse(readFileSync(join(world.projectDir, 'goodboy.lock'), 'utf-8'));
    expect(lock.skills[name].version).toBe('1.0.0');
    expect(typeof lock.skills[name].integrity).toBe('string');
  });
});

describe('goodboy install — global scope, real filesystem', () => {
  let world: IntegrationWorld;

  beforeEach(() => {
    resetCommandOptions(installCommand);
    world = createIntegrationWorld();
  });

  afterEach(() => {
    destroyIntegrationWorld(world);
  });

  it('links the store copy into the directories the agent actually reads, and the symlinks resolve to the store copy', async () => {
    const name = 'global-skill';
    const version = '1.0.0';
    seedRegistry(world.registryDir, name, version);

    await installCommand.parseAsync([name, '--global', '--codex'], { from: 'user' });

    const storePath = join(homeDir, '.goodboy', 'skills', name);
    expect(existsSync(join(storePath, 'SKILL.md'))).toBe(true);

    // The two directories --codex maps to (AGENT_SKILL_DIRS['codex']):
    // ~/.agents/skills and ~/.codex/skills. Assert the RESOLVED target,
    // not mere existence — an existence check at the constant-named path is
    // exactly the assertion that passed while --codex wrote to a directory
    // Codex never read.
    for (const agentDir of [
      join(homeDir, '.agents', 'skills'),
      join(homeDir, '.codex', 'skills'),
    ]) {
      const link = join(agentDir, name);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(realpathSync(link)).toBe(storePath);
    }

    const manifest = JSON.parse(readFileSync(join(homeDir, '.goodboy', 'goodboy.json'), 'utf-8'));
    expect(manifest.skills[name]).toBe('^1.0.0');

    const lock = JSON.parse(readFileSync(join(homeDir, '.goodboy', 'goodboy.lock'), 'utf-8'));
    expect(lock.skills[name].version).toBe('1.0.0');
  });
});

afterAll(() => {
  if (originalHome === undefined) {
    delete process.env['HOME'];
  } else {
    process.env['HOME'] = originalHome;
  }
  rmSync(homeDir, { recursive: true, force: true });
});
