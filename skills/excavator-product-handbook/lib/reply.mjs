/**
 * `handbook.mjs reply <out> --project <root> [--views <list>]`: the lines the orchestrator
 * answers the user with at the end of a run, in a fixed order, computed from the chapters and
 * state.json so the model adds nothing up: the handbook file of each selected view, the page
 * line, the chapter counts (system, every map feature and the six chapters across the features),
 * the failed chapters, the features without a chapter and the candidate conservation line.
 * Refuses a run `assemble` would refuse. Changes no file.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { HANDBOOK_FILES } from './assemble.mjs';
import { CROSS_CHAPTERS, SYSTEM_CHAPTER, candidatesLine, loadMdRun } from './md-run.mjs';
import { PAGE_FILE } from './page-chunks.mjs';
import { DEFAULT_VIEWS } from './views.mjs';

/** The label of each view's handbook line. */
const HANDBOOK_LABELS = Object.freeze({ product: 'Handbook', technical: 'Technical handbook' });

/** Returns { status, lines }; status 1 with the reasons when the run is refused or a handbook file of a selected view is missing. */
export function replyLines(outDirArg, root, { views = DEFAULT_VIEWS } = {}) {
  const run = loadMdRun(outDirArg, root);
  if (!run.ok) return { status: 1, lines: run.lines };
  const missing = views.filter((view) => !existsSync(join(run.outDir, HANDBOOK_FILES[view])));
  if (missing.length > 0) return { status: 1, lines: [...missing.map((view) => `${HANDBOOK_FILES[view]}: missing`), 'Next: run assemble, then this command again'] };
  const featureIds = run.map.features.map((feature) => feature.id);
  const names = [SYSTEM_CHAPTER, ...featureIds, ...CROSS_CHAPTERS];
  const written = names.filter((name) => run.chapters.has(name));
  const failed = written.filter((name) => run.chapters.get(name).record.status === 'failed');
  const unwritten = featureIds.filter((id) => !run.chapters.has(id));
  const page = join(run.outDir, PAGE_FILE);
  const lines = [
    ...views.map((view) => `${HANDBOOK_LABELS[view]}: ${join(run.outDir, HANDBOOK_FILES[view])}`),
    existsSync(page) ? `Page: ${page}` : 'Page: not written',
    `Chapters: ${names.length} (passed ${written.length - failed.length}, failed ${failed.length}, not written ${names.length - written.length})`,
  ];
  if (failed.length > 0) lines.push(`Failed: ${failed.join(', ')}`);
  if (unwritten.length > 0) lines.push(`Not written: ${unwritten.join(', ')}`);
  lines.push(candidatesLine(run.map, run.candidates));
  const notWritten = names.length - written.length;
  const failedOnce = failed.filter((name) => run.chapters.get(name).record.attempts < 2).length;
  lines.push(notWritten === 0 && failedOnce === 0 ? 'Run: complete' : `Run: incomplete (${notWritten} not written, ${failedOnce} failed once); the same command on the same --out resumes`);
  return { status: 0, lines };
}
