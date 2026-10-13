/**
 * node-reader.mjs
 *
 * The bake's file access for one `.excavator/` directory: the
 * `DataDirReader` (shared/parse-data-dir.mjs) over the local file system.
 */

import { createReadStream, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/**
 * @param {string} dataDir
 * @returns {import('../shared/parse-data-dir.mjs').DataDirReader}
 */
export function nodeDataDirReader(dataDir) {
  return {
    path: (name) => join(dataDir, name),
    async *lines(name) {
      const input = createReadStream(join(dataDir, name), { encoding: 'utf-8' });
      const lines = createInterface({ input, crlfDelay: Infinity });
      try {
        yield* lines;
      } finally {
        lines.close();
        input.destroy();
      }
    },
    async *chunks(name) {
      const input = createReadStream(join(dataDir, name), { highWaterMark: 1 << 20 });
      try {
        for await (const chunk of input) yield /** @type {Uint8Array} */ (chunk);
      } finally {
        input.destroy();
      }
    },
    text: async (name) => readFileSync(join(dataDir, name), 'utf-8'),
  };
}
