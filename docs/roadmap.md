# Roadmap (v0.2.0+ and beyond)

## Multi-registry support

Elevated from "future extension" to near-term requirement after recognizing
the shared-private registry (used to onboard the first internally-authored
skills) is the first real instance of it — dogfooding a roadmap feature
rather than speculating about one.

Three registries in play, conceptually:

- **Public repo** — this monorepo, contributors welcome.
- **Personal registry** — `~/.goodboy/registry` by default, solo use.
- **Shared-private registry** — a separate registry (e.g. the skill-authoring
  work), core-contributors read+write, consumed via a pinned git submodule.

This pulls forward because cross-registry dependency resolution (see next
section) can't stay single-registry once it exists.

**A per-project registry override, recorded in `goodboy.json`, is a valuable
future piece of this — not yet built.** Today the only way to point at a
non-default registry is the `GOODBOY_REGISTRY` environment variable (see
`getRegistryPath()` in `packages/cli/src/lib/registry.ts`); there's no way to
pin a project to a specific registry the way `goodboy.json` pins skill
versions. `goodboy init` used to take a `--registry <url>` option that wrote
into a `registry` field on `goodboy.json`, but nothing ever read that field
back — it was dead code and has been removed (2026-08-19). The underlying
idea should come back once it's actually wired up to registry resolution,
not as a config value that silently does nothing.

## GoodBoy-managed bundling dependencies

**Confidence tier: exploratory.** Design discussed and recorded below, but
nothing in this section is implemented; treat it as a plan to build against,
not a description of current behavior.

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

**Naming note: there is no "ledger" anywhere in the codebase — the terms
below are what the code actually uses.**

- `goodboy.lock` (consumer side) — `GoodBoyLockEntry { version, integrity }`.
  `integrity` *is* the "pinned SHA" described above. There is no `resolved`
  field or local-install-destination tracking today.
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
`goodboy.lock` tracks skills by name and version, independent of registry
layout, so already-installed skills would survive a future regrouping). Only
`resolveSkill`/`listRegistry` would need to change,
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

- **Public-registry immutability enforcement** — `goodboy registry remove
  <name> [--version <tag>]` is already implemented locally today: it removes
  one version (or the whole skill if none remain) and rewrites the registry
  entry (`packages/cli/src/commands/registry-cmd.ts`). What's not built is
  the policy layer for a future public registry: npm-style immutability +
  version-burning once a version has been published there. Locally, removal
  stays permissive by design.
- **Prerelease semver support** (e.g. `1.2.0-beta.1`) in version resolution
  — for distributable release candidates, not local experimentation (local
  exploratory work is what `goodboy link` is for, once it exists).

## Architectural migrations recommended before more code (from an agentskills.io ecosystem analysis)

- Migrate GoodBoy-proprietary metadata out of the separate `manifest.json`
  and into `SKILL.md` frontmatter under namespaced keys (e.g.
  `metadata.goodboy-version`, `metadata.goodboy-tags`) — a larger schema
  migration, not yet started.
- ~~Deploy to `.agents/skills/` as the default install target (in addition
  to or instead of the current per-agent directories in `agents.ts`)~~ —
  **done 2026-08-13**: `AGENT_SKILL_DIRS` is now list-valued; `codex`,
  `gemini` and the standalone `--agents` flag install to
  `~/.agents/skills/` (see `docs/decisions.md`, 2026-08-13).
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

## Exploratory: a hosted registry, and how the project might fund itself

**Confidence tier: exploratory. Brainstorming, not a decision.** Recorded
here on 2026-08-17 and deliberately kept out of `CLAUDE.md`, which is an
agent-instruction file and not the place for business direction.

A hosted public registry **could** be built, and a closed-source one is one
candidate for giving the project a budget if funding does not come from
elsewhere. The analogy is npm's own split — an open client and schema
against a hosted service — and the seam is already in place: the CLI and
the registry server would share an HTTP API contract, not code, which is
why `packages/registry-client` exists as a deliberate seam.

**Nothing about this is settled** — not whether the hosted registry gets
built, not whether it would be closed-source, not whether funding takes this
shape at all. Do not treat the seam's existence as evidence that the
decision has been made. `packages/registry-client` is unpublished precisely
because it should not occupy a public npm page before it has a use.

**One consequence that is already load-bearing:** the nine manifest registry
fields were added for this hypothetical consumer and read by nothing, which
forced the schema to 2.0.0 when they were removed. That is the concrete cost
of building surface ahead of a decision — see the "nothing half-baked"
principle in `CLAUDE.md`. Anything that graduates from this section should
carry a consumer with it.

**Reconciled 2026-08-19.** `docs/product-positioning.md` previously
described a separate private registry-API repo as settled repository
topology — overstated the same way this section warns against. Confirmed
with Bruno: it's an idea for funding the project's maintenance, not a
decision, and `product-positioning.md`'s "Repository topology" section now
says so directly instead of implying an existing plan.

## Exploratory: ecosystem analysis (`goodboy doctor`)

**Confidence tier: exploratory.** Lower than everything above it — no scope,
no command surface, no decision. Recorded so the reasoning isn't lost, not
because it is planned. Folded in from `docs/goodboy-ecosystem-analyzer-notes.md`
on 2026-08-17, which was deleted in the same pass: two documents at different
confidence levels is worse than one roadmap with a tier for each.

The prompt was Anthropic's `claude-code-setup` plugin, which analyses a
repository and recommends skills, hooks, MCP servers, subagents and workflow
changes. The interesting part is not its recommendations — it is the shape of
the question it asks: *analyse an engineering environment and suggest
improvements.*

**The plausible GoodBoy version is broader and vendor-neutral.** Not "how
should Claude Code be configured for this repo?" but "how healthy is this
engineering ecosystem, and what would raise its quality and consistency?" —
answered the same way whether the user is on Claude Code, Codex, Gemini,
Cursor, Windsurf or Aider. That neutrality is the whole point and is the one
non-negotiable if this is ever built: **GoodBoy must not become a Claude Code
clone.**

Directions that seemed worth exploring: skill health (installed versions,
available upgrades, deprecated or duplicate or never-used skills); foundation
gaps (missing testing, documentation, security or git-workflow guidance —
naming what is *absent* rather than recommending skills at random); repository
inspection (languages, frameworks, build and test setup, CI); and, much later,
organisation-level concerns (approved skill versions, compliance reports).

**Two constraints stated up front, because they are the easy things to get
wrong.** Recommendations must explain *why* — "repository uses React but no
React skill is installed" — rather than arriving as magic. And if any health
score exists at all it should be categorical (foundation, documentation,
testing, security, tooling, maintenance), never a single number: a single
number is gamification, and gamification is the failure mode of every tool in
this category.

Candidate names floated and explicitly not chosen: `analyze`, `doctor`,
`inspect`, `audit`, `health`.

## Exploratory: intelligent dispatcher

**Confidence tier: exploratory. Vision only, no design started.** Moved
here from `docs/product-positioning.md`'s "Core differentiators" — an
unbuilt idea doesn't belong in a list of reasons to pick GoodBoy today.

Analyse project context (`CLAUDE.md`, `package.json`, file structure) and
propose which skills from the user's private registry belong in the
current project, rather than requiring the user to remember what's in
their own registry and go install it manually. No scope or design decided.
Likely related to the ecosystem-analysis idea above (both read a
repository and suggest something) but not assumed to be the same feature
until that's actually worked out.

## Exploratory: GoodBoy Studio — a UI for assisted skill generation

**Confidence tier: exploratory.** The idea is real and intended; the timing
isn't decided. Not a placeholder name — Bruno intends to build this,
just not on a scheduled date.

A UI to help a user create a new skill with guidance rather than starting
from a blank `SKILL.md` and `manifest.json`. No scope, workflow, or
technical design decided yet — this entry exists so the intent is recorded
rather than living only in a prior planning chat, the same reason the rest
of this roadmap does.

## Go-to-market notes

Lightweight distribution tied to the v0.1.0 launch: Show HN, relevant
communities, a polished GitHub README. A fuller marketing push is
deliberately deferred until later — plausibly once GoodBoy Studio (above)
exists, though that isn't scheduled either. Hard sequencing constraint: the
npm package must be published before the repo goes public — see
`docs/go-public-checklist.md`, which already encodes the "feature complete
first" gate this depends on.
