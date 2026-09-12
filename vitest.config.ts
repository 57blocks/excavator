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
  },
});
