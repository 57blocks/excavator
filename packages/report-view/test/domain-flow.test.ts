import { describe, expect, it } from 'vitest';

import { buildDomainIndex, type DomainEdge, type DomainNode } from '../src/data/domain';
import { buildDomainLevel, domainEdges, domainNodes, layoutDomainLevel, layoutsAsGrid, type DomainView } from '../src/lib/domain-flow';
import { CLUSTER_SIZE } from '../src/lib/graph-layout';
import { resolvePlace, type DomainPlace } from '../src/lib/domain-state';
import { MAX_LABELLED_EDGES } from '../src/lib/graph-flow';

const node = (id: string, type: string, extra: Partial<DomainNode> = {}): DomainNode => ({ id, type, name: `Name of ${id}`, summary: `About ${id}.`, ...extra });
const edge = (source: string, target: string, type: string, extra: Partial<DomainEdge> = {}): DomainEdge => ({ source, target, type, ...extra });

const NODES = [
  node('domain:a', 'domain'), node('domain:b', 'domain'), node('domain:c', 'domain'),
  node('flow:x', 'flow', { domainMeta: { entryPoint: 'POST /x', entryType: 'http' } }), node('flow:y', 'flow'), node('flow:z', 'flow'),
  node('step:1', 'step', { filePath: 'src/a.js', lineRange: [3, 9] }), node('step:2', 'step'), node('step:3', 'step'), node('step:4', 'step'),
  node('flow:lost', 'flow'), node('step:lost', 'step'),
];
const EDGES = [
  edge('domain:a', 'flow:x', 'contains_flow'), edge('domain:a', 'flow:y', 'contains_flow'), edge('domain:b', 'flow:z', 'contains_flow'),
  // Written out of order on purpose: the weights say step:2, step:3, step:1.
  edge('flow:x', 'step:1', 'flow_step', { weight: 0.9 }), edge('flow:x', 'step:2', 'flow_step', { weight: 0.1 }), edge('flow:x', 'step:3', 'flow_step', { weight: 0.5 }),
  edge('flow:y', 'step:4', 'flow_step', { weight: 0.2 }),
  edge('domain:a', 'domain:b', 'cross_domain', { description: 'A tells B.' }),
  edge('domain:a', 'domain:b', 'cross_domain', { description: 'A also asks B.' }),
  edge('domain:b', 'domain:c', 'cross_domain', { description: 'B feeds C.' }),
  edge('domain:c', 'domain:b', 'cross_domain', { description: 'C answers B.' }),
];
const index = buildDomainIndex({ nodes: NODES, edges: EDGES, gaps: [] });
const at = (domain: string | null, flow: string | null): DomainPlace => resolvePlace(index, { domain, flow, node: null }) as DomainPlace;

describe('the top level', () => {
  const level = buildDomainLevel(index, at(null, null));

  it('draws one card for each domain, with its summary, its flow count and its step count', () => {
    expect(level.entries.map((e) => [e.id, e.kind, e.flows, e.steps])).toEqual([['domain:a', 'domain', 2, 4], ['domain:b', 'domain', 1, 0], ['domain:c', 'domain', 0, 0]]);
    expect(level.entries[0]).toMatchObject({ label: 'Name of domain:a', summary: 'About domain:a.' });
  });

  it('sums the flows and steps of the cards it draws', () => {
    expect(level.flows).toBe(3);
    expect(level.steps).toBe(4);
  });

  it('draws one link for each pair of domains the cross_domain edges join, with every description of the pair', () => {
    expect(level.links.map((l) => [l.source, l.target, l.kind, l.lines])).toEqual([
      ['domain:a', 'domain:b', 'cross-domain', ['A tells B.', 'A also asks B.']],
      ['domain:b', 'domain:c', 'cross-domain', ['Name of domain:b to Name of domain:c: B feeds C.', 'Name of domain:c to Name of domain:b: C answers B.']],
    ]);
    expect(level.links.map((l) => l.backward)).toEqual([false, true]);
  });

  it('says what it does not draw: the flows in no domain and the steps in no flow', () => {
    expect(level.notes.join(' ')).toContain('1 flow is in no domain and 1 step is in no flow; they are not drawn.');
  });

  it('is a single crumb', () => {
    expect(level.crumbs).toEqual([{ label: 'Domains', hash: null }]);
    expect(level.key).toBe('top');
  });
});

describe('a domain', () => {
  const level = buildDomainLevel(index, at('domain:a', null));

  it('draws its flows with their step counts and entry points, and no links', () => {
    expect(level.entries.map((e) => [e.id, e.kind, e.steps, e.meta])).toEqual([['flow:x', 'flow', 3, 'POST /x (http)'], ['flow:y', 'flow', 1, null]]);
    expect(level.links).toEqual([]);
    expect(level.entries[0].openTo).toEqual({ domain: 'domain:a', flow: 'flow:x' });
  });

  it('has the domain in its crumbs, the first of them leading back to the top', () => {
    expect(level.crumbs).toEqual([{ label: 'Domains', hash: '#/domain' }, { label: 'Name of domain:a', hash: null }]);
  });
});

describe('a flow', () => {
  const level = buildDomainLevel(index, at('domain:a', 'flow:x'));

  it('draws its steps as a column in flow_step weight order, numbered by place', () => {
    expect(level.entries.map((e) => [e.id, e.kind, e.position, e.weight])).toEqual([['step:2', 'step', 1, 0.1], ['step:3', 'step', 2, 0.5], ['step:1', 'step', 3, 0.9]]);
    expect(level.entries[2].meta).toBe('src/a.js:3-9');
  });

  it('joins each step to the next with a sequence link, in that order, and says these are not edges of the graph', () => {
    expect(level.links.map((l) => [l.source, l.target, l.kind, l.lines])).toEqual([['step:2', 'step:3', 'sequence', []], ['step:3', 'step:1', 'sequence', []]]);
    expect(level.notes.join(' ')).toMatch(/arrows follow the flow_step weights.*not edges of the domain graph/);
  });

  it('has the domain and the flow in its crumbs', () => {
    expect(level.crumbs.map((c) => [c.label, c.hash])).toEqual([['Domains', '#/domain'], ['Name of domain:a', '#/domain?d=domain%3Aa'], ['Name of flow:x', null]]);
  });

  it('draws a flow with one step and no link, and a flow with no step and nothing', () => {
    expect(buildDomainLevel(index, at('domain:a', 'flow:y')).links).toEqual([]);
    const empty = buildDomainIndex({ nodes: [node('domain:q', 'domain'), node('flow:q', 'flow')], edges: [edge('domain:q', 'flow:q', 'contains_flow')], gaps: [] });
    const flow = buildDomainLevel(empty, resolvePlace(empty, { domain: 'domain:q', flow: 'flow:q', node: null }) as DomainPlace);
    expect(flow.entries).toEqual([]);
  });
});

describe('the nodes and edges handed to the canvas', () => {
  const view = (extra: Partial<DomainView> = {}): DomainView => ({ selected: null, hovered: null, hoveredEdge: null, onOpen: () => {}, onSelect: () => {}, ...extra });

  it('lays a level out through the shared layout and gives every entry a node', async () => {
    const level = buildDomainLevel(index, at(null, null));
    const layout = await layoutDomainLevel(level);
    expect(layout.boxes.size).toBe(3);
    const nodes = domainNodes(level, layout, view({ selected: 'domain:b' }));
    expect(nodes.map((n) => n.id)).toEqual(['domain:a', 'domain:b', 'domain:c']);
    expect(nodes.find((n) => n.id === 'domain:b')?.data.selected).toBe(true);
    expect(nodes.find((n) => n.id === 'domain:a')?.data.selected).toBe(false);
  });

  it('draws a domain or a flow as large as the structure graph draws a cluster, and a step smaller', async () => {
    const top = await layoutDomainLevel(buildDomainLevel(index, at(null, null)));
    expect([...top.boxes.values()].every((b) => b.width === CLUSTER_SIZE.width && b.height === CLUSTER_SIZE.height)).toBe(true);
    const flows = await layoutDomainLevel(buildDomainLevel(index, at('domain:a', null)));
    expect([...flows.boxes.values()].every((b) => b.width === CLUSTER_SIZE.width && b.height === CLUSTER_SIZE.height)).toBe(true);
    const steps = await layoutDomainLevel(buildDomainLevel(index, at('domain:a', 'flow:x')));
    expect([...steps.boxes.values()].every((b) => b.height < CLUSTER_SIZE.height)).toBe(true);
  });

  it('packs a dense top level as a grid and leaves a sparse one, a domain and a flow layered', async () => {
    const domains = Array.from({ length: 6 }, (_, i) => node(`domain:g${i}`, 'domain'));
    const ring = domains.flatMap((d, i) => [1, 2].map((step) => edge(d.id, domains[(i + step) % domains.length].id, 'cross_domain', { description: 'Uses it.' })));
    const dense = buildDomainIndex({ nodes: domains, edges: ring, gaps: [] });
    const level = buildDomainLevel(dense, resolvePlace(dense, { domain: null, flow: null, node: null }) as DomainPlace);
    expect(level.entries.length).toBe(6);
    expect(layoutsAsGrid(level)).toBe(true);
    const layout = await layoutDomainLevel(level);
    expect(layout.kind).toBe('grid');
    // Rows, not one chain: at least two cards share a row and at least two share a column.
    const boxes = [...layout.boxes.values()];
    expect(new Set(boxes.map((b) => b.y)).size).toBeLessThan(boxes.length);
    expect(new Set(boxes.map((b) => b.x)).size).toBeLessThan(boxes.length);

    expect(layoutsAsGrid(buildDomainLevel(index, at(null, null)))).toBe(false);
    expect(layoutsAsGrid(buildDomainLevel(index, at('domain:a', null)))).toBe(false);
    expect(layoutsAsGrid(buildDomainLevel(index, at('domain:a', 'flow:x')))).toBe(false);
  });

  it('puts the steps of a flow in one column, in order', async () => {
    const level = buildDomainLevel(index, at('domain:a', 'flow:x'));
    const layout = await layoutDomainLevel(level);
    const boxes = level.entries.map((e) => layout.boxes.get(e.id) as NonNullable<ReturnType<typeof layout.boxes.get>>);
    expect(boxes[1].y).toBeGreaterThan(boxes[0].y);
    expect(boxes[2].y).toBeGreaterThan(boxes[1].y);
    expect(new Set(boxes.map((b) => b.x)).size).toBe(1);
  });

  it('keeps a long flow in one column too, however many steps it has', async () => {
    const steps = Array.from({ length: 9 }, (_, i) => node(`step:long${i}`, 'step'));
    const long = buildDomainIndex({
      nodes: [node('domain:l', 'domain'), node('flow:l', 'flow'), ...steps],
      edges: [edge('domain:l', 'flow:l', 'contains_flow'), ...steps.map((s, i) => edge('flow:l', s.id, 'flow_step', { weight: i / 10 }))],
      gaps: [],
    });
    const level = buildDomainLevel(long, resolvePlace(long, { domain: 'domain:l', flow: 'flow:l', node: null }) as DomainPlace);
    const layout = await layoutDomainLevel(level);
    const boxes = level.entries.map((e) => layout.boxes.get(e.id) as NonNullable<ReturnType<typeof layout.boxes.get>>);
    expect(new Set(boxes.map((b) => b.x)).size).toBe(1);
    expect(boxes.every((b, i) => i === 0 || b.y > boxes[i - 1].y)).toBe(true);
  });

  it('labels a cross-domain edge only while it touches the node under the pointer or the selected node, or is under the pointer itself', () => {
    const level = buildDomainLevel(index, at(null, null));
    const shown = (v: DomainView) => domainEdges(level, v).map((e) => (e.data as { showLabel: boolean }).showLabel);
    expect(shown(view())).toEqual([false, false]);
    // domain:a touches the first link only.
    expect(shown(view({ selected: 'domain:a' }))).toEqual([true, false]);
    expect(shown(view({ hovered: 'domain:c' }))).toEqual([false, true]);
    expect(shown(view({ hoveredEdge: level.links[1].id }))).toEqual([false, true]);
    // Nothing is left out: the dimmed edge is still there.
    expect(domainEdges(level, view({ selected: 'domain:a' }))).toHaveLength(2);
  });

  it('labels none when a node has more edges than fit at once, apart from the one under the pointer', () => {
    const many = Array.from({ length: MAX_LABELLED_EDGES + 2 }, (_, i) => node(`domain:m${i}`, 'domain'));
    const hub = buildDomainIndex({ nodes: [node('domain:hub', 'domain'), ...many], edges: many.map((m) => edge('domain:hub', m.id, 'cross_domain', { description: 'd' })), gaps: [] });
    const level = buildDomainLevel(hub, resolvePlace(hub, { domain: null, flow: null, node: null }) as DomainPlace);
    const edges = (v: DomainView) => domainEdges(level, v).map((e) => (e.data as { showLabel: boolean }).showLabel);
    expect(edges(view({ selected: 'domain:hub' })).some(Boolean)).toBe(false);
    expect(edges(view({ selected: 'domain:hub', hoveredEdge: level.links[0].id }))[0]).toBe(true);
  });

  it('never labels the arrows of a flow: they are an order, not edges with a meaning of their own', () => {
    const level = buildDomainLevel(index, at('domain:a', 'flow:x'));
    const edges = domainEdges(level, view({ selected: 'step:3', hoveredEdge: level.links[0].id }));
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => (e.data as { showLabel: boolean }).showLabel === false)).toBe(true);
    expect(edges.every((e) => (e.data as { kind: string }).kind === 'sequence')).toBe(true);
  });
});
