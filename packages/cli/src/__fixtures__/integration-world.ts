import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface IntegrationWorld {
  projectDir: string;
  registryDir: string;
  originalCwd: string;
  originalRegistryEnv: string | undefined;
}

/**
 * An isolated world for one real-filesystem test: a temp project directory
 * (made the cwd) and a temp registry directory (set as GOODBOY_REGISTRY).
 * Single setup, single teardown; teardown restores cwd and env and removes
 * both temp dirs, and is always run from the test's afterEach so it fires
 * even when the test fails.
 *
 * The registry directory is created BEFORE the variable is set — a
 * nonexistent path makes getRegistryPath() warn and fall back silently to
 * the real ~/.goodboy/registry, which has polluted a live registry twice.
 * Making the path exist by construction makes that mistake impossible for
 * callers.
 *
 * Paths are realpath'd up front: mkdtempSync returns the tmpdir path as
 * written (on macOS /var/folders/…), while process.cwd() after chdir
 * returns the kernel-resolved form (/private/var/folders/…). Resolving
 * first keeps every assertion and every command-computed path on the same
 * string.
 */
export function createIntegrationWorld(): IntegrationWorld {
  const originalCwd = process.cwd();
  const originalRegistryEnv = process.env['GOODBOY_REGISTRY'];

  const projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'goodboy-project-')));
  const registryDir = realpathSync(mkdtempSync(join(tmpdir(), 'goodboy-registry-')));

  process.chdir(projectDir);
  process.env['GOODBOY_REGISTRY'] = registryDir;

  return { projectDir, registryDir, originalCwd, originalRegistryEnv };
}

export function destroyIntegrationWorld(world: IntegrationWorld): void {
  process.chdir(world.originalCwd);
  if (world.originalRegistryEnv === undefined) {
    delete process.env['GOODBOY_REGISTRY'];
  } else {
    process.env['GOODBOY_REGISTRY'] = world.originalRegistryEnv;
  }
  rmSync(world.projectDir, { recursive: true, force: true });
  rmSync(world.registryDir, { recursive: true, force: true });
}
