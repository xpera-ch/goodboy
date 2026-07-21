/* AUTO-GENERATED — do not edit by hand */

export interface GoodBoySkillManifest {
  /**
   * Must match the skill directory name exactly. Lowercase letters, numbers, and hyphens only.
   */
  name: string;
  /**
   * Semantic version (semver) of this skill
   */
  version: string;
  /**
   * What this skill does and when to use it. Used for registry search and display.
   */
  description: string;
  author: {
    name: string;
    email?: string;
    url?: string;
  };
  /**
   * SPDX license identifier e.g. MIT, Apache-2.0
   */
  license: string;
  /**
   * GoodBoy manifest schema version, semver-shaped (v1.x only). CLIs tolerate a newer minor than they know, stripping unknown top-level fields with a warning; a newer major is rejected. See manifest.ts.
   */
  schema_version: string;
  /**
   * Maturity signal for registry display and filtering
   */
  status: "experimental" | "stable" | "deprecated";
  /**
   * Free-form search terms
   *
   * @maxItems 10
   */
  keywords?: string[];
  /**
   * Primary category for registry browsing
   */
  category?:
    | "code"
    | "writing"
    | "data"
    | "devops"
    | "testing"
    | "documentation"
    | "productivity"
    | "security"
    | "research"
    | "other";
  /**
   * Controlled vocabulary for registry faceted search. Unlike keywords, tags are a fixed enumeration owned by GoodBoy.
   *
   * @maxItems 5
   */
  tags?: (
    | "code-review"
    | "testing"
    | "documentation"
    | "git"
    | "deployment"
    | "security"
    | "refactoring"
    | "architecture"
    | "debugging"
    | "productivity"
    | "writing"
    | "data"
    | "devops"
    | "agent"
    | "orchestration"
    | "formatting"
    | "analysis"
    | "research"
    | "workflow"
    | "other"
  )[];
  homepage?: string;
  repository?: {
    type?: string;
    url?: string;
  };
  changelog?: string;
  /**
   * Registry publisher handle. Set by registry on publish, not by skill author.
   */
  publisher?: string;
  /**
   * Registry visibility. private until explicitly published.
   */
  visibility?: "public" | "private";
  /**
   * Advisory. Runtime version requirements for scripts bundled in scripts/. Not enforced by GoodBoy — shown to user before install.
   */
  engines?: {
    node?: string;
    python?: string;
    bash?: string;
    deno?: string;
  };
  /**
   * Advisory. Operating systems this skill's scripts are compatible with. Not enforced — shown to user before install.
   *
   * @maxItems 3
   */
  os?: ("darwin" | "linux" | "win32")[];
  /**
   * DECLARED INTENT ONLY — not enforced at runtime. Skill authors declare what their scripts intend to access. GoodBoy displays this to users before install as a trust signal. An empty array or omitted field means no elevated access is claimed.
   *
   * @maxItems 5
   */
  permissions?: ("read_files" | "write_files" | "network" | "shell" | "env")[];
}
