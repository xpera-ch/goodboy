# Git hooks

Enable once per clone:

```bash
git config core.hooksPath .githooks
```

That is not automatic — git will not use this directory until you run it,
and it is per-clone rather than per-repository. If you clone fresh, run it
again.

## `pre-push`

Runs `npm run test:coverage` before anything reaches the remote, and aborts
the push if it fails.

**Why it exists.** GitHub branch protection and rulesets both require a paid
plan on *private* repositories — they are free only on public ones. So until
this repo is public there is no server-side gate stopping a red build
landing on `main`. This hook is the local substitute.

It is **not** equivalent to branch protection, and should not be treated as
such. Branch protection stops *other people* merging red and blocks
force-pushes; a hook stops *you* pushing something broken. For a
single-developer repository the second is nearly all of the real risk, but
the first becomes real the moment there are contributors. Enabling branch
protection is still on `docs/go-public-checklist.md` for flip time, and this
hook stays useful alongside it.

**It runs `test:coverage`, not `test`.** A coverage-threshold breach exits
non-zero even when every test passes — roughly 30 files are pinned at 100%,
and a silent drop is exactly the regression worth catching. `npm test` alone
would go green on it.

**Documentation-only pushes skip the suite.** If every changed path is under
`docs/`, `.githooks/`, or a top-level `*.md`, the hook exits immediately.
The classifier errs toward running: anything it cannot confidently place as
documentation triggers the full suite. A nested `packages/*/README.md`, for
instance, runs it.

**Branch-agnostic.** It does not require or encourage feature branches.
Pushing directly to `main` is unaffected.

**Bypassing** is `git push --no-verify`. Deliberately, and rarely — a hook
that is routinely bypassed is worse than no hook, because it produces the
impression of a gate without one.
