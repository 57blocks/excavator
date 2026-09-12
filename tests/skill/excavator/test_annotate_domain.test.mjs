/**
 * annotate-domain.mjs — anchoring business steps to knowledge-graph nodes,
 * and the validator's `step-unanchored` over a domain graph.
 *
 * The failure this pair exists to prevent is a step that LOOKS anchored: a
 * `nodeIds` entry the model composed out of a path and a name, which resolves
 * to nothing. So the tests check the two halves separately — a supplied id
 * that does not resolve must leave the anchor list and be counted, and a step
 * that ends up with no anchor at all must reach the validator as a gap rather
 * than being quietly marked inferred by the script that failed to anchor it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  annotateDomain, deriveStepNodes, indexKnowledge, usableRange,
} from '../../../skills/excavator-domain/annotate-domain.mjs';
import { validateAgainstSource, createSourceReader } from '../../../skills/excavator/validate-graph.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const ANNOTATE_DOMAIN = resolve(repoRoot, 'skills/excavator-domain/annotate-domain.mjs');

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'excavator-domain-'));
  roots.push(dir);
  return dir;
}

/** A knowledge graph with one file node and two declarations in it. */
function knowledge() {
  return {
    version: '1.0.0',
    project: { name: 'fixture', languages: ['typescript'], gitCommitHash: null },
    nodes: [
      {
        id: 'file:src/orders/create.ts', type: 'file', name: 'create.ts',
        filePath: 'src/orders/create.ts', summary: 'order creation', tags: ['t'], complexity: 'simple',
      },
      {
        id: 'function:src/orders/create.ts:validateOrder', type: 'function', name: 'validateOrder',
        filePath: 'src/orders/create.ts', lineRange: [12, 31],
        summary: 'validates', tags: ['t'], complexity: 'simple',
      },
      {
        id: 'function:src/orders/create.ts:persistOrder', type: 'function', name: 'persistOrder',
        filePath: 'src/orders/create.ts', lineRange: [40, 70],
        summary: 'persists', tags: ['t'], complexity: 'simple',
      },
    ],
    edges: [],
    layers: [],
    tour: [],
  };
}

function step(id, overrides = {}) {
  return {
    id, type: 'step', name: id, summary: 'a step', tags: ['t'], complexity: 'simple',
    filePath: 'src/orders/create.ts', ...overrides,
  };
}

function domain(nodes) {
  return {
    version: '1.0.0',
    project: { name: 'fixture', languages: ['typescript'], gitCommitHash: null },
    nodes: [
      { id: 'domain:orders', type: 'domain', name: 'Orders', summary: 'orders', tags: ['t'], complexity: 'simple' },
      { id: 'flow:create-order', type: 'flow', name: 'Create Order', summary: 'creates', tags: ['t'], complexity: 'simple' },
      ...nodes,
    ],
    edges: [
      { source: 'domain:orders', target: 'flow:create-order', type: 'contains_flow', direction: 'forward', weight: 1.0 },
      ...nodes.map((node, i) => ({
        source: 'flow:create-order', target: node.id, type: 'flow_step',
        direction: 'forward', weight: (i + 1) / 10,
      })),
    ],
    layers: [],
    tour: [],
  };
}

function gapOf(graph, kind) {
  return (graph.gaps ?? []).find(g => g.kind === kind);
}

function stepOf(graph, id) {
  return graph.nodes.find(n => n.id === id);
}

describe('supplied nodeIds are checked, not trusted', () => {
  it('keeps a resolvable id and moves an invented one out of the anchor list', () => {
    const nodes = [step('step:create-order:validate', {
      lineRange: [12, 31],
      nodeIds: [
        'function:src/orders/create.ts:validateOrder',
        'function:src/orders/create.ts:doesNotExist',
      ],
    })];
    const { annotated, report } = annotateDomain({ domainGraph: domain(nodes), knowledgeGraph: knowledge() });

    const anchored = stepOf(annotated, 'step:create-order:validate');
    expect(anchored.nodeIds).toEqual(['function:src/orders/create.ts:validateOrder']);
    expect(anchored.unresolvedNodeIds).toEqual(['function:src/orders/create.ts:doesNotExist']);
    expect(report.counts.modelIdsResolved).toBe(1);
    expect(report.counts.modelIdsUnresolved).toBe(1);

    const gap = gapOf(annotated, 'step-nodeid-unresolved');
    expect(gap.count).toBe(1);
    expect(gap.samples[0]).toContain('doesNotExist');
  });

  it('cites the line of the node it resolved', () => {
    const nodes = [step('step:create-order:validate', {
      lineRange: [12, 31], nodeIds: ['function:src/orders/create.ts:validateOrder'],
    })];
    const { annotated } = annotateDomain({ domainGraph: domain(nodes), knowledgeGraph: knowledge() });
    expect(stepOf(annotated, 'step:create-order:validate').evidence).toEqual([
      { file: 'src/orders/create.ts', line: 12, source: 'rule' },
    ]);
  });
});

describe('missing nodeIds are derived from file plus line intersection', () => {
  it('derives the declaration whose range the step overlaps', () => {
    const nodes = [step('step:create-order:persist', { lineRange: [45, 60] })];
    const { annotated, report } = annotateDomain({ domainGraph: domain(nodes), knowledgeGraph: knowledge() });

    expect(stepOf(annotated, 'step:create-order:persist').nodeIds)
      .toEqual(['function:src/orders/create.ts:persistOrder']);
    expect(report.counts.idsDerived).toBe(1);
    expect(report.counts.stepsFileAnchored).toBe(0);
  });

  it('derives every declaration a wide range covers, in line order', () => {
    const nodes = [step('step:create-order:whole', { lineRange: [1, 100] })];
    const { annotated } = annotateDomain({ domainGraph: domain(nodes), knowledgeGraph: knowledge() });
    expect(stepOf(annotated, 'step:create-order:whole').nodeIds).toEqual([
      'function:src/orders/create.ts:validateOrder',
      'function:src/orders/create.ts:persistOrder',
    ]);
  });

  it('falls back to the file node, counted as the weaker anchor it is', () => {
    for (const range of [undefined, [0, 0], [200, 300]]) {
      const nodes = [step('step:create-order:file', range === undefined ? {} : { lineRange: range })];
      const { annotated, report } = annotateDomain({ domainGraph: domain(nodes), knowledgeGraph: knowledge() });
      expect(stepOf(annotated, 'step:create-order:file').nodeIds).toEqual(['file:src/orders/create.ts']);
      expect(report.counts.stepsFileAnchored).toBe(1);
      // A file node has no line, so there is nothing to cite — and nothing is
      // invented to fill the gap.
      expect(stepOf(annotated, 'step:create-order:file').evidence).toBeUndefined();
      expect(gapOf(annotated, 'step-evidence-unavailable').count).toBe(1);
    }
  });

  it('adds derived ids beside the model\'s resolvable ones without duplicating', () => {
    const nodes = [step('step:create-order:both', {
      lineRange: [1, 100], nodeIds: ['function:src/orders/create.ts:persistOrder'],
    })];
    const { annotated } = annotateDomain({ domainGraph: domain(nodes), knowledgeGraph: knowledge() });
    expect(stepOf(annotated, 'step:create-order:both').nodeIds).toEqual([
      'function:src/orders/create.ts:persistOrder',
      'function:src/orders/create.ts:validateOrder',
    ]);
  });

  it('leaves a step with no file path unanchored and does not mark it inferred', () => {
    const nodes = [step('step:create-order:nowhere', { filePath: undefined })];
    delete nodes[0].filePath;
    const { annotated, report } = annotateDomain({ domainGraph: domain(nodes), knowledgeGraph: knowledge() });

    const unanchored = stepOf(annotated, 'step:create-order:nowhere');
    expect(unanchored.nodeIds).toBeUndefined();
    // Silencing the validator from inside the script that failed to anchor it
    // is the one move that would make the gap invisible.
    expect(unanchored.provenance).toBeUndefined();
    expect(report.counts.stepsUnanchored).toBe(1);
    expect(gapOf(annotated, 'step-unanchored')).toBeUndefined();
  });

  it('anchors nothing when there is no knowledge graph to anchor to', () => {
    const nodes = [step('step:create-order:validate', { lineRange: [12, 31] })];
    const { annotated, report } = annotateDomain({ domainGraph: domain(nodes), knowledgeGraph: null });
    expect(stepOf(annotated, 'step:create-order:validate').nodeIds).toBeUndefined();
    expect(report.counts.knowledgeNodes).toBe(0);
    expect(report.counts.stepsUnanchored).toBe(1);
  });

  it('accounts for every step and is idempotent', () => {
    const nodes = [
      step('step:create-order:a', { lineRange: [12, 31] }),
      step('step:create-order:b', { nodeIds: ['nope'] }),
      step('step:create-order:c', { filePath: 'src/unknown.ts' }),
    ];
    const first = annotateDomain({ domainGraph: domain(nodes), knowledgeGraph: knowledge() });
    expect(first.report.counts.stepsTotal).toBe(3);
    expect(first.report.conserves).toBe(true);

    const second = annotateDomain({ domainGraph: first.annotated, knowledgeGraph: knowledge() });
    expect(JSON.stringify(second.annotated)).toBe(JSON.stringify(first.annotated));
    expect((second.annotated.gaps ?? []).filter(g => g.kind === 'step-nodeid-unresolved')).toHaveLength(1);
  });

  it('treats a zero or reversed range as no range at all', () => {
    expect(usableRange([0, 0])).toBe(false);
    expect(usableRange([5, 3])).toBe(false);
    expect(usableRange([1, 1])).toBe(true);
    expect(usableRange(undefined)).toBe(false);
    expect(usableRange(['1', '2'])).toBe(false);
  });

  it('indexes and derives without a file path in the knowledge graph', () => {
    const index = indexKnowledge({ nodes: [{ id: 'domain:x', type: 'domain', name: 'x' }] });
    expect(index.byId.has('domain:x')).toBe(true);
    expect(deriveStepNodes({ filePath: 'src/a.ts' }, index)).toEqual({ nodes: [], viaFile: false });
  });
});

describe('the validator counts an unanchored step on a domain graph', () => {
  function validate(domainGraph) {
    const root = tempRoot();
    return validateAgainstSource({ graph: domainGraph, reader: createSourceReader(root) });
  }

  it('reports step-unanchored for a step with neither nodeIds nor inferred', () => {
    const nodes = [step('step:create-order:nowhere', { filePath: undefined })];
    delete nodes[0].filePath;
    const { validated, report } = validate(domain(nodes));

    expect(report.counts.stepUnanchored).toBe(1);
    expect(report.findings.stepUnanchored[0].nodeId).toBe('step:create-order:nowhere');
    const gap = (validated.gaps ?? []).find(g => g.kind === 'step-unanchored');
    expect(gap.count).toBe(1);
    expect(gap.samples).toEqual(['step:create-order:nowhere']);
  });

  it('reports step-unanchored for nodeIds that name nothing in the graph', () => {
    const nodes = [step('step:create-order:ghost', { nodeIds: ['function:src/ghost.ts:nope'] })];
    const { report } = validate(domain(nodes));
    expect(report.counts.stepUnanchored).toBe(1);
    expect(report.findings.stepUnanchored[0].reason).toContain('none of the step');
  });

  it('accepts a step whose nodeIds are in the graph', () => {
    // The domain graph carries its own copy of the anchored node, as the
    // domain graph consumers receive it.
    const domainGraph = domain([step('step:create-order:validate', {
      lineRange: [12, 31], nodeIds: ['function:src/orders/create.ts:validateOrder'],
    })]);
    domainGraph.nodes.push(knowledge().nodes[1]);
    domainGraph.edges.push({
      source: 'step:create-order:validate', target: 'function:src/orders/create.ts:validateOrder',
      type: 'related', direction: 'forward', weight: 0.5, provenance: 'inferred',
    });
    const { report } = validate(domainGraph);
    expect(report.counts.stepUnanchored).toBe(0);
  });

  it('accepts a step that says out loud it is inferred', () => {
    const nodes = [step('step:create-order:judged', { filePath: undefined, provenance: 'inferred' })];
    delete nodes[0].filePath;
    const { report } = validate(domain(nodes));
    expect(report.counts.stepUnanchored).toBe(0);
  });
});

describe('annotate-domain CLI', () => {
  function fixture({ withKnowledge = true } = {}) {
    const root = tempRoot();
    const intermediate = join(root, '.excavator', 'intermediate');
    mkdirSync(intermediate, { recursive: true });
    writeFileSync(join(intermediate, 'domain-analysis.json'), JSON.stringify(domain([
      step('step:create-order:validate', { lineRange: [12, 31] }),
      step('step:create-order:ghost', { nodeIds: ['function:src/ghost.ts:nope'], filePath: 'src/ghost.ts' }),
    ])), 'utf-8');
    if (withKnowledge) {
      writeFileSync(join(root, '.excavator', 'knowledge-graph.json'), JSON.stringify(knowledge()), 'utf-8');
    }
    return { root, intermediate };
  }

  it('updates the analysis in place and writes the report', () => {
    const { root, intermediate } = fixture();
    const result = spawnSync(process.execPath, [ANNOTATE_DOMAIN, root], { encoding: 'utf-8', cwd: repoRoot });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('steps=2');
    expect(result.stderr).toContain('model-ids-unresolved=1');

    const annotated = JSON.parse(readFileSync(join(intermediate, 'domain-analysis.json'), 'utf-8'));
    expect(stepOf(annotated, 'step:create-order:validate').nodeIds)
      .toEqual(['function:src/orders/create.ts:validateOrder']);
    expect(stepOf(annotated, 'step:create-order:ghost').unresolvedNodeIds)
      .toEqual(['function:src/ghost.ts:nope']);

    const report = JSON.parse(readFileSync(join(intermediate, 'domain-annotation.json'), 'utf-8'));
    expect(report.scriptCompleted).toBe(true);
    expect(report.counts.stepsAnchored).toBe(1);
    expect(report.counts.stepsUnanchored).toBe(1);
  });

  it('warns rather than failing when no knowledge graph exists', () => {
    const { root } = fixture({ withKnowledge: false });
    const result = spawnSync(process.execPath, [ANNOTATE_DOMAIN, root], { encoding: 'utf-8', cwd: repoRoot });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('no knowledge graph at');
    expect(result.stderr).toContain('anchored=0');
  });

  it('rejects an unknown option', () => {
    const { root } = fixture();
    const result = spawnSync(process.execPath, [ANNOTATE_DOMAIN, root, '--anchor'], { encoding: 'utf-8', cwd: repoRoot });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown option');
  });
});

describe('the domain skill wires the anchoring phase in additively', () => {
  const skill = readFileSync(resolve(repoRoot, 'skills/excavator-domain/SKILL.md'), 'utf-8');

  it('adds phase 4.5 between the analysis and the save', () => {
    const at = heading => skill.indexOf(heading);
    expect(at('### Phase 4.5: Anchor Steps (added)')).toBeGreaterThan(at('### Phase 4: Domain Analysis'));
    expect(at('### Phase 4.5: Anchor Steps (added)')).toBeLessThan(at('### Phase 5: Validate and Save'));
  });

  it('runs both the anchoring script and the source validator', () => {
    const section = skill.slice(
      skill.indexOf('### Phase 4.5: Anchor Steps (added)'),
      skill.indexOf('### Phase 5: Validate and Save'),
    );
    expect(section).toContain('annotate-domain.mjs');
    expect(section).toContain('skills/excavator/validate-graph.mjs');
    expect(section).toContain('step-unanchored');
    expect(section).toContain('step-nodeid-unresolved');
    expect(section).toContain('Supplement, so not fatal.');
  });

  it('publishes a queryable service artifact without a display step', () => {
    expect(skill).toContain('queryable domain graph');
    expect(skill).toContain('### Phase 6: Service Ready');
    expect(skill).not.toContain('/excavator-dashboard');
    expect(skill).not.toContain('Open your browser');
  });
});
