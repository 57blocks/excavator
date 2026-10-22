import { describe, expect, it } from 'vitest';

import { NO_FILTERS, type GraphFilters } from '../src/lib/graph-filters';
import { escapeStep, graphHash, parseGraphState, TOP_LEVEL, type EscapeState, type EscapeStep, type GraphState } from '../src/lib/graph-state';
import { parseRoute } from '../src/lib/route';

const roundTrip = (state: Partial<GraphState>): GraphState => parseGraphState(parseRoute(graphHash(state)).params);

describe('the graph address', () => {
  it('has no parameter at the top level', () => {
    expect(graphHash()).toBe('#/graph');
    expect(roundTrip({})).toEqual(TOP_LEVEL);
  });

  it('round-trips a level, a selected node, the focus and a path, ids with every separator included', () => {
    const state: GraphState = {
      path: 'layer:app/src/core', fold: '400-800', node: 'function:src/a b.js:run(a&b)?', entry: null, focus: true,
      from: 'file:src/a=b.js', to: 'function:x/y#z', directed: true, overlays: [], filters: NO_FILTERS,
    };
    expect(roundTrip(state)).toEqual(state);
  });

  it('round-trips a selected entry of a level', () => {
    const state = { ...TOP_LEVEL, path: 'src', entry: 'container:src/core' };
    expect(roundTrip(state)).toEqual(state);
  });

  it('drops a focus that has no node, an entry beside a node, and half a path', () => {
    expect(parseGraphState({ focus: '1' }).focus).toBe(false);
    expect(parseGraphState({ node: 'n', entry: 'e' })).toMatchObject({ node: 'n', entry: null });
    expect(parseGraphState({ from: 'a' })).toMatchObject({ from: null, to: null });
    expect(parseGraphState({ to: 'b', dir: '1' })).toMatchObject({ from: null, to: null, directed: false });
    expect(graphHash({ focus: true })).toBe('#/graph');
    expect(graphHash({ from: 'a', to: null, directed: true })).toBe('#/graph');
  });

  it('round-trips the overlays that are on, in the fixed order and each once', () => {
    expect(graphHash({ overlays: ['hotspots', 'unused'] })).toBe('#/graph?overlay=hotspots%2Cunused');
    expect(roundTrip({ overlays: ['doc-map', 'hotspots'] }).overlays).toEqual(['hotspots', 'doc-map']);
    expect(parseGraphState({ overlay: 'unused,unused,nonsense,hotspots' }).overlays).toEqual(['hotspots', 'unused']);
    expect(parseGraphState({}).overlays).toEqual([]);
  });

  it('round-trips the filters: hidden node types and layers, and the edge types that are shown', () => {
    const filters: GraphFilters = { nodeTypes: new Set(['function', 'class']), edgeTypes: new Set(['calls', 'imports']), layers: new Set(['layer:a', 'layer:b']) };
    expect(roundTrip({ filters }).filters).toEqual(filters);
    expect(roundTrip({ filters: NO_FILTERS }).filters).toEqual(NO_FILTERS);
  });

  it('tells no edge type shown (an empty set) from the default (none chosen)', () => {
    const none: GraphFilters = { nodeTypes: new Set(), edgeTypes: new Set(), layers: new Set() };
    expect(roundTrip({ filters: none }).filters.edgeTypes).toEqual(new Set());
    expect(roundTrip({ filters: NO_FILTERS }).filters.edgeTypes).toBeNull();
    expect(graphHash({ filters: none })).not.toBe(graphHash({ filters: NO_FILTERS }));
  });

  it('keeps a layer key or type name that contains the separators', () => {
    const filters: GraphFilters = { nodeTypes: new Set(['a,b', '100%', 'x&y=z']), edgeTypes: new Set(['c d,e']), layers: new Set(['layer:one,two', 'ä/ö#1']) };
    expect(roundTrip({ filters }).filters).toEqual(filters);
  });

  it('writes one text for one state, however the sets were filled', () => {
    const a: GraphFilters = { nodeTypes: new Set(['x', 'y']), edgeTypes: new Set(['p', 'q']), layers: new Set() };
    const b: GraphFilters = { nodeTypes: new Set(['y', 'x']), edgeTypes: new Set(['q', 'p']), layers: new Set() };
    expect(graphHash({ filters: a })).toBe(graphHash({ filters: b }));
  });

  it('puts a distinct hash on each state, so history can tell them apart', () => {
    const hashes = [
      graphHash({ path: 'a' }), graphHash({ path: 'a', node: 'n' }), graphHash({ path: 'a', node: 'n', focus: true }),
      graphHash({ path: 'a', from: 'x', to: 'y' }), graphHash({ path: 'a', from: 'x', to: 'y', directed: true }),
      graphHash({ path: 'a', overlays: ['unused'] }), graphHash({ path: 'a', filters: { ...NO_FILTERS, nodeTypes: new Set(['file']) } }),
    ];
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

describe('escapeStep', () => {
  const REFERENCE: EscapeStep[] = ['overlay', 'drawer', 'focus', 'path', 'selection', 'level'];
  const keys = ['overlay', 'drawer', 'focus', 'path', 'selection', 'canGoUp'] as const;

  it('closes from the inside out: dialog, drawer, focus, path, selection, one level', () => {
    const state: EscapeState = { overlay: true, drawer: true, focus: true, path: true, selection: true, canGoUp: true };
    const order: EscapeStep[] = [];
    for (let i = 0; i < 7; i++) {
      const step = escapeStep(state);
      order.push(step);
      if (step === 'none') break;
      state[keys[REFERENCE.indexOf(step)]] = false;
    }
    expect(order).toEqual([...REFERENCE, 'none']);
  });

  it('picks the first open thing in that order, for every combination of what is open', () => {
    for (let mask = 0; mask < 64; mask++) {
      const state = Object.fromEntries(keys.map((key, i) => [key, (mask & (1 << i)) !== 0])) as unknown as EscapeState;
      const expected = REFERENCE.find((_, i) => state[keys[i]]) ?? 'none';
      expect(escapeStep(state), JSON.stringify(state)).toBe(expected);
    }
  });
});
