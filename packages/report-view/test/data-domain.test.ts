import { describe, expect, it } from 'vitest';

import { buildIndex } from '../src/data/indexes';
import { buildDomainIndex, domainCounts, resolveAnchors, type DomainEdge, type DomainNode } from '../src/data/domain';

const domain = (id: string): DomainNode => ({ id, type: 'domain', name: id, summary: `${id} summary` });
const flow = (id: string): DomainNode => ({ id, type: 'flow', name: id });
const step = (id: string, extra: Partial<DomainNode> = {}): DomainNode => ({ id, type: 'step', name: id, ...extra });
const contains = (source: string, target: string): DomainEdge => ({ source, target, type: 'contains_flow', weight: 1 });
const stepEdge = (source: string, target: string, weight?: number): DomainEdge => ({ source, target, type: 'flow_step', ...(weight === undefined ? {} : { weight }) });

const NODES = [domain('d1'), domain('d2'), flow('f1'), flow('f2'), step('s-a'), step('s-b'), step('s-c'), step('s-d'), step('s-e')];

describe('the steps of a flow', () => {
  it('are in flow_step weight order, whatever order the edges are written in', () => {
    const index = buildDomainIndex({
      nodes: NODES,
      edges: [contains('d1', 'f1'), stepEdge('f1', 's-c', 0.6), stepEdge('f1', 's-a', 0.9), stepEdge('f1', 's-b', 0.2)],
      gaps: [],
    });
    expect(index.stepsOf.get('f1')?.map((s) => s.node.id)).toEqual(['s-b', 's-c', 's-a']);
    expect(index.stepsOf.get('f1')?.map((s) => s.position)).toEqual([1, 2, 3]);
    expect(index.stepsOf.get('f1')?.map((s) => s.weight)).toEqual([0.2, 0.6, 0.9]);
  });

  it('are ordered by id when weights tie, and a step without a weight comes last', () => {
    const index = buildDomainIndex({
      nodes: NODES,
      edges: [stepEdge('f1', 's-d', 0.5), stepEdge('f1', 's-b', 0.5), stepEdge('f1', 's-a'), stepEdge('f1', 's-c', 0.1)],
      gaps: [],
    });
    expect(index.stepsOf.get('f1')?.map((s) => s.node.id)).toEqual(['s-c', 's-b', 's-d', 's-a']);
    expect(index.stepsOf.get('f1')?.[3].weight).toBeNull();
  });

  it('are the same for the same edges in the reverse order', () => {
    const edges = [stepEdge('f1', 's-a', 0.3), stepEdge('f1', 's-b', 0.3), stepEdge('f1', 's-c', 0.1), stepEdge('f1', 's-d', 0.7)];
    const one = buildDomainIndex({ nodes: NODES, edges, gaps: [] });
    const two = buildDomainIndex({ nodes: [...NODES].reverse(), edges: [...edges].reverse(), gaps: [] });
    expect(two.stepsOf.get('f1')?.map((s) => s.node.id)).toEqual(one.stepsOf.get('f1')?.map((s) => s.node.id));
  });

  it('count a step once per flow even when the same edge is written twice, and a step may be in two flows', () => {
    const index = buildDomainIndex({
      nodes: NODES,
      edges: [stepEdge('f1', 's-a', 0.2), stepEdge('f1', 's-a', 0.9), stepEdge('f2', 's-a', 0.4)],
      gaps: [],
    });
    expect(index.stepsOf.get('f1')?.map((s) => [s.node.id, s.weight])).toEqual([['s-a', 0.2]]);
    expect(index.stepsOf.get('f2')?.map((s) => s.node.id)).toEqual(['s-a']);
    expect(index.flowsOfStep.get('s-a')).toEqual(['f1', 'f2']);
  });
});

describe('the domain index', () => {
  const index = buildDomainIndex({
    nodes: [...NODES, flow('f-orphan'), step('s-orphan')],
    edges: [
      contains('d1', 'f1'), contains('d2', 'f2'),
      stepEdge('f1', 's-a', 0.1), stepEdge('f1', 's-b', 0.2), stepEdge('f2', 's-c', 0.1),
      { source: 'd1', target: 'd2', type: 'cross_domain', description: 'd1 feeds d2' },
      { source: 'd1', target: 'no-such-node', type: 'cross_domain' },
      { source: 'f1', target: 'd1', type: 'contains_flow' },
      { source: 'd1', target: 'd2', type: 'something_else' },
    ],
    gaps: [{ kind: 'k' }],
  });

  it('lists the domains, flows and steps by type, in the order written', () => {
    expect(index.domains.map((n) => n.id)).toEqual(['d1', 'd2']);
    expect(index.flows.map((n) => n.id)).toEqual(['f1', 'f2', 'f-orphan']);
    expect(index.steps.map((n) => n.id)).toEqual(['s-a', 's-b', 's-c', 's-d', 's-e', 's-orphan']);
  });

  it('puts each flow under its domain and counts what a domain holds', () => {
    expect(index.flowsOf.get('d1')?.map((n) => n.id)).toEqual(['f1']);
    expect(index.domainsOfFlow.get('f2')).toEqual(['d2']);
    expect(domainCounts(index, 'd1')).toEqual({ flows: 1, steps: 2 });
    expect(domainCounts(index, 'd2')).toEqual({ flows: 1, steps: 1 });
    expect(domainCounts(index, 'unknown')).toEqual({ flows: 0, steps: 0 });
  });

  it('keeps the cross-domain edges between two domains, with their descriptions', () => {
    expect(index.crossDomain.map((e) => [e.source, e.target, e.description])).toEqual([['d1', 'd2', 'd1 feeds d2']]);
  });

  it('keeps two cross-domain edges between the same domains when their descriptions differ, and one when they are the same', () => {
    const two = buildDomainIndex({
      nodes: NODES,
      edges: [
        { source: 'd1', target: 'd2', type: 'cross_domain', description: 'one' }, { source: 'd1', target: 'd2', type: 'cross_domain', description: 'two' },
        { source: 'd1', target: 'd2', type: 'cross_domain', description: 'one' }, { source: 'd2', target: 'd1', type: 'cross_domain', description: 'one' },
      ],
      gaps: [],
    });
    expect(two.crossDomain.map((e) => `${e.source}>${e.target}:${e.description}`)).toEqual(['d1>d2:one', 'd1>d2:two', 'd2>d1:one']);
  });

  it('says what it could not place: flows in no domain, steps in no flow, and edges it could not use', () => {
    expect(index.unplaced.flows.map((n) => n.id)).toEqual(['f-orphan']);
    expect(index.unplaced.steps.map((n) => n.id)).toEqual(['s-d', 's-e', 's-orphan']);
    expect(index.problems.join(' ')).toMatch(/2 edges name a node the domain graph does not have or join the wrong kinds of node/);
    expect(index.problems.join(' ')).toMatch(/1 edge has a type the viewer does not draw/);
  });

  it('is empty, with nothing to say, for a graph with no nodes', () => {
    const empty = buildDomainIndex({ nodes: [], edges: [], gaps: [] });
    expect(empty.domains).toEqual([]);
    expect(empty.problems).toEqual([]);
    expect(empty.unplaced).toEqual({ flows: [], steps: [] });
  });
});

describe('the nodes of the knowledge graph a step names', () => {
  const graph = buildIndex({
    nodes: [
      { id: 'file:src/a.js', type: 'file', name: 'a.js', filePath: 'src/a.js' },
      { id: 'function:src/a.js:run', type: 'function', name: 'run', filePath: 'src/a.js' },
    ],
    edges: [{ source: 'file:src/a.js', target: 'function:src/a.js:run', type: 'contains' }],
  });

  it('resolves each nodeIds entry against the graph, in order, and lists the ones the graph lacks', () => {
    const anchors = resolveAnchors(step('s', { nodeIds: ['function:src/a.js:run', 'function:src/gone.js:x', 'file:src/a.js'] }), graph);
    expect(anchors.found.map((n) => n.id)).toEqual(['function:src/a.js:run', 'file:src/a.js']);
    expect(anchors.missing).toEqual(['function:src/gone.js:x']);
  });

  it('adds the ids the Domain skill moved to unresolvedNodeIds, once each, after the ones it finds missing itself', () => {
    const anchors = resolveAnchors(step('s', { nodeIds: ['file:src/a.js', 'x:1'], unresolvedNodeIds: ['y:2', 'x:1', 'y:2'] }), graph);
    expect(anchors.found.map((n) => n.id)).toEqual(['file:src/a.js']);
    expect(anchors.missing).toEqual(['x:1', 'y:2']);
  });

  it('has nothing to resolve for a step with no nodeIds, and ignores entries that are not ids', () => {
    expect(resolveAnchors(step('s'), graph)).toEqual({ found: [], missing: [] });
    const odd = resolveAnchors(step('s', { nodeIds: ['file:src/a.js', 5 as unknown as string, 'file:src/a.js'] }), graph);
    expect(odd.found.map((n) => n.id)).toEqual(['file:src/a.js']);
    expect(odd.missing).toEqual([]);
  });
});
