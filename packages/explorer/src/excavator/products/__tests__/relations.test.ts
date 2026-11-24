import { describe, expect, it } from 'vitest';

import {
  bucketRows, escalationLines, externalLabel, externalSystems, measurementRows, relationRows, siteText, unitLinks, unitSummaries, unitsOf,
} from '../relations';

const site = (unit: string | null, file: string, line: number, more: Record<string, unknown> = {}) => ({ unit, family: 'js', file, line, quote: `q ${file}`, nodeId: null, nodeIdBy: 'none', evidence: [], ...more });

const PRODUCT = {
  status: 'complete',
  units: [
    { id: 'unit:web', name: 'web', root: 'web', kind: 'runtime' },
    { id: 'unit:api', name: 'api', root: 'api', kind: 'runtime' },
    { id: 'unit:lib', name: 'lib', root: 'lib', kind: 'library' },
  ],
  externals: [{ id: 'external:mail', names: ['Mailer'], hosts: [] }, { id: 'external:maps' }],
  relations: [
    { id: 'rel:1', kind: 'http', bucket: 'linked', addressKey: 'GET /orders', reason: 'Loads orders', caller: site('unit:web', 'web/a.js', 3), receiver: { ...site('unit:api', 'api/r.js', 7), addressKey: 'GET /orders' } },
    { id: 'rel:2', kind: 'http', bucket: 'linked', addressKey: 'GET /orders', caller: site('unit:web', 'web/b.js', 9), receiver: { ...site('unit:api', 'api/r.js', 7), addressKey: 'GET /orders' } },
    { id: 'rel:3', kind: 'external', bucket: 'linked', addressKey: 'external:mail', caller: site('unit:api', 'api/m.js', 2), receiver: { external: 'external:mail' } },
    { id: 'rel:4', kind: 'http', bucket: 'caller-only', addressKey: 'POST /refunds', caller: site('unit:web', 'web/c.js', 4), receiver: null },
    { id: 'rel:5', kind: 'http', bucket: 'receiver-only', addressKey: 'GET /health', caller: null, receiver: site('unit:api', 'api/h.js', 1) },
    { id: 'rel:6', kind: 'external', bucket: 'address-unresolved', role: 'caller', unresolved: 'URL is a parameter', caller: site('unit:api', 'api/x.js', 5) },
    { id: 'rel:7', kind: 'http', bucket: 'quote-failed', role: 'caller', rejection: { reason: 'quote-mismatch', detail: 'not near' }, caller: { file: 'api/gone.js', line: 9, quote: 'call()' } },
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
    expect(rows.map((r) => r.id)).toEqual(['rel:1', 'rel:2', 'rel:3', 'rel:4', 'rel:5', 'rel:6', 'rel:7', 'rel:8']);
    expect(rows[0]).toMatchObject({ kind: 'http', bucket: 'linked', address: 'GET /orders', reason: 'Loads orders', external: null });
    expect(rows[0].caller).toMatchObject({ unit: 'unit:web', file: 'web/a.js', line: 3 });
    expect(rows[2]).toMatchObject({ external: 'external:mail', receiver: null });
    expect(rows[5]).toMatchObject({ address: 'unresolved: URL is a parameter', receiver: null });
    expect(rows[6]).toMatchObject({ address: 'rejected: quote-mismatch (not near)', caller: { unit: null, file: 'api/gone.js', line: 9 } });
    expect(rows[7].candidates).toEqual([{ unit: 'unit:api', file: 'api/x1.js', line: 2, addressKey: 'GET /x' }]);
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

  it('counts each unit\'s sites by role and bucket, and names the units and external systems it reaches by a linked relation', () => {
    const summaries = unitSummaries(unitsOf(PRODUCT), relationRows(PRODUCT));
    const web = summaries.find((s) => s.unit.id === 'unit:web')!;
    expect(web.calls).toEqual({ linked: 2, 'caller-only': 1, ambiguous: 1 });
    expect(web.receives).toEqual({});
    expect(web.reaches).toEqual([{ kind: 'http', target: 'unit:api', external: false, relations: 2 }]);
    const api = summaries.find((s) => s.unit.id === 'unit:api')!;
    expect(api.calls).toEqual({ linked: 1, 'address-unresolved': 1 });
    expect(api.receives).toEqual({ linked: 2, 'receiver-only': 1 });
    expect(api.reaches).toEqual([{ kind: 'external', target: 'external:mail', external: true, relations: 1 }]);
    expect(summaries.find((s) => s.unit.id === 'unit:lib')).toMatchObject({ calls: {}, receives: {}, reaches: [] });
  });
});

describe('links', () => {
  it('groups the linked relations by kind, caller unit and receiver unit or external system', () => {
    const links = unitLinks(relationRows(PRODUCT));
    expect(links.map((l) => [l.kind, l.from, l.to, l.external, l.relations.map((r) => r.id)])).toEqual([
      ['external', 'unit:api', 'external:mail', true, ['rel:3']],
      ['http', 'unit:web', 'unit:api', false, ['rel:1', 'rel:2']],
    ]);
    expect(links[1].callerSites).toBe(2);
    expect(links[1].receiverSites).toBe(1);
  });
});

describe('external systems', () => {
  it('lists every external system of the product and those only relations name, with the units that call it', () => {
    const systems = externalSystems(PRODUCT, relationRows(PRODUCT));
    expect(systems.map((s) => [s.id, s.units, s.relations.map((r) => r.id), s.names])).toEqual([
      ['external:mail', ['unit:api'], ['rel:3'], ['Mailer']],
      ['external:maps', [], [], null],
    ]);
  });
});

describe('bucketRows', () => {
  it('gives each role\'s buckets in the merge\'s order, then any bucket the page does not know, never dropping one', () => {
    const rows = bucketRows(PRODUCT.buckets);
    expect(rows.caller.map((r) => [r.bucket, r.count])).toEqual([['linked', 3], ['ambiguous', 1], ['caller-only', 1], ['address-unresolved', 1], ['quote-failed', 1]]);
    expect(rows.receiver.map((r) => [r.bucket, r.count])).toEqual([['linked', 1], ['receiver-only', 1], ['address-unresolved', 0], ['quote-failed', 0], ['a-new-bucket', 2]]);
    expect(bucketRows(undefined)).toEqual({ caller: [], receiver: [] });
  });
});

describe('measurements', () => {
  it('gives one row per kind, as the product records it', () => {
    const rows = measurementRows(PRODUCT.measurements);
    expect(rows.map((r) => r.kind)).toEqual(['http', 'rpc']);
    expect(rows[0]).toMatchObject({ ends: 7, quoteFailed: 1, quoteFailureRate: 0.1429, linked: 2, agreement: 'measured 0.5', escalation: ['agreement', 'quote-failure'] });
    expect(rows[1]).toMatchObject({ quoteFailureRate: null, agreement: 'insufficient', escalation: [] });
  });

  it('says each escalation candidate as the measurement and the threshold it crossed, with no advice', () => {
    const thresholds = { agreement: 0.8, quoteFailureRate: 0.1, unresolvedShare: 0.3 };
    const candidates = [{ kind: 'http', reasons: ['agreement', 'quote-failure', 'something-new'] }];
    expect(escalationLines(candidates, PRODUCT.measurements, thresholds)).toEqual([
      'http: agreement with the previous run 0.5, below the threshold 0.8',
      'http: quote failure rate 0.1429, above the threshold 0.1',
      'http: something-new',
    ]);
    expect(escalationLines(candidates.slice(0, 1).map((c) => ({ ...c, reasons: ['unresolved'] })), { http: { unresolvedShare: 0.4 } }, null)).toEqual(['http: unresolved address share 0.4, above the threshold not recorded']);
  });
});
