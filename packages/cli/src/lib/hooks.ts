import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GoodBoyManifest } from '../types/index.js';

const execFileAsync = promisify(execFile);

// Shell metacharacters that must never appear in a hook command string.
// execFile bypasses the shell entirely, but we also reject the raw string
// so a malicious manifest cannot smuggle in metacharacters at all.
const FORBIDDEN_CHARS = /[&|;`$(){}<>\\"']/;
const MAX_HOOK_LENGTH = 256;

// KNOWN LIMITATION (Phase 1): hooks run as the current user with full
// filesystem and network permissions. There is no sandboxing, chroot,
// capability dropping, or network egress filtering. Users must only
// install skills from sources they explicitly trust. Proper sandboxing
// is deferred to a future phase.
//
// KNOWN LIMITATION (Phase 1): the manifest is validated before any hook
// runs, but the hook itself executes from the filesystem and could in
// theory modify the skill directory on disk. The in-memory manifest
// object used throughout install is the pre-hook validated copy and
// cannot be mutated by a hook, but files on disk (including manifest.json)
// can be changed by a preinstall hook before the directory is copied.

export interface HookContext {
  skillName: string;
  skillPath: string;
}

function parseHookCommand(command: string): { bin: string; args: string[] } {
  if (command.length > MAX_HOOK_LENGTH) {
    throw new Error(
      `Hook command exceeds the maximum allowed length of ${MAX_HOOK_LENGTH} characters`,
    );
  }

  if (FORBIDDEN_CHARS.test(command)) {
    throw new Error(`Hook command contains forbidden shell metacharacters`);
  }

  const parts = command.trim().split(/\s+/);
  const bin = parts[0];
  const args = parts.slice(1);

  if (!bin) {
    throw new Error('Hook command is empty');
  }

  return { bin, args };
}

async function runHook(
  hookName: string,
  command: string,
  context: HookContext,
): Promise<void> {
  const { bin, args } = parseHookCommand(command);

  try {
    await execFileAsync(bin, args, {
      timeout: 30_000,
      cwd: context.skillPath,
    });
  } catch (err) {
    if (err instanceof Error) {
      const asNode = err as NodeJS.ErrnoException & { killed?: boolean };
      const isTimeout = asNode.killed === true || asNode.code === 'ETIMEDOUT';

      if (isTimeout) {
        throw new Error(`Hook "${hookName}" timed out after 30 seconds`);
      }

      // First line only — never expose raw stack traces to the user
      /* c8 ignore next -- split() always returns ≥1 element, making the ?? fallback unreachable */
      const firstLine = asNode.message.split('\n')[0] ?? asNode.message;
      throw new Error(`Hook "${hookName}" failed: ${firstLine}`);
    }
    throw new Error(`Hook "${hookName}" failed`);
  }
}

export async function runHooks(
  manifest: GoodBoyManifest,
  hookNames: Array<'preinstall' | 'postinstall' | 'preremove' | 'postremove'>,
  context: HookContext,
): Promise<void> {
  for (const hookName of hookNames) {
    const command = manifest.hooks?.[hookName];
    if (command !== undefined) {
      await runHook(hookName, command, context);
    }
  }
}
