import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
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
// The family segment names the document type (manifest, goodboy-json,
// goodboy-lock); each family versions independently.
const CANONICAL_ID_RE = /^https:\/\/goodboyjs\.com\/schemas\/[a-z0-9-]+\/v\d+$/;

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

    it(`${file}'s $id major matches its version-field pattern`, () => {
      // Catches the halves drifting apart: bumping the pattern to ^3\. while
      // leaving `$id` on v2 would otherwise pass every other check here.
      // The version field is named `schema_version` (manifest) or `schema`
      // (goodboy.json / goodboy.lock); a schema with neither has no version
      // pattern to match against and is skipped.
      const schema = _require(join(SCHEMA_SRC, file)) as Record<string, unknown>;
      const idMajor = /\/v(\d+)$/.exec(schema['$id'] as string)?.[1];
      const properties = schema['properties'] as Record<string, Record<string, string>>;
      const versionField = properties['schema_version'] ?? properties['schema'];
      if (versionField === undefined) return;

      const patternMajor = /\^(\d+)\\\./.exec(versionField['pattern']!)?.[1];

      expect(idMajor).toBeDefined();
      expect(patternMajor).toBeDefined();
      expect(idMajor).toBe(patternMajor);
    });
  }
});

// ---------------------------------------------------------------------------
// Shared definitions (C4b decision Q1): duplicate across schemas rather than
// building common.schema.json — but pin the duplicates byte-identical so a
// future drift is a test failure, not a silent divergence. The version-field
// patterns are deliberately NOT here: they are keyed by major per schema
// family ($id v1 vs v2), so identity across families would be wrong.
// ---------------------------------------------------------------------------

const CANONICAL_PATTERNS = {
  skillName: '^[a-z0-9-]+$',
  semver: '^\\d+\\.\\d+\\.\\d+$',
  semverRange: '^\\^?\\d+\\.\\d+\\.\\d+$',
} as const;

// Paths into each schema where a shared pattern appears. A new schema or a
// new occurrence must be registered here deliberately.
const PATTERN_SITES: Array<{
  file: string;
  path: string[];
  canonical: keyof typeof CANONICAL_PATTERNS;
}> = [
  { file: 'manifest.schema.json', path: ['properties', 'name', 'pattern'], canonical: 'skillName' },
  { file: 'manifest.schema.json', path: ['properties', 'version', 'pattern'], canonical: 'semver' },
  {
    file: 'goodboy-json.schema.json',
    path: ['properties', 'skills', 'propertyNames', 'pattern'],
    canonical: 'skillName',
  },
  {
    file: 'goodboy-json.schema.json',
    path: ['properties', 'skills', 'additionalProperties', 'pattern'],
    canonical: 'semverRange',
  },
  {
    file: 'goodboy-lock.schema.json',
    path: ['properties', 'skills', 'propertyNames', 'pattern'],
    canonical: 'skillName',
  },
  {
    file: 'goodboy-lock.schema.json',
    path: ['properties', 'skills', 'additionalProperties', 'properties', 'version', 'pattern'],
    canonical: 'semver',
  },
];

describe('shared schema patterns stay byte-identical', () => {
  for (const site of PATTERN_SITES) {
    it(`${site.file} ${site.path.join('.')} equals canonical ${site.canonical}`, () => {
      const schema = _require(join(SCHEMA_SRC, site.file)) as Record<string, unknown>;
      let node: unknown = schema;
      for (const key of site.path) {
        node = (node as Record<string, unknown>)[key];
      }
      expect(node).toBe(CANONICAL_PATTERNS[site.canonical]);
    });
  }

  it('every canonical pattern is in use by at least one schema', () => {
    const used = new Set(PATTERN_SITES.map((s) => s.canonical));
    expect(used).toEqual(new Set(Object.keys(CANONICAL_PATTERNS)));
  });
});

// ---------------------------------------------------------------------------
// Repo-wide domain guard (2026-08-12): the project's one domain is
// goodboyjs.com. goodboyjs.io is also owned but must never be referenced;
// goodboy.dev is not ours and must never appear in a live surface.
//
// This is the THIRD domain-drift instance — the v1 manifest schema shipped
// with an `$id` on goodboy.dev, and all three package.json files shipped
// `homepage: https://goodboyjs.io` while every schema `$id` used
// goodboyjs.com. The $id tests above are scoped to packages/schema/src/ and
// could not see either drift, so this guard is repo-wide.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../');
const BANNED_DOMAINS = /goodboyjs\.io|goodboy\.dev/;

// Build output and tooling artifacts; never repo content, at any depth.
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'coverage']);
// Gitignored working artifacts at the repo root (see .gitignore and
// CLAUDE.md): per-phase implementation prompts and local adversarial-review
// reports — not part of the repo, and may legitimately discuss the domains.
const SKIP_RELATIVE_DIRS = new Set([join('docs', 'prompts'), join('docs', 'reviews')]);

// Narrow, explicit exemptions — every entry is a frozen artifact or a record
// that documents the history of the mistake rather than using the domain.
// A file not on this list may never contain either domain; a new file that
// legitimately needs to document history must be added here deliberately.
const HISTORICAL_EXEMPTIONS = new Set([
  // Frozen published schemas: v1 keeps its original goodboy.dev `$id` because
  // three immutable npm tarballs carry it (see versions/README.md).
  // Exempted as a directory prefix below.
  'CHANGELOG.md', // release history, documents the $id move
  'docs/backlog.md', // backlog records the domain decision
  'docs/decisions.md', // the domain decision record itself
  'docs/go-public-checklist.md', // the domain-redirect checklist (2026-08-12) names the banned domains deliberately
  'docs/project-file-schemas-handoff.md', // pre-C4b planning handoff prose
  // This file: its own comments document the v1 `$id` and the drift history.
  'packages/cli/src/lib/schema-identity.test.ts',
]);

function repoFiles(dir: string, root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const rel = relative(root, join(dir, entry.name));
      if (SKIP_DIR_NAMES.has(entry.name) || SKIP_RELATIVE_DIRS.has(rel)) continue;
      out.push(...repoFiles(join(dir, entry.name), root));
    } else if (entry.isFile()) {
      // Transient vitest config artifacts (.gitignore: vitest.config.ts.timestamp-*)
      if (/timestamp-.*\.mjs$/.test(entry.name)) continue;
      out.push(relative(root, join(dir, entry.name)));
    }
  }
  return out;
}

describe('package.json homepage fields point at the canonical domain', () => {
  const PACKAGE_FILES = [
    'packages/cli/package.json',
    'packages/schema/package.json',
    'packages/registry-client/package.json',
  ];

  for (const file of PACKAGE_FILES) {
    it(`${file} homepage is https://goodboyjs.com`, () => {
      const pkg = JSON.parse(readFileSync(join(REPO_ROOT, file), 'utf-8')) as {
        homepage?: string;
      };
      expect(pkg.homepage).toBe('https://goodboyjs.com');
    });
  }
});

describe('repo-wide domain guard: goodboyjs.io and goodboy.dev never appear', () => {
  it('no file outside the frozen/historical exemptions references either domain', () => {
    const violations: string[] = [];
    for (const file of repoFiles(REPO_ROOT, REPO_ROOT)) {
      if (HISTORICAL_EXEMPTIONS.has(file)) continue;
      if (file.startsWith(join('packages', 'schema', 'versions'))) continue;
      const content = readFileSync(join(REPO_ROOT, file), 'utf-8');
      if (BANNED_DOMAINS.test(content)) violations.push(file);
    }
    expect(violations).toEqual([]);
  });
});
