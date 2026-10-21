/** The Reports page: the list, the not-run cards and the counts, with a fake DOM. */

import { describe, expect, it } from 'vitest';

import { all, byTag, fakeDom, textOf } from './fake-dom.mjs';
import { load } from './viewer-load.mjs';

const document = fakeDom();
const XV = load({ document });

const manifest = (hotspots, docMap) => ({
  snapshot: { revision: 'git:1' },
  products: [{
    name: 'reports', label: 'Reports', status: hotspots || docMap ? 'included' : 'not-run', payloads: [],
    items: [
      { name: 'hotspots-report', label: 'Hotspots report', file: 'hotspots-report.md', status: hotspots ? 'included' : 'not-run', command: '/excavator-hotspots', payload: hotspots ? 'report-hotspots' : null },
      { name: 'doc-map-report', label: 'Doc map report', file: 'doc-map-report.md', status: docMap ? 'included' : 'not-run', command: '/excavator-doc-map', payload: docMap ? 'report-doc-map' : null },
    ],
  }],
});

function run(m, rest = '') {
  const root = document.createElement('div');
  const counts = {};
  const ctx = { manifest: m, route: { page: 'reports', rest, params: {} }, root, setCount: (k, v) => { counts[k] = v; } };
  return { root, counts, done: XV.reports.render(ctx) };
}

describe('the report list', () => {
  it('says each report is not run and gives the command that makes it', async () => {
    const { root, counts, done } = run(manifest(false, false));
    await done;
    const text = textOf(root);
    expect(text).toContain('Reports are written by a model from the products; this viewer shows them as written.');
    expect(text).toContain('hotspots-report.mdNot runNot run. Command: /excavator-hotspots');
    expect(text).toContain('doc-map-report.mdNot runNot run. Command: /excavator-doc-map');
    expect(byTag(root, 'a')).toEqual([]);
    expect(counts.reports).toBe(0);
  });

  it('links to a report that is included, and counts the included ones', async () => {
    const { root, counts, done } = run(manifest(true, false));
    await done;
    const links = byTag(root, 'a');
    expect(links.map((a) => a.attributes.href)).toEqual(['#/reports/hotspots']);
    expect(counts.reports).toBe(1);
    const both = run(manifest(true, true));
    await both.done;
    expect(both.counts.reports).toBe(2);
    expect(byTag(both.root, 'a').map((a) => a.attributes.href)).toEqual(['#/reports/hotspots', '#/reports/doc-map']);
  });
});

describe('one report', () => {
  it('shows the not-run card and the command for a report that was not run', async () => {
    const { root, counts, done } = run(manifest(false, true), 'hotspots');
    await done;
    expect(textOf(root)).toContain('Hotspots report: not run');
    expect(textOf(root)).toContain('/excavator-hotspots');
    expect(counts.reports).toBe(0);
    expect(all(root).filter((n) => n.tag === 'table')).toEqual([]);
  });

  it('says there is no such report for another name', async () => {
    const { root, done } = run(manifest(true, true), 'nothing');
    await done;
    expect(textOf(root)).toContain('No such report');
  });

  it('renders the Markdown of an included report', async () => {
    const text = '# Title\n\n<img src=x onerror=1>\n\n- a\n';
    const el = { textContent: Buffer.from(text).toString('base64') };
    const { gzipSync } = await import('node:zlib');
    el.textContent = gzipSync(Buffer.from(text, 'utf-8')).toString('base64');
    const XV2 = load({
      document: { ...document, getElementById: (id) => (id === 'xv-report-hotspots' ? el : null) },
      atob: (t) => Buffer.from(t, 'base64').toString('binary'),
      Blob, Response, DecompressionStream,
    });
    const root = document.createElement('div');
    const counts = {};
    await XV2.reports.render({ manifest: manifest(true, false), route: { page: 'reports', rest: 'hotspots', params: {} }, root, setCount: (k, v) => { counts[k] = v; } });
    expect(all(root).filter((n) => n.tag === 'h1').map((n) => textOf(n))).toEqual(['Reports', 'Title']);
    expect(textOf(root)).toContain('<img src=x onerror=1>');
    expect(all(root).filter((n) => n.tag === 'img')).toEqual([]);
    expect(counts).toMatchObject({ reports: 1, 'report-lines': 5 });
  });
});
