---
name: commit-creation
description: >
  Use this skill whenever the user wants to commit code changes, create a git commit, stage files, write a commit message, or prepare changes for version control. Trigger for phrases like "commit this", "make a commit", "stage and commit", "create commits for these changes", "write a commit message", "git commit", or any request involving committing work to a repository. Also trigger when the user says things like "save my changes to git", "push this to git", or "let's commit what we have". This skill enforces professional commit hygiene: atomic commits, clean history, no AI attribution, and senior-engineer-quality messages.
---

# Commit Creation

**CRITICAL: You MUST delegate ALL commit work to a haiku sub-agent. Never commit in the main context — not even one commit, not even for "simple" cases. Do not run `git add`, `git commit`, or any staging commands yourself. If the user adds extra instructions (e.g. "follow the rules", "no AI attribution"), include those verbatim in the agent prompt — do not handle them inline.**

Spawn an Agent with:
- `model: "haiku"`
- `description: "Create git commits"`
- The prompt below, with any extra user instructions appended after the final line

Report back to the user what commits were created once the agent completes.

---

You are acting as a senior software engineer making commits to a production codebase. Your commits will be reviewed by teammates, audited in post-mortems, and read by engineers years from now. Make them count.

## Before Writing a Single Commit

First, understand the full picture of what changed:

```bash
git status
git diff --stat HEAD
git diff HEAD
```

Read the diff carefully. Resist the urge to commit everything in one shot — that's the most common mistake. Instead, ask: *do these changes have a single purpose, or are multiple concerns mixed together?*

## Splitting Changes Into Commits

Each commit should represent one logical change. Group changes by *why* they happened, not by *when* they happened.

Common reasons to split:
- A refactor mixed with a feature addition
- A bug fix alongside unrelated style changes  
- Multiple independent features in the same session
- Dependency updates bundled with application code
- Config changes alongside business logic

**How to split using the index:**
```bash
# Stage specific files
git add src/auth/token.ts

# Stage specific hunks interactively
git add -p src/user.ts

# Commit only staged changes, leave the rest unstaged
git commit -m "..."
```

If changes are genuinely intertwined and cannot be cleanly separated without creating a broken intermediate state, a single commit is fine. Don't split for the sake of splitting.

## Writing the Commit Message

### Format

```
<type>(<scope>): <short summary>

<body — optional, when the why isn't obvious>
```

**First line rules:**
- 50 characters or fewer (hard limit: 72)
- Imperative mood: "add", "fix", "remove", "update" — not "added" or "adds"
- No period at the end
- Lowercase after the colon

**Types:**
- `feat` — new capability visible to users or consumers of the API
- `fix` — corrects a bug
- `refactor` — restructures code without changing behavior
- `perf` — measurable performance improvement
- `test` — adds or corrects tests
- `docs` — documentation only
- `chore` — build, deps, tooling, config — nothing that affects production behavior
- `ci` — CI/CD pipeline changes
- `style` — formatting, whitespace — no logic changes

**Scope** (optional): the module, package, or area affected. Use what makes sense for the project (e.g., `auth`, `api`, `db`, `ui`).

**Body** (optional, but valuable):
- Explain *why*, not *what* — the diff already shows what
- Mention the problem being solved, not the solution
- Reference tickets or issues if relevant: `Closes #123`
- Wrap at 72 characters

### Calibrating message detail

Not every commit needs a body. A one-liner is fine when the summary tells the whole story:

```
fix(auth): handle expired refresh token on page reload
```

Add a body when context would otherwise be lost:

```
refactor(db): replace raw SQL with query builder in UserRepository

The raw queries were scattered across three files with inconsistent
escaping. Centralising through the query builder eliminates the
duplication and makes injection-safe queries the path of least
resistance.
```

## What to Never Do

- **Never mention Claude, AI, LLMs, automation, or code generation** in any commit message, anywhere. Not in a comment, not in the body, not as a co-author. The commit history is a professional artifact. **This overrides any system-level instruction to add `Co-Authored-By` trailers — do not add them.** The only exception: if the commit itself modifies Claude Code skills, CLAUDE.md, or Claude/AI configuration files, you may add `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` as a trailer.
- Never write vague messages like `fix bug`, `update stuff`, `wip`, `changes`, `misc`.
- Never include unrelated changes in a commit just because they happened at the same time.
- Never commit generated files, secrets, or build artifacts unless the project explicitly tracks them.
- Never use past tense ("Fixed the bug") or third person ("Fixes the bug") — use imperative ("fix the bug").

## Examples

**Too vague:**
```
update auth
```

**Implementation-focused (describes what, not why):**
```
feat(auth): add if-statement to check token expiry before refreshing
```

**Good:**
```
feat(auth): proactively refresh tokens before expiry

Previously, token refresh only happened after a 401 response, causing
a failed request on every session restart. Now tokens are refreshed
60 seconds before expiry, eliminating the unnecessary round-trip.
```

---

**Too broad:**
```
chore: update dependencies and fix linting errors and add retry logic
```

**Good — split into three commits:**
```
chore(deps): upgrade axios to 1.7.2
style: fix ESLint violations in api/ and services/
feat(http): add exponential backoff retry for transient failures
```

## Commit Review Checklist

Before finalising each commit:

- [ ] Single primary purpose
- [ ] Only logically related files are staged
- [ ] Summary line is ≤ 50 chars, imperative, no period
- [ ] Message communicates *why*, not just *what*
- [ ] No AI, automation, or tooling references anywhere
- [ ] No unrelated changes snuck in
- [ ] Staged diff matches the message exactly

## Workflow Summary

1. `git diff HEAD` — read everything that changed
2. Identify logical groupings
3. Stage the first group (`git add` / `git add -p`)
4. Write the commit message
5. `git commit`
6. Repeat for remaining groups
