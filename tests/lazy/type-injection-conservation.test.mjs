// by-type-injection, task 4.2: the conservation of the type injection stage inside buildFactGraph (spec: unbalanced conservation
// fails the build), and the test seams of the stage reached through buildFactGraph. The stage is the real one, wrapped so a test can
// make it lose a gap or an edge, add a gap, or miscount; buildFactGraph reads the gaps back from what it recorded into the graph and
// the entries from the edges it drew, and must refuse a product whose counts do not add up. The mutation tripwires of the stage are
// reached through the `typeInjectionMutations` buildFactGraph hands to it, and the tripwire of the merge through the one
// `nameReferenceMutations` object that every stage that merges `injects` edges shares.
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
import { loadTypeInjectionCatalog } from '../../skills/excavator/type-injection-catalog.mjs';

let tamper = null;
vi.mock('../../skills/excavator/type-injection-resolution.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveTypeInjections: (args) => {
      const resolved = actual.resolveTypeInjections(args);
      return tamper === null ? resolved : tamper(resolved);
    },
  };
});

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures');
const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';

/** The inputs of buildFactGraph for a fixture run through the driver, read back from its intermediate products, with the type injection catalog. */
async function prepare(fixture, prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  cpSync(join(FIXTURES, fixture), root, { recursive: true });
  await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
  const intermediate = join(root, '.excavator', 'intermediate');
  const scan = JSON.parse(readFileSync(join(intermediate, 'scan-result.json'), 'utf-8'));
  const structureAll = readStructureAll(join(intermediate, 'structure-all.jsonl'));
  const catalog = loadNameBindingCatalog();
  const readFile = (path) => readFileSync(join(root, path), 'utf-8');
  const mention = collectMentionSites({ scan, structureAll, readFile });
  return {
    root,
    inputs: {
      scan, structureAll, importMap: JSON.parse(readFileSync(join(intermediate, 'import-map.json'), 'utf-8')),
      mentionSites: mention.sites, mentionInputs: mention.inputs,
      nameReferenceSites: collectNameReferenceSites({ scan, catalog, readFile }), nameBindingCatalog: catalog,
      typeInjectionCatalog: loadTypeInjectionCatalog(),
    },
  };
}

const builder = (inputs) => (wrap, extra = {}) => {
  tamper = wrap;
  try {
    return buildFactGraph({ ...inputs, ...extra });
  } finally {
    tamper = null;
  }
};

describe('the conservation of the type injection stage in buildFactGraph', () => {
  let root;
  let build;
  beforeAll(async () => {
    const prepared = await prepare('javaee-jsf-app', 'excavator-type-injection-conservation-');
    root = prepared.root;
    build = builder(prepared.inputs);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const injects = (graph) => graph.edges.filter((e) => e.type === 'injects');
  const JSR = '"jsr330-inject"';

  it('builds when the buckets add up, the recorded gaps read back to them and the evidence holds the entries of the edges', () => {
    const graph = build(null);
    expect(graph.coverage.typeInjections.status).toBe('ran');
    expect(injects(graph)).toHaveLength(14);
    expect(graph.coverage.typeInjections.families['jsr330-inject']).toMatchObject({ points: 28, edges: 11 });
  });

  it('fails when a gap is missing from what was recorded: the read-back is not the bucket sum', () => {
    const lose = (kind) => (resolved) => {
      const index = resolved.gaps.findIndex((g) => g.kind === kind);
      return { ...resolved, gaps: resolved.gaps.filter((_, i) => i !== index) };
    };
    expect(() => build(lose('type-injection-ambiguous'))).toThrow(new RegExp(`family ${JSR}: 2 type-injection-ambiguous outcome\\(s\\) but 1 recorded gap occurrence\\(s\\)`));
    expect(() => build(lose('type-injection-unbound'))).toThrow(new RegExp(`family ${JSR}: 1 type-injection-unbound outcome\\(s\\) but 0 recorded gap occurrence\\(s\\)`));
  });

  it('fails when a gap is recorded for a point that is no gap bucket', () => {
    const extra = (resolved) => ({ ...resolved, gaps: [...resolved.gaps, { kind: 'type-injection-unbound', scope: 'jsr330-inject', sample: 'extra' }] });
    expect(() => build(extra)).toThrow(new RegExp(`family ${JSR}: 1 type-injection-unbound outcome\\(s\\) but 2 recorded gap occurrence\\(s\\)`));
  });

  it('fails when a business interface gap is missing, and when the implements edges are lost', () => {
    const loseBusiness = (resolved) => ({ ...resolved, gaps: resolved.gaps.filter((g) => g.kind !== 'business-interface-unresolved').concat(resolved.gaps.filter((g) => g.kind === 'business-interface-unresolved').slice(1)) });
    expect(() => build(loseBusiness)).toThrow(/business interfaces: 2 business-interface-unresolved outcome\(s\) but 1 recorded gap occurrence\(s\)/);
    const loseEdges = (resolved) => ({ ...resolved, implementsEdges: [] });
    expect(() => build(loseEdges)).toThrow(/business interfaces: 1 implements edge\(s\) drawn but 0 entr\(ies\) in the evidence/);
  });

  it('fails when an edge is lost and the coverage still counts its point, and when the buckets do not add up to the points', () => {
    const loseEdge = (resolved) => ({ ...resolved, edges: resolved.edges.slice(1) });
    expect(() => build(loseEdge)).toThrow(/family "(?:jsr330|ejb)-inject": \d+ point\(s\) became an edge but \d+ injection entr\(ies\) in the evidence/);
    const miscount = (resolved) => {
      const families = { ...resolved.coverage.families, 'jsr330-inject': { ...resolved.coverage.families['jsr330-inject'], points: 29 } };
      return { ...resolved, coverage: { ...resolved.coverage, families } };
    };
    expect(() => build(miscount)).toThrow(new RegExp(`family ${JSR}: 29 injection point\\(s\\) but 28 outcome\\(s\\)`));
  });

  it('hands the mutations of the stage to it: an abstract class that counts as a candidate makes the one subtype of the interface two', () => {
    const plain = build(null).coverage.typeInjections.families['jsr330-inject'].buckets;
    expect(plain).toMatchObject({ edge: 11, ambiguous: 2 });
    // `AbstractShipping` between `Shipping` and `GroundShipping`: it is the second candidate of the point
    const abstract = build(null, { typeInjectionMutations: { abstractCandidates: true } });
    expect(abstract.coverage.typeInjections.families['jsr330-inject'].buckets).toMatchObject({ edge: 10, ambiguous: 3 });
    // the declared business interface is not read: `Quote` has no implementation any more
    const noBusiness = build(null, { typeInjectionMutations: { noBusinessInterfaces: true } });
    expect(noBusiness.coverage.typeInjections.businessInterfaces).toMatchObject({ annotations: 0, declarations: 0, edges: 0 });
    expect(noBusiness.coverage.typeInjections.families['ejb-inject'].buckets).toMatchObject({ edge: 2, noCandidate: 1 });
    expect(noBusiness.edges.some((e) => e.type === 'implements' && e.evidence.some((x) => x.role === 'businessInterface'))).toBe(false);
  });
});

describe('the merge of the by-type edges with the edges of the name stages in buildFactGraph', () => {
  let root;
  let build;
  beforeAll(async () => {
    const prepared = await prepare('annotation-injection', 'excavator-type-injection-merge-');
    root = prepared.root;
    build = builder(prepared.inputs);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('merges the two sources of one pair into one edge, entries of both', () => {
    const graph = build(null);
    const edge = graph.edges.find((e) => e.type === 'injects' && e.source.endsWith(':OrderFacade') && e.target.endsWith(':InvoiceBean'));
    // `@EJB(beanName = "InvoiceBean")` on line 11 by name; `@EJB` on line 14 and the member `typed` on line 15 by type
    expect(edge.evidence.map((x) => x.line)).toEqual([11, 14, 15]);
    expect(graph.coverage.typeInjections.families['ejb-inject']).toMatchObject({ edges: 1 });
  });

  it('hands the one mutations object of the name stages to the merge as well: without it the by-type entries of the pair are lost, and the build fails', () => {
    expect(() => build(null, { nameReferenceMutations: { noInjectsMerge: true } }))
      .toThrow(/family "ejb-inject": 1 point\(s\) became an edge but 0 injection entr\(ies\) in the evidence/);
  });
});
