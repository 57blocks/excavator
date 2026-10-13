// artifact-view task 10.0 (design D15): the graph's node visual language as
// pure mappings. Shape by kind, fill by language (layer coloring replaces the
// fill and keeps the ring), the same rules at every level, merged multi-type
// links, label level of detail with collision culling, particle cap, entry
// stagger, and legend totals that do not depend on the type switches.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FOCUS_DIM, LABEL_BUDGET, MAX_PARTICLES, SHAPE_LEGEND, STAGGER_CAP_MS, arrowSize, compactCount, cssVarName, fillVar, glyphForKind,
  inDegreeTicks, labelMode, languageRing, linkAlpha, linkWidth, mergeLinkPairs, mixColor, particleCounts, pickLabels, shapeForKind,
  staggerDelay,
} from '../../packages/view/src/model/node-visual.ts';
import { itemVisual, symbolVisual } from '../../packages/view/src/model/graph-visual.ts';
import { legendRows, legendTotals } from '../../packages/view/src/model/legend.ts';
import { languageColors, languageOrder } from '../../packages/view/src/model/colors.ts';
import { buildStructure } from '../../packages/view/src/model/tree.ts';
import { decodeBundle } from '../../skills/excavator-view/bundle-codec.mjs';
import { toViewData } from '../../packages/view/src/data.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sample = readFileSync(join(repoRoot, 'packages/view/fixtures/sample.bundle.txt'), 'utf-8');

describe('shape by kind (10.0)', () => {
  it('maps every kind to its shape: discs, rounded squares, circles, hexagons, diamonds, dashed circles', () => {
    expect(shapeForKind('member')).toBe('disc');
    expect(shapeForKind('dir')).toBe('disc');
    expect(shapeForKind('file')).toBe('rounded-square');
    expect(shapeForKind('function')).toBe('circle');
    expect(shapeForKind('class')).toBe('hexagon');
    for (const nonCode of ['config', 'document', 'table', 'endpoint', 'unknown']) expect(shapeForKind(nonCode)).toBe('diamond');
    expect(shapeForKind('more')).toBe('dashed-circle');
    expect(shapeForKind('nopath')).toBe('dashed-circle');
  });

  it('has a legend entry for every shape and a glyph per kind', () => {
    expect(new Set(SHAPE_LEGEND.map((e) => e.shape))).toEqual(new Set(['disc', 'rounded-square', 'circle', 'hexagon', 'diamond', 'dashed-circle']));
    expect(glyphForKind('function')).toBe('ƒ');
    expect(glyphForKind('class')).toBe('C');
    expect(glyphForKind('file')).toBe('▢');
    expect(glyphForKind('table')).toBe('◇');
  });
});

describe('fill by content (10.0)', () => {
  const colors = languageColors(['go', 'typescript']);

  it('fills files and symbols with their language color, aggregates with neutral tokens, unknown visibly', () => {
    expect(fillVar('file', 'go', colors)).toBe('--series-1');
    expect(fillVar('function', 'typescript', colors)).toBe('--series-2');
    expect(fillVar('function', null, colors)).toBe('--graph-unknown');
    expect(fillVar('class', 'cobol', colors)).toBe('--graph-unknown');
    expect(fillVar('dir', 'go', colors)).toBe('--graph-dir');
    expect(fillVar('member', null, colors)).toBe('--graph-member');
    expect(fillVar('more', null, colors)).toBe('--surface-2');
  });

  it('replaces the fill with the layer color in layer mode', () => {
    expect(fillVar('file', 'go', colors, 'var(--layer-3)')).toBe('--layer-3');
    expect(fillVar('dir', null, colors, '--layer-1')).toBe('--layer-1');
    expect(cssVarName('var(--series-4)')).toBe('--series-4');
  });

  it('builds a directory ring by language weight, largest first', () => {
    const ring = languageRing([['typescript', 100], ['go', 300], ['json', 0]], colors);
    expect(ring.map((s) => s.language)).toEqual(['go', 'typescript']);
    expect(ring.map((s) => s.share)).toEqual([0.75, 0.25]);
    expect(ring[0].color).toBe('--series-1');
    expect(languageRing([], colors)).toEqual([]);
  });

  it('applies one rule set at every level on the sample fixture (aggregate, directory, symbol)', async () => {
    const data = toViewData((await decodeBundle(sample)).segments, 'main');
    const structure = buildStructure(data.segments, data.strings, data.meta);
    const lc = languageColors(languageOrder(data.coverage));
    const src = itemVisual('dir', 'src', structure, lc);
    expect(src).toMatchObject({ kind: 'dir', fill: '--graph-dir', badge: 3 });
    expect(src.ring.map((s) => s.language)).toEqual(['typescript']);
    const file = itemVisual('file', 'src/counter.ts', structure, lc);
    expect(file).toMatchObject({ kind: 'file', language: 'typescript', fill: lc.get('typescript').slice(4, -1) });
    // The same file seen as a node in a neighborhood: same shape and color.
    const fileAsNode = symbolVisual('file', 'src/counter.ts', structure, lc);
    expect(shapeForKind(fileAsNode.kind)).toBe(shapeForKind(file.kind));
    expect(fileAsNode.fill).toBe(file.fill);
    const cls = symbolVisual('class', 'src/counter.ts', structure, lc);
    expect(cls).toMatchObject({ kind: 'class', language: 'typescript', fill: file.fill });
    expect(shapeForKind(cls.kind)).toBe('hexagon');
    expect(itemVisual('dir', 'nowhere', structure, lc)).toMatchObject({ ring: [], badge: null });
  });
});

describe('rim and badge (10.0)', () => {
  it('ticks the in-degree on a log scale', () => {
    expect([0, 1, 2, 3, 4, 8, 1000, 1e9].map(inDegreeTicks)).toEqual([0, 1, 2, 2, 3, 4, 10, 12]);
  });

  it('formats badge counts compactly', () => {
    expect([7, 999, 1200, 45_000, 1_300_000].map(compactCount)).toEqual(['7', '999', '1.2k', '45k', '1.3M']);
  });
});

describe('links (10.0)', () => {
  it('merges the types between one ordered pair into one path with segments, heaviest first', () => {
    const merged = mergeLinkPairs([
      { source: 0, target: 1, type: 'imports', count: 2 },
      { source: 0, target: 1, type: 'calls', count: 5 },
      { source: 1, target: 0, type: 'calls', count: 1 },
      { source: 0, target: 2, type: 'calls', count: 1 },
    ]);
    expect(merged).toHaveLength(3);
    const ab = merged.find((m) => m.source === 0 && m.target === 1);
    expect(ab).toMatchObject({ total: 7, reverse: true, segments: [{ type: 'calls', count: 5 }, { type: 'imports', count: 2 }] });
    expect(merged.find((m) => m.target === 2).reverse).toBe(false);
  });

  it('grows width, arrow and opacity with log count, within bounds', () => {
    expect(linkWidth(1)).toBe(1);
    expect(linkWidth(1e9)).toBe(5);
    expect(arrowSize(1)).toBe(5);
    expect(arrowSize(1e9)).toBe(12);
    expect(linkAlpha(1, 100)).toBeLessThan(linkAlpha(50, 100));
    expect(linkAlpha(100, 100)).toBeCloseTo(0.85);
    expect(FOCUS_DIM).toBe(0.25);
  });

  it('caps particles over a level, heaviest links first', () => {
    expect(particleCounts([1, 10, 100, 1000])).toEqual([1, 2, 3, 3]);
    const many = particleCounts(new Array(600).fill(1000));
    expect(many.reduce((n, c) => n + c, 0)).toBe(MAX_PARTICLES);
    expect(particleCounts([5, 500], 3)).toEqual([0, 3]);
  });

  it('staggers the entry in 20 ms steps, compressed past the cap', () => {
    expect(staggerDelay(0, 10)).toBe(0);
    expect(staggerDelay(3, 10)).toBe(60);
    expect(staggerDelay(399, 400)).toBeCloseTo(STAGGER_CAP_MS);
  });

  it('mixes colors for gradients', () => {
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('rgb(128, 128, 128)');
    expect(mixColor('nope', '#fff', 0.5)).toBe('nope');
  });
});

describe('label level of detail (10.0)', () => {
  const box = (x, y, forced = false) => ({ x, y, w: 40, h: 14, forced });

  it('labels every node in a small level, or zoomed in past the fit', () => {
    expect(labelMode(1, 1, LABEL_BUDGET)).toBe('all');
    expect(labelMode(1, 1, 151)).toBe('lod');
    expect(labelMode(2, 1, 151)).toBe('lod');
    expect(labelMode(2.5, 1, 151)).toBe('all');
  });

  it('culls colliding labels and keeps the budget when zoomed out', () => {
    // Three boxes on top of each other, then 30 apart: the first of the stack wins.
    const boxes = [box(0, 0), box(5, 2), box(10, 4), ...Array.from({ length: 30 }, (_, i) => box(100 + i * 50, 0))];
    const picked = pickLabels(boxes, 'lod');
    expect(picked).not.toContain(1);
    expect(picked).not.toContain(2);
    expect(picked).toHaveLength(LABEL_BUDGET);
    expect(picked[0]).toBe(0);
    expect(pickLabels(boxes, 'all')).toHaveLength(boxes.length);
  });

  it('always draws forced labels (center, hovered) even where a larger node\'s label would go', () => {
    const boxes = [box(0, 0), box(4, 0, true)];
    expect(pickLabels(boxes, 'lod')).toEqual([1]);
  });
});

describe('legend totals do not depend on the switches (10.0)', () => {
  it('keeps a switched-off type\'s total from the unfiltered scope instead of 0 / 0', () => {
    const filtered = new Map([['calls', 4]]);
    const unfiltered = new Map([['calls', 9], ['imports', 12]]);
    const totals = legendTotals(filtered, unfiltered, new Set(['imports']));
    expect(totals.get('imports')).toBe(12);
    expect(totals.get('calls')).toBe(4);
    const row = legendRows(new Map(), totals, new Set(['imports'])).find((r) => r.key === 'imports');
    expect(row).toMatchObject({ off: true, total: 12, drawn: 0 });
    expect(legendTotals(filtered, null, new Set(['imports']))).toBe(filtered);
  });
});
