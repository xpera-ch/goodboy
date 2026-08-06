# Product Positioning

**Provenance note:** ported from Claude's memory of a prior planning chat
(a claude.ai Chat project, not this repo), same caveat as `docs/roadmap.md`
— treat as a recovered draft, verify before treating as locked.

**Competitive-landscape refresh (2026-08-05):** the "Core differentiators"
and "Ecosystem and standards" sections below were updated against an
external review's findings — distinct from the provenance note above, this
part reflects the field as of this date, not a recovered chat memory. See
`docs/backlog.md` ("Competitive landscape has moved since
`product-positioning.md` was written") for the full research this update is
based on.

## What GoodBoy is

A personal skill registry and package manager for Claude Code and the Agent
Skills ecosystem — "npm for Claude Code skills." Scoped deliberately to the
skill side of the ecosystem only; it does not manage `.claude/agents/`
subagent definitions.

## Core differentiators (vs. `skills.sh` and `gh skill`)

As of mid-2026 the installer role is no longer open ground: **Vercel**
shipped `npx skills` plus the `skills.sh` directory/leaderboard, reportedly
installing across 18+ agents (Claude Code, Copilot CLI, Codex, Cursor, and
others); **GitHub** shipped `gh skill` as an official `gh` CLI preview
(`add`/`publish`/`search`/`preview`), explicitly spec-compatible with
Vercel's tool; and a wider community field (PolySkill, Skilldex, Lola, and
assorted community CLIs) has grown alongside a package count reported in the
hundreds of thousands by early 2026.

Read correctly, this is validation of the underlying problem, not
refutation of the project — three separate, well-resourced teams building
tooling for the same gap in roughly one quarter is strong evidence the gap
is real. What it does settle is that GoodBoy should not compete on *install*
— first-party tools have already taken that role, for free, at a scale a
personal registry tool has no reason to chase. That sharpens rather than
weakens the differentiators below, since the installer question is now
someone else's job to answer:

- **Intelligent dispatcher (vision, not yet built):** analyze project
  context (`CLAUDE.md`, `package.json`, file structure) and propose which
  skills from the user's private registry belong in the current project.
- **Personal private registry as center of gravity:** bidirectional skill
  flow between registry and projects, across machines — not just a
  one-directional install source.
- **Deployment ledger:** tracks which skill versions are deployed to which
  projects, answering drift questions. (Partially built — see
  `docs/backlog.md` for the integrity-verification gap; the bundling-deps
  ledger in `docs/roadmap.md` extends this further.)
- **Promote-back workflow:** local edits to installed skills can be
  promoted back to the registry and rolled out to other projects. Not yet
  built — see `docs/roadmap.md`.
- **Framing:** apt-vs-Ansible. `skills.sh` / `gh skill` are package
  installers; GoodBoy is configuration management — "does what's installed
  still match what I meant to install, across every project and machine," a
  question neither first-party installer asks at all.

## Competitive positioning boundary

GoodBoy should **not** build a public marketplace or search index. It
searches the user's own registry natively and accepts URLs found through
external catalogs. This is a deliberate scope boundary, not a
not-yet-gotten-to feature — see the "no network effects" principle in
`CLAUDE.md`. The 2026-08 competitive landscape strengthens this boundary
rather than calling it into question: `skills.sh` and `gh skill` now run the
marketplace/discovery role at a scale GoodBoy was never trying to compete
at, which means GoodBoy never has to build one — it can stay the
configuration-management layer on top of catalogs someone else maintains.

## Repository topology

- **Public `goodboy` monorepo** (this repo): `packages/cli`,
  `packages/schema`, `packages/registry-client` — open source, contributors
  welcome once public (see `docs/go-public-checklist.md`).
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
- `gh skill`'s provenance-frontmatter conventions are a reference point for
  interoperability (SHA provenance and pinning) — not yet adopted, worth
  comparing against when the integrity-verification work in
  `docs/backlog.md` lands.
- Git-based transport for installs is deliberately host-agnostic — covers
  any git host, not just GitHub, since some target users (e.g. agency
  clients) run self-hosted git infrastructure.
- **Competitive reference points:** `skills.sh`/`npx skills` (Vercel,
  marketplace-oriented, reportedly 18+ agents supported) and `gh skill`
  (official `gh` CLI preview, supply-chain-grade with SHA provenance and
  pinning, explicitly spec-compatible with Vercel's tool) — both are useful
  comparisons for what GoodBoy deliberately is and isn't. A wider community
  field (PolySkill, Skilldex, Lola, and others) exists alongside a package
  count reported in the hundreds of thousands by early 2026, underscoring
  that GoodBoy is deliberately not trying to be a catalog among catalogs.
