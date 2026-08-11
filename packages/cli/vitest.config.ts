import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Recorded mock calls are cleared before every test, so a negative
    // assertion (expect(fn).not.toHaveBeenCalled()) cannot silently pass or
    // fail because of what an earlier test in another suite happened to
    // call. Note this clears calls only — mock *implementations* and
    // non-mock module state (e.g. commander's parsed option values, see
    // resetCommandOptions in src/__fixtures__) survive it and still need
    // explicit per-suite resets.
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/types/**',
        'src/index.ts',
        // src/commands/skill-version.ts, verify.ts, skill-status.ts,
        // adopt.ts, and add.ts are intentionally NOT listed here — they
        // contain security-relevant cleanup/tamper-detection/untrusted-input
        // logic and are held to 100% coverage below, like the
        // security-critical lib files. The rest of src/commands/ remains
        // excluded; un-excluding another command file is a separate
        // decision (each will surface its own pre-existing gaps).
        'src/commands/init.ts',
        'src/commands/install.ts',
        'src/commands/list.ts',
        'src/commands/registry-cmd.ts',
        'src/commands/search.ts',
        'src/commands/skill-create.ts',
        'src/commands/skill-diff.ts',
        'src/commands/skill-open.ts',
        'src/commands/skill.ts',
        'src/commands/uninstall.ts',
        'src/commands/upgrade.ts',
        'src/__fixtures__/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
        // Security-critical and new registry files require 100% coverage
        'src/lib/manifest.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/lib/registry.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/lib/registry-entry.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/lib/skill-validator.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/lib/goodboy-file.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/lib/agents.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/lib/store.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/commands/skill-version.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/lib/integrity.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/lib/verify.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/commands/verify.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/commands/skill-status.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/commands/adopt.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/commands/add.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/lib/redact.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/lib/logger.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/lib/gitignore.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
      },
    },
  },
});
