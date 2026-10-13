/**
 * fingerprint-lines.mjs
 *
 * Per-file line counts from `fingerprints.json` on disk, read in chunks
 * through the shared streaming scanner (shared/fingerprint-scan.mjs, which
 * holds the rules).
 */

import { createReadStream } from 'node:fs';

import { scanFingerprintLineCounts } from '../shared/fingerprint-scan.mjs';

export { FingerprintFormatError } from '../shared/fingerprint-scan.mjs';

/**
 * @param {string} path
 * @param {{ highWaterMark?: number }} [options]
 * @returns {Promise<Map<string, number>>}
 */
export async function readFingerprintLineCounts(path, { highWaterMark = 1 << 20 } = {}) {
  const input = createReadStream(path, { highWaterMark });
  try {
    return await scanFingerprintLineCounts(input);
  } finally {
    input.destroy();
  }
}
