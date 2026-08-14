# Frozen schema versions

Each `vN/` directory holds immutable copies of one schema family's schemas
as published for that family's major version. `src/` holds the working
copies and always tracks each family's current major; these are the
historical record.

Three families ship from this package, versioning independently:

| Family | File | Current `$id` major |
|---|---|---|
| Manifest | `manifest.schema.json` | v2 |
| Project file | `goodboy-json.schema.json` | v1 |
| Lock file | `goodboy-lock.schema.json` | v1 |

**Never edit a `vN/` file.** A consumer validating an older schema needs it
as it actually shipped, not a corrected version of it — that applies to all
three families alike.

## `vN/` is keyed by each family's major

The directory layout follows each family's *own* major, not the schema
package's version. That is why this package is at 2.0.0 while two of the
three families sit at `v1/`: a family majors only when its own schema
breaks, and the families broke at different times. The skew is correct —
the CLI already assumes it, via a separate `KNOWN_*_SCHEMA_VERSION`
constant per file — but it was unexplained until now.

## `$id` granularity

`$id` is keyed by **major**, matching this directory's layout:

```
"$id": "https://goodboyjs.com/schemas/manifest/v2"
"$id": "https://goodboyjs.com/schemas/goodboy-json/v1"
"$id": "https://goodboyjs.com/schemas/goodboy-lock/v1"
```

A schema that evolves additively within a major is the *same* schema
identity; only a new major is a new identity. Putting a full version in the
`$id` goes stale the moment a minor ships — v1 demonstrated exactly that,
publishing `@goodboyjs/schema` 1.1.0 with an `$id` still reading
`…/manifest/1.0.0`.

`src/` and the frozen `vN/` copy for the current major therefore carry the
same `$id` per family. Note this means a consumer registering both files
in one Ajv instance will hit a duplicate-`$id` error; register one.

## `$id` and the `goodboy.dev` domain

`v1/manifest.schema.json` carries:

```
"$id": "https://goodboy.dev/schemas/manifest/1.0.0"
```

**`goodboy.dev` is not a domain this project controls.** The canonical
domain is `goodboyjs.com`, and `v2` onward uses it.

The manifest v1 copy is **deliberately left as-is**. Its purpose is
fidelity with what was actually published — `@goodboyjs/schema` 1.0.0,
1.0.1 and 1.1.0 are immutable on npm and all carry the `goodboy.dev`
identifier. Rewriting the frozen copy would buy accuracy in one place
while making it an inaccurate record of v1 everywhere else, and would not
change the published artifacts. The two newer families never had this
problem: both were born on `goodboyjs.com`.

Practical impact is limited: Ajv never fetches `$id`, so GoodBoy itself is
unaffected. Some editors and third-party validators do resolve it as a URL,
which is why it does not get carried forward.

A test asserts every `$id` under `src/` is on `https://goodboyjs.com/`, so
this cannot silently reappear in a schema added later. That test deliberately
does not cover `versions/`, which is frozen.
