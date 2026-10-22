import { describe, expect, it } from 'vitest';

import type { Manifest } from '../src/data/manifest';
import { detailText, differentRevisionNote, statusLabel, worstStatus } from '../src/lib/products';
import { PAGES } from '../src/pages/registry';

describe('product states on the Products page', () => {
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
    expect(detailText({ ...base, status: 'different-revision', revision: 'git:0', reason: 'its factDigest is aa and the graph\'s factsDigest is bb' }, 'git:1')).toBe('Made at git:0; the source snapshot is git:1. its factDigest is aa and the graph\'s factsDigest is bb.');
    // Made at the snapshot's revision but from other facts: only the reason is left to say.
    expect(detailText({ ...base, status: 'different-revision', revision: 'git:1', reason: 'its factDigest is aa and the graph\'s factsDigest is bb' }, 'git:1')).toBe('its factDigest is aa and the graph\'s factsDigest is bb.');
    expect(detailText({ ...base, status: 'included', revisionNote: 'no revision recorded' }, 'git:1')).toBe('No revision recorded.');
    expect(detailText({ ...base, status: 'included' }, 'git:1')).toBe('Made at the source snapshot revision.');
  });

  it('says that a tour from other facts shows no steps, and that any other product is shown as written', () => {
    const tour = { name: 'tour', status: 'different-revision', reason: 'its factDigest is aa and the graph\'s factsDigest is bb', file: 'tour.json', revision: 'git:1', revisionNote: null } as const;
    expect(detailText(tour, 'git:1')).toBe('its factDigest is aa and the graph\'s factsDigest is bb. Its steps are not shown: their node ids may not match this graph.');
    expect(differentRevisionNote('tour')).toBe('Its steps are not shown: their node ids may not match this graph.');
    expect(differentRevisionNote('hotspots')).toBe('Its content is shown as it was written.');
    expect(detailText({ ...tour, status: 'included', reason: null, revisionNote: 'same facts as knowledge-graph.jsonl (factsDigest aa)' }, 'git:1')).toBe('Same facts as knowledge-graph.jsonl (factsDigest aa).');
  });
});

describe('the pages', () => {
  it('are in navigation order', () => {
    expect(PAGES.map((p) => p.id)).toEqual(['graph', 'domain', 'products', 'unused', 'doc-map', 'hotspots', 'code', 'reports']);
    expect(PAGES.map((p) => p.label)).toEqual(['Graph', 'Domain', 'Products', 'Unused code', 'Doc map', 'Hotspots', 'Code', 'Reports']);
  });

  it('show in the navigation the state of the product each one shows', () => {
    const product = (name: string, status: string) => ({ name, label: name, status, reason: null, revision: null, revisionNote: null, command: '', file: '', payloads: [] });
    const manifest = {
      viewer: 1,
      project: { name: 'p' },
      snapshot: { revision: 'git:1', kind: 'git' },
      products: [product('knowledge-graph', 'included'), product('domain-graph', 'different-revision'), product('unused-code', 'different-revision'), product('hotspots', 'unreadable')],
      source: { embedded: true, requested: true, limitBytes: 1, counts: { embedded: 1, binary: 0, tooLarge: 0, notInSnapshot: 0, notEmbeddedOnRequest: 0 }, files: {} },
    } as unknown as Manifest;
    const status = Object.fromEntries(PAGES.map((p) => [p.id, p.status(manifest)]));
    expect(status).toEqual({ graph: 'included', domain: 'different-revision', products: 'unreadable', unused: 'different-revision', 'doc-map': 'not-run', hotspots: 'unreadable', code: 'included', reports: 'not-run' });
  });
});
