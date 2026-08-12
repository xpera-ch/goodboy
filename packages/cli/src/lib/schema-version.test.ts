import { describe, it, expect } from 'vitest';
import { applyVersionPolicy, stripToKnownKeys } from './schema-version.js';

// Known version used throughout: 2.0.0 (the manifest's current version), plus
// 1.0.0 in the goodboy.json/lock-shaped tests to prove the policy is
// parameterised — the caller's known version, not a constant.

describe('applyVersionPolicy', () => {
  it('is strict for a document at exactly the known version', () => {
    expect(applyVersionPolicy({ schema: '2.0.0' }, 'schema', '2.0.0')).toEqual({
      outcome: 'strict',
    });
  });

  it('is strict for a document below the known minor within the same major', () => {
    expect(applyVersionPolicy({ schema: '2.0.0' }, 'schema', '2.3.0')).toEqual({
      outcome: 'strict',
    });
  });

  it('is strict for a same-major version below the known minor', () => {
    expect(applyVersionPolicy({ schema: '1.2.3' }, 'schema', '1.5.0')).toEqual({
      outcome: 'strict',
    });
  });

  it('reports newer-minor with the declared version', () => {
    expect(applyVersionPolicy({ schema: '1.1.0' }, 'schema', '1.0.0')).toEqual({
      outcome: 'newer-minor',
      version: '1.1.0',
    });
  });

  it('reports newer-major with the declared version', () => {
    expect(applyVersionPolicy({ schema: '2.0.0' }, 'schema', '1.0.0')).toEqual({
      outcome: 'newer-major',
      version: '2.0.0',
    });
  });

  it('reports older-major distinctly from newer-major', () => {
    expect(applyVersionPolicy({ schema: '0.1.0' }, 'schema', '2.0.0')).toEqual({
      outcome: 'older-major',
      version: '0.1.0',
    });
  });

  it('is strict for a non-object document', () => {
    expect(applyVersionPolicy(null, 'schema', '2.0.0')).toEqual({ outcome: 'strict' });
    expect(applyVersionPolicy('1.0.0', 'schema', '2.0.0')).toEqual({ outcome: 'strict' });
    expect(applyVersionPolicy([], 'schema', '2.0.0')).toEqual({ outcome: 'strict' });
    expect(applyVersionPolicy(42, 'schema', '2.0.0')).toEqual({ outcome: 'strict' });
  });

  it('is strict when the version field is missing', () => {
    expect(applyVersionPolicy({ skills: {} }, 'schema', '2.0.0')).toEqual({ outcome: 'strict' });
  });

  it('is strict when the version field is not a string', () => {
    expect(applyVersionPolicy({ schema: 1.0 }, 'schema', '2.0.0')).toEqual({
      outcome: 'strict',
    });
  });

  it('is strict for a version string over the 32-char gate, never interpolating it', () => {
    // The gate mirrors the schemas' maxLength: 32. An overlong value must fall
    // through to Ajv's maxLength error rather than ever appearing in a
    // message — so the outcome carries no version.
    const overlong = '1.0.0.' + 'x'.repeat(40);
    expect(applyVersionPolicy({ schema: overlong }, 'schema', '2.0.0')).toEqual({
      outcome: 'strict',
    });
  });

  it('is strict for a version string that is not semver-shaped', () => {
    expect(applyVersionPolicy({ schema: 'banana' }, 'schema', '2.0.0')).toEqual({
      outcome: 'strict',
    });
    expect(applyVersionPolicy({ schema: 'v1.2.3' }, 'schema', '2.0.0')).toEqual({
      outcome: 'strict',
    });
  });

  it('reads whichever field name the caller passes', () => {
    expect(applyVersionPolicy({ schema_version: '3.0.0' }, 'schema_version', '2.0.0')).toEqual({
      outcome: 'newer-major',
      version: '3.0.0',
    });
  });
});

describe('stripToKnownKeys', () => {
  it('keeps known keys and drops unknown ones', () => {
    const known = new Set(['schema', 'skills']);
    const stripped = stripToKnownKeys(
      { schema: '1.1.0', skills: {}, futureField: 42 },
      known,
    );
    expect(stripped).toEqual({ schema: '1.1.0', skills: {} });
  });

  it('never mutates the caller\'s object', () => {
    const data = { schema: '1.1.0', futureField: 42 };
    stripToKnownKeys(data, new Set(['schema']));
    expect(data).toEqual({ schema: '1.1.0', futureField: 42 });
  });

  it('returns an empty object when nothing is known', () => {
    expect(stripToKnownKeys({ schema: '1.1.0' }, new Set())).toEqual({});
  });
});
