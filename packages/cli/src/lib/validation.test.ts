import { describe, it, expect } from 'vitest';
import { isRemoteRefArgument } from './validation.js';

describe('isRemoteRefArgument', () => {
  it('rejects an https URL', () => {
    expect(isRemoteRefArgument('https://github.com/foo/bar')).toBe(true);
  });

  it('rejects an http URL', () => {
    expect(isRemoteRefArgument('http://example.com/s')).toBe(true);
  });

  it('rejects a git:// URL', () => {
    expect(isRemoteRefArgument('git://host/repo.git')).toBe(true);
  });

  it('rejects an ssh:// URL', () => {
    expect(isRemoteRefArgument('ssh://git@host/repo.git')).toBe(true);
  });

  it('rejects a file:// URL', () => {
    expect(isRemoteRefArgument('file:///tmp/skill')).toBe(true);
  });

  it('rejects an uppercase scheme', () => {
    expect(isRemoteRefArgument('HTTPS://GitHub.com/foo')).toBe(true);
  });

  it('rejects an scp-style git remote (git@host:path)', () => {
    expect(isRemoteRefArgument('git@github.com:foo/bar.git')).toBe(true);
  });

  it('rejects a generic scp-style user@host:path', () => {
    expect(isRemoteRefArgument('user@host:path/to/skill')).toBe(true);
  });

  it('accepts a relative dot path', () => {
    expect(isRemoteRefArgument('./skills/foo')).toBe(false);
  });

  it('accepts a relative parent path', () => {
    expect(isRemoteRefArgument('../foo')).toBe(false);
  });

  it('accepts an absolute path', () => {
    expect(isRemoteRefArgument('/abs/path/foo')).toBe(false);
  });

  it('accepts a bare relative name', () => {
    expect(isRemoteRefArgument('foo')).toBe(false);
  });

  it('accepts a home-relative path', () => {
    expect(isRemoteRefArgument('~/skills/foo')).toBe(false);
  });

  it('accepts a Windows backslash path', () => {
    expect(isRemoteRefArgument('C:\\skills\\foo')).toBe(false);
  });

  // A Windows drive-letter path must never be mistaken for a URI scheme.
  // The scheme requires at least two characters before "://"; a single
  // drive letter ("C") does not qualify. A future "simplify the regex"
  // edit that drops this length constraint would break this case.
  it('does not mistake a Windows drive-letter path for a URI scheme', () => {
    expect(isRemoteRefArgument('C://skills/foo')).toBe(false);
  });

  // The "@" here is not scp-style user@host — it comes after a slash, so
  // there is no bare "user@host:" prefix at the start of the string. A
  // regex that scans for "@...:" anywhere (rather than anchoring the
  // user/host portion to the start of the string) would wrongly flag this.
  it('does not mistake an npm-scoped-looking relative path for scp syntax', () => {
    expect(isRemoteRefArgument('./@scope/foo')).toBe(false);
  });

  it('accepts an empty string', () => {
    expect(isRemoteRefArgument('')).toBe(false);
  });
});
