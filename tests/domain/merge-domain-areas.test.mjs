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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acceptOutput, mergeAreas, computeCoverage,
} from '../../skills/excavator-domain/merge-domain-areas.mjs';
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
 * A recorded analyzer output. `domains` is [{ id, flows: [{ name, files }] }];
 * each flow gets one step per file, in order.
 */
function analysis({ areaId, token, domains, skippedModules, extraEdges = [] }) {
  const nodes = [];
  const edges = [];
  for (const domain of domains) {
    nodes.push({
      id: domain.id, type: 'domain', name: domain.name ?? domain.id.slice(7), summary: domain.summary ?? 's',
      tags: domain.tags ?? ['t'], complexity: domain.complexity ?? 'simple',
      domainMeta: domain.domainMeta ?? { entities: [], businessRules: [], crossDomainInteractions: [] },
    });
    for (const flow of domain.flows) {
      const flowId = `flow:${flow.name}`;
      nodes.push({ id: flowId, type: 'flow', name: flow.name, summary: 's', tags: ['t'], complexity: 'simple', domainMeta: { entryPoint: 'POST /x', entryType: 'http' } });
      edges.push({ source: domain.id, target: flowId, type: 'contains_flow', direction: 'forward', weight: 1 });
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
  it('merges a domain two areas both output, keeping both areas\' flows under it', () => {
    const a = analysis({ areaId: 'area-001', token: T, domains: [{ id: 'domain:billing', tags: ['money'], complexity: 'simple', domainMeta: { entities: ['Invoice'], businessRules: ['r1'] }, flows: [{ name: 'issue-invoice', files: ['b/a.js'] }] }] });
    const b = analysis({ areaId: 'area-002', token: T, domains: [{ id: 'domain:billing', name: 'Other name', tags: ['money', 'tax'], complexity: 'complex', domainMeta: { entities: ['Invoice', 'Payment'], businessRules: ['r2'] }, flows: [{ name: 'capture-payment', files: ['b/b.js'] }] }] });
    const { graph, merge } = mergeAreas({ accepted: [{ areaId: 'area-001', graph: a }, { areaId: 'area-002', graph: b }] });
    const domains = graph.nodes.filter((n) => n.type === 'domain');
    expect(domains).toHaveLength(1);
    expect(domains[0].name).toBe('billing');
    expect(domains[0].tags).toEqual(['money', 'tax']);
    expect(domains[0].complexity).toBe('complex');
    expect(domains[0].domainMeta.entities).toEqual(['Invoice', 'Payment']);
    expect(domains[0].domainMeta.businessRules).toEqual(['r1', 'r2']);
    const flowsOfBilling = graph.edges.filter((e) => e.type === 'contains_flow' && e.source === 'domain:billing').map((e) => e.target).sort();
    expect(flowsOfBilling).toEqual(['flow:capture-payment', 'flow:issue-invoice']);
    expect(merge.domainsMerged).toEqual([{ id: 'domain:billing', areas: ['area-001', 'area-002'] }]);
    expect(graph.areaRun).toBeUndefined();
  });

  it('renames a flow id two areas both use, and its step edges follow', () => {
    const a = analysis({ areaId: 'area-001', token: T, domains: [{ id: 'domain:orders', flows: [{ name: 'create-order', files: ['api/o.js'] }] }] });
    const b = analysis({ areaId: 'area-002', token: T, domains: [{ id: 'domain:storefront', flows: [{ name: 'create-order', files: ['web/o.jsx', 'web/p.jsx'] }] }] });
    const { graph, merge } = mergeAreas({ accepted: [{ areaId: 'area-001', graph: a }, { areaId: 'area-002', graph: b }] });
    const ids = graph.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('flow:create-order--area-002');
    expect(ids).toContain('step:create-order:s1--area-002');
    expect(graph.edges).toContainEqual(expect.objectContaining({ source: 'domain:storefront', target: 'flow:create-order--area-002', type: 'contains_flow' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ source: 'flow:create-order--area-002', target: 'step:create-order:s2', type: 'flow_step' }));
    expect(merge.idsRenamed).toContainEqual({ from: 'flow:create-order', to: 'flow:create-order--area-002', areaId: 'area-002' });
    expect(merge.edgesDangling).toBe(0);
  });

  it('applies only the aliases whose ends exist and are not chained', () => {
    const a = analysis({
      areaId: 'area-001', token: T,
      domains: [
        { id: 'domain:orders', flows: [{ name: 'f1', files: ['x.js'] }] },
        { id: 'domain:order-management', flows: [{ name: 'f2', files: ['y.js'] }] },
        { id: 'domain:payments', flows: [{ name: 'f3', files: ['z.js'] }] },
      ],
      extraEdges: [{ source: 'domain:orders', target: 'domain:order-management', type: 'cross_domain', direction: 'forward', weight: 0.6 }],
    });
    const aliases = {
      'domain:orders': 'domain:order-management',
      'domain:missing': 'domain:payments',
      'domain:payments': 'domain:orders',
      'flow:f1': 'flow:f2',
    };
    const { graph, merge } = mergeAreas({ accepted: [{ areaId: 'area-001', graph: a }], aliases });
    expect(graph.nodes.filter((n) => n.type === 'domain').map((n) => n.id).sort()).toEqual(['domain:order-management', 'domain:payments']);
    expect(merge.aliasesApplied).toEqual([{ from: 'domain:orders', to: 'domain:order-management' }]);
    expect(merge.aliasesRejected.map((r) => r.from).sort()).toEqual(['domain:missing', 'domain:payments', 'flow:f1']);
    expect(graph.edges.filter((e) => e.source === 'domain:order-management' && e.type === 'contains_flow').map((e) => e.target).sort()).toEqual(['flow:f1', 'flow:f2']);
    expect(merge.edgesSelfLoop).toBe(1);
    expect(graph.edges.some((e) => e.source === e.target)).toBe(false);
  });

  it('drops and counts edges whose ends are not in the merged graph, and duplicates', () => {
    const a = analysis({
      areaId: 'area-001', token: T,
      domains: [{ id: 'domain:orders', flows: [{ name: 'f1', files: ['x.js'] }] }],
      extraEdges: [
        { source: 'domain:orders', target: 'domain:nowhere', type: 'cross_domain', direction: 'forward', weight: 0.6 },
        { source: 'domain:orders', target: 'flow:f1', type: 'contains_flow', direction: 'forward', weight: 1 },
      ],
    });
    const { graph, merge } = mergeAreas({ accepted: [{ areaId: 'area-001', graph: a }] });
    expect(merge.edgesDangling).toBe(1);
    expect(merge.edgesDuplicate).toBe(1);
    expect(graph.edges.filter((e) => e.type === 'contains_flow')).toHaveLength(1);
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
    const { graph } = mergeAreas({ accepted: [{ areaId: 'area-001', graph: a }] });
    const nodeFiles = new Map([['function:api/lib/db.js:insert', 'api/lib/db.js']]);
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
    const { graph } = mergeAreas({ accepted: [{ areaId: 'area-001', graph: a }] });
    const nodeFiles = new Map([['function:api/lib/db.js:insert', 'api/lib/db.js']]);
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
    const { graph } = mergeAreas({ accepted: results.map(({ areaId, graph: g }) => ({ areaId, graph: g })) });
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
    const { graph } = mergeAreas({ accepted: results.map(({ areaId, graph: g }) => ({ areaId, graph: g })) });
    const report = computeCoverage({ manifest, areaResults: results, merged: graph, nodeFiles: new Map() });
    expect(report.modules.find((m) => m.path === 'api/lib').status).toBe('no-candidates');
    expect(report.status).toBe('complete');
  });
});

describe('multi-module fixture end to end', () => {
  /** Extract and split the fixture into one area, as the old single-analyzer run saw it. */
  function prepare() {
    const root = tempRoot();
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
  function recorded(manifest, handlers) {
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

  function merge(root) {
    const result = spawnSync(process.execPath, [MERGE, root], { encoding: 'utf-8' });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, coverage: JSON.parse(readFileSync(join(root, '.excavator/reports/domain-coverage.json'), 'utf-8')) };
  }

  it('reports no gap for an analysis that covers every module with an entry point', () => {
    const { root, manifest } = prepare();
    writeFileSync(manifest.areas[0].outputFile, JSON.stringify(recorded(manifest, HANDLERS)));
    const { status, coverage } = merge(root);
    expect(status).toBe(0);
    expect(coverage.buckets['silent-zero']).toBe(0);
    expect(coverage.candidateFiles.uncited).toEqual([]);
  });

  it('names exactly the 8 handler modules a single analyzer left out', () => {
    const { root, manifest } = prepare();
    const kept = HANDLERS.slice(0, 16);
    const dropped = HANDLER_MODULES.slice(16);
    writeFileSync(manifest.areas[0].outputFile, JSON.stringify(recorded(manifest, kept)));
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
    const { root, manifest } = prepare();
    const old = recorded(manifest, HANDLERS);
    delete old.areaRun;
    writeFileSync(manifest.areas[0].outputFile, JSON.stringify(old));
    const { status, coverage } = merge(root);
    expect(status).toBe(3);
    expect(coverage.areas[0].status).toBe('rejected-stale');
    expect(coverage.totals.flows).toBe(0);
    expect(coverage.buckets.covered).toBe(0);
  });

  it('exits 3 when an area has no output at all', () => {
    const { root } = prepare();
    const { status, coverage } = merge(root);
    expect(status).toBe(3);
    expect(coverage.areas[0].status).toBe('missing');
  });
});
