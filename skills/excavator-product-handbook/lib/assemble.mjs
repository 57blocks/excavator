/**
 * `handbook.mjs assemble <out> --project <root>` (design D11): write
 * `<out>/handbook.md` from the map and the checked entries. The run is loaded
 * and checked again first (load-run.mjs), so a run whose files changed after
 * their check is refused instead of assembled. Writes nothing when anything
 * fails.
 */

import { join } from 'node:path';

import { writeTextAtomic } from './json-file.mjs';
import { loadCheckedRun } from './load-run.mjs';
import { renderHandbook } from './render.mjs';

export const HANDBOOK_FILE = 'handbook.md';

/** Returns { status, lines }; on success the one line is the path written. */
export function assemble(outDirArg, root) {
  const run = loadCheckedRun(outDirArg, root);
  if (!run.ok) return { status: 1, lines: run.lines };
  const path = join(run.outDir, HANDBOOK_FILE);
  writeTextAtomic(path, renderHandbook({ map: run.map, entries: run.entries, state: run.state, candidates: run.candidates, ui: run.ui }));
  return { status: 0, lines: [path] };
}
