import { execFile } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { logger } from './logger.js';
import type { GoodBoyManifest } from '../types/index.js';

const execFileAsync = promisify(execFile);

// All ASCII shell metacharacters that could enable command injection.
// execFile() bypasses the shell, but we also reject at string level as
// defense-in-depth so a malicious manifest cannot smuggle metacharacters.
const FORBIDDEN_CHARS = /[&|;`$(){}<>\\"'!#%^*?[\]~=\n\r\x00]/;
const MAX_HOOK_LENGTH = 256;
const MAX_ARGS = 10;

// Hook commands must start with one of these executables. Unknown binaries
// receive a prominent warning rather than an outright rejection because the
// whitelist cannot anticipate every legitimate runtime; FORBIDDEN_CHARS and
// execFile (no shell) remain the primary injection barriers.
const ALLOWED_BINARIES = new Set([
  'node', 'nodejs', 'python', 'python3', 'ruby', 'sh',
  'bash', 'zsh', 'deno', 'bun', 'ts-node', 'npx', 'pnpm',
  'yarn', 'pip', 'pip3', 'make', 'cargo', 'go', 'java',
  'mvn', 'gradle', './setup.sh', './install.sh',
  './postinstall.sh', './preinstall.sh',
]);

const ALLOWED_BINARIES_LIST = [...ALLOWED_BINARIES].sort().join(', ');

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

  if (args.length > MAX_ARGS) {
    throw new Error(`Hook command has too many arguments (max ${MAX_ARGS})`);
  }

  if (!ALLOWED_BINARIES.has(bin)) {
    logger.warn(
      `Hook binary "${bin}" is not in the GoodBoy allowed list. ` +
        `Allowed binaries: ${ALLOWED_BINARIES_LIST}`,
    );
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
    const command = manifest.hooks?.[hookName];
    if (command !== undefined) {
      await runHook(hookName, command, context);
    }
  }
}
