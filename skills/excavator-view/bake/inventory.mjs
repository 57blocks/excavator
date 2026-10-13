/**
 * inventory.mjs
 *
 * The bake's inventory of `<projectRoot>/.excavator/`: the shared rules
 * (shared/inventory-rules.mjs) applied to the file system.
 */

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { inventoryOf } from '../shared/inventory-rules.mjs';

export { ARTIFACTS } from '../shared/inventory-rules.mjs';

/** @param {string} dataDir */
export function takeInventory(dataDir) {
  return inventoryOf((name) => {
    const path = join(dataDir, name);
    return existsSync(path) && statSync(path).isFile() ? statSync(path).size : null;
  });
}
