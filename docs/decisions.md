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
(`docs/prompts/clean-unused-manifest-fields.md`) rather than done
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

**Decided:** remove S3 (partially) and S4 in full, plus S2's
`requires.secrets` manifest field. GoodBoy does not handle secrets.

**Why:** D6 cut S5 (`secrets exec`) because agents do not execute skill
scripts — but that reasoning removes S4's *consumer*, not just S5's
trigger. If nothing GoodBoy controls consumes a secret, a secrets
configuration layer has no user; what shipped was a parallel config whose
only output was "yes, your mapping resolves," after which the user had to
export the value themselves anyway. Cutting S5 invalidated S4 and nobody
re-examined S4.

`requires.secrets` (S2) went too: its only consumer, `consent.ts`, existed
because the field did, and the manifest schema was already going to 2.0.0
for unrelated reasons, so removal carried no extra version cost.

**Kept:** `lib/redact.ts` (`logger.ts` depends on it for control-character
stripping), and S1's forward-compatibility validation, which is general.

**Reopens if:** a concrete use case appears in which something GoodBoy
itself controls actually consumes a secret. Design against the real
requirements at that time rather than resuming `docs/concept-secrets.md`,
which is retained but **withdrawn**.

**Honest framing, recorded deliberately:** this solved a problem the
project did not have. That is worth stating plainly rather than quietly
deleting — the correction is the useful part.

**See:** `docs/prompts/remove-secrets-s3-s4.md`, `docs/concept-secrets.md`
(withdrawn), CHANGELOG.

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

**See:** `docs/prompts/clean-unused-manifest-fields.md`.

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

**See:** `docs/prompts/bump-node-support-matrix.md`.

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
