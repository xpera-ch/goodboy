# Roadmap (v0.2.0+ and beyond)

**Provenance note:** this file was reconstructed from Claude's memory of a
prior planning chat (a claude.ai Chat project, not this repo) after
discovering that chat's storage was the only place this content existed —
none of it was previously written into the repo. It is a best-effort port,
not a re-derivation from first principles. Bruno should read through it and
correct anything that's stale, superseded, or misremembered; treat it as a
recovered draft, not a locked decision record, until confirmed. Once
confirmed, decisions here should graduate into `docs/concept-*.md` files —
the same shape as `docs/concept-secrets.md`, which is itself now withdrawn
but remains the worked example of the format.

---

## Pending command restructure (before v0.2.0-era work continues)

1. `goodboy init` → initialises `goodboy.json` in the current directory
   (project setup) — already the current behavior, per `init --help`.
2. `goodboy skill create` → replaces the standalone `init` naming confusion;
   creates a new skill directory with `SKILL.md` and `manifest.json` —
   already implemented (`packages/cli/src/commands/skill-create.ts`).

(Both of these may already be done — verify against current CLI behavior
before treating as open work; they were open items as of the last planning
session, but the CLI has moved since.)

## Multi-registry support

Elevated from "future extension" to near-term requirement after recognizing
the shared-private registry (see `docs/skill-authoring-handoff.md`) is the
first real instance of it — dogfooding a roadmap feature rather than
speculating about one.

Three registries in play, conceptually:

- **Public repo** — this monorepo, contributors welcome.
- **Personal registry** — `~/.goodboy/registry` by default, solo use.
- **Shared-private registry** — a separate registry (e.g. the skill-authoring
  work), core-contributors read+write, consumed via a pinned git submodule.

This pulls forward because cross-registry dependency resolution (see next
section) can't stay single-registry once it exists.

## GoodBoy-managed bundling dependencies

Distinct from `requires.secrets`, which shipped in schema 1.1.0 and was
**removed in schema 2.0.0** (2026-08-11) along with the rest of the secrets
feature — see `docs/concept-secrets.md`, marked WITHDRAWN. Nothing named
`requires` exists in the schema today. This is a broader, **not yet
implemented** concept: install-time bundling dependencies between skills
themselves, declared under a namespaced `goodboy.requires` frontmatter key
(not yet present anywhere in the schema or codebase — confirmed via search).

Design as last discussed:

- **Two edge types:**
  - `skill` — another skill that must be deployed; GoodBoy can *fix* this
    (deploy it automatically).
  - `file` — a file that must exist in the target project; GoodBoy can only
    *check*, not repair.
- **Resolver:** topological sort, deploy dependencies before dependents,
  hard-fail on cycles or missing dependencies with a clear message — never a
  silent runtime surprise.
- **Cross-registry dependencies** are the interesting case (e.g. personal →
  shared-private) — this is why multi-registry support has to land first or
  alongside.
- **Ledger:** records the resolved *bundle* — each installed skill plus the
  exact SHA of every dependency at deploy time.
- **Drift is transitive:** a skill is only "healthy" if its own SHA matches
  AND every dependency still matches its recorded SHA. A drifted dependency
  should surface on the dependent too, not just at the dependency itself.
- **Pinned SHAs:** dependencies lock to the SHA deployed at install time;
  updates never arrive silently.
- **Explicit update path:**
  - `goodboy status` — shows pinned vs. latest (e.g. "2 commits behind").
  - `goodboy update <skill>` — re-resolves, re-pins, re-writes the ledger,
    re-runs the drift check.
- Model: pinned = reproducible baseline; drift = deviation from it; update =
  the only sanctioned way the baseline moves. Drift and "out of date" are
  kept as separate signals, deliberately.

This is explicitly install-time **bundling**, not runtime skill-to-skill
chaining (considered and rejected as too fragile/non-deterministic — Claude
Code itself has no dependency resolver, so this is GoodBoy's job to own).

**Terminology correction (verified against the actual code — there is no
"ledger" anywhere in the codebase):**

- `goodboy.lock` (consumer side) — `GoodBoyLockEntry { version, resolved,
  integrity }`. `integrity` *is* the "pinned SHA" described above; `resolved`
  is the local install destination, not a registry path.
- `registry-entry.json` (registry side) — `{ name, latest, versions: { <v>:
  { path, addedAt, yanked } } }`. Version paths only, no content hash today.

**Implementation status (as of the last verified check):**

- **DONE** — content-integrity hashing
  (`packages/cli/src/lib/integrity.ts`, commit `3c6f05e`). Whole-skill-
  directory, recursive, deterministic across machines, SRI `sha256-<base64>`,
  digest-of-digests (path digest + content digest, fixed-length hex, so no
  boundary collisions). Populated at both install and upgrade.
- **NOT BUILT** — drift comparison (recompute vs. the recorded integrity
  value). This is the gap tracked as HIGH priority in `docs/backlog.md`.
- **NOT BUILT** — the "out-of-date" signal (pinned vs. latest). Registry-side
  hashing was explicitly out of scope for the integrity work, so `goodboy
  status`'s out-of-date half still needs its own mechanism.
- **OPEN interaction with symlinks** — `computeSkillIntegrity` never follows
  symlinks; it hashes the target string. Fine today, since installs copy
  rather than link. But once symlink-based deploy lands (`goodboy link` /
  shared-private-registry symlinking, see below), a linked skill's content
  lives behind the link, and a target-string hash won't catch content
  changing behind a stable link. When drift verification is designed,
  decide explicitly: resolve-then-hash, or declare drift meaningless for
  links (a link always mirrors its source). Park this decision alongside the
  `goodboy link` work rather than deciding it in isolation.

## Registry layout: flat (resolved, stay flat)

Considered and explicitly decided to **stay flat** — all skills sit
directly under the registry root (`<registryRoot>/<name>/`), no grouping —
verified against the actual resolution code:

- `resolveSkill()` (`packages/cli/src/lib/registry.ts`) hardcodes
  `join(registryPath, name)` — a fixed one-level path, no glob, no
  recursive `SKILL.md` search.
- `listRegistry()` uses `readdirSync(registryPath)` — one level, no
  recursion.
- Every `SKILL.md` reference in the CLI is a direct join, never a search.

Why stay flat rather than make the resolver depth-agnostic now: the break
is cheap and self-contained (nothing is externally pinned pre-v0.1.0, and
`goodboy.lock`'s `resolved` field points at the local install destination,
independent of registry layout, so already-installed skills would survive a
future regrouping). Only `resolveSkill`/`listRegistry` would need to change,
and those are exactly the code a future grouping feature would rewrite
anyway. Recursive resolution has real cost today — name-collision handling
across groups, a more complex path-escape check, more tests against the
100% coverage bar — for no proven need yet. Same YAGNI discipline applied
to the slots idea below: three skills don't need hierarchy.

## v0.2.0-era backlog (design settled, not yet implemented)

1. **`goodboy link`** — an npm-link / `file:`-equivalent: use a local skill
   source directory in a project without publishing it to a registry first.
   Open wrinkles to resolve together before implementing: symlink vs. copy
   semantics, how the existing `scanForSymlinks` security boundary
   (`packages/cli/src/lib/fs-security.ts`) applies to a deliberately-linked
   symlink, and how `list` / drift reporting should represent linked skills
   (they have no registry SHA to drift against in the normal sense).
2. **Promote-back workflow** — local edits to an installed skill can be
   pushed back to the registry and rolled out to other projects that use it.
   This is the other half of the "development happens in the skill source
   directory, not the registry" principle — no design detail beyond that
   principle was settled yet.
3. **Symlink security model** — generalizing the existing symlink-scanning
   protection to the linking and bundling-dependency features above, rather
   than treating each as a one-off.

## Lower-priority backlog

- `goodboy registry remove <name> --version <tag>` — policy enforced in
  `RegistryAdapter`/server: permissive locally, npm-style immutability +
  version-burning once a version has been published to the public registry.
- **Prerelease semver support** (e.g. `1.2.0-beta.1`) in version resolution
  — for distributable release candidates, not local experimentation (local
  exploratory work is what `goodboy link` is for, once it exists).

## Architectural migrations recommended before more code (from an
## agentskills.io ecosystem analysis)

- Migrate GoodBoy-proprietary metadata out of the separate `manifest.json`
  and into `SKILL.md` frontmatter under namespaced keys (e.g.
  `metadata.goodboy-version`, `metadata.goodboy-tags`) — a larger schema
  migration, not yet started.
- Deploy to `.agents/skills/` as the default install target (in addition to
  or instead of the current per-agent directories in `agents.ts`).
- Wrap `skills-ref validate` for open-standard spec validation rather than
  reimplementing spec compliance checks in-house.
- Adopt the `evals/evals.json` convention inside skill directories so a
  future `goodboy test` could run trigger evals from the CLI.

These were flagged as worth doing *before* more feature code piles on top of
the current manifest-separate-from-SKILL.md structure, since the migration
gets more expensive the longer it's deferred. Not scheduled against a
version yet — needs a decision on sequencing relative to the items above.
(This previously also had to be sequenced against the secrets roadmap
S3–S5; that work was removed on 2026-08-09 and is no longer a constraint.)

## Go-to-market notes

Lightweight distribution tied to the v0.1.0 launch: Show HN, relevant
communities, a polished GitHub README. A fuller marketing push was
deliberately reserved for when "GoodBoy Studio" (referenced only by name in
prior planning — no scope defined yet) exists. Hard sequencing constraint:
the npm package must be published before the repo goes public — see
`docs/go-public-checklist.md`, which already encodes the "feature complete
first" gate this depends on.
