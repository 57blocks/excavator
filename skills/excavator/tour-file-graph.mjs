/**
 * tour-file-graph.mjs
 *
 * The file-level view of the knowledge graph the tour candidates are ranked on
 * (openspec: changes/tour-product, design D1). Pure functions over the graph
 * object; no I/O and no model.
 *
 * A "code file" is a file node whose path carries no config, pipeline, service
 * or document node; those paths are the "non-code files". `imports` and `calls`
 * edges are lifted from their endpoints to the files the endpoints live in, and
 * an edge is counted only when both files are code files and differ. Fan-in
 * (fan-out) of a file is the number of DISTINCT other code files with such an
 * edge into (out of) it, so an import plus ten calls between the same two files
 * count once. Every edge that is not counted goes into `ignored` by reason.
 */

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Node types that make their file a non-code file. */
export const NON_CODE_TYPES = Object.freeze(['config', 'pipeline', 'service', 'document']);
const NON_CODE = new Set(NON_CODE_TYPES);
const EDGE_TYPES = new Set(['imports', 'calls']);

/** Rank `[path, value]` pairs by value descending, then path. */
export function rankDescending(pairs) {
  return [...pairs].sort((a, b) => b[1] - a[1] || compare(a[0], b[0]));
}

/**
 * @param {{ nodes: object[], edges: object[] }} graph
 * @returns {{
 *   nodesById: Map<string, object>,
 *   fileNodes: Map<string, object>,
 *   codeFiles: string[],
 *   nonCode: Map<string, object[]>,
 *   filesWithoutFileNode: number,
 *   out: Map<string, Set<string>>,
 *   in: Map<string, Set<string>>,
 *   ignored: { unresolved: number, sameFile: number, nonCode: number }
 * }}
 */
export function buildFileGraph(graph) {
  const nodesById = new Map();
  const fileNodes = new Map();
  const nonCode = new Map();
  const pathsSeen = new Set();
  for (const node of graph.nodes) {
    if (node === null || typeof node !== 'object' || typeof node.id !== 'string') continue;
    if (!nodesById.has(node.id)) nodesById.set(node.id, node);
    if (typeof node.filePath !== 'string') continue;
    pathsSeen.add(node.filePath);
    if (node.type === 'file') {
      if (!fileNodes.has(node.filePath)) fileNodes.set(node.filePath, node);
    } else if (NON_CODE.has(node.type)) {
      if (!nonCode.has(node.filePath)) nonCode.set(node.filePath, []);
      nonCode.get(node.filePath).push(node);
    }
  }
  const codeFiles = [...fileNodes.keys()].filter((path) => !nonCode.has(path)).sort(compare);
  const isCode = new Set(codeFiles);
  const filesWithoutFileNode = [...pathsSeen].filter((path) => !fileNodes.has(path)).length;

  const out = new Map(codeFiles.map((path) => [path, new Set()]));
  const into = new Map(codeFiles.map((path) => [path, new Set()]));
  const ignored = { unresolved: 0, sameFile: 0, nonCode: 0 };
  for (const edge of graph.edges) {
    if (!EDGE_TYPES.has(edge?.type)) continue;
    const from = nodesById.get(edge.source)?.filePath;
    const to = nodesById.get(edge.target)?.filePath;
    if (typeof from !== 'string' || typeof to !== 'string') ignored.unresolved += 1;
    else if (from === to) ignored.sameFile += 1;
    else if (!isCode.has(from) || !isCode.has(to)) ignored.nonCode += 1;
    else {
      out.get(from).add(to);
      into.get(to).add(from);
    }
  }
  return { nodesById, fileNodes, codeFiles, nonCode, filesWithoutFileNode, out, in: into, ignored };
}

/** The value at rank `ceil(n * fraction)` of `values` sorted descending (the cut a "top fraction" starts at); null when there are no values. */
export function topCut(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => b - a);
  return sorted[Math.min(sorted.length, Math.max(1, Math.ceil(sorted.length * fraction))) - 1];
}

/** The value at rank `ceil(n * fraction)` of `values` sorted ascending (the cut a "bottom fraction" ends at); null when there are no values. */
export function bottomCut(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length, Math.max(1, Math.ceil(sorted.length * fraction))) - 1];
}

/**
 * Breadth-first reading order from `start` along the forward file edges.
 * Within a level, files with more fan-in come first, then by path, so a cap
 * keeps the central files. Returns every reachable file within `maxDepth`
 * (start included at depth 0) in visiting order.
 */
export function readingOrder(fileGraph, start, maxDepth) {
  const seen = new Map([[start, 0]]);
  const order = [{ path: start, depth: 0 }];
  let level = [start];
  for (let depth = 1; depth <= maxDepth && level.length > 0; depth++) {
    const next = new Set();
    for (const path of level) {
      for (const target of fileGraph.out.get(path) ?? []) if (!seen.has(target)) next.add(target);
    }
    const sorted = [...next].sort((a, b) => fileGraph.in.get(b).size - fileGraph.in.get(a).size || compare(a, b));
    for (const path of sorted) {
      seen.set(path, depth);
      order.push({ path, depth });
    }
    level = sorted;
  }
  return order;
}
