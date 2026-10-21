import { describe, expect, it } from 'vitest';

import type { Manifest } from '../src/data/manifest';
import { detailText, statusLabel, worstStatus } from '../src/lib/products';
import { PAGES } from '../src/pages/registry';

describe('product states on the Overview', () => {
  it('names the most serious state', () => {
    expect(worstStatus([])).toBe('included');
    expect(worstStatus([{ status: 'included' }, { status: 'not-run' }])).toBe('not-run');
    expect(worstStatus([{ status: 'not-run' }, { status: 'different-revision' }])).toBe('different-revision');
    expect(worstStatus([{ status: 'different-revision' }, { status: 'unreadable' }, { status: 'included' }])).toBe('unreadable');
  });

  it('names the four states and passes an unknown one through', () => {
    expect(statusLabel('included')).toBe('Included');
    expect(statusLabel('not-run')).toBe('Not run');
    expect(statusLabel('unreadable')).toBe('Unreadable');
    expect(statusLabel('different-revision')).toBe('Different revision');
    expect(statusLabel('constructor')).toBe('constructor');
  });

  it('says what each state means for that product', () => {
    const base = { reason: null, file: 'hotspots.json', revision: null, revisionNote: null };
    expect(detailText({ ...base, status: 'unreadable', reason: 'a.json is not valid JSON' }, 'git:1')).toBe('a.json is not valid JSON');
    expect(detailText({ ...base, status: 'not-run' }, 'git:1')).toBe('There is no hotspots.json.');
    expect(detailText({ ...base, status: 'different-revision', revision: 'git:0' }, 'git:1')).toBe('Made at git:0; the source snapshot is git:1.');
    expect(detailText({ ...base, status: 'included', revisionNote: 'no revision recorded' }, 'git:1')).toBe('No revision recorded.');
    expect(detailText({ ...base, status: 'included' }, 'git:1')).toBe('Made at the source snapshot revision.');
  });
});

describe('the pages', () => {
  it('are in navigation order', () => {
    expect(PAGES.map((p) => p.id)).toEqual(['overview', 'unused', 'doc-map', 'hotspots', 'code', 'reports']);
    expect(PAGES.map((p) => p.label)).toEqual(['Overview', 'Unused code', 'Doc map', 'Hotspots', 'Code', 'Reports']);
  });

  it('show in the navigation the state of the product each one shows', () => {
    const product = (name: string, status: string) => ({ name, label: name, status, reason: null, revision: null, revisionNote: null, command: '', file: '', payloads: [] });
    const manifest = {
      viewer: 1,
      project: { name: 'p' },
      snapshot: { revision: 'git:1', kind: 'git' },
      products: [product('knowledge-graph', 'included'), product('unused-code', 'different-revision'), product('hotspots', 'unreadable')],
      source: { embedded: true, requested: true, limitBytes: 1, counts: { embedded: 1, binary: 0, tooLarge: 0, notInSnapshot: 0, notEmbeddedOnRequest: 0 }, files: {} },
    } as unknown as Manifest;
    const status = Object.fromEntries(PAGES.map((p) => [p.id, p.status(manifest)]));
    expect(status).toEqual({ overview: 'unreadable', unused: 'different-revision', 'doc-map': 'not-run', hotspots: 'unreadable', code: 'included', reports: 'not-run' });
  });
});
