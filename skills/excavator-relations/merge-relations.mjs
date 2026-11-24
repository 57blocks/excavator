#!/usr/bin/env node
/**
 * merge-relations.mjs
 *
 * Checks, pairs and counts the relations the area analyzers wrote, and
 * writes `<dataDir>/relations-graph.json` and the coverage report
 * `<dataDir>/reports/relations-coverage.json`. The analyzers are models, so
 * nothing they write is taken on trust; this script never writes a relation
 * of its own, it only accepts, rejects and pairs by fixed rules.
 *
 * Area acceptance (as in the domain skill): an output must carry
 * `areaRun: {areaId, token}` of this run, else it is rejected-stale; not JSON
 * is rejected-parse; no file is missing. Nothing of a rejected area is merged;
 * exit code 3 when any area is not accepted.
 *
 * Ends. Every relation has a `caller` and a `receiver` end, either may be
 * null. Each end present is one end of the merge; a relation with neither is
 * one malformed end. An end is checked (checkEnd) and rejected into
 * `quote-failed` with one reason:
 *   malformed            missing or mistyped fields, unknown kind, a receiver
 *                        end on an external relation;
 *   outside-root         its file escapes the project root (never read);
 *   outside-area         its file is not one of its area's files;
 *   line-out-of-range;
 *   quote-mismatch       the quote, whitespace collapsed, is shorter than 4
 *                        characters or not inside the 3 lines from `line`;
 *   evidence-mismatch    an evidence quote fails the same test (or its file
 *                        escapes the root);
 *   address-not-quoted   a literal part of the address is in none of the 4
 *                        lines from the end's line and from each evidence
 *                        line: every literal path segment (as a whole token) and the method
 *                        (GET excepted: the default of most clients) for http,
 *                        the method and service for rpc, every literal piece of
 *                        a message channel or realtime event, the name or host
 *                        of an external endpoint (case-insensitive; the id rests
 *                        only on a quoted word, so a host no cited line holds
 *                        is a label and the id comes from the name,
 *                        `hostNotQuoted`). An http
 *                        end at the line of a route entry point of the
 *                        knowledge graph with the same normalized path is
 *                        checked against the entry point instead.
 * A node id the analyzer gave is kept when the knowledge graph has it on the
 * end's file (and its range holds the line); otherwise it is counted and
 * replaced by the narrowest graph node on that file whose range holds the line,
 * then the file node, then null (`nodeIdBy`).
 *
 * Pairing (relations-address.mjs) happens between sides only: a side is a
 * unit and a language family, so a browser bundle and its server in one unit
 * are two sides, while two files of one Node server are one. A caller whose
 * `targetUnit` names a known unit is paired with receivers of that unit;
 * when none of them matches its address, it is paired across every other
 * side, marked `targetUnitMissed` and counted (`target units ... missed=`).
 * A `targetUnit` that names no unit is counted and ignored.
 *
 * Buckets, one per end: a caller is linked, ambiguous, caller-only,
 * address-unresolved or quote-failed; a receiver is linked (some caller is
 * paired with it), receiver-only, address-unresolved or quote-failed. Ends
 * repeated within an area are kept once and counted. Conservation: ends given
 * = ends in buckets + duplicates; when it fails, exit 4 and no
 * relations-graph.json. Later kinds an analyzer noticed are counted by kind
 * (out-of-scope), never linked.
 * Candidate files: cited (an end or an evidence line of a checked end is in
 * it), declared-skip (its area listed it in skippedFiles, or, with no end in
 * it, some of its call lines in skippedLines, with a reason),
 * ends-rejected (an analyzer wrote ends in it and the check rejected every
 * one) or silent-zero (none of these). Units: has-candidates or no-candidates.
 * Call lines (the lines of candidate files where a call or a registration is
 * written, from the split's manifest): each gets one bucket (accountCallLines):
 * ended (a checked end is on it), evidence (a checked end cites it), ends-rejected
 * (only rejected ends are on it), declared-skip (its area listed it in
 * skippedLines with a reason), file-skipped (its file is declared-skip),
 * unaccounted (none of these) or area-missing (its area's output was not
 * accepted). A call line spans the lines from where its call starts to where
 * the match ends, so an end cited at the line of a call's path argument is on
 * it. The count of call lines must equal the sum of their buckets and the
 * count the split wrote into the manifest (`counts.callLines`).
 *
 * Measurements per kind: ends, quote-failed and its rate, the share of checked
 * ends that are address-unresolved, linked relations, and, when the previous
 * relations-graph.json was made from the same input digest, the Jaccard of
 * the two runs' linked keys (`kind|caller file|address key|receiver file or
 * external id`), with the keys the runs do not share split into one site
 * keyed two ways and sites one run alone linked (splitUnmatched). A kind below
 * THRESHOLDS is an escalation candidate: a sign that a deterministic extractor
 * may be needed. Nothing is built from it.
 *
 * External ids (relations-address.mjs externalIdentity) are counted by what
 * they rest on (`external keys host= service= name= transport=
 * host-not-quoted=`), and `externals` lists every id with those bases and the
 * names and hosts the analyzers wrote, kept as labels.
 *
 * Usage:
 *   node merge-relations.mjs <projectRoot> [--out <path>] [--coverage <path>]
 */

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KINDS, hostOf, normalizeAddress, pairCaller, parsePath, pathText } from './relations-address.mjs';
import { compare, isObject, languageFamilyOf, readGraphFacts } from './relations-signals.mjs';
import { UNITS_FILE } from './plan-units.mjs';
import { AREAS_DIR, OUT_OF_SCOPE_KINDS } from './split-relation-areas.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

export const GRAPH_FORMAT = 'excavator-relations/2';
export const COVERAGE_FORMAT = 'excavator-relations-coverage/1';
export const GRAPH_FILE = 'relations-graph.json';
export const EXIT_INCOMPLETE = 3;
export const EXIT_NOT_CONSERVED = 4;
export const CALLER_BUCKETS = Object.freeze(['linked', 'ambiguous', 'caller-only', 'address-unresolved', 'quote-failed']);
export const RECEIVER_BUCKETS = Object.freeze(['linked', 'receiver-only', 'address-unresolved', 'quote-failed']);
export const FILE_BUCKETS = Object.freeze(['cited', 'declared-skip', 'ends-rejected', 'silent-zero']);
export const CALL_LINE_BUCKETS = Object.freeze(['ended', 'evidence', 'ends-rejected', 'declared-skip', 'file-skipped', 'unaccounted', 'area-missing']);
export const REJECTIONS = Object.freeze(['malformed', 'outside-root', 'outside-area', 'line-out-of-range', 'quote-mismatch', 'evidence-mismatch', 'address-not-quoted']);
export const EXTERNAL_KEY_COUNTS = Object.freeze(['host', 'service', 'name', 'transport', 'hostNotQuoted']);
export const THRESHOLDS = Object.freeze({ agreement: 0.8, minAgreementUnion: 5, quoteFailureRate: 0.1, unresolvedShare: 0.3, minEnds: 10 });
const QUOTE_WINDOW = 3;
export const MAX_SILENT_LINES = 30;
const ADDRESS_WINDOW = 4;
const MIN_QUOTE = 4;
const AREA_ID = /^area-\d+$/;

const flat = (text) => text.replace(/\s+/g, ' ').trim();
const ratio = (a, b) => (b > 0 ? Math.round((a / b) * 10000) / 10000 : null);

/**
 * Whether `word` occurs in `text` as a whole token: not glued to a letter,
 * digit or underscore on either side, so a path segment `oauth` is not found
 * in an identifier `oauthGroup`.
 */
export function containsToken(text, word) {
  const isWord = (c) => c !== undefined && /[A-Za-z0-9_]/.test(c);
  for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + 1)) {
    const before = text[i - 1];
    const after = text[i + word.length];
    if ((!isWord(word[0]) || !isWord(before)) && (!isWord(word[word.length - 1]) || !isWord(after))) return true;
  }
  return false;
}

/** A project-relative POSIX path, or null when absolute or escaping the root. */
export function insideRoot(path) {
  if (typeof path !== 'string' || path.length === 0) return null;
  const slashed = path.replace(/\\/g, '/');
  if (isAbsolute(slashed) || /^[A-Za-z]:\//.test(slashed)) return null;
  const normal = posix.normalize(slashed);
  if (normal === '..' || normal.startsWith('../') || normal === '.') return null;
  return normal.replace(/^\.\//, '');
}

/** Accept or reject one area's output text. `text: null` means no file. */
export function acceptOutput({ token, areaId, text }) {
  if (text === null || text === undefined) return { status: 'missing' };
  let output;
  try {
    output = JSON.parse(text);
  } catch (error) {
    return { status: 'rejected-parse', reason: error.message };
  }
  if (!isObject(output)) return { status: 'rejected-parse', reason: 'not a JSON object' };
  const run = output.areaRun;
  if (!isObject(run)) return { status: 'rejected-stale', reason: 'no areaRun' };
  if (run.token !== token) return { status: 'rejected-stale', reason: 'areaRun.token is not this run\'s token' };
  if (run.areaId !== areaId) return { status: 'rejected-stale', reason: `areaRun.areaId is ${JSON.stringify(run.areaId)}` };
  return { status: 'accepted', output };
}

/** The ends of one accepted output, in order, plus its out-of-scope notes, skipped files and skipped lines. */
export function endsOf(areaId, output) {
  const ends = [];
  const relations = Array.isArray(output.relations) ? output.relations : [];
  const outOfScope = {};
  relations.forEach((relation, index) => {
    const base = { areaId, index };
    if (!isObject(relation)) { ends.push({ ...base, role: 'caller', kind: null, raw: null, malformed: 'relation is not an object' }); return; }
    const kind = relation.kind;
    if (OUT_OF_SCOPE_KINDS.includes(kind)) { outOfScope[kind] = (outOfScope[kind] ?? 0) + 1; return; }
    const common = {
      ...base, kind, address: relation.address, targetUnit: relation.targetUnit ?? null,
      reason: typeof relation.reason === 'string' ? relation.reason : null,
      confidence: typeof relation.confidence === 'string' ? relation.confidence : null,
    };
    const present = ['caller', 'receiver'].filter((role) => relation[role] !== null && relation[role] !== undefined);
    if (present.length === 0) { ends.push({ ...common, role: 'caller', raw: null, malformed: 'relation has no end' }); return; }
    for (const role of present) {
      const end = { ...common, role, raw: relation[role] };
      if (!KINDS.includes(kind)) end.malformed = `unknown kind ${JSON.stringify(kind)}`;
      else if (kind === 'external' && role === 'receiver') end.malformed = 'an external relation has no receiver end in the code';
      ends.push(end);
    }
  });
  for (const note of Array.isArray(output.outOfScope) ? output.outOfScope : []) {
    const kind = isObject(note) && OUT_OF_SCOPE_KINDS.includes(note.kind) ? note.kind : 'other';
    outOfScope[kind] = (outOfScope[kind] ?? 0) + 1;
  }
  const skipped = (Array.isArray(output.skippedFiles) ? output.skippedFiles : [])
    .filter((s) => isObject(s) && typeof s.file === 'string' && typeof s.reason === 'string' && s.reason.trim())
    .map((s) => ({ file: insideRoot(s.file), reason: s.reason.trim() }))
    .filter((s) => s.file !== null);
  const skippedLines = (Array.isArray(output.skippedLines) ? output.skippedLines : [])
    .filter((s) => isObject(s) && typeof s.file === 'string' && Number.isInteger(s.line) && typeof s.reason === 'string' && s.reason.trim())
    .map((s) => ({ file: insideRoot(s.file), line: s.line, reason: s.reason.trim() }))
    .filter((s) => s.file !== null);
  return { ends, outOfScope, skipped, skippedLines };
}

const addAt = (map, file, value) => {
  if (!map.has(file)) map.set(file, []);
  map.get(file).push(value);
};

/**
 * Give every call line one bucket (CALL_LINE_BUCKETS, in that order of
 * precedence). `callLines` [{ file, line, to, signal }]; `ended`, `evidence`,
 * `rejected` map a file to the lines of checked ends, of their evidence, and of
 * rejected ends; `skippedLines` maps a file to [{ line, reason }];
 * `skippedFiles` and `missingFiles` are sets of files. A line is on a call line
 * when it lies in [line, to]. Returns { total, buckets, rows, ok }.
 */
export function accountCallLines({ callLines, ended = new Map(), evidence = new Map(), rejected = new Map(), skippedLines = new Map(), skippedFiles = new Set(), missingFiles = new Set() }) {
  const buckets = Object.fromEntries(CALL_LINE_BUCKETS.map((b) => [b, 0]));
  const rows = [];
  for (const c of callLines) {
    const to = Number.isInteger(c.to) && c.to >= c.line ? c.to : c.line;
    const on = (n) => Number.isInteger(n) && n >= c.line && n <= to;
    const hit = (map) => (map.get(c.file) ?? []).some(on);
    const skip = (skippedLines.get(c.file) ?? []).find((s) => on(s.line));
    const status = missingFiles.has(c.file) ? 'area-missing'
      : hit(ended) ? 'ended'
        : hit(evidence) ? 'evidence'
          : hit(rejected) ? 'ends-rejected'
            : skip ? 'declared-skip'
              : skippedFiles.has(c.file) ? 'file-skipped' : 'unaccounted';
    buckets[status] += 1;
    rows.push({ file: c.file, line: c.line, ...(to > c.line ? { to } : {}), signal: c.signal ?? null, status, ...(status === 'declared-skip' ? { reason: skip.reason } : {}) });
  }
  const total = callLines.length;
  return { total, buckets, rows, ok: Object.values(buckets).reduce((a, b) => a + b, 0) === total };
}

function windowText(lines, line, size) {
  return flat(lines.slice(line - 1, line - 1 + size).join(' '));
}

function quoteHolds(lines, line, quote) {
  if (!Array.isArray(lines) || !Number.isInteger(line) || line < 1 || line > lines.length) return 'line-out-of-range';
  if (typeof quote !== 'string') return 'quote-mismatch';
  const q = flat(quote);
  if (q.length < MIN_QUOTE || !windowText(lines, line, QUOTE_WINDOW).includes(q)) return 'quote-mismatch';
  return null;
}

/** Derive the knowledge-graph node of a file and line; checks a given id first. */
export function anchorNode({ facts, nodesByFile, file, line, given }) {
  if (!facts) return { nodeId: null, nodeIdBy: 'none', rejected: false };
  let rejected = false;
  if (typeof given === 'string' && given.length > 0) {
    const node = facts.nodes.get(given);
    const holds = node && node.filePath === file && (!node.lineRange || (line >= node.lineRange[0] && line <= node.lineRange[1]));
    if (holds) return { nodeId: given, nodeIdBy: 'analyzer', rejected: false };
    rejected = true;
  }
  let best = null;
  for (const node of nodesByFile.get(file) ?? []) {
    if (!node.lineRange || node.type === 'file') continue;
    const [a, b] = node.lineRange;
    if (line < a || line > b) continue;
    if (best === null || b - a < best.lineRange[1] - best.lineRange[0]) best = node;
  }
  if (best) return { nodeId: best.id, nodeIdBy: 'derived-range', rejected };
  const fileNode = facts.nodes.get(`file:${file}`);
  if (fileNode) return { nodeId: fileNode.id, nodeIdBy: 'derived-file', rejected };
  return { nodeId: null, nodeIdBy: 'none', rejected };
}

/**
 * Check one end. `readLines(file)` returns a project file's lines or null;
 * `areaFiles` is the set of its area's files; `entryPoints` maps file -> http
 * entry points. Returns { ok: false, rejection, detail } or
 * { ok: true, end, normalized } where normalized is the address
 * normalization (ok or unresolved).
 */
export function checkEnd({ end, readLines, areaFiles, entryPoints = new Map() }) {
  const reject = (rejection, detail) => ({ ok: false, rejection, detail });
  if (end.malformed) return reject('malformed', end.malformed);
  const raw = end.raw;
  if (!isObject(raw) || typeof raw.file !== 'string' || !Number.isInteger(raw.line) || typeof raw.quote !== 'string') {
    return reject('malformed', 'an end needs file, an integer line and a quote');
  }
  if (raw.evidence !== undefined && !Array.isArray(raw.evidence)) return reject('malformed', 'evidence must be an array');
  const file = insideRoot(raw.file);
  if (file === null) return reject('outside-root', raw.file);
  if (!areaFiles.has(file)) return reject('outside-area', file);
  const lines = readLines(file);
  if (lines === null) return reject('line-out-of-range', `${file} cannot be read`);
  const bad = quoteHolds(lines, raw.line, raw.quote);
  if (bad) return reject(bad, `${file}:${raw.line}`);
  const evidence = [];
  for (const item of raw.evidence ?? []) {
    if (!isObject(item) || typeof item.file !== 'string' || !Number.isInteger(item.line) || typeof item.quote !== 'string') {
      return reject('malformed', 'an evidence item needs file, an integer line and a quote');
    }
    const evFile = insideRoot(item.file);
    if (evFile === null) return reject('evidence-mismatch', `evidence outside the root: ${item.file}`);
    const evLines = readLines(evFile);
    if (evLines === null || quoteHolds(evLines, item.line, item.quote)) return reject('evidence-mismatch', `${evFile}:${item.line}`);
    evidence.push({ file: evFile, line: item.line, quote: flat(item.quote), lines: evLines });
  }
  const normalized = normalizeAddress(end.kind, end.address);
  const checked = {
    file, line: raw.line, quote: flat(raw.quote),
    evidence: evidence.map(({ lines: _l, ...rest }) => rest),
    givenNodeId: typeof raw.nodeId === 'string' ? raw.nodeId : null,
  };
  if (!normalized.ok) return { ok: true, end: checked, normalized };

  // The address must be read from the cited lines, not written from memory.
  let addressBy = 'quote';
  if (end.kind === 'http') {
    const entry = (entryPoints.get(file) ?? []).find((e) => e.line === raw.line && typeof e.path === 'string');
    if (entry) {
      const parsed = parsePath(entry.path);
      if (parsed && pathText(parsed.segments) === normalized.address.path) addressBy = 'entry-point';
    }
  }
  if (addressBy !== 'entry-point') {
    const text = [windowText(lines, raw.line, ADDRESS_WINDOW), ...evidence.map((e) => windowText(e.lines, e.line, ADDRESS_WINDOW))].join('\n');
    const lower = text.toLowerCase();
    const found = end.kind === 'http' ? (part) => containsToken(text, part) : (part) => text.includes(part);
    const missing = normalized.literals.filter((part) => !found(part));
    for (const word of [normalized.methodWord, normalized.serviceWord, ...(normalized.externalWords ?? [])]) {
      if (word && !lower.includes(String(word).toLowerCase())) {
        if (end.kind !== 'external') missing.push(word);
      }
    }
    if (end.kind === 'external' && !(normalized.externalWords ?? []).some((w) => lower.includes(w.toLowerCase()))) missing.push(normalized.externalWords.join('|'));
    if (missing.length > 0) return reject('address-not-quoted', missing.join(', '));
    // The id rests only on a quoted word: a host no cited line holds is a label, never the id.
    const host = end.kind === 'external' && normalized.keyBy === 'host' ? hostOf(normalized.address.host) : null;
    if (host !== null && !lower.includes(host)) {
      // The name as the analyzer wrote it: its case tells a method call from a domain.
      const byName = normalizeAddress('external', { name: end.address?.name });
      return { ok: true, end: { ...checked, addressBy, hostNotQuoted: true }, normalized: { ...byName, address: normalized.address } };
    }
  }
  return { ok: true, end: { ...checked, addressBy }, normalized };
}

/** Linked keys of one kind, each with its caller file, caller lines and the calls (line and quote). */
function linkedSites(list, kind) {
  const sites = new Map();
  for (const r of list ?? []) {
    if (r?.kind !== kind || r.bucket !== 'linked' || typeof r.key !== 'string') continue;
    const site = sites.get(r.key) ?? { file: r.caller?.file ?? null, lines: [], calls: [] };
    if (Number.isInteger(r.caller?.line)) {
      if (!site.lines.includes(r.caller.line)) site.lines.push(r.caller.line);
      site.calls.push({ line: r.caller.line, quote: typeof r.caller.quote === 'string' ? flat(r.caller.quote) : '' });
    }
    sites.set(r.key, site);
  }
  for (const site of sites.values()) site.lines.sort((a, b) => a - b);
  return sites;
}

const nearLines = (a, b) => a.some((x) => b.some((y) => Math.abs(x - y) <= QUOTE_WINDOW));
/**
 * One call in both runs: the same line, or lines within QUOTE_WINDOW whose
 * quotes overlap (one holds the other). Two different calls close together
 * quote different text and stay two sites.
 */
const sameCall = (a, b) => a.line === b.line
  || (Math.abs(a.line - b.line) <= QUOTE_WINDOW && a.quote.length > 0 && b.quote.length > 0 && (a.quote.includes(b.quote) || b.quote.includes(a.quote)));
const sameSite = (a, b) => a.file === b.file && a.calls.some((x) => b.calls.some((y) => sameCall(x, y)));
const siteView = ({ calls: _c, ...rest }) => rest;

/**
 * Split the linked keys two runs do not share. A key of one run and a key of
 * the other with one call in common (same caller file, and the same line or
 * near lines with overlapping quotes: sameCall) are one site keyed two ways
 * (`keyMismatch`). Every other key was linked in
 * one run only; it carries the buckets the other run gave ends of that kind
 * near its lines (`absent` when there were none), so a reader can tell a site
 * the other run never wrote from one it wrote and did not link.
 */
export function splitUnmatched({ kind, previous, current }) {
  const before = linkedSites(previous, kind);
  const now = linkedSites(current, kind);
  const previousOnly = [...before.keys()].filter((k) => !now.has(k)).sort(compare);
  const currentOnly = [...now.keys()].filter((k) => !before.has(k)).sort(compare);
  const keyMismatch = [];
  const used = new Set();
  const paired = new Set();
  for (const p of previousOnly) {
    const ps = before.get(p);
    const c = currentOnly.find((k) => !used.has(k) && sameSite(ps, now.get(k)));
    if (c === undefined) continue;
    used.add(c);
    paired.add(p);
    keyMismatch.push({ file: ps.file, previous: p, current: c, previousLines: ps.lines, currentLines: now.get(c).lines });
  }
  const otherBuckets = (list, site) => {
    const found = new Set((list ?? []).filter((r) => r?.kind === kind && r.caller?.file === site.file
      && Number.isInteger(r.caller?.line) && nearLines([r.caller.line], site.lines)).map((r) => r.bucket));
    return found.size > 0 ? [...found].sort(compare) : ['absent'];
  };
  return {
    keyMismatch,
    previousOnly: previousOnly.filter((k) => !paired.has(k)).map((k) => ({ key: k, ...siteView(before.get(k)), current: otherBuckets(current, before.get(k)) })),
    currentOnly: currentOnly.filter((k) => !used.has(k)).map((k) => ({ key: k, ...siteView(now.get(k)), previous: otherBuckets(previous, now.get(k)) })),
  };
}

/**
 * The whole merge over accepted outputs. Pure apart from `readLines`.
 * Returns { relations, buckets, endsIn, duplicates, outOfScope, files, units,
 * measurements, counts, conservation }.
 */
export function mergeRelations({ accepted, manifest, units, facts = null, readLines, previous = null }) {
  const areaFiles = new Map((manifest.areas ?? []).map((a) => [a.areaId, new Set(a.files)]));
  const unitOfArea = new Map((manifest.areas ?? []).map((a) => [a.areaId, a.unit]));
  const unitIds = new Set(units.map((u) => u.id));
  const entryPoints = new Map();
  for (const entry of facts?.entryPoints ?? []) {
    if (entry?.routeKind !== 'http' || typeof entry.file !== 'string') continue;
    if (!entryPoints.has(entry.file)) entryPoints.set(entry.file, []);
    entryPoints.get(entry.file).push(entry);
  }
  const nodesByFile = new Map();
  for (const node of facts?.nodes?.values() ?? []) {
    if (!node.filePath) continue;
    if (!nodesByFile.has(node.filePath)) nodesByFile.set(node.filePath, []);
    nodesByFile.get(node.filePath).push(node);
  }

  const counts = {
    nodeIdGiven: 0, nodeIdRejected: 0, nodeIdBy: { analyzer: 0, 'derived-range': 0, 'derived-file': 0, none: 0 }, targetUnitUnknown: 0, targetUnitMissed: 0, addressByEntryPoint: 0,
    externalKeys: Object.fromEntries(EXTERNAL_KEY_COUNTS.map((k) => [k, 0])),
  };
  const rejections = Object.fromEntries(REJECTIONS.map((r) => [r, 0]));
  const outOfScope = {};
  const declared = new Map();
  const skippedLines = new Map();
  const all = [];
  let endsIn = 0;
  for (const { areaId, output } of [...accepted].sort((a, b) => compare(a.areaId, b.areaId))) {
    const { ends, outOfScope: oos, skipped, skippedLines: lineSkips } = endsOf(areaId, output);
    endsIn += ends.length;
    for (const [k, n] of Object.entries(oos)) outOfScope[k] = (outOfScope[k] ?? 0) + n;
    for (const s of skipped) if ((areaFiles.get(areaId) ?? new Set()).has(s.file) && !declared.has(s.file)) declared.set(s.file, s.reason);
    for (const s of lineSkips) if ((areaFiles.get(areaId) ?? new Set()).has(s.file)) addAt(skippedLines, s.file, { line: s.line, reason: s.reason });
    for (const end of ends) {
      const result = checkEnd({ end, readLines, areaFiles: areaFiles.get(areaId) ?? new Set(), entryPoints });
      all.push({ end, result, unit: unitOfArea.get(areaId) ?? null });
    }
  }

  // Dedupe and anchor.
  const seen = new Set();
  let duplicates = 0;
  const kept = [];
  for (const item of all) {
    if (item.result.ok) {
      const { end, result } = item;
      const key = `${end.areaId}|${end.role}|${end.kind}|${result.end.file}|${result.end.line}|${result.normalized.ok ? result.normalized.key : `?${result.normalized.reason}`}`;
      if (seen.has(key)) { duplicates += 1; continue; }
      seen.add(key);
      const anchor = anchorNode({ facts, nodesByFile, file: result.end.file, line: result.end.line, given: result.end.givenNodeId });
      if (result.end.givenNodeId) counts.nodeIdGiven += 1;
      if (anchor.rejected) counts.nodeIdRejected += 1;
      counts.nodeIdBy[anchor.nodeIdBy] += 1;
      if (result.end.addressBy === 'entry-point') counts.addressByEntryPoint += 1;
      if (end.kind === 'external') {
        if (result.end.hostNotQuoted) counts.externalKeys.hostNotQuoted += 1;
        if (result.normalized.ok) counts.externalKeys[result.normalized.keyBy] += 1;
        else if (result.normalized.transport) counts.externalKeys.transport += 1;
      }
      item.view = {
        unit: item.unit, family: languageFamilyOf(result.end.file), file: result.end.file, line: result.end.line, quote: result.end.quote,
        nodeId: anchor.nodeId, nodeIdBy: anchor.nodeIdBy, evidence: result.end.evidence,
      };
    }
    kept.push(item);
  }

  const relations = [];
  const bucketOf = new Map();
  const sideOf = (v) => `${v.unit}|${v.family}`;
  const rawView = (end) => (isObject(end.raw) ? { file: end.raw.file ?? null, line: end.raw.line ?? null, quote: end.raw.quote ?? null } : null);
  const base = (item) => ({
    kind: item.end.kind, area: item.end.areaId, reason: item.end.reason, confidence: item.end.confidence,
  });

  const callers = [];
  const receivers = [];
  for (const item of kept) {
    if (!item.result.ok) {
      rejections[item.result.rejection] += 1;
      bucketOf.set(item, 'quote-failed');
      relations.push({
        ...base(item), bucket: 'quote-failed', role: item.end.role, rejection: { reason: item.result.rejection, detail: item.result.detail },
        address: isObject(item.end.address) ? item.end.address : null,
        [item.end.role]: rawView(item.end),
      });
      continue;
    }
    if (!item.result.normalized.ok) {
      bucketOf.set(item, 'address-unresolved');
      relations.push({
        ...base(item), bucket: 'address-unresolved', role: item.end.role, unresolved: item.result.normalized.reason,
        address: isObject(item.end.address) ? item.end.address : null, [item.end.role]: item.view,
      });
      continue;
    }
    (item.end.role === 'caller' ? callers : receivers).push(item);
  }

  const linkedReceivers = new Set();
  for (const item of callers) {
    const n = item.result.normalized;
    let target = null;
    if (item.end.targetUnit !== null && item.end.targetUnit !== undefined) {
      if (unitIds.has(item.end.targetUnit)) target = item.end.targetUnit;
      else counts.targetUnitUnknown += 1;
    }
    const others = receivers.filter((r) => r.end.kind === item.end.kind && sideOf(r.view) !== sideOf(item.view));
    const poolOf = (list) => list.map((r) => ({ ...r.result.normalized, item: r }));
    let paired = pairCaller(item.end.kind, n, poolOf(target === null ? others : others.filter((r) => r.view.unit === target)));
    let missed = false;
    if (target !== null && paired.bucket === 'caller-only') {
      // The target is the analyzer's reading; the address is the checked part.
      // Nothing there matches it, so pair across every other side and say so.
      const anywhere = pairCaller(item.end.kind, n, poolOf(others));
      if (anywhere.bucket !== 'caller-only') {
        paired = anywhere;
        missed = true;
        counts.targetUnitMissed += 1;
      }
    }
    bucketOf.set(item, paired.bucket);
    const common = { ...base(item), address: n.address, addressKey: n.key, ...(target ? { targetUnit: target } : {}), ...(missed ? { targetUnitMissed: true } : {}) };
    if (paired.bucket === 'linked' && item.end.kind === 'external') {
      relations.push({
        ...common, keyBy: n.keyBy, ...(item.result.end.hostNotQuoted ? { hostNotQuoted: true } : {}),
        bucket: 'linked', key: `external|${item.view.file}|${n.key}|${n.key}`, caller: item.view, receiver: { external: n.key },
      });
    } else if (paired.bucket === 'linked') {
      for (const r of paired.receivers) {
        linkedReceivers.add(r.item);
        relations.push({
          ...common, bucket: 'linked', key: `${item.end.kind}|${item.view.file}|${n.key}|${r.item.view.file}`,
          caller: item.view, receiver: { ...r.item.view, addressKey: r.key },
        });
      }
    } else if (paired.bucket === 'ambiguous') {
      relations.push({ ...common, bucket: 'ambiguous', caller: item.view, receiver: null, candidates: paired.receivers.map((r) => ({ unit: r.item.view.unit, file: r.item.view.file, line: r.item.view.line, addressKey: r.key })) });
    } else {
      relations.push({ ...common, bucket: 'caller-only', caller: item.view, receiver: null });
    }
  }
  for (const item of receivers) {
    const bucket = linkedReceivers.has(item) ? 'linked' : 'receiver-only';
    bucketOf.set(item, bucket);
    if (bucket === 'receiver-only') {
      const n = item.result.normalized;
      relations.push({ ...base(item), bucket, address: n.address, addressKey: n.key, caller: null, receiver: item.view });
    }
  }

  relations.sort((a, b) => compare(a.kind ?? '', b.kind ?? '') || compare(a.bucket, b.bucket)
    || compare(a.caller?.file ?? '', b.caller?.file ?? '') || (a.caller?.line ?? 0) - (b.caller?.line ?? 0)
    || compare(a.receiver?.file ?? '', b.receiver?.file ?? '') || (a.receiver?.line ?? 0) - (b.receiver?.line ?? 0));
  relations.forEach((r, i) => { r.id = `rel:${i + 1}`; });

  // Buckets per end.
  const buckets = {
    caller: Object.fromEntries(CALLER_BUCKETS.map((b) => [b, 0])),
    receiver: Object.fromEntries(RECEIVER_BUCKETS.map((b) => [b, 0])),
  };
  for (const item of kept) {
    const role = item.end.role === 'receiver' ? 'receiver' : 'caller';
    const bucket = bucketOf.get(item);
    if (bucket !== undefined && bucket in buckets[role]) buckets[role][bucket] += 1;
  }
  const inBuckets = Object.values(buckets.caller).reduce((a, b) => a + b, 0) + Object.values(buckets.receiver).reduce((a, b) => a + b, 0);
  const conservation = { endsIn, inBuckets, duplicates, ok: endsIn === inBuckets + duplicates };

  // Candidate files and units.
  const cited = new Set();
  const rejectedIn = new Set();
  for (const item of kept) {
    if (!item.view) {
      const file = isObject(item.end.raw) && typeof item.end.raw.file === 'string' ? insideRoot(item.end.raw.file) : null;
      if (file !== null) rejectedIn.add(file);
      continue;
    }
    cited.add(item.view.file);
    for (const e of item.view.evidence) cited.add(e.file);
  }
  // Call lines: every one accounted for by an end, an evidence line or a skip, or counted.
  const endedAt = new Map();
  const evidenceAt = new Map();
  const rejectedAt = new Map();
  for (const item of kept) {
    if (item.view) {
      addAt(endedAt, item.view.file, item.view.line);
      for (const e of item.view.evidence) addAt(evidenceAt, e.file, e.line);
    } else if (isObject(item.end.raw)) {
      const file = insideRoot(item.end.raw.file);
      if (file !== null) addAt(rejectedAt, file, item.end.raw.line);
    }
  }
  const acceptedAreas = new Set(accepted.map((a) => a.areaId));
  const missingFiles = new Set((manifest.areas ?? []).filter((a) => !acceptedAreas.has(a.areaId)).flatMap((a) => a.files ?? []));
  const callLines = accountCallLines({
    callLines: (manifest.candidates ?? []).flatMap((c) => (Array.isArray(c.callLines) ? c.callLines : []).map(([line, to, signal]) => ({ file: c.file, line, to, signal }))),
    ended: endedAt, evidence: evidenceAt, rejected: rejectedAt, skippedLines, skippedFiles: new Set(declared.keys()), missingFiles,
  });
  conservation.callLines = callLines.total;
  conservation.callLinesInBuckets = Object.values(callLines.buckets).reduce((a, b) => a + b, 0);
  // The split counted the call lines it wrote into the manifest; the merge must read as many. A missing count fails too.
  const expected = manifest.counts?.callLines;
  conservation.callLinesExpected = Number.isInteger(expected) ? expected : 'missing';
  conservation.ok = conservation.ok && callLines.ok && expected === callLines.total;

  // A file with no end, whose analyzer skipped some of its call lines one by one, was read and declared, not silent.
  const lineSkipOf = new Map();
  for (const r of callLines.rows) if (r.status === 'declared-skip' && !lineSkipOf.has(r.file)) lineSkipOf.set(r.file, r);
  const fileRows = [];
  const fileBuckets = Object.fromEntries(FILE_BUCKETS.map((b) => [b, 0]));
  for (const candidate of manifest.candidates ?? []) {
    const lineSkip = lineSkipOf.get(candidate.file);
    const status = cited.has(candidate.file) ? 'cited'
      : declared.has(candidate.file) ? 'declared-skip'
        : rejectedIn.has(candidate.file) ? 'ends-rejected'
          : lineSkip ? 'declared-skip' : 'silent-zero';
    fileBuckets[status] += 1;
    const reason = declared.get(candidate.file) ?? (lineSkip ? `call lines skipped: ${lineSkip.reason}` : null);
    fileRows.push({ file: candidate.file, unit: candidate.unit, status, ...(status === 'declared-skip' ? { reason } : {}) });
  }
  const unitRows = units.map((u) => {
    const n = (manifest.candidates ?? []).filter((c) => c.unit === u.id).length;
    return { id: u.id, name: u.name, kind: u.kind, candidateFiles: n, status: n > 0 ? 'has-candidates' : 'no-candidates' };
  });
  const configCited = (manifest.configFiles ?? []).filter((f) => cited.has(f)).length;

  // Measurements per kind.
  const measurements = {};
  const linkedKeys = (list) => {
    const byKind = new Map();
    for (const r of list ?? []) {
      if (r?.bucket !== 'linked' || typeof r.key !== 'string') continue;
      if (!byKind.has(r.kind)) byKind.set(r.kind, new Set());
      byKind.get(r.kind).add(r.key);
    }
    return byKind;
  };
  const now = linkedKeys(relations);
  const sameInput = isObject(previous) && previous.inputDigest === manifest.inputDigest;
  const before = sameInput ? linkedKeys(previous.relations) : null;
  for (const kind of KINDS) {
    const mine = kept.filter((i) => i.end.kind === kind);
    const ends = mine.length;
    const failed = mine.filter((i) => bucketOf.get(i) === 'quote-failed').length;
    const verified = ends - failed;
    const unresolved = mine.filter((i) => bucketOf.get(i) === 'address-unresolved').length;
    const linked = relations.filter((r) => r.kind === kind && r.bucket === 'linked').length;
    let agreement;
    if (!isObject(previous)) agreement = { status: 'no-previous-run', jaccard: null };
    else if (!sameInput) agreement = { status: 'input-changed', jaccard: null };
    else {
      const a = before.get(kind) ?? new Set();
      const b = now.get(kind) ?? new Set();
      const intersection = [...a].filter((k) => b.has(k)).length;
      const union = new Set([...a, ...b]).size;
      const unmatched = splitUnmatched({ kind, previous: previous.relations, current: relations });
      agreement = {
        status: union >= THRESHOLDS.minAgreementUnion ? 'measured' : 'insufficient',
        jaccard: union > 0 ? ratio(intersection, union) : null, previous: a.size, current: b.size, intersection, union,
        keyMismatch: unmatched.keyMismatch.length, previousOnly: unmatched.previousOnly.length, currentOnly: unmatched.currentOnly.length, unmatched,
      };
    }
    const quoteFailureRate = ratio(failed, ends);
    const unresolvedShare = ratio(unresolved, verified);
    const reasons = [];
    if (agreement.status === 'measured' && agreement.jaccard < THRESHOLDS.agreement) reasons.push('agreement');
    if (ends >= THRESHOLDS.minEnds && quoteFailureRate > THRESHOLDS.quoteFailureRate) reasons.push('quote-failure');
    if (verified >= THRESHOLDS.minEnds && unresolvedShare > THRESHOLDS.unresolvedShare) reasons.push('unresolved');
    measurements[kind] = {
      ends, quoteFailed: failed, quoteFailureRate, verified, unresolved, unresolvedShare, linked, agreement,
      escalation: { candidate: reasons.length > 0, reasons },
    };
  }

  // External systems: the id, what it rests on, and the analyzers' words as labels.
  const externalRows = new Map();
  for (const r of relations) {
    if (r.kind !== 'external' || r.bucket !== 'linked') continue;
    const row = externalRows.get(r.receiver.external) ?? { id: r.receiver.external, keyBy: new Set(), names: new Set(), hosts: new Set(), callers: 0 };
    row.keyBy.add(r.keyBy);
    if (r.address.name) row.names.add(r.address.name);
    if (r.address.host) row.hosts.add(r.address.host);
    row.callers += 1;
    externalRows.set(row.id, row);
  }
  const sorted = (set) => [...set].sort(compare);
  const externals = [...externalRows.values()].sort((a, b) => compare(a.id, b.id))
    .map((row) => ({ id: row.id, keyBy: sorted(row.keyBy), names: sorted(row.names), hosts: sorted(row.hosts), callers: row.callers }));

  return {
    relations, buckets, conservation, outOfScope, rejections, counts, measurements, externals, callLines,
    files: { buckets: fileBuckets, rows: fileRows, configFiles: (manifest.configFiles ?? []).length, configCited },
    units: unitRows,
  };
}

async function resolveCore() {
  try {
    return await import(pathToFileURL(require.resolve('@excavator/core')).href);
  } catch {
    return import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function readOrNull(path) {
  return existsSync(path) ? readFileSync(path, 'utf-8') : null;
}

function readJsonOrNull(path) {
  const text = readOrNull(path);
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** The fixed stdout lines of a merge (the skill's report reads them). */
export function reportLines({ areaResults, merged, coveragePath, graphPath }) {
  const lines = [];
  for (const a of areaResults) lines.push(`${a.areaId} ${a.status}${a.reason ? ` (${a.reason})` : ''}`);
  const c = merged.buckets.caller;
  const r = merged.buckets.receiver;
  lines.push(`callers linked=${c.linked} ambiguous=${c.ambiguous} caller-only=${c['caller-only']} address-unresolved=${c['address-unresolved']} quote-failed=${c['quote-failed']}`);
  lines.push(`receivers linked=${r.linked} receiver-only=${r['receiver-only']} address-unresolved=${r['address-unresolved']} quote-failed=${r['quote-failed']}`);
  lines.push(`rejections ${REJECTIONS.map((k) => `${k}=${merged.rejections[k]}`).join(' ')}`);
  const oos = Object.entries(merged.outOfScope).sort(([a], [b]) => compare(a, b));
  lines.push(`out-of-scope ${oos.length ? oos.map(([k, n]) => `${k}=${n}`).join(' ') : 'none'}`);
  const f = merged.files.buckets;
  lines.push(`files cited=${f.cited} declared-skip=${f['declared-skip']} ends-rejected=${f['ends-rejected']} silent-zero=${f['silent-zero']} config-cited=${merged.files.configCited}/${merged.files.configFiles}`);
  const u = merged.units;
  lines.push(`units has-candidates=${u.filter((x) => x.status === 'has-candidates').length} no-candidates=${u.filter((x) => x.status === 'no-candidates').length}`);
  const n = merged.counts;
  lines.push(`target units unknown=${n.targetUnitUnknown} missed=${n.targetUnitMissed}`);
  const x = n.externalKeys;
  const named = merged.externals.filter((e) => e.keyBy.includes('name')).map((e) => e.id.replace(/^external:/, ''));
  lines.push(`external keys host=${x.host} service=${x.service} name=${x.name}${named.length ? ` (${named.join(', ')})` : ''} transport=${x.transport} host-not-quoted=${x.hostNotQuoted}`);
  lines.push(`node ids given=${n.nodeIdGiven} rejected=${n.nodeIdRejected} analyzer=${n.nodeIdBy.analyzer} derived-range=${n.nodeIdBy['derived-range']} derived-file=${n.nodeIdBy['derived-file']} none=${n.nodeIdBy.none}`);
  for (const [kind, m] of Object.entries(merged.measurements)) {
    const ag = m.agreement.status === 'measured' || m.agreement.status === 'insufficient'
      ? `agreement=${m.agreement.jaccard ?? 'n/a'} (${m.agreement.intersection}/${m.agreement.union}${m.agreement.status === 'insufficient' ? ', insufficient' : ''}; key-mismatch=${m.agreement.keyMismatch} previous-only=${m.agreement.previousOnly} current-only=${m.agreement.currentOnly})`
      : `agreement=${m.agreement.status}`;
    lines.push(`kind ${kind} ends=${m.ends} linked=${m.linked} quote-failure=${m.quoteFailureRate ?? 'n/a'} unresolved=${m.unresolvedShare ?? 'n/a'} ${ag}${m.escalation.candidate ? ` escalation=${m.escalation.reasons.join('+')}` : ''}`);
  }
  const cl = merged.callLines;
  lines.push(`call lines total=${cl.total} ${CALL_LINE_BUCKETS.map((b) => `${b}=${cl.buckets[b]}`).join(' ')}`);
  const silent = merged.files.rows.filter((x) => x.status === 'silent-zero');
  for (const row of silent.slice(0, MAX_SILENT_LINES)) lines.push(`silent-zero ${row.file} unit=${row.unit}`);
  if (silent.length > MAX_SILENT_LINES) lines.push(`silent-zero ... ${silent.length - MAX_SILENT_LINES} more in the coverage report`);
  const unaccounted = cl.rows.filter((x) => x.status === 'unaccounted');
  for (const row of unaccounted.slice(0, MAX_SILENT_LINES)) lines.push(`unaccounted ${row.file}:${row.line} ${row.signal ?? '-'}`);
  if (unaccounted.length > MAX_SILENT_LINES) lines.push(`unaccounted ... ${unaccounted.length - MAX_SILENT_LINES} more in the coverage report`);
  const cons = merged.conservation;
  lines.push(cons.ok
    ? `conservation ok ends=${cons.endsIn} duplicates=${cons.duplicates} call-lines=${cons.callLines}`
    : `conservation FAILED ends=${cons.endsIn} in-buckets=${cons.inBuckets} duplicates=${cons.duplicates} call-lines=${cons.callLines} call-lines-in-buckets=${cons.callLinesInBuckets} call-lines-expected=${cons.callLinesExpected}`);
  if (graphPath) lines.push(`relations graph: ${graphPath}`);
  lines.push(`coverage report: ${coveragePath}`);
  return lines;
}

/** The whole merge for one project; `mergeFn` is injectable to exercise the not-conserved path. */
export async function runMerge({
  projectRoot, out = null, coverage: coverageOut = null, mergeFn = mergeRelations,
  stdout = (t) => process.stdout.write(t), stderr = (t) => process.stderr.write(t),
}) {
  const root = resolve(projectRoot);
  const core = await resolveCore();
  const dataDir = core.resolveDataDir(root);
  const areasDir = join(dataDir, 'intermediate', AREAS_DIR);
  const manifestPath = join(areasDir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`merge-relations: no area manifest at ${manifestPath}; run split-relation-areas.mjs first`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const unitsFile = readJsonOrNull(join(dataDir, UNITS_FILE));
  if (!isObject(unitsFile) || !Array.isArray(unitsFile.units)) throw new Error('merge-relations: no units; run plan-units.mjs first');
  if (unitsFile.digest !== manifest.unitsDigest) throw new Error('merge-relations: the units changed since the split; run split-relation-areas.mjs again');
  const facts = manifest.graphPath ? readGraphFacts(manifest.graphPath) : null;

  const areaResults = [];
  for (const { areaId } of manifest.areas) {
    if (!AREA_ID.test(areaId)) throw new Error(`merge-relations: malformed area id ${JSON.stringify(areaId)} in the manifest`);
    const result = acceptOutput({ token: manifest.token, areaId, text: readOrNull(join(areasDir, `${areaId}.relations.json`)) });
    areaResults.push({ areaId, ...result });
  }
  const accepted = areaResults.filter((r) => r.status === 'accepted').map(({ areaId, output }) => ({ areaId, output }));

  const cache = new Map();
  const readLines = (file) => {
    if (!cache.has(file)) {
      let lines = null;
      try {
        lines = readFileSync(join(root, file), 'utf-8').split(/\r?\n/);
      } catch { /* unreadable: null */ }
      cache.set(file, lines);
    }
    return cache.get(file);
  };
  const graphPath = resolve(out ?? join(dataDir, GRAPH_FILE));
  const previous = readJsonOrNull(graphPath);
  const merged = mergeFn({ accepted, manifest, units: unitsFile.units, facts, readLines, previous: previous?.format === GRAPH_FORMAT ? previous : null });

  let sourceRevision = null;
  try {
    const { resolveFreshness } = await import('../excavator/consumer-freshness.mjs');
    sourceRevision = (await resolveFreshness(root)).currentSourceRevision ?? null;
  } catch { /* no snapshot: null */ }
  const status = areaResults.every((a) => a.status === 'accepted') ? 'complete' : 'incomplete';
  const graph = {
    format: GRAPH_FORMAT,
    contentLanguage: 'en',
    generatedAt: new Date().toISOString(),
    sourceRevision,
    factDigest: facts?.factsDigest ?? null,
    inputDigest: manifest.inputDigest,
    unitsDigest: manifest.unitsDigest,
    status,
    units: unitsFile.units.map(({ id, name, root: r, kind, evidence }) => ({ id, name, root: r, kind, evidence })),
    externals: merged.externals,
    relations: merged.relations,
    buckets: merged.buckets,
    callLines: { total: merged.callLines.total, buckets: merged.callLines.buckets, unaccounted: merged.callLines.rows.filter((r) => r.status === 'unaccounted') },
    outOfScope: merged.outOfScope,
    measurements: merged.measurements,
  };
  const coverage = {
    format: COVERAGE_FORMAT,
    token: manifest.token,
    inputDigest: manifest.inputDigest,
    status,
    thresholds: THRESHOLDS,
    areas: areaResults.map(({ areaId, status: s, reason }) => ({ areaId, status: s, ...(reason ? { reason } : {}) })),
    buckets: merged.buckets,
    rejections: merged.rejections,
    outOfScope: merged.outOfScope,
    conservation: merged.conservation,
    files: { buckets: merged.files.buckets, configFiles: merged.files.configFiles, configCited: merged.files.configCited, split: manifest.counts, rows: merged.files.rows },
    callLines: merged.callLines,
    units: merged.units,
    anchors: merged.counts,
    measurements: merged.measurements,
    escalationCandidates: Object.entries(merged.measurements).filter(([, m]) => m.escalation.candidate).map(([kind, m]) => ({ kind, reasons: m.escalation.reasons })),
  };

  if (merged.conservation.ok) writeJson(graphPath, graph);
  else rmSync(graphPath, { force: true });
  const coveragePath = resolve(coverageOut ?? join(dataDir, 'reports', 'relations-coverage.json'));
  writeJson(coveragePath, coverage);
  stdout(`${reportLines({ areaResults, merged, coveragePath, graphPath: merged.conservation.ok ? graphPath : null }).join('\n')}\n`);

  if (!merged.conservation.ok) {
    stderr('merge-relations: ends or call lines were lost or added between the analyzers and the buckets; relations-graph.json not written\n');
    return { exitCode: EXIT_NOT_CONSERVED };
  }
  if (status !== 'complete') {
    stderr(`merge-relations: areas not accepted: ${areaResults.filter((a) => a.status !== 'accepted').map((a) => `${a.areaId}=${a.status}`).join(' ')}\n`);
    return { exitCode: EXIT_INCOMPLETE };
  }
  return { exitCode: 0 };
}

function parseArgs(argv) {
  const args = { projectRoot: null, out: null, coverage: null };
  const flags = { '--out': 'out', '--coverage': 'coverage' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (flags[arg]) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`merge-relations: ${arg} requires a value`);
      args[flags[arg]] = value;
      i++;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`merge-relations: unknown option: ${arg}`);
    if (!args.projectRoot) { args.projectRoot = arg; continue; }
    throw new Error(`merge-relations: unexpected argument: ${arg}`);
  }
  if (!args.projectRoot) throw new Error('Usage: node merge-relations.mjs <projectRoot> [--out <path>] [--coverage <path>]');
  return args;
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { exitCode } = await runMerge({ projectRoot: args.projectRoot, out: args.out, coverage: args.coverage });
    if (exitCode !== 0) process.exitCode = exitCode;
  } catch (err) {
    process.stderr.write(`merge-relations.mjs failed: ${err.message}\n`);
    process.exit(1);
  }
}

export default { acceptOutput, endsOf, checkEnd, anchorNode, accountCallLines, mergeRelations, splitUnmatched, reportLines, runMerge, insideRoot };
