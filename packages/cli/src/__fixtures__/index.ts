import { createRequire } from 'node:module';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Command } from 'commander';

const _require = createRequire(import.meta.url);

export function resetCommandOptions(command: Command): void {
  // Command instances are module-level singletons, and commander keeps the
  // values it parsed on the instance — a later parseAsync() that omits a
  // flag does NOT clear what an earlier one set. Without this, parsing
  // ['-g'] in one test leaves global:true visible to every later test that
  // parses [], which is order-dependent and silently inverts negative
  // assertions. vi.clearAllMocks() cannot reach this: it is commander's
  // own state, not a mock's.
  //
  // Recurses into subcommands because commander stores a subcommand's
  // parsed values on the CHILD, not the parent: after parsing
  // ['version', 'x', '--bump', 'patch'], parent.opts() is {} while
  // child.opts() is { bump: 'patch' }. Walking only the top-level
  // command's own options would leave that untouched.
  for (const option of command.options) {
    command.setOptionValue(option.attributeName(), undefined);
  }
  for (const subcommand of command.commands) {
    resetCommandOptions(subcommand);
  }
}

export function loadFixture(name: string): unknown {
  return _require(`./${name}.json`) as unknown;
}

export function generateOversizedManifest(): string {
  // Produces a JSON string that exceeds the 512 KB size limit.
  // The description field is padded with spaces to inflate the payload.
  // The resulting object is NOT a valid manifest (description too long for schema),
  // but the size check in readManifest() fires before schema validation.
  const base = {
    name: 'test-skill',
    version: '0.1.0',
    description: 'x'.repeat(600 * 1024),
    author: { name: 'Test Author' },
    license: 'MIT',
    schema_version: '2.0.0',
    status: 'experimental',
  };
  return JSON.stringify(base);
}

export { createIntegrationWorld, destroyIntegrationWorld } from './integration-world.js';
export type { IntegrationWorld } from './integration-world.js';

export function createTempDir(): string {
  const dir = join(tmpdir(), `goodboy-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export function writeTempManifest(dir: string, content: unknown): string {
  const path = join(dir, 'manifest.json');
  writeFileSync(path, JSON.stringify(content, null, 2) + '\n', 'utf-8');
  return path;
}
