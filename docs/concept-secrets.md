# Concept: Vendor-Neutral Secret Declarations & Injection

Status: LOCKED — decisions in §7, S0 verification results in §8
Author: Claude (co-founder review), 2026-07-20

---

## 1. Product positioning

GoodBoy is a registry and metadata layer. It already has a precedent for exactly this
kind of feature: the `permissions` manifest field — **"DECLARED INTENT ONLY — not
enforced"** — alongside `engines` and `os`. The secrets feature is the same product
move, extended one level deeper:

```text
Skills DECLARE logical secret needs        (metadata — core GoodBoy)
Users MAP logical names to providers       (local config — core GoodBoy)
GoodBoy VALIDATES and DIAGNOSES            (tooling — core GoodBoy)
GoodBoy INJECTS into an explicit command   (thin runtime shim — the only expansion)
An external runtime EXECUTES the work      (never GoodBoy)
```

The first three rows are uncontroversial. The fourth is a deliberate, bounded identity
expansion and is isolated in its own phase so it can be deferred or dropped without
touching the rest.

## 2. Non-negotiable integrity invariants

These hold in every phase and every review:

1. **SKILL.md stays untouched.** It is an open standard. No new frontmatter fields,
   no YAML parser added to read it. All GoodBoy declarations live in `manifest.json`.
2. **GoodBoy never executes skills.** No command interprets skill contents as
   something to run. `--from-skill` reads declared metadata only.
3. **Committed files never contain secret material** — not values, and not provider
   references (`op://…` reveals customers, vaults, infrastructure). `goodboy.json`
   is never extended with secrets config.
4. **No secret persistence.** No caching, no databases, no implicit `.env` files,
   no value-revealing CLI flags.
5. **No shell, ever.** All subprocess invocations use `execFile`/`spawn` with
   `shell: false` and separate arguments.
6. **Only requested secrets are resolved.** Never "resolve everything configured."
7. **Lazy initialization.** Users who never configure secrets never touch provider
   code; no non-secrets command ever invokes `op`.
8. **100% test coverage**, as everywhere else in the repo.

## 3. Key decisions

### D1 — Declarations live in `manifest.json`, modeled on `permissions`

```json
{
  "requires": {
    "secrets": ["EXOSCALE_API_KEY", "EXOSCALE_API_SECRET"]
  }
}
```

Schema: array of `^[A-Z_][A-Z0-9_]*$`, `maxLength: 64`, `maxItems: 32`,
`uniqueItems: true`. Advisory metadata, exactly like `permissions` — shown at
install/inspect time, validated by `goodboy skill validate`, never enforced as
execution. (`maxItems: 32` is deliberately generous: raising a limit later
re-fragments manifest compatibility, while the DoS bounds come from per-item
`maxLength` and the 512KB manifest cap, not from this count.)

Consistency rule added to validation: `requires.secrets` present ⇒ `permissions`
must include `"env"` — **hard error** at `skill validate`/`skill create` time.
Rationale: on tolerant older CLIs `requires` is invisible (see D2 caveat), so
`permissions` is the only secrets signal those users see; it must be reliable.

Why `requires` as an object rather than a flat `secrets` array: it gives future
requirement kinds (e.g., `requires.commands`) a home without another schema debate.
Pay the complexity cost once.

### D2 — Manifest forward-compatibility policy (v0.1.1 patch + exposure control)

**Constraint: CLI v0.1.0 is live on npm.** Installed 0.1.0 CLIs validate with
`schema_version: const "1.0.0"` and `additionalProperties: false`, and will
hard-reject any manifest that contains `requires` or a bumped `schema_version`.
That behavior cannot be retrofitted. The policy therefore has two halves: fix the
validator going forward, and control how fast incompatible manifests enter the
ecosystem.

**Half 1 — tolerant validator, released immediately as v0.1.1 (patch):**

- `schema_version` becomes semver-meaningful: `pattern: ^1\.\d+\.\d+$`.
- Validator behavior: manifest minor ≤ CLI's known minor → strict validation
  (keep `additionalProperties: false` as the DoS/garbage canary it is). Manifest
  minor > CLI's known minor → validate against the known schema but **tolerate
  unknown top-level properties, with a warning** ("manifest uses schema 1.1.0,
  this CLI knows 1.0.0 — consider upgrading"). Newer major → reject. Size limits
  always apply.
- v0.1.1 contains only this change plus tests. The goal is to shrink the window
  in which strict-only validators exist; release notes state this explicitly.

**Half 2 — feature-driven schema stamping (exposure control):**

- `goodboy skill create` and `skill version` stamp the **lowest schema version the
  manifest actually needs**: a manifest without `requires` stays `1.0.0` and
  remains fully valid for v0.1.0 CLIs. Only manifests that use `requires` are
  stamped `1.1.0`. Incompatibility is therefore opt-in per skill, never imposed
  by upgrading the CLI.
- The Phase 3 registry API contract (not yet designed — still free) includes
  schema-version negotiation from day one: clients declare their supported range;
  the registry never serves a manifest the client cannot validate, and instead
  returns "requires CLI ≥ x.y". Local-registry sharing between mismatched CLI
  versions has no negotiation channel — accepted residual risk, see matrix.

**Compatibility matrix:**

| | 1.0.0 manifest | 1.1.0 manifest (uses `requires`) |
|---|---|---|
| CLI 0.1.0 (live, strict) | ✓ | ✗ rejected — "fails schema validation"; remedy: upgrade CLI |
| CLI 0.1.1+ (tolerant) | ✓ | ✓ (older CLIs: warning + unknown fields ignored; `requires` invisible) |

The 0.1.0 failure mode is a clear validation error at `add`/`install`/`validate`
time, not silent misbehavior. For a 0.x product with exposure limited to skills
that opt into the new field, this is an acceptable and honest floor — documented
in CHANGELOG and README ("`requires.secrets` needs CLI ≥ 0.2.0; manifests using it
need ≥ 0.1.1 to install").

One honest caveat: a tolerant older CLI ignores `requires` — the user installs the
skill without seeing its secret requirements. The coarse `permissions: ["env"]`
signal (enforced by the D1 consistency rule) still displays, which is why that
rule matters.

### D3 — Mappings live in local config, JSON, two levels

New config files (both validated by an Ajv schema in `@goodboyjs/schema`):

- `~/.goodboy/config.json` — user-level defaults (providers usually live here)
- `<project>/goodboy.local.json` — project-level, **gitignored**; `goodboy init`
  appends it to `.gitignore` and `goodboy secrets` commands warn if it is tracked

`goodboy init` does **not** create `goodboy.local.json` — only the gitignore entry
(cheap insurance for whenever the file appears). The first `goodboy secrets`
command that needs config and finds none offers to scaffold it interactively,
matching the existing consent pattern (`@inquirer/prompts`). Mirrors npm: `npm
init` doesn't create `.npmrc`; config files appear when first needed.

Precedence: project-local overrides user-level, merged per top-level key
(mappings merge by name; providers merge by instance name). No YAML — the repo has
zero YAML dependencies and `goodboy.json` is JSON; consistency wins.

```json
{
  "schema": "1.0.0",
  "secrets": {
    "defaultProvider": "onepassword",
    "providers": {
      "onepassword": { "type": "onepassword-cli", "account": "example.1password.com", "timeoutMs": 30000 },
      "env": { "type": "environment" }
    },
    "mappings": {
      "EXOSCALE_API_KEY":    { "provider": "onepassword", "reference": "op://dev-vault/Exoscale/api-key" },
      "EXOSCALE_API_SECRET": { "provider": "onepassword", "reference": "op://dev-vault/Exoscale/api-secret" },
      "LEGACY_TOKEN":        { "provider": "env", "reference": "LEGACY_TOKEN" }
    }
  }
}
```

`provider` may be omitted per-mapping when `defaultProvider` is set. Multiple
instances of the same provider type are supported (instance name ≠ type).

### D4 — Shared infrastructure is built as shared infrastructure

The secrets feature needs three things the repo does not have. They are load-bearing
for the whole CLI and must NOT be buried under `secrets/`:

| Module | Contents | Notes |
|---|---|---|
| `lib/errors.ts` | `GoodBoyError` base with `code`, `cause`, safe metadata | Secrets error codes are a subset; existing commands are NOT refactored in the same phase |
| `lib/process.ts` | `runCapture()` (execFile + timeout + AbortSignal + output cap, 1 MiB) and `runInherit()` (spawn, stdio inherit, signal forwarding, exit-code passthrough) | `shell: false` hard-coded; later usable by `skill open` |
| `lib/redact.ts` | Register/redact API; longest-match-first, literal (no regex construction from values); wired into `logger` and `sanitiseError` | Honest limitation: chunk-boundary stream redaction is documented as best-effort in v1 |

Each is small, ships with 100% coverage, and gets its own adversarial review before
any provider code exists.

### D5 — `--from-skill` resolution is deterministic and narrow

v1 rule: resolves an **installed project skill** — `goodboy.json` must exist (same
gate as `goodboy list`), skill must be in its `skills` map, manifest read from the
project's installed location. No registry lookup, no global fallback, no path
arguments. Clear error otherwise. Widening later is additive.

### D6 — Scope cuts

- **`secrets exec` stays in scope but is the final phase.** Justification: the
  mapping layer has no consumer without it, and the flagship self-use case is
  `goodboy secrets exec --secret X -- claude`. It is a thin shim: with a single
  1Password provider it delegates to `op run` (provider-native); GoodBoy's only
  own runtime logic is the generic in-memory fallback for env/mixed providers.
- **`secrets render` (plaintext files) is cut from v1 entirely.** Revisit only on a
  concrete need; the original spec's safeguards are archived in this document's
  source prompt.
- Single provider pair in v1: `environment` + `onepassword-cli`. The
  `SecretProvider` interface is the extension seam; nothing else is promised.

## 4. Architecture

```text
packages/schema
  src/manifest.schema.json          + requires.secrets  (schema 1.1.0)
  src/config.schema.json            new: local/user config incl. secrets section
  generated/                        regenerated, verify:types stays green

packages/cli/src
  lib/errors.ts                     shared (D4)
  lib/process.ts                    shared (D4)
  lib/redact.ts                     shared (D4)
  secrets/
    types.ts                        SecretProvider, SecretValue, contexts, statuses
    config.ts                       load + merge + validate local/user config
    provider-registry.ts            instances by name, types by id, lazy construction
    resolver.ts                     names → mappings → providers → SecretValues
    providers/
      environment.ts
      onepassword-cli.ts            op read --no-newline (exact value, no
                                    stripping); op://-prefix validation; masked
                                    references
    injection/
      planner.ts                    single capable provider → native; else generic
      native-onepassword.ts         op run + reference-only env file (mkdtemp 0700,
                                    file 0600, try/finally cleanup, no values ever)
      generic.ts                    child-only env, no process.env mutation
  commands/secrets/
    index.ts                        registerSecretsCommand (mirrors skill.ts pattern)
    doctor.ts  list.ts  validate.ts  exec.ts
```

Core types (final names to match repo conventions):

```ts
interface SecretProvider {
  readonly id: string;
  checkAvailability(ctx: SecretResolutionContext): Promise<SecretProviderStatus>;
  resolve(reference: string, ctx: SecretResolutionContext): Promise<SecretValue>;
}
```

`SecretValue`: `#value` private field; `toString`/`toJSON`/`inspect` all return
`[REDACTED]`; explicit `reveal()`; construction registers the value with the
redactor. Purpose is accidental-disclosure prevention, not memory protection — and
the docs say so.

### CLI surface (end state)

```bash
goodboy secrets doctor              # config + providers + auth status; no values
goodboy secrets list                # NAME  PROVIDER  MASKED-REFERENCE; no values
goodboy secrets validate [--skill <name>] [--resolve]
goodboy secrets exec [--secret N]... [--from-skill <name>] -- <command> [args...]
```

`exec` rules: `--` and a command are mandatory; requested names = union of
`--secret` flags and skill declarations, deduped and validated **before** anything
starts; collision between an injected name and an explicitly passed env var is a
hard error; child exit code and signals pass through; no value-revealing flag exists
anywhere in the CLI.

## 5. Phasing

Each phase is one Claude Code prompt followed by the standard adversarial review
(quoted code, live command output, PASS/FAIL/CONCERN). No phase starts before the
previous review passes.

| Phase | Content | Release |
|---|---|---|
| **S0** | Concept lock (this doc) + ecosystem verification: confirm the Agent Skills spec has no secrets/env field; confirm current `op read` / `op run` / `--account` syntax against 1Password docs | — |
| **S1** | Forward-compat policy: semver `schema_version`, tolerant-minor validation in `manifest.ts` — nothing else | **v0.1.1** (patch, release ASAP to shrink the strict-only install base) |
| **S2** | Manifest `requires.secrets` (schema 1.1.0) + feature-driven schema stamping in `skill create`/`skill version` + validation + `skill inspect`/install-consent display + permissions-consistency rule | v0.2.0 |
| **S3** | Shared infra: `errors.ts`, `process.ts`, `redact.ts` | v0.2.0 |
| **S4** | Config files + provider abstraction + both providers + resolver + `doctor`/`list`/`validate` + fake `op` fixture | v0.3.0 |
| **S5** | `secrets exec`: planner, native `op run` strategy, generic fallback, non-execution sentinel tests. **Gated: starts only after S4 has been used in at least one real workflow** — the day-to-day experience feeds the exec design | v0.4.0 |
| S6 | (deferred, on demand) `secrets render` | — |

S1 is deliberately tiny and ships as a patch the moment its review passes: every
week v0.1.1 is not out, the strict-only 0.1.0 install base grows. Everything after
S1 is independently droppable.

## 6. Testing strategy

- Vitest, 100% coverage, no real `op`, no real accounts.
- **Fake `op` CLI is a Node script** (not shell) so Windows CI stays honest; it
  records argv, simulates version/whoami/read/run, auth failure, timeout, non-zero
  exit, and actually launches the target command for `run`.
- **Security sentinel:** `GOODBOY_SECURITY_SENTINEL_SECRET` must never appear in CLI
  output, logs, serialized errors, diagnostics JSON, or temp reference files —
  asserted globally, allowed only where a test deliberately calls `reveal()`.
- **Non-execution sentinel:** a fixture skill whose manifest/files contain
  executable-looking content (`command: touch SHOULD_NOT_EXIST`); after
  `secrets exec --from-skill … -- node safe.js`, assert `safe.js` ran and
  `SHOULD_NOT_EXIST` does not exist.
- Newline handling tested for both `\n` and `\r\n`; leading/trailing spaces and
  multiline values preserved; only one final CLI-added line ending stripped.
- Temp reference-file tests: permissions, reference-only content, cleanup on
  success/failure/timeout/cancel/startup-failure, no `OP_SERVICE_ACCOUNT_TOKEN`.

## 7. Decision record (settled 2026-07-20)

1. **`requires.secrets` ⇒ `permissions: ["env"]`: hard error.** `permissions` is
   the only secrets signal visible on tolerant older CLIs, so it must be reliable.
   Error messaging on older CLIs encountering newer manifests must point to the
   available upgrade (covered by the D2 tolerance warning).
2. **`maxItems: 32`.** Generous by design — raising limits later re-fragments
   compatibility; DoS protection comes from per-item bounds and the manifest size
   cap.
3. **`goodboy init` adds the gitignore entry only.** No file scaffold at init;
   first `goodboy secrets` use offers interactive scaffolding (see D3).
4. **S5 (`exec`) is gated on real-world use of S4** in at least one actual
   workflow before implementation starts.

## 8. S0 verification results (2026-07-20)

### Agent Skills spec — CLEAR

The [specification](https://agentskills.io/specification) defines exactly six
frontmatter fields: `name`, `description`, `license`, `compatibility`, `metadata`,
`allowed-tools`. **No secrets, env, or requirements field exists.** D1 stands:
`requires.secrets` goes in `manifest.json`, SKILL.md stays untouched. Two notes:

- The spec's `metadata` field is a string→string map explicitly intended for
  client-specific properties — a theoretical alternative home. Rejected: values
  are strings only (no arrays), and GoodBoy's manifest is the established
  metadata layer. Skill authors' `compatibility` free-text may *mention* secret
  needs; that is informational and unaffected.
- The spec ships a reference validator (`skills-ref validate`); GoodBoy validation
  must stay compatible with it, never stricter about SKILL.md than the spec.

### 1Password CLI — syntax confirmed, four design corrections

1. **Newline handling: use `op read --no-newline` (`-n`).** The CLI supports
   suppressing the appended newline directly — the value arrives exact, no
   stripping heuristic needed. Replaces the `\r?\n$` strip in the provider design
   (kept only as a tested invariant: output is passed through byte-exact).
2. **Reference validation must allow spaces.** Reference segments are
   case-insensitive and allow alphanumerics, `-`, `_`, `.` **and whitespace**
   (e.g. `op://dev/aws/Access Keys/access_key_id`); an optional section segment
   gives 4-part paths, and query parameters are legal (`?attribute=otp`,
   `?ssh-format=openssh`). v1 validation: require `op://` prefix + non-empty
   remainder, reject control chars/newlines/null bytes, treat everything else as
   opaque and pass as a single process argument. GoodBoy performs **no** variable
   expansion inside references. Masking formatter must handle 3- and 4-segment
   forms.
3. **`op run` masks stdout/stderr by default** (secrets concealed unless
   `--no-masking`). Native injection therefore gets provider-side masking for
   free; GoodBoy must not pass `--no-masking` and should document that generic
   fallback relies on GoodBoy's own redactor instead. Env precedence confirmed:
   `--env-file` beats shell env.
4. **`--account <shorthand|URL|ID>` is a global flag** (also settable via
   `OP_ACCOUNT`); `op whoami` errors when unauthenticated → exactly the safe auth
   probe `doctor` needs, optionally with `--account` filter.

### Additional findings

- **`op-js` exists** (official 1Password JS wrapper around the CLI). Evaluated
  and rejected for v1: it is built on synchronous process calls, offers no
  AbortSignal/timeout/output-cap integration, and imports a far larger API
  surface than `read`/`run`/`whoami`. GoodBoy's thin `lib/process.ts` keeps the
  security invariants local and testable. Revisit only if maintenance cost bites.
- **Operational caveat:** field reports of `op` spawning a caching daemon and
  hanging on some macOS setups (mitigation: `--cache=false`). Reinforces the
  hard-timeout + process-cleanup requirement in `lib/process.ts`; a passthrough
  cache option on the provider config is a possible later addition, not v1.
- **1Password Environments** (beta `op run --environments`) is a potential future
  provider capability; out of scope, noted for the provider-author docs.

Concept is LOCKED. S0 complete — next step: write the S1 implementation prompt
(v0.1.1 tolerant validator).
