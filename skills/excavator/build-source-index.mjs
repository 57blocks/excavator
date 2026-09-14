#!/usr/bin/env node
/**
 * build-source-index.mjs
 *
 * Deterministic symbol-aware lexical (BM25) source index (openspec: changes/
 * hybrid-retrieval, capability `source-index`, design D2). This is a
 * PROJECTION, like build-fact-graph.mjs: it reads `structure-all.json`'s
 * already-extracted declarations (path/owner/symbol/line-range — see
 * extract-structure-result.mjs's buildResult() row shape) to decide WHERE
 * each chunk's boundaries are, then reads that exact line range's own source
 * text (via an injected `readFile`) to pull out identifiers, comments and
 * string literals for that chunk. It does NOT re-run structural extraction
 * and it calls no model — the comment/string scan below is a best-effort
 * heuristic text scan (regex-based), not a language parser, and is only ever
 * used to enrich a lexical index, never to author a fact.
 *
 * Node identity: function/class/definition/service/endpoint/pipeline/
 * resource chunks carry a `nodeId` derived via the SAME `deriveNodeId`
 * authority (node-identity.mjs) build-fact-graph.mjs uses for the fact
 * graph's own node ids, and the same declaration walk/ordinal grouping
 * (fact-graph-resolve.mjs's `assignOrdinals`) — so a BM25 hit's `nodeId`
 * resolves to the SAME fact-graph node id for the same declaration, letting
 * group-3's mergeCandidates treat a source-index chunk and a fact node as
 * the same identity for "exact nodeId" matching and seeding graph traversal.
 * (`declEntriesForRow` below deliberately mirrors build-fact-graph.mjs's own
 * private `nonCodeEntries` helper rather than importing it — that helper is
 * not exported, and this module must stay importable without pulling in the
 * whole fact-graph orchestration file; same reasoning fact-graph-resolve.mjs
 * documents for its own small mirrors of annotate-graph.mjs helpers.)
 *
 * Persistence: `source-index.json` is keyed by `sourceRevision` (the same
 * SourceSnapshot revision source-manifest.json carries). `updateSourceIndex`
 * accepts exactly the `{added, modified, removed}` shape
 * `sync-fact-graph.mjs`'s `computeChangedFileSet`/`syncFactGraph().changed`
 * already returns, and rebuilds ONLY those files' chunks — every chunk for
 * an untouched path is reused by REFERENCE from the previous index, never
 * re-read or re-derived (see the task report for the incremental design and
 * its test proof: `readFile` is never called for an untouched path).
 *
 * Contract: openspec/changes/hybrid-retrieval/specs/source-index/spec.md
 *
 * Usage (CLI):
 *   node build-source-index.mjs <projectRoot>
 *     [--scan <scan-result.json>] [--structure <structure-all.json>]
 *     [--out <source-index.json>] [--source-revision <rev>]
 *     [--previous <prior source-index.json>] [--changed <changed-file-set.json>]
 *
 * Programmatic:
 *   import { buildSourceIndex, updateSourceIndex } from './build-source-index.mjs';
 *   const index = buildSourceIndex({ scan, structureAll, readFile, sourceRevision });
 *   const next = updateSourceIndex({ previousIndex, structureAll, changed, readFile, sourceRevision });
 *
 * Both programmatic entry points take plain in-memory objects and an
 * injected `readFile(path) -> string` — no disk I/O, no @excavator/core
 * dependency — so they are directly unit-testable with synthetic fixtures.
 * Only the CLI's `main()` touches disk.
 *
 * Logging: stderr only.
 */

import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { deriveNodeId } from './node-identity.mjs';
import { assignOrdinals, compareStrings, mapDeclarationKind } from './fact-graph-resolve.mjs';
import { sortObjectKeys } from './coverage-ledger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_BM25_K1 = 1.5;
export const DEFAULT_BM25_B = 0.75;

// ---------------------------------------------------------------------------
// Identifier / free-text tokenizer — subword splitting on camelCase,
// PascalCase, snake_case, kebab-case and acronym runs (HTTPServer ->
// http|server), lowercased. Also used as the generic tokenizer for comments
// and string literals (any embedded punctuation already becomes a boundary
// via the final split), so one function serves both "split an identifier"
// and "tokenize free text" — the spec's "identifier subwords" plus the token
// bag BM25 indexes are built from the same primitive.
// ---------------------------------------------------------------------------
export function splitIdentifier(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  const withBoundaries = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2');
  return withBoundaries
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((s) => s.toLowerCase());
}

// ---------------------------------------------------------------------------
// Heuristic comment / string-literal extraction. A best-effort regex text
// scan over a chunk's OWN source lines — not a language parser. Known,
// accepted limitations: a "//" or "#" inside a string literal not already
// stripped, or inside a URL, can be misread as a line comment; nested/escaped
// quote edge cases are not exhaustively handled. This is acceptable because
// the output only ever feeds a lexical recall index, never an authored fact.
// ---------------------------------------------------------------------------
export function extractCommentsAndStrings(text) {
  const comments = [];
  const strings = [];
  if (typeof text !== 'string' || text.length === 0) return { comments, strings };

  let working = text;

  // Python-style triple-quoted docstrings/blocks -> comments.
  working = working.replace(/("""|''')([\s\S]*?)\1/g, (_m, _q, body) => {
    if (body.trim()) comments.push(body.trim());
    return ' ';
  });

  // C-style block comments -> comments.
  working = working.replace(/\/\*([\s\S]*?)\*\//g, (_m, body) => {
    if (body.trim()) comments.push(body.trim());
    return ' ';
  });

  // String literals (single/double/backtick, simple backslash-escape aware)
  // -> strings. Stripped from `working` first so a quote's content is never
  // later misread as a line-comment marker below.
  working = working.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, (m) => {
    const body = m.slice(1, -1);
    if (body.trim()) strings.push(body);
    return ' ';
  });

  // Remaining `//` or `#` line comments, one per source line.
  for (const line of working.split('\n')) {
    const slashIdx = line.indexOf('//');
    const hashIdx = line.indexOf('#');
    const candidates = [slashIdx, hashIdx].filter((i) => i !== -1);
    if (candidates.length === 0) continue;
    const idx = Math.min(...candidates);
    const markerLen = line[idx] === '#' ? 1 : 2;
    const body = line.slice(idx + markerLen).trim();
    if (body) comments.push(body);
  }

  return { comments, strings };
}

/** A chunk's flat token bag for BM25 indexing: already-split identifiers
 *  plus tokenized comment/string text. Exported so a caller can recompute
 *  the same bag a query should be compared against, without re-deriving it
 *  from raw source. */
export function chunkTokenBag(chunk) {
  const commentTokens = (chunk.comments ?? []).flatMap(splitIdentifier);
  const stringTokens = (chunk.strings ?? []).flatMap(splitIdentifier);
  return [...(chunk.identifiers ?? []), ...commentTokens, ...stringTokens];
}

// ---------------------------------------------------------------------------
// Chunk boundaries — one declaration entry per structure-all row, mirroring
// build-fact-graph.mjs's own declaration walk (functions, classes, and the
// same five optional non-code fields it projects into fact nodes).
// ---------------------------------------------------------------------------
function declEntriesForRow(row) {
  const entries = [];
  for (const fn of row.functions ?? []) {
    entries.push({
      kind: 'function', path: row.path, name: fn.name, owner: fn.owner ?? null,
      params: fn.params ?? [], returnType: fn.returnType,
      lineRange: [fn.startLine, fn.endLine],
      identifierSeeds: [fn.name, fn.owner, ...(fn.params ?? []), fn.returnType],
    });
  }
  for (const cls of row.classes ?? []) {
    entries.push({
      kind: 'class', path: row.path, name: cls.name, owner: null,
      lineRange: [cls.startLine, cls.endLine],
      identifierSeeds: [cls.name, ...(cls.methods ?? []), ...(cls.properties ?? [])],
    });
  }
  for (const def of row.definitions ?? []) {
    entries.push({
      kind: mapDeclarationKind(def.kind), path: row.path, name: def.name, owner: null,
      lineRange: [def.startLine, def.endLine],
      identifierSeeds: [def.name, ...(def.fields ?? [])],
    });
  }
  for (const svc of row.services ?? []) {
    entries.push({
      kind: 'service', path: row.path, name: svc.name, owner: null,
      lineRange: svc.startLine != null ? [svc.startLine, svc.endLine] : null,
      identifierSeeds: [svc.name, svc.image],
    });
  }
  for (const ep of row.endpoints ?? []) {
    entries.push({
      kind: 'endpoint', path: row.path, name: `${ep.method ?? ''} ${ep.path}`.trim(), owner: null,
      lineRange: [ep.startLine, ep.endLine],
      identifierSeeds: [ep.method, ep.path],
    });
  }
  for (const step of row.steps ?? []) {
    entries.push({
      kind: 'pipeline', path: row.path, name: step.name, owner: null,
      lineRange: [step.startLine, step.endLine],
      identifierSeeds: [step.name],
    });
  }
  for (const res of row.resources ?? []) {
    entries.push({
      kind: mapDeclarationKind(res.kind), path: row.path, name: res.name, owner: null,
      lineRange: [res.startLine, res.endLine],
      identifierSeeds: [res.name],
    });
  }
  return entries;
}

// Same grouping build-fact-graph.mjs uses for its ordinal fallback (path,
// owner, kind) — a private 1-line mirror rather than an import, for the same
// reason declEntriesForRow above is not imported.
const ORDINAL_KEY_SEP = String.fromCharCode(31);
function ordinalGroupKey(entry) {
  return [entry.path, entry.owner ?? '', entry.kind].join(ORDINAL_KEY_SEP);
}

function nodeIdFor(entry) {
  return deriveNodeId({
    type: entry.kind,
    path: entry.path,
    name: entry.name,
    owner: entry.owner,
    params: entry.kind === 'function' ? entry.params : undefined,
    returnType: entry.kind === 'function' ? entry.returnType : undefined,
    ordinal: entry.ordinal,
  });
}

/** Make `nodeId` collision-safe as a chunk `id` (extremely rare in practice —
 *  see node-identity.mjs's own identity-collision handling — but every
 *  declaration must still get its own chunk, never be silently dropped). */
function uniqueChunkId(nodeId, usedIds) {
  let id = nodeId;
  let n = 2;
  while (usedIds.has(id)) {
    id = `${nodeId}#${n}`;
    n += 1;
  }
  usedIds.add(id);
  return id;
}

function sliceLines(content, start, end) {
  const lines = content.split('\n');
  const from = Math.max(1, start ?? 1) - 1;
  const to = Math.min(lines.length, end ?? lines.length);
  return lines.slice(from, to).join('\n');
}

function buildChunk(entry, { content, contentAvailable, language, usedIds }) {
  const nodeId = nodeIdFor(entry);
  const id = uniqueChunkId(nodeId, usedIds);

  const sliceText = contentAvailable && entry.lineRange && content
    ? sliceLines(content, entry.lineRange[0], entry.lineRange[1])
    : '';
  const { comments, strings } = sliceText
    ? extractCommentsAndStrings(sliceText)
    : { comments: [], strings: [] };

  const seeds = [...(entry.identifierSeeds ?? []), basename(entry.path)];
  const identifiers = seeds
    .filter((s) => typeof s === 'string' && s.length > 0)
    .flatMap(splitIdentifier);

  return {
    id,
    nodeId,
    path: entry.path,
    owner: typeof entry.owner === 'string' && entry.owner.length > 0 ? entry.owner : null,
    symbol: entry.name ?? null,
    type: entry.kind,
    language,
    lineRange: entry.lineRange ?? null,
    identifiers,
    comments,
    strings,
    contentAvailable,
  };
}

function readContent(readFile, path) {
  try {
    const read = readFile(path);
    return typeof read === 'string' ? read : null;
  } catch {
    return null;
  }
}

/**
 * Build every chunk for one structure-all row: the whole-file chunk plus one
 * chunk per declaration. Shared between `buildSourceIndex` (every row) and
 * `updateSourceIndex` (only touched rows) so the two never diverge.
 *
 * @returns {{ chunks: object[], contentAvailable: boolean }}
 */
function chunksForRow(row, { readFile, language, usedIds }) {
  const content = readContent(readFile, row.path);
  const contentAvailable = content !== null;

  const chunks = [
    buildChunk(
      {
        kind: 'file', path: row.path, name: null, owner: null,
        lineRange: [1, Math.max(1, row.totalLines ?? row.nonEmptyLines ?? 1)],
        identifierSeeds: [basename(row.path)],
      },
      { content, contentAvailable, language, usedIds },
    ),
  ];

  const entries = assignOrdinals(declEntriesForRow(row), ordinalGroupKey);
  for (const entry of entries) {
    chunks.push(buildChunk(entry, { content, contentAvailable, language, usedIds }));
  }

  return { chunks, contentAvailable };
}

// ---------------------------------------------------------------------------
// BM25 inverted index assembly (build only — querying is retrieve.mjs's
// `bm25Search`, kept in the group-3 module so this one stays a pure builder).
// ---------------------------------------------------------------------------
function buildPostings(chunks) {
  const postings = {};
  const docLengths = {};
  let totalLength = 0;

  for (const chunk of chunks) {
    const bag = chunkTokenBag(chunk);
    docLengths[chunk.id] = bag.length;
    totalLength += bag.length;

    const tf = new Map();
    for (const term of bag) tf.set(term, (tf.get(term) ?? 0) + 1);
    for (const [term, freq] of tf) {
      if (!postings[term]) postings[term] = [];
      postings[term].push({ chunkId: chunk.id, tf: freq });
    }
  }

  for (const term of Object.keys(postings)) {
    postings[term].sort((a, b) => compareStrings(a.chunkId, b.chunkId));
  }

  return {
    postings: sortObjectKeys(postings),
    docLengths,
    avgDocLength: chunks.length > 0 ? totalLength / chunks.length : 0,
  };
}

// ---------------------------------------------------------------------------
// Full build.
// ---------------------------------------------------------------------------

/**
 * @param {{
 *   scan?: { files?: Array<{path:string, language?:string}> },
 *   structureAll: { results: object[] },
 *   readFile: (path: string) => string,
 *   sourceRevision: string,
 *   k1?: number, b?: number,
 * }} args
 */
export function buildSourceIndex({ scan, structureAll, readFile, sourceRevision, k1 = DEFAULT_BM25_K1, b = DEFAULT_BM25_B }) {
  if (!structureAll || !Array.isArray(structureAll.results)) {
    throw new Error('buildSourceIndex: structureAll.results must be an array');
  }
  if (typeof readFile !== 'function') {
    throw new Error('buildSourceIndex: readFile must be a function');
  }
  if (typeof sourceRevision !== 'string' || sourceRevision.length === 0) {
    throw new Error('buildSourceIndex: sourceRevision is required');
  }

  const languageOfPath = new Map((scan?.files ?? []).map((f) => [f.path, f.language]));
  const fileRows = [...structureAll.results].sort((a, b) => compareStrings(a.path, b.path));

  const chunks = [];
  const usedIds = new Set();
  const filesIndexed = [];
  const filesContentUnavailable = [];

  for (const row of fileRows) {
    filesIndexed.push(row.path);
    const language = languageOfPath.get(row.path) ?? row.language ?? 'unknown';
    const { chunks: rowChunks, contentAvailable } = chunksForRow(row, { readFile, language, usedIds });
    chunks.push(...rowChunks);
    if (!contentAvailable) filesContentUnavailable.push(row.path);
  }

  chunks.sort((a, b) => compareStrings(a.id, b.id));
  const { postings, docLengths, avgDocLength } = buildPostings(chunks);

  return {
    sourceRevision,
    k1,
    b,
    N: chunks.length,
    avgDocLength,
    chunks,
    postings,
    docLengths,
    filesIndexed: filesIndexed.sort(compareStrings),
    filesContentUnavailable: filesContentUnavailable.sort(compareStrings),
  };
}

// ---------------------------------------------------------------------------
// Single-file incremental rebuild — Requirement "persist by sourceRevision and
// incrementally rebuild". Accepts exactly the `{added, modified, removed}` shape
// sync-fact-graph.mjs's `computeChangedFileSet`/`syncFactGraph().changed`
// already returns; every chunk for an untouched path is reused by reference,
// never re-read or re-derived.
// ---------------------------------------------------------------------------

/**
 * @param {{
 *   previousIndex: object,
 *   structureAll: { results: object[] },
 *   changed: { added?: string[], modified?: string[], removed?: string[] },
 *   readFile: (path: string) => string,
 *   sourceRevision?: string, k1?: number, b?: number,
 * }} args
 */
export function updateSourceIndex({ previousIndex, structureAll, changed, readFile, sourceRevision, k1, b }) {
  if (!previousIndex) throw new Error('updateSourceIndex: previousIndex is required');
  if (!structureAll || !Array.isArray(structureAll.results)) {
    throw new Error('updateSourceIndex: structureAll.results must be an array');
  }

  const added = changed?.added ?? [];
  const modified = changed?.modified ?? [];
  const removed = changed?.removed ?? [];
  const touched = new Set([...added, ...modified, ...removed]);

  // Untouched chunks: kept BY REFERENCE — no re-read, no re-derivation.
  const keptChunks = previousIndex.chunks.filter((c) => !touched.has(c.path));
  const usedIds = new Set(keptChunks.map((c) => c.id));

  const rowsToRebuild = structureAll.results.filter(
    (row) => added.includes(row.path) || modified.includes(row.path),
  );

  const rebuiltChunks = [];
  const contentUnavailablePaths = [];
  for (const row of rowsToRebuild) {
    const { chunks: rowChunks, contentAvailable } = chunksForRow(
      row, { readFile, language: row.language ?? 'unknown', usedIds },
    );
    rebuiltChunks.push(...rowChunks);
    if (!contentAvailable) contentUnavailablePaths.push(row.path);
  }

  const chunks = [...keptChunks, ...rebuiltChunks].sort((a, b) => compareStrings(a.id, b.id));
  const { postings, docLengths, avgDocLength } = buildPostings(chunks);

  const filesIndexed = [...new Set([
    ...previousIndex.filesIndexed.filter((p) => !removed.includes(p)),
    ...added,
    ...modified,
  ])].sort(compareStrings);

  const filesContentUnavailable = [...new Set([
    ...previousIndex.filesContentUnavailable.filter((p) => !touched.has(p)),
    ...contentUnavailablePaths,
  ])].sort(compareStrings);

  return {
    sourceRevision: sourceRevision ?? previousIndex.sourceRevision,
    k1: k1 ?? previousIndex.k1,
    b: b ?? previousIndex.b,
    N: chunks.length,
    avgDocLength,
    chunks,
    postings,
    docLengths,
    filesIndexed,
    filesContentUnavailable,
  };
}

// -----------------------------------------------------------------------------
// CLI entry. Only this path touches disk or @excavator/core.
// -----------------------------------------------------------------------------

async function resolveCore(pluginRoot) {
  const require = createRequire(resolve(pluginRoot, 'package.json'));
  try {
    return await import(pathToFileURL(require.resolve('@excavator/core')).href);
  } catch {
    return await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
  }
}

function parseArgs(argv) {
  const args = {
    projectRoot: null, scan: null, structure: null, out: null,
    sourceRevision: null, previous: null, changed: null,
  };
  const flagMap = {
    '--scan': 'scan', '--structure': 'structure', '--out': 'out',
    '--source-revision': 'sourceRevision', '--previous': 'previous', '--changed': 'changed',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const flag = flagMap[arg];
    if (flag) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`build-source-index: ${arg} requires a value`);
      args[flag] = value;
      i++;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`build-source-index: unknown option: ${arg}`);
    if (!args.projectRoot) {
      args.projectRoot = arg;
      continue;
    }
    throw new Error(`build-source-index: unexpected argument: ${arg}`);
  }
  if (!args.projectRoot) {
    throw new Error(
      'Usage: node build-source-index.mjs <projectRoot> [--scan <path>] [--structure <path>] ' +
      '[--out <path>] [--source-revision <rev>] [--previous <path>] [--changed <path>]',
    );
  }
  return args;
}

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`build-source-index: ${label} not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(args.projectRoot);
  const pluginRoot = resolve(__dirname, '../..');
  const { resolveDataDir } = await resolveCore(pluginRoot);
  const dataDir = resolveDataDir(projectRoot);
  const intermediate = join(dataDir, 'intermediate');

  const scanPath = args.scan ? resolve(args.scan) : join(intermediate, 'scan-result.json');
  const structurePath = args.structure ? resolve(args.structure) : join(intermediate, 'structure-all.json');
  const outPath = args.out ? resolve(args.out) : join(dataDir, 'source-index.json');
  const manifestPath = join(dataDir, 'source-manifest.json');

  const scan = existsSync(scanPath) ? readJson(scanPath, 'scan result') : { files: [] };
  const structureAll = readJson(structurePath, 'structure-all result');

  const sourceRevision = args.sourceRevision
    ?? (existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf-8')).sourceRevision : null);
  if (!sourceRevision) {
    throw new Error('build-source-index: no --source-revision given and no source-manifest.json found');
  }

  const readFile = (relPath) => readFileSync(join(projectRoot, relPath), 'utf-8');

  let index;
  if (args.previous && args.changed) {
    const previousIndex = readJson(args.previous, 'previous source-index.json');
    const changed = readJson(args.changed, 'changed-file-set');
    index = updateSourceIndex({ previousIndex, structureAll, changed, readFile, sourceRevision });
  } else {
    index = buildSourceIndex({ scan, structureAll, readFile, sourceRevision });
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(index, null, 2), 'utf-8');
  if (!existsSync(outPath)) throw new Error(`output file missing after write: ${outPath}`);

  process.stderr.write(
    `build-source-index: chunks=${index.chunks.length} filesIndexed=${index.filesIndexed.length} ` +
    `contentUnavailable=${index.filesContentUnavailable.length} sourceRevision=${index.sourceRevision}\n`,
  );
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
    await main();
  } catch (err) {
    process.stderr.write(`build-source-index.mjs failed: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  }
}

export default {
  buildSourceIndex,
  updateSourceIndex,
  splitIdentifier,
  extractCommentsAndStrings,
  chunkTokenBag,
  DEFAULT_BM25_K1,
  DEFAULT_BM25_B,
};
