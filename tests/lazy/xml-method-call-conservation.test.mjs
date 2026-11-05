// spring-xml-method-calls, task 3.5: the conservation of the method call stage
// inside buildFactGraph (spec: unbalanced conservation fails the build). The
// resolver is the real one, wrapped so a test can make it lose a gap, add one or
// miscount; buildFactGraph reads the gap counts back from what it recorded into
// the graph and must refuse a product whose counts do not add up.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { buildFactGraph } from '../../skills/excavator/build-fact-graph.mjs';
import { readStructureAll } from '../../skills/excavator/structure-all-store.mjs';
import { loadNameBindingCatalog } from '../../skills/excavator/name-binding-catalog.mjs';
import { collectNameReferenceSites } from '../../skills/excavator/name-reference-sites.mjs';

let tamper = null;
vi.mock('../../skills/excavator/xml-method-call-resolution.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveXmlMethodCalls: (args) => {
      const resolved = actual.resolveXmlMethodCalls(args);
      return tamper === null ? resolved : tamper(resolved);
    },
  };
});

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/spring-xml-method-calls');

describe('the conservation of the method call stage in buildFactGraph', () => {
  let root;
  let inputs;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'excavator-xml-method-call-conservation-'));
    cpSync(FIXTURE, root, { recursive: true });
    await runLazyAnalysis({ projectRoot: root, now: () => '2024-01-01T00:00:00.000Z' });
    const intermediate = join(root, '.excavator', 'intermediate');
    const scan = JSON.parse(readFileSync(join(intermediate, 'scan-result.json'), 'utf-8'));
    const catalog = loadNameBindingCatalog();
    inputs = {
      scan,
      structureAll: readStructureAll(join(intermediate, 'structure-all.jsonl')),
      importMap: JSON.parse(readFileSync(join(intermediate, 'import-map.json'), 'utf-8')),
      nameReferenceSites: collectNameReferenceSites({ scan, catalog, readFile: (path) => readFileSync(join(root, path), 'utf-8') }),
      nameBindingCatalog: catalog,
    };
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const build = (wrap) => {
    tamper = wrap;
    try {
      return buildFactGraph(inputs);
    } finally {
      tamper = null;
    }
  };

  it('builds when the buckets add up and the recorded gaps read back to them', () => {
    const graph = build(null);
    expect(graph.coverage.methodCalls).toMatchObject({ status: 'ran', siteCount: 27 });
    expect(graph.edges.filter((e) => e.type === 'invokes')).toHaveLength(12);
  });

  it('fails when a gap of a kind is missing from what was recorded: the read-back is not the bucket sum', () => {
    const lose = (kind) => (resolved) => {
      const index = resolved.gaps.findIndex((g) => g.kind === kind);
      return { ...resolved, gaps: resolved.gaps.filter((_, i) => i !== index) };
    };
    for (const kind of ['method-call-owner-unresolved', 'method-call-method-unresolved', 'method-call-ambiguous']) {
      expect(() => build(lose(kind)), kind).toThrow(new RegExp(`${kind} outcome\\(s\\) but \\d+ recorded gap occurrence\\(s\\)`));
    }
  });

  it('fails when a gap is recorded for a call that is no gap bucket', () => {
    const extra = (resolved) => ({ ...resolved, gaps: [...resolved.gaps, { kind: 'method-call-ambiguous', scope: 'xml', sample: 'extra' }] });
    expect(() => build(extra)).toThrow(/method-call-ambiguous outcome\(s\) but 2 recorded gap occurrence\(s\)/);
  });

  it('fails when the buckets do not add up to the calls', () => {
    const miscount = (resolved) => ({ ...resolved, coverage: { ...resolved.coverage, siteCount: resolved.coverage.siteCount + 1 } });
    expect(() => build(miscount)).toThrow(/28 method call site\(s\) but 27 outcome\(s\)/);
  });

  it('fails when a bucket is moved to another without its gap: a gap bucket count that the recorded gaps do not match', () => {
    const move = (resolved) => {
      const buckets = { ...resolved.coverage.buckets, methodMissing: resolved.coverage.buckets.methodMissing - 1, optionalInactive: resolved.coverage.buckets.optionalInactive + 1 };
      return { ...resolved, coverage: { ...resolved.coverage, buckets } };
    };
    expect(() => build(move)).toThrow(/method-call-method-unresolved outcome\(s\) but 3 recorded gap occurrence\(s\)/);
  });

  it('writes no coverage and no edge for a projection built without the name stages: not-run', () => {
    const { nameReferenceSites, nameBindingCatalog, ...without } = inputs;
    expect(nameReferenceSites).toBeDefined();
    expect(nameBindingCatalog).toBeDefined();
    const graph = buildFactGraph(without);
    expect(graph.coverage.methodCalls).toEqual({ status: 'not-run' });
    expect(graph.edges.some((e) => e.type === 'invokes')).toBe(false);
  });
});
