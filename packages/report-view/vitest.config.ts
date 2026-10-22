import { defineConfig } from 'vitest/config';

// The package's own test run; the root vitest config picks up the same files,
// so `pnpm test` at the repository root covers them too.
export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx,mjs}'],
    environment: 'node',
  },
});
