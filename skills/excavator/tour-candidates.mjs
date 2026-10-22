/**
 * tour-candidates.mjs
 *
 * The deterministic candidate set a learning tour is written from (openspec:
 * changes/tour-product, capability `learning-tour`, design D1-D2). No model, no
 * build of the target: it reads `knowledge-graph.jsonl`, `semantic-cache.json`,
 * `semantic-graph.json`, `domain-graph.json` and `source-manifest.json` under
 * `.excavator/`, and the source snapshot for the revision and the member repos.
 *
 * Classes (a node can fall in several; it is one candidate with every reason):
 *   entry    entry-named files, plus files one or two directories below a member
 *            repo root whose fan-out is in the top tenth and fan-in in the
 *            bottom quarter of the code files; at most 30, best score first
 *            (score = fan-out minus fan-in)
 *   fanIn    the 20 code files with the highest fan-in
 *   fanOut   the 20 code files with the highest fan-out
 *   bfs      reading order, one breadth-first walk per member repo (a single repo
 *            is the project itself) along imports and calls, depth 3, each from
 *            the member's most entry-like entry candidate. Only entries with
 *            fan-out of at least 1 can start a walk (a file with no outgoing edge
 *            reads only itself). Ranked by file name tier main.* > server.* >
 *            app.* > index.* > any other entry, then shallower directory depth
 *            under the member root, then fan-out descending, then path. At most
 *            60 files in total: the walks
 *            are interleaved one step at a time (member id order), so every
 *            member keeps its start and its nearest files when the cap bites; a
 *            file two walks reach is listed once. `classes.bfs` names the starts.
 *   layer    the 5 files with the highest fan-in in each layer
 *   flow     the nodes the domain graph's flow steps are anchored on, 5 per flow,
 *            only when the domain graph was made from the graph's facts
 *   nonCode  config, pipeline, service and document nodes, one candidate per file
 *            (the file's file node), at most 30 files, most such nodes first
 * `classes` records, per class, how many qualified (`total`), how many are listed
 * and how many the quota cut; the quotas limit only what the model is shown.
 *
 * Summaries follow the viewer (`excavator-view/semantics.mjs`, called directly):
 * a fresh semantic-cache entry's summary, blank when a verifier contradicted it,
 * with the verdict beside it. Only when there is no readable semantic cache is the
 * graph node's own summary used; a node with neither has an empty summary.
 *
 * Product `.excavator/tour/candidates.json`, written through a temporary file and
 * a rename; the same inputs give the same bytes.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readDomain } from '../excavator-view/domain.mjs';
import { readSemantics } from '../excavator-view/semantics.mjs';
import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraph } from './knowledge-graph-store.mjs';
import { assertDataDir, bindProjectRoot } from './project-paths.mjs';
import { resolveSourceSnapshot } from './source-snapshot.mjs';
import { bottomCut, buildFileGraph, rankDescending, readingOrder, topCut } from './tour-file-graph.mjs';

export const CANDIDATES_FORMAT = 'excavator-tour-candidates/1';
export const TOUR_DIR = 'tour';
export const CANDIDATES_FILE = 'candidates.json';

export const QUOTAS = Object.freeze({
  entry: 30,
  fanIn: 20,
  fanOut: 20,
  perLayer: 5,
  bfsDepth: 3,
  bfsMax: 60,
  perFlow: 5,
  nonCode: 30,
});
const ENTRY_FAN_OUT_TOP = 0.1;
const ENTRY_FAN_IN_BOTTOM = 0.25;
const ENTRY_MAX_DEPTH = 2;
// Entry file names: main, server, app and index (any case) in a code extension, plus a few fixed names.
const ENTRY_STEMS = new Set(['main', 'server', 'app', 'index']);
const ENTRY_EXTENSIONS = new Set(['go', 'py', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'rs', 'java', 'kt', 'rb', 'php', 'cs']);
const ENTRY_NAMES = new Set(['__main__.py', 'manage.py', 'Program.cs', 'Main.java', 'Application.java']);
const START_TIERS = ['main', 'server', 'app', 'index'];
const BFS_RULE = 'one breadth-first walk per member repo from its most entry-like entry with fan-out >= 1 (main.* > server.* > app.* > index.* > other entries, then shallower directory, then fan-out), depth 3, 60 files in total, walks interleaved';
const CLASSES = ['entry', 'fanIn', 'fanOut', 'bfs', 'layer', 'flow', 'nonCode'];

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const basename = (path) => path.slice(path.lastIndexOf('/') + 1);

export class MissingGraphError extends Error {
  constructor(path) {
    super(`${path} does not exist; run /excavator on this project first`);
    this.name = 'MissingGraphError';
  }
}

/** The member repo a path belongs to: its first directory in a multi-repo project, else '' (the project itself). */
function memberOf(path, memberIds) {
  const first = path.split('/')[0];
  return memberIds.has(first) && path.includes('/') ? first : '';
}

/** 0 for main.*, 1 server.*, 2 app.*, 3 index.*, 4 for any other file name. */
function startTier(path) {
  const name = basename(path);
  const stem = name.slice(0, name.lastIndexOf('.') === -1 ? name.length : name.lastIndexOf('.')).toLowerCase();
  const tier = START_TIERS.indexOf(stem);
  return tier === -1 ? START_TIERS.length : tier;
}

/** Directory levels between `path` and the root of the member repo that holds it (a file in the project root's own repo has depth = its directory count). */
function depthUnderMember(path, memberIds) {
  const segments = path.split('/');
  const member = memberIds.has(segments[0]) && segments.length > 1;
  return segments.length - 1 - (member ? 1 : 0);
}

function isEntryName(name) {
  if (ENTRY_NAMES.has(name)) return true;
  const dot = name.lastIndexOf('.');
  return dot > 0 && ENTRY_STEMS.has(name.slice(0, dot).toLowerCase()) && ENTRY_EXTENSIONS.has(name.slice(dot + 1));
}

function entryCandidates(fileGraph, memberIds) {
  const fanIn = (path) => fileGraph.in.get(path).size;
  const fanOut = (path) => fileGraph.out.get(path).size;
  const outCut = topCut(fileGraph.codeFiles.map(fanOut), ENTRY_FAN_OUT_TOP);
  const inCut = bottomCut(fileGraph.codeFiles.map(fanIn), ENTRY_FAN_IN_BOTTOM);
  const found = [];
  for (const path of fileGraph.codeFiles) {
    const reasons = [];
    if (isEntryName(basename(path))) reasons.push('entry-name');
    if (depthUnderMember(path, memberIds) <= ENTRY_MAX_DEPTH && fanOut(path) > 0 && fanOut(path) >= outCut && fanIn(path) <= inCut) {
      reasons.push('entry-shape');
    }
    if (reasons.length > 0) found.push({ path, reasons, score: fanOut(path) - fanIn(path), fanOut: fanOut(path), member: memberOf(path, memberIds), depth: depthUnderMember(path, memberIds) });
  }
  return found.sort((a, b) => b.score - a.score || compare(a.path, b.path));
}

/** layerId by node id and by file path, from the layers' node ids. */
function indexLayers(layers, fileGraph) {
  const byNode = new Map();
  const byFile = new Map();
  const filesOf = new Map();
  let unresolved = 0;
  for (const layer of layers) {
    const files = new Set();
    for (const id of layer.nodeIds) {
      const node = fileGraph.nodesById.get(id);
      if (!node) {
        unresolved += 1;
        continue;
      }
      if (!byNode.has(id)) byNode.set(id, layer.id);
      if (typeof node.filePath === 'string') {
        if (!byFile.has(node.filePath)) byFile.set(node.filePath, layer.id);
        files.add(node.filePath);
      }
    }
    filesOf.set(layer.id, files);
  }
  return { byNode, byFile, filesOf, unresolved };
}

/** The flows of a readable domain graph made from the same facts: [{ id, anchors: [nodeId] }] and how many anchor ids the graph lacks. */
function flowAnchors(domain, fileGraph) {
  const parsed = JSON.parse(domain.bytes.toString('utf-8'));
  const stepsById = new Map(parsed.nodes.filter((node) => node.type === 'step').map((node) => [node.id, node]));
  const stepsOf = new Map();
  for (const edge of parsed.edges) {
    if (edge.type !== 'flow_step' || !stepsById.has(edge.target)) continue;
    if (!stepsOf.has(edge.source)) stepsOf.set(edge.source, []);
    stepsOf.get(edge.source).push({ id: edge.target, weight: typeof edge.weight === 'number' ? edge.weight : 0 });
  }
  let unresolved = 0;
  const flows = [];
  for (const flow of parsed.nodes.filter((node) => node.type === 'flow').sort((a, b) => compare(a.id, b.id))) {
    const steps = (stepsOf.get(flow.id) ?? []).sort((a, b) => a.weight - b.weight || compare(a.id, b.id));
    const anchors = [];
    for (const { id } of steps) {
      const ids = Array.isArray(stepsById.get(id).nodeIds) ? stepsById.get(id).nodeIds : [];
      for (const nodeId of ids) {
        if (typeof nodeId !== 'string') continue;
        if (!fileGraph.nodesById.has(nodeId)) unresolved += 1;
        else if (!anchors.includes(nodeId)) anchors.push(nodeId);
      }
    }
    flows.push({ id: flow.id, anchors });
  }
  return { flows, unresolved };
}

/** The layers to use: the semantic graph's (through readSemantics) or else the knowledge graph's own records. */
function chooseLayers(semantics, graph) {
  if (semantics.state === 'ok') {
    const layers = JSON.parse(semantics.bytes.toString('utf-8')).layers;
    if (layers.length > 0) return { source: 'semantic-graph', layers };
  }
  const own = (Array.isArray(graph.layers) ? graph.layers : [])
    .filter((layer) => layer !== null && typeof layer === 'object' && typeof layer.id === 'string')
    .map((layer) => ({
      id: layer.id,
      name: typeof layer.name === 'string' ? layer.name : layer.id,
      description: typeof layer.description === 'string' ? layer.description : '',
      nodeIds: Array.isArray(layer.nodeIds) ? layer.nodeIds.filter((id) => typeof id === 'string') : [],
    }));
  return { source: own.length > 0 ? 'knowledge-graph' : 'none', layers: own };
}

function summaryLookup(semantics) {
  if (semantics.state !== 'ok') return null;
  return new Map(JSON.parse(semantics.bytes.toString('utf-8')).entries.map((row) => [row.id, row]));
}

/**
 * Compute the candidate set. Throws MissingGraphError when there is no graph.
 * @param {string} rootArg the project root
 */
export function computeCandidates(rootArg) {
  const root = bindProjectRoot(rootArg);
  const dataDir = assertDataDir(root);
  const graphPath = join(dataDir, KNOWLEDGE_GRAPH_FILE);
  if (!existsSync(graphPath)) throw new MissingGraphError(graphPath);

  const graph = readKnowledgeGraph(graphPath);
  const factsDigest = graph.project?.factsDigest ?? null;
  const snapshot = resolveSourceSnapshot(root);
  const memberIds = new Set(snapshot.kind === 'multi-repo' ? snapshot.members.map((member) => member.id) : []);

  const semantics = readSemantics(dataDir, readFileSync(graphPath));
  const summaries = summaryLookup(semantics);
  const domain = readDomain(dataDir, { factsDigest }, snapshot.revision);
  const fileGraph = buildFileGraph(graph);
  const layerChoice = chooseLayers(semantics, graph);
  const layerIndex = indexLayers(layerChoice.layers, fileGraph);
  const gaps = [];

  const candidates = new Map();
  const classes = {};
  const add = (node, reason) => {
    if (!candidates.has(node.id)) {
      candidates.set(node.id, {
        id: node.id,
        type: node.type,
        name: node.name,
        filePath: node.filePath,
        lineRange: Array.isArray(node.lineRange) ? node.lineRange : null,
        layer: layerIndex.byNode.get(node.id) ?? layerIndex.byFile.get(node.filePath) ?? null,
        reasons: [],
        ...summaryFields(node, summaries),
      });
    }
    candidates.get(node.id).reasons.push(reason);
  };
  const record = (name, total, listed) => {
    classes[name] = { total, listed, truncated: total - listed };
  };
  const fileNode = (path) => fileGraph.fileNodes.get(path);
  const fanIn = (path) => fileGraph.in.get(path).size;
  const fanOut = (path) => fileGraph.out.get(path).size;

  // entry
  const entries = entryCandidates(fileGraph, memberIds);
  entries.slice(0, QUOTAS.entry).forEach((entry, i) => add(fileNode(entry.path), `entry: ${entry.reasons.join('+')} (rank ${i + 1}, fan-out ${fanOut(entry.path)}, fan-in ${fanIn(entry.path)})`));
  record('entry', entries.length, Math.min(entries.length, QUOTAS.entry));

  // fan-in and fan-out
  for (const [name, count, label] of [['fanIn', fanIn, 'fan-in'], ['fanOut', fanOut, 'fan-out']]) {
    const ranked = rankDescending(fileGraph.codeFiles.map((path) => [path, count(path)]).filter(([, n]) => n > 0));
    ranked.slice(0, QUOTAS[name]).forEach(([path, n], i) => add(fileNode(path), `${label}: rank ${i + 1} with ${n} file(s)`));
    record(name, ranked.length, Math.min(ranked.length, QUOTAS[name]));
  }

  // reading order: one walk per member repo, interleaved up to the cap
  const startOf = new Map();
  const starters = entries.filter((entry) => entry.fanOut >= 1);
  for (const entry of [...starters].sort((a, b) => startTier(a.path) - startTier(b.path) || a.depth - b.depth || b.fanOut - a.fanOut || compare(a.path, b.path))) {
    if (!startOf.has(entry.member)) startOf.set(entry.member, entry.path);
  }
  const members = [...new Set(fileGraph.codeFiles.map((path) => memberOf(path, memberIds)))].sort(compare);
  const walks = [...startOf].sort((a, b) => compare(a[0], b[0])).map(([member, path]) => ({ member, path, order: readingOrder(fileGraph, path, QUOTAS.bfsDepth) }));
  const taken = new Map();
  for (let step = 0; walks.some((walk) => step < walk.order.length); step++) {
    for (const walk of walks) {
      const item = walk.order[step];
      if (item && !taken.has(item.path)) taken.set(item.path, { ...item, member: walk.member });
    }
  }
  [...taken.values()].slice(0, QUOTAS.bfsMax).forEach(({ path, depth, member }, i) => {
    add(fileNode(path), `reading-order ${member === '' ? '(project)' : member}: step ${i + 1}, depth ${depth}`);
  });
  record('bfs', taken.size, Math.min(taken.size, QUOTAS.bfsMax));
  classes.bfs.rule = BFS_RULE;
  classes.bfs.starts = walks.map(({ member, path }) => ({ member: member === '' ? '(project)' : member, start: path }));
  classes.bfs.membersWithoutStart = members.filter((member) => !startOf.has(member)).map((member) => (member === '' ? '(project)' : member));

  // layers
  let layerTotal = 0;
  let layerListed = 0;
  for (const layer of layerChoice.layers) {
    const files = [...(layerIndex.filesOf.get(layer.id) ?? [])].filter((path) => fileGraph.in.has(path));
    const ranked = rankDescending(files.map((path) => [path, fanIn(path)]));
    layerTotal += ranked.length;
    layerListed += Math.min(ranked.length, QUOTAS.perLayer);
    ranked.slice(0, QUOTAS.perLayer).forEach(([path, n], i) => add(fileNode(path), `layer ${layer.id}: rank ${i + 1} with fan-in ${n}`));
  }
  record('layer', layerTotal, layerListed);

  // domain flows
  const domainSource = { state: domain.state };
  let flowTotal = 0;
  let flowListed = 0;
  if (domain.state === 'ok' && domain.reason === null) {
    const { flows, unresolved } = flowAnchors(domain, fileGraph);
    for (const flow of flows) {
      flowTotal += flow.anchors.length;
      const listed = flow.anchors.slice(0, QUOTAS.perFlow);
      flowListed += listed.length;
      listed.forEach((id) => add(fileGraph.nodesById.get(id), `flow ${flow.id}`));
    }
    domainSource.flows = flows.length;
    domainSource.anchorsNotInGraph = unresolved;
  } else if (domain.state === 'ok') {
    domainSource.state = 'different-revision';
    domainSource.reason = domain.reason;
    gaps.push(`domain-graph.json is a different revision, so there are no flow candidates: ${domain.reason}`);
  } else if (domain.state === 'unreadable') {
    domainSource.reason = domain.reason;
    gaps.push(`domain-graph.json is unreadable, so there are no flow candidates: ${domain.reason}`);
  }
  record('flow', flowTotal, flowListed);

  // non-code files
  const nonCodeFiles = [...fileGraph.nonCode].sort((a, b) => b[1].length - a[1].length || compare(a[0], b[0]));
  nonCodeFiles.slice(0, QUOTAS.nonCode).forEach(([path, nodes]) => {
    const types = [...new Set(nodes.map((node) => node.type))].sort(compare).join('/');
    const representative = fileNode(path) ?? [...nodes].sort((a, b) => (a.lineRange?.[0] ?? 0) - (b.lineRange?.[0] ?? 0) || compare(a.id, b.id))[0];
    add(representative, `non-code: ${nodes.length} ${types} node(s)`);
  });
  record('nonCode', nonCodeFiles.length, Math.min(nonCodeFiles.length, QUOTAS.nonCode));

  // visible buckets
  if (semantics.state !== 'ok') {
    gaps.push(semantics.state === 'absent'
      ? 'There is no semantic cache; summaries are the graph nodes\' own summaries.'
      : `semantic-cache.json cannot be used (${semantics.reason}); summaries are the graph nodes' own summaries.`);
  }
  if (layerChoice.source !== 'semantic-graph' && existsSync(join(dataDir, 'semantic-graph.json'))) {
    gaps.push(`semantic-graph.json is not used for layers (${semantics.state === 'ok' ? 'it holds no layers' : `the semantic cache is ${semantics.state}`}).`);
  }
  if (layerChoice.source === 'none') gaps.push('There are no layers (no semantic graph and no layer records in the knowledge graph).');
  if (layerIndex.unresolved > 0) gaps.push(`${layerIndex.unresolved} layer node id(s) are not nodes of the knowledge graph.`);
  if (fileGraph.filesWithoutFileNode > 0) gaps.push(`${fileGraph.filesWithoutFileNode} file path(s) have nodes but no file node and are not ranked.`);
  if (walks.length === 0) gaps.push('There is no entry candidate, so there is no reading order.');
  const summarised = [...candidates.values()].filter((candidate) => candidate.summary !== '').length;
  if (candidates.size > 0 && summarised === 0) gaps.push('No candidate has a summary.');

  return {
    format: CANDIDATES_FORMAT,
    factsDigest,
    sourceRevision: snapshot.revision,
    sources: {
      graph: { nodes: graph.nodes.length, edges: graph.edges.length, codeFiles: fileGraph.codeFiles.length, nonCodeFiles: fileGraph.nonCode.size, ignoredEdges: fileGraph.ignored },
      summaries: semantics.state === 'ok' ? 'semantic-cache' : 'graph',
      semantics: semantics.state === 'ok'
        ? { state: 'ok', ...semantics.counts }
        : { state: semantics.state, ...(semantics.reason ? { reason: semantics.reason } : {}) },
      layers: { source: layerChoice.source, count: layerChoice.layers.length },
      domain: domainSource,
    },
    classes: Object.fromEntries(CLASSES.map((name) => [name, classes[name]])),
    layers: layerChoice.layers.map(({ id, name, description }) => ({ id, name, description })),
    gaps,
    candidates: [...candidates.values()],
  };
}

/** `summary` and its provenance for a node: a fresh cache entry (blank when contradicted) or, without a readable cache, the graph's own summary. */
function summaryFields(node, summaries) {
  if (summaries === null) {
    const own = typeof node.summary === 'string' ? node.summary : '';
    return { summary: own, summarySource: own === '' ? 'none' : 'graph', verification: null };
  }
  const row = summaries.get(node.id);
  if (!row) return { summary: '', summarySource: 'none', verification: null };
  return { summary: row.summary, summarySource: row.summary === '' ? 'none' : 'semantic-cache', verification: row.verification ?? null };
}

/** Write `text` through a sibling temporary file and a rename, so a reader never sees half a file. */
export function writeAtomic(path, text) {
  const tmpPath = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tmpPath, text, 'utf-8');
    renameSync(tmpPath, path);
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw error;
  }
}

/** `.excavator/tour/`, created when absent; a link there is refused. */
export function ensureTourDir(dataDir) {
  const dir = join(dataDir, TOUR_DIR);
  if (existsSync(dir)) {
    if (!lstatSync(dir).isDirectory()) throw new Error(`${dir} is not a directory`);
  } else {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Compute the candidate set and write `.excavator/tour/candidates.json`; returns the product and its path. */
export function writeCandidates(rootArg) {
  const product = computeCandidates(rootArg);
  const dataDir = assertDataDir(bindProjectRoot(rootArg));
  const out = join(ensureTourDir(dataDir), CANDIDATES_FILE);
  writeAtomic(out, `${JSON.stringify(product, null, 2)}\n`);
  return { out, product };
}
