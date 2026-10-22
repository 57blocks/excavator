import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Plain build of the copied dashboard (openspec: changes/viewer-explorer,
// design D1). The copied sources import the upstream core by its package
// name; the alias points those imports at the copy under src/core so no copied
// file needs an edit. The offline build (one
// self-contained HTML file) is added in a later step.
const coreDir = fileURLToPath(new URL('./src/core/', import.meta.url));

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [{ find: /^@understand-anything\/core\/(.+)$/, replacement: `${coreDir}$1` }],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    // This test drives the upstream dev server's data middleware from the
    // upstream vite.config.ts, which the copy does not carry (design D1).
    exclude: ['**/node_modules/**', 'src/__tests__/vite-staleness.test.ts'],
  },
});
