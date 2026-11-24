import { describe, expect, it } from 'vitest';

import { missingEndText, externalLabel, relationRows, siteText, unitsOf } from '../relations';

const site = (unit: string | null, file: string, line: number, more: Record<string, unknown> = {}) => ({ unit, family: 'js', file, line, quote: `q ${file}`, nodeId: null, nodeIdBy: 'none', evidence: [], ...more });

const PRODUCT = {
  status: 'complete',
  units: [
    { id: 'unit:web', name: 'web', root: 'web', kind: 'runtime' },
    { id: 'unit:api', name: 'api', root: 'api', kind: 'runtime' },
    { id: 'unit:lib', name: 'lib', root: 'lib', kind: 'library' },
  ],
  externals: [{ id: 'external:mail', keyBy: ['name'], names: ['Mailer'], hosts: [] }, { id: 'external:maps' }],
  relations: [
    { id: 'rel:1', kind: 'http', bucket: 'linked', addressKey: 'GET /orders', reason: 'Loads orders', caller: site('unit:web', 'web/a.js', 3), receiver: { ...site('unit:api', 'api/r.js', 7), addressKey: 'GET /orders' } },
    { id: 'rel:2', kind: 'http', bucket: 'linked', addressKey: 'GET /orders', caller: site('unit:web', 'web/b.js', 9), receiver: { ...site('unit:api', 'api/r.js', 7), addressKey: 'GET /orders' } },
    { id: 'rel:3', kind: 'external', bucket: 'linked', addressKey: 'external:mail', caller: site('unit:api', 'api/m.js', 2), receiver: { external: 'external:mail' } },
    { id: 'rel:4', kind: 'http', bucket: 'caller-only', addressKey: 'POST /refunds', caller: site('unit:web', 'web/c.js', 4), receiver: null },
    { id: 'rel:5', kind: 'http', bucket: 'receiver-only', addressKey: 'GET /health', caller: null, receiver: site('unit:api', 'api/h.js', 1) },
    { id: 'rel:6', kind: 'external', bucket: 'address-unresolved', role: 'caller', unresolved: 'URL is a parameter', caller: site('unit:api', 'api/x.js', 5) },
    { id: 'rel:7', kind: 'http', bucket: 'quote-failed', role: 'caller', rejection: { reason: 'quote-mismatch', detail: 'not near' }, caller: { file: 'api/gone.js', line: 9, quote: 'call()' } },
    { id: 'rel:9', kind: 'http', bucket: 'quote-failed', role: 'receiver', rejection: { reason: 'file-missing', detail: null }, receiver: { file: 'api/old.js', line: 3, quote: 'get()' } },
    { id: 'rel:10', kind: 'http', bucket: 'address-unresolved', role: 'receiver', unresolved: 'path built at run time', receiver: site('unit:api', 'api/dyn.js', 4) },
    { id: 'rel:11', kind: 'http', bucket: 'quote-failed', role: 'caller', rejection: { reason: 'malformed', detail: 'relation has no end' }, caller: null },
    { id: 'rel:12', kind: 'http', bucket: 'quote-failed', role: 'receiver', rejection: { reason: 'quote-mismatch', detail: null }, receiver: null },
    { id: 'rel:13', kind: null, bucket: 'quote-failed', role: 'caller', rejection: { reason: 'malformed', detail: 'unknown kind 7' }, caller: { file: 'api/odd.js', line: 2, quote: 'odd()' } },
    { id: 'rel:8', kind: 'http', bucket: 'ambiguous', addressKey: 'GET /x', caller: site('unit:web', 'web/d.js', 1), receiver: null, candidates: [{ unit: 'unit:api', file: 'api/x1.js', line: 2, addressKey: 'GET /x' }] },
  ],
  buckets: {
    caller: { linked: 3, ambiguous: 1, 'caller-only': 1, 'address-unresolved': 1, 'quote-failed': 1 },
    receiver: { linked: 1, 'receiver-only': 1, 'address-unresolved': 0, 'quote-failed': 0, 'a-new-bucket': 2 },
  },
  measurements: {
    http: { ends: 7, quoteFailed: 1, quoteFailureRate: 0.1429, unresolved: 0, unresolvedShare: 0, linked: 2, agreement: { status: 'measured', jaccard: 0.5 }, escalation: { candidate: true, reasons: ['agreement', 'quote-failure'] } },
    rpc: { ends: 0, quoteFailed: 0, quoteFailureRate: null, unresolved: 0, unresolvedShare: null, linked: 0, agreement: { status: 'insufficient', jaccard: null }, escalation: { candidate: false, reasons: [] } },
  },
};

describe('relationRows', () => {
  it('reads every relation, keeping what it does not have as null, and says each one\'s address in words', () => {
    const rows = relationRows(PRODUCT);
    expect(rows.map((r) => r.id)).toEqual(['rel:1', 'rel:2', 'rel:3', 'rel:4', 'rel:5', 'rel:6', 'rel:7', 'rel:9', 'rel:10', 'rel:11', 'rel:12', 'rel:13', 'rel:8']);
    expect(rows[0]).toMatchObject({ kind: 'http', bucket: 'linked', address: 'GET /orders', reason: 'Loads orders', external: null });
    expect(rows[0].caller).toMatchObject({ unit: 'unit:web', file: 'web/a.js', line: 3 });
    expect(rows[2]).toMatchObject({ external: 'external:mail', receiver: null });
    expect(rows[5]).toMatchObject({ address: 'unresolved: URL is a parameter', receiver: null });
    expect(rows[6]).toMatchObject({ address: 'rejected: quote-mismatch (not near)', caller: { unit: null, file: 'api/gone.js', line: 9 } });
    expect(rows[6].role).toBe('caller');
    expect(rows[0].role).toBeNull();
    expect(rows[11]).toMatchObject({ id: 'rel:13', kind: null, caller: { unit: null, file: 'api/odd.js', line: 2 } });
    expect(rows[12].candidates).toEqual([{ unit: 'unit:api', file: 'api/x1.js', line: 2, addressKey: 'GET /x' }]);
  });

  it('reads a product that is not in the expected shape as no rows', () => {
    expect(relationRows(null)).toEqual([]);
    expect(relationRows({ relations: 'x' })).toEqual([]);
  });
});

describe('sites', () => {
  it('says a site as file:line, the file alone without a line, and nothing without a file', () => {
    expect(siteText({ file: 'a.js', line: 3 })).toBe('a.js:3');
    expect(siteText({ file: 'a.js', line: null })).toBe('a.js');
    expect(siteText(null)).toBeNull();
  });

  it('labels an external system by its id without the prefix', () => {
    expect(externalLabel('external:api.example.com')).toBe('api.example.com');
    expect(externalLabel('mail')).toBe('mail');
  });
});

describe('units', () => {
  it('lists the units as the product does', () => {
    expect(unitsOf(PRODUCT).map((u) => [u.id, u.name, u.kind])).toEqual([['unit:web', 'web', 'runtime'], ['unit:api', 'api', 'runtime'], ['unit:lib', 'lib', 'library']]);
  });
});

describe('a missing end', () => {
  const row = (id: string) => relationRows(PRODUCT).find((r) => r.id === id)!;
  it('says a receiver-only end has no caller reaching its address', () => {
    expect(missingEndText(row('rel:5'), 'caller')).toBe('No caller site: no caller on another unit reaches this address.');
    expect(missingEndText(row('rel:5'), 'receiver')).toBeNull();
  });
  it('says an unpaired receiving end was not paired, never that no caller reaches it', () => {
    expect(missingEndText(row('rel:9'), 'caller')).toBe('No caller site: this receiving site is quote-failed, and the merge pairs only ends that pass the quote check and resolve an address.');
    expect(missingEndText(row('rel:10'), 'caller')).toBe('No caller site: this receiving site is address-unresolved, and the merge pairs only ends that pass the quote check and resolve an address.');
  });
  it('says once, for either role, that a relation has no readable site, without claiming one was written', () => {
    expect(missingEndText(row('rel:11'), 'caller')).toBe('The analyzer wrote no readable site for this relation (quote-failed).');
    expect(missingEndText(row('rel:11'), 'receiver')).toBeNull();
    expect(missingEndText(row('rel:12'), 'caller')).toBe('The analyzer wrote no readable site for this relation (quote-failed).');
    expect(missingEndText(row('rel:12'), 'receiver')).toBeNull();
  });
  it('says a calling end has no receiver in its own bucket, and an ambiguous one has several', () => {
    expect(missingEndText(row('rel:4'), 'receiver')).toBe('No receiving site (caller-only).');
    expect(missingEndText(row('rel:7'), 'receiver')).toBe('No receiving site (quote-failed).');
    expect(missingEndText(row('rel:8'), 'receiver')).toBe('No single receiving site: several receivers match this address (ambiguous).');
    expect(missingEndText(row('rel:1'), 'caller')).toBeNull();
    expect(missingEndText(row('rel:3'), 'receiver')).toBeNull();
  });
});

