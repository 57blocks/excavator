import { describe, expect, it } from 'vitest';

import { featureHash, findingsHash, parseHash, serializeRoute } from '../src/lib/route';
import type { Route } from '../src/lib/route';

describe('parseHash', () => {
  it('reads the four pages', () => {
    expect(parseHash('')).toEqual({ name: 'overview' });
    expect(parseHash('#')).toEqual({ name: 'overview' });
    expect(parseHash('#/')).toEqual({ name: 'overview' });
    expect(parseHash('#/coverage')).toEqual({ name: 'coverage' });
    expect(parseHash('#/feature/F12')).toEqual({ name: 'feature', id: 'F12' });
    expect(parseHash('#/findings')).toEqual({ name: 'findings', filters: { class: 'all', feature: '', q: '' } });
  });

  it('reads the findings filters from the query', () => {
    expect(parseHash('#/findings?class=product&feature=F2&q=cancel%20order')).toEqual({
      name: 'findings', filters: { class: 'product', feature: 'F2', q: 'cancel order' },
    });
    expect(parseHash('#/findings?q=a?b&class=technical')).toEqual({
      name: 'findings', filters: { class: 'technical', feature: '', q: 'a?b' },
    });
  });

  it('drops a class that is not product, technical or all instead of failing', () => {
    expect(parseHash('#/findings?class=urgent')).toEqual({ name: 'findings', filters: { class: 'all', feature: '', q: '' } });
  });

  it('tolerates a trailing slash', () => {
    expect(parseHash('#/coverage/')).toEqual({ name: 'coverage' });
    expect(parseHash('#/feature/F1/')).toEqual({ name: 'feature', id: 'F1' });
  });

  it('gives not-found for an unknown route, a missing id, extra segments and a broken escape', () => {
    for (const hash of ['#/nope', '#nope', '#/feature', '#/feature/', '#/feature/F1/extra', '#/coverage/x', '#/feature/%E0%A4%A']) {
      expect(parseHash(hash), hash).toEqual({ name: 'not-found', hash });
    }
  });
});

describe('serializeRoute', () => {
  it('writes the plain pages', () => {
    expect(serializeRoute({ name: 'overview' })).toBe('#/');
    expect(serializeRoute({ name: 'coverage' })).toBe('#/coverage');
    expect(featureHash('F3')).toBe('#/feature/F3');
    expect(findingsHash()).toBe('#/findings');
  });

  it('writes only the filters that are set, in a fixed order', () => {
    expect(findingsHash({ class: 'technical' })).toBe('#/findings?class=technical');
    expect(findingsHash({ q: 'a b', feature: 'F1', class: 'product' })).toBe('#/findings?class=product&feature=F1&q=a+b');
  });

  it('round-trips every route, including ids and text that need escaping', () => {
    const routes: Route[] = [
      { name: 'overview' },
      { name: 'coverage' },
      { name: 'feature', id: 'F1' },
      { name: 'feature', id: 'F 1/2?' },
      { name: 'findings', filters: { class: 'all', feature: '', q: '' } },
      { name: 'findings', filters: { class: 'product', feature: 'F2', q: `x & y=z #1 100% ${String.fromCharCode(0xe9)}` } },
    ];
    for (const route of routes) expect(parseHash(serializeRoute(route)), serializeRoute(route)).toEqual(route);
  });
});
