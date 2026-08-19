---
name: adversarial-review
description: >
  Use this skill when explicitly asked to perform an adversarial review of code before a merge, tag, or release — trigger phrases like "adversarial review", "review this before we merge/tag", "review this phase", "review before release", "pre-merge review", or "pre-tag review". This is a deliberate, explicitly-invoked review discipline for phase boundaries, not an automatic code-review pass — do not trigger it for casual "can you check this" requests or as a background habit. It produces a PASS/FAIL/CONCERN verdict built from re-derived, live evidence (commands actually run, tests actually written and executed) rather than the implementer's self-report, fixes nothing during the review, and stops after the report to wait for instructions.
---

# Adversarial Review

You are reviewing someone else's (or your own past) work with the stance of
an adversary, not a collaborator. Your job is to find problems, not to
confirm the work. Assume the implementation is wrong until the evidence in
front of you proves otherwise.

This skill is invoked deliberately at phase boundaries — before a commit is
merged, before a tag is cut, before a release goes out. It is not meant to
fire automatically on every diff; if you're unsure whether this is a real
phase-boundary review or just a quick look, ask.

## Ground rules (non-negotiable)

- **Every finding is categorized PASS / FAIL / CONCERN**, with the exact code
  quoted and a `file:line` reference. No finding without a verdict.
- **Never accept the implementation report's claims.** Re-derive everything
  from the working tree and live command output. If a report says "all tests
  pass," run the tests yourself and paste the real output.
- **Express security probes as tests you write and run — not reasoning.** If
  you catch yourself explaining in prose why an attack would or wouldn't
  work, stop and write the test instead.
- **Fix nothing during the review.** Findings go into one consolidated fix
  list at the end. Then stop and wait for instructions on which to address.
- **Disclosure norm:** if you make a mistake while constructing a probe
  (wrong payload shape, wrong assumption), disclose it in the report rather
  than silently correcting and moving on. Past reviews have caught real bugs
  this way (see `references/known-traps.md`).
- **Any count or enumeration is a command you just ran, not a number you
  stated.** If a finding says "N call sites," "M occurrences," or similar,
  that count must come from a command run in *this* session, with the
  command and its output shown in the report — never copied forward from a
  prior report on the same diff (even an unchanged part of it), and never
  estimated from a partial read. This is the same rule already applied to
  test/coverage output ("run it yourself, paste the real output") extended
  to plain enumeration — a review has previously restated a prior review's
  wrong count instead of re-deriving it, which is exactly the failure mode
  this whole discipline exists to prevent. If you haven't run the exact
  counting command, don't state an exact number — say "several" or list the
  items without a total instead.

## Workflow

### 1. Re-derive scope — don't trust a stated file list

Run `git status` and `git diff --stat` (or the equivalent for the range
under review) yourself. Compare against whatever the handoff/report claims
changed. Anything outside the claimed scope is a finding in itself — either
undisclosed work or a stale report.

### 2. Read the reference docs, flag deviations

Identify the concept doc and/or phase-spec prompt this work was built
against (e.g. a `docs/concept-*.md` and its decision-record section, plus
any per-phase spec file). Read them. Any place the implementation deviates
from either — even if the deviation looks like an improvement — is a
finding to surface, not silently accept.

### 3. State the actual threat model for *this* change

Don't reuse a generic threat model. Name what specifically is at risk for
this diff: is it injection (attacker-controlled strings reaching output or
parsing)? Logic/gate-bypass (a new check that can be routed around)? Display
correctness (a security-relevant fact silently not shown to the user)?
Write one paragraph stating this before probing — it disciplines what you
test for.

### 4. Security probes — write and run them

For each risk named in step 3, write an actual test/script and run it.
Typical probe families worth checking when relevant:

- **Prototype pollution:** build attacker JSON via `JSON.parse(text)`, never
  as an object literal (see `references/known-traps.md` — this exact mistake
  has produced false negatives before). Assert `Object.prototype` is
  unpolluted after the code under test runs.
- **Message/output injection:** confirm any regex or validation that bounds
  what can reach an interpolated message actually bounds the character set,
  not just the general shape. Try pathological lengths within any declared
  size cap.
- **Gate-bypass enumeration:** for any new validation/consent/permission
  gate, enumerate every code path that reaches the guarded outcome (grep for
  direct casts, alternate constructors, fixture shortcuts) and confirm none
  skip the gate.
- **DoS ordering:** confirm size/depth limits are checked before expensive
  parsing, not after.
- **Regression:** rerun the probe set from the previous phase's review to
  confirm nothing regressed.

### 5. Correctness vs. spec

Walk every required behavior listed in the phase spec and find the test that
proves it. A behavior without a test backing it is a CONCERN even if the
code looks correct by inspection.

### 6. Caller integration

Check every caller of the changed code, including ones that shouldn't need
to change. Confirm ordering guarantees (e.g. a warning appears before a
destructive action, not after), and that untouched call sites still behave
correctly against the new surface.

### 7. Release readiness (when the phase ends in a tag/publish)

If this phase results in a version bump and publish: verify the actual
package contents (`npm pack --dry-run` or equivalent) rather than trusting
the build config, confirm version bumps are consistent across the affected
packages, and check the changelog entry doesn't overclaim.

### 8. Test and coverage honesty

Run the full suite for real — paste the output. Run it multiple times
consecutively if flakiness is a known risk and report per-run results.
Inspect every new coverage-ignore annotation individually; each must be
genuinely unreachable, not a convenient dodge. Quote and justify or flag
each one.

## Report format

1. **Summary verdict:** APPROVE FOR MERGE+TAG / APPROVE WITH REQUIRED FIXES
   / REJECT.
2. **Findings table:** ID, severity (FAIL/CONCERN/PASS), `file:line`,
   one-line description.
3. **For every FAIL and CONCERN:** quoted code, the evidence (real command
   or test output), and the specific fix required.
4. **Full command output** for anything empirical (test runs, package
   content checks, ecosystem-compatibility checks).
5. **Explicit list of anything you could not verify, and why.**

## Persist the report — the report is the artifact

**Write the report to a file before you stop.** A review that exists only
in a conversation cannot be re-read, diffed, or cited later — and the
findings it contains are exactly what someone will need weeks afterwards,
when the session is gone and the code has moved.

Follow the project's own convention for where reviews live: check its
`CLAUDE.md` / `AGENTS.md` / `CONTRIBUTING.md` for a reviews directory, and
put the file there, named for the phase under review. **If no convention
exists, ask where to save it** rather than picking a location silently or
skipping the step.

Then report the path you wrote alongside the verdict, so the reader can
find it without searching.

Do not fix anything during the review. After the report is written to disk,
stop and wait for instructions on which findings to address.

## Known traps

See `references/known-traps.md` for specific mistakes this review discipline
has already caught once — read it before probing so the same mistake isn't
made a second time.
