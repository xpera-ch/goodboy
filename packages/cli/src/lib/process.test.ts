import { describe, it, expect } from 'vitest';
import { runCapture, runInherit, MAX_CAPTURE_BYTES } from './process.js';

const NODE = process.execPath;

describe('runCapture()', () => {
  it('returns captured stdout/stderr and exit code 0 on a successful run', async () => {
    const result = await runCapture(NODE, [
      '-e',
      "console.log('hello stdout'); console.error('hello stderr')",
    ]);

    expect(result.stdout).toContain('hello stdout');
    expect(result.stderr).toContain('hello stderr');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.aborted).toBe(false);
    expect(result.truncated).toBe(false);
  });

  it('reports a non-zero exit code without rejecting', async () => {
    const result = await runCapture(NODE, ['-e', 'process.exit(7)']);

    expect(result.exitCode).toBe(7);
    expect(result.timedOut).toBe(false);
    expect(result.aborted).toBe(false);
  });

  it('reports timedOut and does not hang when the child exceeds timeoutMs', async () => {
    const result = await runCapture(NODE, ['-e', 'setTimeout(() => {}, 5000)'], {
      timeoutMs: 100,
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.aborted).toBe(false);
  });

  it('reports aborted when an externally-triggered AbortSignal cancels the child', async () => {
    const controller = new AbortController();
    const resultPromise = runCapture(NODE, ['-e', 'setTimeout(() => {}, 5000)'], {
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(), 50);

    const result = await resultPromise;

    expect(result.aborted).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.timedOut).toBe(false);
  });

  it('truncates and reports truncated:true when output exceeds the 1 MiB cap, instead of throwing', async () => {
    const result = await runCapture(NODE, [
      '-e',
      `process.stdout.write('a'.repeat(${MAX_CAPTURE_BYTES * 2}))`,
    ]);

    expect(result.truncated).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.stdout.length).toBeLessThanOrEqual(MAX_CAPTURE_BYTES);
  });

  it('rejects on a genuine invocation failure (command does not exist)', async () => {
    await expect(
      runCapture('goodboy-process-test-command-that-does-not-exist-xyz', []),
    ).rejects.toThrow();
  });

  it('never interprets shell metacharacters in an argument — passed through literally, not executed', async () => {
    const payload = '; rm -rf /tmp/probe && echo pwned';
    const result = await runCapture(NODE, [
      '-e',
      'console.log(process.argv[1])',
      payload,
    ]);

    expect(result.stdout.trim()).toBe(payload);
    expect(result.exitCode).toBe(0);
  });
});

describe('runInherit()', () => {
  it('passes through the child exit code', async () => {
    const result = await runInherit(NODE, ['-e', 'process.exit(3)']);

    expect(result.exitCode).toBe(3);
    expect(result.signal).toBeNull();
  });

  it('rejects on a genuine invocation failure (command does not exist)', async () => {
    await expect(
      runInherit('goodboy-process-test-command-that-does-not-exist-xyz', []),
    ).rejects.toThrow();
  });

  it('registers SIGINT/SIGTERM listeners while running and removes them once the child closes', async () => {
    const sigintBefore = process.listeners('SIGINT');
    const sigtermBefore = process.listeners('SIGTERM');

    const resultPromise = runInherit(NODE, ['-e', 'process.exit(0)']);
    await resultPromise;

    expect(process.listeners('SIGINT')).toEqual(sigintBefore);
    expect(process.listeners('SIGTERM')).toEqual(sigtermBefore);
  });

  it('forwards SIGINT to the running child, which then exits with that signal', async () => {
    // We deliberately invoke the registered handler directly rather than
    // process.emit('SIGINT', ...): emitting on `process` would run every
    // OTHER SIGINT listener too (including anything the test runner itself
    // installs), which could abort the whole test run. Grabbing and calling
    // just the listener runInherit registered proves the same wiring
    // (process signal -> child.kill(signal)) without that side effect.
    const before = process.listeners('SIGINT');
    const resultPromise = runInherit(NODE, ['-e', 'setTimeout(() => {}, 5000)']);

    // Let runInherit's spawn + listener registration complete.
    await new Promise((resolve) => setImmediate(resolve));

    const added = process.listeners('SIGINT').filter((l) => !before.includes(l));
    expect(added).toHaveLength(1);

    (added[0] as () => void)();

    const result = await resultPromise;
    expect(result.signal).toBe('SIGINT');
    expect(process.listeners('SIGINT')).toEqual(before);
  });
});
