/**
 * validate-graph.mjs — layer checks read the layers of semantic-graph.json when the graph has none.
 *
 * Full writes the layers into semantic-graph.json next to the fact graph, so a fact graph has no layers of
 * its own. The CLI reads the sibling file; validateAgainstSource stays pure and takes the layers as input.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateAgainstSource, createSourceReader } from '../../../skills/excavator/validate-graph.mjs';

const VALIDATE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../skills/excavator/validate-graph.mjs');

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

const fileNode = (path) => ({
  id: `file:${path}`, type: 'file', name: path, filePath: path, summary: '', tags: [], complexity: 'simple',
});
const NODES = [fileNode('a.js'), fileNode('b.js')];

function graph(layers) {
  const g = {
    version: '1.0.0',
    project: { name: 'fixture', languages: [], frameworks: [], description: '', analyzedAt: '2026-10-27T00:00:00.000Z', gitCommitHash: null },
    nodes: NODES, edges: [], tour: [],
  };
  if (layers !== undefined) g.layers = layers;
  return g;
}

const layer = (id, nodeIds) => ({ id, name: id, description: id, nodeIds });
const ALL = [layer('l1', ['file:a.js']), layer('l2', ['file:b.js'])];

/** A project dir with sources, the graph file in `.excavator/`, and an optional sibling semantic graph (string = raw content). */
function setup({ graphLayers, semantic }) {
  const root = mkdtempSync(join(tmpdir(), 'excavator-semlayers-'));
  tempDirs.push(root);
  writeFileSync(join(root, 'a.js'), 'x\n');
  writeFileSync(join(root, 'b.js'), 'y\n');
  const dataDir = join(root, 'data');
  mkdirSync(dataDir, { recursive: true });
  const graphPath = join(dataDir, 'knowledge-graph.json');
  writeFileSync(graphPath, JSON.stringify(graph(graphLayers)));
  if (semantic !== undefined) {
    writeFileSync(join(dataDir, 'semantic-graph.json'), typeof semantic === 'string' ? semantic : JSON.stringify(semantic));
  }
  return { root, graphPath, dataDir };
}

function runCli({ root, graphPath, dataDir }) {
  const reportPath = join(dataDir, 'validation.json');
  const result = spawnSync(process.execPath, [
    VALIDATE, root, '--graph', graphPath, '--out', join(dataDir, 'validated.json'), '--report', reportPath,
  ], { encoding: 'utf-8' });
  expect(result.status).toBe(0);
  return JSON.parse(readFileSync(reportPath, 'utf-8')).issues;
}

const notInLayer = (issues) => issues.filter((i) => i.includes('not in any layer'));

describe('validate-graph CLI: layers from the sibling semantic-graph.json', () => {
  it('reports no layer issue when the semantic graph layers cover every file node once', () => {
    expect(runCli(setup({ semantic: { layers: ALL } }))).toEqual([]);
  });

  it('reports a layer that references a missing node', () => {
    const issues = runCli(setup({ semantic: { layers: [...ALL, layer('l3', ['file:ghost.js'])] } }));
    expect(issues).toContain("Layer 'l3' refs missing node 'file:ghost.js'");
  });

  it('reports a node in two layers', () => {
    const issues = runCli(setup({ semantic: { layers: [...ALL, layer('l3', ['file:a.js'])] } }));
    expect(issues).toContain("Node 'file:a.js' appears in multiple layers");
  });

  it('reports a file node left out of every layer', () => {
    const issues = runCli(setup({ semantic: { layers: [layer('l1', ['file:a.js'])] } }));
    expect(issues).toContain("File node 'file:b.js' not in any layer");
    expect(notInLayer(issues)).toHaveLength(1);
  });

  it.each([
    ['missing', undefined],
    ['not valid JSON', '{not json'],
    ['without layers', { model: 'm' }],
    ['with layers that is not an array', { layers: 'x' }],
    ['with an empty layers array', { layers: [] }],
  ])('a semantic graph that is %s leaves every file node reported', (_name, semantic) => {
    const issues = runCli(setup({ semantic }));
    expect(notInLayer(issues)).toHaveLength(2);
  });

  it('does not read the semantic graph when the graph has its own layers', () => {
    // The graph's own layers leave b.js out; the sibling file would cover it.
    const issues = runCli(setup({ graphLayers: [layer('own', ['file:a.js'])], semantic: { layers: ALL } }));
    expect(issues).toContain("File node 'file:b.js' not in any layer");
    expect(notInLayer(issues)).toHaveLength(1);
  });
});

describe('validateAgainstSource: optional layers input', () => {
  const run = (g, layers) => validateAgainstSource({ graph: g, reader: createSourceReader(tmpdir()), layers }).report.issues;

  it('uses the layers input when the graph has none', () => {
    expect(run(graph(), ALL)).toEqual([]);
    expect(notInLayer(run(graph(), undefined))).toHaveLength(2);
  });

  it('prefers the graph own layers over the input', () => {
    const issues = run(graph([layer('own', ['file:a.js'])]), ALL);
    expect(notInLayer(issues)).toHaveLength(1);
  });
});
