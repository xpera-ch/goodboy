import { execFile } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { GoodBoyManifest } from '../types/index.js';

const execFileAsync = promisify(execFile);

// KNOWN LIMITATION (Phase 1): hooks run as the current user with full
// filesystem and network permissions. There is no sandboxing, chroot,
// capability dropping, or network egress filtering. Users must only install
// skills from sources they explicitly trust.
//
// KNOWN LIMITATION (Phase 1): the manifest is validated before any hook
// runs. The in-memory manifest object is the pre-hook validated copy and
// cannot be mutated by a hook, but files on disk can be changed by a
// preinstall hook before the directory is copied.

export interface HookContext {
  skillName: string;
  skillPath: string;
}

async function runHook(
  hookName: string,
  hookEntry: { script: string; args?: string[] },
  context: HookContext,
): Promise<void> {
  const resolvedScript = resolveHookPath(context.skillPath, hookEntry.script);
  const args = hookEntry.args ?? [];

  try {
    await execFileAsync(resolvedScript, args, {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      env: {
        PATH: process.env['PATH'],
        HOME: process.env['HOME'],
        /* c8 ignore next -- NODE_ENV is always set in test environments; fallback fires only in production */
        NODE_ENV: process.env['NODE_ENV'] ?? 'production',
      },
      windowsHide: true,
      cwd: context.skillPath,
    });
  } catch (err) {
    if (err instanceof Error) {
      const asNode = err as NodeJS.ErrnoException & {
        killed?: boolean;
        stderr?: string;
      };
      const isTimeout = asNode.killed === true || asNode.code === 'ETIMEDOUT';

      if (isTimeout) {
        throw new Error(`Hook "${hookName}" timed out after 30 seconds`);
      }

      let stderrSnippet: string;
      if (typeof asNode.stderr === 'string' && asNode.stderr.length > 0) {
        // Last 200 chars of stderr only — never expose stdout or stack traces
        stderrSnippet = asNode.stderr.slice(-200).trim();
      } else {
        /* c8 ignore next -- split() always returns ≥1 element, ?? fallback unreachable */
        stderrSnippet = asNode.message.split('\n')[0] ?? asNode.message;
      }
      throw new Error(`Hook "${hookName}" failed: ${stderrSnippet}`);
    }
    throw new Error(`Hook "${hookName}" failed`);
  }
}

export function resolveHookPath(skillDir: string, hookRelativePath: string): string {
  if (!hookRelativePath) {
    throw new Error('Hook path must not be empty');
  }
  if (hookRelativePath.startsWith('/')) {
    throw new Error('Hook path must be relative');
  }
  if (hookRelativePath.includes('\0')) {
    throw new Error('Hook path contains invalid characters');
  }

  const base = resolve(skillDir);
  const resolved = resolve(base, hookRelativePath);

  if (!resolved.startsWith(base + sep)) {
    throw new Error('Hook path escapes the skill directory');
  }

  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(resolved);
  } catch {
    throw new Error('Hook script not found');
  }

  if (stat.isSymbolicLink()) {
    throw new Error('Hook path must not be a symbolic link');
  }
  if (!stat.isFile()) {
    throw new Error('Hook path is not a regular file');
  }

  return resolved;
}

export async function runHooks(
  manifest: GoodBoyManifest,
  hookNames: Array<'preinstall' | 'postinstall' | 'preremove' | 'postremove'>,
  context: HookContext,
): Promise<void> {
  for (const hookName of hookNames) {
    const hookEntry = manifest.hooks?.[hookName];
    if (hookEntry !== undefined) {
      await runHook(hookName, hookEntry, context);
    }
  }
}
