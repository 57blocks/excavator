// openspec: changes/semantic-structure-digest, oracle O1 - `structureDigest` in
// the knowledge graph header covers nodes and edges only. Purpose-built trees run
// through the real Lazy driver: two trees that differ only by one route
// registration (an entry point record stream plus coverage and gaps, same nodes
// and edges) must share a structureDigest and differ in factsDigest; a changed
// node line or a dropped edge must change structureDigest.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';
import { coverageForDigest } from '../../skills/excavator/build-fact-graph.mjs';

const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';
const lines = (...text) => `${text.join('\n')}\n`;

function tree({ route, edge = true, shift = false }) {
  return {
    'app.js': lines(
      ...(shift ? [''] : []),
      "const express = require('express');",
      'const app = express();',
      'function health(req, res) {}',
      // The two variants keep the same line count; only this line registers a route.
      route ? "app.get('/health', health);" : 'void health;',
    ),
    'main.js': lines(
      ...(edge ? ["const util = require('./util');"] : ['const util = null;']),
      'function run() { return util; }',
    ),
    'util.js': lines('module.exports = {};'),
  };
}

describe('structureDigest', () => {
  const roots = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  async function headerOf(options) {
    const root = mkdtempSync(join(tmpdir(), 'excavator-structure-digest-'));
    roots.push(root);
    for (const [path, text] of Object.entries(tree(options))) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const result = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    expect(result.saveError).toBeNull();
    const graph = readKnowledgeGraph(join(root, '.excavator', KNOWLEDGE_GRAPH_FILE));
    return { graph, project: graph.project, result };
  }

  it('is written into the header by the Lazy driver, next to factsDigest', async () => {
    const { project, result } = await headerOf({ route: true });
    expect(project.structureDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(project.structureDigest).not.toBe(project.factsDigest);
    expect(result.factsDigest).toBe(project.factsDigest);
  });

  it('ignores a record stream, its coverage and its gaps: only the route differs', async () => {
    const withRoute = await headerOf({ route: true });
    const without = await headerOf({ route: false });
    // The route tree really carries the stream; the other really does not.
    expect(withRoute.graph.entryPoints.length).toBeGreaterThan(0);
    expect(without.graph.entryPoints).toHaveLength(0);
    // Nodes and edges are identical, so the guard below measures only the stream.
    expect(withRoute.graph.nodes.map((n) => n.id)).toEqual(without.graph.nodes.map((n) => n.id));
    expect(withRoute.graph.edges).toEqual(without.graph.edges);
    expect(withRoute.project.factsDigest).not.toBe(without.project.factsDigest);
    expect(withRoute.project.structureDigest).toBe(without.project.structureDigest);
  });

  it('changes when a node line changes', async () => {
    const base = await headerOf({ route: true });
    const shifted = await headerOf({ route: true, shift: true });
    expect(shifted.project.structureDigest).not.toBe(base.project.structureDigest);
  });

  it('changes when an edge is dropped', async () => {
    const base = await headerOf({ route: true });
    const dropped = await headerOf({ route: true, edge: false });
    expect(dropped.graph.edges.length).toBeLessThan(base.graph.edges.length);
    expect(dropped.project.structureDigest).not.toBe(base.project.structureDigest);
  });
});

describe('coverageForDigest', () => {
  it('subtracts pre-extraction skips, drops empty languages, and does not mutate its input', () => {
    const coverage = {
      files: 5, ignored: 3, selection: { x: 1 },
      byLanguage: {
        typescript: { files: 3, skipped: { 'filtered-by-ignore': 1, sensitive: 1, 'too-large': 1 } },
        json: { files: 2, skipped: { 'filtered-by-defaults': 2 } },
      },
    };
    const before = JSON.stringify(coverage);
    const out = coverageForDigest(coverage);
    expect(JSON.stringify(coverage)).toBe(before);
    expect(out.selection).toBeUndefined();
    expect(out.byLanguage.json).toBeUndefined();
    expect(out.byLanguage.typescript).toEqual({ files: 1, skipped: { 'too-large': 1 } });
    expect(out.files).toBe(1);
    expect(out.ignored).toBe(0);
  });
});
