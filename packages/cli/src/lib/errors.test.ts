import { describe, it, expect } from 'vitest';
import { GoodBoyError } from './errors.js';

describe('GoodBoyError', () => {
  it('carries message, code, cause, and safeMetadata', () => {
    const cause = new Error('underlying failure');
    const err = new GoodBoyError('something went wrong', {
      code: 'E_SOMETHING',
      cause,
      safeMetadata: { skillName: 'demo-skill' },
    });

    expect(err.message).toBe('something went wrong');
    expect(err.code).toBe('E_SOMETHING');
    expect(err.cause).toBe(cause);
    expect(err.safeMetadata).toEqual({ skillName: 'demo-skill' });
    expect(err.name).toBe('GoodBoyError');
    expect(err).toBeInstanceOf(Error);
  });

  it('defaults safeMetadata to an empty object when omitted', () => {
    const err = new GoodBoyError('no metadata here', { code: 'E_PLAIN' });
    expect(err.safeMetadata).toEqual({});
  });

  it('omits cause entirely when not provided (no accidental undefined cause)', () => {
    const err = new GoodBoyError('no cause here', { code: 'E_NO_CAUSE' });
    expect('cause' in err).toBe(false);
  });

  it('never leaks the cause chain through JSON.stringify, even when cause contains something sensitive', () => {
    const sensitiveCause = new Error('token=SUPER_SECRET_VALUE_123');
    const err = new GoodBoyError('operation failed', {
      code: 'E_SENSITIVE',
      cause: sensitiveCause,
      safeMetadata: { attempt: 1 },
    });

    const serialized = JSON.stringify(err);

    expect(serialized).not.toContain('SUPER_SECRET_VALUE_123');
    // The cause is not opaque or inaccessible — a caller can still read it directly...
    expect(err.cause).toBe(sensitiveCause);
    // ...it just never leaks through default serialization.
  });

  it('does include safeMetadata in JSON.stringify, since it is caller-attested safe to log', () => {
    const err = new GoodBoyError('operation failed', {
      code: 'E_SENSITIVE',
      safeMetadata: { attempt: 2, skillName: 'demo-skill' },
    });

    const parsed = JSON.parse(JSON.stringify(err)) as Record<string, unknown>;

    expect(parsed['code']).toBe('E_SENSITIVE');
    expect(parsed['safeMetadata']).toEqual({ attempt: 2, skillName: 'demo-skill' });
  });
});
