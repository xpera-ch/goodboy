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

/**
 * Guards against an uncontrolled domain reappearing in a schema identifier.
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
  }
});
