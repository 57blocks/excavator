/**
 * retrieve.mjs
 *
 * Group-3 hybrid-retrieval MECHANICS (openspec: changes/hybrid-retrieval,
 * capability `hybrid-retrieval`, design D3/D4). Every function here is pure
 * and deterministic — no model call, no I/O. Query expansion (turning a
 * user's question, possibly in Chinese, into candidate search terms) and
 * question-type judgment (structural vs. semantic; which traversal primitive
 * applies) are the chat's job, in the SAME inference, per design D3 — they
 * are deliberately NOT implemented here.
 *
 *   bm25Search        — rank source-index chunks against a term list.
 *   mergeCandidates   — merge/rank candidates from exact/BM25/source-search/
 *                       semantic-cache inputs (all passed in; this module is
 *                       not coupled to the semantic-cache module — group 4).
 *   oneHop / boundedBFS / boundedShortestPath
 *                     — budgeted traversal over DETERMINISTIC fact edges
 *                       only (contains/imports/exports/calls). A semantic or
 *                       domain edge type is never consulted for a path, even
 *                       if present in the input array — a rank-influencing
 *                       semantic/domain signal may reorder candidates
 *                       upstream of this module but can never add a path
 *                       edge (design D4).
 *
 * Every traversal call returns a `boundary` report describing exactly why it
 * stopped (`reason`) — a budget being hit is always visible, never a silent
 * partial result (repo-wide "no fourth state" convention).
 *
 * Contract: openspec/changes/hybrid-retrieval/specs/hybrid-retrieval/spec.md
 */

import { splitIdentifier } from './build-source-index.mjs';

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// bm25Search — Requirement "BM25 lexical retrieval". Queries a source-index built by
// build-source-index.mjs's `buildSourceIndex`/`updateSourceIndex`.
// ---------------------------------------------------------------------------

/**
 * @param {object} index a source-index (see build-source-index.mjs)
 * @param {string[]} terms query terms — each is itself run through the same
 *   subword splitter the index was built with, so a caller may pass either
 *   already-split tokens or raw words/identifiers/phrases.
 * @param {number} [k] max candidates to return
 * @returns {Array<{chunkId: string, score: number, chunk: object|null}>}
 *   sorted by score descending (ties broken by chunkId for determinism).
 */
export function bm25Search(index, terms, k = 20) {
  if (!index || !index.postings) throw new Error('bm25Search: index.postings is required');
  const { postings, docLengths = {}, avgDocLength = 0, N = 0 } = index;
  const K1 = index.k1 ?? 1.5;
  const B = index.b ?? 0.75;

  const queryTokens = [...new Set((terms ?? []).flatMap((t) => splitIdentifier(String(t))))];

  const scores = new Map();
  for (const term of queryTokens) {
    const list = postings[term];
    if (!list || list.length === 0) continue;
    const df = list.length;
    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
    for (const { chunkId, tf } of list) {
      const docLen = docLengths[chunkId] ?? 0;
      const norm = avgDocLength > 0 ? docLen / avgDocLength : 0;
      const denom = tf + K1 * (1 - B + B * norm);
      const contribution = denom > 0 ? idf * ((tf * (K1 + 1)) / denom) : 0;
      scores.set(chunkId, (scores.get(chunkId) ?? 0) + contribution);
    }
  }

  const chunkById = new Map((index.chunks ?? []).map((c) => [c.id, c]));
  return [...scores.entries()]
    .map(([chunkId, score]) => ({ chunkId, score, chunk: chunkById.get(chunkId) ?? null }))
    .sort((x, y) => y.score - x.score || compareStrings(x.chunkId, y.chunkId))
    .slice(0, k);
}

// ---------------------------------------------------------------------------
// mergeCandidates — Requirement "candidates merged and ranked from multiple sources". Every input list is
// ALREADY produced by its own subsystem and simply passed in — exact
// symbol/nodeId/path lookups, `bm25Search` results, SourceSnapshot's own
// source-text search, and valid (hash-fresh) semantic-cache text hits.
// ---------------------------------------------------------------------------

/** Per-source rank weights — a deliberate, tunable heuristic (the spec
 *  mandates merge + rank, not a specific formula): an exact identity match
 *  always dominates; a literal source-search hit is strong direct evidence;
 *  BM25 and semantic-cache contribute their own (variable) relevance score,
 *  scaled modestly so a very strong lexical/cache hit still cannot outrank
 *  an exact match. */
const SOURCE_WEIGHT = Object.freeze({
  exact: 1000,
  sourceSearch: 50,
  bm25: 1,
  semanticCache: 10,
});

/** Identity key for merging the same underlying entity across sources. */
function candidateKey(c) {
  if (c.nodeId) return `node:${c.nodeId}`;
  if (c.chunkId) return `chunk:${c.chunkId}`;
  if (c.path && c.symbol) return `pathsym:${c.path}#${c.symbol}`;
  if (c.path) return `path:${c.path}`;
  return `raw:${JSON.stringify(c)}`;
}

/**
 * @param {{
 *   exact?: object[], bm25?: Array<{score?:number}>,
 *   sourceSearch?: object[], semanticCacheText?: Array<{score?:number}>,
 * }} args each candidate needs at least a `nodeId`, `chunkId`, or `path`
 *   (optionally `symbol`) to be identifiable for merge purposes.
 * @returns {Array<object>} merged candidates, sorted by combined score
 *   descending; each carries `score` and `sources` (which input lists it
 *   came from) in addition to whatever fields the original candidate had.
 */
export function mergeCandidates({ exact = [], bm25 = [], sourceSearch = [], semanticCacheText = [] } = {}) {
  const merged = new Map();

  function ingest(list, sourceName, weightOf) {
    for (const c of list ?? []) {
      const key = candidateKey(c);
      const contribution = weightOf(c);
      const existing = merged.get(key);
      if (existing) {
        const nextScore = existing.score + contribution;
        Object.assign(existing, c); // enrich with any new descriptive fields
        existing.score = nextScore;
        if (!existing.sources.includes(sourceName)) existing.sources.push(sourceName);
      } else {
        merged.set(key, { ...c, score: contribution, sources: [sourceName] });
      }
    }
  }

  const scoreOf = (c) => (typeof c.score === 'number' ? c.score : 1);
  ingest(exact, 'exact', () => SOURCE_WEIGHT.exact);
  ingest(sourceSearch, 'source-search', (c) => SOURCE_WEIGHT.sourceSearch * scoreOf(c));
  ingest(bm25, 'bm25', (c) => SOURCE_WEIGHT.bm25 * scoreOf(c));
  ingest(semanticCacheText, 'semantic-cache', (c) => SOURCE_WEIGHT.semanticCache * scoreOf(c));

  return [...merged.values()].sort(
    (a, b) => b.score - a.score || compareStrings(candidateKey(a), candidateKey(b)),
  );
}

// ---------------------------------------------------------------------------
// Budgeted graph traversal — Requirement "budgeted multi-hop traversal that reports its boundary".
// ---------------------------------------------------------------------------

/** Fact edge types traversal is allowed to follow. Anything else (a
 *  semantic-similarity edge, a domain overlay edge, ...) is filtered out
 *  before adjacency is even built — it can never contribute a path edge. */
export const DETERMINISTIC_EDGE_TYPES = Object.freeze(['contains', 'imports', 'exports', 'calls']);

export const DEFAULT_TRAVERSAL_BUDGETS = Object.freeze({ maxSeeds: 20, maxNodes: 80, maxEdges: 160 });
export const DEFAULT_BFS_MAX_HOPS = 4;
export const DEFAULT_SHORTEST_PATH_MAX_HOPS = 6;

function edgeKeyOf(edge) {
  return `${edge.type}|${edge.source}|${edge.target}`;
}

/** Undirected adjacency over deterministic edges only: "direct callers"
 *  (reverse of `calls`) and "callees"/"impact" (forward) both need to be
 *  reachable from one generic primitive — direction/type are preserved on
 *  each returned edge for the caller (chat) to describe correctly, but the
 *  reachability computation itself does not restrict direction. This is a
 *  documented, deliberate trade-off (see the task report): a heavily-shared
 *  file can connect far-apart parts of a system, and that is bounded by the
 *  hard budgets below plus the boundary report, not by pretending direction
 *  scopes the graph. */
function buildAdjacency(edges) {
  const adjacency = new Map();
  function add(from, to, edge) {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push({ to, edge });
  }
  for (const edge of edges ?? []) {
    if (!edge || !DETERMINISTIC_EDGE_TYPES.includes(edge.type)) continue;
    add(edge.source, edge.target, edge);
    add(edge.target, edge.source, edge);
  }
  return adjacency;
}

/**
 * Shared bounded multi-source BFS engine behind oneHop/boundedBFS/
 * boundedShortestPath.
 *
 * `reason` precedence (first that applies, in this order): 'found' (a
 * target was reached) > 'edge-budget' > 'node-budget' > 'max-hops' >
 * 'seed-budget' > ('unreachable' if targets were given, else 'exhausted').
 * Node/edge budgets stop the WHOLE traversal immediately once hit (matching
 * the spec's "reaching any budget SHALL stop expansion" — reaching any budget halts
 * expansion, not just the branch that hit it); `max-hops` is reported only
 * when the depth cap actually cut off real, otherwise-reachable graph (not
 * merely because nothing existed beyond it).
 */
function traverse(edges, seedIds, { maxHops = Infinity, budgets = DEFAULT_TRAVERSAL_BUDGETS, targets = null } = {}) {
  const effectiveBudgets = { ...DEFAULT_TRAVERSAL_BUDGETS, ...budgets };
  const adjacency = buildAdjacency(edges);

  const seedsRequested = (seedIds ?? []).length;
  const hitSeedBudget = seedsRequested > effectiveBudgets.maxSeeds;
  const seeds = hitSeedBudget ? seedIds.slice(0, effectiveBudgets.maxSeeds) : (seedIds ?? []).slice();

  const targetSet = targets ? new Set(targets) : null;
  const visited = new Set(seeds);
  const parent = new Map(); // nodeId -> { from: nodeId, edge }
  const collectedEdgeKeys = new Set();
  const collectedEdges = [];

  let frontier = seeds.map((id) => ({ id, hop: 0 }));
  let hopsCompleted = 0;
  let hitNodeBudget = false;
  let hitEdgeBudget = false;
  let hitMaxHops = false;
  let foundTarget = targetSet ? (seeds.find((s) => targetSet.has(s)) ?? null) : null;

  outer:
  while (frontier.length > 0 && foundTarget === null) {
    const nextFrontier = [];
    for (const { id, hop } of frontier) {
      for (const { to, edge } of adjacency.get(id) ?? []) {
        const isNewNode = !visited.has(to);
        if (isNewNode && hop + 1 > maxHops) {
          hitMaxHops = true;
          continue;
        }
        const ek = edgeKeyOf(edge);
        const isNewEdge = !collectedEdgeKeys.has(ek);
        if (isNewEdge && collectedEdges.length >= effectiveBudgets.maxEdges) {
          hitEdgeBudget = true;
          break outer;
        }
        if (isNewNode) {
          if (visited.size >= effectiveBudgets.maxNodes) {
            hitNodeBudget = true;
            break outer;
          }
          visited.add(to);
          parent.set(to, { from: id, edge });
          nextFrontier.push({ id: to, hop: hop + 1 });
          if (targetSet && targetSet.has(to)) foundTarget = to;
        }
        if (isNewEdge) {
          collectedEdgeKeys.add(ek);
          collectedEdges.push(edge);
        }
        if (foundTarget !== null) break outer;
      }
    }
    if (nextFrontier.length === 0) break;
    hopsCompleted += 1;
    frontier = nextFrontier;
  }

  let reason;
  if (foundTarget !== null) reason = 'found';
  else if (hitEdgeBudget) reason = 'edge-budget';
  else if (hitNodeBudget) reason = 'node-budget';
  else if (hitMaxHops) reason = 'max-hops';
  else if (hitSeedBudget) reason = 'seed-budget';
  else reason = targetSet ? 'unreachable' : 'exhausted';

  const truncated = ['edge-budget', 'node-budget', 'max-hops', 'seed-budget'].includes(reason);

  const boundary = {
    reason,
    truncated,
    hopsCompleted,
    seedsRequested,
    seedsUsed: seeds.length,
    nodesVisited: visited.size,
    edgesCollected: collectedEdges.length,
    budgets: { ...effectiveBudgets, maxHops },
  };

  return { visited, parent, edges: collectedEdges, seeds, foundTarget, boundary };
}

/** Reconstruct the seed -> target path from `traverse`'s parent map, in
 *  seed-to-target order. */
function reconstructPath(parent, target, seeds) {
  const seedSet = new Set(seeds);
  const nodes = [target];
  const pathEdges = [];
  let cur = target;
  while (!seedSet.has(cur)) {
    const p = parent.get(cur);
    if (!p) return null; // unreachable: a node reached via this BFS always has a parent chain to a seed
    pathEdges.push(p.edge);
    cur = p.from;
    nodes.push(cur);
  }
  nodes.reverse();
  pathEdges.reverse();
  return { nodes, edges: pathEdges };
}

/**
 * Immediate neighbors of the seed set — "locate this / who calls this
 * directly" (spec: locate / direct callers = 1-hop).
 * @param {object[]} edges fact edges (any array; non-deterministic types are ignored)
 * @param {string[]} seedIds
 * @param {{budgets?: object}} [options]
 * @returns {{nodes: string[], edges: object[], boundary: object}}
 */
export function oneHop(edges, seedIds, { budgets = DEFAULT_TRAVERSAL_BUDGETS } = {}) {
  const result = traverse(edges, seedIds, { maxHops: 1, budgets });
  return { nodes: [...result.visited], edges: result.edges, boundary: result.boundary };
}

/**
 * Bounded breadth-first expansion — "process / impact / dependency"
 * questions (spec: flow / impact = bounded BFS, default max 4-hop).
 * @param {object[]} edges
 * @param {string[]} seedIds
 * @param {{maxHops?: number, budgets?: object}} [options]
 * @returns {{nodes: string[], edges: object[], boundary: object}}
 */
export function boundedBFS(edges, seedIds, { maxHops = DEFAULT_BFS_MAX_HOPS, budgets = DEFAULT_TRAVERSAL_BUDGETS } = {}) {
  const result = traverse(edges, seedIds, { maxHops, budgets });
  return { nodes: [...result.visited], edges: result.edges, boundary: result.boundary };
}

/**
 * Bounded shortest path from any seed to any target — "how does A reach B"
 * (spec: explicit A-to-B = bounded shortest path, max 6-hop).
 * @param {object[]} edges
 * @param {string[]} seedIds
 * @param {string[]} targetIds
 * @param {{maxHops?: number, budgets?: object}} [options]
 * @returns {{path: string[]|null, edges: object[]|null, nodes: string[], boundary: object}}
 *   `path`/`edges` are null when no target was reached within budget —
 *   `boundary.reason` explains why (a budget, the hop cap, or genuinely
 *   `'unreachable'` within both).
 */
export function boundedShortestPath(
  edges,
  seedIds,
  targetIds,
  { maxHops = DEFAULT_SHORTEST_PATH_MAX_HOPS, budgets = DEFAULT_TRAVERSAL_BUDGETS } = {},
) {
  const result = traverse(edges, seedIds, { maxHops, budgets, targets: targetIds });
  if (result.foundTarget === null) {
    return { path: null, edges: null, nodes: [...result.visited], boundary: result.boundary };
  }
  const reconstructed = reconstructPath(result.parent, result.foundTarget, result.seeds);
  return {
    path: reconstructed?.nodes ?? null,
    edges: reconstructed?.edges ?? null,
    nodes: [...result.visited],
    boundary: result.boundary,
  };
}

export default {
  bm25Search,
  mergeCandidates,
  oneHop,
  boundedBFS,
  boundedShortestPath,
  DETERMINISTIC_EDGE_TYPES,
  DEFAULT_TRAVERSAL_BUDGETS,
  DEFAULT_BFS_MAX_HOPS,
  DEFAULT_SHORTEST_PATH_MAX_HOPS,
};
