import { describe, it, expect, afterEach, vi } from 'vitest';
import { redact, registerSecret, clearRegisteredSecrets, REDACTED_MARKER } from './redact.js';
import { logger, sanitiseError } from './logger.js';

afterEach(() => {
  clearRegisteredSecrets();
});

describe('redact()', () => {
  it('returns text unchanged when nothing is registered', () => {
    expect(redact('hello world, nothing secret here')).toBe('hello world, nothing secret here');
  });

  it('replaces a registered value wherever it appears', () => {
    registerSecret('sk-abc123');
    expect(redact('token is sk-abc123 in the header')).toBe(
      `token is ${REDACTED_MARKER} in the header`,
    );
  });

  it('replaces every occurrence, not just the first', () => {
    registerSecret('dup-value');
    expect(redact('dup-value appears twice: dup-value')).toBe(
      `${REDACTED_MARKER} appears twice: ${REDACTED_MARKER}`,
    );
  });

  it('longest-match-first: a shorter registered value does not fragment a longer one that contains it', () => {
    registerSecret('secret');
    registerSecret('secretvalue123');

    expect(redact('the value is secretvalue123 here')).toBe(
      `the value is ${REDACTED_MARKER} here`,
    );
  });

  it('still redacts the shorter value independently when it appears on its own', () => {
    registerSecret('secret');
    registerSecret('secretvalue123');

    expect(redact('secretvalue123 and also secret alone')).toBe(
      `${REDACTED_MARKER} and also ${REDACTED_MARKER} alone`,
    );
  });

  it('matches literally: a value containing regex metacharacters is never interpreted as a pattern', () => {
    registerSecret('a.*b(c)');
    expect(redact('before a.*b(c) after')).toBe(`before ${REDACTED_MARKER} after`);
    // Confirms it is NOT treated as a regex: "aXXXb(c)" must NOT match "a.*b(c)"'s pattern semantics.
    expect(redact('aXXXb(c)')).toBe('aXXXb(c)');
  });

  it('ignores an attempt to register an empty string (never redacts every character boundary)', () => {
    registerSecret('');
    expect(redact('hello world')).toBe('hello world');
  });

  it('clearRegisteredSecrets() removes all registered values', () => {
    registerSecret('temp-secret');
    expect(redact('has temp-secret in it')).toContain(REDACTED_MARKER);

    clearRegisteredSecrets();

    expect(redact('has temp-secret in it')).toBe('has temp-secret in it');
  });
});

describe('wired into logger and sanitiseError', () => {
  const SENTINEL = 'GOODBOY_SECURITY_SENTINEL_SECRET';

  it('scrubs a registered sentinel value from every logger method', () => {
    registerSecret(SENTINEL);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    logger.info(`value is ${SENTINEL}`);
    logger.success(`value is ${SENTINEL}`);
    logger.warn(`value is ${SENTINEL}`);
    logger.error(`value is ${SENTINEL}`);

    const allOutput = [...stdoutSpy.mock.calls, ...stderrSpy.mock.calls].map((c) => String(c[0])).join('');
    expect(allOutput).not.toContain(SENTINEL);
    expect(allOutput).toContain(REDACTED_MARKER);

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('scrubs a registered sentinel value from sanitiseError, for both Error and string inputs', () => {
    registerSecret(SENTINEL);

    expect(sanitiseError(new Error(`failed with ${SENTINEL}`))).not.toContain(SENTINEL);
    expect(sanitiseError(`failed with ${SENTINEL}`)).not.toContain(SENTINEL);
  });

  it('does not alter logger/sanitiseError output at all when nothing is registered (no behavior change for existing callers)', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    logger.info('plain message, nothing registered');

    expect(stdoutSpy.mock.calls[0]?.[0]).toContain('plain message, nothing registered');
    expect(sanitiseError(new Error('plain error message'))).toBe('plain error message');

    stdoutSpy.mockRestore();
  });
});
