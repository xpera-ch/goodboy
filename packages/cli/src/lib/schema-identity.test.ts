import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const _require = createRequire(import.meta.url);
const SCHEMA_SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../schema/src',
);
const CANONICAL_ORIGIN = 'https://goodboyjs.com/';

// `$id` is keyed by MAJOR, matching the versions/ directory (v1, v2). A schema
// evolving additively within a major is the same schema identity; only a new
// major is a new identity. The alternative — a full version in the `$id` —
// goes stale the moment a minor ships, which is exactly the inconsistency the
// 2.0.0 phase set out to remove (1.1.0 shipped carrying `$id` …/1.0.0).
const CANONICAL_ID_RE = /^https:\/\/goodboyjs\.com\/schemas\/manifest\/v\d+$/;

/**
 * Guards against an uncontrolled domain reappearing in a schema identifier,
 * and against `$id` drifting back to full-version granularity.
 *
 * The v1 schema shipped with `$id: https://goodboy.dev/schemas/manifest/1.0.0`
 * on a domain the project does not own, and that identifier is now frozen in
 * three immutable npm tarballs. Ajv never fetches `$id`, so GoodBoy itself is
 * unaffected — but some editors and third-party validators do resolve it, so
 * it must not happen again.
 *
 * Deliberately scoped to `src/` only. `versions/` is frozen and v1 keeps its
 * original `$id` on purpose; see packages/schema/versions/README.md.
 */
describe('schema identity', () => {
  const schemaFiles = readdirSync(SCHEMA_SRC).filter((f) => f.endsWith('.schema.json'));

  it('finds at least one schema to check', () => {
    expect(schemaFiles.length).toBeGreaterThan(0);
  });

  for (const file of schemaFiles) {
    it(`${file} declares an $id on the canonical domain`, () => {
      const schema = _require(join(SCHEMA_SRC, file)) as Record<string, unknown>;
      const id = schema['$id'];

      expect(typeof id).toBe('string');
      expect(id as string).toMatch(/^https:\/\//);
      expect((id as string).startsWith(CANONICAL_ORIGIN)).toBe(true);
    });

    it(`${file} keys its $id by major, not by full version`, () => {
      const schema = _require(join(SCHEMA_SRC, file)) as Record<string, unknown>;
      expect(schema['$id'] as string).toMatch(CANONICAL_ID_RE);
    });

    it(`${file}'s $id major matches its schema_version pattern`, () => {
      // Catches the halves drifting apart: bumping the pattern to ^3\. while
      // leaving `$id` on v2 would otherwise pass every other check here.
      const schema = _require(join(SCHEMA_SRC, file)) as Record<string, unknown>;
      const idMajor = /\/v(\d+)$/.exec(schema['$id'] as string)?.[1];
      const properties = schema['properties'] as Record<string, Record<string, string>>;
      const patternMajor = /\^(\d+)\\\./.exec(properties['schema_version']!['pattern']!)?.[1];

      expect(idMajor).toBeDefined();
      expect(patternMajor).toBeDefined();
      expect(idMajor).toBe(patternMajor);
    });
  }
});
