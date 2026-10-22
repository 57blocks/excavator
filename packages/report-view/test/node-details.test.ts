import { describe, expect, it } from 'vitest';

import type { GraphNode } from '../src/data/graph';
import { buildIndex } from '../src/data/indexes';
import { buildStructure } from '../src/lib/graph-structure';
import { nodeLanguage, nodeLayerName, nodeLines } from '../src/lib/node-details';

const file = (path: string): GraphNode => ({ id: `file:${path}`, type: 'file', name: path.slice(path.lastIndexOf('/') + 1), filePath: path });

describe('nodeLanguage', () => {
  it("takes the node's own language, else the one the file's extension names, else none", () => {
    expect(nodeLanguage({ name: 'x', filePath: 'a/b.go' })).toBe('Go');
    expect(nodeLanguage({ name: 'x', filePath: 'a/b.go', language: 'Cgo' })).toBe('Cgo');
    expect(nodeLanguage({ name: 'Makefile', filePath: 'Makefile' })).toBeNull();
    expect(nodeLanguage({ name: 'x', filePath: 'a/b.unknownext' })).toBeNull();
    expect(nodeLanguage({ name: 'main.py' })).toBe('Python');
  });
});

describe('nodeLines', () => {
  it('writes a range as a-b, a single line as one number, and no range as nothing', () => {
    expect(nodeLines({ lineRange: [12, 20] })).toBe('12-20');
    expect(nodeLines({ lineRange: [7, 7] })).toBe('7');
    expect(nodeLines({})).toBeNull();
  });
});

describe('nodeLayerName', () => {
  const nodes = [file('a.js'), file('b.js'), { id: 'function:a.js:f', type: 'function', name: 'f', filePath: 'a.js' }];
  const edges = [{ source: 'file:a.js', target: 'function:a.js:f', type: 'contains' }];

  it("names the layer that holds the node's file", () => {
    const index = buildIndex({ nodes, edges }, { entries: [], layers: [{ id: 'l', name: 'Core layer', nodeIds: ['file:a.js'] }] });
    const structure = buildStructure(index);
    expect(nodeLayerName(index, structure, 'function:a.js:f')).toBe('Core layer');
    expect(nodeLayerName(index, structure, 'file:b.js')).toBe('Not in any layer');
  });

  it('has no layer name for a graph that is grouped by directory', () => {
    const index = buildIndex({ nodes, edges });
    expect(nodeLayerName(index, buildStructure(index), 'file:a.js')).toBeNull();
  });
});
