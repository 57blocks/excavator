#!/usr/bin/env node
/**
 * unused-code.mjs
 *
 * The deterministic half of unused-code detection (openspec: changes/
 * unused-code, capability `unused-code`, design D1-D3, D6, D7). No model, no
 * framework or language branch, no build of the target: it reads the fact
 * graph, the structure result and the source manifest under `.excavator/` and
 * writes the full candidate set. Which candidates are really program entries is
 * a judgment the host skill makes later; this script only supplies the
 * complete set ("nothing references it" is a claim about absence and needs the
 * whole index) and the facts the judgment is made from.
 *
 *   node unused-code.mjs candidates <projectRoot>
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
 * identifier has `census: null` (unknown, never zero).
 *
 * Contract: openspec/changes/unused-code/specs/unused-code/spec.md
 *           (requirements: the definition of unused code, the deterministic
 *           candidate set, the name occurrence census)
 */

import { existsSync, lstatSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readKnowledgeGraph } from './knowledge-graph-store.mjs';
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

  // One pass over the edges for everything the class level needs.
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
    }
  }

  const byLanguage = new Map();
  const bucket = (language) => {
    const key = language ?? 'unknown';
    if (!byLanguage.has(key)) byLanguage.set(key, { functionNodes: 0, routeReachable: 0, candidates: 0, entries: 0 });
    return byLanguage.get(key);
  };
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
// CLI
// ---------------------------------------------------------------------------

const USAGE = 'Usage: node unused-code.mjs candidates <projectRoot>\n';

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

function main(argv) {
  const [command, rootArg, ...extra] = argv;
  if (command !== 'candidates' || !rootArg || extra.length > 0) {
    process.stderr.write(USAGE);
    process.exit(1);
  }
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
  simpleTypeName,
  assertConservation,
  computeCandidateSet,
  buildUnusedCandidates,
  computeCensus,
  addCensus,
  readSelectedFiles,
};
