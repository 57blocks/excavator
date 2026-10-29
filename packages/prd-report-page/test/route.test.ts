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
    expect(parseHash('#/findings')).toEqual({ name: 'findings', filters: { class: 'all', priority: 'all', feature: '', q: '' } });
  });

  it('reads the findings filters from the query', () => {
    expect(parseHash('#/findings?class=product&feature=F2&q=cancel%20order')).toEqual({
      name: 'findings', filters: { class: 'product', priority: 'all', feature: 'F2', q: 'cancel order' },
    });
    expect(parseHash('#/findings?q=a?b&class=technical')).toEqual({
      name: 'findings', filters: { class: 'technical', priority: 'all', feature: '', q: 'a?b' },
    });
  });

  it('reads the priority filter: P0, P1, P2 and unranked, alone and with the other filters', () => {
    for (const priority of ['P0', 'P1', 'P2', 'unranked']) {
      expect(parseHash(`#/findings?priority=${priority}`), priority).toEqual({
        name: 'findings', filters: { class: 'all', priority, feature: '', q: '' },
      });
    }
    expect(parseHash('#/findings?class=technical&priority=P1&feature=F2&q=cancel')).toEqual({
      name: 'findings', filters: { class: 'technical', priority: 'P1', feature: 'F2', q: 'cancel' },
    });
  });

  it('drops a priority that is not one of the known values instead of failing', () => {
    for (const bad of ['P3', 'p0', 'Unranked', 'urgent', '', 'all']) {
      expect(parseHash(`#/findings?priority=${bad}&class=product`), bad).toEqual({
        name: 'findings', filters: { class: 'product', priority: 'all', feature: '', q: '' },
      });
    }
  });

  it('drops a class that is not product, technical or all instead of failing', () => {
    expect(parseHash('#/findings?class=urgent')).toEqual({ name: 'findings', filters: { class: 'all', priority: 'all', feature: '', q: '' } });
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

describe('the finding parameter of a feature route', () => {
  it('reads and writes #/feature/<id>?finding=<fid>', () => {
    expect(parseHash('#/feature/F2?finding=F2-1')).toEqual({ name: 'feature', id: 'F2', finding: 'F2-1' });
    expect(serializeRoute({ name: 'feature', id: 'F2', finding: 'F2-1' })).toBe('#/feature/F2?finding=F2-1');
    expect(featureHash('F2', 'F2-1')).toBe('#/feature/F2?finding=F2-1');
    expect(featureHash('F2')).toBe('#/feature/F2');
  });

  it('treats an empty or missing finding as none', () => {
    for (const hash of ['#/feature/F2?finding=', '#/feature/F2?', '#/feature/F2']) {
      expect(parseHash(hash), hash).toEqual({ name: 'feature', id: 'F2' });
      expect('finding' in (parseHash(hash) as object), hash).toBe(false);
    }
    expect(serializeRoute({ name: 'feature', id: 'F2', finding: '' })).toBe('#/feature/F2');
  });

  it('drops every other parameter', () => {
    expect(parseHash('#/feature/F2?class=product&finding=F2-1&q=x')).toEqual({ name: 'feature', id: 'F2', finding: 'F2-1' });
    expect(parseHash('#/feature/F2?class=product')).toEqual({ name: 'feature', id: 'F2' });
  });

  it('round-trips ids that need escaping, and a trailing slash before the query still parses', () => {
    const route: Route = { name: 'feature', id: 'F 1/2?', finding: 'F 1/2?-3 & 4' };
    expect(parseHash(serializeRoute(route))).toEqual(route);
    expect(parseHash('#/feature/F2/?finding=F2-1')).toEqual({ name: 'feature', id: 'F2', finding: 'F2-1' });
  });

  it('keeps a bad feature escape as not-found even with a finding', () => {
    expect(parseHash('#/feature/%E0%A4%A?finding=x')).toEqual({ name: 'not-found', hash: '#/feature/%E0%A4%A?finding=x' });
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

  it('writes the priority filter after the class and before the feature', () => {
    expect(findingsHash({ priority: 'P0' })).toBe('#/findings?priority=P0');
    expect(findingsHash({ priority: 'unranked' })).toBe('#/findings?priority=unranked');
    expect(findingsHash({ priority: 'all' })).toBe('#/findings');
    expect(findingsHash({ q: 'x', feature: 'F1', priority: 'P2', class: 'product' })).toBe('#/findings?class=product&priority=P2&feature=F1&q=x');
  });

  it('round-trips every route, including ids and text that need escaping', () => {
    const routes: Route[] = [
      { name: 'overview' },
      { name: 'coverage' },
      { name: 'feature', id: 'F1' },
      { name: 'feature', id: 'F 1/2?' },
      { name: 'findings', filters: { class: 'all', priority: 'all', feature: '', q: '' } },
      { name: 'findings', filters: { class: 'product', priority: 'all', feature: 'F2', q: `x & y=z #1 100% ${String.fromCharCode(0xe9)}` } },
      { name: 'findings', filters: { class: 'technical', priority: 'unranked', feature: 'F2', q: 'a' } },
      { name: 'findings', filters: { class: 'all', priority: 'P0', feature: '', q: '' } },
    ];
    for (const route of routes) expect(parseHash(serializeRoute(route)), serializeRoute(route)).toEqual(route);
  });
});
