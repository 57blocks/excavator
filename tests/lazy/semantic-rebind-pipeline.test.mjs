// openspec: changes/semantic-structure-digest, oracle O4 - the re-bind end to end
// through the real Lazy driver. A semantic graph written before it bound
// structureDigest (its factDigest is the facts digest of the algorithm without
// the entry point stream) is re-bound by the next Lazy run when the nodes and
// edges are unchanged, the viewer then reads its layers, and a changed node
// makes the viewer reject it for its structureDigest.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';
import { computeFactsDigest, coverageForDigest } from '../../skills/excavator/build-fact-graph.mjs';
import { SEMANTIC_GRAPH_FILE, buildSemanticGraph, rebindSemanticGraph } from '../../skills/excavator/semantic-graph.mjs';
import { ENTRY_POINT_GAP_REASONS } from '../../skills/excavator/entry-point-resolution.mjs';
import { readSemantics } from '../../skills/excavator-view/semantics.mjs';

const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';
const lines = (...text) => `${text.join('\n')}\n`;

const TREE = {
  'app.js': lines(
    "const express = require('express');",
    'const app = express();',
    'function health(req, res) {}',
    "app.get('/health', health);",
  ),
  'util.js': lines('module.exports = {};'),
};

describe('a semantic graph written before structureDigest, through the Lazy driver', () => {
  let root;
  let dataDir;
  const readGraph = () => readKnowledgeGraph(join(dataDir, KNOWLEDGE_GRAPH_FILE));
  const semanticsNow = () => readSemantics(dataDir, readFileSync(join(dataDir, KNOWLEDGE_GRAPH_FILE)));
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'excavator-semantic-rebind-'));
    dataDir = join(root, '.excavator');
    for (const [path, text] of Object.entries(TREE)) write(path, text);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('re-binds on the next run when the nodes and edges are unchanged, and the viewer reads the layers', async () => {
    const first = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    expect(first.saveError).toBeNull();
    expect(first.semanticGraph.status).toBe('absent');
    const graph = readGraph();
    expect(graph.entryPoints.length).toBeGreaterThan(0);

    // The facts digest before the entry point stream existed, computed here from the graph on disk.
    const coverage = coverageForDigest(graph.coverage);
    delete coverage.entryPoints;
    const entryKinds = new Set(Object.keys(ENTRY_POINT_GAP_REASONS));
    const oldDigest = computeFactsDigest({
      nodes: graph.nodes, edges: graph.edges, coverage, gaps: graph.gaps.filter((gap) => !entryKinds.has(gap.kind)),
    });
    expect(oldDigest).not.toBe(graph.project.factsDigest);

    const fileIds = graph.nodes.filter((n) => n.type === 'file').map((n) => n.id);
    const { semanticGraph } = buildSemanticGraph({
      structureDigest: 'placeholder',
      factNodeIds: graph.nodes.map((n) => n.id),
      layers: [{ id: 'layer:app', name: 'Application', description: 'Handles requests.', nodeIds: fileIds }],
      generatedAt: FIXED_NOW(),
    });
    const legacy = {};
    for (const [key, value] of Object.entries(semanticGraph)) {
      if (key === 'structureDigest') legacy.factDigest = oldDigest;
      else legacy[key] = value;
    }
    writeFileSync(join(dataDir, SEMANTIC_GRAPH_FILE), JSON.stringify(legacy, null, 2));
    writeFileSync(join(dataDir, 'semantic-cache.json'), JSON.stringify({ version: '3.0.0', contentLanguage: 'en', entries: {} }));

    // Before the re-bind the viewer refuses it and says how it is re-bound.
    const before = semanticsNow();
    expect(before.state).toBe('unreadable');
    expect(before.reason).toMatch(/\/excavator re-binds it/);

    const second = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    expect(second.saveError).toBeNull();
    expect(second.semanticGraph.status).toBe('rebound');

    const onDisk = JSON.parse(readFileSync(join(dataDir, SEMANTIC_GRAPH_FILE), 'utf-8'));
    expect(onDisk).not.toHaveProperty('factDigest');
    expect(onDisk.structureDigest).toBe(readGraph().project.structureDigest);
    expect(onDisk.layers).toEqual(legacy.layers);

    const after = semanticsNow();
    expect(after.state).toBe('ok');
    expect(after.counts.layers).toBe(1);

    // A third run finds it bound and does not write.
    const third = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    expect(third.semanticGraph.status).toBe('bound');
  }, 60_000);

  it('is unreadable for the viewer after a node changes, naming structureDigest', async () => {
    write('app.js', lines('// moved down one line', ...TREE['app.js'].trimEnd().split('\n')));
    const run = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    expect(run.saveError).toBeNull();
    expect(run.semanticGraph.status).toBe('stale');
    const result = semanticsNow();
    expect(result.state).toBe('unreadable');
    expect(result.reason).toContain('structureDigest');
  }, 60_000);

  it('leaves a legacy file whose nodes changed untouched and reports unbound', async () => {
    const graph = readGraph();
    const legacyBytes = JSON.stringify({
      version: '2.0.0', contentLanguage: 'en', languageAudit: { status: 'accepted', inspected: 0, accepted: [], rejected: [] },
      factDigest: 'f'.repeat(64), layers: [], relations: [], gaps: [], model: 'm', generatedAt: FIXED_NOW(),
    }, null, 2);
    writeFileSync(join(dataDir, SEMANTIC_GRAPH_FILE), legacyBytes);
    const result = rebindSemanticGraph({ dataDir, projection: { ...graph, ...graph.project, structureDigest: graph.project.structureDigest } });
    expect(result.status).toBe('unbound');
    expect(readFileSync(join(dataDir, SEMANTIC_GRAPH_FILE), 'utf-8')).toBe(legacyBytes);
  });
});
