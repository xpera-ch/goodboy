# Security Policy

## Scope

This policy covers the `goodboy` CLI tool and its packages:

- `@goodboy/cli` — the `goodboy` binary
- `@goodboy/schema` — the manifest schema and TypeScript types
- `@goodboy/registry-client` — the registry HTTP client (Phase 3, not yet released)

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

## Phase 1 Known Limitations

The following are **by design** for Phase 1 and are documented here, not as vulnerabilities, but as known constraints that users must understand before installing skills.

### 1. Hooks run with full user permissions

Skill lifecycle hooks (`preinstall`, `postinstall`, `preremove`, `postremove`) are executed as the current operating-system user. There is no sandboxing, chroot, capability dropping, or seccomp filtering. A malicious hook can read, write, or delete any file the user owns, make network requests, and spawn child processes.

**Mitigation:** Only install skills from sources you explicitly trust. Never install a skill from an unknown or untrusted author.

### 2. No cryptographic signature verification

Skills are not signed in Phase 1. The local registry performs no integrity check beyond JSON Schema validation of the manifest. A skill that has been tampered with after publication will not be detected.

**Plan:** Phase 3 will introduce publisher verification and signature checking via the hosted registry.

### 3. Symlink attacks are partially mitigated

`goodboy install` refuses to copy skill directories that contain symbolic links. However, this check is performed on the registry source directory at the time of install. A skill that creates symlinks via its `preinstall` hook (pointing outside the skill directory) in the destination path is not fully constrained.

**Mitigation for users:** Review hook commands in a skill's `manifest.json` before installing from untrusted sources.

### 4. No network egress control

Hooks can make outbound network requests. There is no firewall rule, capability restriction, or egress filter applied during hook execution.

### 5. TOCTOU in skill resolution

The `resolveSkill()` function checks that a skill path exists (`existsSync`) and then returns the path. If the directory is replaced between the check and the subsequent read, a different directory may be used. On single-user developer machines this is very low risk. A full fix would require keeping the directory open via a file descriptor throughout the install operation.
