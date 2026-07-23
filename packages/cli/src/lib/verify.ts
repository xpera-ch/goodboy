import { computeSkillIntegrity } from './integrity.js';
import type { GoodBoyLockEntry } from './goodboy-file.js';

export type VerifyState = 'verified' | 'mismatch' | 'not-verified';

/**
 * Recomputes an installed skill's content-integrity hash (via
 * computeSkillIntegrity, unchanged) and classifies it against the hash
 * recorded in goodboy.lock. A lock entry with no `integrity` field (e.g. an
 * install predating the integrity feature) is `not-verified` — distinct from
 * both a match and a mismatch, never folded into either.
 */
export async function verifySkillIntegrity(
  installedPath: string,
  lockEntry: GoodBoyLockEntry | null | undefined,
): Promise<VerifyState> {
  if (!lockEntry?.integrity) return 'not-verified';
  const actual = await computeSkillIntegrity(installedPath);
  return actual === lockEntry.integrity ? 'verified' : 'mismatch';
}
