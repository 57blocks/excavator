/**
 * The viewer's pure functions, run in Node through `vm` (design D1): the files
 * of viewer/src are classic scripts that hang everything on `window.XV`, so a
 * context with a `window` and the few browser globals they use is enough. DOM
 * drawing is checked by the browser smoke script, not here.
 */

import { describe, expect, it } from 'vitest';

import { encodePayload } from '../../../skills/excavator-view/page-assembly.mjs';
import { graphJsonl } from './fixture.mjs';
import { load } from './viewer-load.mjs';

describe('router', () => {
  const { parseRoute, buildHash } = load().router;
  const plain = (value) => JSON.parse(JSON.stringify(value));

  it.each([
    ['', 'overview', '', {}],
    ['#', 'overview', '', {}],
    ['#/', 'overview', '', {}],
    ['#/overview', 'overview', '', {}],
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

  it('gives the Overview for something that is not a string', () => {
    expect(parseRoute(undefined).page).toBe('overview');
    expect(parseRoute(null).page).toBe('overview');
  });

  it('builds hashes that parse back', () => {
    const hash = buildHash('code', { path: 'src/a b&c.js', lines: '3-9', skipped: null });
    expect(hash).toBe('#/code?path=src%2Fa%20b%26c.js&lines=3-9');
    expect(plain(parseRoute(hash))).toEqual({ page: 'code', rest: '', params: { path: 'src/a b&c.js', lines: '3-9' } });
    expect(buildHash('reports', {}, 'doc map')).toBe('#/reports/doc%20map');
    expect(buildHash('overview')).toBe('#/overview');
  });
});

describe('app.js', () => {
  it('loads without a page to boot into and exposes boot', () => {
    const XV = load({ document: { getElementById: () => null } }, { withApp: true });
    expect(typeof XV.boot).toBe('function');
  });

  it('does not boot when there is no document at all', () => {
    expect(typeof load({}, { withApp: true }).boot).toBe('function');
  });
});

describe('formatNumber and status words', () => {
  const XV = load();
  it('groups digits and refuses non-numbers', () => {
    expect(XV.formatNumber(0)).toBe('0');
    expect(XV.formatNumber(999)).toBe('999');
    expect(XV.formatNumber(1000)).toBe('1,000');
    expect(XV.formatNumber(1234567)).toBe('1,234,567');
    expect(XV.formatNumber(-12345)).toBe('-12,345');
    expect(XV.formatNumber(null)).toBe(XV.EMPTY);
    expect(XV.formatNumber('12')).toBe(XV.EMPTY);
    expect(XV.formatNumber(NaN)).toBe(XV.EMPTY);
    expect(XV.EMPTY).toBe(String.fromCharCode(0x2014));
  });

  it('keeps pages in their declared order whatever order they register in', () => {
    const fresh = load();
    fresh.pages.register({ id: 'late', order: 60 });
    fresh.pages.register({ id: 'early', order: 25 });
    fresh.pages.register({ id: 'unordered' });
    fresh.pages.register({ id: 'middle', order: 35 });
    expect(fresh.pages.list.map((p) => p.id)).toEqual(['overview', 'unused', 'early', 'doc-map', 'middle', 'hotspots', 'code', 'late', 'unordered']);
  });

  it('names the four states and passes an unknown one through', () => {
    expect(XV.statusLabel('included')).toBe('Included');
    expect(XV.statusLabel('not-run')).toBe('Not run');
    expect(XV.statusLabel('unreadable')).toBe('Unreadable');
    expect(XV.statusLabel('different-revision')).toBe('Different revision');
    expect(XV.statusLabel('constructor')).toBe('constructor');
  });

  it('registers the pages in navigation order', () => {
    expect(XV.pages.list.map((p) => p.id)).toEqual(['overview', 'unused', 'doc-map', 'hotspots', 'code']);
    expect(XV.pages.find('overview').label).toBe('Overview');
    expect(XV.pages.find('missing')).toBeNull();
  });
});

describe('Overview counts', () => {
  const { summarizeGraph } = load().overview;

  it('counts nodes and edges by type from the records', () => {
    const text = graphJsonl({
      nodes: ['file', 'function', 'function', 'class', 'file', 'function'],
      edges: ['calls', 'imports', 'calls'],
      gaps: [{ kind: 'dynamic-call', scope: 'a', reason: 'r', count: 3 }, { kind: 'dynamic-call', scope: 'b', reason: 'r', count: 2 }, { kind: 'parse', scope: 'c', reason: 'r', count: 1 }],
      coverage: {
        files: 10,
        ignored: 4,
        byLanguage: {
          python: { files: 3, parsed: 2, zeroSymbol: 1, skipped: {}, kinds: { function: 7, class: 1, import: 0, export: 0, call: 0 } },
          go: { files: 7, parsed: 4, zeroSymbol: 0, skipped: { 'too-large': 2, sensitive: 1 }, kinds: { function: 9, class: 0, import: 0, export: 0, call: 0 } },
        },
      },
    });
    const summary = summarizeGraph(text);
    expect(summary.totals).toMatchObject({ nodes: 6, edges: 3, gaps: 3 });
    expect(summary.nodesByType).toEqual([{ type: 'function', count: 3 }, { type: 'file', count: 2 }, { type: 'class', count: 1 }]);
    expect(summary.edgesByType).toEqual([{ type: 'calls', count: 2 }, { type: 'imports', count: 1 }]);
    expect(summary.gapsByKind).toEqual([{ kind: 'dynamic-call', records: 2, count: 5 }, { kind: 'parse', records: 1, count: 1 }]);
    expect(summary.project).toMatchObject({ name: 'fixture', languages: ['javascript'], frameworks: ['express'] });
    expect(summary.coverage.files).toBe(10);
    expect(summary.coverage.ignored).toBe(4);
    expect(summary.coverage.languages.map((l) => [l.language, l.files, l.parsed, l.zeroSymbol, l.skipped, l.functions])).toEqual([
      ['go', 7, 4, 0, 3, 9], ['python', 3, 2, 1, 0, 7],
    ]);
    expect(summary.headerCounts).toEqual({ nodes: 6, edges: 3 });
    expect(summary.badLines).toBe(0);
  });

  it('counts the records, not the header, and shows when they differ', () => {
    const lines = graphJsonl({ nodes: ['file', 'file'] }).trimEnd().split('\n');
    const header = JSON.parse(lines[0]);
    header.counts.nodes = 99;
    const summary = summarizeGraph([JSON.stringify(header), ...lines.slice(1)].join('\n'));
    expect(summary.totals.nodes).toBe(2);
    expect(summary.headerCounts.nodes).toBe(99);
  });

  it('puts a record without a type under unknown and counts lines that do not parse', () => {
    const text = [
      JSON.stringify({ record: 'header', format: 'x', keys: [], fields: {}, counts: {} }),
      JSON.stringify({ record: 'node', node: { id: 'a' } }),
      JSON.stringify({ record: 'edge', edge: { source: 'a', target: 'b' } }),
      '{broken',
      '',
      JSON.stringify({ record: 'mystery' }),
    ].join('\n');
    const summary = summarizeGraph(text);
    expect(summary.nodesByType).toEqual([{ type: 'unknown', count: 1 }]);
    expect(summary.edgesByType).toEqual([{ type: 'unknown', count: 1 }]);
    expect(summary.badLines).toBe(1);
    expect(summary.totals.other).toBe(1);
    expect(summary.coverage).toBeNull();
    expect(summary.project.languages).toEqual([]);
  });

  it('notes a graph with no header and counts nothing it was not told', () => {
    const summary = summarizeGraph(`${JSON.stringify({ record: 'node', node: { type: 'file' } })}\n`);
    expect(summary.hasHeader).toBe(false);
    expect(summary.totals.nodes).toBe(1);
    expect(summary.headerCounts).toEqual({ nodes: null, edges: null });
  });

  it('keeps hostile names as plain strings', () => {
    const hostile = '</script><img onerror=x>';
    const summary = summarizeGraph(graphJsonl({ name: hostile, nodes: [hostile] }));
    expect(summary.project.name).toBe(hostile);
    expect(summary.nodesByType[0].type).toBe(hostile);
  });

  it('ranks types of equal count by name', () => {
    const summary = summarizeGraph(graphJsonl({ nodes: ['b', 'a', 'c'] }));
    expect(summary.nodesByType.map((r) => r.type)).toEqual(['a', 'b', 'c']);
  });
});

describe('product states on the Overview', () => {
  const { worstStatus, detailText } = load().overview;

  it('names the most serious state', () => {
    expect(worstStatus([])).toBe('included');
    expect(worstStatus([{ status: 'included' }, { status: 'not-run' }])).toBe('not-run');
    expect(worstStatus([{ status: 'not-run' }, { status: 'different-revision' }])).toBe('different-revision');
    expect(worstStatus([{ status: 'different-revision' }, { status: 'unreadable' }, { status: 'included' }])).toBe('unreadable');
  });

  it('says what each state means for that product', () => {
    expect(detailText({ status: 'unreadable', reason: 'a.json is not valid JSON' }, 'git:1')).toBe('a.json is not valid JSON');
    expect(detailText({ status: 'not-run', file: 'hotspots.json' }, 'git:1')).toBe('There is no hotspots.json.');
    expect(detailText({ status: 'different-revision', revision: 'git:0' }, 'git:1')).toBe('Made at git:0; the source snapshot is git:1.');
    expect(detailText({ status: 'included', revisionNote: 'no revision recorded' }, 'git:1')).toBe('No revision recorded.');
    expect(detailText({ status: 'included', revisionNote: null }, 'git:1')).toBe('Made at the source snapshot revision.');
  });
});

describe('data', () => {
  it('decodes base64, splits JSONL one record at a time and unpacks a payload the packer wrote', async () => {
    const original = JSON.stringify({ name: String.fromCharCode(0x4e2d, 0x6587), hostile: '</script>' });
    const el = { textContent: encodePayload(Buffer.from(original, 'utf-8')) };
    const XV = load({
      atob: (text) => Buffer.from(text, 'base64').toString('binary'),
      Blob, Response, DecompressionStream,
      document: { getElementById: (id) => (id === 'xv-sample' ? el : null) },
    });
    expect(Array.from(XV.data.decodeBase64('aGk=\n'))).toEqual([104, 105]);
    expect(await XV.data.loadText('sample')).toBe(original);
    expect(await XV.data.loadJson('sample')).toEqual(JSON.parse(original));
    expect(XV.data.loadText('sample')).toBe(XV.data.loadText('sample'));
    await expect(XV.data.loadText('absent')).rejects.toThrow(/no data payload "absent"/);
  });

  it('rejects a payload that is not JSON when JSON is asked for', async () => {
    const el = { textContent: encodePayload(Buffer.from('not json', 'utf-8')) };
    const XV = load({
      atob: (text) => Buffer.from(text, 'base64').toString('binary'),
      Blob, Response, DecompressionStream,
      document: { getElementById: () => el },
    });
    await expect(XV.data.loadJson('x')).rejects.toThrow(/is not valid JSON/);
  });

  it('says a payload that is not gzip could not be unpacked', async () => {
    const XV = load({
      atob: (text) => Buffer.from(text, 'base64').toString('binary'),
      Blob, Response, DecompressionStream,
      document: { getElementById: () => ({ textContent: Buffer.from('plain text, not gzip').toString('base64') }) },
    });
    await expect(XV.data.loadText('x')).rejects.toThrow(/data payload "x" could not be unpacked/);
  });

  it('visits records line by line and counts lines that do not parse', () => {
    const XV = load();
    const seen = [];
    const result = XV.data.eachJsonlRecord('{"a":1}\n\n{bad\n{"a":2}', (r) => seen.push(r.a));
    expect(seen).toEqual([1, 2]);
    expect(result).toEqual({ lines: 2, bad: 1 });
  });

  it('reads the manifest and says what is wrong with it', () => {
    const element = (text) => ({ textContent: text });
    const read = (el) => load({ document: { getElementById: () => el } }).data.readManifest();
    expect(read(element('{"viewer":1}'))).toEqual({ viewer: 1 });
    expect(() => read(null)).toThrow(/no manifest/);
    expect(() => read(element('{'))).toThrow(/not valid JSON/);
  });
});

describe('the element helper only builds text', () => {
  /** A document whose elements record how they were filled and refuse markup properties. */
  function fakeDocument() {
    const log = [];
    const trap = (name) => { throw new Error(`${name} was used`); };
    const document = {
      createElement: (tag) => new Proxy({ tag, attributes: {}, children: [], listeners: [] }, {
        get(target, prop) {
          if (prop === 'setAttribute') return (name, value) => { target.attributes[name] = value; };
          if (prop === 'appendChild') return (child) => { target.children.push(child); return child; };
          if (prop === 'addEventListener') return (type) => { target.listeners.push(type); };
          if (['innerHTML', 'outerHTML', 'insertAdjacentHTML'].includes(prop)) return trap(prop);
          return target[prop];
        },
        set(_target, prop) { return trap(prop); },
      }),
      createTextNode: (text) => { log.push(text); return { text }; },
    };
    return { document, log };
  }

  it('puts strings in as text nodes and never touches markup properties', () => {
    const { document, log } = fakeDocument();
    const XV = load({ document });
    const hostile = '<img src=x onerror=alert(1)>';
    const el = XV.h('div', { class: 'a', text: hostile, 'data-x': hostile, on: { click() {} } }, hostile, 7, [null, false, 'x'], null);
    expect(log).toEqual([hostile, hostile, '7', 'x']);
    expect(el.attributes).toEqual({ class: 'a', 'data-x': hostile });
    expect(el.listeners).toEqual(['click']);
  });

  it.each(['onclick', 'onerror', 'ONLOAD', 'src', 'srcdoc', 'style'])('refuses the attribute %s', (name) => {
    const { document } = fakeDocument();
    const XV = load({ document });
    expect(() => XV.h('div', { [name]: 'x' })).toThrow(/not allowed/);
  });
});
