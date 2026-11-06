/**
 * The skills that read knowledge-graph.jsonl find the architecture layers as
 * their Reading Layers section says. The layers live in two places: a Full
 * run writes them to semantic-graph.json with the factDigest of the facts
 * they were made from, and an incremental update writes them to the graph as
 * `{"record":"layer","layer":{...}}` lines. The only graph line with a
 * `"layers"` key is the header, whose `counts.layers` is a number, so a step
 * that greps `"layers"` gets no layer. These tests pin every graph skill to
 * one Reading Layers section and run its commands against products written by
 * the store and by semantic-graph.mjs.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';
import { buildSemanticGraph, writeSemanticGraph } from '../../skills/excavator/semantic-graph.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LAYER_RECORD = '"record":"layer"';
const LAYERS_KEY = '"layers"';
const SECTION_LINK = '**Reading Layers**';
const NO_LAYERS = 'never group files into layers yourself';

const skillPath = (name) => resolve(repoRoot, 'skills', name, 'SKILL.md');
const read = (name) => readFileSync(skillPath(name), 'utf-8');

/** The skills whose Graph Structure Reference documents the layer line. */
const GRAPH_SKILLS = readdirSync(resolve(repoRoot, 'skills'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(skillPath(entry.name)))
  .map((entry) => entry.name)
  .filter((name) => read(name).includes('{"record":"layer","layer":'))
  .sort();

/** The `## Reading Layers` section, up to the next `##` heading; null when there is none. */
const readingLayers = (text) => text.split(/^## Reading Layers$/m)[1]?.split(/^## /m)[0] ?? null;

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

/** What is wrong with how a graph skill reads its layers; empty when nothing is. */
function layerProblems(text) {
  const problems = [];
  const section = readingLayers(text);
  if (section === null) problems.push('has no ## Reading Layers section');
  else {
    for (const needed of ['semantic-graph.json', 'factDigest', LAYER_RECORD, NO_LAYERS]) {
      if (!section.includes(needed)) problems.push(`its Reading Layers section does not name ${needed}`);
    }
  }
  const steps = layerSteps(text);
  if (steps.length !== 1) problems.push(`expected one layer step under ## Instructions, found ${steps.length}`);
  for (const step of steps) {
    if (!step.includes(SECTION_LINK)) problems.push(`the layer step does not point to ${SECTION_LINK}: ${step.split('\n')[0]}`);
  }
  if (text.includes(LAYERS_KEY)) problems.push(`names ${LAYERS_KEY}, which only the header line has`);
  return problems;
}

describe('graph skills read the layers as one Reading Layers section says', () => {
  it('finds the skills that read knowledge-graph.jsonl', () => {
    expect(GRAPH_SKILLS).toEqual(expect.arrayContaining(['excavator-chat', 'excavator-diff', 'excavator-explain', 'excavator-onboard']));
  });

  it.each(GRAPH_SKILLS)('%s reads its layers as its Reading Layers section says', (name) => {
    expect(layerProblems(read(name))).toEqual([]);
  });

  it('every graph skill has the same Reading Layers section', () => {
    const sections = new Set(GRAPH_SKILLS.map((name) => readingLayers(read(name))));
    expect(sections.has(null)).toBe(false);
    expect(sections.size).toBe(1);
  });

  const mutations = {
    'greps "layers" in its layer step': (text) => text.replaceAll(SECTION_LINK, `\`${LAYERS_KEY}\``),
    'drops the rule for no layers': (text) => text.replaceAll(NO_LAYERS, 'group the files'),
    'drops the semantic graph': (text) => text.replaceAll('semantic-graph.json', 'knowledge-graph.jsonl'),
  };
  for (const [what, mutate] of Object.entries(mutations)) {
    it.each(GRAPH_SKILLS)(`%s fails the check when it ${what}`, (name) => {
      const text = read(name);
      const mutated = mutate(text);
      expect(mutated).not.toBe(text);
      expect(layerProblems(mutated).length).toBeGreaterThan(0);
    });
  }
});

describe('the Reading Layers commands give what the rule reads, on real products', () => {
  const section = readingLayers(read('excavator-onboard')) ?? '';
  const block = section.match(/^```bash\n([\s\S]*?)^```$/m)?.[1] ?? '';
  const commands = block.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  const dir = mkdtempSync(join(tmpdir(), 'graph-skill-layers-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const NODE = 'file:src/a.ts';
  const BRACKETED = 'file:app/[id]/page.tsx';
  const node = (id, filePath, type = 'file') => ({ id, type, name: filePath, filePath, summary: '', tags: [], complexity: 'simple' });
  const nodes = [
    node(NODE, 'src/a.ts'),
    { ...node('function:src/a.ts:run', 'src/a.ts', 'function'), name: 'run' },
    node('file:src/a.tsx', 'src/a.tsx'),
    node(BRACKETED, 'app/[id]/page.tsx'),
  ];
  const layers = [
    { id: 'layer:service', name: 'Service', description: 'Business logic', nodeIds: [NODE] },
    { id: 'layer:ui', name: 'UI', description: 'Views', nodeIds: ['file:src/a.tsx', BRACKETED] },
  ];

  /** A project whose graph has `factsDigest` and `graphLayers`, and a semantic graph made from `semanticDigest` when given. */
  function project(name, { factsDigest, graphLayers, semanticDigest }) {
    const root = join(dir, name);
    const dataDir = join(root, '.excavator');
    mkdirSync(dataDir, { recursive: true });
    writeKnowledgeGraph(join(dataDir, 'knowledge-graph.jsonl'), {
      version: '1.0.0',
      project: { name, languages: ['typescript'], frameworks: [], description: '', analyzedAt: '', gitCommitHash: '', factsDigest },
      nodes,
      edges: [{ source: NODE, target: 'function:src/a.ts:run', type: 'contains', direction: 'forward', weight: 1 }],
      layers: graphLayers,
      tour: [],
    });
    if (semanticDigest) {
      const { semanticGraph } = buildSemanticGraph({ factDigest: semanticDigest, factNodeIds: nodes.map((n) => n.id), layers });
      writeSemanticGraph(dataDir, semanticGraph);
    }
    return root;
  }

  /** Every command's exit status and output lines in `root`, with `<node id>` filled in. */
  function run(root, id) {
    return commands.map((command) => {
      const result = spawnSync('sh', ['-c', command.replaceAll('<node id>', id)], { cwd: root, encoding: 'utf-8' });
      return { command, status: result.status, lines: result.stdout.split('\n').filter(Boolean) };
    });
  }
  const pick = (runs, ...parts) => {
    const found = runs.filter((r) => parts.every((part) => r.command.includes(part)));
    expect(found, parts.join(' ')).toHaveLength(1);
    return found[0];
  };
  const layerIds = (lines) => lines.map((line) => JSON.parse(line)).map((value) => (value.record === 'layer' ? value.layer : value).id);

  it('the section has the six commands the rule reads', () => {
    expect(commands).toHaveLength(6);
  });

  it('after a Full run: the digests match and jq lists the semantic graph\'s layers', () => {
    const root = project('full', { factsDigest: 'digest-a', graphLayers: [], semanticDigest: 'digest-a' });
    for (const [id, own] of [[NODE, 'layer:service'], [BRACKETED, 'layer:ui']]) {
      const runs = run(root, id);
      const digests = [pick(runs, '.factDigest'), pick(runs, '.factsDigest')].map((r) => r.lines);
      expect(digests).toEqual([['digest-a'], ['digest-a']]);
      expect(layerIds(pick(runs, 'jq -c \'.layers[]\'').lines)).toEqual(['layer:service', 'layer:ui']);
      expect(layerIds(pick(runs, 'jq -c --arg id').lines)).toEqual([own]);
      expect(pick(runs, 'grep', 'grep -F').lines).toEqual([]);
    }
  });

  it('after an incremental update: the digests differ and grep lists the layer lines', () => {
    const root = project('incremental', { factsDigest: 'digest-b', graphLayers: layers, semanticDigest: 'digest-a' });
    for (const [id, own] of [[NODE, 'layer:service'], [BRACKETED, 'layer:ui']]) {
      const runs = run(root, id);
      const digests = [pick(runs, '.factDigest'), pick(runs, '.factsDigest')].map((r) => r.lines);
      expect(digests).toEqual([['digest-a'], ['digest-b']]);
      const all = runs.filter((r) => r.command.startsWith('grep') && !r.command.includes('grep -F'));
      expect(all).toHaveLength(1);
      expect(layerIds(all[0].lines)).toEqual(['layer:service', 'layer:ui']);
      // the quoted ID does not match file:src/a.tsx, and the brackets are not a pattern
      expect(layerIds(pick(runs, 'grep -F').lines)).toEqual([own]);
    }
  });

  it('with no layers: there is no semantic graph and grep finds no layer line', () => {
    const root = project('lazy', { factsDigest: 'digest-c', graphLayers: [] });
    const runs = run(root, NODE);
    expect(pick(runs, '.factDigest').status).not.toBe(0);
    expect(pick(runs, '.factsDigest').lines).toEqual(['digest-c']);
    expect(runs.filter((r) => r.command.startsWith('grep')).flatMap((r) => r.lines)).toEqual([]);
  });
});
