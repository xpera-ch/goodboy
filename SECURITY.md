# Security Policy

## Scope

This policy covers the `goodboy` CLI tool and its packages:

- `@goodboyjs/cli` — the `goodboy` binary
- `@goodboyjs/schema` — the manifest schema and TypeScript types
- `@goodboyjs/registry-client` — the registry HTTP client (Phase 3, not yet released)

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities privately by emailing the maintainer at the address listed on the npm package page, or by using [GitHub's private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability) if enabled on this repository.

Include in your report:

- A description of the vulnerability and its potential impact
- Steps to reproduce, including any proof-of-concept code
- The version of `goodboy` you tested against
- Your assessment of severity (critical / high / medium / low)

We will acknowledge your report within **72 hours** and aim to issue a fix or mitigation within **14 days** for critical vulnerabilities.

## What Not To Do

- Do not disclose the vulnerability publicly before a fix is released
- Do not test against other users' systems or infrastructure
- Do not use automated scanning tools against the registry endpoint

## Security Architecture

GoodBoy applies defence-in-depth across every trust boundary. Multiple independent controls must fail simultaneously for a threat to succeed.

| Threat | Layer 1 (schema) | Layer 2 (runtime) | Layer 3 (fs/exec) |
|---|---|---|---|
| Path traversal in skill name | `SKILL_NAME_RE` rejects non-`[a-z0-9-]` | URL-decode + null-byte strip before validation | `startsWith(registryPath + sep)` path guard |
| Symlink escape during install | — | `scanForSymlinks()` rejects symlinks pointing outside skill dir | Runs on the registry copy before it is copied into `.claude/skills/` or the global store |
| Oversized manifest | 512 KB file-size check before read | Nesting depth > 10 rejected before `JSON.parse` | — |
| Skill requests elevated capabilities | `permissions` restricted to 5 known enum values | `requestConsent()` shows the declared permissions and requires explicit confirmation before install | — |
| Unexpected/injected manifest fields | `additionalProperties: false` on every schema object | `ajv` instantiated with `{ strict: true, allErrors: true }` | — |

## Phase 1 Known Limitations

The following are **by design** for Phase 1 and are documented here, not as vulnerabilities, but as known constraints that users must understand before installing skills.

### 1. GoodBoy does not execute skill content — but you might

Installing or upgrading a skill only ever copies files. GoodBoy never reads, interprets, or executes anything from a skill's `scripts/`, `references/`, or `assets/` automatically — there is no lifecycle-hook mechanism of any kind. The only subprocess GoodBoy itself ever spawns is your own `$EDITOR`, in `goodboy skill open`, on a file you explicitly asked to edit, with an explicit argv array and no shell.

That said, GoodBoy has no way to know what a skill's bundled `scripts/` are *for*. If you, or an agent acting on your instruction, run something from a skill's `scripts/` directory, it executes with your full user permissions — no different from running any other script you didn't write yourself.

**Mitigation:** Only install skills from sources you explicitly trust. Review `scripts/` before running anything from it.

### 2. Declared permissions are advisory, not enforced

A skill's manifest may declare `permissions` (`read_files`, `write_files`, `network`, `shell`, `env`). `goodboy install` shows these to you and requires explicit confirmation before proceeding (`requestConsent()` in `packages/cli/src/lib/consent.ts`). GoodBoy does not, and in Phase 1 cannot, verify that a skill's actual behavior matches what it declares. Treat the permissions prompt as a trust signal from the author, not a sandbox boundary.

### 3. No cryptographic signature verification

Skills are not signed in Phase 1. The local registry performs no integrity check beyond JSON Schema validation of the manifest. A skill that has been tampered with after publication will not be detected.

**Plan:** Phase 3 will introduce publisher verification and signature checking via the hosted registry.

### 4. TOCTOU in skill resolution

The `resolveSkill()` function checks that a skill path exists (`existsSync`) and then returns the path. If the directory is replaced between the check and the subsequent read, a different directory may be used. On single-user developer machines this is very low risk. A full fix would require keeping the directory open via a file descriptor throughout the install operation.

### 5. `goodboy upgrade` does not re-prompt for permissions

The consent prompt described above runs on `goodboy install`, not on `goodboy upgrade`. If a new version of a skill declares additional `permissions` compared to the version you originally consented to, upgrading will not surface that change. Review `goodboy skill diff <name>` before upgrading a skill you didn't author yourself.
