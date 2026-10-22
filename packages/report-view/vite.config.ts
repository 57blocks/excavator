import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { inlineFonts } from './scripts/fonts.mjs';
import { bundledPackagesNotice, collectBundledPackages } from './scripts/licenses.mjs';
import { singleFile } from './scripts/single-file.mjs';

// Builds the one HTML template the packer fills (openspec: changes/viewer-app,
// design D1-D2): one chunk, every asset inline, then the single-file plugin
// folds the chunk and the stylesheet into view.html, under a comment that lists
// the bundled packages and their licences. The fonts are inlined by their own
// plugin (changes/viewer-learn, design D7). Build only: the page is opened from
// file://, never served.
export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [collectBundledPackages(), inlineFonts(), react(), tailwindcss(), singleFile(bundledPackagesNotice)],
  // The focus layout's worker is built apart; its packages (d3-force) are bundled too.
  worker: { plugins: () => [collectBundledPackages()] },
  // The libraries carry non-ASCII characters in their tables (character classes, for one); written as escapes they are the same text, and the template stays ASCII.
  esbuild: { charset: 'ascii' },
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
