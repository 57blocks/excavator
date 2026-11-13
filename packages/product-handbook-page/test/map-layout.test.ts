// The layout of the domain map (openspec change handbook-page-domain-map, task 4.1): the centre, the ring order, the geometry,
// the two-way offset, the colours by ring position and the label truncation.
import { describe, expect, it } from 'vitest';

import { boxWidth, centreOf, fitLabel, layoutMap, orderRing, ringCost } from '../src/lib/map-layout';
import type { MapDomain, MapHandover } from '../src/lib/map-layout';
import { NEUTRAL, STRATA, domainColours } from '../src/lib/strata';

const ids = (...names: string[]): MapDomain[] => names.map((id) => ({ id, name: id.toUpperCase(), features: 1 }));
const edge = (from: string, to: string): MapHandover => ({ from, to });
const wide = (count: number): string => String.fromCharCode(0x4e2d).repeat(count);

describe('the centre', () => {
  it('is the domain with no incoming hand-over and the most outgoing ones', () => {
    expect(centreOf(ids('a', 'b', 'c'), [edge('a', 'b'), edge('c', 'a'), edge('c', 'b')])).toBe('c');
    expect(centreOf(ids('a', 'b', 'c'), [edge('b', 'a'), edge('b', 'c'), edge('a', 'c')])).toBe('b');
  });

  it('is the earlier domain on a tie, and null when nobody qualifies', () => {
    expect(centreOf(ids('a', 'b', 'c'), [edge('b', 'c'), edge('a', 'c')])).toBe('a');
    expect(centreOf(ids('a', 'b'), [edge('a', 'b'), edge('b', 'a')])).toBeNull();
    expect(centreOf(ids('a', 'b'), [])).toBeNull();
  });
});

describe('the ring order', () => {
  it('swaps two places only when the cost drops, and leaves a cheaper order alone', () => {
    const handovers = [edge('a', 'd'), edge('b', 'c')];
    const start = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(ringCost(start, handovers)).toBe(3 + 1);
    const ordered = orderRing(start, handovers);
    expect(ringCost(ordered, handovers)).toBeLessThan(ringCost(start, handovers));
    expect(ringCost(['a', 'd', 'b', 'c', 'e', 'f'], handovers)).toBe(2);
    expect(orderRing(['a', 'd', 'b', 'c', 'e', 'f'], handovers)).toEqual(['a', 'd', 'b', 'c', 'e', 'f']);
    expect(orderRing(start, [])).toEqual(start);
  });

  it('is idempotent on its own output', () => {
    const handovers = [edge('a', 'e'), edge('b', 'f'), edge('c', 'g'), edge('d', 'a'), edge('e', 'b'), edge('f', 'c'), edge('g', 'd')];
    const once = orderRing(['a', 'b', 'c', 'd', 'e', 'f', 'g'], handovers);
    expect(orderRing(once, handovers)).toEqual(once);
  });

  it('counts the shorter way round the ring', () => {
    expect(ringCost(['a', 'b', 'c', 'd', 'e'], [edge('a', 'e')])).toBe(1);
  });
});

describe('the layout', () => {
  const domains = ids('a', 'b', 'c', 'd', 'e');
  const handovers = [edge('a', 'b'), edge('a', 'c'), edge('b', 'c'), edge('c', 'b'), edge('d', 'e')];

  it('is the same for the same input', () => {
    expect(layoutMap(domains, handovers)).toEqual(layoutMap(domains, handovers));
  });

  it('puts the centre in the middle, the first ring member at the top and the rest clockwise', () => {
    const layout = layoutMap(domains, handovers);
    expect(layout.centre).toBe('a');
    expect(layout.viewBox).toEqual({ w: 1000, h: 632 });
    const centre = layout.nodes.find((node) => node.id === 'a');
    expect([centre?.x, centre?.y, centre?.colour]).toEqual([500, 316, null]);
    const first = layout.nodes.find((node) => node.id === layout.ring[0]);
    expect(first?.x).toBeCloseTo(500, 5);
    expect(first?.y).toBeCloseTo(316 - 238, 5);
    const second = layout.nodes.find((node) => node.id === layout.ring[1]);
    expect((second?.x ?? 0) > 500).toBe(true);
    expect(layout.nodes.every((node) => node.h === 46)).toBe(true);
  });

  it('has no centre and keeps the given order when nothing is handed over', () => {
    const layout = layoutMap(domains, []);
    expect(layout.centre).toBeNull();
    expect(layout.ring).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(layout.edges).toEqual([]);
  });

  it('draws one path per hand-over by its place in the list, and offsets the two lines of a two-way pair to different sides', () => {
    const layout = layoutMap(domains, handovers);
    expect(layout.edges.map((one) => [one.index, one.from, one.to, one.twoWay])).toEqual([[0, 'a', 'b', false], [1, 'a', 'c', false], [2, 'b', 'c', true], [3, 'c', 'b', true], [4, 'd', 'e', false]]);
    const control = (d: string): [number, number] => { const [, x, y] = /Q([-\d.]+),([-\d.]+)/.exec(d) as RegExpExecArray; return [Number(x), Number(y)]; };
    const [x2, y2] = control(layout.edges[2].d);
    const [x3, y3] = control(layout.edges[3].d);
    expect(Math.hypot(x2 - x3, y2 - y3)).toBeCloseTo(52, 0);
    expect(layout.edges.every((one) => /^M[-\d.]+,[-\d.]+ Q[-\d.]+,[-\d.]+ [-\d.]+,[-\d.]+$/.test(one.d))).toBe(true);
  });

  it('ends each path a little outside the box it leaves, not at its centre', () => {
    const layout = layoutMap(ids('a', 'b'), [edge('a', 'b')]);
    const [, x1, y1, x2, y2] = /M([-\d.]+),([-\d.]+) Q[-\d.]+,[-\d.]+ ([-\d.]+),([-\d.]+)/.exec(layout.edges[0].d) as RegExpExecArray;
    for (const [id, x, y] of [['a', x1, y1], ['b', x2, y2]] as const) {
      const node = layout.nodes.find((one) => one.id === id);
      const dx = Math.abs(Number(x) - (node?.x ?? 0));
      const dy = Math.abs(Number(y) - (node?.y ?? 0));
      expect(dx >= (node?.w ?? 0) / 2 || dy >= (node?.h ?? 0) / 2).toBe(true);
    }
  });

  it('grows the ellipse past twelve ring members and keeps the boxes inside the view box', () => {
    const many = ids(...Array.from({ length: 20 }, (_, at) => `n${at}`));
    const layout = layoutMap(many, []);
    expect(layout.viewBox.h).toBeGreaterThan(640);
    for (const node of layout.nodes) {
      expect(node.x - node.w / 2).toBeGreaterThanOrEqual(0);
      expect(node.x + node.w / 2).toBeLessThanOrEqual(layout.viewBox.w);
      expect(node.y - node.h / 2).toBeGreaterThanOrEqual(0);
      expect(node.y + node.h / 2).toBeLessThanOrEqual(layout.viewBox.h);
    }
  });

  it('ignores a hand-over whose end is not a domain', () => {
    const layout = layoutMap(ids('a', 'b'), [edge('a', 'zzz'), edge('a', 'b')]);
    expect(layout.edges.map((one) => one.index)).toEqual([1]);
  });
});

describe('the colours', () => {
  it('follow the place on the ring, wrapping over the twelve, and the centre is neutral', () => {
    const many = ids('hub', ...Array.from({ length: 14 }, (_, at) => `n${at}`));
    const layout = layoutMap(many, many.slice(1).map((one) => edge('hub', one.id)));
    expect(layout.centre).toBe('hub');
    expect(layout.nodes.filter((node) => node.id !== 'hub').map((node) => node.colour)).toEqual(Array.from({ length: 14 }, (_, at) => at % 12));
    const colours = domainColours(layout.ring, layout.centre);
    expect(colours.hub).toEqual(NEUTRAL);
    expect(colours[layout.ring[0]]).toEqual(STRATA[0]);
    expect(colours[layout.ring[12]]).toEqual(STRATA[0]);
    expect(colours[layout.ring[13]]).toEqual(STRATA[1]);
  });
});

describe('the labels', () => {
  it('give a box the room of its name between 96 and 180, wide characters taking more', () => {
    expect(boxWidth('Ab')).toBe(96);
    expect(boxWidth(wide(4))).toBe(Math.max(96, 15 * 4 + 34));
    expect(boxWidth(wide(30))).toBe(180);
    expect(boxWidth('x'.repeat(60))).toBe(180);
  });

  it('keep a name that fits and cut one that does not, with an ellipsis and the full name in the layout', () => {
    expect(fitLabel('Platform')).toEqual({ label: 'Platform', truncated: false });
    const cut = fitLabel(wide(12));
    expect(cut.truncated).toBe(true);
    expect(cut.label.endsWith(String.fromCharCode(0x2026))).toBe(true);
    expect(cut.label.length).toBeLessThan(12);
    const layout = layoutMap([{ id: 'a', name: 'x'.repeat(40), features: 1 }], []);
    expect(layout.nodes[0].truncated).toBe(true);
    expect(layout.nodes[0].w).toBe(180);
  });
});
