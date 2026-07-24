import { describe, it, expect, vi, afterEach } from 'vitest';
import { inspect } from 'node:util';
import { SecretValue } from './types.js';
import { clearRegisteredSecrets, REDACTED_MARKER } from '../lib/redact.js';
import { logger, sanitiseError } from '../lib/logger.js';

afterEach(() => {
  clearRegisteredSecrets();
});

describe('SecretValue', () => {
  it('toString() returns REDACTED_MARKER, never the real value', () => {
    const secret = new SecretValue('super-secret-value');
    expect(secret.toString()).toBe(REDACTED_MARKER);
    expect(secret.toString()).not.toContain('super-secret-value');
  });

  it('toJSON() (via JSON.stringify) returns REDACTED_MARKER', () => {
    const secret = new SecretValue('super-secret-value');
    expect(JSON.stringify(secret)).toBe(`"${REDACTED_MARKER}"`);
  });

  it('util.inspect()/console.log-style formatting returns REDACTED_MARKER', () => {
    const secret = new SecretValue('super-secret-value');
    expect(inspect(secret)).toBe(REDACTED_MARKER);
  });

  it('reveal() returns the exact original value', () => {
    const secret = new SecretValue('super-secret-value');
    expect(secret.reveal()).toBe('super-secret-value');
  });

  it('construction registers the value with the redactor, proven via a real logger call', () => {
    const SENTINEL = 'GOODBOY_SECURITY_SENTINEL_SECRET';
    // eslint-disable-next-line no-new
    new SecretValue(SENTINEL);

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.info(`this message would normally leak ${SENTINEL}`);
    const output = String(stdoutSpy.mock.calls[0]?.[0]);
    stdoutSpy.mockRestore();

    expect(output).not.toContain(SENTINEL);
    expect(output).toContain(REDACTED_MARKER);
  });

  it('construction registers the value with the redactor, proven via sanitiseError', () => {
    const SENTINEL = 'GOODBOY_SECURITY_SENTINEL_SECRET_TWO';
    // eslint-disable-next-line no-new
    new SecretValue(SENTINEL);

    expect(sanitiseError(new Error(`operation failed with ${SENTINEL}`))).not.toContain(SENTINEL);
  });

  it('does NOT redact a value that was never constructed as a SecretValue (sanity check on the proof above)', () => {
    const UNREGISTERED = 'GOODBOY_NEVER_REGISTERED_VALUE';
    expect(sanitiseError(new Error(`plain failure with ${UNREGISTERED}`))).toContain(UNREGISTERED);
  });
});
