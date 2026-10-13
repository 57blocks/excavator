// xml-injection-references, task 5.2: the conservation of the injection stage
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
vi.mock('../../skills/excavator/xml-injection-resolution.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveXmlInjections: (args) => {
      const resolved = actual.resolveXmlInjections(args);
      return tamper === null ? resolved : tamper(resolved);
    },
  };
});

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/spring-xml-injection');

describe('the conservation of the injection stage in buildFactGraph', () => {
  let root;
  let inputs;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'excavator-xml-injection-conservation-'));
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
    expect(graph.coverage.injections).toMatchObject({ status: 'ran', siteCount: 36 });
    expect(graph.edges.filter((e) => e.type === 'injects')).toHaveLength(9);
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
    const extra = (resolved) => ({ ...resolved, gaps: [...resolved.gaps, { kind: 'injection-unbound', scope: 'xml', sample: 'extra' }] });
    expect(() => build(extra)).toThrow(/injection-unbound outcome\(s\) but 2 recorded gap occurrence\(s\)/);
  });

  it('fails when the buckets do not add up to the sites', () => {
    const miscount = (resolved) => ({ ...resolved, coverage: { ...resolved.coverage, siteCount: resolved.coverage.siteCount + 1 } });
    expect(() => build(miscount)).toThrow(/37 injection site\(s\) but 36 outcome\(s\)/);
  });

  it('hands the one mutations object of the stage to the injection resolution as well as the expression one', () => {
    const plain = buildFactGraph(inputs).coverage.injections.buckets;
    const mutated = buildFactGraph({ ...inputs, nameReferenceMutations: { injectionFirstBinding: true, ignoreFileScope: true } }).coverage.injections.buckets;
    // `store` (two classes) takes the first, and a ref local looks at the whole unit
    expect(mutated).toMatchObject({ ambiguous: plain.ambiguous - 1, elsewhere: plain.elsewhere - 1, edge: plain.edge + 2 });
  });

  it('writes no coverage and no edge for a projection built without the stage: not-run', () => {
    const { nameReferenceSites, nameBindingCatalog, ...without } = inputs;
    expect(nameReferenceSites).toBeDefined();
    expect(nameBindingCatalog).toBeDefined();
    const graph = buildFactGraph(without);
    expect(graph.coverage.injections).toEqual({ status: 'not-run' });
    expect(graph.edges.some((e) => e.type === 'injects')).toBe(false);
  });
});
