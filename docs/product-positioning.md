# Product Positioning

## What GoodBoy is

A personal skill manager — registry and installer — for AI agents built on
the Agent Skills standard. Scoped deliberately to the skill side of the
ecosystem only; it does not manage `.claude/agents/` subagent definitions.

Installing and pinning skills is now a solved problem — GitHub's `gh
skill` and Vercel's `npx skills` both do it well, for free, at a scale a
personal tool has no reason to chase, and GoodBoy does the same basic job.
What sets it apart isn't installation — it's answering a question neither
of them asks: **has my installed copy been silently modified since I
installed it?** `goodboy verify` and `goodboy skill status` answer that
with local integrity hashing — a different question from "is there a newer
version," not a smaller one. It also has zero dependency on GitHub: the
registry is a local directory, and resolving or installing a skill never
makes a network call. The comparison and the full built/not-built
accounting are below.

## Competitive landscape (verified 2026-08-09)

Recorded with dates and specifics, because this field moved substantially
during GoodBoy's development and a stale read of it produces bad
positioning.

- **`gh skill`** — GitHub CLI **v2.90.0, shipped 2026-04-16**. Subcommands
  `install`, `preview`, `search`, `update`, `publish`. **Version pinning**
  (pinned skills are skipped by `update --all`, so upgrades are
  deliberate), install by name, tag, or **commit SHA**, **immutable
  releases** tied to git tags, and multi-agent directory placement across
  `.github/skills`, `.claude/skills`, `.agents/skills`. GitHub-hosted
  repositories only.
- **`npx skills`** (Vercel) — `add`, `list`, `find`, `update`, `check`. A
  **lockfile** (`skills-lock.json`, format v3, keyed on `skillFolderHash`,
  a GitHub tree SHA), global and project scoping (`-g` / `-p`). Discovery
  via `skills.sh`, populated automatically by install telemetry rather than
  a submission flow.
- A wider community field: PolySkill, Skilldex, Lola, assorted community
  CLIs, alongside a package count reported in the hundreds of thousands by
  early 2026.

**Four capabilities that would once have been differentiators are now table
stakes, and must not be claimed as advantages:** multi-agent installation,
version pinning, lockfile-based reproducibility, and update checking. The
2026-08-05 revision of this document still implicitly claimed some of them;
that is corrected below.

**Read the field as validation, not refutation.** Three separately-resourced
teams shipping tooling for the same gap in roughly one quarter is the
strongest available evidence the gap is real. What it settles is that
*installation* isn't where GoodBoy should try to differentiate — that
ground is already taken, for free, at a scale a personal registry tool has
no reason to chase. GoodBoy still installs skills the same way; it's just
not the reason to pick it over the alternatives.

## Core differentiators

Revised 2026-08-09. Each states whether it exists **today**, because
claiming unbuilt work as a differentiator is how a positioning document goes
stale and how a README ends up writing cheques the tool cannot cash.

1. **Local integrity verification — BUILT. The strongest current
   differentiator.** `goodboy verify` and `goodboy skill status` answer
   *"has my installed copy been modified since I installed it?"*

   This is **not** the question Vercel's `check` answers. `check` asks *"is
   there a newer version upstream?"* Those are different problems, and
   nobody else is solving the second one. Local drift and tamper detection
   is what the SRI content hashing in `goodboy.lock` actually buys.

   The previous framing of this as a "deployment ledger" undersold it — a
   ledger sounds like bookkeeping; this is verification, and it fails
   closed.

2. **A personal private registry with immutable versions — BUILT.**
   `~/.goodboy/registry` is the centre of gravity: a skill is developed in
   its own source directory — never edited in place in a project or in the
   registry — and published to the registry when it's ready to install
   somewhere. Neither competitor has an equivalent: Vercel's discovery is
   public and telemetry-driven; `gh skill` is GitHub repositories.

3. **Registry resolution never touches the network — BUILT.** `gh skill`
   and `npx skills` both talk to GitHub directly — `gh skill` is GitHub CLI
   itself, and Vercel's lockfile resolves every entry against a GitHub tree
   SHA. GoodBoy's registry is just a local directory (`~/.goodboy/registry`
   by default); resolving and installing a skill never makes a network
   call. If that directory happens to be a git checkout of something
   self-hosted, that's the user's own `git clone`/`git submodule` setup,
   entirely outside GoodBoy's code — GoodBoy neither knows nor needs to
   know. Useful anywhere `gh skill`/`npx skills` simply can't function: no
   GitHub access, no network at all, or a private git host with no public
   equivalent.

## Public marketplace

**No public marketplace or search index for v1.** Whether to build one
later is undecided — see `docs/roadmap.md`'s "Exploratory: a hosted
registry" section for the longer-term thinking.

Until then, GoodBoy searches the user's own registry natively and accepts
skills found through external catalogs (`goodboy adopt`) — those catalogs
already solve discovery, and a tool that consumes them cleanly gets
discovery without operating one.

## Repository topology

- **Public `goodboy` monorepo** (this repo): `packages/cli`,
  `packages/schema`, `packages/registry-client` — open source, contributors
  welcome once public (see `docs/go-public-checklist.md`).
  `registry-client` stays unpublished from npm — there's no hosted registry
  API for it to talk to yet, and whether one ever gets built is still
  undecided (see below); it remains in the monorepo either way.
- **Personal skill registry** (default `~/.goodboy/registry`) plus a
  **shared-private registry** (core-contributors read+write, consumed via a
  pinned git submodule) — the first real instance of the multi-registry
  capability described in `docs/roadmap.md`.

**A separate private registry-API repo is an idea, not a decision.** The
project will need funding to stay maintained long-term, and a hosted
registry-as-a-service (closed-source, the same public-client/private-service
split npm itself uses) is one way that could happen — not the only one, and
not committed to. `packages/registry-client` already exists as a thin,
deliberate seam for this (an HTTP client whose methods currently all throw
`not implemented`), precisely so the seam doesn't force the decision. See
`docs/roadmap.md`, "Exploratory: a hosted registry, and how the project
might fund itself," for the full reasoning.

## Naming and domains

- npm scope: `@goodboyjs/*` — the bare name `goodboy` was already taken on
  npm.
- Terminal command stays `goodboy` regardless of npm scope.
- GitHub org: `xpera-ch`.

## Ecosystem and standards

- Built against the **Agent Skills open standard** (agentskills.io) —
  GoodBoy doesn't define its own skill format or compete with the standard;
  it manages skills that already conform to it (see README's "How it
  works").
- `gh skill`'s supply-chain conventions — SHA provenance, pinning, and
  immutable releases — are a reference point for interoperability. Not yet
  adopted; worth comparing against now that the integrity-verification work
  has landed, since GoodBoy's hashing solves an adjacent but distinct
  problem (local tamper detection vs. source provenance).
