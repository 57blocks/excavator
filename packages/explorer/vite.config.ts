import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import { collectBundledPackages } from './scripts/licenses.mjs';
import { explorerTemplate } from './scripts/template.mjs';

// Build of the copied dashboard (openspec: changes/viewer-explorer, design D1
// and D3). The copied sources import the upstream core by its package name; the
// alias points those imports at the copy under src/core so no copied file needs
// an edit. The build writes one self-contained HTML template, explorer.html:
// one chunk, every asset inline (the plugins live in scripts/template.mjs and
// scripts/single-file.mjs). Build only: the page is opened
// from file://, never served.
const coreDir = fileURLToPath(new URL('./src/core/', import.meta.url));

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [collectBundledPackages(), react(), tailwindcss(), ...explorerTemplate()],
  // The layout worker is built apart and inlined as a blob; its packages (d3-force) are bundled too.
  worker: { plugins: () => [collectBundledPackages()] },
  // The libraries carry non-ASCII characters in their tables; written as escapes they are the same text, and the template stays ASCII.
  esbuild: { charset: 'ascii' },
  resolve: {
    alias: [{ find: /^@understand-anything\/core\/(.+)$/, replacement: `${coreDir}$1` }],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: Number.POSITIVE_INFINITY,
    cssCodeSplit: false,
    modulePreload: false,
    reportCompressedSize: false,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    // This test drives the upstream dev server's data middleware from the
    // upstream vite.config.ts, which the copy does not carry (design D1).
    exclude: ['**/node_modules/**', 'src/__tests__/vite-staleness.test.ts'],
  },
});
