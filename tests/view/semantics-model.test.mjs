// artifact-view tasks 8.1-8.3: the page's reading of the three semantic
// products. The products are written by their real writers onto a copy of
// the synthetic sample project (tests/view/fixtures/make-semantic-project.mjs:
// one fresh and one stale cache entry, a semantic graph whose factDigest no
// longer matches, a two-step domain flow), baked by the real bake, decoded
// with the page's codec, and read through the page's pure models.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decodeBundle } from '../../skills/excavator-view/bundle-codec.mjs';
import { buildView } from '../../skills/excavator-view/build-view.mjs';
import { extractBundleText } from '../../skills/excavator-view/bake/html-output.mjs';
import { makeSemanticProject, SEMANTIC_IDS, SEMANTIC_TEXT } from './fixtures/make-semantic-project.mjs';
import { toViewData } from '../../packages/view/src/data.ts';
import { semanticBadges } from '../../packages/view/src/model/overview.ts';
import {
  allFlows, domainModel, freshnessBadge, layerColorVar, layerModel, nodeLayerColor, nodeLayerNames, nodeSummary, productState,
  summaryCoverage, summaryTooltip, UNLAYERED_COLOR_VAR,
} from '../../packages/view/src/model/semantics.ts';

const TEMPLATE_HTML = [
  '<!doctype html><html><head>',
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; '
    + 'style-src \'unsafe-inline\'; img-src data:; worker-src blob:; connect-src \'none\'">',
  '<title>view test template</title></head><body><div id="root"></div>',
  '<script type="text/plain" id="excavator-view-data"></script>',
  '</body></html>',
].join('\n');

const scratch = mkdtempSync(join(tmpdir(), 'excavator-view-semantics-'));
const templatePath = join(scratch, 'template.html');
let made;

async function bakeData(project) {
  const out = join(scratch, `view-${Math.random().toString(36).slice(2)}.html`);
  await buildView({ projectRoot: project, out, templatePath });
  const { segments } = await decodeBundle(extractBundleText(readFileSync(out, 'utf-8')));
  return toViewData(segments, 'main');
}

beforeAll(async () => {
  writeFileSync(templatePath, TEMPLATE_HTML);
  made = await makeSemanticProject(join(scratch, 'semantic-project'));
}, 120_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('summaries (8.1)', () => {
  it('shows one fresh and one stale summary, and says "none" for a node without one', async () => {
    const data = await bakeData(made.project);
    const fresh = nodeSummary(data.meta, data.segments, SEMANTIC_IDS.fresh);
    expect(fresh).toMatchObject({ state: 'entry', badge: { state: 'fresh', label: 'Fresh' } });
    expect(fresh.entry.summary).toBe(SEMANTIC_TEXT.fresh);
    expect(fresh.entry.tags).toEqual(['entry-point', 'greeting']);
    const stale = nodeSummary(data.meta, data.segments, SEMANTIC_IDS.stale);
    expect(stale).toMatchObject({ state: 'entry', badge: { state: 'stale', label: 'Stale' } });
    expect(stale.entry.summary).toBe(SEMANTIC_TEXT.stale);
    expect(nodeSummary(data.meta, data.segments, SEMANTIC_IDS.unsummarized)).toEqual({ state: 'none' });
    expect(summaryTooltip(data.segments, SEMANTIC_IDS.stale)).toBe(`Summary (stale): ${SEMANTIC_TEXT.stale}`);
    expect(summaryTooltip(data.segments, SEMANTIC_IDS.unsummarized)).toBe(null);
  });

  it('counts nodes with a summary against every node, on the overview badge too', async () => {
    const data = await bakeData(made.project);
    const coverage = summaryCoverage(data.segments, data.counts.nodes);
    expect(coverage).toEqual({ withSummary: 2, total: data.counts.nodes, fresh: 1, stale: 1, untrusted: 0, notInGraph: 0 });
    const badge = semanticBadges(data.meta, data.segments, data.counts.nodes).find((b) => b.artifact === 'semantic-cache.json');
    expect(badge).toMatchObject({ state: 'stale', stateLabel: 'Partly stale', summaries: `2/${data.counts.nodes}` });
    expect(badge.detail).toBe(`2 of ${data.counts.nodes} nodes have a summary; 1 fresh, 1 stale`);
  });

  it('keeps "Not generated" with the command when there is no semantic cache', async () => {
    const project = mkdtempSync(join(scratch, 'lazy-only-'));
    cpSync(made.project, project, { recursive: true });
    for (const name of ['semantic-cache.json', 'semantic-graph.json', 'domain-graph.json']) rmSync(join(project, '.excavator', name));
    const data = await bakeData(project);
    expect(nodeSummary(data.meta, data.segments, SEMANTIC_IDS.fresh)).toEqual({
      state: 'not-generated', command: 'not generated: run /excavator --mode=full, or generate on demand in /excavator-chat',
    });
    expect(semanticBadges(data.meta, data.segments, data.counts.nodes).map((b) => b.stateLabel)).toEqual(['Not generated', 'Not generated', 'Not generated']);
    expect(layerModel(data.segments, data.strings)).toBe(null);
    expect(domainModel(data.segments, data.strings)).toBe(null);
    expect(productState(data.meta, 'semantic-graph.json')).toEqual({ state: 'not-generated', command: 'not generated: run /excavator --mode=full' });
    expect(productState(data.meta, 'domain-graph.json')).toEqual({ state: 'not-generated', command: 'not generated: run /excavator-domain' });
  });
});

describe('layers and relations (8.2)', () => {
  it('lists both layers with their node counts and marks the whole block stale on a factDigest mismatch', async () => {
    const data = await bakeData(made.project);
    const model = layerModel(data.segments, data.strings);
    expect(model.stale).toBe(true);
    expect(model.freshness).toEqual({ state: 'stale', label: 'Stale' });
    expect(model.factDigest).toBe(made.staleFactDigest);
    expect(model.headerFactsDigest).toBe(made.factsDigest);
    expect(model.layers.map((l) => [l.name, l.nodeCount, l.inGraph, l.colorVar])).toEqual([
      ['Entry', 2, 2, '--series-1'],
      ['Support', 4, 4, '--series-2'],
    ]);
    expect(model.relations).toHaveLength(1);
    expect(model.relations[0]).toMatchObject({ type: 'depends-on', source: SEMANTIC_IDS.fresh, target: SEMANTIC_IDS.stale, sourceFound: true, targetFound: true });
    expect(model.unlayered).toBe(data.counts.nodes - 6);
    expect(nodeLayerColor(model, SEMANTIC_IDS.fresh)).toBe('--series-1');
    expect(nodeLayerColor(model, SEMANTIC_IDS.unsummarized)).toBe('--series-2');
    expect(nodeLayerColor(model, 'file:docs/notes.md')).toBe(UNLAYERED_COLOR_VAR);
    expect(nodeLayerNames(model, SEMANTIC_IDS.stale)).toEqual(['Support']);
  });

  it('reads a matching factDigest as fresh (instrument check for the stale block)', async () => {
    const data = await bakeData(made.project);
    const segments = { ...data.segments, layers: { ...data.segments.layers, freshness: 'fresh' } };
    expect(layerModel(segments, data.strings).stale).toBe(false);
    expect(layerColorVar(9)).toBe('--series-other');
  });
});

describe('domain flows (8.3)', () => {
  it('orders the two steps by flow_step weight and labels an id the graph does not hold "unanchored"', async () => {
    const data = await bakeData(made.project);
    const model = domainModel(data.segments, data.strings);
    expect(model.freshness).toEqual({ state: 'fresh', label: 'Fresh' });
    expect(model.domains.map((d) => d.name)).toEqual(['Greeting']);
    const [flow] = allFlows(model);
    expect(flow).toMatchObject({ id: 'flow:greet-user', name: 'Greet a user', entryPoint: 'run(name)' });
    expect(flow.steps.map((s) => [s.order, s.id])).toEqual([[1, 'step:greet-user:count-visit'], [2, 'step:greet-user:format-greeting']]);
    expect(flow.steps[1].anchors).toEqual([
      { id: SEMANTIC_IDS.stale, found: true, writerUnresolved: false },
      { id: SEMANTIC_IDS.missingAnchor, found: false, writerUnresolved: true },
    ]);
    expect(model.counts).toEqual({ domains: 1, flows: 1, steps: 2, anchors: 2, unanchored: 1 });
    expect(model.orphanFlows).toEqual([]);
    expect(model.orphanSteps).toEqual([]);
  });

  it('marks the domain graph stale when its sourceRevision no longer matches the manifest', async () => {
    const project = mkdtempSync(join(scratch, 'stale-domain-'));
    cpSync(made.project, project, { recursive: true });
    const path = join(project, '.excavator', 'domain-graph.json');
    const graph = JSON.parse(readFileSync(path, 'utf-8'));
    graph.sourceRevision = 'directory:0000';
    writeFileSync(path, JSON.stringify(graph));
    const model = domainModel((await bakeData(project)).segments, (await bakeData(project)).strings);
    expect(model.stale).toBe(true);
    expect(model.freshness.state).toBe('stale');
    expect(model.reason).toMatch(/sourceRevision mismatch/);
    // Stale content stays browsable.
    expect(allFlows(model)[0].steps).toHaveLength(2);
  });

  it('labels an unknown verdict instead of dropping it', () => {
    expect(freshnessBadge('noncanonical-language')).toEqual({ state: 'invalid', label: 'Not trusted (noncanonical-language)' });
    expect(freshnessBadge(undefined)).toEqual({ state: 'invalid', label: 'Freshness not recorded' });
  });
});
