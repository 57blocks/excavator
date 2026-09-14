import { defineConfig } from 'vitest/config';

// Single-config aggregation for the whole monorepo. Picks up:
//   - tests/**                                          — relocated skill tests (out-of-plugin so they
//                                                         do not ship via the marketplace bundle)
//   - src/**                 — skill TS source tests
//
// The `@excavator/core` package owns its own vitest.config.ts and is
// invoked separately via `pnpm --filter @excavator/core test`; its
// files are excluded here to avoid double-counting.
export default defineConfig({
  test: {
    include: [
      'tests/**/*.test.{js,mjs,ts}',
      'src/**/*.test.{js,mjs,ts}',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'packages/core/**',
    ],
    // Several suites (tests/lazy, tests/snapshot, tests/revision-sync) are
    // integration tests that spawn the real analysis pipeline (scan /
    // structure-all / import-map via tree-sitter) against tmp fixtures, often
    // more than once per test. Under the full gate's parallel load — and any
    // concurrent worktree build on the same machine — that exceeds vitest's
    // 5s default and flakes on timeout (not on any assertion). 20s gives these
    // cross-process tests headroom without masking a genuine hang.
    testTimeout: 20000,
  },
});
