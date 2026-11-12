// Edge texts of the flow chart get room (openspec change handbook-free-chapter, domain flow diagrams): a gap that carries texts is
// as wide as its longest text, labels of one gap never overlap, a chart without texts is unchanged, and chapter headings are bold.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FlowChart } from '../src/components/FlowChart';
import type { ChartEdge, ChartNode } from '../src/components/FlowChart';

const here = dirname(fileURLToPath(import.meta.url));
const NODES: ChartNode[] = ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id.toUpperCase(), href: `#${id}`, ...(id === 'c' ? { kind: 'system' as const } : {}) }));
const PLAIN: ChartEdge[] = [{ from: 'a', to: 'b', count: 2, href: '#x' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'd', to: 'a', count: 1 }];
// Eleven CJK characters, as escapes, so no source file holds one.
const LONG = '\u8bf7\u5148\u5b8c\u6210\u5ba1\u6279\u518d\u63d0\u4ea4\u8ba2\u5355';
const draw = (edges: ChartEdge[]): string => renderToStaticMarkup(<FlowChart nodes={NODES} edges={edges} label="l" part="p" />);
const lefts = (html: string): number[] => [...html.matchAll(/class="flow-node"[^>]*style="left:(\d+)px/g)].map((match) => Number(match[1]));

describe('the edge texts of a flow chart', () => {
  it('widens a gap to a long text and keeps the labels of one gap apart', () => {
    const edges: ChartEdge[] = [{ from: 'a', to: 'b', text: LONG }, { from: 'a', to: 'c', text: LONG + LONG }, { from: 'b', to: 'd' }];
    const html = draw(edges);
    const [first, second] = lefts(html);
    expect(second - first - 168).toBeGreaterThanOrEqual(11 * 22);
    const texts = [...html.matchAll(/<text class="flow-text" x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)</g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]), length: [...match[3]].length }));
    expect(texts).toHaveLength(2);
    const [one, two] = texts;
    const apartX = Math.abs(one.x - two.x) >= (one.length + two.length) * 11 / 2;
    const apartY = Math.abs(one.y - two.y) >= 14;
    expect(apartX || apartY).toBe(true);
    for (const text of texts) {
      expect(text.x - text.length * 11 / 2).toBeGreaterThanOrEqual(first + 168);
      expect(text.x + text.length * 11 / 2).toBeLessThanOrEqual(second);
    }
  });

  it('draws every text after every arrow, so no line runs over a text', () => {
    const html = draw([{ from: 'a', to: 'b', text: LONG }, { from: 'a', to: 'c', text: 'x' }, { from: 'b', to: 'd', text: 'y' }]);
    const lastPath = html.lastIndexOf('<path');
    const texts = [...html.matchAll(/<text class="flow-text"/g)].map((match) => match.index!);
    expect(texts).toHaveLength(3);
    for (const at of texts) expect(at).toBeGreaterThan(lastPath);
  });

  it('leaves a gap at its usual width when no edge of it has a text', () => {
    const [first, second] = lefts(draw(PLAIN));
    expect(second - first).toBe(168 + 72);
  });

  it('draws a chart without edge texts exactly as before', () => {
    expect(draw(PLAIN)).toBe("<figure class=\"flow\" data-part=\"p\"><div class=\"flow-scroll\"><div class=\"flow-inner\" style=\"width:672px;height:188px\"><svg class=\"flow-svg\" width=\"672\" height=\"188\" viewBox=\"0 0 672 188\" role=\"img\" aria-label=\"l\"><g class=\"flow-edge\" data-edge=\"a b\"><path class=\"flow-line\" d=\"M180,78 C212,78 212,40 244,40\" fill=\"none\"></path><path class=\"flow-head\" d=\"M252,40 L244,36 L244,44 z\"></path><a href=\"#x\"><circle class=\"flow-badge\" cx=\"212\" cy=\"59\" r=\"10\"></circle><text class=\"flow-count\" x=\"212\" y=\"59\" dy=\"0.35em\" text-anchor=\"middle\">2</text></a></g><g class=\"flow-edge\" data-edge=\"a c\"><path class=\"flow-line\" d=\"M180,78 C212,78 212,116 244,116\" fill=\"none\"></path><path class=\"flow-head\" d=\"M252,116 L244,112 L244,120 z\"></path></g><g class=\"flow-edge\" data-edge=\"b d\"><path class=\"flow-line\" d=\"M420,40 C452,40 452,78 484,78\" fill=\"none\"></path><path class=\"flow-head\" d=\"M492,78 L484,74 L484,82 z\"></path></g><g class=\"flow-edge\" data-edge=\"d a\" data-back=\"\"><path class=\"flow-line\" d=\"M576,106 C576,134 96,134 96,114\" fill=\"none\"></path><path class=\"flow-head\" d=\"M96,106 L92,114 L100,114 z\"></path><circle class=\"flow-badge\" cx=\"336\" cy=\"127\" r=\"10\"></circle><text class=\"flow-count\" x=\"336\" y=\"127\" dy=\"0.35em\" text-anchor=\"middle\">1</text></g></svg><a class=\"flow-node\" href=\"#a\" title=\"A\" style=\"left:12px;top:50px;width:168px;height:56px\"><span>A</span></a><a class=\"flow-node\" href=\"#b\" title=\"B\" style=\"left:252px;top:12px;width:168px;height:56px\"><span>B</span></a><a class=\"flow-node\" data-kind=\"system\" href=\"#c\" title=\"C\" style=\"left:252px;top:88px;width:168px;height:56px\"><span>C</span></a><a class=\"flow-node\" href=\"#d\" title=\"D\" style=\"left:492px;top:50px;width:168px;height:56px\"><span>D</span></a></div></div></figure>");
  });

  it('gives the same markup for the same chart', () => {
    const edges: ChartEdge[] = [{ from: 'a', to: 'b', text: LONG }, { from: 'a', to: 'c', text: 'x' }];
    expect(draw(edges)).toBe(draw(edges));
  });
});

describe('the headings of a chapter', () => {
  const css = readFileSync(join(here, '../src/index.css'), 'utf-8');
  const rule = (name: string): string => new RegExp(`^${name.replace(/[.:()]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? '';

  it('carry a class whose rule gives weight 600 and a size for each level', () => {
    expect(rule('.chapter-heading')).toMatch(/font-weight:\s*600/);
    expect(rule('.flow-text')).toMatch(/paint-order:\s*stroke/);
    for (const level of [3, 4, 5]) expect(rule(`.chapter-heading:is(h${level})`)).toMatch(/font-size:/);
  });
});
