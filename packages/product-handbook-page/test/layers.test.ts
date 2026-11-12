// O2 (layering) of openspec change handbook-domain-page, design D3: the layered layout of the two overview diagrams.
import { describe, expect, it } from 'vitest';

import { layered } from '../src/lib/layers';

const at = (result: ReturnType<typeof layered>) => Object.fromEntries(result.nodes.map((node) => [node.id, [node.layer, node.order]]));

describe('layered: longest-path layers, back edges skipped, ordered by the mean position of the nodes before', () => {
  it('puts a chain one node per layer', () => {
    expect(at(layered(['a', 'b', 'c'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]))).toEqual({ a: [0, 0], b: [1, 0], c: [2, 0] });
  });

  it('places a node by its longest path, not its shortest', () => {
    expect(at(layered(['a', 'b', 'c'], [{ from: 'a', to: 'c' }, { from: 'a', to: 'b' }, { from: 'b', to: 'c' }])).c).toEqual([2, 0]);
  });

  it('orders the branches of a fork by the input order', () => {
    expect(at(layered(['a', 'c', 'b'], [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }]))).toEqual({ a: [0, 0], c: [1, 0], b: [1, 1] });
  });

  it('skips the back edge of a cycle when layering and reports it', () => {
    const result = layered(['a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]);
    expect(at(result)).toEqual({ a: [0, 0], b: [1, 0] });
    expect(result.back).toEqual([1]);
  });

  it('orders a layer by the mean position of the nodes its edges come from', () => {
    expect(at(layered(['a', 'b', 'x', 'y'], [{ from: 'b', to: 'x' }, { from: 'a', to: 'y' }]))).toEqual({ a: [0, 0], b: [0, 1], y: [1, 0], x: [1, 1] });
  });

  it('keeps an isolated node in the first layer and gives the same output for the same input', () => {
    const nodes = ['a', 'b', 'lone'];
    const edges = [{ from: 'a', to: 'b' }];
    expect(at(layered(nodes, edges)).lone).toEqual([0, 1]);
    expect(layered(nodes, edges)).toEqual(layered(nodes, edges));
  });
});
