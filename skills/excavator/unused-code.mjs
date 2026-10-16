#!/usr/bin/env node
/**
 * unused-code.mjs
 *
 * The deterministic halves of unused-code detection (openspec: changes/
 * unused-code, capability `unused-code`, design D1-D7). No model, no framework
 * or language branch, no build of the target. Between the two halves the host
 * skill makes the one judgment the scripts do not: which candidates are really
 * program entries.
 *
 *   node unused-code.mjs candidates <projectRoot>
 *   node unused-code.mjs report <projectRoot> [--decisions <file>]
 *
 * `candidates` reads the fact graph, the structure result and the source
 * manifest under `.excavator/` and writes the full candidate set ("nothing
 * references it" is a claim about absence and needs the whole index) together
 * with the facts the entry judgment is made from. `report` reads that candidate
 * set and the skill's decisions file, removes what the decisions name and
 * everything reachable from it, and writes the unused code with its groups and
 * a confidence per node. It never reads the fact graph beyond its header digest.
 *
 * Definition. A function node is used when it is reachable from a route handler
 * (the target of a `routes` edge) along references; every other function node is
 * a candidate. References are `calls` edges between function nodes and
 * `implements` / `overrides` edges between function nodes, the latter in BOTH
 * directions (an overridden method in use makes its overrides dispatchable; an
 * override in use pins the declaration it overrides). `references`, `injects`,
 * `mentions` and `contains` never take part in method reachability; the first
 * three reach classes and become signals on the owning type (the `types`
 * table).
 *
 * Clusters. Candidates are condensed into strongly connected components
 * (iterative Tarjan, the graphs reach ~10^5 nodes). A candidate is an entry when
 * its component has no reference coming from another component: a single node
 * nobody references, or an island that only references itself. Every candidate
 * records its direct referrers among the candidates, each with the fact edge
 * type and direction, so the later `report` step can recompute reachability
 * from the product alone.
 *
 * Conservation. Every function node is in exactly one of {route-reachable,
 * candidates}. A violation is an Error and nothing is written.
 *
 * Name census (design D5). For every candidate, how often its name occurs in the
 * selected source files outside the places the facts already explain: its own
 * declaration, and the bodies of its direct referrers. Reflective calls, string
 * references, descriptors and calls from languages the graph has no edges for
 * all show up there. The files read are the files the facts were built from:
 * each is checked against the manifest's content hash, read from the working
 * tree or, when that differs (uncommitted changes), from the source snapshot.
 *
 * Product `.excavator/unused-candidates.json`
 *   { format, factsDigest, sourceRevision, counts, conservation, census, types,
 *     candidates }
 * Structure facts the structure result does not carry are `null` (unknown); a
 * present-but-empty field is `[]`. A candidate whose name is not a plain
 * identifier has `census: null` (unknown, never zero). `counts.byLanguage` has a row per
 * language of the function nodes, { functionNodes, routeReachable, candidates, entries, calls }:
 * `calls` is the number of `calls` edges between function nodes whose caller is in that language,
 * so a language with function nodes and `calls` 0 has no call facts in the fact graph.
 *
 * Report (design D3, D4, D6, D7). The decisions file
 * `.excavator/unused-decisions.json` (or `--decisions <file>`) is
 *   { factsDigest, decisions: [ { kind: "entry" | "test-entry", reason, query, ids } ] }
 * and is rejected when the candidate set is stale against the current fact graph,
 * when it was made on another candidate set, when it is malformed, when an id is
 * not a candidate, or when an id appears twice. Decisions only remove: every
 * candidate reachable from an `entry` id (along the referrer table, referrer ->
 * referenced) is removed; the ones reachable only from `test-entry` ids are
 * `test-only`; the rest is unused. Unused nodes are grouped by weak connectivity
 * under the references, each group listing its entries. Each unused node gets a
 * confidence (`high` / `medium` / `low`) and its signals from fixed rules over
 * the candidate facts (design D6), capped on the condensation DAG so that no node
 * is above a node that references it. The three sets and the candidates
 * conserve; a violation is an Error and nothing is written.
 *
 * Product `.excavator/unused-code.json`
 *   { format, factsDigest, decisionsDigest, sourceRevision, counts, conservation,
 *     residualAssumptions, decisions, unused, groups, testOnly }
 * `counts.byLanguage` has a row for every language of the candidates header, { candidates, calls,
 * unused, high, medium, low }, `candidates` and `calls` copied from the header. A candidates product
 * without those rows (made before the call counts) is refused: nothing is written.
 *
 * Contract: openspec/changes/unused-code/specs/unused-code/spec.md
 *           (requirements: the definition of unused code, the deterministic
 *           candidate set, the name occurrence census, entry judgment by the
 *           host skill, the confidence rules, the product / freshness / query)
 */

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readKnowledgeGraph, readKnowledgeGraphHeader } from './knowledge-graph-store.mjs';
import { assertDataDir, assertDataFile, assertDataTree, bindProjectRoot, canonicalSourcePath } from './project-paths.mjs';
import { serializeJsonProduct } from './product-serialization.mjs';
import { resolveSourceSnapshot } from './source-snapshot.mjs';
import { contentHash } from './source-snapshot/manifest.mjs';
import { readStructureAll } from './structure-all-store.mjs';

/** Stamped on the product header. An incompatible shape change bumps it. */
export const UNUSED_CANDIDATES_FORMAT = 'excavator-unused-candidates/1';

/** The product's file name, inside `.excavator/`. */
export const UNUSED_CANDIDATES_FILE = 'unused-candidates.json';

/** At most this many samples per signal; the counts next to them are never truncated. */
const SAMPLE_LIMIT = 5;

/** Reference edge kinds. The numeric order is the output order of referrers (edge name, then reverse). */
const KIND_CALLS = 0;
const KIND_IMPLEMENTS = 1;
const KIND_IMPLEMENTS_REVERSE = 2;
const KIND_OVERRIDES = 3;
const KIND_OVERRIDES_REVERSE = 4;
const KIND_COUNT = 8;
const KIND_LABELS = [
  { edge: 'calls', reverse: false },
  { edge: 'implements', reverse: false },
  { edge: 'implements', reverse: true },
  { edge: 'overrides', reverse: false },
  { edge: 'overrides', reverse: true },
];

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sortedUnique = (values) => [...new Set(values)].sort(compareText);

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * The simple name of a type text: generic arguments (nested included) and array
 * brackets dropped, the last `.` segment taken, trimmed. `java.util.Map.Entry<K, V>[]`
 * -> `Entry`. A supertype text, a class name and an annotation class literal are
 * all compared through this.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function simpleTypeName(text) {
  if (typeof text !== 'string') return '';
  let flat = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '<') depth += 1;
    else if (ch === '>') depth = depth > 0 ? depth - 1 : 0;
    else if (depth === 0) flat += ch;
  }
  const parts = flat.replace(/(\[\s*\])+/g, '').trim().split('.');
  return parts[parts.length - 1].trim();
}

// ---------------------------------------------------------------------------
// Conservation
// ---------------------------------------------------------------------------

/**
 * Every function id must be in exactly one of `reachable` and `candidates`, and
 * neither set may hold an id that is not a function. Throws a descriptive Error
 * naming the offending ids otherwise.
 *
 * @param {{ functionIds: Iterable<string>, reachable: Iterable<string>, candidates: Iterable<string> }} sets
 */
export function assertConservation({ functionIds, reachable, candidates }) {
  const asSet = (values) => (values instanceof Set ? values : new Set(values));
  const functions = asSet(functionIds);
  const reach = asSet(reachable);
  const cand = asSet(candidates);
  const neither = [];
  const both = [];
  const stray = [];
  for (const id of functions) {
    const inReach = reach.has(id);
    const inCand = cand.has(id);
    if (!inReach && !inCand) neither.push(id);
    else if (inReach && inCand) both.push(id);
  }
  for (const set of [reach, cand]) for (const id of set) if (!functions.has(id)) stray.push(id);

  const problems = [];
  const show = (ids) => `${ids.slice(0, 5).join(', ')}${ids.length > 5 ? `, ... (${ids.length} in all)` : ''}`;
  if (neither.length > 0) problems.push(`${neither.length} function node(s) in neither the route-reachable set nor the candidates: ${show(neither)}`);
  if (both.length > 0) problems.push(`${both.length} function node(s) in both the route-reachable set and the candidates: ${show(both)}`);
  if (stray.length > 0) problems.push(`${stray.length} id(s) in the route-reachable set or the candidates that are not function nodes: ${show(stray)}`);
  if (problems.length > 0) {
    throw new Error(`unused-code conservation violated: functionNodes=${functions.size}, routeReachable=${reach.size}, candidates=${cand.size}; ${problems.join('; ')}`);
  }
}

// ---------------------------------------------------------------------------
// Graph algorithms over index space (typed arrays, no recursion)
// ---------------------------------------------------------------------------

/** Compressed adjacency: for each node, the slice of `targets`/`kinds` from `offsets[node]` to `offsets[node + 1]`. */
function buildCsr(nodeCount, from, to, kinds) {
  const offsets = new Int32Array(nodeCount + 1);
  for (let i = 0; i < from.length; i++) offsets[from[i] + 1] += 1;
  for (let i = 0; i < nodeCount; i++) offsets[i + 1] += offsets[i];
  const fill = offsets.slice(0, nodeCount);
  const targets = new Int32Array(from.length);
  const edgeKinds = new Uint8Array(from.length);
  for (let i = 0; i < from.length; i++) {
    const slot = fill[from[i]]++;
    targets[slot] = to[i];
    edgeKinds[slot] = kinds[i];
  }
  return { offsets, targets, kinds: edgeKinds };
}

/** Breadth-first reachability from `seeds`; returns a visited flag per node. */
function reachableFrom(nodeCount, csr, seeds) {
  const visited = new Uint8Array(nodeCount);
  const queue = new Int32Array(nodeCount);
  let tail = 0;
  for (const seed of seeds) {
    if (visited[seed]) continue;
    visited[seed] = 1;
    queue[tail++] = seed;
  }
  for (let head = 0; head < tail; head++) {
    const node = queue[head];
    for (let slot = csr.offsets[node]; slot < csr.offsets[node + 1]; slot++) {
      const next = csr.targets[slot];
      if (!visited[next]) {
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
  }
  return visited;
}

/**
 * Strongly connected components, iterative Tarjan. Returns a component number
 * per node; the numbers themselves carry no meaning (the caller renumbers).
 */
function stronglyConnectedComponents(nodeCount, csr) {
  const index = new Int32Array(nodeCount).fill(-1);
  const low = new Int32Array(nodeCount);
  const onStack = new Uint8Array(nodeCount);
  const component = new Int32Array(nodeCount).fill(-1);
  const nextEdge = new Int32Array(nodeCount);
  const callStack = new Int32Array(nodeCount);
  const sccStack = new Int32Array(nodeCount);
  let counter = 0;
  let components = 0;
  let sccTop = 0;

  for (let root = 0; root < nodeCount; root++) {
    if (index[root] !== -1) continue;
    let depth = 0;
    index[root] = low[root] = counter++;
    sccStack[sccTop++] = root;
    onStack[root] = 1;
    nextEdge[root] = csr.offsets[root];
    callStack[depth++] = root;
    while (depth > 0) {
      const node = callStack[depth - 1];
      if (nextEdge[node] < csr.offsets[node + 1]) {
        const next = csr.targets[nextEdge[node]++];
        if (index[next] === -1) {
          index[next] = low[next] = counter++;
          sccStack[sccTop++] = next;
          onStack[next] = 1;
          nextEdge[next] = csr.offsets[next];
          callStack[depth++] = next;
        } else if (onStack[next] && index[next] < low[node]) {
          low[node] = index[next];
        }
        continue;
      }
      if (low[node] === index[node]) {
        let member;
        do {
          member = sccStack[--sccTop];
          onStack[member] = 0;
          component[member] = components;
        } while (member !== node);
        components += 1;
      }
      depth -= 1;
      if (depth > 0) {
        const parent = callStack[depth - 1];
        if (low[node] < low[parent]) low[parent] = low[node];
      }
    }
  }
  return component;
}

/** Number of weakly connected components (edge direction ignored). */
function weaklyConnectedCount(nodeCount, from, to) {
  const parent = new Int32Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) parent[i] = i;
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  let count = nodeCount;
  for (let i = 0; i < from.length; i++) {
    const a = find(from[i]);
    const b = find(to[i]);
    if (a !== b) {
      parent[a] = b;
      count -= 1;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Function reachability, candidates, components, referrers
// ---------------------------------------------------------------------------

/**
 * The reachability half: which function nodes are reachable from a route
 * handler, which are candidates, how the candidates cluster. Pure; reads only
 * `graph.nodes` and `graph.edges`. Every list is in id order regardless of the
 * order of the input.
 *
 * @param {{ nodes: object[], edges: object[] }} graph
 * @returns {{
 *   functionIds: string[],
 *   reachable: boolean[] | Uint8Array,
 *   candidateIds: string[],
 *   candidateIndexes: number[],
 *   entry: boolean[],
 *   component: number[],
 *   entryComponents: number,
 *   clusters: number,
 *   referrers: Array<Array<{ id: string, edge: string, reverse: boolean }>>,
 * }}
 *   `reachable` is indexed like `functionIds`; `entry`, `component`, `referrers`
 *   like `candidateIds`.
 */
export function computeCandidateSet(graph) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new TypeError('computeCandidateSet: graph.nodes and graph.edges must be arrays');
  }
  const functionIds = [];
  const seen = new Set();
  for (const node of graph.nodes) {
    if (node?.type !== 'function') continue;
    if (seen.has(node.id)) throw new Error(`unused-code: duplicate function node id ${node.id}`);
    seen.add(node.id);
    functionIds.push(node.id);
  }
  functionIds.sort(compareText);
  const n = functionIds.length;
  const indexOf = new Map(functionIds.map((id, i) => [id, i]));

  const refFrom = [];
  const refTo = [];
  const refKind = [];
  const seeds = [];
  for (const edge of graph.edges) {
    if (edge?.type === 'routes') {
      const target = indexOf.get(edge.target);
      if (target !== undefined) seeds.push(target);
      continue;
    }
    const forward = edge?.type === 'calls' ? KIND_CALLS
      : edge?.type === 'implements' ? KIND_IMPLEMENTS
        : edge?.type === 'overrides' ? KIND_OVERRIDES : -1;
    if (forward < 0) continue;
    const source = indexOf.get(edge.source);
    const target = indexOf.get(edge.target);
    if (source === undefined || target === undefined) continue;
    refFrom.push(source);
    refTo.push(target);
    refKind.push(forward);
    if (forward !== KIND_CALLS) {
      refFrom.push(target);
      refTo.push(source);
      refKind.push(forward + 1);
    }
  }

  const reachable = reachableFrom(n, buildCsr(n, refFrom, refTo, refKind), seeds);

  const candidateOf = new Int32Array(n).fill(-1);
  const candidateIndexes = [];
  const candidateIds = [];
  for (let i = 0; i < n; i++) {
    if (reachable[i]) continue;
    candidateOf[i] = candidateIds.length;
    candidateIndexes.push(i);
    candidateIds.push(functionIds[i]);
  }
  const m = candidateIds.length;

  // The reference subgraph among the candidates, in candidate index space.
  const cFrom = [];
  const cTo = [];
  const cKind = [];
  for (let e = 0; e < refFrom.length; e++) {
    const from = candidateOf[refFrom[e]];
    const to = candidateOf[refTo[e]];
    if (from < 0 || to < 0) continue;
    cFrom.push(from);
    cTo.push(to);
    cKind.push(refKind[e]);
  }

  const raw = stronglyConnectedComponents(m, buildCsr(m, cFrom, cTo, cKind));
  // Candidate indexes follow id order, so the first member met is the smallest id.
  const renumber = new Map();
  const component = new Array(m);
  for (let i = 0; i < m; i++) {
    if (!renumber.has(raw[i])) renumber.set(raw[i], renumber.size);
    component[i] = renumber.get(raw[i]);
  }
  const componentCount = renumber.size;
  const hasIncoming = new Uint8Array(componentCount);
  for (let e = 0; e < cFrom.length; e++) {
    if (component[cFrom[e]] !== component[cTo[e]]) hasIncoming[component[cTo[e]]] = 1;
  }
  const entry = component.map((c) => hasIncoming[c] === 0);
  let entryComponents = 0;
  for (let c = 0; c < componentCount; c++) if (hasIncoming[c] === 0) entryComponents += 1;

  // Direct referrers: group the candidate reference edges by their target.
  const incoming = buildCsr(m, cTo, cFrom, cKind);
  const referrers = new Array(m);
  for (let v = 0; v < m; v++) {
    const keys = [];
    for (let slot = incoming.offsets[v]; slot < incoming.offsets[v + 1]; slot++) {
      keys.push(incoming.targets[slot] * KIND_COUNT + incoming.kinds[slot]);
    }
    keys.sort((a, b) => a - b);
    const list = [];
    for (let k = 0; k < keys.length; k++) {
      if (k > 0 && keys[k] === keys[k - 1]) continue;
      const source = Math.floor(keys[k] / KIND_COUNT);
      const { edge, reverse } = KIND_LABELS[keys[k] % KIND_COUNT];
      list.push({ id: candidateIds[source], edge, reverse });
    }
    referrers[v] = list;
  }

  return {
    functionIds,
    reachable,
    candidateIds,
    candidateIndexes,
    entry,
    component,
    entryComponents,
    clusters: weaklyConnectedCount(m, cFrom, cTo),
    referrers,
  };
}

// ---------------------------------------------------------------------------
// Structure facts
// ---------------------------------------------------------------------------

/** Lookups over the structure result: language per path, functions and classes by position, annotation class literals. */
function indexStructure(structure) {
  const rows = Array.isArray(structure?.results) ? structure.results : [];
  const rowByPath = new Map();
  const annotationLiterals = new Map();
  for (const row of rows) {
    if (!row || typeof row.path !== 'string') continue;
    if (!rowByPath.has(row.path)) rowByPath.set(row.path, row);
    if (!Array.isArray(row.classLiterals)) continue;
    for (const literal of row.classLiterals) {
      if (literal?.context !== 'annotation') continue;
      const name = simpleTypeName(literal.type);
      if (!name) continue;
      if (!annotationLiterals.has(name)) annotationLiterals.set(name, []);
      annotationLiterals.get(name).push({ file: row.path, line: Number.isInteger(literal.line) ? literal.line : null });
    }
  }

  const functionsByPath = new Map();
  const classesByPath = new Map();
  const positional = (cache, path, listOf, keyOf) => {
    let index = cache.get(path);
    if (!index) {
      index = new Map();
      const list = listOf(rowByPath.get(path));
      if (Array.isArray(list)) {
        for (const item of list) {
          const key = keyOf(item);
          if (!index.has(key)) index.set(key, item);
        }
      }
      cache.set(path, index);
    }
    return index;
  };

  return {
    languageOf: (path) => (typeof rowByPath.get(path)?.language === 'string' ? rowByPath.get(path).language : null),
    functionAt: (path, name, startLine, endLine) => positional(
      functionsByPath, path, (row) => row?.functions, (f) => `${f.name}\0${f.startLine}\0${f.endLine}`,
    ).get(`${name}\0${startLine}\0${endLine}`) ?? null,
    classAt: (path, name, startLine) => positional(
      classesByPath, path, (row) => row?.classes, (c) => `${c.name}\0${c.startLine}`,
    ).get(`${name}\0${startLine}`) ?? null,
    annotationLiterals,
  };
}

const arrayOrNull = (value) => (Array.isArray(value) ? [...value] : null);

// ---------------------------------------------------------------------------
// Types table
// ---------------------------------------------------------------------------

const byFileLine = (a, b) => compareText(a.file ?? '', b.file ?? '') || (a.line ?? 0) - (b.line ?? 0);

/**
 * The per-type signals for every class that owns at least one candidate.
 *
 * Supertype texts are compared with the in-repo class-to-class `inherits` /
 * `implements` edges by simple name: a text is "in the index" when it consumes
 * the simple name of one of that class's edge targets (one edge target absorbs
 * one text, so `a.Base` and `b.Base` against a single `Base` edge leaves one
 * outside). Anything else is outside the repository.
 */
function buildTypesTable({ ownerIds, classNodes, parentsOf, childrenOf, referencedBy, structure }) {
  const supertypeCache = new Map();
  /** { known, outside } of one class: whether its supertypes are known at all, and the texts that are outside the index. */
  const supertypesOf = (classId) => {
    if (supertypeCache.has(classId)) return supertypeCache.get(classId);
    const node = classNodes.get(classId);
    const cls = Array.isArray(node?.lineRange) ? structure.classAt(node.filePath, node.name, node.lineRange[0]) : null;
    let result = { known: false, outside: [] };
    if (cls && Array.isArray(cls.supertypes)
      && cls.supertypes.every((s) => typeof s?.type === 'string' && s.type.trim() !== '')) {
      const inside = new Map();
      for (const parentId of parentsOf.get(classId) ?? []) {
        const name = simpleTypeName(classNodes.get(parentId)?.name);
        inside.set(name, (inside.get(name) ?? 0) + 1);
      }
      const outside = [];
      for (const supertype of cls.supertypes) {
        const name = simpleTypeName(supertype.type);
        const left = inside.get(name) ?? 0;
        if (left > 0) inside.set(name, left - 1);
        else outside.push(supertype.type.trim());
      }
      result = { known: true, outside: sortedUnique(outside) };
    }
    supertypeCache.set(classId, result);
    return result;
  };

  const closure = (startId, adjacency) => {
    const seen = new Set([startId]);
    const queue = [startId];
    for (let head = 0; head < queue.length; head++) {
      for (const next of adjacency.get(queue[head]) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return queue.slice(1);
  };

  const types = {};
  for (const classId of [...ownerIds].sort(compareText)) {
    const node = classNodes.get(classId);
    const cls = Array.isArray(node.lineRange) ? structure.classAt(node.filePath, node.name, node.lineRange[0]) : null;
    const own = supertypesOf(classId);
    const ancestors = closure(classId, parentsOf);
    const descendants = closure(classId, childrenOf);
    const outsideOf = (ids) => sortedUnique(ids.flatMap((id) => supertypesOf(id).outside));
    const unknown = new Set([classId, ...ancestors, ...descendants]);
    for (const id of [...unknown]) if (supertypesOf(id).known) unknown.delete(id);

    const referenced = [...(referencedBy.get(classId) ?? [])].sort((a, b) => byFileLine(a, b)
      || compareText(a.type, b.type) || compareText(a.source, b.source));
    const literals = [...(structure.annotationLiterals.get(simpleTypeName(node.name)) ?? [])].sort(byFileLine);
    const countOf = (type) => referenced.filter((r) => r.type === type).length;

    types[classId] = {
      name: node.name,
      file: node.filePath,
      annotations: arrayOrNull(cls?.annotations),
      outsideSupertypes: {
        own: own.known ? own.outside : null,
        ancestors: outsideOf(ancestors),
        descendants: outsideOf(descendants),
        unknown: unknown.size,
      },
      referencedBy: {
        references: countOf('references'),
        injects: countOf('injects'),
        mentions: countOf('mentions'),
        samples: referenced.slice(0, SAMPLE_LIMIT),
      },
      annotationClassLiterals: {
        count: literals.length,
        samples: literals.slice(0, SAMPLE_LIMIT),
      },
    };
  }
  return types;
}

// ---------------------------------------------------------------------------
// The product
// ---------------------------------------------------------------------------

/**
 * Build the unused-candidates product: the candidate set, clusters, per-candidate
 * features and the per-type signals. Pure — no filesystem, no clock.
 *
 * @param {{
 *   graph: { nodes: object[], edges: object[], factsDigest: string },
 *   structure: { results: object[] },
 *   sourceRevision: string,
 * }} inputs
 * @returns {object} the product (see the file header)
 */
export function buildUnusedCandidates({ graph, structure, sourceRevision }) {
  if (typeof graph?.factsDigest !== 'string' || graph.factsDigest === '') {
    throw new Error('unused-code: the fact graph carries no factsDigest');
  }
  if (typeof sourceRevision !== 'string' || sourceRevision === '') {
    throw new Error('unused-code: the source manifest carries no sourceRevision');
  }
  const set = computeCandidateSet(graph);
  const reachableIds = new Set();
  set.functionIds.forEach((id, i) => { if (set.reachable[i]) reachableIds.add(id); });
  assertConservation({ functionIds: set.functionIds, reachable: reachableIds, candidates: set.candidateIds });

  const index = indexStructure(structure);
  const nodeById = new Map();
  const classNodes = new Map();
  for (const node of graph.nodes) {
    if (typeof node?.id !== 'string') continue;
    nodeById.set(node.id, node);
    if (node.type === 'class') classNodes.set(node.id, node);
  }

  const byLanguage = new Map();
  const bucket = (language) => {
    const key = language ?? 'unknown';
    if (!byLanguage.has(key)) byLanguage.set(key, { functionNodes: 0, routeReachable: 0, candidates: 0, entries: 0, calls: 0 });
    return byLanguage.get(key);
  };

  // One pass over the edges for everything the class level needs, and for the calls per language.
  const functionIdSet = new Set(set.functionIds);
  const ownerOf = new Map();
  const parentsOf = new Map();
  const childrenOf = new Map();
  const referencedBy = new Map();
  const link = (map, key, value) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(value);
  };
  for (const edge of graph.edges) {
    const type = edge?.type;
    if (type === 'contains') {
      if (classNodes.has(edge.source) && nodeById.get(edge.target)?.type === 'function') {
        const previous = ownerOf.get(edge.target);
        if (previous === undefined || edge.source < previous) ownerOf.set(edge.target, edge.source);
      }
    } else if (type === 'inherits' || type === 'implements') {
      if (classNodes.has(edge.source) && classNodes.has(edge.target)) {
        link(parentsOf, edge.source, edge.target);
        link(childrenOf, edge.target, edge.source);
      }
    } else if (type === 'references' || type === 'injects' || type === 'mentions') {
      if (classNodes.has(edge.target)) {
        const first = Array.isArray(edge.evidence) ? edge.evidence[0] : null;
        if (!referencedBy.has(edge.target)) referencedBy.set(edge.target, []);
        referencedBy.get(edge.target).push({
          type,
          source: edge.source,
          file: typeof first?.file === 'string' ? first.file : null,
          line: Number.isInteger(first?.line) ? first.line : null,
        });
      }
    } else if (type === 'calls') {
      // Counted under the caller's language. A language with function nodes and no call edge here has no
      // call facts at all, and every function in it is then a candidate whatever calls it.
      if (functionIdSet.has(edge.source) && functionIdSet.has(edge.target)) {
        bucket(index.languageOf(nodeById.get(edge.source)?.filePath)).calls += 1;
      }
    }
  }

  set.functionIds.forEach((id, i) => {
    const counts = bucket(index.languageOf(nodeById.get(id).filePath));
    counts.functionNodes += 1;
    if (set.reachable[i]) counts.routeReachable += 1;
  });

  const ownerIds = new Set();
  let entries = 0;
  let unmatchedStructure = 0;
  const candidates = set.candidateIds.map((id, c) => {
    const node = nodeById.get(id);
    const lineRange = Array.isArray(node.lineRange) ? [...node.lineRange] : null;
    const fn = lineRange ? index.functionAt(node.filePath, node.name, lineRange[0], lineRange[1]) : null;
    if (!fn) unmatchedStructure += 1;
    const owner = ownerOf.get(id) ?? null;
    if (owner) ownerIds.add(owner);
    const counts = bucket(index.languageOf(node.filePath));
    counts.candidates += 1;
    if (set.entry[c]) {
      counts.entries += 1;
      entries += 1;
    }
    return {
      id,
      name: node.name,
      language: index.languageOf(node.filePath),
      file: node.filePath,
      lineRange,
      owner,
      visibility: typeof fn?.visibility === 'string' ? fn.visibility : null,
      modifiers: arrayOrNull(fn?.modifiers),
      annotations: arrayOrNull(fn?.annotations),
      entry: set.entry[c],
      component: set.component[c],
      referrers: set.referrers[c],
    };
  });

  const types = buildTypesTable({ ownerIds, classNodes, parentsOf, childrenOf, referencedBy, structure: index });
  const functionNodes = set.functionIds.length;
  const routeReachable = reachableIds.size;

  return {
    format: UNUSED_CANDIDATES_FORMAT,
    factsDigest: graph.factsDigest,
    sourceRevision,
    counts: {
      functionNodes,
      routeReachable,
      candidates: candidates.length,
      entries,
      entryComponents: set.entryComponents,
      clusters: set.clusters,
      unmatchedStructure,
      byLanguage: Object.fromEntries([...byLanguage].sort(([a], [b]) => compareText(a, b))),
    },
    conservation: { functionNodes, routeReachable, candidates: candidates.length, holds: true },
    types,
    candidates,
  };
}

// ---------------------------------------------------------------------------
// Name census (design D5)
// ---------------------------------------------------------------------------

const TOKEN = /[A-Za-z_$][A-Za-z0-9_$]*/g;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const NO_LINES = new Map();

/** Keep `samples` (sorted by file, then line; at most SAMPLE_LIMIT; one entry per line) the smallest ones seen. */
function addSample(samples, file, line) {
  if (samples.length === SAMPLE_LIMIT) {
    const last = samples[SAMPLE_LIMIT - 1];
    const order = compareText(file, last.file);
    if (order > 0 || (order === 0 && line >= last.line)) return;
  }
  let at = 0;
  while (at < samples.length) {
    const order = compareText(samples[at].file, file);
    if (order > 0 || (order === 0 && samples[at].line >= line)) break;
    at += 1;
  }
  if (at < samples.length && samples[at].file === file && samples[at].line === line) return;
  samples.splice(at, 0, { file, line });
  if (samples.length > SAMPLE_LIMIT) samples.pop();
}

/**
 * Every whole-token occurrence in `text` of a name in `counted`, as
 * name -> ascending line numbers (a line repeats once per occurrence on it).
 * Lines are 1-based and end at `\n`; a `$` or digit inside a token belongs to the
 * token, so `$foo` is not an occurrence of `foo`.
 *
 * @param {string} text
 * @param {Map<string, unknown>} counted
 * @returns {Map<string, number[]>}
 */
function occurrencesIn(text, counted) {
  const found = new Map();
  TOKEN.lastIndex = 0;
  let line = 1;
  let nextNewline = text.indexOf('\n');
  let match;
  while ((match = TOKEN.exec(text)) !== null) {
    if (!counted.has(match[0])) continue;
    while (nextNewline !== -1 && nextNewline < match.index) {
      line += 1;
      nextNewline = text.indexOf('\n', nextNewline + 1);
    }
    const lines = found.get(match[0]);
    if (lines) lines.push(line);
    else found.set(match[0], [line]);
  }
  return found;
}

/** Index of the first element of the ascending array `lines` that is >= `line`. */
function lowerBound(lines, line) {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (lines[mid] < line) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Sorted, merged `[start, end, start, end, ...]` from `[start, end]` pairs. */
function mergeRanges(pairs) {
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const flat = [];
  for (const [start, end] of pairs) {
    const last = flat.length - 1;
    if (last >= 0 && start <= flat[last] + 1) {
      if (end > flat[last]) flat[last] = end;
    } else {
      flat.push(start, end);
    }
  }
  return flat;
}

function inRanges(flat, line) {
  let low = 0;
  let high = flat.length / 2;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (flat[2 * mid + 1] < line) low = mid + 1;
    else high = mid;
  }
  return low < flat.length / 2 && flat[2 * low] <= line;
}

/**
 * The name census: for every candidate with a plain-identifier name, how many
 * times that name occurs in `files` outside what the facts explain.
 *
 * An occurrence of a candidate's name at (file, line) is explained when it lies
 * in the line range of one of its direct referrers (a self-call included) in that
 * file, or on the candidate's own declaration line: the first line within its
 * range where the name occurs, at most one occurrence there. Everything else is
 * "elsewhere". Elsewhere is an exact count; `samples` keeps the first five lines
 * in (file, line) order. `sameNameDeclarationsOnly` says that every elsewhere
 * occurrence is on the declaration line of another function or class node with
 * the same name.
 *
 * Pure: `files` is any iterable of `{ path, text, fromSnapshot? }`, consumed one
 * file at a time (`text: null` marks a skipped binary file), so the caller can
 * stream the files from disk. `nodes` are the graph's nodes; the function and
 * class nodes among them (and the candidates themselves) give the declaration
 * lines.
 *
 * @param {{
 *   candidates: Array<{ id: string, name: string, file: string, lineRange: number[] | null, referrers: Array<{ id: string }> }>,
 *   nodes?: object[],
 *   files: Iterable<{ path: string, text: string | null, fromSnapshot?: boolean }>,
 * }} inputs
 * @returns {{
 *   byCandidate: Array<null | { elsewhere: number, samples: Array<{ file: string, line: number }>, sameNameDeclarationsOnly: boolean }>,
 *   header: { files: number, filesSkippedBinary: number, filesReadFromSnapshot: number, namesNotIdentifiers: number,
 *             candidatesWithElsewhere: number, sameNameDeclarationsOnly: number },
 * }}
 */
export function computeCensus({ candidates, nodes = [], files }) {
  const n = candidates.length;
  const byName = new Map();
  let namesNotIdentifiers = 0;
  const identifierNamed = new Array(n).fill(false);
  candidates.forEach((candidate, i) => {
    if (typeof candidate.name !== 'string' || !IDENTIFIER.test(candidate.name)) {
      namesNotIdentifiers += 1;
      return;
    }
    identifierNamed[i] = true;
    if (!byName.has(candidate.name)) byName.set(candidate.name, []);
    byName.get(candidate.name).push(i);
  });

  // Declarations that carry a counted name, by file: file -> name -> [{ id, start, end }].
  const declarations = new Map();
  const declared = new Set();
  const declare = (id, type, name, file, lineRange) => {
    if ((type !== 'function' && type !== 'class') || typeof id !== 'string' || !byName.has(name) || typeof file !== 'string'
      || !Array.isArray(lineRange) || declared.has(id)) return;
    declared.add(id);
    if (!declarations.has(file)) declarations.set(file, new Map());
    const byNameHere = declarations.get(file);
    if (!byNameHere.has(name)) byNameHere.set(name, []);
    byNameHere.get(name).push({ id, start: lineRange[0], end: lineRange[1] });
  };
  for (const node of nodes) declare(node?.id, node?.type, node?.name, node?.filePath, node?.lineRange);
  for (const candidate of candidates) declare(candidate.id, 'function', candidate.name, candidate.file, candidate.lineRange);

  // Per candidate: the line ranges of its direct referrers, by file.
  const indexById = new Map(candidates.map((candidate, i) => [candidate.id, i]));
  const referrerRanges = candidates.map((candidate, i) => {
    if (!identifierNamed[i] || candidate.referrers.length === 0) return new Map();
    const pairsByFile = new Map();
    for (const { id } of candidate.referrers) {
      const referrer = candidates[indexById.get(id)];
      if (!referrer || !Array.isArray(referrer.lineRange)) continue;
      if (!pairsByFile.has(referrer.file)) pairsByFile.set(referrer.file, []);
      pairsByFile.get(referrer.file).push([referrer.lineRange[0], referrer.lineRange[1]]);
    }
    return new Map([...pairsByFile].map(([file, pairs]) => [file, mergeRanges(pairs)]));
  });

  const elsewhere = new Array(n).fill(0);
  const samples = candidates.map(() => []);
  const onlyDeclarations = new Uint8Array(n).fill(1);
  const header = { files: 0, filesSkippedBinary: 0, filesReadFromSnapshot: 0, namesNotIdentifiers, candidatesWithElsewhere: 0, sameNameDeclarationsOnly: 0 };

  for (const file of files) {
    header.files += 1;
    if (file.fromSnapshot) header.filesReadFromSnapshot += 1;
    if (file.text === null) {
      header.filesSkippedBinary += 1;
      continue;
    }
    const found = occurrencesIn(file.text, byName);
    const declaredHere = declarations.get(file.path);
    for (const [name, lines] of found) {
      // Declaration lines of the nodes named `name` in this file.
      const declaredNodes = declaredHere?.get(name);
      const lineOf = declaredNodes ? new Map() : NO_LINES;
      const idsOnLine = declaredNodes ? new Map() : NO_LINES;
      for (const { id, start, end } of declaredNodes ?? []) {
        const at = lowerBound(lines, start);
        if (at >= lines.length || lines[at] > end) continue;
        lineOf.set(id, lines[at]);
        if (!idsOnLine.has(lines[at])) idsOnLine.set(lines[at], []);
        idsOnLine.get(lines[at]).push(id);
      }
      let everyOccurrenceOnDeclaration;

      for (const i of byName.get(name)) {
        const candidate = candidates[i];
        const ranges = referrerRanges[i].get(file.path);
        const own = candidate.file === file.path;
        if (!own && !ranges) {
          // Nothing explains any occurrence in this file.
          elsewhere[i] += lines.length;
          let added = 0;
          for (let k = 0; k < lines.length && added < SAMPLE_LIMIT; k++) {
            if (k > 0 && lines[k] === lines[k - 1]) continue;
            addSample(samples[i], file.path, lines[k]);
            added += 1;
          }
          if (onlyDeclarations[i]) {
            everyOccurrenceOnDeclaration ??= lines.every((line) => idsOnLine.has(line));
            if (!everyOccurrenceOnDeclaration) onlyDeclarations[i] = 0;
          }
          continue;
        }
        const declarationLine = own ? lineOf.get(candidate.id) : undefined;
        let declarationUsed = false;
        for (const line of lines) {
          if (ranges && inRanges(ranges, line)) continue;
          if (line === declarationLine && !declarationUsed) {
            declarationUsed = true;
            continue;
          }
          elsewhere[i] += 1;
          addSample(samples[i], file.path, line);
          if (onlyDeclarations[i]) {
            const here = idsOnLine.get(line);
            if (!here || !here.some((id) => id !== candidate.id)) onlyDeclarations[i] = 0;
          }
        }
      }
    }
  }

  const byCandidate = candidates.map((_, i) => {
    if (!identifierNamed[i]) return null;
    const sameName = elsewhere[i] > 0 && onlyDeclarations[i] === 1;
    if (elsewhere[i] > 0) header.candidatesWithElsewhere += 1;
    return { elsewhere: elsewhere[i], samples: samples[i], sameNameDeclarationsOnly: sameName };
  });
  header.sameNameDeclarationsOnly = byCandidate.filter((census) => census?.sameNameDeclarationsOnly).length;
  return { byCandidate, header };
}

/**
 * The product with the census added: `census` on every candidate and the header
 * block after `conservation`. Pure apart from consuming `files`.
 *
 * @param {{ product: object, nodes?: object[], files: Iterable<object> }} inputs
 * @returns {object}
 */
export function addCensus({ product, nodes, files }) {
  const { byCandidate, header } = computeCensus({ candidates: product.candidates, nodes, files });
  return {
    format: product.format,
    factsDigest: product.factsDigest,
    sourceRevision: product.sourceRevision,
    counts: product.counts,
    conservation: product.conservation,
    census: header,
    types: product.types,
    candidates: product.candidates.map((candidate, i) => ({ ...candidate, census: byCandidate[i] })),
  };
}

// ---------------------------------------------------------------------------
// Reading the selected files
// ---------------------------------------------------------------------------

const isInside = (root, target) => {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

/** The working-tree bytes of `path` when it is a canonical, in-root, regular file; otherwise null. */
function readWorkingTree(root, path) {
  try {
    canonicalSourcePath(path);
    const absolute = join(root, path);
    if (!lstatSync(absolute).isFile() || !isInside(root, realpathSync(absolute))) return null;
    return readFileSync(absolute);
  } catch {
    return null;
  }
}

/**
 * Yield every file the manifest selects, with the content the facts were built
 * from: the working-tree file when its hash matches the manifest, otherwise the
 * source snapshot's copy (one snapshot, resolved on first need) when that
 * matches; any other case throws and the census fails. A file with a NUL byte
 * yields `text: null`.
 *
 * @param {string} root canonical project root
 * @param {Array<{ path: string, contentHash: string }>} entries
 * @returns {Generator<{ path: string, text: string | null, fromSnapshot: boolean }>}
 */
export function* readSelectedFiles(root, entries) {
  let snapshot = null;
  for (const { path, contentHash: expected } of entries) {
    let bytes = readWorkingTree(root, path);
    let fromSnapshot = false;
    if (bytes === null || contentHash(bytes) !== expected) {
      snapshot ??= resolveSourceSnapshot(root);
      try {
        bytes = snapshot.readFile(path);
      } catch {
        bytes = null;
      }
      fromSnapshot = true;
    }
    if (bytes === null || contentHash(bytes) !== expected) {
      throw new Error(`source differs from the facts (${path}); run Lazy again`);
    }
    yield { path, text: bytes.includes(0) ? null : bytes.toString('utf-8'), fromSnapshot };
  }
}

// ---------------------------------------------------------------------------
// Report (design D3, D4, D6, D7)
// ---------------------------------------------------------------------------

/** Stamped on the report product header. An incompatible shape change bumps it. */
export const UNUSED_CODE_FORMAT = 'excavator-unused-code/1';

/** The report product's file name, inside `.excavator/`. */
export const UNUSED_CODE_FILE = 'unused-code.json';

/** The decisions file's default name, inside `.excavator/`; the host skill writes it. */
export const UNUSED_DECISIONS_FILE = 'unused-decisions.json';

const RESIDUAL_ASSUMPTIONS = [
  'Files the source manifest did not select take no part in the name census.',
  'Reflection on names assembled at run time is invisible.',
  'Code generated at build time and absent from the repository is invisible.',
  'Callers outside the repository show only through visibility: a non-private member may be called from outside.',
  'Uses that do not spell the method name are invisible to the name census: a property `foo` bound to `getFoo` or `setFoo` by a view, a template or a JSON mapping, or any other name derived by convention.',
  'Calls the fact graph could not resolve have no edge; its gaps (`calls-unresolved`, `calls-ambiguous`, `calls-caller-unresolved`, `override-uncertain`) count them. `reason` states what the facts hold, and the name census is what keeps a method called that way out of `high`.',
];

const DECISION_KINDS = ['entry', 'test-entry'];
const DECISION_KEYS = ['kind', 'reason', 'query', 'ids'];
const DECISIONS_DOCUMENT_KEYS = ['factsDigest', 'decisions'];

/** At most this many offending ids are named in one error; the total is always stated next to them. */
const NAMED_LIMIT = 20;

/** Node status in the report; 0 is "unused" so a fresh array starts there. */
const UNUSED = 0;
const REMOVED = 1;
const TEST_ONLY = 2;

/** Confidence levels in rank order: a node is never above a node that references it. */
const LEVELS = ['low', 'medium', 'high'];
const LOW = 0;
const MEDIUM = 1;
const HIGH = 2;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const nonEmpty = (value) => Array.isArray(value) && value.length > 0;
const shown = (value) => (typeof value === 'string' ? value : String(JSON.stringify(value)));
const namedList = (items, total) => `${items.join('; ')}${total > items.length ? `; ... and ${total - items.length} more` : ''}`;

/**
 * The three outcome sets and the candidate set must partition: pairwise
 * disjoint, union exactly the candidates. Throws a descriptive Error with the
 * counts and the offending ids otherwise.
 *
 * @param {{ candidateIds: Iterable<string>, removed: Iterable<string>, testOnly: Iterable<string>, unused: Iterable<string> }} sets
 */
export function assertReportConservation({ candidateIds, removed, testOnly, unused }) {
  const asSet = (values) => (values instanceof Set ? values : new Set(values));
  const all = asSet(candidateIds);
  const outcomes = [asSet(removed), asSet(testOnly), asSet(unused)];
  const missing = [];
  const overlapping = [];
  const stray = [];
  for (const id of all) {
    const holders = outcomes.filter((set) => set.has(id)).length;
    if (holders === 0) missing.push(id);
    else if (holders > 1) overlapping.push(id);
  }
  for (const set of outcomes) for (const id of set) if (!all.has(id)) stray.push(id);

  const problems = [];
  const show = (ids) => `${ids.slice(0, 5).join(', ')}${ids.length > 5 ? `, ... (${ids.length} in all)` : ''}`;
  if (missing.length > 0) problems.push(`${missing.length} candidate(s) in none of the removed, test-only and unused sets: ${show(missing)}`);
  if (overlapping.length > 0) problems.push(`${overlapping.length} candidate(s) in more than one of them: ${show(overlapping)}`);
  if (stray.length > 0) problems.push(`${stray.length} id(s) in those sets that are not candidates: ${show(stray)}`);
  if (problems.length > 0) {
    throw new Error(`unused-code report conservation violated: candidates=${all.size}, removedByDecision=${outcomes[0].size}, `
      + `testOnly=${outcomes[1].size}, unused=${outcomes[2].size}; ${problems.join('; ')}`);
  }
}

// ---- The candidates product as input ----

const isStringOrNull = (value) => value === null || typeof value === 'string';
const isArrayOrNull = (value) => value === null || Array.isArray(value);
const CANDIDATE_FIELDS = {
  id: (v) => typeof v === 'string' && v !== '',
  name: (v) => typeof v === 'string',
  language: isStringOrNull,
  file: (v) => typeof v === 'string',
  lineRange: isArrayOrNull,
  owner: isStringOrNull,
  visibility: isStringOrNull,
  modifiers: isArrayOrNull,
  annotations: isArrayOrNull,
  entry: (v) => typeof v === 'boolean',
  component: Number.isInteger,
  referrers: (v) => Array.isArray(v) && v.every((r) => isPlainObject(r) && typeof r.id === 'string'),
  census: (v) => v === null || (isPlainObject(v) && Number.isInteger(v.elsewhere) && Array.isArray(v.samples)),
};

const TYPE_FIELDS = {
  annotations: isArrayOrNull,
  outsideSupertypes: (v) => isPlainObject(v) && isArrayOrNull(v.own) && Array.isArray(v.ancestors)
    && Array.isArray(v.descendants) && Number.isInteger(v.unknown),
  referencedBy: (v) => isPlainObject(v) && Number.isInteger(v.references) && Number.isInteger(v.injects)
    && Number.isInteger(v.mentions) && Array.isArray(v.samples),
  annotationClassLiterals: (v) => isPlainObject(v) && Number.isInteger(v.count) && Array.isArray(v.samples),
};

function checkCandidateRecord(candidate, position) {
  const label = isPlainObject(candidate) && typeof candidate.id === 'string' ? ` (${candidate.id})` : '';
  if (!isPlainObject(candidate)) throw new Error(`candidate ${position}: not an object`);
  for (const [field, valid] of Object.entries(CANDIDATE_FIELDS)) {
    if (!valid(candidate[field])) throw new Error(`candidate ${position}${label}: ${field} is missing or malformed`);
  }
}

/** The candidates, validated, in id order. The report works in this index space whatever the input order. */
function orderedCandidates(product) {
  if (!Array.isArray(product.candidates)) throw new Error('the candidates product has no "candidates" array');
  if (!isPlainObject(product.types)) throw new Error('the candidates product has no "types" table');
  product.candidates.forEach(checkCandidateRecord);
  const ordered = [...product.candidates].sort((a, b) => compareText(a.id, b.id));
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].id === ordered[i - 1].id) throw new Error(`the candidates product lists ${ordered[i].id} twice`);
  }
  return ordered;
}

/** The owner's row in the types table, shape-checked once per type; null for a candidate without an owner. */
function ownerTypeFor(candidate, types, checked) {
  if (candidate.owner === null) return null;
  const type = Object.hasOwn(types, candidate.owner) ? types[candidate.owner] : undefined;
  if (!isPlainObject(type)) throw new Error(`candidate ${candidate.id}: owner ${candidate.owner} is not in the types table`);
  if (!checked.has(candidate.owner)) {
    for (const [field, valid] of Object.entries(TYPE_FIELDS)) {
      if (!valid(type[field])) throw new Error(`types[${candidate.owner}]: ${field} is missing or malformed`);
    }
    checked.add(candidate.owner);
  }
  return type;
}

/**
 * The per-language rows of the report, started from the candidates header: one per language the header
 * counts (candidates and calls copied), the unused counts at zero. A header without those rows is a product
 * from before the call counts or a damaged one, and it is refused: without `calls` a language the fact graph
 * has no call edges for would look like any other.
 */
function languageRowsOf(product) {
  const header = product.counts?.byLanguage;
  const refuse = (why) => new Error(`the candidates product predates per-language call counts or is malformed (${why}); re-run "node skills/excavator/unused-code.mjs candidates <projectRoot>"`);
  if (!isPlainObject(header)) throw refuse('counts.byLanguage is missing or not an object');
  const rows = new Map();
  for (const [language, row] of Object.entries(header)) {
    if (!isPlainObject(row)) throw refuse(`counts.byLanguage.${language} is not an object`);
    for (const field of ['candidates', 'calls']) {
      if (!Number.isInteger(row[field]) || row[field] < 0) {
        throw refuse(`counts.byLanguage.${language}.${field} is ${shown(row[field])}, not a non-negative integer`);
      }
    }
    rows.set(language, { candidates: row.candidates, calls: row.calls, unused: 0, high: 0, medium: 0, low: 0 });
  }
  return rows;
}

// ---- The decisions file (design D4) ----

/**
 * Validate the decisions document in the order the spec lists the rejections:
 * the digest it was made on, its shape, ids that are not candidates, ids named
 * twice. Returns the candidate indexes each kind names.
 */
function checkDecisions({ decisions, candidatesDigest, indexOf }) {
  if (!isPlainObject(decisions)) throw new Error('the decisions file must hold a JSON object');
  if (decisions.factsDigest !== candidatesDigest) {
    throw new Error(`the decisions were made on another candidate set (candidates ${candidatesDigest} vs decisions ${shown(decisions.factsDigest)}); redo the decisions`);
  }
  for (const key of Object.keys(decisions)) {
    if (!DECISIONS_DOCUMENT_KEYS.includes(key)) throw new Error(`the decisions file has an unknown key "${key}"`);
  }
  if (!Array.isArray(decisions.decisions)) throw new Error('the decisions file: "decisions" must be an array');

  decisions.decisions.forEach((decision, i) => {
    if (!isPlainObject(decision)) throw new Error(`decision ${i}: must be an object`);
    for (const key of Object.keys(decision)) {
      if (!DECISION_KEYS.includes(key)) throw new Error(`decision ${i}: unknown key "${key}"`);
    }
    if (!DECISION_KINDS.includes(decision.kind)) throw new Error(`decision ${i}: kind must be "entry" or "test-entry"`);
    if (!isNonEmptyString(decision.reason)) throw new Error(`decision ${i}: reason must be a non-empty string`);
    if (!isNonEmptyString(decision.query)) throw new Error(`decision ${i}: query must be a non-empty string`);
    if (!nonEmpty(decision.ids)) throw new Error(`decision ${i}: ids must be a non-empty array of strings`);
    const bad = decision.ids.findIndex((id) => typeof id !== 'string');
    if (bad >= 0) throw new Error(`decision ${i}: ids must be a non-empty array of strings (ids[${bad}] is not a string)`);
  });

  const unknown = [];
  let unknownTotal = 0;
  const firstDecision = new Map();
  const repeated = [];
  let repeatedTotal = 0;
  const seeds = { entry: [], 'test-entry': [] };
  decisions.decisions.forEach((decision, i) => {
    for (const id of decision.ids) {
      const index = indexOf.get(id);
      if (index === undefined) {
        unknownTotal += 1;
        if (unknown.length < NAMED_LIMIT) unknown.push(`decision ${i}: ${id}`);
        continue;
      }
      seeds[decision.kind].push(index);
      if (!firstDecision.has(id)) {
        firstDecision.set(id, i);
      } else if (firstDecision.get(id) !== -1) {
        // Report an id once, however often it repeats.
        repeatedTotal += 1;
        if (repeated.length < NAMED_LIMIT) {
          const first = firstDecision.get(id);
          repeated.push(`${id} (${first === i ? `twice in decision ${i}` : `decisions ${first} and ${i}`})`);
        }
        firstDecision.set(id, -1);
      }
    }
  });
  if (unknownTotal > 0) {
    throw new Error(`${unknownTotal} decision id(s) are not candidates: ${namedList(unknown, unknownTotal)}`);
  }
  if (repeatedTotal > 0) {
    throw new Error(`${repeatedTotal} id(s) appear more than once in the decisions: ${namedList(repeated, repeatedTotal)}`);
  }
  return { entrySeeds: seeds.entry, testSeeds: seeds['test-entry'] };
}

// ---- Confidence (design D6) ----

/**
 * The fixed rules, in table order. Every signal that holds is emitted; the
 * node's own confidence is the lowest level among them (`high` when none).
 *
 * @returns {{ level: number, signals: object[] }}
 */
function ownConfidence(candidate, type) {
  const found = [];
  const add = (level, signal, detail) => found.push({ level, signal: { signal, ...detail } });
  const { census, visibility, annotations } = candidate;
  const o = type?.outsideSupertypes;
  const ownOutside = o && nonEmpty(o.own);
  const ancestorsOutside = o && nonEmpty(o.ancestors);

  if (census !== null && census.elsewhere > 0) {
    add(LOW, 'name-elsewhere', { count: census.elsewhere, samples: census.samples, sameNameDeclarationsOnly: census.sameNameDeclarationsOnly });
  }
  if (type) {
    const { references, injects, mentions, samples } = type.referencedBy;
    if (references + injects + mentions > 0) add(LOW, 'owner-referenced', { references, injects, mentions, samples });
    if (type.annotationClassLiterals.count > 0) {
      add(LOW, 'owner-class-literal', { count: type.annotationClassLiterals.count, samples: type.annotationClassLiterals.samples });
    }
    if (visibility !== 'private' && !(candidate.modifiers ?? []).includes('static')
      && (ownOutside || ancestorsOutside || nonEmpty(o.descendants))) {
      add(LOW, 'visible-with-outside-supertype', { own: o.own ?? [], ancestors: o.ancestors, descendants: o.descendants });
    }
  }
  if (census === null) add(MEDIUM, 'census-unknown', {});
  if (visibility === null) add(MEDIUM, 'visibility-unknown', {});
  if (visibility !== null && visibility !== 'private') add(MEDIUM, 'not-private', { visibility });
  if (annotations === null) add(MEDIUM, 'annotations-unknown', {});
  if (nonEmpty(annotations)) add(MEDIUM, 'annotated', { annotations });
  if (type) {
    if (type.annotations === null) add(MEDIUM, 'owner-annotations-unknown', {});
    if (nonEmpty(type.annotations)) add(MEDIUM, 'owner-annotated', { annotations: type.annotations });
    if (o.own === null || o.unknown > 0) add(MEDIUM, 'owner-hierarchy-unknown', { unknown: o.unknown });
    if (ownOutside || ancestorsOutside) add(MEDIUM, 'owner-outside-supertype', { own: o.own ?? [], ancestors: o.ancestors });
  }

  return { level: found.reduce((lowest, { level }) => Math.min(lowest, level), HIGH), signals: found.map(({ signal }) => signal) };
}

// ---- The report ----

/**
 * Apply the decisions to the candidate set and compute the unused code, its
 * groups and its confidence. Pure — no filesystem, no clock; every input rule
 * is checked here, so a violation throws before anything is produced.
 *
 * @param {{
 *   candidates: object,
 *   decisions: object,
 *   decisionsDigest: string,
 *   factsDigest: string,
 * }} inputs `candidates` is the parsed candidates product, `decisions` the parsed
 *   decisions document, `decisionsDigest` the sha256 hex of the decisions file's
 *   bytes, `factsDigest` the digest of the current fact graph.
 * @returns {object} the report product (see the file header)
 */
export function buildUnusedReport({ candidates, decisions, decisionsDigest, factsDigest }) {
  if (!isNonEmptyString(factsDigest)) throw new Error('the current fact graph carries no factsDigest');
  if (!isNonEmptyString(decisionsDigest)) throw new Error('the decisions digest is missing');
  if (!isPlainObject(candidates) || candidates.format !== UNUSED_CANDIDATES_FORMAT) {
    throw new Error(`the candidates product is not in format ${UNUSED_CANDIDATES_FORMAT} (found ${shown(candidates?.format)})`);
  }
  if (candidates.factsDigest !== factsDigest) {
    throw new Error(`the candidate set is stale (facts ${factsDigest} vs candidates ${shown(candidates.factsDigest)}); run "unused-code.mjs candidates" again`);
  }
  const languages = languageRowsOf(candidates);

  const ordered = orderedCandidates(candidates);
  const n = ordered.length;
  const ids = ordered.map((candidate) => candidate.id);
  const indexOf = new Map(ids.map((id, i) => [id, i]));
  const { entrySeeds, testSeeds } = checkDecisions({ decisions, candidatesDigest: candidates.factsDigest, indexOf });

  // Reference edges, referrer -> referenced, in the candidates' own index space.
  let edgeCount = 0;
  for (const candidate of ordered) edgeCount += candidate.referrers.length;
  const from = new Int32Array(edgeCount);
  const to = new Int32Array(edgeCount);
  let e = 0;
  ordered.forEach((candidate, v) => {
    for (const referrer of candidate.referrers) {
      const u = indexOf.get(referrer.id);
      if (u === undefined) throw new Error(`candidate ${candidate.id} names the referrer ${referrer.id}, which is not a candidate`);
      from[e] = u;
      to[e] = v;
      e += 1;
    }
  });

  // Decisions only remove: reachability from the entries, then from the test entries.
  const references = buildCsr(n, from, to, new Uint8Array(edgeCount));
  const reachedFromEntries = reachableFrom(n, references, entrySeeds);
  const reachedFromTests = reachableFrom(n, references, testSeeds);
  const status = new Uint8Array(n);
  const removedIds = new Set();
  const testOnlyIds = new Set();
  const unusedIds = new Set();
  for (let v = 0; v < n; v++) {
    if (reachedFromEntries[v]) {
      status[v] = REMOVED;
      removedIds.add(ids[v]);
    } else if (reachedFromTests[v]) {
      status[v] = TEST_ONLY;
      testOnlyIds.add(ids[v]);
    } else {
      unusedIds.add(ids[v]);
    }
  }
  assertReportConservation({ candidateIds: ids, removed: removedIds, testOnly: testOnlyIds, unused: unusedIds });

  // Invariants of a well-formed candidate product. Nothing but a corrupt input breaks them.
  const external = new Uint8Array(n);
  for (let k = 0; k < edgeCount; k++) {
    const u = from[k];
    const v = to[k];
    if (status[v] !== UNUSED) continue;
    if (status[u] !== UNUSED) throw new Error(`candidate ${ids[v]} is unused but its referrer ${ids[u]} is not`);
    if (ordered[u].component !== ordered[v].component) external[v] = 1;
  }
  // `entry` is a property of the component. A node of an entry component has no referrer outside it;
  // a non-entry component has some member with one (not every member: a member may be referenced
  // only from inside its component).
  const components = new Map();
  for (let v = 0; v < n; v++) {
    if (status[v] !== UNUSED) continue;
    const { entry, component } = ordered[v];
    if (entry && external[v]) throw new Error(`candidate ${ids[v]} is an entry but has a referrer outside its component`);
    const state = components.get(component);
    if (!state) {
      components.set(component, { entry, external: external[v] === 1, member: ids[v] });
    } else {
      if (state.entry !== entry) throw new Error(`candidates ${state.member} and ${ids[v]} share component ${component} but disagree on entry`);
      if (external[v]) state.external = true;
    }
  }
  for (const [component, state] of components) {
    if (!state.entry && !state.external) {
      throw new Error(`component ${component} (${state.member}) is not an entry but none of its members has a referrer outside it`);
    }
  }

  // Groups: weakly connected components of the unused nodes under the references.
  const parent = new Int32Array(n);
  for (let v = 0; v < n; v++) parent[v] = v;
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let k = 0; k < edgeCount; k++) {
    if (status[from[k]] !== UNUSED || status[to[k]] !== UNUSED) continue;
    const a = find(from[k]);
    const b = find(to[k]);
    if (a !== b) parent[a] = b;
  }
  // Ascending id order: a group is numbered when its smallest member is met.
  const groupOfRoot = new Map();
  const groupOf = new Int32Array(n).fill(-1);
  const groups = [];
  for (let v = 0; v < n; v++) {
    if (status[v] !== UNUSED) continue;
    const root = find(v);
    if (!groupOfRoot.has(root)) {
      groupOfRoot.set(root, groups.length);
      groups.push({ group: groups.length, entries: [], members: [] });
    }
    const group = groups[groupOfRoot.get(root)];
    groupOf[v] = group.group;
    group.members.push(ids[v]);
    if (ordered[v].entry) group.entries.push(ids[v]);
  }
  for (const group of groups) {
    if (group.entries.length === 0) throw new Error(`group ${group.group} (${group.members[0]}) has no entry`);
  }

  // Confidence: own rules per node, then the cap over the condensation DAG (component = SCC).
  const checkedTypes = new Set();
  const own = new Uint8Array(n);
  const signals = new Array(n);
  const denseOf = new Map();
  const componentOf = new Int32Array(n).fill(-1);
  for (let v = 0; v < n; v++) {
    if (status[v] !== UNUSED) continue;
    const candidate = ordered[v];
    const result = ownConfidence(candidate, ownerTypeFor(candidate, candidates.types, checkedTypes));
    own[v] = result.level;
    signals[v] = result.signals;
    if (!denseOf.has(candidate.component)) denseOf.set(candidate.component, denseOf.size);
    componentOf[v] = denseOf.get(candidate.component);
  }
  const componentCount = denseOf.size;
  const finalOfComponent = new Uint8Array(componentCount).fill(HIGH);
  for (let v = 0; v < n; v++) {
    if (status[v] === UNUSED && own[v] < finalOfComponent[componentOf[v]]) finalOfComponent[componentOf[v]] = own[v];
  }
  const crossFrom = [];
  const crossTo = [];
  for (let k = 0; k < edgeCount; k++) {
    if (status[to[k]] !== UNUSED || componentOf[from[k]] === componentOf[to[k]]) continue;
    crossFrom.push(componentOf[from[k]]);
    crossTo.push(componentOf[to[k]]);
  }
  const downstream = buildCsr(componentCount, crossFrom, crossTo, new Uint8Array(crossFrom.length));
  const waiting = new Int32Array(componentCount);
  for (const target of crossTo) waiting[target] += 1;
  const queue = new Int32Array(componentCount);
  let tail = 0;
  for (let c = 0; c < componentCount; c++) if (waiting[c] === 0) queue[tail++] = c;
  for (let head = 0; head < tail; head++) {
    const c = queue[head];
    for (let slot = downstream.offsets[c]; slot < downstream.offsets[c + 1]; slot++) {
      const next = downstream.targets[slot];
      if (finalOfComponent[c] < finalOfComponent[next]) finalOfComponent[next] = finalOfComponent[c];
      waiting[next] -= 1;
      if (waiting[next] === 0) queue[tail++] = next;
    }
  }
  if (tail !== componentCount) {
    throw new Error(`the component field is inconsistent: the references between components of unused nodes are cyclic (${componentCount - tail} component(s) never became ready)`);
  }

  const unused = [];
  const finalOf = (v) => finalOfComponent[componentOf[v]];
  for (let v = 0; v < n; v++) {
    if (status[v] !== UNUSED) continue;
    const candidate = ordered[v];
    const level = finalOf(v);
    const nodeSignals = signals[v];
    if (level < own[v]) {
      let by = null;
      for (const referrer of candidate.referrers) {
        const u = indexOf.get(referrer.id);
        if (u !== v && finalOf(u) === level && (by === null || compareText(referrer.id, by) < 0)) by = referrer.id;
      }
      if (by === null) throw new Error(`candidate ${candidate.id} is capped to ${LEVELS[level]} but no referrer carries that level`);
      nodeSignals.push({ signal: 'capped', from: LEVELS[own[v]], by });
    }
    unused.push({
      id: candidate.id,
      name: candidate.name,
      language: candidate.language,
      file: candidate.file,
      lineRange: candidate.lineRange,
      owner: candidate.owner,
      visibility: candidate.visibility,
      reason: candidate.entry ? 'unreferenced' : 'only-reachable-from-unused',
      referrers: candidate.referrers,
      group: groupOf[v],
      confidence: LEVELS[level],
      signals: nodeSignals,
    });
  }

  const byConfidence = { high: 0, medium: 0, low: 0 };
  let unreferenced = 0;
  for (const node of unused) {
    byConfidence[node.confidence] += 1;
    if (node.reason === 'unreferenced') unreferenced += 1;
    const key = node.language ?? 'unknown';
    const row = languages.get(key);
    if (!row) throw new Error(`candidate ${node.id} is unused but its language ${key} has no row in counts.byLanguage of the candidates product`);
    row.unused += 1;
    row[node.confidence] += 1;
  }
  const testOnly = [];
  for (let v = 0; v < n; v++) {
    if (status[v] !== TEST_ONLY) continue;
    const { id, name, language, file, lineRange } = ordered[v];
    testOnly.push({ id, name, language, file, lineRange });
  }

  return {
    format: UNUSED_CODE_FORMAT,
    factsDigest,
    decisionsDigest,
    sourceRevision: candidates.sourceRevision,
    counts: {
      candidates: n,
      removedByDecision: removedIds.size,
      testOnly: testOnly.length,
      unused: unused.length,
      unreferenced,
      onlyReachableFromUnused: unused.length - unreferenced,
      groups: groups.length,
      byConfidence,
      byLanguage: Object.fromEntries([...languages].sort(([a], [b]) => compareText(a, b))),
    },
    conservation: { candidates: n, removedByDecision: removedIds.size, testOnly: testOnly.length, unused: unused.length, holds: true },
    residualAssumptions: [...RESIDUAL_ASSUMPTIONS],
    decisions: decisions.decisions.map(({ kind, reason, query, ids: named }) => ({ kind, reason, query, hits: named.length, ids: named })),
    unused,
    groups,
    testOnly,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = 'Usage: node unused-code.mjs candidates <projectRoot>\n'
  + '       node unused-code.mjs report <projectRoot> [--decisions <file>]\n';

function readInputs(root) {
  assertDataTree(root);
  const dataDir = assertDataDir(root);
  const paths = {
    graph: join(dataDir, 'intermediate', 'fact-graph.jsonl'),
    structure: join(dataDir, 'intermediate', 'structure-all.jsonl'),
    manifest: join(dataDir, 'source-manifest.json'),
  };
  for (const [what, path] of Object.entries(paths)) {
    if (!existsSync(path)) {
      throw new Error(`missing input ${path} (${what}); run /excavator lazy on this project first`);
    }
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(paths.manifest, 'utf-8'));
  } catch (error) {
    throw new Error(`${paths.manifest}: not valid JSON (${error.message})`);
  }
  const entries = manifest?.entries;
  if (!Array.isArray(entries) || !entries.every((e) => typeof e?.path === 'string' && typeof e?.contentHash === 'string')) {
    throw new Error(`${paths.manifest}: "entries" must be an array of { path, contentHash }`);
  }
  return {
    graph: readKnowledgeGraph(paths.graph),
    structure: readStructureAll(paths.structure),
    sourceRevision: manifest?.sourceRevision,
    entries,
  };
}

/** Write `text` to `path` through a sibling temporary file, so a reader never sees a half-written product. */
function writeAtomic(path, text) {
  const tmpPath = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tmpPath, text, 'utf-8');
    renameSync(tmpPath, path);
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw error;
  }
}

/** `{ command, root, decisions }` for a recognised argv shape, null otherwise. */
function parseArgs(argv) {
  const [command, root, ...rest] = argv;
  if (!root || root.startsWith('--')) return null;
  if (command === 'candidates') return rest.length === 0 ? { command, root } : null;
  if (command !== 'report') return null;
  if (rest.length === 0) return { command, root, decisions: null };
  if (rest.length === 2 && rest[0] === '--decisions' && rest[1] !== '') return { command, root, decisions: rest[1] };
  return null;
}

function runCandidates(rootArg) {
  const root = bindProjectRoot(rootArg);
  const inputs = readInputs(root);
  const product = addCensus({
    product: buildUnusedCandidates(inputs),
    nodes: inputs.graph.nodes,
    files: readSelectedFiles(root, inputs.entries),
  });
  const path = assertDataFile(root, UNUSED_CANDIDATES_FILE);
  writeAtomic(path, `${serializeJsonProduct(UNUSED_CANDIDATES_FILE, product)}\n`);

  const { counts, census } = product;
  process.stdout.write(`${JSON.stringify({ product: path, counts, census })}\n`);
  process.stderr.write(`unused-code: ${counts.candidates} candidates (${counts.entries} entries in ${counts.entryComponents} components, `
    + `${counts.clusters} clusters) of ${counts.functionNodes} function nodes, ${counts.routeReachable} route-reachable; `
    + `census over ${census.files} files, ${census.candidatesWithElsewhere} candidates with the name elsewhere -> ${path}\n`);
}

function parseJsonFile(path, bytes) {
  try {
    return JSON.parse(bytes.toString('utf-8'));
  } catch (error) {
    throw new Error(`${path}: not valid JSON (${error.message})`);
  }
}

/** The three inputs of `report`; the fact graph is read for its header digest only. */
function readReportInputs(root, decisionsArg) {
  assertDataTree(root);
  const dataDir = assertDataDir(root);
  const candidatesPath = assertDataFile(root, UNUSED_CANDIDATES_FILE);
  if (!existsSync(candidatesPath)) throw new Error(`missing ${candidatesPath}; run "unused-code.mjs candidates" first`);
  const decisionsPath = decisionsArg === null ? assertDataFile(root, UNUSED_DECISIONS_FILE) : resolve(decisionsArg);
  if (!existsSync(decisionsPath)) throw new Error(`no decisions file at ${decisionsPath}; the excavator-unused-code skill writes it`);
  const graphPath = join(dataDir, 'intermediate', 'fact-graph.jsonl');
  if (!existsSync(graphPath)) throw new Error(`missing input ${graphPath}; run /excavator lazy on this project first`);

  const decisionsBytes = readFileSync(decisionsPath);
  return {
    candidates: parseJsonFile(candidatesPath, readFileSync(candidatesPath)),
    decisions: parseJsonFile(decisionsPath, decisionsBytes),
    decisionsDigest: createHash('sha256').update(decisionsBytes).digest('hex'),
    factsDigest: readKnowledgeGraphHeader(graphPath).fields.factsDigest,
  };
}

function runReport({ root: rootArg, decisions }) {
  const root = bindProjectRoot(rootArg);
  const product = buildUnusedReport(readReportInputs(root, decisions));
  const path = assertDataFile(root, UNUSED_CODE_FILE);
  writeAtomic(path, `${serializeJsonProduct(UNUSED_CODE_FILE, product)}\n`);

  const { counts } = product;
  process.stdout.write(`${JSON.stringify({ product: path, counts })}\n`);
  process.stderr.write(`unused-code report: ${counts.unused} unused (${counts.byConfidence.high} high, ${counts.byConfidence.medium} medium, `
    + `${counts.byConfidence.low} low) in ${counts.groups} groups; ${counts.removedByDecision} removed by decision, ${counts.testOnly} test-only `
    + `of ${counts.candidates} candidates -> ${path}\n`);
}

function main(argv) {
  const parsed = parseArgs(argv);
  if (!parsed) {
    process.stderr.write(USAGE);
    process.exit(1);
  }
  if (parsed.command === 'candidates') runCandidates(parsed.root);
  else runReport(parsed);
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
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`unused-code.mjs failed: ${error.message}\n`);
    process.exit(1);
  }
}

export default {
  UNUSED_CANDIDATES_FORMAT,
  UNUSED_CANDIDATES_FILE,
  UNUSED_CODE_FORMAT,
  UNUSED_CODE_FILE,
  UNUSED_DECISIONS_FILE,
  simpleTypeName,
  assertConservation,
  computeCandidateSet,
  buildUnusedCandidates,
  computeCensus,
  addCensus,
  readSelectedFiles,
  assertReportConservation,
  buildUnusedReport,
};
