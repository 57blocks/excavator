import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { KIND_LABELS, legendRows, NODE_KINDS, NODE_TYPES_BY_KIND, nodeColor, nodeKind } from '../src/lib/node-colors';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/index.css'), 'utf-8');
const theme = /@theme\s+static\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';

function tokens(prefix: string): Record<string, string> {
  return Object.fromEntries([...theme.matchAll(new RegExp(`--color-${prefix}([a-z0-9-]*):\\s*(#[0-9a-fA-F]{6})\\s*;`, 'g'))].map((m) => [m[1], m[2]]));
}

const channel = (v: number) => {
  const x = v / 255;
  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
/** WCAG contrast ratio of two sRGB hex colours. */
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('the contrast measure', () => {
  it('sees the extremes and a colour that is too light', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 0);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // The site's cyan is 1.9:1 on white, which is why the node palette's cyan is a darker one.
    expect(contrast('#46c7ff', '#ffffff')).toBeLessThan(3);
  });
});

describe('the node palette (design D8)', () => {
  const nodes = tokens('node-');

  it('has one token per kind, and no other', () => {
    expect(Object.keys(nodes).sort()).toEqual([...NODE_KINDS].sort());
  });

  it('is at least 3:1 on a white background for every kind', () => {
    for (const [kind, hex] of Object.entries(nodes)) expect(contrast(hex, '#ffffff'), `${kind} ${hex}`).toBeGreaterThanOrEqual(3);
  });

  it('keeps the kinds apart: no two share a colour', () => {
    expect(new Set(Object.values(nodes).map((hex) => hex.toLowerCase())).size).toBe(NODE_KINDS.length);
  });

  it('starts from the site violet', () => {
    expect(nodes.file.toLowerCase()).toBe(tokens('')['violet'].toLowerCase());
  });
});

describe('node types and the legend', () => {
  // The types of the graph schema (packages/core/src/types.ts, NodeType).
  const SCHEMA_TYPES = [
    'file', 'function', 'class', 'module', 'concept', 'config', 'document', 'service', 'table', 'endpoint', 'pipeline', 'schema', 'resource',
    'domain', 'flow', 'step', 'article', 'entity', 'topic', 'claim', 'source', 'page', 'screen', 'component', 'componentSet', 'instance', 'token',
  ];

  it('gives every type of the schema a kind, each exactly once', () => {
    const listed = NODE_KINDS.flatMap((kind) => NODE_TYPES_BY_KIND[kind]);
    expect([...listed].sort()).toEqual([...SCHEMA_TYPES].sort());
    for (const type of SCHEMA_TYPES) expect(nodeKind(type), type).not.toBeNull();
  });

  it('labels every kind and colours a type with the token of its kind', () => {
    for (const kind of NODE_KINDS) expect(KIND_LABELS[kind]).not.toBe('');
    expect(nodeColor('function')).toBe('var(--color-node-callable)');
    expect(nodeColor('file')).toBe('var(--color-node-file)');
  });

  it('draws a type no kind lists in muted grey instead of a kind it does not have', () => {
    expect(nodeKind('invented')).toBeNull();
    expect(nodeColor('invented')).toBe('var(--color-muted)');
  });
});

describe('the light theme tokens (design D8)', () => {
  const colours = tokens('');
  it.each([
    ['paper', '#ededef'], ['paper-2', '#e2e2e6'], ['surface', '#ffffff'], ['ink', '#0c0c0e'], ['ink-soft', '#26262b'],
    ['muted', '#6c6c73'], ['accent', '#6a4dff'], ['violet', '#7c5cff'], ['cyan', '#46c7ff'], ['warning', '#ffc107'], ['danger', '#dc3545'],
  ])('keeps the 57blocks %s', (name, hex) => {
    expect(colours[name].toLowerCase()).toBe(hex);
  });

  it('is light only: no colour scheme query, one declared scheme', () => {
    expect(css).not.toMatch(/prefers-color-scheme/);
    expect(css).toMatch(/color-scheme:\s*light/);
    expect(css).not.toMatch(/color-scheme:\s*(dark|light dark)/);
  });

  it('gives overlays 14 px cards, 10 px controls, the 0.78 glass with a 14 px blur and the soft shadow', () => {
    expect(theme).toContain('--radius-card: 14px');
    expect(theme).toContain('--radius-control: 10px');
    expect(theme).toContain('--shadow-glass: 0 8px 30px rgb(12 12 18 / 0.08)');
    expect(css).toMatch(/@utility glass\s*\{[^}]*rgb\(255 255 255 \/ 0\.78\)[^}]*blur\(14px\)/);
  });

  it('uses the site easing', () => {
    expect(theme).toContain('--ease-site: cubic-bezier(0.16, 1, 0.3, 1)');
  });

  it('switches CSS animation and transition off when reduced motion is requested', () => {
    const block = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(block).toMatch(/animation:\s*none\s*!important/);
    expect(block).toMatch(/transition:\s*none\s*!important/);
  });

  it('loads no font and no external image from the stylesheet', () => {
    expect(css).not.toMatch(/@font-face|@import\s+url|url\(\s*['"]?(?!data:)/i);
  });
});

describe('legendRows', () => {
  it('has a row for each kind some type of the graph belongs to, in the order of the kinds, with the types it covers', () => {
    expect(legendRows(['function', 'file', 'class', 'component'])).toEqual([
      { label: KIND_LABELS.file, types: ['file'], colour: 'var(--color-node-file)' },
      { label: KIND_LABELS.callable, types: ['function'], colour: 'var(--color-node-callable)' },
      { label: KIND_LABELS.type, types: ['class', 'component'], colour: 'var(--color-node-type)' },
    ]);
  });

  it('lists a type no kind knows under Other in muted grey, and shows nothing for a graph with no nodes', () => {
    expect(legendRows(['file', 'invented', 'alien'])).toEqual([
      { label: KIND_LABELS.file, types: ['file'], colour: 'var(--color-node-file)' },
      { label: 'Other', types: ['alien', 'invented'], colour: 'var(--color-muted)' },
    ]);
    expect(legendRows([])).toEqual([]);
  });
});
