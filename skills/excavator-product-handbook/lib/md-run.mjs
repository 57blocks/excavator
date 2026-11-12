/**
 * The checked state of a Markdown-chapter run, loaded for `assemble` and `reply`: the map,
 * the candidates, the fixed text, state.json (format /2 only) and every chapter file with its
 * record. A chapter file with no record, or whose sha256 is not the recorded one, refuses the
 * run: nothing is written from a chapter nobody checked in its present form.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadCandidates } from './candidates.mjs';
import { CROSS_CHAPTERS } from './chapter-lint.mjs';
import { UsageError } from './errors.mjs';
import { conservationProblems, readMap } from './map-check.mjs';
import { mapShapeProblems } from './map-shape.mjs';
import { loadStateV2 } from './state-v2.mjs';
import { loadUi } from './ui.mjs';

export const SYSTEM_CHAPTER = 'system';
const NEXT_CHECK = 'Next: run check for these chapters, then assemble again';
const NEXT_MAP = 'Next: run check-map, then this command again';
const NEXT_REMOVE = 'Next: remove these files, then this command again';
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/**
 * `{ ok: true, outDir, map, candidates, ui, state, chapters }` (`chapters`: Map of file stem ->
 * `{ text, record }`, in name order) or `{ ok: false, lines }`. Throws a UsageError for a missing
 * out directory, map.json or candidates.json.
 */
export function loadMdRun(outDirArg, root) {
  const outDir = resolve(outDirArg);
  if (!existsSync(outDir)) throw new UsageError(`out directory ${outDir} does not exist`);
  const candidates = loadCandidates(outDir, root);
  if (!candidates.ok) return { ok: false, lines: candidates.problems };
  const mapRead = readMap(outDir);
  if (!mapRead.ok) return { ok: false, lines: [mapRead.line] };
  const map = mapRead.value;
  const shape = mapShapeProblems(map);
  if (shape.length > 0) return { ok: false, lines: [...shape.map((line) => `map.json: ${line}`), NEXT_MAP] };
  const lost = conservationProblems(map, candidates.items);
  if (lost.length > 0) return { ok: false, lines: [...lost.map((line) => `map.json: ${line}`), NEXT_MAP] };
  const ui = loadUi(outDir);
  if (!ui.ok) return { ok: false, lines: ui.lines };
  const loaded = loadStateV2(outDir);
  if (!loaded.ok) return { ok: false, lines: [loaded.line] };
  const { state } = loaded;
  const dir = join(outDir, 'chapters');
  const names = existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.md')).map((file) => file.replace(/\.md$/, '')).sort() : [];
  const chapters = new Map();
  const known = new Set([SYSTEM_CHAPTER, ...map.features.map((feature) => feature.id), ...CROSS_CHAPTERS]);
  const strays = names.filter((name) => !known.has(name));
  if (strays.length > 0) return { ok: false, lines: [...strays.map((name) => `chapters/${name}.md is not a chapter of this run: not system, a cross chapter or a feature id of map.json`), NEXT_REMOVE] };
  const problems = [];
  for (const name of names) {
    const bytes = readFileSync(join(dir, `${name}.md`));
    const record = state.chapters[name];
    if (record === undefined) problems.push(`chapters/${name}.md was not checked`);
    else if (record.sha256 !== sha256(bytes)) problems.push(`chapters/${name}.md changed after its check`);
    else chapters.set(name, { text: bytes.toString('utf-8'), record });
  }
  if (problems.length > 0) return { ok: false, lines: [...problems, NEXT_CHECK] };
  return { ok: true, outDir, map, candidates: candidates.items, ui: ui.strings, state, chapters };
}

/** The six chapters across the features, in the default order of their own groups. */
export { CROSS_CHAPTERS };

/** The candidate conservation line of `reply`, computed from the map and the candidate list. */
export function candidatesLine(map, candidates) {
  const assigned = map.features.reduce((sum, feature) => sum + feature.candidates.length, 0);
  return `Candidates: ${candidates.length} listed, ${assigned} in features, ${map.unassigned.length} unassigned; none missing, none counted twice`;
}
