/**
 * Where each comparison candidate of entries/review-compare.json stands (openspec change handbook-process-review, D3):
 * `item` (an item of a pruned batch lists it), `dismissed` (some batch file's dismissed lists it) or `unjudged`
 * (everything else, including a candidate only an item that verification removed listed, and candidates of batches
 * not pruned yet). Used by `review compare-status` and by the coverage section of the design-problems chapter.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { isObject, readJson } from './json-file.mjs';
import { COMPARE_FILE, COMPARE_SOURCES } from './review-compare.mjs';

// The batch file paths of review-render.mjs and review-verify.mjs, written out here to keep the modules acyclic.
const batchPath = (id) => `entries/review/${id}.json`;
const unprunedPath = (id) => `entries/review/${id}.unpruned.json`;
const CANDIDATE_ID = /^X[1-9][0-9]*$/;
const strings = (value) => (Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && CANDIDATE_ID.test(entry)) : []);

/**
 * `{ computed: false, reason }` when the file is missing or does not parse, else `{ computed: true, sources, unjudged }`:
 * `sources` has one entry per source in order, `{ source, computed: true, count, item, dismissed, unjudged }` or
 * `{ source, computed: false, reason }`; `unjudged` lists `{ id, source, features, batch }` of the candidates with no verdict.
 */
export function compareStatus(outDir, batchIds) {
  const read = readJson(join(outDir, COMPARE_FILE));
  const file = read.ok ? read.value : null;
  if (!isObject(file) || !Array.isArray(file.sources) || !Array.isArray(file.candidates)) {
    return { computed: false, reason: `${COMPARE_FILE} ${read.ok ? 'is not a comparison candidates file' : read.reason}` };
  }
  const itemIds = new Set();
  const dismissedIds = new Set();
  for (const id of batchIds) {
    const batch = readJson(join(outDir, batchPath(id)));
    if (!batch.ok || !isObject(batch.value)) continue;
    if (Array.isArray(batch.value.dismissed)) for (const entry of batch.value.dismissed) if (isObject(entry)) strings([entry.candidate]).forEach((x) => dismissedIds.add(x));
    if (!existsSync(join(outDir, unprunedPath(id))) || !Array.isArray(batch.value.items)) continue;
    for (const item of batch.value.items) if (isObject(item)) strings(item.candidates).forEach((x) => itemIds.add(x));
  }
  const bucketOf = (id) => (itemIds.has(id) ? 'item' : dismissedIds.has(id) ? 'dismissed' : 'unjudged');
  const unjudged = [];
  const sources = [];
  for (const source of COMPARE_SOURCES) {
    const entry = file.sources.find((candidate) => isObject(candidate) && candidate.source === source);
    if (entry === undefined || entry.computed !== true) {
      sources.push({ source, computed: false, reason: typeof entry?.reason === 'string' ? entry.reason : `${source} is not in ${COMPARE_FILE}` });
      continue;
    }
    const counts = { item: 0, dismissed: 0, unjudged: 0 };
    const mine = file.candidates.filter((candidate) => candidate.source === source);
    for (const candidate of mine) {
      const bucket = bucketOf(candidate.id);
      counts[bucket] += 1;
      if (bucket === 'unjudged') unjudged.push({ id: candidate.id, source, features: candidate.features ?? [], batch: candidate.batch ?? null });
    }
    if (counts.item + counts.dismissed + counts.unjudged !== mine.length) throw new Error(`compare status of ${source} does not add up to its candidates`);
    sources.push({ source, computed: true, count: mine.length, ...counts });
  }
  return { computed: true, sources, unjudged };
}

/** `review compare-status` lines. */
export function compareStatusLines(status) {
  if (!status.computed) return [`COMPARE not computed: ${status.reason}`];
  return [
    ...status.sources.map((entry) => (entry.computed
      ? `COMPARE ${entry.source} candidates ${entry.count} item ${entry.item} dismissed ${entry.dismissed} unjudged ${entry.unjudged}`
      : `COMPARE ${entry.source} not computed: ${entry.reason}`)),
    ...status.unjudged.map((entry) => `UNJUDGED ${entry.id} ${entry.source} ${entry.features.join(',') || '-'} ${entry.batch ?? '-'}`),
  ];
}

/** The lines of the coverage section of chapters/review.md, after the items; `t` reads `chapter.review.*`. */
export function compareSection(ctx, batchIds, { t, wide, nameOf }) {
  const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key]));
  const status = ctx.outDir === undefined ? { computed: false } : compareStatus(ctx.outDir, batchIds);
  const out = [`## ${t('compare.title')}`, ''];
  if (!status.computed) return [...out, t('compare.none'), ''];
  const label = (source) => t(`compare.source.${source}`);
  for (const entry of status.sources) {
    const values = { source: label(entry.source), count: entry.count, item: entry.item, dismissed: entry.dismissed, unjudged: entry.unjudged };
    out.push(`- ${fill(t(entry.computed ? 'compare.counts' : 'compare.notComputed'), values)}`);
  }
  out.push('');
  if (status.unjudged.length > 0) {
    out.push(t('compare.unjudged'), '');
    for (const entry of status.unjudged) {
      const features = entry.features.map(nameOf).join(wide ? String.fromCharCode(0x3001) : ', ');
      out.push(`- ${[entry.id, label(entry.source), features].filter((part) => part !== '').join(' ')}`);
    }
    out.push('');
  }
  return out;
}
