/**
 * `review facts <out>` (openspec change handbook-design-review, D2): the whole-table facts the writers of the
 * design problems read, computed from the chapters, the map and the batches and nothing else. Writes
 * entries/review-facts.json (the batch list, the counts of every feature, the pairs of features that cite
 * overlapping lines of the same file) and prints them. Reads no project code.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { citationGroups, parseSpec, specKey } from './chapter-cites.mjs';
import { writeJson } from './json-file.mjs';
import { CROSS_BATCH, FACTS_FILE, FACTS_FORMAT, reviewBatches } from './review-batches.mjs';
import { chapterCounts } from './review-structure.mjs';
import { loadUi } from './ui.mjs';

/** The `{ file, a, b }` of every well-formed citation in `text`, each once. */
export function citedRanges(text) {
  const seen = new Set();
  const out = [];
  for (const group of citationGroups(text)) {
    for (const spec of group.specs) {
      const key = specKey(spec);
      if (seen.has(key)) continue;
      seen.add(key);
      const parsed = parseSpec(key);
      if (parsed.problem === undefined) out.push(parsed);
    }
  }
  return out;
}

/** Merge overlapping or touching ranges. */
function merge(ranges) {
  const sorted = [...ranges].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** The pairs of features (in `order`) whose chapters cite intersecting lines of one file: `[{ features: [x, y], file, ranges }]`. */
export function sharedCodePairs(rangesByFeature, order) {
  const byFile = new Map();
  for (const id of order) {
    for (const { file, a, b } of rangesByFeature.get(id) ?? []) {
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push({ id, a, b });
    }
  }
  const found = new Map();
  for (const [file, entries] of byFile) {
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const x = entries[i];
        const y = entries[j];
        if (x.id === y.id) continue;
        const a = Math.max(x.a, y.a);
        const b = Math.min(x.b, y.b);
        if (a > b) continue;
        const [first, second] = order.indexOf(x.id) < order.indexOf(y.id) ? [x.id, y.id] : [y.id, x.id];
        const key = `${first}\u0000${second}\u0000${file}`;
        if (!found.has(key)) found.set(key, { features: [first, second], file, ranges: [] });
        found.get(key).ranges.push([a, b]);
      }
    }
  }
  return [...found.values()].map((pair) => ({ ...pair, ranges: merge(pair.ranges) }))
    .sort((p, q) => order.indexOf(p.features[0]) - order.indexOf(q.features[0]) || order.indexOf(p.features[1]) - order.indexOf(q.features[1]) || (p.file < q.file ? -1 : 1));
}

/** The facts of every feature and the pairs, with the batches; `{ ok: false, lines }` when the run is not ready. */
export function computeFacts(outDir) {
  const batched = reviewBatches(outDir);
  if (!batched.ok) return batched;
  const ui = loadUi(outDir);
  if (!ui.ok) return { ok: false, lines: ui.lines };
  const order = batched.map.features.map((feature) => feature.id);
  const batchOf = new Map(batched.batches.flatMap((batch) => batch.features.map((id) => [id, batch.id])));
  const features = {};
  const ranges = new Map();
  for (const feature of batched.map.features) {
    const path = join(outDir, 'chapters', `${feature.id}.md`);
    if (!existsSync(path)) {
      features[feature.id] = { name: feature.name, batch: batchOf.get(feature.id) ?? null, chapter: false };
      continue;
    }
    const text = readFileSync(path, 'utf-8');
    features[feature.id] = { name: feature.name, batch: batchOf.get(feature.id) ?? null, chapter: true, ...chapterCounts(text, ui.strings) };
    ranges.set(feature.id, citedRanges(text));
  }
  const pairs = sharedCodePairs(ranges, order).map((pair) => ({
    ...pair,
    batches: pair.features.map((id) => batchOf.get(id) ?? null),
    scope: batchOf.get(pair.features[0]) === batchOf.get(pair.features[1]) ? 'within' : 'across',
  }));
  const facts = { format: FACTS_FORMAT, source: batched.source, batches: batched.batches, features, pairs };
  return { ok: true, facts, strings: ui.strings };
}

const rangeText = (ranges) => ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(',');

/** The printed lines of `facts`; with `onlyBatch`, the pairs are those that touch that batch (the table of features is always whole). */
export function factLines(facts, onlyBatch = null) {
  const lines = [`Batches: ${facts.batches.length - 1} (source: ${facts.source}), then ${CROSS_BATCH}`];
  for (const batch of facts.batches) lines.push(['BATCH', batch.id, batch.name, batch.features.join(',')].join('\t'));
  for (const [id, entry] of Object.entries(facts.features)) {
    if (!entry.chapter) {
      lines.push(['FEATURE', id, entry.name, `batch=${entry.batch}`, 'chapter=missing'].join('\t'));
      continue;
    }
    const cells = ['FEATURE', id, entry.name, `batch=${entry.batch}`, `operations=${entry.operations}`, `steps=${entry.steps.join(',') || '-'}`, `states=${entry.states}`, `transitions=${entry.transitions}`, `serverSteps=${entry.serverSteps}`, `handovers=${entry.handovers}`];
    if (entry.uncounted.length > 0) cells.push(`not counted: ${entry.uncounted.join(' | ')}`);
    lines.push(cells.join('\t'));
  }
  for (const pair of facts.pairs) {
    if (onlyBatch !== null && !pair.batches.includes(onlyBatch)) continue;
    lines.push(['PAIR', pair.scope, pair.features.join(','), pair.file, rangeText(pair.ranges)].join('\t'));
  }
  return lines;
}

/** `review facts <out> [<batch>]`: write the facts file and print the facts. Returns { status, lines }. */
export function reviewFacts(outDir, onlyBatch) {
  const computed = computeFacts(outDir);
  if (!computed.ok) return { status: 1, lines: computed.lines };
  if (onlyBatch !== undefined && !computed.facts.batches.some((batch) => batch.id === onlyBatch)) {
    return { status: 1, lines: [`${onlyBatch} is not a batch; the batches are ${computed.facts.batches.map((batch) => batch.id).join(', ')}`] };
  }
  mkdirSync(join(outDir, 'entries'), { recursive: true });
  writeJson(join(outDir, FACTS_FILE), computed.facts);
  return { status: 0, lines: [...factLines(computed.facts, onlyBatch ?? null), `Facts: ${join(outDir, FACTS_FILE)}`] };
}
