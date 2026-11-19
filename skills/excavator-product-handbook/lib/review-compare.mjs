/**
 * `review compare-facts <out> --project <root>` (openspec change handbook-process-review, D3): the comparison
 * candidates of the design-problems phase, computed from artifacts already in <out> (and, for application roots,
 * one scan of the project). Five sources in a fixed order; a source whose artifact is missing is recorded as not
 * computed with its reason and is never read as having no candidates. No model writes any of it.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { isUnder, scanProject } from './applications.mjs';
import { NO_APPLICATION } from './data-files.mjs';
import { sectionItems } from './defects-items.mjs';
import { isObject, readJson, writeJson } from './json-file.mjs';
import { rebindBatchFiles } from './review-candidate-rebind.mjs';
import { citedRanges, computeFacts } from './review-facts.mjs';
import { FACTS_FILE } from './review-batches.mjs';
import { loadUi } from './ui.mjs';

export const COMPARE_FILE = 'entries/review-compare.json';
export const COMPARE_FORMAT = 'excavator-product-handbook-review-compare/1';
export const COMPARE_SOURCES = Object.freeze(['dual', 'dict', 'table', 'topic', 'code']);
/** The comparison batch groups in their fixed order, the source each takes, and how many candidates one batch holds. */
export const COMPARE_GROUPS = Object.freeze([['c-data', ['dict', 'table']], ['c-topics', ['topic']], ['c-code', ['code']]]);
export const COMPARE_BATCH_SIZE = 25;
const COMPARE_BATCH_ID = /^(c-data|c-topics|c-code)-([1-9][0-9]*)$/;

const byteOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const FEATURE_REF = new RegExp(`[(${String.fromCharCode(0xff08)}]\\s*(F\\d+)\\s*[)${String.fromCharCode(0xff09)}]`, 'g');

/** `{ ok: true, value }` of an array-or-object artifact under <out>, or `{ ok: false, reason }`. */
function artifact(outDir, name) {
  const read = readJson(join(outDir, name));
  return read.ok ? read : { ok: false, reason: `${name} ${read.reason}` };
}

/** The text of each feature chapter and the index file -> [{ feature, a, b }] of its citations. */
function chapterIndex(outDir, map) {
  const texts = new Map();
  const files = new Map();
  for (const feature of map.features) {
    const path = join(outDir, 'chapters', `${feature.id}.md`);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf-8');
    texts.set(feature.id, text);
    for (const { file, a, b } of citedRanges(text)) {
      if (!files.has(file)) files.set(file, []);
      files.get(file).push({ feature: feature.id, a, b });
    }
  }
  return { texts, files };
}

/** `[{ file, line }]` as distinct `[{ file, a, b }]` with a = b = line. */
function linePlaces(places) {
  const seen = new Set();
  return places.filter(({ file, line }) => !seen.has(`${file}:${line}`) && seen.add(`${file}:${line}`)).map(({ file, line }) => ({ file, a: line, b: line }));
}

/** The features (in map order) with a citation that names a file and a range containing one of its `places` ({ file, line }). */
function citing(index, order, places) {
  const found = new Set();
  for (const { file, line } of places) {
    for (const cited of index.files.get(file) ?? []) if (cited.a <= line && line <= cited.b) found.add(cited.feature);
  }
  return order.filter((id) => found.has(id));
}

function dualSource({ outDir, map, project, batchOf }) {
  const candidates = artifact(outDir, 'candidates.json');
  if (!candidates.ok) return { reason: candidates.reason };
  const routes = new Map((candidates.value.items ?? []).filter((item) => item.kind === 'route').map((item) => [item.id, item]));
  const roots = [...project.roots].sort((a, b) => b.length - a.length);
  const dirOf = (file) => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.');
  const out = [];
  for (const feature of map.features) {
    const counts = new Map();
    const places = [];
    for (const id of feature.candidates ?? []) {
      const item = routes.get(id);
      const root = item === undefined ? undefined : roots.find((dir) => isUnder(dirOf(item.file), dir));
      if (root !== undefined) counts.set(root, (counts.get(root) ?? 0) + 1);
      if (root !== undefined && Number.isInteger(item.line) && !places.some((place) => place.file === item.file && place.a === item.line)) places.push({ file: item.file, a: item.line, b: item.line });
    }
    if (counts.size < 2) continue;
    const applications = [...counts].sort(([a], [b]) => byteOrder(a, b)).map(([application, routeCount]) => ({ application, routes: routeCount }));
    out.push({ features: [feature.id], batch: batchOf(feature.id), facts: { applications }, places });
  }
  return { candidates: out };
}

function dictSource({ outDir, order, index }) {
  const dictionaries = artifact(outDir, 'dictionaries.json');
  if (!dictionaries.ok) return { reason: dictionaries.reason };
  const out = [];
  for (const row of dictionaries.value.mismatches ?? []) {
    const side = (entry) => ({ application: entry.application, name: entry.name });
    const values = (list) => list.slice(0, 5).map((entry) => entry.value);
    const places = [row.left, row.right].flatMap((entry) => {
      const found = (dictionaries.value.dictionaries ?? []).find((dictionary) => dictionary.id === entry.id);
      if (found === undefined) return [];
      return [{ file: String(found.id).split(':')[0], line: found.line }, ...(found.members ?? []).map((member) => ({ file: member.file, line: member.line }))];
    });
    out.push({
      features: citing(index, order, places),
      batch: 'c-data',
      places: linePlaces(places),
      facts: { key: row.key, left: side(row.left), right: side(row.right), onlyLeft: { count: row.onlyLeft.length, values: values(row.onlyLeft) }, onlyRight: { count: row.onlyRight.length, values: values(row.onlyRight) } },
    });
  }
  return { candidates: out };
}

function tableSource({ outDir, order, index }) {
  const data = artifact(outDir, 'data.json');
  if (!data.ok) return { reason: data.reason };
  const out = [];
  for (const table of data.value.tables ?? []) {
    const mentions = Object.fromEntries(Object.entries(isObject(table.mentions) ? table.mentions : {}).filter(([application]) => application !== NO_APPLICATION));
    if (Object.keys(mentions).length < 2) continue;
    const places = Object.values(mentions).flatMap((list) => list.map((mention) => ({ file: mention.file, line: mention.line })));
    out.push({
      features: citing(index, order, places),
      batch: 'c-data',
      places: linePlaces(places),
      facts: { table: table.name, applications: Object.entries(mentions).map(([application, list]) => ({ application, mentions: list.length })) },
    });
  }
  return { candidates: out };
}

/** The citation keys of every problems section of the feature chapters. */
function problemCitations(index, title, none) {
  const keys = new Set();
  for (const text of index.texts.values()) {
    for (const item of sectionItems(text, title, none) ?? []) for (const { file, a, b } of citedRanges(item.text)) keys.add(`${file}:${a}-${b}`);
  }
  return keys;
}

function topicSource({ outDir, order, index }) {
  const path = join(outDir, 'chapters', 'topics.md');
  if (!existsSync(path)) return { reason: 'chapters/topics.md is missing' };
  const ui = loadUi(outDir);
  if (!ui.ok) return { reason: ui.lines[0] };
  const inProblems = problemCitations(index, ui.strings['chapter.problems'], ui.strings['md.none']);
  const out = [];
  let skipped = 0;
  let h2 = '';
  let h3 = '';
  let fenced = false;
  readFileSync(path, 'utf-8').split('\n').forEach((raw, at) => {
    if (/^\s*```/.test(raw)) fenced = !fenced;
    if (fenced) return;
    const heading = /^(#{2,3})\s+(.*?)\s*#*\s*$/.exec(raw);
    if (heading !== null) {
      if (heading[1].length === 2) {
        h2 = heading[2];
        h3 = '';
      } else h3 = heading[2];
      return;
    }
    const isRow = raw.startsWith('|') && !/^\|[\s:|-]+\|?\s*$/.test(raw);
    if (!isRow && !/^\s{0,3}[-*+]\s/.test(raw)) return;
    const ids = [...new Set(Array.from(raw.matchAll(FEATURE_REF), (found) => found[1]))].filter((id) => order.includes(id));
    if (ids.length < 2) return;
    const cited = citedRanges(raw);
    if (cited.length > 0 && cited.every(({ file, a, b }) => inProblems.has(`${file}:${a}-${b}`))) {
      skipped += 1;
      return;
    }
    out.push({ features: order.filter((id) => ids.includes(id)), batch: 'c-topics', places: cited, facts: { line: at + 1, h2, h3, text: raw.trim() } });
  });
  return { candidates: out, skipped };
}

function codeSource({ outDir }) {
  let facts;
  const read = artifact(outDir, FACTS_FILE);
  if (read.ok) facts = read.value;
  else {
    const computed = computeFacts(outDir);
    if (!computed.ok) return { reason: `review-facts.json could not be computed: ${computed.lines[0]}` };
    facts = computed.facts;
  }
  const out = (facts.pairs ?? []).filter((pair) => pair.scope === 'across').map((pair) => ({
    features: pair.features,
    batch: 'c-code',
    places: pair.files.flatMap((entry) => entry.ranges.map(([a, b]) => ({ file: entry.file, a, b }))),
    facts: { files: pair.files.map((entry) => entry.file), batches: pair.batches },
  }));
  return { candidates: out };
}

/** The domain batch that holds `id`, from the facts file or a fresh computation; null when none. */
function batchLookup(outDir) {
  const read = artifact(outDir, FACTS_FILE);
  const facts = read.ok ? read.value : (() => { const computed = computeFacts(outDir); return computed.ok ? computed.facts : null; })();
  const batches = facts?.batches ?? [];
  return (id) => batches.find((batch) => (batch.features ?? []).includes(id))?.id ?? null;
}

const summary = (candidate) => {
  const f = candidate.facts;
  const text = candidate.source === 'dual' ? f.applications.map((entry) => `${entry.application}=${entry.routes}`).join(' ')
    : candidate.source === 'dict' ? `${f.key} ${f.left.application}.${f.left.name} vs ${f.right.application}.${f.right.name} only-left=${f.onlyLeft.count} only-right=${f.onlyRight.count}`
      : candidate.source === 'table' ? `${f.table} ${f.applications.map((entry) => `${entry.application}=${entry.mentions}`).join(' ')}`
        : candidate.source === 'topic' ? `topics.md:${f.line} ${f.text}`
          : `${f.files.join(' ')}`;
  const line = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(line);
  return chars.length > 100 ? `${chars.slice(0, 97).join('')}...` : line;
};

/** `review compare-facts`: write the candidates file and return the printed lines. */
export function reviewCompare(outDir, projectRoot) {
  const map = artifact(outDir, 'map.json');
  if (!map.ok || !Array.isArray(map.value?.features)) return { status: 1, lines: ['map.json is missing or has no features; write and check the map first'] };
  const features = map.value.features;
  const order = features.map((feature) => feature.id);
  const index = chapterIndex(outDir, map.value);
  const context = { outDir, map: map.value, order, index, batchOf: batchLookup(outDir) };
  let project = null;
  const runners = { dual: dualSource, dict: dictSource, table: tableSource, topic: topicSource, code: codeSource };
  const sources = [];
  const candidates = [];
  const lines = [];
  for (const source of COMPARE_SOURCES) {
    if (source === 'dual') project = scanProject(projectRoot);
    const result = runners[source]({ ...context, project });
    if (result.reason !== undefined) {
      sources.push({ source, computed: false, reason: result.reason });
      lines.push(`SOURCE ${source} not computed: ${result.reason}`);
      continue;
    }
    const entry = { source, computed: true, count: result.candidates.length };
    if (result.skipped !== undefined) entry.skipped = result.skipped;
    sources.push(entry);
    lines.push(`SOURCE ${source} ${entry.count}`);
    if (result.skipped > 0) lines.push(`SKIPPED ${source} ${result.skipped} lines rest only on problems lines`);
    for (const found of result.candidates) candidates.push({ id: `X${candidates.length + 1}`, source, features: found.features, batch: found.batch, facts: found.facts, places: found.places });
  }
  assignCompareBatches(candidates);
  const previousRead = readJson(join(outDir, COMPARE_FILE));
  const before = batchContents(previousRead);
  const previous = previousRead.ok && isObject(previousRead.value) && Array.isArray(previousRead.value.candidates) ? previousRead.value.candidates : null;
  mkdirSync(join(outDir, 'entries'), { recursive: true });
  writeJson(join(outDir, COMPARE_FILE), { format: COMPARE_FORMAT, sources, candidates });
  // Candidate ids are positions and every run numbers them again, so a batch keeps its files only when it holds the same candidates.
  const after = batchContents({ ok: true, value: { candidates } });
  const stale = removeStaleBatchFiles(outDir, new Set([...after].filter(([id, content]) => before.get(id) === content).map(([id]) => id)));
  if (stale.length > 0) lines.push(`Removed stale comparison batch files: ${stale.join(', ')}`);
  // A domain batch file also holds the review of its features, so its candidate ids are rewritten instead.
  const rebound = rebindBatchFiles(outDir, previous, candidates);
  if (rebound.length > 0) lines.push(`Rewrote comparison candidate ids in batch files: ${rebound.map((entry) => `${entry.name} (${entry.renamed} renamed, ${entry.dropped} dropped)`).join(', ')}`);
  for (const candidate of candidates) lines.push(candidateLine(candidate));
  return { status: 0, lines };
}

/** Gives each dict, table, topic and code candidate its comparison batch: its group, cut in candidate order into chunks of COMPARE_BATCH_SIZE. */
function assignCompareBatches(candidates) {
  for (const [group, sources] of COMPARE_GROUPS) {
    candidates.filter((candidate) => sources.includes(candidate.source)).forEach((candidate, at) => {
      candidate.batch = `${group}-${Math.floor(at / COMPARE_BATCH_SIZE) + 1}`;
    });
  }
}

/** The comparison batches `[{ id, name, features: [], compare: true }]` of the candidates file, group order then chunk number; empty when it is missing or unreadable. */
export function compareBatches(outDir) {
  const read = readJson(join(outDir, COMPARE_FILE));
  if (!read.ok || !isObject(read.value) || !Array.isArray(read.value.candidates)) return [];
  const ids = new Set(read.value.candidates.filter((candidate) => isObject(candidate) && typeof candidate.batch === 'string' && COMPARE_BATCH_ID.test(candidate.batch)).map((candidate) => candidate.batch));
  const rank = (id) => { const [, group, number] = COMPARE_BATCH_ID.exec(id); return [COMPARE_GROUPS.findIndex(([name]) => name === group), Number(number)]; };
  return [...ids].sort((x, y) => rank(x)[0] - rank(y)[0] || rank(x)[1] - rank(y)[1]).map((id) => ({ id, name: id, features: [], compare: true }));
}

/**
 * Batch id -> the JSON text of its candidates, in order, from a read of the candidates file; an empty map when the read
 * failed or is not a candidates file, so that every batch file then counts as stale.
 */
function batchContents(read) {
  const contents = new Map();
  if (!read.ok || !isObject(read.value) || !Array.isArray(read.value.candidates)) return contents;
  const members = new Map();
  for (const candidate of read.value.candidates) {
    if (!isObject(candidate) || typeof candidate.batch !== 'string' || !COMPARE_BATCH_ID.test(candidate.batch)) continue;
    if (!members.has(candidate.batch)) members.set(candidate.batch, []);
    members.get(candidate.batch).push(candidate);
  }
  for (const [id, list] of members) contents.set(id, JSON.stringify(list));
  return contents;
}

/** Deletes entries/review/c-*.json files (batch, unpruned, verdicts) whose batch id is not in `keep`; returns their names. */
function removeStaleBatchFiles(outDir, keep) {
  const dir = join(outDir, 'entries', 'review');
  if (!existsSync(dir)) return [];
  const removed = [];
  for (const name of readdirSync(dir).sort()) {
    const found = /^(c-[^.]+)(?:\.unpruned|\.verdicts)?\.json$/.exec(name);
    if (found === null || keep.has(found[1])) continue;
    rmSync(join(dir, name), { force: true });
    removed.push(name);
  }
  return removed;
}

const candidateLine = (candidate) => `CANDIDATE ${candidate.id} ${candidate.source} ${candidate.features.join(',') || '-'} ${candidate.batch ?? '-'} ${summary(candidate)}`;

/** `review candidates <out> <batch>`: the CANDIDATE lines of one batch from the candidates file alone, `none` or `none: <reason>`. */
export function reviewCandidates(outDir, batch) {
  const read = readJson(join(outDir, COMPARE_FILE));
  if (!read.ok) return { status: 0, lines: [`none: ${COMPARE_FILE} ${read.reason}`] };
  if (!isObject(read.value) || !Array.isArray(read.value.candidates)) return { status: 0, lines: [`none: ${COMPARE_FILE} is not a comparison candidates file`] };
  const mine = read.value.candidates.filter((candidate) => isObject(candidate) && candidate.batch === batch && isObject(candidate.facts) && Array.isArray(candidate.features));
  return { status: 0, lines: mine.length === 0 ? ['none'] : mine.map(candidateLine) };
}

const FACTS_NONE = 'no feature chapter cites these places';

/** The lines of chapter `id` that hold a citation of `file` whose range meets [a, b], as `<id>.md:<line>: <text>`. */
function citingLines(outDir, id, places) {
  const path = join(outDir, 'chapters', `${id}.md`);
  if (!existsSync(path)) return [];
  const out = [];
  readFileSync(path, 'utf-8').replace(/\r\n?/g, '\n').split('\n').forEach((text, at) => {
    const hit = citedRanges(text).some((cite) => places.some((place) => place.file === cite.file && cite.a <= place.b && place.a <= cite.b));
    if (hit) out.push(`${id}.md:${at + 1}: ${text}`);
  });
  return out;
}

/** `review candidate-lines <out> <id>`: one candidate, its facts and, for each feature, the chapter lines citing its places. */
export function reviewCandidateLines(outDir, id) {
  const read = readJson(join(outDir, COMPARE_FILE));
  if (!read.ok) return { status: 1, lines: [`${COMPARE_FILE} ${read.reason}; run review compare-facts first`] };
  const candidates = isObject(read.value) && Array.isArray(read.value.candidates) ? read.value.candidates : [];
  const candidate = candidates.find((entry) => isObject(entry) && entry.id === id && isObject(entry.facts) && Array.isArray(entry.features));
  if (candidate === undefined) return { status: 1, lines: [`${id} is not a candidate of ${COMPARE_FILE}`] };
  const lines = [candidateLine(candidate), `FACTS ${JSON.stringify(candidate.facts)}`];
  if (candidate.source === 'topic') lines.push(`TOPIC topics.md:${candidate.facts.line} ${candidate.facts.text}`);
  if (!Array.isArray(candidate.places)) return { status: 0, lines: [...lines, 'no places recorded; run review compare-facts again'] };
  if (candidate.features.length === 0) return { status: 0, lines: [...lines, FACTS_NONE] };
  for (const feature of candidate.features) {
    lines.push(`FEATURE ${feature}`);
    const found = citingLines(outDir, feature, candidate.places);
    lines.push(...(found.length > 0 ? found : ['  no chapter line cites these places']));
  }
  return { status: 0, lines };
}
