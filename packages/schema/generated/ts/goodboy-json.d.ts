/* AUTO-GENERATED — do not edit by hand */

export interface GoodBoyJSON {
  /**
   * GoodBoy goodboy.json schema version, semver-shaped (v1.x only). CLIs tolerate a newer minor than they know by ignoring unknown top-level fields (with a warning); a field added inside a nested object fails validation and makes the file unreadable (a hard error). A newer major is rejected.
   */
  schema: string;
  /**
   * Installed skills as a name-to-semver-range map. Names must match the skill-name pattern; ranges are the pinned-or-caret form GoodBoy writes (e.g. ^1.2.0).
   */
  skills: {
    [k: string]: string;
  };
}
