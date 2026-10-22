/**
 * The skills that read knowledge-graph.jsonl find the architecture layers
 * with a Grep. The store writes one `{"record":"layer","layer":{...}}` line
 * per layer, and the only line with a `"layers"` key is the header, whose
 * `counts.layers` is a number: a layer step that greps `"layers"` gets the
 * header and no layer. These tests pin every graph skill's layer step to the
 * layer records and check those patterns against a graph the store writes.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LAYER_RECORD = '"record":"layer"';
const LAYERS_KEY = '"layers"';

const skillPath = (name) => resolve(repoRoot, 'skills', name, 'SKILL.md');
const read = (name) => readFileSync(skillPath(name), 'utf-8');

/** The skills whose Graph Structure Reference documents the layer line. */
const GRAPH_SKILLS = readdirSync(resolve(repoRoot, 'skills'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(skillPath(entry.name)))
  .map((entry) => entry.name)
  .filter((name) => read(name).includes('{"record":"layer","layer":'))
  .sort();

/**
 * The numbered steps under `## Instructions`, up to the next `##` or `###`
 * heading, whose bold title names a layer. A step is its numbered line and
 * the blank or indented lines after it.
 */
function layerSteps(text) {
  const instructions = text.split(/^## Instructions$/m)[1]?.split(/^##+ /m)[0] ?? '';
  const steps = [];
  let current = null;
  for (const line of instructions.split('\n')) {
    if (/^\d+\. /.test(line)) {
      current = [line];
      steps.push(current);
    } else if (current && (line === '' || /^\s/.test(line))) {
      current.push(line);
    } else {
      current = null;
    }
  }
  return steps.map((lines) => lines.join('\n')).filter((step) => /^\d+\. \*\*[^*]*\blayers?\b/i.test(step));
}

/** What is wrong with a graph skill's layer step; empty when nothing is. */
function layerStepProblems(text) {
  const problems = [];
  const steps = layerSteps(text);
  if (steps.length !== 1) problems.push(`expected one layer step under ## Instructions, found ${steps.length}`);
  for (const step of steps) {
    if (!step.includes(LAYER_RECORD)) problems.push(`the layer step does not grep ${LAYER_RECORD}: ${step.split('\n')[0]}`);
  }
  if (text.includes(LAYERS_KEY)) problems.push(`names ${LAYERS_KEY}, which only the header line has`);
  return problems;
}

describe('graph skills read the layer records', () => {
  it('finds the skills that read knowledge-graph.jsonl', () => {
    expect(GRAPH_SKILLS).toEqual(expect.arrayContaining(['excavator-chat', 'excavator-diff', 'excavator-explain', 'excavator-onboard']));
  });

  it.each(GRAPH_SKILLS)('%s greps the layer records in its layer step', (name) => {
    expect(layerStepProblems(read(name))).toEqual([]);
  });

  it.each(GRAPH_SKILLS)('%s fails the check when its layer step greps "layers" again', (name) => {
    const text = read(name);
    const reverted = text.replaceAll(`\`${LAYER_RECORD}\``, `\`${LAYERS_KEY}\``);
    expect(reverted).not.toBe(text);
    expect(layerStepProblems(reverted).length).toBeGreaterThan(0);
  });
});

describe('the layer patterns match the lines the store writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'graph-skill-layers-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const layers = [
    { id: 'layer:service', name: 'Service', description: 'Business logic', nodeIds: ['file:src/a.ts'] },
    { id: 'layer:ui', name: 'UI', description: 'Views', nodeIds: ['file:src/a.tsx'] },
  ];
  const path = join(dir, 'knowledge-graph.jsonl');
  writeKnowledgeGraph(path, {
    version: '1.0.0',
    project: { name: 'fixture', languages: ['typescript'], frameworks: [], description: 'layers', analyzedAt: '', gitCommitHash: '' },
    nodes: [
      { id: 'file:src/a.ts', type: 'file', name: 'a.ts', filePath: 'src/a.ts', summary: '', tags: [], complexity: 'simple' },
      { id: 'function:src/a.ts:run', type: 'function', name: 'run', filePath: 'src/a.ts', summary: '', tags: [], complexity: 'simple' },
      { id: 'file:src/a.tsx', type: 'file', name: 'a.tsx', filePath: 'src/a.tsx', summary: '', tags: [], complexity: 'simple' },
    ],
    edges: [{ source: 'file:src/a.ts', target: 'function:src/a.ts:run', type: 'contains', direction: 'forward', weight: 1 }],
    layers,
    tour: [],
  });
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
  const layerLines = lines.filter((line) => line.includes(LAYER_RECORD));

  it('"record":"layer" matches every layer line and nothing else', () => {
    expect(layerLines.map((line) => JSON.parse(line))).toEqual(layers.map((layer) => ({ record: 'layer', layer })));
  });

  it('"layers" matches only the header, which holds no layer', () => {
    const hits = lines.filter((line) => line.includes(LAYERS_KEY));
    expect(hits).toEqual([lines[0]]);
    expect(JSON.parse(hits[0])).toMatchObject({ record: 'header', counts: { layers: 2 } });
  });

  it('a quoted file node ID finds its own layer only', () => {
    const hits = layerLines.filter((line) => line.includes('"file:src/a.ts"'));
    expect(hits.map((line) => JSON.parse(line).layer.id)).toEqual(['layer:service']);
  });
});
