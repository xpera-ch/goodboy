import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('chalk', () => ({
  default: {
    gray: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
  },
}));

import { homedir } from 'node:os';
import { registerSecret, clearRegisteredSecrets } from './redact.js';
import { logger, sanitiseError } from './logger.js';

const METHODS = ['info', 'success', 'warn', 'error'] as const;

function captureWrites(stream: 'stdout' | 'stderr'): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const spy = vi.spyOn(process[stream], 'write').mockImplementation((chunk: unknown) => {
    calls.push(String(chunk));
    return true;
  });
  return { calls, restore: () => spy.mockRestore() };
}

describe('logger — control-character stripping', () => {
  afterEach(() => {
    clearRegisteredSecrets();
  });

  for (const method of METHODS) {
    const stream = method === 'info' ? 'stdout' : 'stderr';

    it(`${method}() strips a C0 control character (ESC) from the message`, () => {
      const { calls, restore } = captureWrites(stream);
      logger[method]('bad\x1beviltext');
      restore();
      expect(calls.join('')).not.toContain('\x1b');
      expect(calls.join('')).toContain('badeviltext');
    });

    it(`${method}() preserves embedded newline and tab characters`, () => {
      const { calls, restore } = captureWrites(stream);
      logger[method]('line1\nline2\twithtab');
      restore();
      expect(calls.join('')).toContain('line1\nline2\twithtab');
    });

    it(`${method}() strips DEL (0x7f)`, () => {
      const { calls, restore } = captureWrites(stream);
      logger[method]('before\x7fafter');
      restore();
      expect(calls.join('')).not.toContain('\x7f');
      expect(calls.join('')).toContain('beforeafter');
    });

    it(`${method}() leaves a message with no control characters unchanged`, () => {
      const { calls, restore } = captureWrites(stream);
      logger[method]('a perfectly normal message with emoji 🎉 and unicode café');
      restore();
      expect(calls.join('')).toContain('a perfectly normal message with emoji 🎉 and unicode café');
    });
  }

  it('reproduces the exact F1 finding: the review probe payload no longer contains a raw ESC byte on stderr', () => {
    const { calls, restore } = captureWrites('stderr');
    logger.error('Invalid skill name "bad\x1b[8m\x1b]0;PWNED-TITLE\x07name" in SKILL.md frontmatter: must match ^[a-z0-9-]+$');
    restore();
    const output = calls.join('');
    expect(output).not.toContain('\x1b');
    expect(output).toContain('PWNED-TITLE');
    expect(output).toContain('Invalid skill name');
  });

  it('strips control characters before redact() runs, so a registered secret adjacent to a control character is still redacted', () => {
    registerSecret('super-secret-value');
    const { calls, restore } = captureWrites('stderr');
    logger.error('token=\x1bsuper-secret-value end');
    restore();
    const output = calls.join('');
    expect(output).not.toContain('\x1b');
    expect(output).not.toContain('super-secret-value');
    expect(output).toContain('[REDACTED]');
  });
});

describe('sanitiseError()', () => {
  afterEach(() => {
    clearRegisteredSecrets();
  });

  it('returns the message of an Error instance', () => {
    expect(sanitiseError(new Error('something broke'))).toBe('something broke');
  });

  it('returns a string error unchanged', () => {
    expect(sanitiseError('plain string error')).toBe('plain string error');
  });

  it('returns a fixed fallback for a non-Error, non-string value', () => {
    expect(sanitiseError(42)).toBe('An unexpected error occurred');
    expect(sanitiseError({ some: 'object' })).toBe('An unexpected error occurred');
    expect(sanitiseError(undefined)).toBe('An unexpected error occurred');
  });

  it('replaces the home directory path with ~ in an Error message', () => {
    const message = `failed to read ${homedir()}/config.json`;
    expect(sanitiseError(new Error(message))).toBe('failed to read ~/config.json');
  });

  it('replaces the home directory path with ~ in a string error', () => {
    const message = `failed to read ${homedir()}/config.json`;
    expect(sanitiseError(message)).toBe('failed to read ~/config.json');
  });

  it('redacts a registered secret value inside an Error message', () => {
    registerSecret('super-secret-value');
    expect(sanitiseError(new Error('token super-secret-value invalid'))).toBe(
      'token [REDACTED] invalid',
    );
  });

  it('strips a control character from an Error instance message', () => {
    expect(sanitiseError(new Error('bad\x1beviltext'))).toBe('badeviltext');
  });

  it('strips a control character from a plain string input', () => {
    expect(sanitiseError('bad\x1beviltext')).toBe('badeviltext');
  });

  it('composes strip + home-path redaction + secret redaction together on one message', () => {
    registerSecret('super-secret-value');
    const message = `token \x1bsuper-secret-value at ${homedir()}/config.json`;
    expect(sanitiseError(new Error(message))).toBe('token [REDACTED] at ~/config.json');
  });
});
