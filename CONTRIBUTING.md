# Contributing to GoodBoy

## Repository layout

```
packages/
  cli/               @goodboy/cli — the goodboy binary
  schema/            @goodboy/schema — manifest JSON Schema + TypeScript types
  registry-client/   @goodboy/registry-client — Phase 3 registry HTTP client
scripts/
  generate-types.ts  regenerates packages/schema/generated/ts/index.d.ts
```

## Prerequisites

- Node.js ≥ 18
- npm ≥ 9 (workspaces support required)

## Setup

```sh
git clone https://github.com/<org>/goodboy
cd goodboy
npm install
```

## Common tasks

```sh
# Regenerate TypeScript types from the manifest schema
npm run generate:types

# Build the CLI
npm run build -w packages/cli

# Build the registry client
npm run build -w packages/registry-client
```

## Updating the schema

1. Edit `packages/schema/src/manifest.schema.json`
2. Run `npm run generate:types` to regenerate the TypeScript types
3. Copy the updated schema to `packages/schema/versions/v1/manifest.schema.json` if this is a new published version

## Pull requests

- One logical change per PR
- All TypeScript must compile without errors (`tsc --noEmit`)
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)

## Security

If you discover a security vulnerability, please **do not open a public issue**. Email the maintainers directly.
