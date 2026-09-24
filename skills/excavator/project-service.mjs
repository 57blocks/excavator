/** Shared deterministic project operations. No model, provider, or answer generation. */
import { existsSync, readFileSync } from 'node:fs';

import { assertDataFile, assertDataTree, assertSourcePath, bindProjectRoot, ProjectBoundaryError } from './project-paths.mjs';
import { resolveSourceSnapshot } from './source-snapshot.mjs';
import { PIPELINE_VERSION } from './lazy-analyze.mjs';
import { syncFactGraph } from './sync-fact-graph.mjs';
import { LEGACY_SOURCE_INDEX_FILE, SOURCE_INDEX_FILE, readSourceIndex } from './source-index-store.mjs';
import { bm25Search, boundedBFS, boundedShortestPath, mergeCandidates, oneHop } from './retrieve.mjs';
import { isFresh, commitSemanticCacheEntry } from './semantic-cache.mjs';
import { planSemanticCacheReuse } from './semantic-cache-reuse.mjs';

const LIMITS = Object.freeze({ terms: 12, termLength: 80, exactIds: 20, candidates: 50, offset: 500,
  seeds: 10, nodes: 500, edges: 1000, hops: 8, evidenceLines: 200, evidenceChars: 20_000,
  planNodes: 20, planEvidenceChars: 4_000 });

function boundedInt(value, fallback, maximum, label, minimum = 1) {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n < minimum || n > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return n;
}

function boundedStrings(values, maximum, maxLength, label) {
  if (!Array.isArray(values) || values.length > maximum || values.some((v) => typeof v !== 'string' || !v || v.length > maxLength)) {
    throw new Error(`${label} must be an array of at most ${maximum} nonempty strings (max ${maxLength} characters each)`);
  }
  return values;
}

function readJsonProduct(root, name, expectedArray, gaps) {
  const path = assertDataFile(root, name);
  if (!existsSync(path)) {
    gaps.push({ kind: 'missing-product', product: name });
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    if (expectedArray && !Array.isArray(parsed?.[expectedArray])) throw new Error(`expected ${expectedArray} array`);
    return parsed;
  } catch (error) {
    gaps.push({ kind: 'invalid-product', product: name, reason: error.message });
    return null;
  }
}

/** The source index reads through the line-oriented store (design D1/D2),
 *  never a bare `JSON.parse` — the whole index can be gigabytes as a single
 *  string. Missing/invalid gap shapes mirror `readJsonProduct`'s contract
 *  (design D3): a `missing-product` gap additionally names whether a stale
 *  legacy `source-index.json` is the only thing present (its content is
 *  never parsed — zero-compat), and an `invalid-product` gap carries the
 *  store's own validation failure reason. */
function readSourceIndexProduct(root, gaps) {
  const path = assertDataFile(root, SOURCE_INDEX_FILE);
  if (!existsSync(path)) {
    const gap = { kind: 'missing-product', product: SOURCE_INDEX_FILE };
    if (existsSync(assertDataFile(root, LEGACY_SOURCE_INDEX_FILE))) {
      gap.legacyProductPresent = LEGACY_SOURCE_INDEX_FILE;
    }
    gaps.push(gap);
    return null;
  }
  try {
    return readSourceIndex(path);
  } catch (error) {
    gaps.push({ kind: 'invalid-product', product: SOURCE_INDEX_FILE, reason: error.message });
    return null;
  }
}

function snapshotIdentity(snapshot, manifest) {
  const freshness = !manifest ? 'missing'
    : manifest.sourceRevision === snapshot.revision
      && manifest.selectionDigest === snapshot.selectionDigest
      && manifest.pipelineVersion === PIPELINE_VERSION ? 'fresh' : 'stale';
  return {
    revision: snapshot.revision,
    kind: snapshot.kind,
    selectionDigest: snapshot.selectionDigest,
    manifestRevision: manifest?.sourceRevision ?? null,
    freshness,
  };
}

function envelope(status, snapshot, data = null, { gaps = [], budget = null, boundary = null, error = null } = {}) {
  return { status, snapshot, data, coverage: { gapsCount: gaps.length }, gaps, budget, boundary, error };
}

function fileNodeMap(graph) {
  return new Map((graph?.nodes ?? []).filter((n) => n.type === 'file').map((n) => [n.filePath, n]));
}

function sourcePreview(root, snapshot, manifest, node, maxChars) {
  const path = assertSourcePath(root, node.filePath, snapshot);
  if (!(manifest?.entries ?? []).some((e) => e.path === path)) {
    throw new ProjectBoundaryError(`source path is not in current manifest: ${path}`);
  }
  const lines = snapshot.readFile(path).toString('utf-8').split('\n');
  const requestedStart = node.lineRange?.[0] ?? 1;
  const requestedEnd = node.lineRange?.[1] ?? lines.length;
  if (!Number.isInteger(requestedStart) || !Number.isInteger(requestedEnd)
    || requestedStart < 1 || requestedEnd < requestedStart || requestedEnd > lines.length) {
    throw new Error(`fact node has an invalid source line range: ${node.id}`);
  }
  const startLine = requestedStart;
  const endLine = requestedEnd;
  const segment = lines.slice(startLine - 1, endLine).join('\n');
  return {
    path, startLine, endLine, text: segment.slice(0, maxChars),
    complete: segment.length <= maxChars,
    requiredChars: segment.length,
  };
}

/** One fixed root; CLI and MCP call these same functions, not separate algorithms. */
export function createProjectService(projectRoot, { snapshotFactory = resolveSourceSnapshot } = {}) {
  const root = bindProjectRoot(projectRoot);

  function open(expectedRevision = null) {
    assertDataTree(root);
    const snapshot = snapshotFactory(root);
    const gaps = [];
    const manifest = readJsonProduct(root, 'source-manifest.json', 'entries', gaps);
    const identity = snapshotIdentity(snapshot, manifest);
    if (expectedRevision && expectedRevision !== identity.revision) {
      return { stale: envelope('stale-snapshot', identity, null, {
        gaps: [{ kind: 'expected-revision-mismatch', expectedRevision, currentRevision: identity.revision }],
        error: { code: 'stale-snapshot', retryable: true },
      }) };
    }
    return { snapshot, manifest, identity, gaps };
  }

  function finish(start, status, data, options = {}) {
    const current = snapshotFactory(root);
    if (current.revision !== start.identity.revision || current.selectionDigest !== start.identity.selectionDigest) {
      return envelope('stale-snapshot', snapshotIdentity(current, start.manifest), null, {
        gaps: [{ kind: 'source-changed-during-call' }], error: { code: 'stale-snapshot', retryable: true },
      });
    }
    return envelope(status, start.identity, data, { ...options, gaps: [...start.gaps, ...(options.gaps ?? [])] });
  }

  function requiredFacts(start, { index = false } = {}) {
    if (start.identity.freshness !== 'fresh') {
      return { unavailable: finish(start, 'stale-snapshot', null, {
        gaps: [{ kind: 'facts-not-current', freshness: start.identity.freshness }],
        error: { code: 'stale-snapshot', retryable: true },
      }) };
    }
    const graph = readJsonProduct(root, 'knowledge-graph.json', 'nodes', start.gaps);
    const sourceIndex = index ? readSourceIndexProduct(root, start.gaps) : null;
    if (!graph || (index && !sourceIndex)) {
      return { unavailable: finish(start, 'unavailable', null, { error: { code: 'missing-product', retryable: true } }) };
    }
    if (sourceIndex?.sourceRevision && sourceIndex.sourceRevision !== start.identity.revision) {
      return { unavailable: finish(start, 'stale-snapshot', null, {
        gaps: [{ kind: 'stale-index', sourceRevision: sourceIndex.sourceRevision }],
        error: { code: 'stale-snapshot', retryable: true },
      }) };
    }
    return { graph, sourceIndex };
  }

  return {
    root,
    projectStatus({ expectedRevision = null } = {}) {
      const start = open(expectedRevision);
      if (start.stale) return start.stale;
      const graph = readJsonProduct(root, 'knowledge-graph.json', 'nodes', start.gaps);
      const index = readSourceIndexProduct(root, start.gaps);
      if (index && index.sourceRevision !== start.identity.revision) {
        start.gaps.push({ kind: 'stale-index', sourceRevision: index.sourceRevision ?? null });
      }
      const status = start.identity.freshness === 'fresh' && graph ? 'ok' : 'unavailable';
      return finish(start, status, {
        projectRoot: root,
        analysisMode: graph?.project?.analysisMode ?? (graph?.project?.pipelineVersion === PIPELINE_VERSION ? 'lazy' : 'unknown'),
        factsDigest: graph?.project?.factsDigest ?? null,
        nodeCount: graph?.nodes?.length ?? 0,
        edgeCount: graph?.edges?.length ?? 0,
        indexAvailable: !!index && index.sourceRevision === start.identity.revision,
        factCoverage: graph?.coverage ?? null,
      }, { gaps: graph?.gaps ?? [] });
    },
    async syncFacts() {
      const start = open();
      try {
        const result = await syncFactGraph({ projectRoot: root });
        const after = open();
        const graph = readJsonProduct(root, 'knowledge-graph.json', 'nodes', after.gaps);
        const status = result.saveError ? 'error' : after.identity.freshness === 'fresh' && graph ? 'ok' : 'stale-snapshot';
        return envelope(status, after.identity, {
          kind: result.kind, changed: result.changed, metaAdvanced: result.metaAdvanced,
          beforeRevision: start.identity.revision, afterRevision: after.identity.revision,
          factsDigest: graph?.project?.factsDigest ?? null,
          factCoverage: graph?.coverage ?? null,
        }, { gaps: after.gaps,
          error: result.saveError ? { code: 'sync-failed', message: result.saveError }
            : status === 'stale-snapshot' ? { code: 'stale-snapshot', retryable: true } : null });
      } catch (error) {
        const after = open();
        return envelope('error', after.identity, null, { gaps: after.gaps,
          error: { code: 'sync-failed', message: error.message, retryable: true } });
      }
    },
    async recall({ terms = [], exactIds = [], paths = [], limit = 20, offset = 0, expectedRevision = null } = {}) {
      boundedStrings(terms, LIMITS.terms, LIMITS.termLength, 'terms');
      boundedStrings(exactIds, LIMITS.exactIds, 300, 'exactIds');
      boundedStrings(paths, LIMITS.exactIds, 300, 'paths');
      const take = boundedInt(limit, 20, LIMITS.candidates, 'limit');
      const skip = boundedInt(offset, 0, LIMITS.offset, 'offset', 0);
      if (!terms.length && !exactIds.length && !paths.length) throw new Error('recall requires explicit terms, exactIds, or paths');
      const start = open(expectedRevision);
      if (start.stale) return start.stale;
      const facts = requiredFacts(start, { index: true });
      if (facts.unavailable) return facts.unavailable;
      const { graph, sourceIndex } = facts;
      const manifestPaths = new Set(start.manifest.entries.map((e) => e.path));
      const pathSet = new Set(paths.map((p) => assertSourcePath(root, p, start.snapshot)));
      const exactSet = new Set(exactIds);
      const lowered = terms.map((x) => x.toLowerCase());
      const exact = graph.nodes.filter((n) => manifestPaths.has(n.filePath)
        && (exactSet.has(n.id) || pathSet.has(n.filePath)
        || lowered.some((t) => n.name?.toLowerCase() === t || n.id.toLowerCase() === t))
        )
        .slice(0, 200).map((n) => ({ nodeId: n.id, path: n.filePath, symbol: n.name, lineRange: n.lineRange }));
      const bm25 = terms.length ? bm25Search(sourceIndex, terms, Math.min(200, skip + take + 50)).map((r) => ({
        chunkId: r.chunkId, nodeId: r.chunk?.nodeId ?? undefined, path: r.chunk?.path,
        symbol: r.chunk?.symbol, lineRange: r.chunk?.lineRange, score: r.score,
      })).filter((r) => manifestPaths.has(r.path)) : [];
      const files = fileNodeMap(graph);
      const sourceSearch = terms.length ? start.snapshot.search(terms).filter((r) => manifestPaths.has(r.path)).slice(0, 200).map((r) => ({
        nodeId: files.get(r.path)?.id, path: r.path, line: r.line, text: r.text.slice(0, 160), term: r.term,
      })) : [];
      const cache = readJsonProduct(root, 'semantic-cache.json', null, start.gaps) ?? { entries: {} };
      const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
      const hashByPath = new Map(start.manifest.entries.map((e) => [e.path, e.contentHash]));
      const semanticCacheText = Object.entries(cache.entries ?? {}).flatMap(([nodeId, entry]) => {
        const node = nodeById.get(nodeId);
        if (!node || !manifestPaths.has(node.filePath) || !isFresh(entry, hashByPath.get(node.filePath), cache)) return [];
        const haystack = `${entry.summary} ${(entry.tags ?? []).join(' ')}`.toLowerCase();
        const hits = lowered.filter((t) => haystack.includes(t)).length;
        return hits ? [{ nodeId, path: node.filePath, symbol: node.name, score: hits }] : [];
      }).slice(0, 200);
      const merged = mergeCandidates({ exact, bm25, sourceSearch, semanticCacheText });
      const candidates = merged.slice(skip, skip + take);
      return finish(start, 'ok', { candidates }, {
        gaps: exactIds.filter((id) => !nodeById.has(id) || !manifestPaths.has(nodeById.get(id)?.filePath))
          .map((id) => ({ kind: nodeById.has(id) ? 'path-not-in-manifest' : 'unknown-node', nodeId: id })),
        budget: { limit: take, offset: skip, used: candidates.length, total: merged.length },
        boundary: { truncated: skip + take < merged.length, nextOffset: skip + take < merged.length ? skip + take : null },
      });
    },
    traverse({ seedIds = [], targetIds = [], mode = 'bfs', maxHops = 4, maxNodes = 80, maxEdges = 160, expectedRevision = null } = {}) {
      boundedStrings(seedIds, LIMITS.seeds, 300, 'seedIds');
      boundedStrings(targetIds, LIMITS.seeds, 300, 'targetIds');
      if (!seedIds.length) throw new Error('traverse requires at least one seedId');
      if (!['one-hop', 'bfs', 'shortest-path'].includes(mode)) throw new Error('invalid traversal mode');
      const hops = boundedInt(maxHops, 4, LIMITS.hops, 'maxHops');
      const nodesLimit = boundedInt(maxNodes, 80, LIMITS.nodes, 'maxNodes');
      const edgesLimit = boundedInt(maxEdges, 160, LIMITS.edges, 'maxEdges');
      const start = open(expectedRevision);
      if (start.stale) return start.stale;
      const facts = requiredFacts(start);
      if (facts.unavailable) return facts.unavailable;
      const manifestPaths = new Set(start.manifest.entries.map((e) => e.path));
      const nodeById = new Map(facts.graph.nodes.filter((n) => manifestPaths.has(n.filePath)).map((n) => [n.id, n]));
      const validEdges = facts.graph.edges.filter((e) => nodeById.has(e.source) && nodeById.has(e.target));
      const seeds = [...new Set(seedIds.filter((id) => nodeById.has(id)))];
      const targets = [...new Set(targetIds.filter((id) => nodeById.has(id)))];
      const gaps = [...seedIds, ...targetIds].filter((id) => !nodeById.has(id)).map((nodeId) => ({ kind: 'unknown-node', nodeId }));
      if (!seeds.length) return finish(start, 'unavailable', { nodes: [], edges: [] }, { gaps, error: { code: 'no-valid-seeds' } });
      if (mode === 'shortest-path' && !targets.length) throw new Error('shortest-path requires a valid targetId');
      const budgets = { maxSeeds: LIMITS.seeds, maxNodes: nodesLimit, maxEdges: edgesLimit };
      const raw = mode === 'one-hop' ? oneHop(validEdges, seeds, { budgets })
        : mode === 'shortest-path' ? boundedShortestPath(validEdges, seeds, targets, { maxHops: hops, budgets })
          : boundedBFS(validEdges, seeds, { maxHops: hops, budgets });
      const visited = new Set(raw.nodes);
      const fringe = new Set();
      if (raw.boundary.truncated) for (const edge of validEdges) {
        if (visited.has(edge.source) && !visited.has(edge.target)) fringe.add(edge.target);
        if (visited.has(edge.target) && !visited.has(edge.source)) fringe.add(edge.source);
      }
      const boundary = { ...raw.boundary, unexpandedNodeIds: [...fringe].slice(0, 200),
        unexpandedCount: fringe.size, unexpandedListTruncated: fringe.size > 200 };
      return finish(start, 'ok', {
        seedIds: seeds, nodes: raw.nodes.map((id) => {
          const n = nodeById.get(id);
          return { id, type: n?.type, name: n?.name, filePath: n?.filePath, lineRange: n?.lineRange };
        }), edges: raw.edges, ...(mode === 'shortest-path' ? { path: raw.path } : {}),
      }, { gaps, budget: { maxHops: hops, maxNodes: nodesLimit, maxEdges: edgesLimit,
        usedNodes: raw.nodes.length, usedEdges: raw.edges?.length ?? 0 }, boundary });
    },
    readEvidence({ path = null, nodeId = null, startLine = null, startColumn = 1,
      endLine = null, maxChars = 8_000, expectedRevision = null } = {}) {
      if (!!path === !!nodeId) throw new Error('provide exactly one of path or nodeId');
      const chars = boundedInt(maxChars, 8_000, LIMITS.evidenceChars, 'maxChars');
      const start = open(expectedRevision);
      if (start.stale) return start.stale;
      if (start.identity.freshness !== 'fresh') return finish(start, 'stale-snapshot', null, {
        gaps: [{ kind: 'facts-not-current', freshness: start.identity.freshness }],
        error: { code: 'stale-snapshot', retryable: true },
      });
      const graph = nodeId ? readJsonProduct(root, 'knowledge-graph.json', 'nodes', start.gaps) : null;
      if (nodeId && !graph) return finish(start, 'unavailable', null, {
        error: { code: 'missing-product', retryable: true },
      });
      const node = nodeId ? graph.nodes.find((n) => n.id === nodeId) : null;
      if (nodeId && !node) return finish(start, 'unavailable', null, {
        gaps: [{ kind: 'unknown-node', nodeId }], error: { code: 'unknown-node' },
      });
      const rel = assertSourcePath(root, path ?? node.filePath, start.snapshot);
      if (!start.manifest.entries.some((e) => e.path === rel)) return finish(start, 'unavailable', null, {
        gaps: [{ kind: 'path-not-in-manifest', path: rel }], error: { code: 'path-not-in-manifest' },
      });
      const allLines = start.snapshot.readFile(rel).toString('utf-8').split('\n');
      const first = boundedInt(startLine, node?.lineRange?.[0] ?? 1, allLines.length, 'startLine');
      const column = boundedInt(startColumn, 1, Math.max(1, allLines[first - 1].length + 1), 'startColumn');
      const last = boundedInt(endLine, Math.min(node?.lineRange?.[1] ?? allLines.length, first + LIMITS.evidenceLines - 1), allLines.length, 'endLine');
      if (last < first || last - first + 1 > LIMITS.evidenceLines) throw new Error(`line range must be at most ${LIMITS.evidenceLines} lines`);
      const selectedLines = allLines.slice(first - 1, last);
      selectedLines[0] = selectedLines[0].slice(column - 1);
      const full = selectedLines.join('\n');
      const text = full.slice(0, chars);
      const truncated = full.length > chars || last < (node?.lineRange?.[1] ?? allLines.length);
      const consumedLines = text.split('\n');
      const nextStartLine = full.length > chars ? first + consumedLines.length - 1
        : last < allLines.length ? last + 1 : null;
      const nextStartColumn = full.length > chars
        ? (consumedLines.length === 1 ? column : 1) + consumedLines.at(-1).length
        : nextStartLine === null ? null : 1;
      return finish(start, 'ok', { path: rel, nodeId, startLine: first, startColumn: column, endLine: last, text }, {
        budget: { maxChars: chars, usedChars: text.length, maxLines: LIMITS.evidenceLines, usedLines: last - first + 1 },
        boundary: { truncated, nextStartLine, nextStartColumn,
          reason: full.length > chars ? 'character-budget' : last < allLines.length ? 'line-budget' : 'complete' },
      });
    },
    async semanticPlan({ nodeIds = [], maxEvidenceChars = 4_000, expectedRevision = null } = {}) {
      boundedStrings(nodeIds, LIMITS.planNodes, 300, 'nodeIds');
      if (!nodeIds.length) throw new Error('semantic_plan requires nodeIds');
      const chars = boundedInt(maxEvidenceChars, 4_000, LIMITS.planEvidenceChars, 'maxEvidenceChars');
      const start = open(expectedRevision);
      if (start.stale) return start.stale;
      const facts = requiredFacts(start);
      if (facts.unavailable) return facts.unavailable;
      const cache = readJsonProduct(root, 'semantic-cache.json', null, start.gaps) ?? { entries: {} };
      const plan = planSemanticCacheReuse({ requestedNodeIds: nodeIds, nodes: facts.graph.nodes,
        manifestEntries: start.manifest.entries, semanticCache: cache });
      const byId = new Map(facts.graph.nodes.map((n) => [n.id, n]));
      const generate = plan.generate.map((item) => {
        const evidence = sourcePreview(root, start.snapshot, start.manifest, byId.get(item.nodeId), chars);
        return { ...item, evidence };
      });
      const gaps = plan.unavailable.map((item) => ({ kind: item.reason, nodeId: item.nodeId, filePath: item.filePath }));
      for (const item of generate) if (!item.evidence.complete) gaps.push({ kind: 'evidence-truncated', nodeId: item.nodeId });
      return finish(start, 'ok', { ...plan, generate, constraints: {
        contentLanguage: 'en', cacheable: ['summary', 'tags', 'semanticSourceHash', 'model', 'generatedAt', 'verification'],
        rule: 'Only node-local semantics after reading complete current local source; cross-file conclusions and answers stay outside cache.',
      } }, { gaps, budget: { maxEvidenceChars: chars }, boundary: {
        truncated: generate.some((x) => !x.evidence.complete),
        nodeIdsNeedingMoreEvidence: generate.filter((x) => !x.evidence.complete).map((x) => x.nodeId),
      } });
    },
    async semanticCommit({ nodeId, filePath, fields, expectedRevision = null } = {}) {
      const start = open(expectedRevision);
      if (start.stale) return start.stale;
      const facts = requiredFacts(start);
      if (facts.unavailable) return facts.unavailable;
      const node = facts.graph.nodes.find((n) => n.id === nodeId);
      if (!node || node.filePath !== filePath) return finish(start, 'unavailable', null, {
        gaps: [{ kind: 'node-path-mismatch', nodeId, filePath }], error: { code: 'node-path-mismatch' },
      });
      assertSourcePath(root, filePath, start.snapshot);
      const result = await commitSemanticCacheEntry({ projectRoot: root, nodeId, filePath, fields,
        verifyNodePath: true, onlyIfNotFresh: true });
      return finish(start, result.ok ? 'ok' : result.status, result, {
        error: result.ok ? null : { code: result.status, retryable: ['lock-held', 'stale-hash', 'io-error'].includes(result.status) },
      });
    },
  };
}

export default { createProjectService };
