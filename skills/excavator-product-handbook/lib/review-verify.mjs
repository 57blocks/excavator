/**
 * The semantic check of the design problems (openspec change handbook-design-review, D5).
 * `review claims <out> <batch>` prints, for each item of a batch, its fields and the chapter lines that hold
 * each of its citations: the whole input of the verifier. `review prune <out> <batch>` reads the verifier's
 * entries/review/<batch>.verdicts.json, removes the unsupported items from the batch file, records them in
 * entries/review-removed.json and, when every batch is ready, writes the chapter again.
 *
 * The verdict indexes refer to the items before pruning, so the first prune keeps those items in
 * entries/review/<batch>.unpruned.json and every later prune reads them from there: pruning twice with the
 * same verdicts gives the same files.
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { isObject, readJson, writeJson } from './json-file.mjs';
import { batchFile, renderReview, reviewContext } from './review-render.mjs';
import { specKey } from './chapter-cites.mjs';

export const REMOVED_FILE = 'entries/review-removed.json';
export const verdictsFile = (batch) => `entries/review/${batch}.verdicts.json`;
export const unprunedFile = (batch) => `entries/review/${batch}.unpruned.json`;
const VERDICTS = ['supported', 'unsupported'];

/** `{ ok: true, ctx, batch, items }` for a batch that exists in the facts file and whose file is a list of items; else `{ ok: false, lines }`. */
function openBatch(outDir, root, id, file = batchFile(id)) {
  const ctx = reviewContext(outDir, root);
  if (!ctx.ok) return ctx;
  const batch = ctx.facts.batches.find((entry) => entry.id === id);
  if (batch === undefined) return { ok: false, lines: [`${id} is not a batch; the batches are ${ctx.facts.batches.map((entry) => entry.id).join(', ')}`] };
  const read = readJson(join(outDir, file));
  if (!read.ok) return { ok: false, lines: [`${id}: ${file} ${read.reason}`] };
  if (!isObject(read.value) || !Array.isArray(read.value.items)) return { ok: false, lines: [`${id}: ${file} must be an object with a list "items"`] };
  return { ok: true, ctx, batch, items: read.value.items };
}

/** `review claims <out> <batch>`. Returns { status, lines }. */
export function reviewClaims(outDir, id) {
  const opened = openBatch(outDir, undefined, id);
  if (!opened.ok) return { status: 1, lines: opened.lines };
  const { ctx, items } = opened;
  const nameOf = (feature) => `${ctx.map.features.find((entry) => entry.id === feature)?.name ?? feature} (${feature})`;
  const lines = [`Batch ${id}: ${items.length} items`];
  items.forEach((item, at) => {
    lines.push('', `ITEM ${at}`, `dimension: ${item.dimension}`, `impact: ${item.impact}`, `features: ${(item.features ?? []).map(nameOf).join(', ')}`);
    lines.push(`title: ${item.title}`, `situation: ${item.situation}`, `consequence: ${item.consequence}`);
    for (const cite of item.cites ?? []) {
      lines.push(`cite: ${cite}`);
      let found = false;
      for (const feature of item.features ?? []) {
        const chapter = ctx.chapterOf(feature);
        for (const line of chapter.index.get(specKey(String(cite).trim())) ?? []) {
          found = true;
          lines.push(`  ${feature}, chapter line ${line + 1}: ${chapter.lines[line].trim()}`);
        }
      }
      if (!found) lines.push('  (no chapter line of the listed features holds this citation)');
    }
  });
  return { status: 0, lines };
}

/** The reasons the verdicts do not cover `count` items exactly once with a verdict and a reason each. */
function verdictProblems(value, count) {
  if (!isObject(value) || Object.keys(value).length !== 1 || !Array.isArray(value.verdicts)) return ['verdicts: the file must be an object with exactly the key "verdicts", a list'];
  const problems = [];
  const seen = new Map();
  value.verdicts.forEach((entry, at) => {
    const label = `verdicts[${at}]`;
    if (!isObject(entry) || Object.keys(entry).length !== 3 || !['index', 'verdict', 'reason'].every((key) => Object.hasOwn(entry, key))) {
      problems.push(`${label}: must be an object with exactly index, verdict and reason`);
      return;
    }
    if (!Number.isInteger(entry.index) || entry.index < 0 || entry.index >= count) problems.push(`${label}: index ${JSON.stringify(entry.index)} is not an item of the batch (0 to ${count - 1})`);
    else seen.set(entry.index, (seen.get(entry.index) ?? 0) + 1);
    if (!VERDICTS.includes(entry.verdict)) problems.push(`${label}: verdict ${JSON.stringify(entry.verdict)} is not supported or unsupported`);
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') problems.push(`${label}: reason must be a non-empty text`);
  });
  for (let index = 0; index < count; index += 1) {
    const times = seen.get(index) ?? 0;
    if (times === 0) problems.push(`item ${index} has no verdict`);
    else if (times > 1) problems.push(`item ${index} has ${times} verdicts`);
  }
  return problems;
}

/** `review prune <out> <batch> --project <root>`. Returns { status, lines }. */
export function pruneReview(outDir, root, id) {
  const hasOriginal = existsSync(join(outDir, unprunedFile(id)));
  const opened = openBatch(outDir, root, id, hasOriginal ? unprunedFile(id) : batchFile(id));
  if (!opened.ok) return { status: 1, lines: opened.lines };
  let read = readJson(join(outDir, verdictsFile(id)));
  // A batch with no item has nothing to judge: no verifier runs and no verdicts file is needed.
  if (read.missing && opened.items.length === 0) read = { ok: true, value: { verdicts: [] } };
  if (!read.ok) return { status: 1, lines: [`${id}: ${verdictsFile(id)} ${read.reason}`] };
  const problems = verdictProblems(read.value, opened.items.length);
  if (problems.length > 0) return { status: 1, lines: [...problems.map((line) => `${id}: ${line}`), 'Next: write the verdicts again, one for every item of the batch'] };
  const unsupported = new Map(read.value.verdicts.filter((entry) => entry.verdict === 'unsupported').map((entry) => [entry.index, entry.reason.trim()]));
  const kept = opened.items.filter((_, at) => !unsupported.has(at));
  if (hasOriginal) {
    const current = readJson(join(outDir, batchFile(id)));
    if (!current.ok || JSON.stringify(current.value.items) !== JSON.stringify(kept)) {
      return { status: 1, lines: [`${id}: ${batchFile(id)} changed after it was pruned; delete ${unprunedFile(id)} and ${verdictsFile(id)} and verify the batch again`] };
    }
  } else copyFileSync(join(outDir, batchFile(id)), join(outDir, unprunedFile(id)));
  writeJson(join(outDir, batchFile(id)), { items: kept });

  const recorded = readJson(join(outDir, REMOVED_FILE));
  const earlier = recorded.ok && Array.isArray(recorded.value?.removed) ? recorded.value.removed.filter((entry) => entry.batch !== id) : [];
  const removed = opened.items.flatMap((item, at) => (unsupported.has(at)
    ? [{ batch: id, title: item.title, dimension: item.dimension, features: item.features, reason: unsupported.get(at) }] : []));
  mkdirSync(join(outDir, 'entries'), { recursive: true });
  writeJson(join(outDir, REMOVED_FILE), { removed: [...earlier, ...removed] });

  const lines = [`${id}: kept ${kept.length}, removed ${removed.length}`];
  const missing = opened.ctx.facts.batches.filter((batch) => !existsSync(join(outDir, batchFile(batch.id)))).map((batch) => batch.id);
  if (missing.length > 0) return { status: 0, lines: [...lines, `chapters/review.md waits for the batches without a file: ${missing.join(', ')}`] };
  const rendered = renderReview(outDir, root, []);
  if (rendered.status !== 0) return { status: 0, lines: [...lines, 'chapters/review.md waits for the batches that do not pass yet:', ...rendered.lines.filter((line) => !line.startsWith('Next:'))] };
  return { status: 0, lines: [...lines, ...rendered.lines.filter((line) => line.startsWith('Chapter:'))] };
}
