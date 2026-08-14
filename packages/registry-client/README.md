# @goodboyjs/registry-client

HTTP client for GoodBoy's future hosted registry API.

## Why this package is thin

This package is a small stub today, and that's deliberate — not an
unfinished corner of the monorepo. GoodBoy's public CLI/schema and its
future hosted registry backend are split the same way npm splits its own
public registry from any private registry an organization might run: the
seam between them is an HTTP API contract, not shared code. `@goodboyjs/cli`
and `@goodboyjs/schema` are stable, published, and used by every GoodBoy
install today, entirely through the local, git-friendly registry described
in the [main README](https://github.com/xpera-ch/goodboy/blob/main/README.md) — nothing in the CLI depends on this
package's methods actually working. The hosted registry API this package
will eventually talk to is not designed yet, and is deliberately owned by a
separate, closed-source service — building this client out further before
that contract exists would mean guessing at an API shape now and probably
guessing it wrong.

## What exists now

`RegistryClient` defines the shape of the eventual public interface —
`search`, `getSkill`, `publish` — each currently throwing `not implemented`.
That's the whole package: a placeholder for a contract, not a partial
implementation of one.

```typescript
import { createRegistryClient } from '@goodboyjs/registry-client'

const client = createRegistryClient({ baseUrl: 'https://registry.example.com' })
// client.search(...) / client.getSkill(...) / client.publish(...) all throw
// "not implemented" today — there is no hosted registry to call yet.
```

## What ships when

Full implementation lands once the hosted registry's API contract
stabilizes ("Phase 3" in `SECURITY.md`'s terms — publisher verification and
signature checking via a hosted registry, distinct from today's
local-registry-only model).

This package is out of the release chain as of 0.3.0: it is not published
with releases, and it will publish only once the hosted registry's API
contract exists — not before. The monorepo keeps it because the seam is
correct — the CLI/registry boundary is an HTTP contract, not shared code;
what was premature was publishing the stub, not the package's existence
(see the "44-line stub" entry in `docs/backlog.md`). Its version history
will start when it ships for real.
