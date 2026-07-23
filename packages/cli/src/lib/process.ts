import { execFile, spawn } from 'node:child_process';

// 1 MiB — matches D4's captured-output cap.
export const MAX_CAPTURE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface RunCaptureOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface RunCaptureResult {
  stdout: string;
  stderr: string;
  /** null when the process never produced a normal exit code (timeout, abort, or maxBuffer kill). */
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  /** true when captured stdout/stderr were cut off at MAX_CAPTURE_BYTES and the child was killed as a result. */
  truncated: boolean;
}

interface ExecFileLikeError extends Error {
  code?: string | number;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
}

/**
 * Runs `command` with `args` via execFile — never a shell, never a single
 * command string. Captures stdout/stderr up to MAX_CAPTURE_BYTES; a run that
 * exceeds that cap is killed and reported as truncated rather than left to
 * throw an opaque buffer-overflow error. A run exceeding `timeoutMs`, or
 * cancelled via `signal`, is reported cleanly (no hung process, no reject)
 * rather than surfaced as an exception — only a genuine invocation failure
 * (e.g. the command does not exist) rejects.
 */
export function runCapture(
  command: string,
  args: string[],
  options: RunCaptureOptions = {},
): Promise<RunCaptureResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolvePromise, reject) => {
    execFile(
      command,
      args,
      {
        shell: false,
        timeout: timeoutMs,
        signal: options.signal,
        maxBuffer: MAX_CAPTURE_BYTES,
        cwd: options.cwd,
        env: options.env,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolvePromise({ stdout, stderr, exitCode: 0, timedOut: false, aborted: false, truncated: false });
          return;
        }

        const err = error as ExecFileLikeError;

        if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          resolvePromise({
            stdout: stdout.slice(0, MAX_CAPTURE_BYTES),
            stderr: stderr.slice(0, MAX_CAPTURE_BYTES),
            exitCode: null,
            timedOut: false,
            aborted: false,
            truncated: true,
          });
          return;
        }

        if (err.code === 'ABORT_ERR' || err.name === 'AbortError') {
          resolvePromise({ stdout, stderr, exitCode: null, timedOut: false, aborted: true, truncated: false });
          return;
        }

        if (err.killed) {
          resolvePromise({ stdout, stderr, exitCode: null, timedOut: true, aborted: false, truncated: false });
          return;
        }

        if (typeof err.code === 'number') {
          resolvePromise({ stdout, stderr, exitCode: err.code, timedOut: false, aborted: false, truncated: false });
          return;
        }

        reject(error);
      },
    );
  });
}

export interface RunInheritOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RunInheritResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

/**
 * Runs `command` with `args` via spawn, inheriting stdio so the child's own
 * output/prompts go straight to the terminal. SIGINT/SIGTERM received by
 * this process are forwarded to the child; listeners are removed as soon as
 * the child exits so repeated calls never leak listeners. `shell: false` is
 * hard-coded, matching runCapture.
 */
export function runInherit(
  command: string,
  args: string[],
  options: RunInheritOptions = {},
): Promise<RunInheritResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: 'inherit',
      cwd: options.cwd,
      env: options.env,
    });

    const signalHandlers = new Map<NodeJS.Signals, () => void>();
    for (const signal of FORWARDED_SIGNALS) {
      const handler = (): void => {
        child.kill(signal);
      };
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }

    const cleanup = (): void => {
      for (const [signal, handler] of signalHandlers) {
        process.off(signal, handler);
      }
    };

    child.on('error', (err) => {
      cleanup();
      reject(err);
    });

    child.on('close', (code, signal) => {
      cleanup();
      resolvePromise({ exitCode: code, signal });
    });
  });
}
