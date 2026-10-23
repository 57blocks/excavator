import { describe, expect, it } from 'vitest';

import { buildHash, DEFAULT_PAGE, isBareHash, parseRoute, redirectHash } from '../src/lib/route';

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('parseRoute', () => {
  it.each([
    ['', 'graph', '', {}],
    ['#', 'graph', '', {}],
    ['#/', 'graph', '', {}],
    ['#/products', 'products', '', {}],
    ['#/unused', 'unused', '', {}],
    ['#/reports/hotspots', 'reports', 'hotspots', {}],
    ['#/code?path=src%2Fa%20b.js&lines=3-9', 'code', '', { path: 'src/a b.js', lines: '3-9' }],
    ['#/code?path=a&path=b', 'code', '', { path: 'a' }],
    ['#/code?path=a+b', 'code', '', { path: 'a b' }],
    ['#/code?flag', 'code', '', { flag: '' }],
    ['#/code?path=%E0%A4%A', 'code', '', { path: '%E0%A4%A' }],
    ['#/nothing-here', 'nothing-here', '', {}],
  ])('parses %j', (hash, page, rest, params) => {
    expect(plain(parseRoute(hash))).toEqual({ page, rest, params });
  });

  it('gives the default page for something that is not a string', () => {
    expect(parseRoute(undefined).page).toBe(DEFAULT_PAGE);
    expect(parseRoute(null).page).toBe(DEFAULT_PAGE);
  });

  it('keeps a parameter named like an object property as a parameter', () => {
    const route = parseRoute('#/code?__proto__=x&constructor=y');
    expect(Object.keys(route.params)).toEqual(['__proto__', 'constructor']);
    expect(route.params.constructor).toBe('y');
    expect(Object.getPrototypeOf(route.params)).toBeNull();
  });
});

describe('isBareHash', () => {
  it('is true only for a hash that names no page', () => {
    for (const hash of ['', '#', '#/']) expect(isBareHash(hash), hash).toBe(true);
    for (const hash of ['#/graph', '#/products', '#/?x=1', '#x']) expect(isBareHash(hash), hash).toBe(false);
  });
});

describe('buildHash', () => {
  it('writes the hash the Code page links use', () => {
    const hash = buildHash('code', { path: 'src/a b&c.js', lines: '3-9', skipped: null, alsoSkipped: undefined });
    expect(hash).toBe('#/code?path=src%2Fa%20b%26c.js&lines=3-9');
    expect(buildHash('reports', {}, 'doc map')).toBe('#/reports/doc%20map');
    expect(buildHash('products')).toBe('#/products');
  });

  it('round trips: parse(build(route)) is the route, for awkward values too', () => {
    const awkward = ['a b', 'x&y=z', '100%', 'plus+sign', 'éè', 'a/b/c', '', '#hash', '?q', '</script>'];
    for (const page of ['code', 'doc-map', 'reports']) {
      for (const value of awkward) {
        const params = { path: value, lines: '3-9', n: String(awkward.indexOf(value)) };
        const rest = page === 'reports' ? 'hot spots/sub' : '';
        expect(plain(parseRoute(buildHash(page, params, rest)))).toEqual({ page, rest, params });
      }
    }
  });

  it('round trips over generated routes', () => {
    let seed = 1;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const alphabet = 'ab /&=?#%+.-_é<>';
    const text = () => Array.from({ length: Math.floor(next() * 8) }, () => alphabet[Math.floor(next() * alphabet.length)]).join('');
    for (let round = 0; round < 300; round++) {
      const params: Record<string, string> = {};
      for (let i = 0; i < Math.floor(next() * 4); i++) params[`k${i}${text()}`] = text();
      const route = { page: `p${text()}`.replace(/\//g, ''), rest: '', params };
      expect(plain(parseRoute(buildHash(route.page, params)))).toEqual(route);
    }
  });
});

describe('redirectHash', () => {
  it('sends the old Overview page to the Products page, keeping what follows the page name', () => {
    expect(redirectHash('#/overview')).toBe('#/products');
    expect(redirectHash('#overview')).toBe('#/products');
    expect(redirectHash('#/overview?x=1&y=a%20b')).toBe('#/products?x=1&y=a%20b');
    expect(redirectHash('#/overview/')).toBe('#/products');
  });

  it('leaves every other hash alone', () => {
    for (const hash of ['', '#', '#/', '#/products', '#/graph', '#/graph?path=overview', '#/reports/overview', '#/overviews', '#/code?path=overview']) {
      expect(redirectHash(hash), hash).toBeNull();
    }
  });
});
