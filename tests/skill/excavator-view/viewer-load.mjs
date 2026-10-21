/**
 * Loads the viewer's scripts into a vm context for the tests (design D1): classic scripts that hang
 * everything on `window.XV`, so a context with a `window` and the few browser globals they use is enough.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const viewerSrc = join(resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), 'viewer', 'src');

/**
 * A context with the viewer's scripts loaded in index.html order. `globals` stand in for browser APIs.
 * app.js boots as soon as it finds #xv-app, so it is left out unless `withApp` is set.
 */
export function load(globals = {}, { withApp = false } = {}) {
  const context = vm.createContext({ ...globals });
  context.window = context;
  const order = readFileSync(join(viewerSrc, '..', 'index.html'), 'utf-8').match(/src\/[a-z]+\.js/g)
    .filter((file) => withApp || file !== 'src/app.js');
  for (const file of order) vm.runInContext(readFileSync(join(viewerSrc, '..', file), 'utf-8'), context, { filename: file });
  return context.XV;
}
