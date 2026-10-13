import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The template must work when opened from file://, where a page cannot fetch
// sibling files or load external module scripts. Everything (JS, CSS, any
// asset) is therefore inlined into one dist/index.html, with relative base and
// no code splitting.
export default defineConfig(({ command }) => {
  // The template ships as built; a NODE_ENV inherited from the caller (vitest
  // sets "test") must not turn it into a React development build.
  if (command === 'build') process.env.NODE_ENV = 'production';
  return {
    base: './',
    plugins: [react(), viteSingleFile({ removeViteModuleLoader: true })],
    resolve: {
      // The shared codec's encoder (never used by the page) imports node:zlib.
      alias: { 'node:zlib': fileURLToPath(new URL('./src/zlib-stub.ts', import.meta.url)) },
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
