/**
 * merge-domain-areas.mjs — one domain graph from per-area analyses, and a
 * coverage report that makes a skipped module visible.
 *
 * The defect this exists for is silence: one analyzer for a whole project
 * produced flows for part of the modules and nothing said which ones were
 * left out. So the coverage report is tested the way an instrument is: on a
 * recorded analysis that covers every module it must report no gap, and on
 * the same analysis with 8 handler modules removed it must name exactly
 * those 8. The token checks are tested on the failure they guard against: an
 * earlier output copied into place instead of analysed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acceptOutput, mergeAreas, computeCoverage, checkConservation, runMerge, EXIT_NOT_CONSERVED,
} from '../../skills/excavator-domain/merge-domain-areas.mjs';
import { PLAN_FORMAT, moduleSetDigest } from '../../skills/excavator-domain/plan-domains.mjs';
import { HANDLERS, HANDLER_MODULES, writeMultiModuleProject } from '../fixtures/domain-areas/multi-module.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXTRACT = resolve(repoRoot, 'skills/excavator-domain/extract-domain-context.py');
const SPLIT = resolve(repoRoot, 'skills/excavator-domain/split-domain-areas.mjs');
const MERGE = resolve(repoRoot, 'skills/excavator-domain/merge-domain-areas.mjs');

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'domain-merge-'));
  roots.push(dir);
  return dir;
}

/**
 * A recorded analyzer output. `domains` is [{ id, flows: [{ name, files, module }] }];
 * each flow gets one step per file, in order. Analyzers no longer write domains,
 * so the domain node and its contains_flow edges are emitted only with
 * `writeDomains` (to prove the merge ignores them).
 */
function analysis({ areaId, token, domains, skippedModules, extraEdges = [], writeDomains = false }) {
  const nodes = [];
  const edges = [];
  for (const domain of domains) {
    if (writeDomains) {
      nodes.push({
        id: domain.id, type: 'domain', name: domain.name ?? domain.id.slice(7), summary: domain.summary ?? 's',
        tags: domain.tags ?? ['t'], complexity: domain.complexity ?? 'simple',
        domainMeta: domain.domainMeta ?? { entities: [], businessRules: [], crossDomainInteractions: [] },
      });
    }
    for (const flow of domain.flows) {
      const flowId = `flow:${flow.name}`;
      const meta = { entryPoint: 'POST /x', entryType: 'http' };
      if (flow.module) meta.module = flow.module;
      nodes.push({ id: flowId, type: 'flow', name: flow.name, summary: 's', tags: ['t'], complexity: 'simple', domainMeta: meta });
      if (writeDomains) edges.push({ source: domain.id, target: flowId, type: 'contains_flow', direction: 'forward', weight: 1 });
      flow.files.forEach((file, i) => {
        const stepId = `step:${flow.name}:s${i + 1}`;
        const step = { id: stepId, type: 'step', name: `s${i + 1}`, summary: 's', tags: ['t'], complexity: 'simple' };
        if (typeof file === 'string') step.filePath = file;
        else Object.assign(step, file);
        nodes.push(step);
        edges.push({ source: flowId, target: stepId, type: 'flow_step', direction: 'forward', weight: Math.min(1, (i + 1) / 10) });
      });
    }
  }
  const out = {
    version: '1.0.0',
    project: { name: 'fixture', languages: ['javascript'], frameworks: ['express'], description: 'd', analyzedAt: '2026-11-23T00:00:00Z', gitCommitHash: 'abc' },
    nodes, edges: [...edges, ...extraEdges], layers: [], tour: [],
  };
  if (areaId) out.areaRun = { areaId, token };
  if (skippedModules) out.skippedModules = skippedModules;
  return out;
}

/** A stored plan: `assign` is { modulePath: domainId }; `kinds` overrides the default business kind. */
function planFrom(assign, { kinds = {}, crossDomain = [] } = {}) {
  const ids = [...new Set(Object.values(assign))];
  return {
    format: PLAN_FORMAT,
    moduleSetDigest: moduleSetDigest(Object.keys(assign)),
    modules: Object.fromEntries(Object.keys(assign).sort().map((k) => [k, assign[k]])),
    domains: ids.map((id) => ({ id, kind: kinds[id] ?? 'business', name: id.slice(7), summary: `${id} summary`, tags: ['t'], entities: ['E'], businessRules: ['R'] })),
    crossDomain,
    history: [],
  };
}

/** Every module of the manifest in one domain. */
const planAll = (manifest, id = 'domain:all') => planFrom(Object.fromEntries(manifest.modules.map((m) => [m.path, id])));

/** A manifest of modules `{ path: [files] }`, all held by `areas` ({ areaId: [paths] }). */
function manifestOf(files, areas = { 'area-001': Object.keys(files) }) {
  return {
    token: 'a'.repeat(32),
    areas: Object.keys(areas).map((areaId) => ({ areaId })),
    modules: Object.entries(files).map(([path, list]) => ({
      path, files: list, entryPoints: 1, candidateFiles: list,
      areas: Object.keys(areas).filter((a) => areas[a].includes(path)),
    })),
  };
}

const accepted = (...graphs) => graphs.map((graph) => ({ areaId: graph.areaRun.areaId, graph }));

const T = 'a'.repeat(32);

describe('acceptOutput', () => {
  it('accepts an output carrying this run\'s token and area id', () => {
    const r = acceptOutput({ token: T, areaId: 'area-001', text: JSON.stringify(analysis({ areaId: 'area-001', token: T, domains: [] })) });
    expect(r.status).toBe('accepted');
  });
  it('rejects an earlier output copied into place', () => {
    const old = analysis({ domains: [] }); // a published domain-graph.json has no areaRun
    expect(acceptOutput({ token: T, areaId: 'area-001', text: JSON.stringify(old) }).status).toBe('rejected-stale');
    const otherRun = analysis({ areaId: 'area-001', token: 'b'.repeat(32), domains: [] });
    expect(acceptOutput({ token: T, areaId: 'area-001', text: JSON.stringify(otherRun) }).status).toBe('rejected-stale');
    const otherArea = analysis({ areaId: 'area-002', token: T, domains: [] });
    expect(acceptOutput({ token: T, areaId: 'area-001', text: JSON.stringify(otherArea) }).status).toBe('rejected-stale');
  });
  it('separates an unparsable output and a missing one', () => {
    expect(acceptOutput({ token: T, areaId: 'area-001', text: '{not json' }).status).toBe('rejected-parse');
    expect(acceptOutput({ token: T, areaId: 'area-001', text: '[]' }).status).toBe('rejected-parse');
    expect(acceptOutput({ token: T, areaId: 'area-001', text: null }).status).toBe('missing');
  });
});

describe('mergeAreas', () => {
  it('puts the flows of two areas under the one plan domain they both belong to', () => {
    const manifest = manifestOf(
      { 'modules/invoices': ['modules/invoices/a.js'], 'modules/payments': ['modules/payments/b.js'] },
      { 'area-001': ['modules/invoices'], 'area-002': ['modules/payments'] },
    );
    const plan = planFrom({ 'modules/invoices': 'domain:billing', 'modules/payments': 'domain:billing' });
    const a = analysis({ areaId: 'area-001', token: T, writeDomains: true, domains: [{ id: 'domain:invoice-schema', flows: [{ name: 'issue-invoice', files: ['modules/invoices/a.js'] }] }] });
    const b = analysis({ areaId: 'area-002', token: T, writeDomains: true, domains: [{ id: 'domain:billing', name: 'Other name', flows: [{ name: 'capture-payment', files: ['modules/payments/b.js'] }] }] });
    const { graph, merge } = mergeAreas({ accepted: accepted(a, b), plan, manifest });
    const domains = graph.nodes.filter((n) => n.type === 'domain');
    expect(domains.map((d) => d.id)).toEqual(['domain:billing']);
    expect(domains[0].name).toBe('billing');
    expect(graph.nodes.some((n) => n.id === 'domain:invoice-schema')).toBe(false);
    expect(graph.edges.filter((e) => e.type === 'contains_flow' && e.source === 'domain:billing').map((e) => e.target).sort())
      .toEqual(['flow:capture-payment', 'flow:issue-invoice']);
    expect(graph.edges.filter((e) => e.type === 'contains_flow')).toHaveLength(2);
    expect(merge.analyzerDomainsIgnored).toBe(2);
    expect(merge.analyzerEdgesIgnored).toBe(2);
    expect(graph.areaRun).toBeUndefined();
  });

  it('does not let an ignored analyzer domain node cause a rename', () => {
    const manifest = manifestOf({ m: ['m/a.js'] });
    const plan = planFrom({ m: 'domain:orders' });
    const a = analysis({ areaId: 'area-001', token: T, writeDomains: true, domains: [{ id: 'domain:orders', flows: [{ name: 'f', files: ['m/a.js'] }] }] });
    const { graph, merge } = mergeAreas({ accepted: accepted(a), plan, manifest });
    expect(merge.idsRenamed).toEqual([]);
    expect(graph.nodes.filter((n) => n.type === 'domain')).toHaveLength(1);
  });

  it('emits domain nodes only from the plan, with kind, sorted modules, complexity and cross-domain text', () => {
    const files = {};
    for (let i = 1; i <= 9; i++) files[`p/m${i}`] = [`p/m${i}/a.js`];
    const assign = { 'p/m1': 'domain:solo' };
    for (let i = 2; i <= 4; i++) assign[`p/m${i}`] = 'domain:mid';
    for (let i = 5; i <= 9; i++) assign[`p/m${i}`] = 'domain:big';
    assign['p/m9'] = 'domain:lib';
    const plan = planFrom(assign, {
      kinds: { 'domain:lib': 'support' },
      crossDomain: [{ source: 'domain:mid', target: 'domain:solo', description: 'mid calls solo' }],
    });
    plan.domains.reverse(); // plan order, not alphabetical, decides node order
    const { graph } = mergeAreas({ accepted: accepted(analysis({ areaId: 'area-001', token: T, domains: [] })), plan, manifest: manifestOf(files) });
    const nodes = graph.nodes.filter((n) => n.type === 'domain');
    expect(nodes.map((n) => n.id)).toEqual(plan.domains.map((d) => d.id));
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    expect(byId['domain:solo']).toMatchObject({ complexity: 'simple', tags: ['t'], domainMeta: { kind: 'business', modules: ['p/m1'], entities: ['E'], businessRules: ['R'], crossDomainInteractions: [] } });
    expect(byId['domain:mid']).toMatchObject({ complexity: 'moderate', domainMeta: { modules: ['p/m2', 'p/m3', 'p/m4'], crossDomainInteractions: ['mid calls solo'] } });
    expect(byId['domain:big'].domainMeta.modules).toEqual(['p/m5', 'p/m6', 'p/m7', 'p/m8']);
    expect(byId['domain:lib']).toMatchObject({ complexity: 'simple', domainMeta: { kind: 'support', modules: ['p/m9'] } });
    expect(graph.edges.filter((e) => e.type === 'cross_domain')).toEqual([
      { source: 'domain:mid', target: 'domain:solo', type: 'cross_domain', direction: 'forward', description: 'mid calls solo', weight: 0.6 },
    ]);
    const many = planFrom(Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`q/${i}`, 'domain:wide'])));
    const wide = mergeAreas({ accepted: [], plan: many, manifest: manifestOf(Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`q/${i}`, []]))) });
    expect(wide.graph.nodes[0].complexity).toBe('complex');
  });

  it('renames a flow id two areas both use, and its step edges follow', () => {
    const manifest = manifestOf(
      { api: ['api/o.js'], web: ['web/o.jsx', 'web/p.jsx'] },
      { 'area-001': ['api'], 'area-002': ['web'] },
    );
    const plan = planFrom({ api: 'domain:orders', web: 'domain:storefront' });
    const a = analysis({ areaId: 'area-001', token: T, domains: [{ id: 'x', flows: [{ name: 'create-order', files: ['api/o.js'] }] }] });
    const b = analysis({ areaId: 'area-002', token: T, domains: [{ id: 'x', flows: [{ name: 'create-order', files: ['web/o.jsx', 'web/p.jsx'] }] }] });
    const { graph, merge } = mergeAreas({ accepted: accepted(a, b), plan, manifest });
    const ids = graph.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('flow:create-order--area-002');
    expect(ids).toContain('step:create-order:s1--area-002');
    expect(graph.edges).toContainEqual(expect.objectContaining({ source: 'domain:storefront', target: 'flow:create-order--area-002', type: 'contains_flow' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ source: 'flow:create-order--area-002', target: 'step:create-order:s2', type: 'flow_step' }));
    expect(merge.idsRenamed).toContainEqual({ from: 'flow:create-order', to: 'flow:create-order--area-002', areaId: 'area-002' });
    expect(merge.edgesDangling).toBe(0);
  });

  it('drops and counts flow_step edges whose ends are not in the merged graph, and duplicates', () => {
    const manifest = manifestOf({ m: ['m/a.js'] });
    const a = analysis({
      areaId: 'area-001', token: T,
      domains: [{ id: 'x', flows: [{ name: 'f1', files: ['m/a.js'] }] }],
      extraEdges: [
        { source: 'flow:f1', target: 'step:nowhere', type: 'flow_step', direction: 'forward', weight: 0.5 },
        { source: 'flow:f1', target: 'step:f1:s1', type: 'flow_step', direction: 'forward', weight: 0.9 },
        { source: 'flow:f1', target: 'flow:f1', type: 'flow_step', direction: 'forward', weight: 0.9 },
      ],
    });
    const { merge } = mergeAreas({ accepted: accepted(a), plan: planAll(manifest), manifest });
    expect(merge.edgesDangling).toBe(1);
    expect(merge.edgesDuplicate).toBe(1);
    expect(merge.edgesSelfLoop).toBe(1);
  });

  // An edge may only join nodes of the area that wrote it. One that reaches
  // another area's node is dangling for that area; keeping it would make the
  // conservation check fail and stop a whole run over one stray edge.
  it('drops a flow_step edge that reaches a node of another area, and stays conserved', () => {
    const manifest = manifestOf({ m: ['m/a.js'], n: ['n/b.js'] }, { 'area-001': ['m'], 'area-002': ['n'] });
    const a = analysis({ areaId: 'area-001', token: T, domains: [{ id: 'x', flows: [{ name: 'f1', files: ['m/a.js'] }] }] });
    const b = analysis({
      areaId: 'area-002', token: T,
      domains: [{ id: 'x', flows: [{ name: 'f2', files: ['n/b.js'] }] }],
      extraEdges: [{ source: 'flow:f2', target: 'step:f1:s1', type: 'flow_step', direction: 'forward', weight: 0.9 }],
    });
    const list = [{ areaId: 'area-001', graph: a }, { areaId: 'area-002', graph: b }];
    const { graph, merge } = mergeAreas({ accepted: list, plan: planAll(manifest), manifest });
    expect(merge.edgesDangling).toBe(1);
    expect(graph.edges.some((e) => e.source === 'flow:f2' && e.target === 'step:f1:s1')).toBe(false);
    expect(checkConservation({ accepted: list, merged: graph, renames: merge.idsRenamed }).ok).toBe(true);
  });
});

describe('O4 flow homing', () => {
  const manifest = manifestOf(
    {
      'modules/orders': ['modules/orders/routes.js'],
      'modules/payments': ['modules/payments/routes.js'],
      'modules/lib': ['modules/lib/db.js'],
    },
    { 'area-001': ['modules/orders', 'modules/payments'], 'area-002': ['modules/lib'] },
  );
  const plan = planFrom({ 'modules/orders': 'domain:ordering', 'modules/payments': 'domain:billing', 'modules/lib': 'domain:shared' }, { kinds: { 'domain:shared': 'support' } });
  const homed = (graphs, nodeFiles) => {
    const r = mergeAreas({ accepted: accepted(...graphs), plan, manifest, nodeFiles });
    const edges = r.graph.edges.filter((e) => e.type === 'contains_flow').map((e) => `${e.source}>${e.target}`).sort();
    return { ...r, edges };
  };
  const one = (flows) => analysis({ areaId: 'area-001', token: T, domains: [{ id: 'x', flows }] });

  it('lets the first locatable step decide, even when a later step is in another domain', () => {
    const a = one([{ name: 'checkout', files: ['elsewhere/none.js', 'modules/orders/routes.js', 'modules/payments/routes.js'] }]);
    const { edges, merge, graph } = homed([a]);
    expect(edges).toEqual(['domain:ordering>flow:checkout']);
    expect(merge.flowHoming).toMatchObject({ homedByStep: 1, homedByDeclared: 0, unplaced: 0, unplacedFlows: [] });
    expect(graph.edges.find((e) => e.type === 'contains_flow')).toEqual({ source: 'domain:ordering', target: 'flow:checkout', type: 'contains_flow', direction: 'forward', weight: 1 });
    expect(graph.nodes.find((n) => n.id === 'flow:checkout').homedBy).toBeUndefined();
  });

  it('orders steps by weight, then by edge order', () => {
    const a = one([{ name: 'checkout', files: ['modules/orders/routes.js', 'modules/payments/routes.js'] }]);
    a.edges.find((e) => e.target === 'step:checkout:s1').weight = 0.9;
    a.edges.find((e) => e.target === 'step:checkout:s2').weight = 0.1;
    expect(homed([a]).edges).toEqual(['domain:billing>flow:checkout']);
    for (const e of a.edges) e.weight = 0.5; // tie: edge order decides
    expect(homed([a]).edges).toEqual(['domain:ordering>flow:checkout']);
  });

  it('locates a step through its node ids, but never when its filePath escapes the root', () => {
    const nodeFiles = new Map([['function:modules/payments/routes.js:pay', 'modules/payments/routes.js']]);
    const viaNode = one([{ name: 'f', files: [{ nodeIds: ['function:modules/payments/routes.js:pay'] }] }]);
    expect(homed([viaNode], nodeFiles).edges).toEqual(['domain:billing>flow:f']);
    const escaping = one([{ name: 'g', files: [{ filePath: '../modules/orders/routes.js', nodeIds: ['function:modules/payments/routes.js:pay'] }] }]);
    expect(homed([escaping], nodeFiles).edges).toEqual([]);
  });

  it('falls back to the declared module when it is held by the area', () => {
    const a = one([{ name: 'job', module: 'modules/payments', files: [{ summary: 'no file' }] }]);
    const { edges, merge } = homed([a]);
    expect(edges).toEqual(['domain:billing>flow:job']);
    expect(merge.flowHoming).toMatchObject({ homedByStep: 0, homedByDeclared: 1, unplaced: 0 });
  });

  it('leaves a flow unplaced when its declared module is another area\'s or unknown, with no contains_flow', () => {
    const a = one([
      { name: 'foreign', module: 'modules/lib', files: [{ summary: 'x' }] },
      { name: 'unknown', module: 'modules/nope', files: [] },
      { name: 'undeclared', files: [{ summary: 'x' }] },
    ]);
    const { edges, merge, graph } = homed([a]);
    expect(edges).toEqual([]);
    expect(merge.flowHoming).toMatchObject({ homedByStep: 0, homedByDeclared: 0, unplaced: 3 });
    expect(merge.flowHoming.unplacedFlows).toEqual(['flow:foreign', 'flow:unknown', 'flow:undeclared']);
    expect(merge.flowHoming.unplacedAreas['flow:foreign']).toBe('area-001');
    expect(graph.nodes.filter((n) => n.type === 'flow')).toHaveLength(3);
    expect(graph.nodes.filter((n) => n.type === 'step')).toHaveLength(2);
  });

  it('homes a renamed flow under its own area\'s step', () => {
    const a = one([{ name: 'dup', files: ['modules/orders/routes.js'] }]);
    const b = analysis({ areaId: 'area-002', token: T, domains: [{ id: 'x', flows: [{ name: 'dup', files: ['modules/lib/db.js'] }] }] });
    expect(homed([a, b]).edges).toEqual(['domain:ordering>flow:dup', 'domain:shared>flow:dup--area-002']);
  });
});

// An id the merge gives by renaming may already be used by another area, and
// two areas may hand in the same final id. Either way one node would replace
// another, so the rename must pick a free id and the check must count ids,
// not just see them.
describe('id collisions across areas', () => {
  const manifest = manifestOf(
    { 'm/one': ['m/one/a.js'], 'm/two': ['m/two/b.js'] },
    { 'area-001': ['m/one'], 'area-002': ['m/two'] },
  );
  const plan = planFrom({ 'm/one': 'domain:a', 'm/two': 'domain:a' });
  const flowNode = (id) => ({ id, type: 'flow', name: id, summary: 's', tags: ['t'], complexity: 'simple' });
  const out = (areaId, ids) => ({ version: '1.0.0', project: {}, nodes: ids.map(flowNode), edges: [], areaRun: { areaId, token: T } });

  it('renames into an id no area uses, so nothing is overwritten', () => {
    const list = [
      { areaId: 'area-001', graph: out('area-001', ['flow:x', 'flow:x--area-002']) },
      { areaId: 'area-002', graph: out('area-002', ['flow:x']) },
    ];
    const { graph, merge } = mergeAreas({ accepted: list, plan, manifest });
    const flows = graph.nodes.filter((n) => n.type === 'flow').map((n) => n.id);
    expect(flows).toHaveLength(3);
    expect(new Set(flows).size).toBe(3);
    expect(checkConservation({ accepted: list, merged: graph, renames: merge.idsRenamed }).ok).toBe(true);
  });

  it('fails when two areas end with the same id and the merge keeps one', () => {
    const list = [
      { areaId: 'area-001', graph: out('area-001', ['flow:x']) },
      { areaId: 'area-002', graph: out('area-002', ['flow:x']) },
    ];
    const merged = { nodes: [flowNode('flow:x')], edges: [] };
    const result = checkConservation({ accepted: list, merged, renames: [] });
    expect(result.ok).toBe(false);
    expect(result.flowsIn).toBe(2);
    expect(result.missing.join('\n')).toContain('flow:x');
  });

  it('counts an edge an area repeats once, as the merge keeps it once', () => {
    const edge = { source: 'flow:x', target: 'step:x:1', type: 'flow_step', direction: 'forward', weight: 1 };
    const graph = out('area-001', ['flow:x']);
    graph.nodes.push({ id: 'step:x:1', type: 'step', name: 's', summary: 's', tags: ['t'], complexity: 'simple' });
    graph.edges.push(edge, { ...edge });
    const list = [{ areaId: 'area-001', graph }];
    const { graph: merged, merge } = mergeAreas({ accepted: list, plan, manifest });
    expect(merge.edgesDuplicate).toBe(1);
    const result = checkConservation({ accepted: list, merged, renames: merge.idsRenamed });
    expect(result.flowStepEdgesIn).toBe(1);
    expect(result.ok).toBe(true);
  });
});

describe('O5 conservation', () => {
  const manifest = manifestOf(
    { 'm/one': ['m/one/a.js'], 'm/two': ['m/two/b.js'] },
    { 'area-001': ['m/one'], 'area-002': ['m/two'] },
  );
  const plan = planFrom({ 'm/one': 'domain:a', 'm/two': 'domain:a' });
  const graphs = () => [
    analysis({ areaId: 'area-001', token: T, domains: [{ id: 'x', flows: [{ name: 'f', files: ['m/one/a.js', 'm/one/a.js'] }, { name: 'g', files: ['m/one/a.js'] }] }] }),
    analysis({ areaId: 'area-002', token: T, domains: [{ id: 'x', flows: [{ name: 'f', files: ['m/two/b.js'] }] }] }),
  ];
  const run = () => {
    const input = accepted(...graphs());
    const { graph, merge } = mergeAreas({ accepted: input, plan, manifest });
    return { input, graph, merge };
  };

  it('is ok on a normal merge, with renames mapped', () => {
    const { input, graph, merge } = run();
    expect(merge.idsRenamed.length).toBeGreaterThan(0);
    const c = checkConservation({ accepted: input, merged: graph, renames: merge.idsRenamed });
    expect(c).toMatchObject({ flowsIn: 3, flowsOut: 3, stepsIn: 4, stepsOut: 4, flowStepEdgesIn: 4, flowStepEdgesOut: 4, missing: [], extra: [], ok: true });
  });

  it('names a step the merge lost', () => {
    const { input, graph, merge } = run();
    const doctored = { ...graph, nodes: graph.nodes.filter((n) => n.id !== 'step:f:s2--area-002' && n.id !== 'step:g:s1') };
    const c = checkConservation({ accepted: input, merged: doctored, renames: merge.idsRenamed });
    expect(c.ok).toBe(false);
    expect(c.stepsIn).toBe(4);
    expect(c.stepsOut).toBe(3);
    expect(c.missing.join('\n')).toContain('step:g:s1');
  });

  it('names a flow_step edge the merge lost', () => {
    const { input, graph, merge } = run();
    const lost = graph.edges.find((e) => e.type === 'flow_step' && e.target === 'step:f:s2');
    const doctored = { ...graph, edges: graph.edges.filter((e) => e !== lost) };
    const c = checkConservation({ accepted: input, merged: doctored, renames: merge.idsRenamed });
    expect(c.ok).toBe(false);
    expect(c.flowStepEdgesOut).toBe(c.flowStepEdgesIn - 1);
    expect(c.missing.join('\n')).toContain('flow:f|step:f:s2');
  });

  it('names a flow and an edge nobody gave it as extra', () => {
    const { input, graph, merge } = run();
    const doctored = {
      ...graph,
      nodes: [...graph.nodes, { id: 'flow:invented', type: 'flow' }],
      edges: [...graph.edges, { source: 'flow:invented', target: 'step:g:s1', type: 'flow_step' }],
    };
    const c = checkConservation({ accepted: input, merged: doctored, renames: merge.idsRenamed });
    expect(c.ok).toBe(false);
    expect(c.extra.join('\n')).toContain('flow:invented');
    expect(c.extra.join('\n')).toContain('flow:invented|step:g:s1');
  });

  it('does not count what the merge discards on purpose: no-id nodes, duplicate ids, dangling edges', () => {
    const a = analysis({ areaId: 'area-001', token: T, domains: [{ id: 'x', flows: [{ name: 'f', files: ['m/one/a.js'] }] }] });
    a.nodes.push({ type: 'flow' }, { id: 'flow:f', type: 'flow', name: 'again' });
    a.edges.push({ source: 'flow:f', target: 'step:ghost', type: 'flow_step', weight: 1 });
    const { graph, merge } = mergeAreas({ accepted: accepted(a), plan, manifest });
    expect(merge).toMatchObject({ nodesWithoutId: 1, duplicateIdsInArea: 1, edgesDangling: 1 });
    expect(checkConservation({ accepted: accepted(a), merged: graph, renames: merge.idsRenamed }).ok).toBe(true);
  });

  it('exits 4 and writes no domain-analysis.json when conservation fails (injected lossy merge)', async () => {
    const root = tempRoot();
    const ex = prepareProject(root);
    const lossy = (args) => {
      const r = mergeAreas(args);
      const lost = r.graph.nodes.find((n) => n.type === 'step');
      r.graph.nodes = r.graph.nodes.filter((n) => n !== lost);
      return r;
    };
    writeFileSync(ex.manifest.areas[0].outputFile, JSON.stringify(recordedFor(ex.manifest, HANDLERS)));
    writePlanFor(root, ex.manifest);
    // An earlier merge of this run (before a retry) must not survive a failed check.
    writeFileSync(join(root, '.excavator/intermediate/domain-analysis.json'), '{}');
    const out = []; const err = [];
    const { exitCode } = await runMerge({ projectRoot: root, mergeFn: lossy, stdout: (t) => out.push(t), stderr: (t) => err.push(t) });
    expect(exitCode).toBe(EXIT_NOT_CONSERVED);
    expect(existsSync(join(root, '.excavator/intermediate/domain-analysis.json'))).toBe(false);
    const coverage = JSON.parse(readFileSync(join(root, '.excavator/reports/domain-coverage.json'), 'utf-8'));
    expect(coverage.conservation.ok).toBe(false);
    expect(err.join('')).toMatch(/step:/);
    expect(out.join('')).toMatch(/conservation FAILED missing=1 extra=0/);
  });
});

describe('computeCoverage', () => {
  const manifest = {
    token: T,
    areas: [{ areaId: 'area-001' }, { areaId: 'area-002' }],
    modules: [
      { path: 'api/orders', files: ['api/orders/routes.js', 'api/orders/service.js'], entryPoints: 2, candidateFiles: ['api/orders/routes.js'], areas: ['area-001'] },
      { path: 'api/refunds', files: ['api/refunds/routes.js'], entryPoints: 1, candidateFiles: ['api/refunds/routes.js'], areas: ['area-001'] },
      { path: 'api/lib', files: ['api/lib/db.js'], entryPoints: 0, candidateFiles: [], areas: ['area-001'] },
      { path: 'web/pages', files: ['web/pages/a.jsx'], entryPoints: 1, candidateFiles: ['web/pages/a.jsx'], areas: ['area-002'] },
      { path: 'web/legacy', files: ['web/legacy/b.jsx'], entryPoints: 1, candidateFiles: ['web/legacy/b.jsx'], areas: ['area-002'] },
    ],
  };

  it('puts every module in exactly one of four buckets and locates steps by path, then node id', () => {
    const a = analysis({
      areaId: 'area-001', token: T,
      domains: [{ id: 'domain:orders', flows: [{ name: 'create-order', files: ['./api/orders/service.js', { nodeIds: ['function:api/lib/db.js:insert'] }, '../escape.js', '/abs/x.js', 'docs/readme.md', { summary: 'nothing' }] }] }],
      skippedModules: [{ module: 'api/refunds', reason: 'only a stub router with no business logic' }, { module: 'web/pages', reason: 'not mine' }, { module: 'api/lib', reason: '  ' }],
    });
    const results = [
      { areaId: 'area-001', status: 'accepted', graph: a },
      { areaId: 'area-002', status: 'rejected-stale' },
    ];
    const nodeFiles = new Map([['function:api/lib/db.js:insert', 'api/lib/db.js']]);
    const { graph } = mergeAreas({ accepted: [{ areaId: 'area-001', graph: a }], plan: planAll(manifest), manifest, nodeFiles });
    const report = computeCoverage({ manifest, areaResults: results, merged: graph, nodeFiles });
    const status = Object.fromEntries(report.modules.map((m) => [m.path, m.status]));
    expect(status).toEqual({
      'api/orders': 'covered',
      'api/refunds': 'declared-skip',
      'api/lib': 'covered',
      'web/pages': 'silent-zero',
      'web/legacy': 'silent-zero',
    });
    expect(report.buckets).toEqual({ covered: 2, 'declared-skip': 1, 'silent-zero': 2, 'no-candidates': 0 });
    expect(Object.values(report.buckets).reduce((x, y) => x + y, 0)).toBe(manifest.modules.length);
    expect(report.steps).toEqual({ total: 6, located: 2, unlocated: 1, fileOutsideRoot: 2, fileOutsideModules: 1 });
    expect(report.merge.skippedModulesUnknown).toEqual([{ areaId: 'area-001', module: 'web/pages' }]);
    expect(report.candidateFiles.uncited).toEqual(['api/orders/routes.js', 'api/refunds/routes.js', 'web/legacy/b.jsx', 'web/pages/a.jsx']);
    expect(report.status).toBe('incomplete');
    const area2 = report.areas.find((x) => x.areaId === 'area-002');
    expect(area2.status).toBe('rejected-stale');
    expect(area2.silentZeroModules).toEqual(['web/legacy', 'web/pages']);
  });

  it('never places a step whose filePath escapes the root, even when its node ids resolve', () => {
    const a = analysis({
      areaId: 'area-001', token: T,
      domains: [{ id: 'domain:orders', flows: [{ name: 'f', files: [{ filePath: '../api/orders/service.js', nodeIds: ['function:api/lib/db.js:insert'] }] }] }],
    });
    const nodeFiles = new Map([['function:api/lib/db.js:insert', 'api/lib/db.js']]);
    const { graph } = mergeAreas({ accepted: [{ areaId: 'area-001', graph: a }], plan: planAll(manifest), manifest, nodeFiles });
    const report = computeCoverage({ manifest, areaResults: [{ areaId: 'area-001', status: 'accepted', graph: a }], merged: graph, nodeFiles });
    expect(report.steps).toEqual({ total: 1, located: 0, unlocated: 0, fileOutsideRoot: 1, fileOutsideModules: 0 });
    expect(report.modules.find((m) => m.path === 'api/lib').status).toBe('no-candidates');
  });

  it('names a part of a split module that its area left without flows, though another part is covered', () => {
    const split = {
      token: T,
      counts: { testFilesExcluded: 2, graphOnlyFiles: 1 },
      areas: [
        { areaId: 'area-001', modules: [{ path: 'api/big', part: { index: 1, of: 2 }, files: ['api/big/a.js'] }] },
        { areaId: 'area-002', modules: [{ path: 'api/big', part: { index: 2, of: 2 }, files: ['api/big/b.js'] }] },
      ],
      modules: [
        { path: 'api/big', files: ['api/big/a.js', 'api/big/b.js'], entryPoints: 2, candidateFiles: ['api/big/a.js', 'api/big/b.js'], areas: ['area-001', 'area-002'] },
      ],
    };
    const a = analysis({ areaId: 'area-001', token: T, domains: [{ id: 'domain:big', flows: [{ name: 'f', files: ['api/big/a.js'] }] }] });
    const b = analysis({ areaId: 'area-002', token: T, domains: [] });
    const results = [{ areaId: 'area-001', status: 'accepted', graph: a }, { areaId: 'area-002', status: 'accepted', graph: b }];
    const { graph } = mergeAreas({ accepted: results.map(({ areaId, graph: g }) => ({ areaId, graph: g })), plan: planAll(split), manifest: split });
    const report = computeCoverage({ manifest: split, areaResults: results, merged: graph });
    expect(report.modules[0].status).toBe('covered');
    expect(report.areas.find((x) => x.areaId === 'area-001').silentZeroParts).toEqual([]);
    expect(report.areas.find((x) => x.areaId === 'area-002').silentZeroParts).toEqual([{ path: 'api/big', part: { index: 2, of: 2 } }]);
    expect(report.silentZeroParts).toBe(1);
    // The split's own counts reach the report, which outlives the manifest.
    expect(report.split).toEqual({ testFilesExcluded: 2, graphOnlyFiles: 1 });
  });

  it('reports a module with no entry point and no flow as no-candidates', () => {
    const a = analysis({ areaId: 'area-001', token: T, domains: [{ id: 'domain:orders', flows: [{ name: 'f', files: ['api/orders/routes.js'] }] }] });
    const results = [{ areaId: 'area-001', status: 'accepted', graph: a }, { areaId: 'area-002', status: 'accepted', graph: analysis({ areaId: 'area-002', token: T, domains: [] }) }];
    const { graph } = mergeAreas({ accepted: results.map(({ areaId, graph: g }) => ({ areaId, graph: g })), plan: planAll(manifest), manifest });
    const report = computeCoverage({ manifest, areaResults: results, merged: graph, nodeFiles: new Map() });
    expect(report.modules.find((m) => m.path === 'api/lib').status).toBe('no-candidates');
    expect(report.status).toBe('complete');
  });
});

/** Extract and split the fixture into one area, as the old single-analyzer run saw it. */
function prepareProject(root = tempRoot()) {
  writeMultiModuleProject(root);
  const ex = spawnSync('python3', [EXTRACT, root], { encoding: 'utf-8' });
  if (ex.error) throw ex.error;
  expect(ex.status, ex.stderr).toBe(0);
  const sp = spawnSync(process.execPath, [SPLIT, root, '--budget-bytes', '10000000', '--max-entry-points', '100000'], { encoding: 'utf-8' });
  expect(sp.status, sp.stderr).toBe(0);
  const manifest = JSON.parse(readFileSync(join(root, '.excavator/intermediate/domain-areas/manifest.json'), 'utf-8'));
  expect(manifest.areas).toHaveLength(1);
  return { root, manifest };
}

/** A recorded analysis with a flow for every handler in `handlers` and for every other candidate module. */
function recordedFor(manifest, handlers) {
  const others = manifest.modules
    .filter((m) => m.entryPoints > 0 && !HANDLER_MODULES.includes(m.path))
    .map((m) => ({ name: `other-${m.path.replace(/[^a-z0-9]+/g, '-')}`, files: m.candidateFiles }));
  return analysis({
    areaId: manifest.areas[0].areaId, token: manifest.token,
    domains: [
      { id: 'domain:commerce', flows: handlers.map(([name, action]) => ({ name: `${action}-${name}`, files: [`services/api/src/handlers/${name}/routes.js`, `services/api/src/handlers/${name}/service.js`] })) },
      { id: 'domain:operations', flows: others },
    ],
  });
}

/** The accepted plan the merge needs: handlers in one business domain, everything else in a support domain. */
function writePlanFor(root, manifest) {
  const plan = planFrom(
    Object.fromEntries(manifest.modules.map((m) => [m.path, HANDLER_MODULES.includes(m.path) ? 'domain:commerce' : 'domain:operations'])),
    { kinds: { 'domain:operations': 'support' } },
  );
  mkdirSync(join(root, '.excavator'), { recursive: true });
  writeFileSync(join(root, '.excavator/domain-plan.json'), JSON.stringify(plan));
  return plan;
}

describe('multi-module fixture end to end', () => {
  function merge(root) {
    const result = spawnSync(process.execPath, [MERGE, root], { encoding: 'utf-8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, coverage: JSON.parse(readFileSync(join(root, '.excavator/reports/domain-coverage.json'), 'utf-8')) };
  }

  it('reports no gap for an analysis that covers every module with an entry point', () => {
    const { root, manifest } = prepareProject();
    writePlanFor(root, manifest);
    writeFileSync(manifest.areas[0].outputFile, JSON.stringify(recordedFor(manifest, HANDLERS)));
    const { status, coverage, stdout } = merge(root);
    expect(status).toBe(0);
    expect(coverage.buckets['silent-zero']).toBe(0);
    expect(coverage.candidateFiles.uncited).toEqual([]);
    expect(coverage.plan).toMatchObject({ status: 'reused', businessDomains: 1, supportDomains: 1 });
    expect(coverage.plan.moduleSetDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(coverage.flows).toEqual({ total: coverage.totals.flows, homedByStep: coverage.totals.flows, homedByDeclared: 0, unplaced: 0 });
    expect(coverage.conservation).toMatchObject({ ok: true, missing: [], extra: [] });
    expect(coverage.modules.find((m) => m.path === HANDLER_MODULES[0]).domain).toBe('domain:commerce');
    expect(stdout).toContain('plan status=reused business=1 support=1');
    expect(stdout).toContain(`flows homed step=${coverage.totals.flows} declared=0 unplaced=0`);
    expect(stdout).toContain('conservation ok');
    expect(coverage.totals.domains).toBe(2);
  });

  it('reports the plan status from the planner input left by prepare', () => {
    const { root, manifest } = prepareProject();
    writePlanFor(root, manifest);
    writeFileSync(join(root, '.excavator/intermediate/domain-areas/plan.input.json'), JSON.stringify({ mode: 'extend' }));
    writeFileSync(manifest.areas[0].outputFile, JSON.stringify(recordedFor(manifest, HANDLERS)));
    expect(merge(root).coverage.plan.status).toBe('extend');
  });

  it('exits 1 telling to run plan-domains.mjs when the plan is absent or covers other modules', () => {
    const { root, manifest } = prepareProject();
    writeFileSync(manifest.areas[0].outputFile, JSON.stringify(recordedFor(manifest, HANDLERS)));
    const absent = spawnSync(process.execPath, [MERGE, root], { encoding: 'utf-8' });
    expect(absent.status).toBe(1);
    expect(absent.stderr).toContain('plan-domains.mjs');
    const plan = writePlanFor(root, manifest);
    delete plan.modules[HANDLER_MODULES[0]];
    plan.modules['gone/module'] = 'domain:commerce';
    writeFileSync(join(root, '.excavator/domain-plan.json'), JSON.stringify(plan));
    const differs = spawnSync(process.execPath, [MERGE, root], { encoding: 'utf-8' });
    expect(differs.status).toBe(1);
    expect(differs.stderr).toContain(HANDLER_MODULES[0]);
    expect(differs.stderr).toContain('gone/module');
    expect(existsSync(join(root, '.excavator/intermediate/domain-analysis.json'))).toBe(false);
  });

  it('names exactly the 8 handler modules a single analyzer left out', () => {
    const { root, manifest } = prepareProject();
    writePlanFor(root, manifest);
    const kept = HANDLERS.slice(0, 16);
    const dropped = HANDLER_MODULES.slice(16);
    writeFileSync(manifest.areas[0].outputFile, JSON.stringify(recordedFor(manifest, kept)));
    const { status, coverage, stdout } = merge(root);
    expect(status).toBe(0);
    const silent = coverage.modules.filter((m) => m.status === 'silent-zero').map((m) => m.path);
    expect(silent).toEqual([...dropped].sort());
    expect(coverage.candidateFiles.uncited).toEqual(dropped.map((m) => `${m}/routes.js`).sort());
    for (const module of dropped) expect(stdout).toContain(module);
    const analysisOut = JSON.parse(readFileSync(join(root, '.excavator/intermediate/domain-analysis.json'), 'utf-8'));
    expect(analysisOut.nodes.filter((n) => n.type === 'flow')).toHaveLength(16 + coverage.modules.filter((m) => m.entryPoints > 0 && !HANDLER_MODULES.includes(m.path)).length);
  });

  it('exits 3 and merges nothing from an area whose output is an earlier file copied into place', () => {
    const { root, manifest } = prepareProject();
    writePlanFor(root, manifest);
    const old = recordedFor(manifest, HANDLERS);
    delete old.areaRun;
    writeFileSync(manifest.areas[0].outputFile, JSON.stringify(old));
    const { status, coverage } = merge(root);
    expect(status).toBe(3);
    expect(coverage.areas[0].status).toBe('rejected-stale');
    expect(coverage.totals.flows).toBe(0);
    expect(coverage.buckets.covered).toBe(0);
  });

  it('exits 3 when an area has no output at all', () => {
    const { root, manifest } = prepareProject();
    writePlanFor(root, manifest);
    const { status, coverage } = merge(root);
    expect(status).toBe(3);
    expect(coverage.areas[0].status).toBe('missing');
  });
});
