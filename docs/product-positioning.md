# Product Positioning

**Provenance note:** ported from Claude's memory of a prior planning chat
(a claude.ai Chat project, not this repo), same caveat as `docs/roadmap.md`
— treat as a recovered draft, verify before treating as locked.

**Competitive-landscape refresh (2026-08-05):** the "Core differentiators"
and "Ecosystem and standards" sections were updated against an external
review's findings — distinct from the provenance note above, this part
reflects the field as researched on that date, not a recovered chat memory.

**Second refresh and correction (2026-08-09):** the differentiators were
re-derived against the competitors' *actual current feature sets* rather
than their general positioning, which changed the conclusions materially —
see below. The "public marketplace" section was **corrected by Bruno** on
the same date: the previous wording overstated a sequencing decision as a
permanent boundary. Those two sections are now confirmed rather than
recovered.

## What GoodBoy is

A personal skill registry and package manager for Claude Code and the Agent
Skills ecosystem. Scoped deliberately to the skill side of the ecosystem
only; it does not manage `.claude/agents/` subagent definitions.

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
GoodBoy should not compete on *installation* — that role is taken, for
free, at a scale a personal registry tool has no reason to chase.

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
   `~/.goodboy/registry` is the centre of gravity, with bidirectional flow
   between registry and projects across machines, not a one-directional
   install source. Neither competitor has an equivalent: Vercel's discovery
   is public and telemetry-driven; `gh skill` is GitHub repositories.

3. **Git-host-agnostic, and fully usable with no remote host at all —
   BUILT, and not previously claimed.** `gh skill` is GitHub-only; Vercel's
   lockfile is keyed on GitHub tree SHAs. For self-hosted git
   infrastructure — agency clients, regulated environments, anyone who
   cannot put internal skills on github.com — **neither tool works at
   all.** GoodBoy does, including entirely offline against a local
   registry. This was previously buried as an implementation note under
   "Ecosystem and standards"; it is a positioning claim.

4. **Promote-back workflow — NOT BUILT.** Local edits to installed skills
   promoted back to the registry and rolled out to other projects. See
   `docs/roadmap.md`. Roadmap, not a current claim.

5. **Intelligent dispatcher — NOT BUILT, vision only.** Analyse project
   context (`CLAUDE.md`, `package.json`, file structure) and propose which
   skills from the user's private registry belong in the current project.
   Roadmap, not a current claim.

**On the apt-vs-Ansible framing** (`skills.sh` / `gh skill` are package
installers; GoodBoy is configuration management): still true, but thinner
than when first written. Pinning and lockfiles are themselves
configuration-management behaviours, so the distinction now has to be
*argued* rather than asserted. Lead with differentiator 1 — a concrete
capability nobody else has — and use the analogy as support, not as the
opening claim.

## Public marketplace: sequencing, not a boundary

**Corrected 2026-08-09 by Bruno.** The previous version of this section
said GoodBoy should **not** build a public marketplace or search index, and
called it "a deliberate scope boundary, not a not-yet-gotten-to feature."
**That overstated the actual decision and is withdrawn.**

The real position: **a public marketplace is planned, but not for the first
release.** v1 ships without one. Building it is contingent on the product
finding a market first. This is a small operation with limited resources,
and investing in marketplace infrastructure ahead of demand would spend the
scarcest available resource on the least certain bet.

GoodBoy is **not** attempting to compete head-on with Vercel or GitHub on
distribution, and must not be positioned as doing so. Those are
differently-resourced organisations, and that contest is neither winnable
nor worth entering. The stated posture is straightforward: build something
genuinely useful for a real problem, find out whether it finds users, and
treat either outcome as worthwhile — if it finds a market, the marketplace
becomes worth building; if it doesn't, the work and the learning still
stand.

Until then, GoodBoy searches the user's own registry natively and accepts
skills found through external catalogs — which now includes `skills.sh` and
`gh skill search`. **Treat that as an interoperability opportunity, not a
concession:** those catalogs solve discovery, and a tool that consumes them
cleanly gets discovery without operating a catalog. `goodboy adopt`
(`docs/backlog.md`) is what makes consuming them practical, and is
load-bearing for this position.

**Note for anyone updating `CLAUDE.md`:** it currently carries the
withdrawn stronger claim as a standing principle — *"GoodBoy should not
compete on network effects (no public marketplace/search index)."* That
needs correcting to match this section. Tracked in
`docs/prompts/D3-rewrite-claude-md-public.md`.

## Repository topology

- **Public `goodboy` monorepo** (this repo): `packages/cli`,
  `packages/schema`, `packages/registry-client` — open source, contributors
  welcome once public (see `docs/go-public-checklist.md`).
  `registry-client` is being withdrawn from npm until the hosted API
  exists — see `docs/backlog.md`; it remains in the monorepo.
- **Separate private `goodboy-registry-api` repo** (closed-source,
  monetization path — mirrors npm's own public-registry/private-registry
  split). The seam between the public CLI/schema and this private API is an
  HTTP API contract (OpenAPI spec) — the CLI and the registry server are not
  expected to share code, only the API shape.
- **Personal skill registry** (default `~/.goodboy/registry`) plus a
  **shared-private registry** (core-contributors read+write, consumed via a
  pinned git submodule) — the first real instance of the multi-registry
  capability described in `docs/roadmap.md`.

## Naming and domains

- npm scope: `@goodboyjs/*` — the bare name `goodboy` was already taken on
  npm.
- Terminal command stays `goodboy` regardless of npm scope.
- Domains: goodboy.com / .net / .info / .io.
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
- Git-based transport is deliberately host-agnostic — now promoted to
  differentiator 3 rather than being a footnote here.
