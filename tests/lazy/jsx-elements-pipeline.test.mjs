// jsx-element-references, tasks 2.4-2.6: JSX elements in the real Lazy driver.
// The fixture tests/fixtures/jsx-components is a synthetic React-style project:
// a page that renders through a re-export barrel (`export { X } from`,
// `export { default as X } from`, `export * from`), a renamed default import of
// a module that writes `export default Badge;`, a namespace member, a package
// component, a prop that shadows nothing imported, a `forwardRef` value, an
// element at the top level of the module, a legacy `.jsx` file whose
// `<this.Slot />` the javascript grammar recovers from an error, and a class
// component whose `render` method has no function node. `Home` renders `Button`
// twice: one edge for the pair, two edge sites. It is copied to a temp
// directory because a Lazy run writes `.excavator/` next to the source.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PIPELINE_VERSION, runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { buildFactGraph } from '../../skills/excavator/build-fact-graph.mjs';
import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';
import { readStructureAll } from '../../skills/excavator/structure-all-store.mjs';
import { createSourceReader, validateAgainstSource } from '../../skills/excavator/validate-graph.mjs';
import { computeCandidateSet } from '../../skills/excavator/unused-code.mjs';

let tamper = null;
vi.mock('../../skills/excavator/jsx-element-resolution.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveJsxElements: (args) => {
      const resolved = actual.resolveJsxElements(args);
      return tamper === null ? resolved : tamper(resolved);
    },
  };
});

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/jsx-components');
const HOME = 'src/pages/home.tsx';
const WIDGET = 'src/legacy/widget.jsx';
const PANEL = 'src/legacy/panel.jsx';

describe('JSX elements in the Lazy driver', () => {
  let root;
  let result;
  let graph;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'excavator-jsx-elements-'));
    cpSync(FIXTURE, root, { recursive: true });
    result = await runLazyAnalysis({ projectRoot: root, now: () => '2024-01-01T00:00:00.000Z' });
    graph = readKnowledgeGraph(join(root, '.excavator', KNOWLEDGE_GRAPH_FILE));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const nodeId = (file, name) => {
    const matches = graph.nodes.filter((n) => n.filePath === file && n.name === name && n.type !== 'file');
    expect(matches, `${file} ${name}`).toHaveLength(1);
    return matches[0].id;
  };
  const jsxCalls = () => graph.edges.filter((e) => e.type === 'calls' && e.evidence.some((entry) => entry.token !== undefined));

  it('stamps the product with the new pipeline version', () => {
    expect(result.saveError).toBeNull();
    expect(PIPELINE_VERSION).toBe('lazy-fact-graph/14');
    expect(graph.project.pipelineVersion).toBe('lazy-fact-graph/14');
  });

  it('draws a calls edge for each element that resolves: named, default-renamed, through the barrel and a namespace', () => {
    const drawn = jsxCalls().map((e) => ({ source: e.source, target: e.target, evidence: e.evidence }));
    const expected = [
      [HOME, 'Home', 'src/components/ui/card.tsx', 'Card', 9, 'Card'],
      [HOME, 'Home', 'src/components/ui/card.tsx', 'CardTitle', 10, 'CardTitle'],
      [HOME, 'Home', 'src/components/ui/button.tsx', 'Button', 11, 'Button'],
      [HOME, 'Home', 'src/components/ui/badge.tsx', 'Badge', 12, 'Pill'],
      [HOME, 'Home', 'src/components/icons.tsx', 'StarIcon', 13, 'Icons.StarIcon'],
      [WIDGET, 'Widget', 'src/components/ui/badge.tsx', 'Badge', 6, 'Pill'],
    ].map(([file, caller, targetFile, target, line, token]) => ({
      source: nodeId(file, caller),
      target: nodeId(targetFile, target),
      evidence: [{ file, line, source: 'tree-sitter', token }],
    }));
    const order = (a, b) => (a.source + a.target < b.source + b.target ? -1 : 1);
    expect(drawn.sort(order)).toEqual(expected.sort(order));
    for (const edge of jsxCalls()) expect(edge).toMatchObject({ direction: 'forward', weight: 0.8, provenance: 'extracted' });
  });

  it('files every other element in exactly one gap, and counts the intrinsic ones', () => {
    expect(graph.coverage.jsxElements).toEqual({
      status: 'ran', files: 8, intrinsic: 11, sites: 13,
      edge: 7, external: 1, unbound: 2, targetUnresolved: 1, ambiguous: 0, callerUnresolved: 2,
    });
    const jsxGaps = graph.gaps
      .filter((g) => g.kind.startsWith('jsx-'))
      .map((g) => [g.kind, g.scope, g.count, g.samples]);
    expect(jsxGaps).toEqual([
      ['jsx-caller-unresolved', 'javascript', 1, [`${PANEL}:6 -> Pill`]],
      ['jsx-caller-unresolved', 'typescript', 1, [`${HOME}:24 -> Home`]],
      ['jsx-external', 'typescript', 1, [`${HOME}:14 -> Link`]],
      ['jsx-target-unresolved', 'typescript', 1, [`${HOME}:16 -> Fancy`]],
      ['jsx-unbound', 'javascript', 1, [`${WIDGET}:7 -> Slot`]],
      ['jsx-unbound', 'typescript', 1, [`${HOME}:15 -> Slot`]],
    ]);
    for (const gap of graph.gaps.filter((g) => g.kind.startsWith('jsx-'))) expect(gap.reason).toMatch(/^JSX element\(s\) /);
  });

  it('merges the elements of one caller-target pair into one edge that cites the first', () => {
    const pair = graph.edges.filter((e) => e.type === 'calls'
      && e.source === nodeId(HOME, 'Home') && e.target === nodeId('src/components/ui/button.tsx', 'Button'));
    expect(pair).toHaveLength(1);
    expect(pair[0].evidence).toEqual([{ file: HOME, line: 11, source: 'tree-sitter', token: 'Button' }]);
    // Both sites count as edge sites: 7 sites over 6 edges.
    expect(graph.coverage.jsxElements.edge).toBe(jsxCalls().length + 1);
  });

  it('gives the barrel imports edges to the modules it forwards, and resolves exports by their local name', () => {
    const imports = graph.edges.filter((e) => e.type === 'imports' && e.source === 'file:src/components/ui/index.ts').map((e) => e.target);
    expect(imports).toEqual(['file:src/components/ui/button.tsx', 'file:src/components/ui/card.tsx', 'file:src/components/ui/dialog.tsx']);
    // `export default Badge;` names the declaration on line 1.
    expect(graph.edges.filter((e) => e.type === 'exports' && e.source === 'file:src/components/ui/badge.tsx')).toEqual([
      expect.objectContaining({ target: nodeId('src/components/ui/badge.tsx', 'Badge'), evidence: [{ file: 'src/components/ui/badge.tsx', line: 5, source: 'tree-sitter' }] }),
    ]);
  });

  it('passes the source validator: every cited line holds its tag', () => {
    const { report } = validateAgainstSource({ graph: { nodes: graph.nodes, edges: jsxCalls() }, reader: createSourceReader(root) });
    expect(report.counts).toMatchObject({ edgeConfirmed: 6, edgeContradicted: 0 });
  });

  it('gives rendered components referrers, so they are no longer unreferenced entries of the unused-code candidates', () => {
    const set = computeCandidateSet(graph);
    const entryOf = (file, name) => set.entry[set.candidateIds.indexOf(nodeId(file, name))];
    for (const [file, name] of [
      ['src/components/ui/button.tsx', 'Button'],
      ['src/components/ui/card.tsx', 'Card'],
      ['src/components/ui/card.tsx', 'CardTitle'],
      ['src/components/ui/badge.tsx', 'Badge'],
      ['src/components/icons.tsx', 'StarIcon'],
    ]) expect(entryOf(file, name), name).toBe(false);
    // Rendered only at the top level, or never: still entries.
    expect(entryOf(HOME, 'Home')).toBe(true);
    expect(entryOf('src/components/ui/dialog.tsx', 'Dialog')).toBe(true);
  });

  describe('conservation', () => {
    let inputs;
    beforeAll(() => {
      const intermediate = join(root, '.excavator', 'intermediate');
      inputs = {
        scan: JSON.parse(readFileSync(join(intermediate, 'scan-result.json'), 'utf-8')),
        structureAll: readStructureAll(join(intermediate, 'structure-all.jsonl')),
        importMap: JSON.parse(readFileSync(join(intermediate, 'import-map.json'), 'utf-8')),
      };
    });
    const build = (wrap) => {
      tamper = wrap;
      try {
        return buildFactGraph(inputs);
      } finally {
        tamper = null;
      }
    };

    it('builds when every element is one edge or one recorded gap', () => {
      expect(build(null).coverage.jsxElements).toMatchObject({ status: 'ran', sites: 13 });
    });

    it('refuses a projection that loses a gap, files one twice, or miscounts a site', () => {
      expect(() => build((r) => ({ ...r, gaps: r.gaps.slice(1) }))).toThrow(/JSX element conservation violated/);
      expect(() => build((r) => ({ ...r, gaps: [...r.gaps, r.gaps[0]] }))).toThrow(/JSX element conservation violated/);
      expect(() => build((r) => ({ ...r, coverage: { ...r.coverage, sites: r.coverage.sites + 1 } }))).toThrow(/sites=14 but edge\+gaps=13/);
    });

    it('says the stage did not run for an import map without resolved sources', () => {
      const { resolvedSources: _ignored, ...older } = inputs.importMap;
      const built = buildFactGraph({ ...inputs, importMap: older });
      expect(built.coverage.jsxElements).toEqual({ status: 'not-run' });
      expect(built.gaps.filter((g) => g.kind.startsWith('jsx-'))).toEqual([]);
    });
  });
});
