---
name: phase-prompt
description: >
  Use this skill when drafting an implementation prompt for a discrete phase of work that will later be checked by the adversarial-review skill — trigger phrases like "write the phase prompt", "draft an implementation prompt", "scaffold the next phase prompt", or "write the prompt for the next phase". Produces a structured prompt with context and a concept-doc reference, an inspect-before-editing checklist, required behavior, explicit non-goals, a test matrix tied to the repo's coverage bar, verification commands, commit granularity that defers message-writing to the commit-creation skill, and a required final report format. Do not use this to write the implementation itself — it produces the prompt that will later drive the implementation.
---

# Phase Prompt

You are drafting the prompt that will drive one discrete, reviewable phase
of implementation work — not doing the implementation yourself. The prompt
you produce is what an implementer (human or agent) will follow, and it will
later be checked against by `adversarial-review`. Every section below exists
because leaving it out has previously let scope drift or let a review find
things the prompt should have ruled out up front.

## Sections to produce

### 1. Context and concept reference

State the goal of this phase in one or two sentences, and point at the
locked concept/design doc this phase implements (e.g. `docs/concept-*.md`,
naming the specific section — a decision record, a phase table). If no such
doc exists yet, that's a signal the phase isn't ready for a prompt: concept
comes first, implementation prompt second. Say so instead of drafting one
anyway.

### 2. Inspect-before-editing checklist

List the specific files and functions the implementer must read *before*
changing anything, and what to look for in each (existing patterns to
follow, an existing gate/check not to bypass, a naming convention already in
use). This prevents an implementation that technically works but doesn't fit
how the rest of the codebase does the equivalent thing.

### 3. Required behavior

Enumerate the concrete, testable behaviors this phase must produce. Prefer
a numbered list of specific input/output or state-transition statements over
a paragraph of prose — each one should be checkable by a specific test.

### 4. Explicit non-goals

State what this phase deliberately does *not* do, even if it would be easy
to add while in there. This section is what keeps scope honest — if the
implementer (or a future reviewer) is tempted to expand scope mid-phase,
this is the section that says no and why, or flags it as a candidate for a
later phase instead.

### 5. Test matrix

List the specific test cases required, tied to the repo's actual coverage
requirement (e.g. 100% on security-sensitive files) — not just "add tests."
Include edge cases and regression cases from prior phases where relevant.

### 6. Verification commands

The exact commands the implementer must run and report real output from
(type-check, build, full test suite, coverage run — whatever the repo's
actual toolchain is). Pull these from the repo's own scripts
(`package.json`, CI config) rather than inventing generic ones.

### 7. Commit granularity

State how many logical commits this phase should produce and what each one
covers — but do not write the commit messages themselves. Defer message
authorship entirely to the `commit-creation` skill; the prompt should say
something like "commit in N logical pieces: [list], using commit-creation
for each message" and nothing more.

### 8. Required final report format

Specify what the implementer must report back: files changed, the semantics
actually implemented (not just "done"), real command output for the
verification commands, a security-impact section (defer to the
`security-impact` skill if this repo has one) when security-sensitive files
were touched, and an explicit list of anything not completed or deferred.

## What this skill is not

It does not review code (`adversarial-review` does that) and it does not
write security-impact callouts itself (`security-impact` does that) — it
produces the prompt that sets those later steps up to succeed. If asked to
also implement or review, say so and hand off to the right skill instead of
doing all three in one pass.
