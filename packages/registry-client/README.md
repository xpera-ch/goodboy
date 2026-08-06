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
in the [main README](../../README.md) — nothing in the CLI depends on this
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
local-registry-only model). This package is published and versioned
independently starting now, rather than being bolted onto the CLI later, so
its own version history and npm listing exist from day one even while its
contents are minimal.
