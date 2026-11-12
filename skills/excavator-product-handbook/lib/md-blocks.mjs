/**
 * The blocks the scripts write besides the chapter files: the data section, the status
 * dictionaries and the code health. `assemble` renders them as text and `page` hands them to the
 * page as data; both ask this module which of them exist, so the two agree on the blocks of a run.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { scanProject } from './applications.mjs';
import { DATA_FILE } from './data-section.mjs';
import { DICT_FILE } from './dict-section.mjs';
import { buildHistory } from './history-model.mjs';
import { SCRIPT_BLOCKS } from './outline-v2.mjs';

export const HISTORY_FILE = join('entries', 'history.json');
const FILES = { data: DATA_FILE, dictionaries: DICT_FILE, history: HISTORY_FILE };
/** The blocks only the technical view has. */
export const TECHNICAL_ONLY_BLOCKS = Object.freeze(['data', 'dictionaries']);

/** The script blocks whose file is in the out directory, in the fixed order. */
export const scriptBlockNames = (run) => SCRIPT_BLOCKS.filter((name) => existsSync(join(run.outDir, FILES[name])));

/** The code health of a run: the hotspots cite only features that have a chapter. */
export function historyOf(run, root) {
  const entries = new Map(run.map.features.filter((feature) => run.chapters.has(feature.id)).map((feature) => [feature.id, true]));
  return buildHistory(run.outDir, { roots: scanProject(root).roots, entries });
}
