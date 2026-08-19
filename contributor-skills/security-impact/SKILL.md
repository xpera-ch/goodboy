---
name: security-impact
description: >
  Use this skill when a diff touches a security-sensitive file and a PR or commit needs a security-impact callout — trigger phrases like "write the security-impact section", "draft the security callout", "does this need a security note", or "check if this touches sensitive files". Runs the bundled scripts/check-sensitive-files.mjs detection script against a dedicated structured config (security-sensitive.json at the project root) — never against CONTRIBUTING.md or any other prose file — and drafts the callout plus an invariants-unchanged checklist from its output. Small, mechanical, and deliberately decoupled from any CI enforcement gate.
---

# Security Impact

You draft the security-impact section a PR description needs when a diff
touches a security-sensitive file. This skill is intentionally small and
mechanical, and it has one hard rule: the source of truth for "what's
sensitive" is a dedicated structured config file, never prose.

## Why not CONTRIBUTING.md

An earlier version of this skill read a project's `CONTRIBUTING.md` live
and reasoned about its sensitive-files table. That was rejected on purpose:
`CONTRIBUTING.md` is for human-facing contributor onboarding, and making it
*also* the machine-read contract violates single responsibility — a prose
reformat could silently break the parse without anyone noticing. The fix is
this skill's bundled script plus a structured config it's the only reader
of. `CONTRIBUTING.md` may restate the same information in prose for humans,
but nothing here ever parses that prose.

## Steps

### 1. Confirm the config exists

Look for `security-sensitive.json` at the target repository's root. If it
doesn't exist, say so plainly and stop — don't fall back to reading
`CONTRIBUTING.md` or guessing from file names. See
`assets/security-sensitive.example.json` for the expected shape (each entry
is `{ pattern, reason, invariants[] }`; `pattern` supports exact paths and
`*`/`**` globs).

### 2. Run the bundled detection script

```
node scripts/check-sensitive-files.mjs
```

By default this diffs the working tree (tracked changes) plus any new
untracked files against `HEAD`, and matches them against
`security-sensitive.json` in the current directory. Pass `--diff <ref>` to
check a different range, `--config <path>` for a config elsewhere, or
`--files <a,b,c>` to check an explicit list outside git entirely. It fails
closed: a missing or malformed config is a hard error, never treated as
"nothing is sensitive."

The script is a **drafting aid**, not a CI gate — it has no shared unit or
file-dependency link with any CI enforcement check. If this project also
wants a CI-enforced version of the same check, that's a separate script
reading the same config, not a caller of this one.

### 3. No matches — say so, don't force a section

If the script's `matches` array is empty, state explicitly: "No
security-sensitive files touched by this diff." Don't manufacture a section
that isn't needed.

### 4. Matches — draft the callout from the script's output

For each match, using only the `reason` and `invariants` the script
reported (not paraphrased, not re-derived from prose elsewhere):

- Which file, and why it's sensitive (the `reason` field, close to verbatim).
- What changed in that file, from the actual diff — pull the relevant lines
  yourself; the script only tells you *that* the file matched, not what
  changed inside it.
- For each listed invariant, whether the diff preserves it, with a pointer
  to the specific line that proves it.

If the callout states a count about the surrounding code — e.g. "N call
sites already route this through `logger.error`" — that count needs the
same treatment as the detection script's own output: run the command that
produces it in this session and show it, even if a prior report on the same
file stated a number already. Carrying a count forward unverified is exactly
the kind of self-reported claim this skill exists to avoid repeating.

### 5. Output

Produce the section in the format the repository's PR descriptions already
use (match existing convention if one exists). Keep it factual and
specific — quote lines, name files, don't generalize.

## What this skill is not

It does not perform a full adversarial review (the `adversarial-review`
skill does that, and is a much larger review than a single-diff security
callout) — it produces the specific section a PR needs when sensitive files
change. If the change is large enough to warrant a full review, say so and
suggest `adversarial-review` instead of trying to do both in one pass.
