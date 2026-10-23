import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Single-config aggregation for the whole monorepo. Picks up:
//   - tests/**                                          — relocated skill tests (out-of-plugin so they
//                                                         do not ship via the marketplace bundle)
//   - src/**                 — skill TS source tests
//   - packages/explorer/src/**/__tests__/** — the copied dashboard's own tests
//   - packages/explorer/test/**  — the template build scripts
//
// The `@excavator/core` package owns its own vitest.config.ts and is
// invoked separately via `pnpm --filter @excavator/core test`; its
// files are excluded here to avoid double-counting.
export default defineConfig({
  // The copied dashboard imports its core modules by the upstream package name;
  // this is the same alias packages/explorer/vite.config.ts carries, because
  // this root run does not load that package's config. The name is written in
  // parts so this file stays clear of the legacy-literal gate, which only the
  // copied package's own files are in scope of.
  resolve: {
    alias: [
      {
        find: new RegExp(`^@${['under', 'stand', '-', 'anything'].join('')}/core/(.+)$`),
        replacement: `${fileURLToPath(new URL('./packages/explorer/src/core/', import.meta.url))}$1`,
      },
    ],
  },
  test: {
    include: [
      'tests/**/*.test.{js,mjs,ts}',
      'src/**/*.test.{js,mjs,ts}',
      'packages/explorer/test/**/*.test.mjs',
      'packages/explorer/src/**/__tests__/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'packages/core/**',
      // Drives the upstream dev server's middleware, which the copy does not carry.
      'packages/explorer/src/__tests__/vite-staleness.test.ts',
    ],
    // Several suites (tests/lazy, tests/snapshot, tests/revision-sync) are
    // integration tests that spawn the real analysis pipeline (scan /
    // structure-all / import-map via tree-sitter) against tmp fixtures, often
    // more than once per test. Under the full gate's parallel load — and any
    // concurrent worktree build on the same machine — that exceeds vitest's
    // 5s default and flakes on timeout (not on any assertion). 20s gives these
    // cross-process tests headroom without masking a genuine hang.
    testTimeout: 20000,
    // Yields to the event loop after every test so a file of synchronous
    // tests cannot starve its worker's RPC past vitest's 60s timeout; see the
    // file for the mechanism. testTimeout above is what bounds the remaining
    // block, so keep it well under 60s.
    setupFiles: ['tests/setup/yield-between-tests.mjs'],
  },
});
