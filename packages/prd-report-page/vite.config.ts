import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import { collectBundledPackages } from '../explorer/scripts/licenses.mjs';
import { pageTemplate } from './scripts/template.mjs';

// Build of the report page (openspec change prd-report-page, design D2). One
// self-contained HTML template, prd-report-page.html: one chunk (mermaid's
// lazily loaded diagram types are inlined), every asset inline; the plugins
// live in the explorer's scripts and in scripts/template.mjs. Build only: the
// page is opened from file://, never served.
export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [collectBundledPackages(), react(), tailwindcss(), ...pageTemplate()],
  // The libraries carry non-ASCII characters in their tables; written as escapes they are the same text, and the template stays ASCII.
  esbuild: { charset: 'ascii' },
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
    include: ['test/**/*.test.{ts,mjs}'],
    exclude: ['**/node_modules/**'],
  },
});
