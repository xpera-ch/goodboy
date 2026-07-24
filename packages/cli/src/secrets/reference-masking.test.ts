import { describe, it, expect } from 'vitest';
import { maskReference } from './reference-masking.js';

describe('maskReference()', () => {
  it('returns environment references unchanged', () => {
    expect(maskReference('LEGACY_TOKEN', 'environment')).toBe('LEGACY_TOKEN');
  });

  it('masks a 3-segment onepassword-cli reference, keeping the op:// prefix', () => {
    const masked = maskReference('op://dev-vault/Exoscale/api-key', 'onepassword-cli');
    expect(masked).toBe('op://•••/•••/•••');
    expect(masked).not.toContain('dev-vault');
    expect(masked).not.toContain('Exoscale');
    expect(masked).not.toContain('api-key');
  });

  it('masks a 4-segment onepassword-cli reference, distinguishably from the 3-segment case', () => {
    const masked = maskReference('op://dev/aws/Access Keys/access_key_id', 'onepassword-cli');
    expect(masked).toBe('op://•••/•••/•••/•••');
    expect(masked).not.toContain('Access Keys');
    expect(masked).not.toContain('access_key_id');

    const threeSegment = maskReference('op://dev-vault/Exoscale/api-key', 'onepassword-cli');
    expect(masked).not.toBe(threeSegment); // segment count stays distinguishable
  });

  it('masks query string content, never showing it', () => {
    const masked = maskReference('op://dev/aws/api-key?attribute=otp', 'onepassword-cli');
    expect(masked).not.toContain('attribute=otp');
    expect(masked).toBe('op://•••/•••/•••?•••');
  });

  it('masks a reference with an undetermined provider type the same conservative way as onepassword-cli', () => {
    const onepassword = maskReference('op://dev-vault/Exoscale/api-key', 'onepassword-cli');
    const undetermined = maskReference('op://dev-vault/Exoscale/api-key', undefined);
    expect(undetermined).toBe(onepassword);
  });

  it('masks conservatively even for a reference with no recognizable op:// scheme, when type is not environment', () => {
    const masked = maskReference('SOME_OPAQUE_VALUE', undefined);
    expect(masked).not.toContain('SOME_OPAQUE_VALUE');
    expect(masked).toBe('•••');
  });
});
