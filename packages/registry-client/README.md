# @goodboyjs/registry-client

HTTP client for the GoodBoy public registry API.

> **This package is a Phase 3 stub.** None of the exported functions are implemented yet. All calls will throw `Error: not implemented — Phase 3 only`.

## Architecture

GoodBoy is split across two repositories:

- **goodboy** (this repo, public) — CLI tool, manifest schema, and this registry client
- **goodboy-registry** (private) — the registry backend, authentication, and publishing pipeline

This package is the public-facing HTTP client that the CLI uses to interact with the registry. It will be fully implemented in Phase 3 when the registry backend is ready.

## Usage

```typescript
import { createRegistryClient } from '@goodboyjs/registry-client'

const client = createRegistryClient({ baseUrl: 'https://registry.goodboy.dev' })
```
