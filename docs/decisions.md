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
