import { defineConfig } from 'vitest/config';

// Real-binary end-to-end tier, kept out of the main suite by directory
// placement (e2e/ outside src/) — vitest.config.ts's `include` matches
// src/**/*.test.ts and must not be taught to skip files. Do not add this
// config to coverage include/thresholds: coverage stays computed from the
// fast in-process suite only (docs/decisions.md, 2026-08-17).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/**/*.e2e.test.ts'],
    // Each test spawns the CLI several times; the internal 30s per-command
    // timeout in the e2e helper surfaces hangs with a clear message before
    // this outer limit.
    testTimeout: 45_000,
  },
});
