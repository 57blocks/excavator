import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

const DATA_PLACEHOLDER = '<script type="text/plain" id="excavator-view-data"></script>';

/** Dev server only: fill the data placeholder with the committed sample bundle. */
function devFixture(): Plugin {
  return {
    name: 'excavator-view-dev-fixture',
    apply: 'serve',
    transformIndexHtml(html) {
      const payload = readFileSync(fileURLToPath(new URL('./fixtures/sample.bundle.txt', import.meta.url)), 'utf-8');
      return html.replace(DATA_PLACEHOLDER, `<script type="text/plain" id="excavator-view-data">\n${payload.trim()}\n</script>`);
    },
  };
}

// The template must work when opened from file://, where a page cannot fetch
// sibling files or load external module scripts. Everything (JS, CSS, the
// decode Worker, any asset) is therefore inlined into one dist/index.html,
// with relative base and no code splitting.
export default defineConfig(({ command }) => {
  // The template ships as built; a NODE_ENV inherited from the caller (vitest
  // sets "test") must not turn it into a React development build.
  if (command === 'build') process.env.NODE_ENV = 'production';
  return {
    base: './',
    plugins: [react(), viteSingleFile({ removeViteModuleLoader: true }), devFixture()],
    resolve: {
      // The shared codec's encoder (never used by the page) imports node:zlib.
      alias: { 'node:zlib': fileURLToPath(new URL('./src/zlib-stub.ts', import.meta.url)) },
    },
    worker: {
      // The decode Worker is inlined and started from a blob URL; a classic
      // (iife) worker with no chunks is the most portable form under file://.
      format: 'iife',
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
    build: {
      target: 'es2022',
      cssCodeSplit: false,
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      modulePreload: false,
      reportCompressedSize: false,
      rollupOptions: {
        output: { inlineDynamicImports: true },
      },
    },
  };
});
