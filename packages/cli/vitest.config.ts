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
        // src/commands/skill-version.ts, verify.ts, and skill-status.ts are
        // intentionally NOT listed here — they contain security-relevant
        // cleanup/tamper-detection logic and are held to 100% coverage below,
        // like the security-critical lib files. The rest of src/commands/
        // remains excluded; un-excluding another command file is a separate
        // decision (each will surface its own pre-existing gaps).
        'src/commands/add.ts',
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
        'src/lib/integrity.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/lib/verify.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/commands/verify.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/commands/skill-status.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/lib/errors.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/lib/process.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/lib/redact.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/secrets/config.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/lib/gitignore.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/secrets/types.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/secrets/provider-registry.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/secrets/providers/environment.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/secrets/providers/onepassword-cli.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/secrets/resolver.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
      },
    },
  },
});
