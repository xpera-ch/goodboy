# Decision log

Chronological record of decisions that shaped GoodBoy — what was decided,
when, why, and what would reopen it.

**Why this file exists.** Decisions were previously scattered across
`docs/backlog.md`, `docs/product-positioning.md`, and
`docs/concept-secrets.md`'s own §7, which meant a decision could be
reversed by someone who never found the original reasoning — and twice
already, a "recovered draft" recorded something stronger than what was
actually decided. This is the single place to look first.

**Conventions.** Newest first. Each entry states the decision, the
reasoning, and — where it matters — the condition that would reopen it. A
decision reversed later is **not** edited; a new entry supersedes it, and
the old one gains a superseded pointer. The record of a changed mind is
worth more than a tidy list.

Feature-level decision records still live in their own `docs/concept-*.md`
files; this log carries project-level decisions and links to those.

---

## 2026-08-19 — Contributor workflow skills shipped via GoodBoy itself, not `.claude/skills/`; committed and verified

**Decided (Bruno):** `CLAUDE.md`'s "Standard workflow" section requires four
skills (`commit-creation`, `phase-prompt`, `adversarial-review`,
`security-impact`) that existed only as Bruno's personal account skills —
false when the section claimed they're "installed globally, so any Claude
session should already have them." Committing them straight into
`.claude/skills/` was considered and rejected: GoodBoy's premise is that
skills shouldn't be hand-placed folders you copy around, and shipping them
that way in GoodBoy's own repo would contradict the product it builds.

**Chosen instead:** ship each as a ready-to-install directory —
`SKILL.md` plus a hand-authored `manifest.json` — under `contributor-skills/`,
onboarded with `goodboy add` (not `goodboy adopt`: `adopt` interactively
asks the person running it for their own name as "author," which would be
wrong here — Bruno is the actual author, not whichever contributor runs the
command; `add` reads an already-correct manifest, no prompts). Framed
explicitly in `CONTRIBUTING.md` as a stopgap until a public registry exists
(`docs/roadmap.md`, "Exploratory: a hosted registry").

**Manifests:** `version: "1.0.0"`, `license: "MIT"`, `author: { name: "Bruno
Schriber" }` (no email — avoids publishing one in a structured,
machine-readable field; git history will carry it either way once public),
`status: "stable"` (actively used, not experimental), `schema_version:
"2.0.0"`. `category`/`keywords` deliberately omitted rather than guessed;
proposed for later: `commit-creation` → other, `phase-prompt` → devops,
`adversarial-review` → security, `security-impact` → security.

**Reviewed before commit, independently:** diff read directly against the
report's claims. `contributor-skills/phase-prompt/SKILL.md` matched the
exact byte count (4345) observed from the source directory before the phase
ran. `install.ts:232`'s `[skill-name]` argument confirmed non-variadic by
reading the command definition — the implementer's correction (four
separate `goodboy install` calls, not one) is accurate, not a
workaround for nothing.

**Wording follow-up, same session:** the first draft of the new
`CONTRIBUTING.md` section called these "four Claude Code skills" — the same
overclaim already fixed in `product-positioning.md` and the CLI description
this same day. Corrected via a second, small phase-prompt before the commit
landed, to lead with the open Agent Skills standard (agentskills.io) and
name Codex/Gemini explicitly rather than implying portability by omission.

**Committed:** `c69c0de` — one commit, `contributor-skills/` +
`CONTRIBUTING.md` together, both edits included.

**New finding, not yet actioned:** `packages/cli/src/lib/skill-validator.ts`'s
`parseFrontmatter` is a naive line-by-line parser, not real YAML — it
doesn't resolve YAML folded (`>`) or literal (`|`) block scalars. A
`SKILL.md` using `description: >` (all four skills shipped here included)
has its frontmatter description parsed as the literal `>` character, not
the real text, which spuriously fails the "SKILL.md description matches
manifest.json description" check on every `goodboy add`/`install`. Cosmetic
today — a warning, not a hard error, confirmed by reading the parser
directly — but a real pre-existing bug, unrelated to this phase.
Backlog candidate.

## 2026-08-19 — Dead `--registry` option removed and the "for Claude Code" overclaim fixed everywhere it shipped; both independently verified and committed

Two phase-prompts executed via Claude Code CLI, both reviewed here (diff
read directly, not taken on the implementer's report alone) before being
treated as closed:

**`remove-dead-registry-option`** — `goodboy init --registry <url>` and the
`GoodBoyJson.registry` field removed (see the entry below for the original
finding and reasoning). Landed as two commits, `0ae484e` (CLI) and `ef4a955`
(schema, `src/` and `versions/v1/` in lockstep — verified against
`schema-identity.test.ts`'s byte-identity guard, which is what actually
settled the no-version-bump call, not just plausible reasoning). Reviewed:
diff matches the prompt exactly, no dead `registry` references remain
anywhere in `packages/cli/src` or `packages/schema/src` (repo-wide grep),
`security-impact` correctly flagged `goodboy-file.ts` and found no weakened
invariant.

**`fix-cli-help-description`** — the same "for Claude Code" / "package
manager" / "dispatcher" overclaim `docs/product-positioning.md` was
corrected for also shipped in five live, public-facing strings: `goodboy
--help` (`packages/cli/src/index.ts`), both `package.json` "description"
fields (root and `packages/cli`, kept byte-identical to each other), the
`README.md` tagline, and the `v0.1.0` git-tag template in `PUBLISHING.md`.
All five fixed together in one commit (`2aa512f`) with
`docs/product-positioning.md`'s wording reused verbatim rather than five
independent rewrites. Two adjacent problems found in `PUBLISHING.md` were
deliberately left alone and flagged instead: the tag template's hardcoded
`352 tests · 99.7% coverage` (stale — 755 as of this pass) and
`https://goodboy.io` (wrong domain — `goodboyjs.com`, not yet live). Both
remain open, unscheduled.

**Independent test/coverage verification** — a third, read-only prompt
(`verify-registry-removal-tests`) re-ran the full suite against the
committed state from a clean invocation, since the original report's
numbers hadn't been reproduced by anyone else. Reproduced exactly: 755
tests / 34 files, coverage 100/99.82/100/100, `goodboy-file.ts` at
93/93 statements, 18/18 branch nodes (36/36 arms), 14/14 functions, the
sole remaining gap at the pre-existing `registry-adapter.ts:73`. No
mismatch found anywhere against the original report.

**Process note, corrected mid-session:** the executed
`remove-dead-registry-option` prompt was briefly hand-edited after it had
already run, to resolve an ambiguity it had left open (the `versions/v1`
question). That violated this project's own rule that an executed prompt is
immutable — caught by Bruno, reverted to the exact text the implementer
actually worked from. The `versions/v1` clarification instead went into the
next prompt fresh, and into the chat answer directly, not into the already-run
file.

## 2026-08-19 — `docs/roadmap.md` fact-checked against the codebase; dead `--registry` option scheduled for removal

Bruno asked for the technical claims in `docs/roadmap.md` to be checked
against the actual TypeScript source rather than taken on faith. Findings
and fixes:

- **"Pending command restructure" section was entirely stale.** Both listed
  items (`goodboy init`, `goodboy skill create`) were already implemented,
  confirmed against `init.ts` and `skill-create.ts`. Removed the section.
- **"GoodBoy-managed bundling dependencies" read as current design with no
  confidence signal.** Nothing in it is implemented. Added an explicit
  "Confidence tier: exploratory" line up front, matching the convention used
  elsewhere in this file.
- **The bundling-dependencies "Terminology correction" claimed
  `GoodBoyLockEntry` has a `resolved` field.** Checked
  `packages/cli/src/lib/goodboy-file.ts`: the actual type is `{ version:
  string; integrity?: string }` — no `resolved` field exists. That field was
  part of an earlier 0.2.0-era lock format, since removed; strict validation
  now rejects it. Fixed here and in the "Registry layout: flat" section,
  which cited the same nonexistent field as a reason the flat-layout
  decision is safe to keep.
- **"Lower-priority backlog" listed `goodboy registry remove` as unbuilt.**
  Checked `packages/cli/src/commands/registry-cmd.ts`: the command is fully
  implemented today — removes one version or the whole skill and rewrites
  the registry entry. Reworded the item to what's actually unbuilt: the
  immutability/version-burning *policy* for a future public registry, not
  the removal mechanism itself.
- **`goodboy init --registry <url>` writes a `registry` field into
  `goodboy.json` that is never read back anywhere — confirmed dead code.**
  Bruno's call: don't let it block the release by trying to build the real
  feature now, and don't ship dead code either. Removing the option and the
  field from `packages/cli/src/commands/init.ts` /
  `packages/cli/src/lib/goodboy-file.ts` (a source change, drafted as a
  phase-prompt rather than edited directly from this session, per this
  file's operating policy). Recorded the real, still-valuable version of the
  idea — a per-project registry override pinned in `goodboy.json` instead of
  relying on the ambient `GOODBOY_REGISTRY` env var — in `docs/roadmap.md`'s
  "Multi-registry support" section, explicitly not-yet-built.

## 2026-08-19 — `docs/product-positioning.md` and `docs/roadmap.md` reviewed line by line with Bruno

Both files were un-gitignored for public release (2026-08-18) and then
actually read, not just tracked. Findings and fixes:

- **"What GoodBoy is" led with a vendor name and an overclaimed category.**
  Named Claude Code specifically, contradicting the project's actual
  multi-agent support (`agents.ts` already installs into `.claude/skills/`,
  `.codex/skills/`, `.agents/skills/`); called itself a "package manager,"
  which implies dependency resolution GoodBoy deliberately doesn't do.
  Rewritten as "a personal skill manager — registry and installer — for AI
  agents built on the Agent Skills standard," Bruno's wording.
- **The differentiator pitch came after the discouraging part, not before.**
  "Competitive landscape" led with everything three funded competitors
  already ship, and a reader skimming or quoting an excerpt (as Bruno did,
  mid-review) never reached the answer. Moved the actual differentiator —
  local integrity/drift verification, offline and git-host-agnostic
  operation — into "What GoodBoy is," ahead of the competitor list.
- **Two "GoodBoy doesn't compete on installation" sentences accidentally
  implied GoodBoy doesn't install.** It does — the same as both
  competitors; installation just isn't the differentiator anymore. Bruno
  caught both instances; reworded to say that explicitly.
- **Repository topology overstated an undecided idea as settled fact.**
  `product-positioning.md` described a private `goodboy-registry-api` repo
  as existing project topology; `roadmap.md`'s own "Exploratory" section
  already said the opposite and had flagged the contradiction itself
  (2026-08-17). Confirmed with Bruno: it's one idea for funding the
  project's maintenance, not a decision. Both files now say so.
- **The "Public marketplace: sequencing, not a boundary" section was cut
  down to match.** It argued a specific competitive strategy for a feature
  that isn't decided — collapsed to a short "idea, not decided, might share
  a platform with the registry-API idea" note, consistent with the
  repository-topology fix above. This also removed a dead cross-reference
  to `docs/prompts/D3-rewrite-claude-md-public.md` (that work finished
  2026-08-17) — `CLAUDE.md`'s own pointer to this section for "the
  reasoning and current state" still resolves to real content.
- **Differentiator 2 claimed "bidirectional flow between registry and
  projects across machines," contradicting differentiator 4's "promote-back
  — NOT BUILT."** Confirmed with Bruno: there is no bidirectional flow —
  skills are developed in their own source directory, never edited in place
  in a project or the registry, and published to the registry deliberately.
  Reworded to state that instead.
- **All four "provenance note" / "refresh" paragraphs removed from both
  files.** Editorial commentary about the documents' own recovered-draft
  status and edit history, not information about the product — same
  category of internal-process leakage already stripped from `CLAUDE.md`.
  Their substantive content was already duplicated inline where it actually
  mattered (e.g. the public-marketplace correction restated in that
  section itself), so nothing was lost by removing the summaries.
- **Differentiator 3 overstated what "git-host-agnostic" actually means —
  found by Bruno, verified against the source.** The text implied GoodBoy
  can be pointed at a remote git host directly (self-hosted GitLab, Gitea,
  etc.). Checked `packages/cli/src/lib/local-registry-adapter.ts`:
  `LocalRegistryAdapter` is explicitly "Phase 1... resolves skills from a
  local git-based registry... replace with `RemoteRegistryAdapter` in
  Phase 3" — not built. `getRegistryPath()` requires `GOODBOY_REGISTRY` to
  be an existing absolute local path; no network call exists anywhere in
  registry resolution. Reworded in both places it appeared: the registry is
  a local directory, full stop — if that directory happens to be a git
  checkout of something self-hosted, that's the user's own `git
  clone`/`git submodule` setup, entirely outside GoodBoy's code.
- **Stale domain list removed.** `product-positioning.md` listed
  `goodboy.com/.net/.info/.io`; the real domain is `goodboyjs.com`, not yet
  live. Bruno: don't mention a domain at all until there's a live site.

**What survives this pass:** the honest built/not-built accounting in
"Core differentiators," the dated competitive-landscape research, and the
"read the field as validation, not refutation" framing — all confirmed
accurate, not just left alone by default.

---

## 2026-08-19 — Convention preserved: confirmed roadmap items graduate into `docs/concept-*.md`

Carried over from `docs/roadmap.md`'s "Provenance note," removed in the
review above along with the rest of that note's editorial-history framing.
The one substantive rule inside it is real and still applies: once a
roadmap item moves from speculative to confirmed, it should get its own
`docs/concept-*.md` file — the same shape as `docs/concept-secrets.md`,
which is itself withdrawn but kept specifically as the worked example of
that format. Recording it here so the convention has a home now that the
note carrying it is gone.

**Not yet applied to anything** — no roadmap item has graduated yet; this
is the standing rule for when one does, not a record of it happening.

---

## 2026-08-18 — `docs/` is gitignored, not part of what ships publicly. CONTRIBUTING.md stays as-is

**Decided (Bruno):** `docs/` (the whole directory — `backlog.md`,
`decisions.md`, `go-public-checklist.md`, `product-positioning.md`,
`roadmap.md`, `concept-secrets.md`, `project-file-schemas-handoff.md`, plus
the already-gitignored `prompts/` and `reviews/`) is removed from git
tracking and added to `.gitignore`. Nothing is deleted from disk — the
files stay exactly where they are, in the maintainer's local checkout, and
keep working the same way locally. Going public means shipping `README.md`
and `CLAUDE.md` from the repo root; `docs/` is maintainer-local planning
material, not part of the release. `CONTRIBUTING.md` is unaffected — it
stays committed and public, distinct from the still-undecided question of
how skill-sharing/contribution actually works once there's a public
registry or actual contributors to design it for.

**Reasoning:** the alternative was reviewing and trimming every file in
`docs/` line by line before the repo could go public — real work, already
partway done (see the "Repo content review (root + docs/ trim)" section of
`docs/go-public-checklist.md`, now superseded by this decision) — for
content that exists to serve the maintainer's own working process, not a
first-time visitor. Not shipping it is simpler than sanitising it, and
nothing about `goodboy` the tool depends on a stranger being able to read
the maintainer's backlog.

**Consequence — this does not by itself hide `docs/` history.** All ten
files were already committed in earlier commits; gitignoring stops future
tracking but every prior version is still reachable via `git log`/`git
show` on any clone once the repo is public. Bruno's call: also purge
`docs/` from git history entirely before flipping visibility, rather than
accept that exposure — a bigger, separate operation (rewrites every commit
hash), tracked as its own item, own dedicated session, in
`docs/go-public-checklist.md` and `docs/prompts/SEQUENCE.md`. This
supersedes the History audit's 2026-08-17 "No history rewrite required"
verdict — that verdict was about finding nothing secret, which still
holds; this is a different reason to rewrite history (removing a directory
wholesale, not responding to a finding).

**What would reopen this:** if the project later wants `docs/` (or
specific files from it) to be public-facing again — e.g. the decision log
or roadmap as a deliberate transparency feature — this entry is what to
supersede, and the earlier per-file `docs/` trim work in
`go-public-checklist.md` would need picking back up.

---

## 2026-08-19 — Clarified: plain standard English, not a no-pronoun policy. Supersedes the entry below

**Decided (Bruno):** the 2026-08-18 entry below overstated the actual
position — it read as a rule against ever tying a pronoun to a role, which
is not what was meant. The actual position: this project uses ordinary,
standard English, nothing special. It does not participate in
gender-identity language politics — no invented gender-neutral pronoun
conventions, no `they`/`them` adopted as a deliberate degendering choice, no
discussion of pronoun policy in the documentation either way. Where a
pronoun occurs naturally in plain English, that's unremarkable and needs no
avoidance or engineering around it.

**Practical effect:** no new sweep is needed. The specific rewordings made
under the 2026-08-18 entry (naming Bruno directly instead of using a
pronoun in a couple of spots) already read as normal English and stay as
they are. Going forward, pronoun choice is not a topic this project's
documentation makes a statement about, in either direction.

---

## 2026-08-18 — Documentation describes roles, not people; no pronouns tied to a role

**Superseded 2026-08-19** — see the entry above. This entry's framing (a
rule against tying any pronoun to a role) overstated Bruno's actual
position; kept below for the record of what was said at the time.

**Decided (Bruno):** project documentation refers to roles (the maintainer,
a contributor, a reviewer) rather than to people, and does not use a
pronoun for a role — a role can be filled by a person or by an agent, so
tying it to `he`/`she`/`they` is a claim the project doesn't make. This
applies across the tracked docs, not just `CLAUDE.md`.

**Trigger:** the 2026-08-17 entry below, on renaming "Bruno" to "the
maintainer" in `CLAUDE.md`, itself framed the change partly around
replacing gendered pronouns. Bruno's correction: that framing doesn't
belong in this project at all — it's a technical project, not a venue for
commentary on gendered language, and the entry has been reworded below to
state the actual reason (roles vs. people) without raising the topic it
doesn't need to raise.

**Swept:** stray `he`/`his`/`him` referring to Bruno as an individual, found
in three places outside the entry above — `docs/decisions.md` (two more
spots, both narrating what Bruno said or flagged), `docs/backlog.md` (one
spot), and the superseded, never-executed
`docs/prompts/D3-rewrite-claude-md-public.md` — reworded to name Bruno
directly instead of using a pronoun.

**Not swept:** five instances in `docs/prompts/done/**` and
`docs/reviews/`, all referring to Bruno. Left alone because those are
executed prompts and a filed review report — this project's own rule is
that an executed prompt is immutable and a review report is a record of
what was actually said at the time, not a live document to keep current.
Revisit only if Bruno decides that rule should have an exception here.

**Scope check:** `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`,
`PUBLISHING.md`, `SECURITY.md`, `docs/product-positioning.md`,
`docs/concept-secrets.md`, `docs/go-public-checklist.md`, `docs/roadmap.md`,
and `CLAUDE.md` itself were checked and already carried none of this.

---

## 2026-08-17 — `CLAUDE.md` addresses "the maintainer," not Bruno by name. Reverses a same-day decision

**Decided (Bruno):** every instance of "Bruno" in `CLAUDE.md` is replaced
with "the maintainer" (nine instances, all forward-facing operating
instructions or provenance notes — none were decision-log entries), with the
surrounding text reworded so it reads correctly for a role rather than a
named individual.

**Reasoning:** `CLAUDE.md` describes roles, not people — "the maintainer,"
like every role it names, may be filled by a person or by an agent, and
isn't tied to any one individual. A prospective contributor reading
`CLAUDE.md` should read themselves into the operating rules — "the
maintainer reviews it and executes it" describes a role anyone (or
anything) can occupy, "Bruno reviews it" describes one specific person the
reader is not. The file's whole purpose past the flip is to be read by
people who are not Bruno; naming Bruno throughout works against that
regardless of how accurate it is today.

**This reverses a call made earlier the same session.** Asked directly
whether to keep third-person "Bruno" or neutralise it, the first answer was
keep it — "that is fine, since I'm the initiator and also the currently
only developer." That answer held until a second read of the file, on its
own, surfaced the same objection this entry now records. The earlier call
was never written into this log (it was answered inline and not treated as
a durable decision), so there is nothing to mark superseded — this is the
first and only decision on it.

**Scope: `CLAUDE.md` only, for now.** `docs/decisions.md` and
`docs/backlog.md` are unaffected and keep real attribution — they are a
decision log and a known-limitations tracker, where recording *who* decided
or found something is the point, not an address to the reader. Whether the
same treatment should reach `CONTRIBUTING.md`, `README.md`, or elsewhere
was not raised and is not decided here.

**What would reopen this:** if the project ever wants CLAUDE.md to read as
personally authored again — a deliberate stylistic choice, not an oversight
— this entry is what to supersede.

---

## 2026-08-17 — `CLAUDE.md` "Working principles" reviewed line by line with Bruno

The go-public review of `CLAUDE.md` was closed once already the same day on
the wrong evidence (the public rewrite having landed in git, not Bruno
having read it) — see `docs/backlog.md`, which records that mistake and
reopened the item. This entry is the actual review that followed: every
bullet in "Working principles" read aloud and decided, not inferred.

- **"Claude as active technical collaborator" — removed entirely.**
  Bruno: it was an early, deliberate test of the clause's effect on agent
  behaviour, not a standing preference. Agent behaviour is now better
  structured than when the clause was written, so it's obsolete rather than
  superseded by anything that needs to replace it.
- **"Development happens in the skill source directory" — reworded.**
  Dropped the forward reference to `goodboy link`, a roadmap item that
  doesn't exist yet. Restated as a plain, factual recommendation instead of
  a claim resting on an unbuilt feature.
- **"Concept first, implementation second" and "Adversarial review
  non-negotiable" — kept unchanged**, no discussion needed.
- **"Nothing half-baked" (three-instances list) — kept**, but its
  registry/funding tangent moved to `docs/roadmap.md` (see the next entry
  below) — it's product speculation, not an engineering-discipline lesson,
  and doesn't belong in an agent-instruction file.
- **"A guard is not done until observed failing" — kept as written.** Two
  of its four cited gates are still open; Bruno's call was to schedule the
  fixes (`docs/backlog.md`, "Two of the four 'gates that could never
  fail'...", now first in `docs/prompts/SEQUENCE.md`) rather than reword
  the principle around them — the sentence says *found*, not *fixed*, so it
  stays accurate either way.
- **"A fact stored in two places" — rewritten**, at Bruno's request, after
  Bruno flagged the original wording as too vague to follow. The three
  examples went from unexplained fragments to full sentences, and the
  third (the sensitive-files list, still duplicated between
  `security-sensitive.json` and `CONTRIBUTING.md` today) is now correctly
  marked open rather than implied closed alongside the other two.
- **"Atomic commands over magic" — reworded**, dropping a personal-shorthand
  reference ("Option B") that only made sense inside one prior conversation.
- **"No public marketplace" — cut to the rule only.** Bruno: CLAUDE.md
  should carry the operating consequence, not the supporting narrative —
  the reasoning already lives in `docs/product-positioning.md` and
  restating it here is the exact two-places-drift failure the adjacent
  principle warns about. This coincidentally executed the fix
  `product-positioning.md` had already flagged as owed to `CLAUDE.md` (see
  "Public marketplace: sequencing, not a boundary", 2026-08-09).
- **"Prompt-injection vigilance" — rewritten.** Bruno corrected the
  rationale I'd supplied: GoodBoy's primary purpose is making reusable
  agent skills easy to create, version, discover, share and install across
  tools and projects — for an agent, a human, or another tool, whichever
  the user prefers — not primarily "moving third-party prose to a machine
  an agent will read." The latter was my framing, not Bruno's; corrected on
  the spot.

**The section's own caveat is retired.** "Carried over from prior planning
sessions... treat as a recovered draft... correct anything that's drifted"
no longer applies — it's been read, corrected, and confirmed.

**Not covered by this pass, and not claimed as resolved:** the Operating
Policy section's tone, the schema-scar note's candour, whether the file's
overall length is right for a public root document, and whether option (b)
— a public/private split — is worth revisiting. Bruno reviewed the whole
file and didn't raise these, so they're not blocking, but they were not
specifically discussed and shouldn't be read as decided.

**What would reopen this:** any future edit to "Working principles" should
update this entry rather than silently drift from it — that's the pattern
this whole review exists to prevent.

## 2026-08-17 — `docs/` trim for go-public: four files decided, two findings salvaged

The go-public checklist framed the `docs/` review as a file-by-file keep or
trim call. Four files were still undecided — two of them had never been in
the list at all. Decided together, since the reasoning is the same one applied
four times: **does this document describe the product, or the process of
building it in a particular week?**

- **`skill-authoring-handoff.md` — REMOVE.** It is a chat-to-chat handoff
  ("transfer context to a NEW chat" … "First action for the new chat"), a
  genre that does not survive publication. It also documents skills that live
  in a *separate plugin*, not this repo, and carried three stale claims —
  "Node 20/22" against a Node 24 floor, "Repo (private)", and a
  `security-impact` design naming `CONTRIBUTING.md` as the machine-read source
  of truth, a decision since reversed and shipped as `security-sensitive.json`.
  It also held the last tracked `/Users/bruno/…` path and a line of personal
  biography. Two findings salvaged below before deletion.
- **`goodboy-ecosystem-analyzer-notes.md` — FOLD INTO `roadmap.md`, then
  remove.** The content is on-message — the vendor-neutral framing is the
  product's actual differentiator — but the file self-labels as "idea for
  future discussion only" and publishes brainstorm lists. A reader cannot tell
  roadmap from daydream when the two live in different files at different
  confidence levels. One roadmap with an explicit exploratory tier fixes that.
- **`project-file-schemas-handoff.md` — KEEP, re-headed as RESOLVED.** Never
  reviewed before; an omission rather than a keep. Unlike the other handoffs
  it is real verified engineering (claims checked against `8d367eb`, quoted
  code, line numbers). But it declared "nothing here has been decided" about a
  gap C4a/C4b/C4c has since closed — publishing it unchanged would advertise a
  validation hole that no longer exists. Re-headed, same treatment
  `concept-secrets.md` got.
- **`goodboy-skill-packaging-bug.md` — REMOVE** (already deleted). A bug
  report against Cowork's skill packaging, filed in GoodBoy's repo, and
  addressed to "the goodboy project (the plugin shipping …)" — using the name
  to mean the plugin rather than this package manager. A visitor would read it
  as evidence that GoodBoy ships broken skills. Good document, wrong repo.

**The rule this establishes**, for the next doc that needs the call: a
document earns its place in a public repo if it explains a decision, a
constraint, or a defect that still shapes the code. It does not earn its place
by having been useful once.

**Reopens if:** a removed document turns out to hold reasoning that is not
recorded anywhere else. Both salvage candidates were checked; see below.

### Two findings salvaged from `skill-authoring-handoff.md`

Recorded here because they were true, hard-won, and written down in only one
place — the file being deleted.

**Prototype-pollution probes must build their payload with `JSON.parse`, never
an object literal.** An object-literal `__proto__` is a prototype *setter*, not
an own property, so the probe silently tests nothing and reports a pass. This
was made once during the S1 review, disclosed, and avoided in S2 only because
it had been written into the prompt by hand. It must not be learned a third
time; it belongs in the `adversarial-review` skill's `references/known-traps.md`.

**`disable-model-invocation` is not part of the Agent Skills standard.**
Checked directly against the validator source — the allowed frontmatter
properties are `name`, `description`, `license`, `allowed-tools`, `metadata`
and `compatibility`. A recovered plan had specified it at the top level of
skill frontmatter. Adding it would repeat exactly the mistake this project
already has a scar from: inventing a field the standard does not define (see
the schema 2.0.0 entry). Deliberate-invocation-only is achieved through
wording in `description` instead.

---

## 2026-08-17 — Shared-path uninstall message describes the convention, never names a co-reader agent

**Decided (Bruno):** when `removeAgentSymlinks` asks for confirmation
before removing a symlink under a path more than one agent's entry in
`AGENT_SKILL_DIRS` points at, the message must describe the shared
convention directory (e.g. "part of the shared `~/.agents/skills`
convention") and never name a specific agent product (the previous
wording: `"also read by: gemini"`).

**What prompted it.** Found by Bruno running the C6 checklist's §11
(agent visibility) against a Codex uninstall. Two objections, one style
and one substantive: naming products creates a list GoodBoy would have to
keep accurate as more `--<agent>` flags are added — exactly the
maintenance burden the `agents` escape-hatch key was already invented to
avoid elsewhere in this file (`AGENT_SKILL_DIRS`). More importantly,
`agentsSharingPath`'s own comment already states GoodBoy "cannot know
which other tools actually read a directory" — the map records which
agent flags *could* point at a path, not which ones are actually
installed for a given skill. `"also read by: gemini"` can print even when
gemini was never installed for that skill, which is a correctness problem
dressed as a wording problem, not merely a preference.

**Not changed:** the `shared` classification itself (`agentsSharingPath`,
more than one agent's list containing the path) and the confirmation
gate's behavior (decline still aborts the whole removal with zero side
effects) — this only changes what the message *says*, not when it's shown
or what happens on decline. Exact string left to the implementer;
Bruno explicitly does not want to gate this on wording review.

**Bundled with an unrelated fix in the same phase:** the confirmation
prompt was also unreadable/unanswerable in a real terminal — `uninstall.ts`
never stops its `ora` spinner before the interactive prompt runs, unlike
`install.ts`'s already-correct `spinner.stop()`/`spinner.start()` pattern
around its own consent prompt. Both fixes live in the shared-path uninstall
flow and ship together as `C5g-fix-uninstall-confirmation-prompt.md`.

---

## 2026-08-17 — `adopt` writes to the registry, not the cwd; and the registry path becomes configurable. Supersedes part of the 2026-08-05 adopt design

**Decided (Bruno, 2026-08-17), in two sequenced phases, and this
*blocks the 0.3.0 tag*.**

**What prompted it.** The C6 manual checklist failed on its first step:
`goodboy adopt <dir>` run from the skill's parent directory always
collides with its own source, because the Agent Skills standard requires
the frontmatter `name` to equal the directory name and adopt copies to
`join(cwd, name)`. See `docs/backlog.md`. Bruno's framing of the
underlying problem, which is the part worth recording: the cwd copy is
the wrong destination — *"either the adopt command should be done inside
the private registry, but that would be bad UX if we have to navigate to
the private registry."*

**Phase 1 — `getRegistryPath()` reads `goodboy.json`'s `registry`
field.** The field exists and `init --registry` writes it; nothing reads
it. A consumer now exists, so it gets read rather than removed.
**Open security question, deliberately unresolved here:** `goodboy.json`
is untrusted input arriving in every clone, unlike the deliberately-set
`GOODBOY_REGISTRY` env var, so letting it choose the registry path is a
trust-boundary change. The scope/validation/precedence questions are
listed in the backlog entry and **must be settled before the phase prompt
is drafted**.

**Phase 2 — `adopt` synthesizes the manifest, shows it, asks for
confirmation, and writes into the local registry.** No stray copy in the
cwd, no collision, no mandatory second command.

**What this supersedes.** The 2026-08-05 adopt design chose *not* to
chain into `add`, "so the user gets a chance to inspect the synthesized
manifest before it's registered" — the atomic-commands principle. That
reasoning is respected, not discarded: **the inspection chance does not
require a stray directory.** A confirmation prompt showing the
synthesized manifest preserves the user's agency and removes the litter.
Writing to the registry is adopt's actual job, so doing it is not the
"magic" the principle guards against.

**Still true, not reopened:** `add` and `adopt` stay separate commands
(different inputs — manifest-carrying vs. not); adopt never mutates the
source directory; the never-overwrite guard on an existing target is a
security invariant and stays.

**Phase 2 concept questions — settled 2026-08-17 (Bruno):**

1. **Inspection:** adopt prints the synthesized manifest and asks for
   confirmation before writing; on decline nothing is written and nothing
   is left behind. **No copy anywhere** — the cwd copy existed solely as
   staging for the `add` step that no longer exists. The confirmation is
   the natural close of a dialogue adopt already has (it prompts for
   author, email, license), and it matters more than it looks because
   **registry versions are immutable**: a wrong license or typo'd author
   otherwise costs a `registry remove` or a version bump.
2. **Skill already in the registry: refuse with a pointer.** Stricter
   than `add`, which refuses only on a colliding *version* and offers
   `--force`. adopt is an onboarding command — if the skill is already
   known, the user wants a new version, not an adoption. **No `--force`
   for adopt.**
3. **Reuse, don't duplicate.** adopt and `add` share one registry-write
   path. The seam needs care: `add` reads `manifest.json` from disk, adopt
   builds it in memory, so the shared function takes the manifest as an
   argument rather than re-reading it — and `add`'s observable behavior
   must not change (its existing tests are the proof).

**Sequencing correction, same day:** the registry-path-from-config work
(Phase 1) was originally sequenced first, but **the dependency is not
real** — adopt can write to the registry path as it already resolves
(`GOODBOY_REGISTRY` or the default). Phase 1 carries an unresolved
untrusted-input security question; decoupling it keeps that question from
blocking the release-blocking fix. Phase 2 goes first and alone.

**Release timing (Bruno):** this blocks the 0.3.0 tag. `adopt` was
promoted to a go-public gate precisely because it is "the first thing a
visitor arriving from an external catalog tries" — shipping it broken in
its most natural invocation is worse than delaying the tag.

---

## 2026-08-15 — Terminal tab-completion: self-generated templates + a hidden `__complete` protocol

**Decided (Bruno, 2026-08-15):** GoodBoy gets shell tab-completion for
subcommands, options, and skill names. The user-side cost is one line of
shell config; everything else is GoodBoy code.

**Mechanism, after checking the facts rather than assuming them:**
Commander 12.1.0 (the version GoodBoy installs) has **no** completion API.
The ecosystem libraries are abandoned — `tabtab` (3.0.2), `omelette`
(0.4.17), `commander-completion` (1.0.1) were all last modified
2022–2023 — and pulling one in would contradict the dependency hygiene C0
just established. Chosen instead, the yargs/oclif architecture in GoodBoy's
own style:

- a hidden `__complete` command — the completion engine — walks the live
  commander program tree for subcommand/option names (so new commands get
  completions automatically, no hand-maintained list) and reads the local
  registry listing / `goodboy.json` / `goodboy.lock` for skill names;
- a hidden `completion [bash|zsh|fish]` command emitting three small,
  exact-text-tested shell templates that call back into `__complete`
  (zsh reuses the bash function via `bashcompinit` — no second engine
  binding);
- `-o default` keeps ordinary file completion as the fallback, so path
  arguments (`add`, `adopt`) keep working.

**Scope (full surface, Bruno):** skill names complete on `install`,
`upgrade`, `skill diff`, `skill version` (registry listing) and
`uninstall`, `verify`, `skill open` (installed state — `-g` honored when
present in the typed words, matching each command's own scope rules).
Subcommands and options everywhere. **Not doing:** auto-install into rc
files (atomic-commands principle), any network call, path completion for
`add`/`adopt` beyond the shell's own file fallback, `search` queries.

**Shells:** bash, zsh, fish — three fixed template strings, one engine.

**Coverage:** the completion engine (`lib/`) and the command file are both
pinned at 100%, matching the other command files that surface user data.
Templates are asserted as exact text. The dogfooding test is the
acceptance test: tab-completion works in a real zsh session before the
phase is done.

**What would reopen this:** commander gaining first-class completion
support, or a maintained completion library appearing — the templates
would be replaced, the `__complete` engine and its tests would survive.

---

## 2026-08-14 — `versions/vN/` is keyed by each schema family's own major, not the package's

**Decided (Bruno, 2026-08-12; recorded by C5):** frozen schema copies live
under `versions/vN/` where `N` is the **family's** own schema major,
matching the `$id`s (`…/manifest/v2`, `…/goodboy-json/v1`,
`…/goodboy-lock/v1`). The alternative — keying by the schema *package*
major, i.e. `versions/v2/` for the two new families because the package is
at 2.0.0 — was rejected: it contradicts the `$id`-is-major-keyed
convention and gets confusing at the next package major.

**Consequence, now explicit:** the schema package and the families version
independently. `@goodboyjs/schema` 2.0.0 ships three families whose own
identities are v2 (manifest) and v1 (goodboy-json, goodboy-lock). The skew
is correct — the CLI already assumes it, via a separate
`KNOWN_*_SCHEMA_VERSION` constant per file — and is now stated in
`packages/schema/versions/README.md`.

**What would reopen this:** nothing short of a reason to key frozen copies
by package version rather than schema identity — i.e. the `$id` convention
itself changing.

---

## 2026-08-13 — Agent skill directories: flags name intent, a list-valued map is the mechanism

**Decided (Bruno):** `AGENT_SKILL_DIRS` moves from one path per agent to one
*list* of paths per agent. A flag (`--codex`, `--gemini`, `--claude-code`)
names an intent — "make this visible to X" — and the list underneath it is
the current mechanism for satisfying that intent, which can gain or lose
entries later without the flag ever changing meaning to a user.

**What prompted it.** The Codex symlink bug (`docs/backlog.md`) surfaced a
deeper question: `~/.agents/skills/` is an emerging cross-vendor convention
(Codex reads only it; Gemini reads it with precedence over its own path;
`gh skill` writes to it), while `~/.claude/skills/` is Claude Code's own,
standard-native only in content format. Naming flags after products assumed
each vendor needed an exclusive directory, which stopped being true.

**Shape:** `codex -> [~/.agents/skills]`; `gemini -> [~/.agents/skills,
~/.gemini/skills]` (kept for version-safety — Gemini's `.agents/skills`
support lands only around CLI v0.25–0.26, confirmed against
[geminicli.com/docs/cli/skills](https://geminicli.com/docs/cli/skills/));
`claude-code -> [~/.claude/skills]`; a new standalone `agents` flag ->
`[~/.agents/skills]`, a forward-compat escape hatch for a future agent
GoodBoy hasn't given its own flag yet.

**Explicitly rejected: a per-agent "strategy" field tracking whether a path
is shared.** Shared-ness is fully derivable by cross-referencing the map
itself — a path is shared if more than one agent's list contains it — so a
small helper computes it live rather than storing it. Persisting "which
agents were selected at install" as separate state would be a second copy
of a fact the map already encodes, the exact pattern this project keeps
finding and removing elsewhere (schema version vs. lockfile, sensitive
files in two configs).

**Uninstall consequence, also decided:** a shared path has no per-vendor
removal — it is one physical symlink, read by whichever tools scan that
directory. `goodboy uninstall --codex` on a shared path cannot "remove for
Codex but keep for Gemini"; the only real choice is remove-for-everyone or
leave-it. So uninstall prompts before removing a shared path ("also read
by: gemini. Remove anyway?"); declining leaves the symlink for every reader,
including the one named on the command line.

**Deferred, not decided:** a `-f`/`--force` flag to skip that prompt for
automation. Tracked in `docs/backlog.md`. It carries its own open question
— whether force defaults to removing or keeping a shared path — which is
not obvious and should not be assumed when it's picked up.

**What would reopen this:** Claude Code adopting the `.agents/skills`
convention, which would fold its own entry into the shared list the same
way Gemini's already is.

**Closed same day: the dead `~/.codex/skills/` symlinks from 0.2.0.**
Neither auto-cleaned nor silently left. **Auto-cleanup on next install was
rejected** — deleting an unrelated directory as a side effect of an install
command is exactly the automatic behaviour `CLAUDE.md`'s "atomic commands
over magic" principle exists to rule out, and it would mean carrying the
*old* mapping in the codebase indefinitely as one-time migration logic for
a population that is realistically Bruno alone. **Silent leave-alone was
also rejected**, on a narrower ground: this bug's whole shape was GoodBoy
succeeding and saying nothing while doing nothing, and leaving its own
leftover just as silent repeats that rather than closing it. **Decided:
print a one-time notice** when `codex` is actually processed by
`createAgentSymlinks`/`removeAgentSymlinks` — one `lstat` on the known
legacy path, and if it still has entries, a line pointing out it's no
longer read and safe to delete. Scoped to the moment Codex is touched, not
a standing background scan.

---

## 2026-08-17 — Codex dual-link: `--codex` maps to `~/.agents/skills/` and `~/.codex/skills/`; the stale-Codex notice is retired

**Decided (Bruno):** `AGENT_SKILL_DIRS['codex']` becomes
`[~/.agents/skills, ~/.codex/skills]` — flags keep meaning "make visible
to Codex", the list is the mechanism. This **supersedes** the 2026-08-13
decision's notice ("Closed same day" above) — that design rested on a
premise, "Codex never reads `~/.codex/skills/`", that is false for
codex-cli 0.147.

**What changed the premise — verified, not assumed (2026-08-17):**
codex-cli 0.147 scans **both** `~/.codex/skills/` (its own skills home —
the bundled `.system/` skills live there, and session context blocks list
locators from it) **and** `~/.agents/skills/` (the shared cross-vendor
convention — a probe skill placed there appeared in the next session's
`<skills_instructions>` block with its locator). Vendor scan paths move;
the 2026-08-13 decision even predicted that risk.

**Consequences folded in:**

- **The stale-Codex notice is retired entirely, not reworded.** GoodBoy
  actively manages `~/.codex/skills/` again, so "no longer read by Codex"
  would be a false claim; and 0.2.0-era links already in that dir become
  valid managed targets — the next install reports them as "already linked
  correctly". Nothing to migrate, no cleanup logic (see
  `docs/backlog.md`'s codex entry for the follow-through).
- **`~/.agents/skills/` stays shared** (codex, gemini, `agents`) — the
  uninstall confirmation prompt is unchanged, derived live from the map;
  the message still names only real co-readers (`gemini`), never the
  internal `agents` key.
- **`~/.codex/skills/` is codex-exclusive** — it is planned without a
  prompt on uninstall; a declined shared-path confirmation still aborts
  the whole removal with zero unlinks (the F1 contract, unchanged).

**Not changed:** `claude-code`, `gemini`, and the `agents` key; the
already-linked log line gains its path (message polish folded in from
`docs/backlog.md`). Completion is untouched — the engine does not
reference agent directories.

---

## 2026-08-12 — One domain: `goodboyjs.com`. Extends the 2026-08-11 entry

**Decided (Bruno):** `goodboyjs.com` is the project's only referenced
domain. `goodboyjs.io` is also under the project's control but is **not**
to be used anywhere. `goodboy.dev` is not ours and must never appear in a
live surface.

**What reopened it.** The 2026-08-11 decision settled the canonical domain
and corrected the schema `$id`s, and a guard test was added — but scoped to
`$id` values under `packages/schema/src/`. All three `package.json` files
were still publishing `"homepage": "https://goodboyjs.io"`, which is the
npm package page: the domain users actually see. Found 2026-08-12 while
reviewing C4b, not by any check.

**The lesson is about the guard, not the domain.** This is the third
instance of "a fact stored in two places with nothing reconciling them" —
and unlike the schema/lockfile cases, here a reconciler *existed* and was
simply scoped too narrowly. A guard covering one of two copies reads as
protection while providing none for the other. C4c widens it to the whole
repo and requires it be observed failing before it counts.

**The deliberate exception.**
`packages/schema/versions/v1/manifest.schema.json` keeps its `goodboy.dev`
`$id`. It records what `@goodboyjs/schema` 1.0.0/1.0.1/1.1.0 actually
published; those tarballs are immutable. Correcting the frozen copy would
buy accuracy in one file at the cost of making it a false record of v1
everywhere else, and would change nothing on npm. Documenting the mistake
in `versions/README.md` is not a use of the domain.

**What would reopen this:** acquiring `goodboy.dev`, or a decision to
retire `goodboyjs.com` in favour of another domain — in which case the
guard's exemption list is the first place to look.

**Follow-on (Bruno, same day): schema 1.x is deprecated after the release,
and the stated reason is the wrong domain as a security concern** — not
merely a stale identifier. The frozen `versions/v1` copy still stays; the
deprecation covers the *published* artifacts, which is the surface that
actually reaches anyone.

This **supersedes the framing** of the 2026-08-11 decision to keep the npm
deprecation message neutral. That decision was made when this was
classified as a metadata error; whether the message itself now names the
reason is open and belongs to C7.

**Severity, recorded honestly so the eventual message can be too.**
`versions/v1` carries **no `$ref`**, only the `$id` string. Ajv never
fetches `$id`, and validators resolve `$ref` rather than `$id`, so nothing
in normal use retrieves that URL. The exposure is tooling that treats `$id`
as retrievable — some editors and schema catalogs — where the domain's
owner could serve a permissive schema and cause a **validation bypass**,
not code execution; plus the brand-confusion surface of a published package
pointing at a third party. Real, low, worth fixing, not worth inflating.

**Why deprecation rather than a `1.1.1` patch or an unpublish.**
Deprecation only warns — a consumer on `^1.1.0` still resolves to a bad
artifact — so a corrected patch release would be the stronger fix, and
unpublishing stronger still. Neither is being done.

**Corrected by Bruno, 2026-08-12: "the package has no external users" is an
assumption, not a fact, and must be treated as one.** The package is public
on npm; who pulled it is not knowable from here.

Measured rather than assumed (npm downloads API, 2026-07-11 → 2026-08-09):
**463 downloads in the month.** Three spikes — 115, 132 and 156 — cluster
around publish dates and look like registry mirrors and scanners; the
steady tail runs 0–8/day. Most of it is very likely automated. **Some of it
might not be.** The last seven days total 13.

So the decision rests on proportionality under uncertainty, not on an
empty user base: the project is early, a schema change is expected at this
stage, and the issue is low-severity and probably inert. Spending release
effort on a corrected patch or an unpublish is disproportionate to that.
**If an early adopter is affected, they can contact us and we solve it with
them directly** — a workable path precisely because the numbers are small.

Recorded this way so the reasoning is honest about what is known. It is not
"nobody uses this"; it is "the cost of the stronger fix outweighs a
low-severity risk to an audience we cannot measure, and we are reachable if
we are wrong."

---

## 2026-08-12 — An executed prompt is immutable

**Decided (Bruno):** once an implementer has run a prompt in
`docs/prompts/`, that file is closed. Follow-up work gets its own prompt at
the next letter (`C4b` → `C4c`), never an appendix to the original.

**What prompted it.** Review findings on C4b were appended to the C4b
prompt itself. Bruno's objection: C4b has already been run, so amending it
implies re-running the whole phase when only a delta is needed — and it
destroys the distinction between what was asked for and what was learned
afterwards. The same correction was made on 2026-08-11, when a fix was
proposed as an addition to an already-committed phase rather than a clean
prompt.

**Why it keeps happening, recorded so it can be recognised.** Appending to
the prompt that produced a finding feels like keeping related things
together. It is the same instinct as amending a pushed commit, and it is
wrong for the same reason: the artifact has already been consumed by
someone else.

Recorded in `CLAUDE.md` under the `docs/prompts/` bullet.

---

## 2026-08-11 — Integrity protects the skill, not the bytes

**Decided:** a change to `schema_version`, or to the manifest's *format*,
is **not** a change to the skill. The skill is `SKILL.md` and its bundled
files — what an agent reads and a user experiences. `manifest.json` is
GoodBoy's record of it.

**Why:** `README.md:21-22` already draws this line, and the code did not
follow it. `computeSkillIntegrity` hashes the whole directory including the
manifest, so rewriting `schema_version` would change a skill's content
hash, trip drift detection, and appear to violate the immutability
promise — for a change that alters nothing an agent or user could observe.

**Second principle, decided alongside it:** nothing rewrites user content
silently. Auto-migration on read is ruled out.

**What this unlocks:** the apparent three-way conflict between migration,
immutable versions, and integrity was an artefact of hashing raw bytes.
Under this definition, migrating a manifest's format changes no hash and
breaks no promise, so a migration command and a compatibility window stop
being competing options.

**Explicitly NOT decided — the mechanism.** Where the boundary falls inside
the manifest (`permissions` and `license` are argued to be skill-side, not
verified), and whether hashing moves to normalised content or stays on raw
bytes. The second has a permanent cost: a normalisation function becomes
part of the integrity contract, and changing it later invalidates every
recorded hash. Both belong in `docs/concept-schema-compatibility.md`.

**Correction recorded:** during this discussion the claim "a manifest format
change is a change to the skill's files, so it earns a new version" was
made twice and is wrong — it conflates files in the directory with the
skill.

**Sequencing:** post-launch. 0.3.0 ships with the 1.x break documented.

**See:** `docs/backlog.md`, "No migration path for manifests across a
schema major".

---

## 2026-08-11 — Committed files never link into `docs/prompts/`

**Decided:** no committed file may contain a `docs/prompts/…` path.
Prompt-to-prompt references *within* that directory are fine — they never
leave it.

**Why:** `docs/prompts/` is gitignored, so such a link resolves only on
Bruno's machine. By 2026-08-11 thirty-two had accumulated across
`docs/backlog.md` (16), `docs/go-public-checklist.md` (5),
`docs/concept-secrets.md` (5), `docs/decisions.md` (4),
`docs/product-positioning.md` (1) and `CLAUDE.md` (1) — every one of which
becomes a dead link the moment the repo is public, inside the documents
whose entire value is demonstrating rigor.

Many were **already broken locally**, using flat `docs/prompts/x.md` paths
for prompts long since filed into `done/<topic>/` subfolders. Nothing
checked them, so they decayed silently. That is the real argument for a
rule rather than a one-off cleanup: the references rot faster than anyone
notices.

**Instead:** describe the artifact ("the phase prompt for this work, kept
locally"), or put the substance in the committed document so no reference
is needed. The second is usually better — if a committed doc needs to point
at a prompt to be understood, the reasoning is in the wrong file.

**Enforcement:** a grep in the go-public checklist for the launch cleanup;
a markdown link-check over committed files is noted as a candidate for the
deferred CI work, which would catch both this and the path decay.

**Related convention adopted the same day:** prompt filenames carry their
sequence code as a prefix (`A2-`, `B1-`, `deferred-`) so they can be found
by code without opening `SEQUENCE.md`.

**See:** `CLAUDE.md` (the rule), `docs/go-public-checklist.md` (the launch
cleanup), `docs/backlog.md` (the full framing and the rejected alternative
of publishing the prompts).

---

## 2026-08-11 — Canonical domain is `goodboyjs.com`; schema `$id`s corrected

**Decided:** the project's canonical domain is **`goodboyjs.com`**.
`goodboy.dev` — which appears in every schema `$id` in the repo — is **not
a domain this project controls or can obtain**, and every reference to it
is wrong.

**Scope of the error, verified 2026-08-11:**

| Location | Status |
|---|---|
| `packages/schema/src/manifest.schema.json` | fixed in the schema-2.0.0 phase |
| `packages/schema/src/config.schema.json` | removed with secrets |
| `packages/schema/versions/v1/manifest.schema.json` | frozen copy — see below |
| `@goodboyjs/schema` 1.0.0, 1.0.1, 1.1.0 on npm | **immutable, cannot be fixed** |

**Severity, stated precisely so it is neither over- nor under-sold:** Ajv
treats `$id` as an identifier and never fetches it, so GoodBoy is
functionally unaffected. The risk is third-party — some editors and
validators resolve `$id` as a URL, and whoever controls `goodboy.dev`
controls what those tools fetch. It becomes a genuine supply-chain vector
if `$schema` emission lands (see
`docs/project-file-schemas-handoff.md` Q7), which is a reason to sequence
that phase after this fix rather than before.

**Fix folded into the schema-2.0.0 phase**
(`docs/prompts/B2-clean-unused-manifest-fields.md`) rather than done
standalone: a new major is when schema identity may change without
awkwardness, and that phase was already bumping the version.

**The `$id` version segment was also wrong** independently — it read
`…/manifest/1.0.0` even in the 1.1.0 release. v2's `$id` carries `2.0.0`.

**Frozen v1 copy:** left as-is, with a `versions/README.md` explaining
why — the copy's purpose is fidelity with what was published, and the npm
artifacts are immutable regardless, so rewriting it would buy accuracy in
one place while creating divergence in another.

**Prevented from recurring** by a test asserting every `$id` under
`packages/schema/src/**` is on `goodboyjs.com`.

**Open action:** determine whether `goodboy.dev` is registered by a third
party. That decides whether the three published 1.x versions warrant
`npm deprecate` with a pointer to 2.0.0, or whether documenting the
mismatch is sufficient.

---

## 2026-08-09 — Secrets removed from scope entirely

**Decided:** remove S3 and S4 in full — the entire secrets resolution
layer. GoodBoy does not handle secrets.

**What actually landed (2026-08-09):** `src/secrets/` (8 modules),
`src/commands/secrets/` (4 commands), both providers, the resolver and
provider registry, `packages/schema/src/config.schema.json` and its
generated types, and the supporting `lib/errors.ts` and `lib/process.ts`.
`goodboy init` no longer writes a `goodboy.local.json` gitignore entry.
Twelve of the thirty-two `security-sensitive.json` entries went with them.
None of this had ever been published to npm.

**Why:** D6 cut S5 (`secrets exec`) because agents do not execute skill
scripts — but that reasoning removes S4's *consumer*, not just S5's
trigger. If nothing GoodBoy controls consumes a secret, a secrets
configuration layer has no user; what shipped was a parallel config whose
only output was "yes, your mapping resolves," after which the user had to
export the value themselves anyway. Cutting S5 invalidated S4 and nobody
re-examined S4.

**S2 was NOT removed in this phase.** The intent is that `requires.secrets`
goes too — its only consumer, `consent.ts`, exists because the field does —
but it is a manifest-schema change, and the manifest-cleanup phase already
owns the 2.0.0 major. Removing it here would have split one schema break
across two diffs. It is deferred there deliberately, not overlooked: as of
this entry `requires.secrets`, its `consent.ts` disclosure, and
`manifest.ts`'s `assertPermissionsConsistency` are all still live and
still published.

**Kept:** S1's forward-compatibility validation (general, not secrets-
specific), and `lib/redact.ts`. Note on `redact.ts`: it is retained because
`logger.ts` calls `redact()` on every message — *not* for control-character
stripping, which lives in `logger.ts`'s own `stripControlChars()` and was
never in `redact.ts`. With the secrets feature gone nothing calls
`registerSecret()`, so `redact()` now returns its input unchanged in
production. The module is dormant, not load-bearing. Trimming it is
all-or-nothing (removing the registration API makes `redact()`'s only real
branch unreachable and breaks its 100% coverage pin), so it was left whole
pending an explicit decision.

**Reopens if:** a concrete use case appears in which something GoodBoy
itself controls actually consumes a secret. Design against the real
requirements at that time rather than resuming `docs/concept-secrets.md`,
which is retained but **withdrawn**.

**Honest framing, recorded deliberately:** this solved a problem the
project did not have. That is worth stating plainly rather than quietly
deleting — the correction is the useful part.

**See:** `docs/concept-secrets.md` (withdrawn — read its header),
`docs/backlog.md`'s resolved decision-point entry, and the CHANGELOG's
Unreleased section.

---

## 2026-08-09 — Manifest keeps its own file; unused fields removed

**Decided:** the two-file model stays — `manifest.json` holds what GoodBoy
needs, `SKILL.md` stays a plain standard skill. Seven properties with zero
reads are removed (`publisher`, `visibility`, `homepage`, `repository`,
`changelog`, `engines`, `os`). Schema goes to **2.0.0**.

**Why not move metadata into `SKILL.md` frontmatter** (as
`docs/roadmap.md` previously proposed): the standard's `metadata` field is
a string-to-string map, and GoodBoy's manifest has nested objects and
arrays — encoding them as JSON-in-YAML is strictly worse. It would also
lose JSON Schema validation with `additionalProperties: false`, and break
the README's promise that nothing GoodBoy-specific leaks into `SKILL.md`.

**Why remove now:** removing an optional field is a major bump; adding one
back is a minor. Removing before adoption costs one cheap major; removing
after costs an expensive one. Same failure mode as the earlier
`kind`/`executable` fields and as secrets — surface built ahead of a
settled use case.

**Recorded finding:** the standard's `metadata` map is the *sanctioned*
home for namespaced vendor keys, should GoodBoy ever need frontmatter
presence. Spec-backed, not invented. Nothing needs it today.

**See:** `docs/prompts/B2-clean-unused-manifest-fields.md`.

---

## 2026-08-09 — Public marketplace is sequencing, not a boundary

**Supersedes** the previous claim in `docs/product-positioning.md` that
GoodBoy should *not* build a public marketplace, described there as "a
deliberate scope boundary, not a not-yet-gotten-to feature."

**Decided:** a public marketplace is planned, but not for the first
release, and is contingent on the product finding a market first.

**Why:** small operation, limited resources; building marketplace
infrastructure ahead of demand spends the scarcest resource on the least
certain bet. GoodBoy is not competing head-on with Vercel or GitHub on
distribution — that contest is neither winnable nor worth entering.

**See:** `docs/product-positioning.md`.

---

## 2026-08-09 — Differentiators revised against the actual competitive field

**Decided:** local integrity verification is the primary differentiator;
host-agnosticism is promoted from an implementation note to a positioning
claim; multi-agent install, pinning, lockfiles, and update checking are
**no longer** claimed as differentiators.

**Why:** `gh skill` (GitHub CLI v2.90.0, 2026-04-16) ships pinning, commit
SHA installs, and immutable releases. `npx skills` ships a lockfile and
`check`. Those four capabilities became table stakes. What survives is
narrower and stronger: `verify` answers *"has my installed copy been
modified?"*, which is a different question from *"is there a newer version
upstream?"* — and no competitor asks it. Neither competitor works at all
against self-hosted git.

**See:** `docs/product-positioning.md`.

---

## 2026-08-09 — Node 24 floor, test against 24 and 26

**Decided:** `engines: >=24.0.0`, CI matrix `['24', '26']`,
`@types/node: ^24`.

**Why:** Node 20 reached EOL 2026-04-30; the repo was declaring support for
it and testing it. Node 24 has been Active LTS since October 2025.

**Constraint worth preserving:** `@types/node` must track the **lowest**
supported runtime, not the newest. Typing above the floor lets `tsc` accept
APIs the oldest supported Node lacks, and the type-check offers no
protection because it reads the same typings on every matrix leg. The
`@types/node` bump is only safe because the floor moved with it.

**See:** `docs/prompts/A3-bump-node-support-matrix.md`.

---

## 2026-08-09 — `@goodboyjs/registry-client` withdrawn from npm

**Decided:** unpublish `0.1.0` and remove `publish:registry-client` from
`publish:all` and the release workflow. The package stays in the monorepo.

**Why:** every method throws `not implemented`. It should be published when
it does something — once the hosted registry API exists — not before.
Deprecation was considered and rejected: it leaves the package page up,
which was the actual objection.

**Order matters:** remove it from `publish:all` *first*. Unpublishing first
would break the release chain after schema publishes and before the CLI
does.

---

## 2026-08-09 — CI runs `test:coverage` only

**Decided:** CI runs `npm run test:coverage`, not `npm test` as well.

**Why:** coverage runs the full suite anyway, and a threshold failure is
distinguishable from an assertion failure in the output. Running the suite
twice per matrix leg to improve UI labelling is not worth it. Build time
was explicitly *not* the deciding factor.

**Note:** `release.yml` still runs both; that inconsistency is known and
tracked, not accidental.

---

## 2026-08-09 — `add.ts`, `adopt.ts`, `install.ts` classified as untrusted-input

**Decided:** all three go in `security-sensitive.json` and are pinned to
100% coverage.

**Why:** they accept user-supplied paths and copy third-party content onto
the filesystem, but were invisible to the security-impact gate — which
reported "no sensitive files touched" for diffs against them. A gate that
cannot fire on its most relevant input is the same failure mode as the
vacuous `verify:types` check closed earlier.

**Related:** `security-sensitive.json` will **not** gate itself — the
script is a drafting aid with no CI enforcement, so a self-entry would only
notify the person already editing it. The real risk is entry *removal*,
which wants a shrink lint rather than a gate entry.

---

## 2026-08-09 — Hard requirement #3 reworded, not enforced

**Decided:** `CONTRIBUTING.md`'s rule becomes "validated before being used
to construct any filesystem path" rather than "before any filesystem
operation."

**Why:** the original wording was unsatisfiable. `adopt.ts` performs six
filesystem operations before validating, and *must* — the skill name lives
inside the `SKILL.md` it has to read first. Every file already complies
with the reworded version; none complied with the original. Rewording is
stronger, not weaker: it is checkable.

---

## Earlier decisions

Not yet backfilled into this log. The authoritative records remain:

- `docs/concept-secrets.md` §3 (D1–D6) and §7 — secrets design decisions,
  now withdrawn but retained.
- `docs/backlog.md` — closed entries carry their own decision records.
- `docs/roadmap.md` — v0.2.0+ design decisions, flagged as a recovered
  draft pending confirmation.
- `docs/go-public-checklist.md` — release-gate decisions.

Backfilling these is worthwhile but not urgent; do it when touching them
for other reasons rather than as a dedicated pass.
