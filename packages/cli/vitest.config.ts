import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/types/**',
        'src/index.ts',
        // src/commands/skill-version.ts is intentionally NOT listed here — it
        // now contains security-relevant cleanup logic and is held to 100%
        // coverage below, like the security-critical lib files. The rest of
        // src/commands/ remains excluded; un-excluding another command file
        // is a separate decision (each will surface its own pre-existing gaps).
        'src/commands/add.ts',
        'src/commands/init.ts',
        'src/commands/install.ts',
        'src/commands/list.ts',
        'src/commands/registry-cmd.ts',
        'src/commands/search.ts',
        'src/commands/skill-create.ts',
        'src/commands/skill-diff.ts',
        'src/commands/skill-open.ts',
        'src/commands/skill-status.ts',
        'src/commands/skill.ts',
        'src/commands/uninstall.ts',
        'src/commands/upgrade.ts',
        'src/__fixtures__/**',
        'src/lib/logger.ts',
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
      },
    },
  },
});
