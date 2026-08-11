# Frozen schema versions

Each `vN/` directory holds an immutable copy of the manifest schema as
published for that major version. `src/manifest.schema.json` is the working
copy and always tracks the current major; these are the historical record.

**Never edit a `vN/` file.** A consumer validating an older manifest needs
the schema as it actually shipped, not a corrected version of it.

## `$id` and the `goodboy.dev` domain

`v1/manifest.schema.json` carries:

```
"$id": "https://goodboy.dev/schemas/manifest/1.0.0"
```

**`goodboy.dev` is not a domain this project controls.** The canonical
domain is `goodboyjs.com`, and `v2` onward uses it:

```
"$id": "https://goodboyjs.com/schemas/manifest/2.0.0"
```

The v1 copy is **deliberately left as-is**. Its purpose is fidelity with
what was actually published — `@goodboyjs/schema` 1.0.0, 1.0.1 and 1.1.0 are
immutable on npm and all carry the `goodboy.dev` identifier. Rewriting the
frozen copy would buy accuracy in one place while making it an inaccurate
record of v1 everywhere else, and would not change the published artifacts.

Practical impact is limited: Ajv never fetches `$id`, so GoodBoy itself is
unaffected. Some editors and third-party validators do resolve it as a URL,
which is why it does not get carried forward.

A test asserts every `$id` under `src/` is on `https://goodboyjs.com/`, so
this cannot silently reappear in a schema added later. That test deliberately
does not cover `versions/`, which is frozen.
