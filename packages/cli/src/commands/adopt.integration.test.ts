import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { adoptCommand } from './adopt.js';
import {
  resetCommandOptions,
  createIntegrationWorld,
  destroyIntegrationWorld,
} from '../__fixtures__/index.js';
import type { IntegrationWorld } from '../__fixtures__/integration-world.js';

// No mocks anywhere in this file: adopt's purpose is a filesystem effect
// (the registry gains a version; the source is untouched), so the effect is
// asserted on a real filesystem. The mocked suite keeps the error branches
// and the 100% pin on adopt.ts; this tier proves the wiring
// (CONTRIBUTING.md, "A filesystem command's effect is asserted on a real
// filesystem").
describe('goodboy adopt — real filesystem', () => {
  let world: IntegrationWorld;

  beforeEach(() => {
    resetCommandOptions(adoptCommand);
    world = createIntegrationWorld();
  });

  afterEach(() => {
    destroyIntegrationWorld(world);
  });

  // A source skill with frontmatter name equal to the directory name, and
  // the license declared in frontmatter so --license is not needed
  // non-interactively (the adopt non-TTY gate requires --author and --yes).
  function writeSkillSource(parentDir: string, name: string): void {
    const sourceDir = join(parentDir, name);
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(
      join(sourceDir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: A real-fs integration skill\nlicense: MIT\n---\n\nSkill body`,
    );
  }

  it('adopts from the parent directory when the frontmatter name equals the directory name — the collision regression mocks could not see', async () => {
    const name = 'collision-skill';
    const sourceDir = join(world.projectDir, name);
    writeSkillSource(world.projectDir, name);

    // Run from the parent, path argument relative, exactly the case that
    // failed 100% of the time when cwd and fs were mocked: source and
    // target coincided and the run fell over.
    await adoptCommand.parseAsync([name, '--author', 'Test Author', '--yes'], { from: 'user' });

    // The registry gained a version containing SKILL.md AND a synthesised
    // manifest.json.
    const versionDir = join(world.registryDir, name, 'versions', '0.1.0');
    expect(existsSync(join(versionDir, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(versionDir, 'manifest.json'))).toBe(true);
    const written = JSON.parse(readFileSync(join(versionDir, 'manifest.json'), 'utf-8'));
    expect(written.name).toBe(name);
    expect(written.version).toBe('0.1.0');
    expect(written.author.name).toBe('Test Author');
    expect(written.license).toBe('MIT');

    // registry-entry.json records the version.
    const entry = JSON.parse(
      readFileSync(join(world.registryDir, name, 'registry-entry.json'), 'utf-8'),
    );
    expect(entry.latest).toBe('0.1.0');
    expect(entry.versions['0.1.0'].path).toBe('versions/0.1.0');

    // The source directory still has no manifest.json — adopt synthesises
    // the manifest into the registry copy, never into the source.
    expect(existsSync(join(sourceDir, 'manifest.json'))).toBe(false);
  });

  it('leaves the source directory untouched — no manifest.json appears and no copy lands in the cwd', async () => {
    const name = 'untouched-skill';
    const sourceDir = join(world.projectDir, name);
    writeSkillSource(world.projectDir, name);

    await adoptCommand.parseAsync([name, '--author', 'Test Author', '--yes'], { from: 'user' });

    expect(existsSync(join(sourceDir, 'manifest.json'))).toBe(false);
    // The parent directory (the cwd) contains only the source skill — no
    // copy or manifest was dropped next to it.
    expect(readdirSync(world.projectDir).sort()).toEqual([name]);
  });
});

// The fixture helper's isolation, proven rather than assumed: a leaking
// fixture (unrestored cwd/env, undeleted temp dirs) would corrupt later
// tests silently. The first test leaves its world active; the second
// asserts that the first's teardown restored everything.
describe('integration world — teardown restores everything', () => {
  let originalCwd: string;
  let originalRegistryEnv: string | undefined;
  let tempDirs: string[] = [];
  let world: IntegrationWorld | undefined;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalRegistryEnv = process.env['GOODBOY_REGISTRY'];
    world = undefined;
  });

  afterEach(() => {
    if (world) destroyIntegrationWorld(world);
  });

  it('provides an isolated real world for one test', () => {
    world = createIntegrationWorld();
    tempDirs = [world.projectDir, world.registryDir];
    expect(process.cwd()).toBe(world.projectDir);
    expect(process.env['GOODBOY_REGISTRY']).toBe(world.registryDir);
    expect(existsSync(world.registryDir)).toBe(true);
  });

  it('after the previous test, cwd and env are restored and the temp dirs are gone', () => {
    expect(process.cwd()).toBe(originalCwd);
    expect(process.env['GOODBOY_REGISTRY']).toBe(originalRegistryEnv);
    for (const dir of tempDirs) {
      expect(existsSync(dir)).toBe(false);
    }
  });
});
