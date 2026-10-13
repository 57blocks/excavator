// annotation-injection-references, task 4.2: the joint conservation of the two
// injection stages inside buildFactGraph (spec: unbalanced conservation fails the
// build). The annotation resolver is the real one, wrapped so a test can make it
// lose a gap, add one or miscount; buildFactGraph reads the gap counts back from
// what it recorded into the graph and must refuse a product whose counts do not add
// up, with the XML stage's sites and the annotation stage's in one count per gap
// kind. The mutation tripwires of the stage are reached through the one mutations
// object buildFactGraph hands to every stage.
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
import { collectMentionSites } from '../../skills/excavator/mention-sites.mjs';
import { assertInjectionConservation } from '../../skills/excavator/xml-injection-resolution.mjs';

let tamper = null;
vi.mock('../../skills/excavator/annotation-injection-resolution.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveAnnotationInjections: (args) => {
      const resolved = actual.resolveAnnotationInjections(args);
      return tamper === null ? resolved : tamper(resolved);
    },
  };
});

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/annotation-injection');

describe('the conservation of the injection stages in buildFactGraph', () => {
  let root;
  let inputs;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'excavator-annotation-injection-conservation-'));
    cpSync(FIXTURE, root, { recursive: true });
    await runLazyAnalysis({ projectRoot: root, now: () => '2024-01-01T00:00:00.000Z' });
    const intermediate = join(root, '.excavator', 'intermediate');
    const scan = JSON.parse(readFileSync(join(intermediate, 'scan-result.json'), 'utf-8'));
    const structureAll = readStructureAll(join(intermediate, 'structure-all.jsonl'));
    const catalog = loadNameBindingCatalog();
    const readFile = (path) => readFileSync(join(root, path), 'utf-8');
    const mentionStage = collectMentionSites({ scan, structureAll, readFile });
    inputs = {
      scan,
      structureAll,
      importMap: JSON.parse(readFileSync(join(intermediate, 'import-map.json'), 'utf-8')),
      mentionSites: mentionStage.sites,
      mentionInputs: mentionStage.inputs,
      nameReferenceSites: collectNameReferenceSites({ scan, catalog, readFile }),
      nameBindingCatalog: catalog,
    };
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const build = (wrap, extra = {}) => {
    tamper = wrap;
    try {
      return buildFactGraph({ ...inputs, ...extra });
    } finally {
      tamper = null;
    }
  };
  const injects = (graph) => graph.edges.filter((e) => e.type === 'injects');
  const edgeBetween = (graph, from, to) => injects(graph).find((e) => e.source.endsWith(`:${from}`) && e.target.endsWith(`:${to}`));

  it('builds when the buckets of both stages add up and the recorded gaps read back to them', () => {
    const graph = build(null);
    expect(graph.coverage.annotationInjections).toMatchObject({ status: 'ran', siteCount: 38 });
    expect(graph.coverage.injections).toMatchObject({ status: 'ran', siteCount: 3 });
    expect(injects(graph)).toHaveLength(12);
  });

  it('counts each gap kind over the two sources: the XML stage\'s count alone no longer balances', () => {
    const graph = build(null);
    const recorded = (kind) => graph.gaps.filter((g) => g.kind === kind).reduce((sum, g) => sum + g.count, 0);
    const counts = Object.fromEntries(
      ['injection-target-unresolved', 'injection-ambiguous', 'injection-elsewhere', 'injection-unbound', 'injection-consumer-unresolved'].map((kind) => [kind, recorded(kind)]),
    );
    expect(() => assertInjectionConservation(graph.coverage.injections, counts, graph.coverage.annotationInjections)).not.toThrow();
    // the XML sites hold one unbound name and no other gap: without the annotation coverage the same counts do not add up
    expect(() => assertInjectionConservation(graph.coverage.injections, counts)).toThrow(/0 injection-target-unresolved outcome\(s\) but 5 recorded gap occurrence\(s\)/);
  });

  it('fails when a gap of a kind is missing from what was recorded: the read-back is not the bucket sum', () => {
    const lose = (kind) => (resolved) => {
      const index = resolved.gaps.findIndex((g) => g.kind === kind);
      return { ...resolved, gaps: resolved.gaps.filter((_, i) => i !== index) };
    };
    for (const kind of ['injection-target-unresolved', 'injection-ambiguous', 'injection-elsewhere', 'injection-unbound', 'injection-consumer-unresolved']) {
      expect(() => build(lose(kind)), kind).toThrow(new RegExp(`${kind} outcome\\(s\\) but \\d+ recorded gap occurrence\\(s\\)`));
    }
  });

  it('fails when a gap is recorded for a site that is no gap bucket', () => {
    const extra = (resolved) => ({ ...resolved, gaps: [...resolved.gaps, { kind: 'injection-unbound', scope: 'java', sample: 'extra' }] });
    // 3 annotation sites and 1 XML site are unbound; 5 occurrences were recorded
    expect(() => build(extra)).toThrow(/4 injection-unbound outcome\(s\) but 5 recorded gap occurrence\(s\)/);
  });

  it('fails when the buckets do not add up to the sites', () => {
    const miscount = (resolved) => ({ ...resolved, coverage: { ...resolved.coverage, siteCount: resolved.coverage.siteCount + 1 } });
    expect(() => build(miscount)).toThrow(/39 annotation injection site\(s\) but 38 outcome\(s\)/);
  });

  it('hands the one mutations object of the stages to the annotation resolution and to the merge as well as to the others', () => {
    const plain = build(null);

    // the simple name alone is taken for the catalog's: the same-package type and the unconfirmed spelling are sites
    const simple = build(null, { nameReferenceMutations: { annotationSimpleNames: true } });
    expect(simple.coverage.annotationInjections).toMatchObject({ siteCount: 40, unconfirmed: {}, buckets: { edge: 16, unmanaged: 4 } });

    // a name is looked up in the unit of the class file: the class of `lib` finds `lib`'s own bean, and no class is unmanaged
    const unmanaged = build(null, { nameReferenceMutations: { annotationIgnoreManaged: true } });
    expect(unmanaged.coverage.annotationInjections.buckets).toMatchObject({ unmanaged: 0, edge: 17 });
    expect(edgeBetween(plain, 'LibClient', 'OrderDaoImpl')).toBeDefined();
    expect(edgeBetween(unmanaged, 'LibClient', 'OrderDaoImpl')).toBeUndefined();
    expect(edgeBetween(unmanaged, 'LibClient', 'LibDao')).toBeDefined();

    // the second source's edge of a pair is dropped, as `addEdge` would: the XML stage's edge comes first and keeps only its own evidence
    expect(edgeBetween(plain, 'OrderService', 'AuditLog').evidence).toHaveLength(3);
    const unmerged = build(null, { nameReferenceMutations: { noInjectsMerge: true } });
    expect(edgeBetween(unmerged, 'OrderService', 'AuditLog').evidence).toHaveLength(1);
    expect(edgeBetween(unmerged, 'OrderService', 'AuditLog').evidence[0].file.endsWith('.xml')).toBe(true);
    expect(injects(unmerged)).toHaveLength(injects(plain).length);
  });

  it('writes no coverage and no edge for a projection built without the stage: not-run', () => {
    const { nameReferenceSites, nameBindingCatalog, ...without } = inputs;
    expect(nameReferenceSites).toBeDefined();
    expect(nameBindingCatalog).toBeDefined();
    const graph = buildFactGraph(without);
    expect(graph.coverage.annotationInjections).toEqual({ status: 'not-run' });
    expect(graph.coverage.injections).toEqual({ status: 'not-run' });
    expect(graph.edges.some((e) => e.type === 'injects')).toBe(false);
    expect(graph.gaps.some((g) => g.kind.startsWith('injection-'))).toBe(false);
  });
});
