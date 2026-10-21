import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { singleFile } from './scripts/single-file.mjs';

// Builds the one HTML template the packer fills (openspec: changes/viewer-app,
// design D1-D2): one chunk, every asset inline, then the single-file plugin
// folds the chunk and the stylesheet into view.html. Build only: the page is
// opened from file://, never served.
export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [react(), tailwindcss(), singleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: Number.POSITIVE_INFINITY,
    cssCodeSplit: false,
    modulePreload: false,
    reportCompressedSize: false,
    rollupOptions: {
      input: fileURLToPath(new URL('./view.html', import.meta.url)),
      output: { inlineDynamicImports: true },
    },
  },
});
