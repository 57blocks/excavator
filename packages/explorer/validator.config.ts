import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

// Build of the copied graph validator for Node (openspec: changes/viewer-explorer,
// design D4). The packing step counts the issues the copy's own validateGraph
// finds, and the skill scripts run as plain Node without a TypeScript loader, so
// the copied module is bundled as it is (zod included) into one CommonJS file
// that a script can load synchronously. It is a build output next to the
// template, not part of the page: dist/ keeps holding explorer.html alone.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist-node',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    reportCompressedSize: false,
    rollupOptions: {
      // zod carries comments rollup cannot place; they change nothing in the output.
      onwarn(warning, warn) {
        if (warning.code !== 'INVALID_ANNOTATION') warn(warning);
      },
    },
    lib: {
      entry: fileURLToPath(new URL('./src/core/schema.ts', import.meta.url)),
      formats: ['cjs'],
      fileName: () => 'schema.cjs',
    },
  },
});
