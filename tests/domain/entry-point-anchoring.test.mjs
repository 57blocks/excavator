/**
 * Flows anchored to fact entry points. Every script entry point carries an
 * `id` and a handler `group` (extract-domain-context.py); a flow that starts
 * at one cites it in `domainMeta.entryPointIds`. The merge checks the
 * citations at acceptance, names each anchored flow from its group (so two
 * runs that cover the same handler give the same flow id, whatever the
 * analyzer called it), homes it in the module of the group's file, and puts
 * every fact entry point in exactly one coverage bucket.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acceptOutput, checkCitations, choiceLines, computeCoverage, mergeAreas, runMerge,
} from '../../skills/excavator-domain/merge-domain-areas.mjs';
import { PLAN_FORMAT, moduleSetDigest } from '../../skills/excavator-domain/plan-domains.mjs';
import { entryRecord, writeEntryPointGraph } from './helpers/facts.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXTRACT = resolve(repoRoot, 'skills/excavator-domain/extract-domain-context.py');
const SPLIT = resolve(repoRoot, 'skills/excavator-domain/split-domain-areas.mjs');

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

const ORDERS_HANDLER = { fate: 'node', text: 'orders.Handle', nodeId: 'function:svc/orders/handlers.go:Handle', file: 'svc/orders/handlers.go', line: 3 };
const INVOICES_HANDLER = { fate: 'node', text: 'billing.Invoices', nodeId: 'function:svc/billing/invoices.go:Invoices', file: 'svc/billing/invoices.go', line: 3 };
const PROFILE_HANDLER = { fate: 'node', text: 'Profile', nodeId: 'function:web/pages/profile.jsx:Profile', file: 'web/pages/profile.jsx', line: 1 };

const IDS = {
  getOrders: 'ep:http.get-orders',
  postOrders: 'ep:http.post-orders',
  health: 'ep:http.get-health',
  invoices: 'ep:http.get-invoices',
  profile: 'ep:ui.my-profile',
};

/**
 * A small project with hand-written facts: GET and POST /orders on one
 * handler (one group), GET /health inline, GET /invoices in its own module,
 * a UI route, a module with no candidates, and a cron job found by pattern.
 * Extracted and split into one area; one stored plan.
 */
function prepare({ extraFiles = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'domain-anchor-'));
  roots.push(root);
  const files = {
    ...extraFiles,
    'svc/routes.go': 'package svc\n\nfunc register(e E) {\n\te.GET("/orders", orders.Handle)\n\te.POST("/orders", orders.Handle)\n\te.GET("/health", func(c C) {})\n\te.GET("/invoices", billing.Invoices)\n}\n',
    'svc/orders/handlers.go': 'package orders\n\nfunc Handle() {}\n',
    'svc/billing/invoices.go': 'package billing\n\nfunc Invoices() {}\n',
    'svc/templates/mail.go': 'package templates\n\nconst Mail = "hello"\n',
    'web/pages/profile.jsx': 'export function Profile() { return null; }\n',
    'jobs/nightly.js': "cron.schedule('0 0 * * *', () => {});\n",
  };
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  const profile = entryRecord({ file: 'web/pages/profile.jsx', line: 1, path: '/my/profile', handler: PROFILE_HANDLER, framework: 'react' });
  Object.assign(profile, { routeKind: 'ui', method: null });
  writeEntryPointGraph(root, [
    entryRecord({ file: 'svc/routes.go', line: 4, method: 'GET', path: '/orders', handler: ORDERS_HANDLER, framework: 'gin' }),
    entryRecord({ file: 'svc/routes.go', line: 5, method: 'POST', path: '/orders', handler: ORDERS_HANDLER, framework: 'gin' }),
    entryRecord({ file: 'svc/routes.go', line: 6, method: 'GET', path: '/health', handler: { fate: 'inline', line: 6, endLine: 6 }, framework: 'gin' }),
    entryRecord({ file: 'svc/routes.go', line: 7, method: 'GET', path: '/invoices', handler: INVOICES_HANDLER, framework: 'gin' }),
    profile,
  ]);
  const ex = spawnSync('python3', [EXTRACT, root], { encoding: 'utf-8' });
  if (ex.error) throw ex.error;
  expect(ex.status, ex.stderr).toBe(0);
  const sp = spawnSync(process.execPath, [SPLIT, root, '--budget-bytes', '10000000', '--max-entry-points', '100000'], { encoding: 'utf-8' });
  expect(sp.status, sp.stderr).toBe(0);
  const areasDir = join(root, '.excavator/intermediate/domain-areas');
  const manifest = JSON.parse(readFileSync(join(areasDir, 'manifest.json'), 'utf-8'));
  const assign = Object.fromEntries(manifest.modules.map((m) => [m.path, m.path === 'svc/billing' ? 'domain:billing' : 'domain:ordering']));
  const plan = {
    format: PLAN_FORMAT,
    moduleSetDigest: moduleSetDigest(Object.keys(assign)),
    modules: Object.fromEntries(Object.keys(assign).sort().map((k) => [k, assign[k]])),
    mixed: [],
    domains: ['domain:ordering', 'domain:billing'].map((id) => ({ id, kind: 'business', name: id.slice(7), summary: `${id} summary`, tags: ['t'] })),
    crossDomain: [],
    history: [],
  };
  writeFileSync(join(root, '.excavator/domain-plan.json'), JSON.stringify(plan));
  const context = JSON.parse(readFileSync(join(areasDir, 'area-001.context.json'), 'utf-8'));
  return { root, manifest, plan, context, output: join(areasDir, 'area-001.analysis.json') };
}

/** An area output; each flow is { name, files, ids?, type? } with one step per file. */
function areaOutput(flows, { token, skippedModules = [], skippedEntryPoints = [], entryPoints = [] }) {
  const nodes = [];
  const edges = [];
  for (const flow of flows) {
    const id = `flow:${flow.name}`;
    const meta = { entryPoint: 'model text', entryType: flow.type ?? 'http' };
    if (flow.ids !== undefined) meta.entryPointIds = flow.ids;
    nodes.push({ id, type: 'flow', name: flow.name, summary: 's', tags: ['t'], complexity: 'simple', domainMeta: meta });
    flow.files.forEach((file, i) => {
      const stepId = `step:${flow.name}:s${i + 1}`;
      nodes.push({ id: stepId, type: 'step', name: `s${i + 1}`, summary: 's', tags: ['t'], complexity: 'simple', filePath: file });
      edges.push({ source: id, target: stepId, type: 'flow_step', direction: 'forward', weight: Math.min(1, (i + 1) / 10) });
    });
  }
  return {
    version: '1.0.0', project: { name: 'fixture' }, nodes, edges, layers: [], tour: [],
    areaRun: { areaId: 'area-001', token }, skippedModules, skippedEntryPoints, entryPoints,
  };
}

async function merge(root, output, graph, options = {}) {
  writeFileSync(output, JSON.stringify(graph));
  const out = [];
  const { exitCode } = await runMerge({ projectRoot: root, stdout: (t) => out.push(t), stderr: () => {}, ...options });
  const coverage = JSON.parse(readFileSync(join(root, '.excavator/reports/domain-coverage.json'), 'utf-8'));
  let merged = null;
  try {
    merged = JSON.parse(readFileSync(join(root, '.excavator/intermediate/domain-analysis.json'), 'utf-8'));
  } catch {}
  return { exitCode, stdout: out.join(''), coverage, merged };
}

function runCheckCommand(context) {
  const result = spawnSync('sh', ['-c', context.check], { encoding: 'utf-8' });
  if (result.error) throw result.error;
  return result;
}

const flowNodes = (graph) => graph.nodes.filter((n) => n.type === 'flow');

describe('entry-point ids in the area context', () => {
  it('carries each script entry point with its id and group', () => {
    const { context } = prepare();
    const script = context.entryPoints.filter((e) => e.source === 'script');
    expect(Object.fromEntries(script.map((e) => [e.id, e.group]))).toEqual({
      [IDS.getOrders]: IDS.getOrders,
      [IDS.postOrders]: IDS.getOrders,
      [IDS.health]: IDS.health,
      [IDS.invoices]: IDS.invoices,
      [IDS.profile]: IDS.profile,
    });
    expect(context.entryPoints.some((e) => e.source === 'pattern' && e.file === 'jobs/nightly.js')).toBe(true);
  });
});

describe('citation check at acceptance', () => {
  it('names each wrong citation and rejects the area', () => {
    const { manifest, plan, context } = prepare();
    const entries = context.entryPoints.filter((e) => e.source === 'script');
    const graph = areaOutput([
      { name: 'made-up', files: ['svc/orders/handlers.go'], ids: ['ep:http.get-nowhere'] },
      { name: 'two-handlers', files: ['svc/orders/handlers.go'], ids: [IDS.getOrders, IDS.invoices] },
      { name: 'orders-again', files: ['svc/orders/handlers.go'], ids: [IDS.postOrders] },
      { name: 'not-a-list', files: ['svc/routes.go'], ids: IDS.health },
    ], { token: manifest.token });
    const r = acceptOutput({ token: manifest.token, areaId: 'area-001', text: JSON.stringify(graph), choice: { plan, manifest, entries } });
    expect(r.status).toBe('rejected-entry-point');
    expect(choiceLines('area-001', r)).toEqual([
      'rejected-entry-point area-001 flow:made-up problem=unknown ids=ep:http.get-nowhere',
      `rejected-entry-point area-001 flow:two-handlers problem=mixed-groups ids=${IDS.getOrders},${IDS.invoices}`,
      `rejected-entry-point area-001 flow:orders-again problem=shared-group ids=${IDS.postOrders} cited-by=flow:two-handlers`,
      `rejected-entry-point area-001 flow:not-a-list problem=malformed ids=${IDS.health}`,
    ]);
  });

  it('rejects at the check command and at the merge, and keeps nothing of the area', async () => {
    const { root, manifest, context, output } = prepare();
    writeFileSync(output, JSON.stringify(areaOutput([{ name: 'x', files: ['svc/orders/handlers.go'], ids: ['ep:http.get-nowhere'] }], { token: manifest.token })));
    const check = runCheckCommand(context);
    expect(check.status).toBe(3);
    expect(check.stdout).toContain('rejected-entry-point area-001 flow:x problem=unknown ids=ep:http.get-nowhere');
    const { exitCode, coverage, stdout } = await merge(root, output, JSON.parse(readFileSync(output, 'utf-8')));
    expect(exitCode).toBe(3);
    expect(coverage.areas[0].status).toBe('rejected-entry-point');
    expect(coverage.totals.flows).toBe(0);
    expect(stdout).toContain('rejected-entry-point area-001 flow:x problem=unknown');
  });

  it('accepts correct citations, and lists what is neither cited nor skipped without rejecting', () => {
    const { manifest, context, output } = prepare();
    writeFileSync(output, JSON.stringify(areaOutput([
      { name: 'orders', files: ['svc/orders/handlers.go'], ids: [IDS.postOrders] },
    ], { token: manifest.token, skippedEntryPoints: [{ id: IDS.health, reason: 'Health check, no business behaviour.' }] })));
    const check = runCheckCommand(context);
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout.trim().split('\n')).toEqual([
      'area-001 accepted',
      `uncovered-entry-point area-001 ${IDS.invoices} GET /invoices`,
      `uncovered-entry-point area-001 ${IDS.profile} /my/profile`,
    ]);
  });
});

describe('flow ids derived from the cited entry points', () => {
  it('gives two runs that cite the same group the same flow id, whatever the analyzer named the flow', async () => {
    const one = prepare();
    const a = await merge(one.root, one.output, areaOutput([
      { name: 'create-order', files: ['svc/orders/handlers.go'], ids: [IDS.postOrders] },
    ], { token: one.manifest.token }));
    const two = prepare();
    const b = await merge(two.root, two.output, areaOutput([
      { name: 'order-submission', files: ['svc/orders/handlers.go'], ids: [IDS.postOrders, IDS.getOrders] },
    ], { token: two.manifest.token }));
    expect(a.exitCode).toBe(0);
    expect(b.exitCode).toBe(0);
    expect(flowNodes(a.merged).map((f) => f.id)).toEqual(['flow:http.get-orders']);
    expect(flowNodes(b.merged).map((f) => f.id)).toEqual(['flow:http.get-orders']);
    expect(flowNodes(a.merged)[0].domainMeta).toMatchObject({ entryPointIds: [IDS.postOrders], entryPoint: 'POST /orders', entryType: 'http' });
    expect(flowNodes(b.merged)[0].domainMeta).toMatchObject({ entryPointIds: [IDS.getOrders, IDS.postOrders], entryPoint: 'GET /orders, POST /orders' });
    expect(a.coverage.conservation.ok).toBe(true);
    expect(b.merged.edges.filter((e) => e.type === 'flow_step').every((e) => e.source === 'flow:http.get-orders')).toBe(true);
    expect(a.coverage.flows).toMatchObject({ anchored: 1, unanchored: 0, homedByEntryPoint: 1, citationsDropped: 0 });
  });

  it('writes manual for a UI route and keeps the id of a flow with no fact entry point', async () => {
    const { root, manifest, output } = prepare();
    const { merged, coverage } = await merge(root, output, areaOutput([
      { name: 'view-profile', files: ['web/pages/profile.jsx'], ids: [IDS.profile], type: 'http' },
      { name: 'nightly-cleanup', files: ['jobs/nightly.js'], type: 'cron' },
    ], { token: manifest.token }));
    const byId = Object.fromEntries(flowNodes(merged).map((f) => [f.id, f.domainMeta]));
    expect(byId['flow:ui.my-profile']).toMatchObject({ entryPoint: '/my/profile', entryType: 'manual', entryPointIds: [IDS.profile] });
    expect(byId['flow:nightly-cleanup']).toMatchObject({ entryType: 'cron' });
    expect(byId['flow:nightly-cleanup']).not.toHaveProperty('entryPointIds');
    expect(coverage.flows).toMatchObject({ anchored: 1, unanchored: 1 });
  });

  it('homes an anchored flow in the module of its entry point, not of its first step', async () => {
    const { root, manifest, output } = prepare();
    const { merged } = await merge(root, output, areaOutput([
      { name: 'list-invoices', files: ['svc/orders/handlers.go', 'svc/billing/invoices.go'], ids: [IDS.invoices] },
    ], { token: manifest.token }));
    const home = merged.edges.find((e) => e.type === 'contains_flow' && e.target === 'flow:http.get-invoices');
    expect(home.source).toBe('domain:billing');
  });

  it('drops wrong citations by fixed rules when the area is accepted without the check', async () => {
    const { root, manifest, output } = prepare();
    const { exitCode, merged, coverage, stdout } = await merge(root, output, areaOutput([
      { name: 'orders', files: ['svc/orders/handlers.go'], ids: [IDS.invoices, IDS.getOrders, 'ep:http.get-nowhere'] },
      { name: 'orders-again', files: ['svc/orders/handlers.go'], ids: [IDS.postOrders] },
    ], { token: manifest.token }), { acceptUnchosen: true });
    expect(exitCode).toBe(0);
    // The first id in fact order is GET /orders, so its group stays; /invoices and the unknown id go.
    const flows = Object.fromEntries(flowNodes(merged).map((f) => [f.id, f.domainMeta]));
    expect(flows['flow:http.get-orders'].entryPointIds).toEqual([IDS.getOrders]);
    expect(flows['flow:orders-again']).not.toHaveProperty('entryPointIds');
    expect(coverage.flows).toMatchObject({ anchored: 1, unanchored: 1, citationsDropped: 3 });
    expect(coverage.areas[0].uncited.map((p) => p.problem)).toEqual(['unknown', 'mixed-groups', 'shared-group']);
    expect(stdout).toMatch(/area-001 accepted .*uncited=3/);
    expect(coverage.conservation.ok).toBe(true);
  });

  it('keeps conservation through the derived names when an analyzer id collides with one', () => {
    const entries = [
      { id: IDS.getOrders, group: IDS.getOrders, file: 'svc/orders/handlers.go', method: 'GET', path: '/orders', type: 'http', registeredAt: { file: 'svc/routes.go', line: 4 } },
    ];
    const manifest = { modules: [{ path: 'svc/orders', files: ['svc/orders/handlers.go'], areas: ['area-001'] }], areas: [{ areaId: 'area-001' }] };
    const plan = { modules: { 'svc/orders': 'domain:ordering' }, mixed: [], domains: [{ id: 'domain:ordering', kind: 'business', name: 'o', summary: 's' }] };
    const graph = areaOutput([
      { name: 'http.get-orders', files: ['svc/orders/handlers.go'] },
      { name: 'list-orders', files: ['svc/orders/handlers.go'], ids: [IDS.getOrders] },
    ], { token: 't' });
    expect(checkCitations({ graph, entries }).problems).toEqual([]);
    const { graph: merged, merge: m } = mergeAreas({ accepted: [{ areaId: 'area-001', graph }], plan, manifest, entriesOf: new Map([['area-001', entries]]) });
    expect(flowNodes(merged).map((f) => f.id).sort()).toEqual(['flow:http.get-orders', 'flow:http.get-orders--area-001']);
    expect(m.flowIdsDerived).toEqual([{ from: 'flow:list-orders', to: 'flow:http.get-orders', areaId: 'area-001' }]);
  });
});

describe('one coverage bucket per fact entry point', () => {
  it('puts every entry point in exactly one bucket and lists the silent ones', async () => {
    const { root, manifest, output } = prepare();
    const { exitCode, coverage, stdout } = await merge(root, output, areaOutput([
      { name: 'orders', files: ['svc/orders/handlers.go'], ids: [IDS.getOrders] },
    ], {
      token: manifest.token,
      skippedEntryPoints: [
        { id: IDS.health, reason: 'Health check, no business behaviour.' },
        { id: 'ep:http.get-nowhere', reason: 'x' },
        { id: IDS.invoices, reason: '  ' },
      ],
      skippedModules: [{ module: 'web/pages', reason: 'Pages are covered by the backend flows.' }],
    }));
    expect(exitCode).toBe(0);
    const epc = coverage.entryPointCoverage;
    const bucketOf = Object.fromEntries(epc.rows.map((r) => [r.id, r.bucket]));
    expect(bucketOf).toEqual({
      [IDS.getOrders]: 'in-flow',
      [IDS.postOrders]: 'in-flow',
      [IDS.health]: 'declared-skip',
      [IDS.invoices]: 'silent',
      [IDS.profile]: 'declared-skip',
    });
    expect(epc).toMatchObject({
      total: 5, ok: true,
      buckets: { 'in-flow': 2, 'declared-skip': 2, silent: 1, 'area-not-accepted': 0, 'outside-areas': 0 },
      inFlowBy: { cited: 1, group: 1 },
      declaredBy: { 'entry-point': 1, module: 1 },
      skippedEntryPointsUnknown: 1,
      skippedEntryPointsWithoutReason: 1,
      silent: [IDS.invoices],
    });
    expect(epc.rows.find((r) => r.id === IDS.postOrders).flow).toBe('flow:http.get-orders');
    expect(stdout).toContain('entry-point coverage total=5 in-flow=2 declared-skip=2 silent=1 area-not-accepted=0 outside-areas=0');
    expect(stdout).toContain(`silent-entry-point ${IDS.invoices} GET /invoices area=area-001`);
  });

  it('counts the entry points of an area that was not accepted, and those outside every module', async () => {
    const { root, manifest, output } = prepare();
    const manifestPath = join(root, '.excavator/intermediate/domain-areas/manifest.json');
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, entryPointsOutsideModules: ['ep:http.get-gone'] }));
    const { exitCode, coverage } = await merge(root, output, { not: 'an area output' });
    expect(exitCode).toBe(3);
    expect(coverage.entryPointCoverage).toMatchObject({
      total: 6, ok: true, buckets: { 'in-flow': 0, 'declared-skip': 0, silent: 0, 'area-not-accepted': 5, 'outside-areas': 1 },
    });
  });

  it('keeps a module with nothing to skip in no-candidates when an analyzer declares it skipped', async () => {
    const { root, manifest, output } = prepare();
    const { coverage } = await merge(root, output, areaOutput([], {
      token: manifest.token,
      skippedModules: [
        { module: 'svc/templates', reason: 'Mail templates only.' },
        { module: 'svc/billing', reason: 'Read-only listing.' },
      ],
    }));
    const statusOf = Object.fromEntries(coverage.modules.map((m) => [m.path, m.status]));
    expect(statusOf['svc/templates']).toBe('no-candidates');
    expect(statusOf['svc/billing']).toBe('declared-skip');
    expect(coverage.merge.skippedModulesWithoutCandidates).toBe(1);
  });

  it('puts a module in declared-skip when each of its entry points is declared skipped, and not when one has no reason', async () => {
    const { root, manifest, output } = prepare();
    const skipped = await merge(root, output, areaOutput([], {
      token: manifest.token,
      skippedEntryPoints: [{ id: IDS.invoices, reason: 'Read-only listing.' }],
    }));
    const billing = skipped.coverage.modules.find((m) => m.path === 'svc/billing');
    expect(billing).toMatchObject({ status: 'declared-skip', skippedBy: 'entry-points', skipReason: 'every entry point declared skipped' });
    expect(skipped.coverage.merge.modulesSkippedByEntryPoints).toBe(1);
    expect(skipped.stdout).not.toContain('silent-zero svc/billing');

    const unexplained = await merge(root, output, areaOutput([], {
      token: manifest.token,
      skippedEntryPoints: [{ id: IDS.invoices, reason: ' ' }],
    }));
    expect(unexplained.coverage.modules.find((m) => m.path === 'svc/billing').status).toBe('silent-zero');
    expect(unexplained.coverage.merge.modulesSkippedByEntryPoints).toBe(0);
  });

  describe('a module with a script entry point and an entry point the analyzer added', () => {
    // svc/billing gets a second route the facts do not know: an unrecognised file.
    const STATUS = { 'svc/billing/status.go': 'package billing\n\nfunc routes(e E) {\n\te.GET("/billing/status", status)\n}\n' };
    const status = (over = {}) => ({
      file: 'svc/billing/status.go', line: 4, method: 'GET', path: '/billing/status', quote: 'e.GET("/billing/status", status)', ...over,
    });
    const invoicesSkipped = [{ id: IDS.invoices, reason: 'Read-only listing.' }];
    const billingOf = (coverage) => coverage.modules.find((m) => m.path === 'svc/billing');

    it('is declared-skip only when the script and the added entry point each have a reason', async () => {
      const { root, manifest, context, output } = prepare({ extraFiles: STATUS });
      expect(context.unrecognisedFiles.map((u) => u.file)).toEqual(['svc/billing/status.go']);
      const both = await merge(root, output, areaOutput([], {
        token: manifest.token, skippedEntryPoints: invoicesSkipped, entryPoints: [status({ skipReason: 'Status probe.' })],
      }));
      expect(billingOf(both.coverage)).toMatchObject({
        status: 'declared-skip', skippedBy: 'entry-points', entryPoints: { script: 1, pattern: 0, model: 1 }, unrecognisedFiles: 1,
      });

      const modelUnexplained = await merge(root, output, areaOutput([], {
        token: manifest.token, skippedEntryPoints: invoicesSkipped, entryPoints: [status()],
      }));
      expect(billingOf(modelUnexplained.coverage).status).toBe('silent-zero');

      const scriptUnexplained = await merge(root, output, areaOutput([], {
        token: manifest.token, entryPoints: [status({ skipReason: 'Status probe.' })],
      }));
      expect(billingOf(scriptUnexplained.coverage).status).toBe('silent-zero');
      expect(scriptUnexplained.coverage.entryPointCoverage.silent).toContain(IDS.invoices);
    });
  });

  it('counts a module as covered when a flow starts at one of its entry points but has no step in it', async () => {
    const { root, manifest, output } = prepare();
    const { coverage, stdout } = await merge(root, output, areaOutput([
      { name: 'invoices', files: ['svc/routes.go'], ids: [IDS.invoices] },
    ], { token: manifest.token }));
    const billing = coverage.modules.find((m) => m.path === 'svc/billing');
    expect(billing).toMatchObject({ status: 'covered', coveredBy: 'entry-points', flows: 0 });
    expect(coverage.merge.modulesCoveredByEntryPoints).toBe(1);
    expect(coverage.entryPointCoverage.rows.find((r) => r.id === IDS.invoices).bucket).toBe('in-flow');
    expect(stdout).not.toContain('silent-zero svc/billing');
  });

  it('fails conservation when an area context is missing, so its entry points reach no bucket', async () => {
    const { root, manifest, output } = prepare();
    rmSync(join(root, '.excavator/intermediate/domain-areas/area-001.context.json'));
    writeFileSync(output, JSON.stringify(areaOutput([], { token: manifest.token })));
    const out = [];
    const { exitCode } = await runMerge({ projectRoot: root, stdout: (t) => out.push(t), stderr: (t) => out.push(t) });
    expect(exitCode).toBe(4);
    expect(out.join('')).toContain('conservation FAILED');
  });

  it('fails the bucket check when fewer entry points reach a bucket than the split counted', () => {
    const manifest = {
      modules: [{ path: 'svc', files: ['svc/routes.go'], areas: ['area-001'], entryPoints: 2, scriptEntryPoints: 2 }],
      areas: [{ areaId: 'area-001' }],
    };
    const coverage = computeCoverage({
      manifest,
      areaResults: [{ areaId: 'area-001', status: 'accepted', graph: {} }],
      merged: { nodes: [], edges: [] },
      entriesOf: new Map([['area-001', [{ id: IDS.health, group: IDS.health, file: 'svc/routes.go', method: 'GET', path: '/health', type: 'http' }]]]),
    });
    expect(coverage.entryPointCoverage).toMatchObject({ total: 1, expected: 2, ok: false });
  });

  it('fails the bucket check when one id is counted twice', () => {
    const entry = { id: IDS.health, group: IDS.health, file: 'svc/routes.go', method: 'GET', path: '/health', type: 'http' };
    const manifest = {
      modules: [{ path: 'svc', files: ['svc/routes.go'], areas: ['area-001', 'area-002'], entryPoints: 1, scriptEntryPoints: 1 }],
      areas: [{ areaId: 'area-001' }, { areaId: 'area-002' }],
    };
    const coverage = computeCoverage({
      manifest,
      areaResults: [{ areaId: 'area-001', status: 'accepted', graph: {} }, { areaId: 'area-002', status: 'accepted', graph: {} }],
      merged: { nodes: [], edges: [] },
      entriesOf: new Map([['area-001', [entry]], ['area-002', [entry]]]),
    });
    expect(coverage.entryPointCoverage).toMatchObject({ total: 1, ok: false, buckets: { silent: 2 } });
  });
});
