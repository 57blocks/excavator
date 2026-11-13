import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import { collectBundledPackages } from '../explorer/scripts/licenses.mjs';
import { dropDiagramFontImport } from './scripts/no-font-import.mjs';
import { pageTemplate } from './scripts/template.mjs';

// Build of the handbook page (openspec change product-handbook-map, design
// D13). One self-contained HTML template, product-handbook-page.html: one
// chunk, every asset inline; the plugins live in the explorer's scripts and in
// scripts/template.mjs. Build only: the page is opened from file://, never served.
export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [collectBundledPackages(), dropDiagramFontImport(), react(), tailwindcss(), ...pageTemplate()],
  // Non-ASCII characters in the libraries are written as escapes (the same text), and the template stays ASCII.
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
    include: ['test/**/*.test.{ts,tsx,mjs}'],
    exclude: ['**/node_modules/**'],
  },
});
