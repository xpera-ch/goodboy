import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GoodBoyManifest } from '../types/index.js';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('node:fs');

import { execFile } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { runHooks, resolveHookPath } from './hooks.js';

const mockExecFile = vi.mocked(execFile);
const mockLstatSync = vi.mocked(lstatSync);

type ExecutableManifest = Extract<GoodBoyManifest, { kind: 'executable' }>;

const BASE: ExecutableManifest = {
  kind: 'executable',
  name: 'test-skill',
  version: '0.1.0',
  description: 'Test skill',
  author: { name: 'Test Author' },
  license: 'MIT',
  entry: 'index.ts',
  language: 'typescript',
  hooks: {},
  schema_version: '1.0.0',
  status: 'experimental',
};

const CTX = { skillName: 'test-skill', skillPath: '/tmp/test-skill' };

function withHook(
  hookName: keyof NonNullable<ExecutableManifest['hooks']>,
  entry: { script: string; args?: string[] },
): ExecutableManifest {
  return { ...BASE, hooks: { [hookName]: entry } };
}

const FAKE_STAT = { isSymbolicLink: () => false, isFile: () => true };

function setupSuccess(): void {
  mockLstatSync.mockReturnValue(FAKE_STAT as unknown as ReturnType<typeof lstatSync>);
  mockExecFile.mockImplementation((...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') cb(null, '', '');
    return undefined as unknown as ReturnType<typeof execFile>;
  });
}

function setupFailure(message: string): void {
  mockLstatSync.mockReturnValue(FAKE_STAT as unknown as ReturnType<typeof lstatSync>);
  mockExecFile.mockImplementation((...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') cb(new Error(message));
    return undefined as unknown as ReturnType<typeof execFile>;
  });
}

function setupTimeout(useKilled = true): void {
  mockLstatSync.mockReturnValue(FAKE_STAT as unknown as ReturnType<typeof lstatSync>);
  mockExecFile.mockImplementation((...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') {
      const err = Object.assign(new Error('Process killed'), {
        killed: useKilled,
        code: useKilled ? undefined : 'ETIMEDOUT',
      });
      cb(err);
    }
    return undefined as unknown as ReturnType<typeof execFile>;
  });
}

function setupNonErrorThrow(): void {
  mockLstatSync.mockReturnValue(FAKE_STAT as unknown as ReturnType<typeof lstatSync>);
  mockExecFile.mockImplementation((...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') cb('string error, not an Error instance');
    return undefined as unknown as ReturnType<typeof execFile>;
  });
}

// ---------------------------------------------------------------------------
// Execution dispatch — what runHooks calls and how errors are mapped
// ---------------------------------------------------------------------------

describe('runHooks() — execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips hooks not listed in hookNames', async () => {
    setupSuccess();
    const manifest = withHook('preinstall', { script: 'hooks/run.sh' });
    await runHooks(manifest, ['postinstall'], CTX);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('does nothing when the manifest has no hooks object', async () => {
    await runHooks(BASE, ['postinstall'], CTX);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('does nothing when the requested hook is not defined on the manifest', async () => {
    const manifest: ExecutableManifest = { ...BASE, hooks: { preinstall: { script: 'hooks/run.sh' } } };
    await runHooks(manifest, ['postinstall'], CTX);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('calls execFile with the resolved absolute path and args array', async () => {
    setupSuccess();
    await runHooks(
      withHook('postinstall', { script: 'hooks/run.sh', args: ['--flag', 'value'] }),
      ['postinstall'],
      CTX,
    );
    expect(mockExecFile).toHaveBeenCalledWith(
      `${CTX.skillPath}/hooks/run.sh`,
      ['--flag', 'value'],
      expect.objectContaining({ timeout: 30_000, cwd: CTX.skillPath }),
      expect.any(Function),
    );
  });

  it('calls execFile with cwd set to context.skillPath', async () => {
    setupSuccess();
    const ctx = { skillName: 'my-skill', skillPath: '/custom/path' };
    await runHooks(withHook('postinstall', { script: 'hooks/setup.sh' }), ['postinstall'], ctx);
    expect(mockExecFile).toHaveBeenCalledWith(
      '/custom/path/hooks/setup.sh',
      [],
      expect.objectContaining({ cwd: '/custom/path' }),
      expect.any(Function),
    );
  });

  it('calls execFile with a 30-second timeout', async () => {
    setupSuccess();
    await runHooks(withHook('postinstall', { script: 'hooks/run.sh' }), ['postinstall'], CTX);
    expect(mockExecFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ timeout: 30_000 }),
      expect.any(Function),
    );
  });

  it('runs multiple hooks in the order specified by hookNames', async () => {
    mockLstatSync.mockReturnValue(FAKE_STAT as unknown as ReturnType<typeof lstatSync>);
    const calls: string[] = [];
    mockExecFile.mockImplementation((...args: any[]) => {
      calls.push(args[0] as string);
      const cb = args[args.length - 1];
      if (typeof cb === 'function') cb(null, '', '');
      return undefined as unknown as ReturnType<typeof execFile>;
    });
    const manifest: ExecutableManifest = {
      ...BASE,
      hooks: {
        preinstall: { script: 'hooks/first.sh' },
        postinstall: { script: 'hooks/second.sh' },
      },
    };
    await runHooks(manifest, ['preinstall', 'postinstall'], CTX);
    expect(calls).toEqual([
      `${CTX.skillPath}/hooks/first.sh`,
      `${CTX.skillPath}/hooks/second.sh`,
    ]);
  });

  it('resolves without calling execFile when hookNames is empty', async () => {
    await runHooks(withHook('postinstall', { script: 'hooks/run.sh' }), [], CTX);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('throws `Hook "X" failed: <first line>` on non-timeout failure', async () => {
    setupFailure('command not found\nat some stack frame');
    await expect(runHooks(withHook('postinstall', { script: 'hooks/run.sh' }), ['postinstall'], CTX))
      .rejects.toThrow('Hook "postinstall" failed: command not found');
  });

  it('does not expose inner stack trace lines in failure messages', async () => {
    setupFailure('first line\n    at Object.<anonymous> (hidden.js:1)\n    at ...more');
    const err = await runHooks(withHook('postinstall', { script: 'hooks/run.sh' }), ['postinstall'], CTX)
      .catch((e: unknown) => e as Error);
    expect((err as Error).message).not.toContain('at Object');
    expect((err as Error).message).not.toContain('hidden.js');
  });

  it('throws `Hook "X" timed out` when killed:true', async () => {
    setupTimeout(true);
    await expect(runHooks(withHook('postinstall', { script: 'hooks/run.sh' }), ['postinstall'], CTX))
      .rejects.toThrow('Hook "postinstall" timed out after 30 seconds');
  });

  it('throws `Hook "X" timed out` when code is ETIMEDOUT', async () => {
    setupTimeout(false);
    await expect(runHooks(withHook('postinstall', { script: 'hooks/run.sh' }), ['postinstall'], CTX))
      .rejects.toThrow('Hook "postinstall" timed out after 30 seconds');
  });

  it('throws `Hook "X" failed` when a non-Error is thrown', async () => {
    setupNonErrorThrow();
    await expect(runHooks(withHook('postinstall', { script: 'hooks/run.sh' }), ['postinstall'], CTX))
      .rejects.toThrow('Hook "postinstall" failed');
  });

  it('stops execution after the first failing hook', async () => {
    setupFailure('first hook failed');
    const manifest: ExecutableManifest = {
      ...BASE,
      hooks: {
        preinstall: { script: 'hooks/first.sh' },
        postinstall: { script: 'hooks/second.sh' },
      },
    };
    await runHooks(manifest, ['preinstall', 'postinstall'], CTX).catch(() => {});
    expect(mockExecFile).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Structured hook execution — verifies { script, args } model
// ---------------------------------------------------------------------------

describe('runHooks() — structured hook execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls resolveHookPath unconditionally for every hook', async () => {
    setupSuccess();
    await runHooks(withHook('postinstall', { script: 'hooks/run.sh' }), ['postinstall'], CTX);
    expect(mockLstatSync).toHaveBeenCalledWith(`${CTX.skillPath}/hooks/run.sh`);
  });

  it('resolves a flat hooks/<name>.sh script correctly', async () => {
    setupSuccess();
    await runHooks(withHook('postinstall', { script: 'hooks/setup.sh' }), ['postinstall'], CTX);
    expect(mockLstatSync).toHaveBeenCalledWith(`${CTX.skillPath}/hooks/setup.sh`);
    expect(mockExecFile).toHaveBeenCalledWith(
      `${CTX.skillPath}/hooks/setup.sh`,
      [],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('resolves a nested hooks/lifecycle/setup.sh script correctly', async () => {
    setupSuccess();
    await runHooks(
      withHook('postinstall', { script: 'hooks/lifecycle/setup.sh' }),
      ['postinstall'],
      CTX,
    );
    expect(mockLstatSync).toHaveBeenCalledWith(`${CTX.skillPath}/hooks/lifecycle/setup.sh`);
    expect(mockExecFile).toHaveBeenCalledWith(
      `${CTX.skillPath}/hooks/lifecycle/setup.sh`,
      [],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('passes args array directly to execFile without joining or modifying', async () => {
    setupSuccess();
    await runHooks(
      withHook('postinstall', { script: 'hooks/run.sh', args: ['--mode', 'prod', '--flag'] }),
      ['postinstall'],
      CTX,
    );
    expect(mockExecFile).toHaveBeenCalledWith(
      `${CTX.skillPath}/hooks/run.sh`,
      ['--mode', 'prod', '--flag'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('uses an empty args array when the args field is absent', async () => {
    setupSuccess();
    await runHooks(withHook('postinstall', { script: 'hooks/run.sh' }), ['postinstall'], CTX);
    expect(mockExecFile).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('rejects a symlinked hook script before execFile is called', async () => {
    mockLstatSync.mockReturnValue(
      { isSymbolicLink: () => true, isFile: () => false } as unknown as ReturnType<typeof lstatSync>,
    );
    await expect(
      runHooks(withHook('postinstall', { script: 'hooks/run.sh' }), ['postinstall'], CTX),
    ).rejects.toThrow('Hook path must not be a symbolic link');
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// execFile options hardening
// ---------------------------------------------------------------------------

describe('runHooks() — execFile options hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls execFile with maxBuffer of 1 MiB', async () => {
    setupSuccess();
    await runHooks(withHook('postinstall', { script: 'hooks/run.sh' }), ['postinstall'], CTX);
    expect(mockExecFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ maxBuffer: 1024 * 1024 }),
      expect.any(Function),
    );
  });

  it('calls execFile with windowsHide: true', async () => {
    setupSuccess();
    await runHooks(withHook('postinstall', { script: 'hooks/run.sh' }), ['postinstall'], CTX);
    expect(mockExecFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function),
    );
  });

  it('calls execFile with a minimal env containing NODE_ENV', async () => {
    setupSuccess();
    await runHooks(withHook('postinstall', { script: 'hooks/run.sh' }), ['postinstall'], CTX);
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

// ---------------------------------------------------------------------------
// Hook output handling
// ---------------------------------------------------------------------------

describe('runHooks() — hook output handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows last 200 chars of stderr on failure', async () => {
    const stderrContent = 'Error: permission denied reading config';
    mockLstatSync.mockReturnValue(FAKE_STAT as unknown as ReturnType<typeof lstatSync>);
    mockExecFile.mockImplementation((...args: any[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === 'function') {
        cb(Object.assign(new Error('Command failed'), { stderr: stderrContent }));
      }
      return undefined as unknown as ReturnType<typeof execFile>;
    });
    const err = await runHooks(withHook('postinstall', { script: 'hooks/run.sh' }), ['postinstall'], CTX)
      .catch((e: unknown) => e as Error);
    expect((err as Error).message).toContain(stderrContent);
  });

  it('truncates stderr to the last 200 characters on failure', async () => {
    const longStderr = 'x'.repeat(300);
    mockLstatSync.mockReturnValue(FAKE_STAT as unknown as ReturnType<typeof lstatSync>);
    mockExecFile.mockImplementation((...args: any[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === 'function') {
        cb(Object.assign(new Error('Command failed'), { stderr: longStderr }));
      }
      return undefined as unknown as ReturnType<typeof execFile>;
    });
    const err = await runHooks(withHook('postinstall', { script: 'hooks/run.sh' }), ['postinstall'], CTX)
      .catch((e: unknown) => e as Error);
    expect((err as Error).message.length).toBeLessThan(300);
    expect((err as Error).message).toContain('x'.repeat(200));
  });

  it('falls back to first line of error.message when no stderr present', async () => {
    setupFailure('first line\n    at stack frame');
    const err = await runHooks(withHook('postinstall', { script: 'hooks/run.sh' }), ['postinstall'], CTX)
      .catch((e: unknown) => e as Error);
    expect((err as Error).message).toContain('first line');
    expect((err as Error).message).not.toContain('at stack frame');
  });

  it('falls back to error.message when stderr is present but empty', async () => {
    mockLstatSync.mockReturnValue(FAKE_STAT as unknown as ReturnType<typeof lstatSync>);
    mockExecFile.mockImplementation((...args: any[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === 'function') {
        cb(Object.assign(new Error('command failed'), { stderr: '' }));
      }
      return undefined as unknown as ReturnType<typeof execFile>;
    });
    const err = await runHooks(withHook('postinstall', { script: 'hooks/run.sh' }), ['postinstall'], CTX)
      .catch((e: unknown) => e as Error);
    expect((err as Error).message).toContain('command failed');
  });
});

// ---------------------------------------------------------------------------
// resolveHookPath() — standalone path validation and traversal guard
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
    // Schema pattern makes this impossible via manifest, but resolveHookPath is the runtime boundary
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
