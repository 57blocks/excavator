/**
 * `handbook.mjs assemble <out> --project <root> [--views <list>]` (design D11):
 * write the handbook of each selected view from the map and the checked
 * entries: `<out>/handbook.md` for the product view and
 * `<out>/handbook-technical.md` for the technical view. The run is loaded and
 * checked again first (load-run.mjs), so a run whose files changed after their
 * check is refused instead of assembled. Writes nothing when anything fails;
 * after the checks, the file of a view that was not selected is removed, so an
 * earlier run's other view cannot be mistaken for this one's.
 */

import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { handbookModel } from './handbook-model.mjs';
import { writeTextAtomic } from './json-file.mjs';
import { loadCheckedRun } from './load-run.mjs';
import { renderHandbook } from './render.mjs';
import { DEFAULT_VIEWS, VIEWS } from './views.mjs';

export const HANDBOOK_FILE = 'handbook.md';
export const TECHNICAL_HANDBOOK_FILE = 'handbook-technical.md';
/** The file each view is written to. */
export const HANDBOOK_FILES = Object.freeze({ product: HANDBOOK_FILE, technical: TECHNICAL_HANDBOOK_FILE });

/** Returns { status, lines }; on success the lines are the paths written, one per view in the fixed order. */
export function assemble(outDirArg, root, { views = DEFAULT_VIEWS } = {}) {
  const run = loadCheckedRun(outDirArg, root);
  if (!run.ok) return { status: 1, lines: run.lines };
  const model = handbookModel(run, root, views);
  const rendered = views.map((view) => [view, renderHandbook({ map: run.map, entries: run.entries, chapters: run.chapters, architecture: run.architecture, state: run.state, candidates: run.candidates, ui: run.ui, ...model, view })]);
  for (const view of VIEWS) if (!views.includes(view)) rmSync(join(run.outDir, HANDBOOK_FILES[view]), { force: true });
  const lines = [];
  for (const [view, text] of rendered) {
    const path = join(run.outDir, HANDBOOK_FILES[view]);
    writeTextAtomic(path, text);
    lines.push(path);
  }
  return { status: 0, lines };
}
