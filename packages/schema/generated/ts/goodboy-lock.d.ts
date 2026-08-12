/* AUTO-GENERATED — do not edit by hand */

export interface GoodBoyLock {
  /**
   * GoodBoy goodboy.lock schema version, semver-shaped (v1.x only). CLIs tolerate a newer minor than they know by ignoring unknown top-level fields (with a warning); a field added inside a skill entry fails validation and the lock is treated as absent, then regenerated on the next install or upgrade. A newer major is rejected.
   */
  schema: string;
  /**
   * When the lock was last written, ISO-8601. Machine-generated; refreshed on every write.
   */
  generated: string;
  /**
   * Resolved install state as a name-to-entry map. Names must match the skill-name pattern.
   */
  skills: {
    [k: string]: {
      /**
       * Exact installed version, semver-shaped.
       */
      version: string;
      /**
       * Content-integrity hash computed at install/upgrade time. The hash construction itself is owned by integrity.ts and treated as versioned/frozen — no pattern is enforced here.
       */
      integrity?: string;
    };
  };
}
