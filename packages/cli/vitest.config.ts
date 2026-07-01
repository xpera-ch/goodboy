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
        'src/commands/**',
        'src/__fixtures__/**',
        'src/lib/logger.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
        // Security-critical files require 100% coverage
        'src/lib/hooks.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/lib/manifest.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'src/lib/registry.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
      },
    },
  },
});
