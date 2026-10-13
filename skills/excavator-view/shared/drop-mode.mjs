/**
 * drop-mode.mjs
 *
 * Read a dropped or picked `.excavator/` directory into the view's segments
 * (task 9.1): locate the data directory, take the inventory, read it with
 * the same rules the bake uses (parse-data-dir.mjs), and compose segments
 * with source text marked "not embedded" (reason `drop-mode`). Runs in the
 * page's data Worker (or on the main thread as fallback). A missing required
 * artifact or a malformed graph throws; the page shows the error.
 */

import { inventoryOf } from './inventory-rules.mjs';
import { dropModeView, parseDataDirectory, requireArtifacts } from './parse-data-dir.mjs';
import { fileDataDirReader, locateDataDirectory } from './file-reader.mjs';

/**
 * @param {import('./file-reader.mjs').DroppedFile[]} entries
 * @param {{ now?: () => string }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readDroppedDirectory(entries, { now = () => new Date().toISOString() } = {}) {
  const located = locateDataDirectory(entries);
  const reader = fileDataDirReader(located);
  const inventory = inventoryOf((name) => reader.sizeOf(name));
  const where = located.directory === '' ? 'the dropped files' : located.directory;
  requireArtifacts(inventory, where);
  const parsed = await parseDataDirectory(reader, { inventory });
  return dropModeView(parsed, { directory: where, loadedAt: now() });
}
