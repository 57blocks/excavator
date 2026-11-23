/**
 * The choice check at area acceptance. A flow that starts in a choose module
 * (marked mixed in the plan, or assigned to a support domain) must carry a
 * plan domain id in `domainMeta.domain` and a `domainMeta.domainReason`, or
 * its area is `rejected-choice` and the analyzer is sent back to choose. The
 * merge's fallback (module domain, counted as fallbackMissing /
 * support-unchosen) stays as a backstop, reached only by an area accepted
 * without passing this check (`--accept-unchosen`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acceptOutput, checkChoices, choiceLines, mergeAreas, runMerge,
} from '../../skills/excavator-domain/merge-domain-areas.mjs';
import { PLAN_FORMAT, moduleSetDigest } from '../../skills/excavator-domain/plan-domains.mjs';
import { AREA_MODULES, MIXED_AREAS, writeMixedLegacyProject } from '../fixtures/domain-areas/mixed-legacy.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXTRACT = resolve(repoRoot, 'skills/excavator-domain/extract-domain-context.py');
const SPLIT = resolve(repoRoot, 'skills/excavator-domain/split-domain-areas.mjs');

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

const T = 'c'.repeat(32);

/** A stored plan: `assign` is { modulePath: domainId }; `kinds` overrides the default business kind. */
function planFrom(assign, { kinds = {}, mixed = [] } = {}) {
  const ids = [...new Set(Object.values(assign))];
  return {
    format: PLAN_FORMAT,
    moduleSetDigest: moduleSetDigest(Object.keys(assign)),
    modules: Object.fromEntries(Object.keys(assign).sort().map((k) => [k, assign[k]])),
    mixed: [...mixed].sort(),
    domains: ids.map((id) => ({ id, kind: kinds[id] ?? 'business', name: id.slice(7), summary: `${id} summary`, tags: ['t'] })),
    crossDomain: [],
    history: [],
  };
}

/** An area output; each flow is { name, files, module?, domain?, domainReason? } with one step per file. */
function areaOutput(flows, { areaId = 'area-001', token = T } = {}) {
  const nodes = [];
  const edges = [];
  for (const flow of flows) {
    const id = `flow:${flow.name}`;
    const meta = { entryPoint: 'POST /x', entryType: 'http' };
    for (const key of ['module', 'domain', 'domainReason']) if (flow[key] !== undefined) meta[key] = flow[key];
    nodes.push({ id, type: 'flow', name: flow.name, summary: 's', tags: ['t'], complexity: 'simple', domainMeta: meta });
    flow.files.forEach((file, i) => {
      const stepId = `step:${flow.name}:s${i + 1}`;
      nodes.push({ id: stepId, type: 'step', name: `s${i + 1}`, summary: 's', tags: ['t'], complexity: 'simple', ...(file ? { filePath: file } : {}) });
      edges.push({ source: id, target: stepId, type: 'flow_step', direction: 'forward', weight: Math.min(1, (i + 1) / 10) });
    });
  }
  return { version: '1.0.0', project: { name: 'fixture' }, nodes, edges, layers: [], tour: [], areaRun: { areaId, token } };
}

describe('checkChoices and acceptOutput', () => {
  const manifest = {
    token: T,
    areas: [{ areaId: 'area-001' }],
    modules: [
      { path: 'api/orders', files: ['api/orders/controller.js'], entryPoints: 1, areas: ['area-001'] },
      { path: 'legacy/routes', files: ['legacy/routes/orders.js', 'legacy/routes/invoices.js'], entryPoints: 2, areas: ['area-001'] },
      { path: 'jobs/cmd', files: ['jobs/cmd/remind.js', 'jobs/cmd/rotate.js'], entryPoints: 2, areas: ['area-001'] },
    ],
  };
  const plan = planFrom(
    { 'api/orders': 'domain:ordering', 'legacy/routes': 'domain:ordering', 'jobs/cmd': 'domain:infra' },
    { kinds: { 'domain:infra': 'support' }, mixed: ['legacy/routes'] },
  );
  plan.domains.push({ id: 'domain:billing', kind: 'business', name: 'billing', summary: 's', tags: ['t'] });
  const choice = { plan, manifest };
  const accept = (graph, extra = {}) => acceptOutput({ token: T, areaId: 'area-001', text: JSON.stringify(graph), choice, ...extra });

  it('rejects a mixed-module flow without a choice, naming the flow and the allowed domain ids', () => {
    const r = accept(areaOutput([{ name: 'v1-issue-invoice', files: ['legacy/routes/invoices.js'] }]));
    expect(r.status).toBe('rejected-choice');
    expect(r.problems).toEqual([{ flow: 'flow:v1-issue-invoice', module: 'legacy/routes', problem: 'missing' }]);
    expect(r.allowed).toEqual(['domain:ordering', 'domain:infra', 'domain:billing']);
    expect(r.reason).toContain('flow:v1-issue-invoice');
    expect(r.reason).toContain('allowed: domain:ordering, domain:infra, domain:billing');
    expect(choiceLines('area-001', r)).toEqual([
      'rejected-choice area-001 flow:v1-issue-invoice module=legacy/routes problem=missing allowed=domain:ordering,domain:infra,domain:billing',
    ]);
  });

  it('accepts the same flow once it carries a plan domain id and a reason', () => {
    const r = accept(areaOutput([{ name: 'v1-issue-invoice', files: ['legacy/routes/invoices.js'], domain: 'domain:billing', domainReason: 'Issues an invoice.' }]));
    expect(r.status).toBe('accepted');
    expect(r.unchosen).toBeUndefined();
    expect(choiceLines('area-001', r)).toEqual([]);
  });

  it('rejects a support-module flow whose choice is not a plan id or gives no reason', () => {
    const r = accept(areaOutput([
      { name: 'remind', files: ['jobs/cmd/remind.js'], domain: 'domain:nowhere', domainReason: 'Reminds.' },
      { name: 'rotate', files: ['jobs/cmd/rotate.js'], domain: 'domain:infra', domainReason: '   ' },
      { name: 'purge', module: 'jobs/cmd', files: [null] },
    ]));
    expect(r.status).toBe('rejected-choice');
    expect(r.problems).toEqual([
      { flow: 'flow:remind', module: 'jobs/cmd', problem: 'invalid', chosen: 'domain:nowhere' },
      { flow: 'flow:rotate', module: 'jobs/cmd', problem: 'no-reason' },
      { flow: 'flow:purge', module: 'jobs/cmd', problem: 'missing' },
    ]);
    expect(choiceLines('area-001', r)[0]).toContain('problem=invalid chosen="domain:nowhere" allowed=');
  });

  it('does not ask for a choice where the module decides or the flow has no home', () => {
    const r = accept(areaOutput([
      { name: 'create-order', files: ['api/orders/controller.js'] },
      { name: 'floating', files: ['elsewhere/x.js'] },
    ]));
    expect(r.status).toBe('accepted');
  });

  it('homes the check the way the merge homes the flow: the first locatable step decides the module', () => {
    const graph = areaOutput([{ name: 'starts-clean', files: ['api/orders/controller.js', 'legacy/routes/orders.js'] }]);
    expect(checkChoices({ graph, areaId: 'area-001', plan, manifest }).problems).toEqual([]);
    const reversed = areaOutput([{ name: 'starts-mixed', files: ['legacy/routes/orders.js', 'api/orders/controller.js'] }]);
    expect(checkChoices({ graph: reversed, areaId: 'area-001', plan, manifest }).problems.map((p) => p.flow)).toEqual(['flow:starts-mixed']);
  });

  it('accepts a failing output only with allowUnchosen, recording its flows', () => {
    const graph = areaOutput([{ name: 'v1-cancel-order', files: ['legacy/routes/orders.js'] }]);
    const r = accept(graph, { allowUnchosen: true });
    expect(r.status).toBe('accepted');
    expect(r.unchosen).toEqual([{ flow: 'flow:v1-cancel-order', module: 'legacy/routes', problem: 'missing' }]);
  });

  it('keeps the stale and parse checks ahead of the choice check', () => {
    const stale = areaOutput([{ name: 'v1', files: ['legacy/routes/orders.js'] }], { token: 'd'.repeat(32) });
    expect(accept(stale).status).toBe('rejected-stale');
    expect(acceptOutput({ token: T, areaId: 'area-001', text: '{', choice }).status).toBe('rejected-parse');
  });

  it('leaves the merge fallback unreachable for an area that passes the check', () => {
    const passing = areaOutput([
      { name: 'v1-issue-invoice', files: ['legacy/routes/invoices.js'], domain: 'domain:billing', domainReason: 'Issues an invoice.' },
      { name: 'rotate', files: ['jobs/cmd/rotate.js'], domain: 'domain:infra', domainReason: 'Log rotation has no business behaviour.' },
      { name: 'create-order', files: ['api/orders/controller.js'] },
    ]);
    expect(accept(passing).status).toBe('accepted');
    const { merge } = mergeAreas({ accepted: [{ areaId: 'area-001', graph: passing }], plan, manifest });
    expect(merge.flowHoming).toMatchObject({ fallbackMissing: 0, fallbackInvalid: 0, choicesWithoutReason: 0, byChoice: 2, byModule: 1 });
    expect(merge.flowHoming.support).toMatchObject({ total: 1, chosen: 1, unchosen: 0 });

    const failing = areaOutput([{ name: 'v1-cancel-order', files: ['legacy/routes/orders.js'] }]);
    expect(accept(failing).status).toBe('rejected-choice');
    const overridden = accept(failing, { allowUnchosen: true });
    const after = mergeAreas({ accepted: [{ areaId: 'area-001', graph: overridden.graph }], plan, manifest });
    expect(after.merge.flowHoming).toMatchObject({ fallbackMissing: 1 });
  });
});

/**
 * The mixed legacy fixture, extracted and split into one area. The plan puts
 * each clean API module in its area's business domain, marks the legacy
 * routes and services directories mixed (homed in the first area's domain)
 * and puts every other module in a support domain.
 */
function prepareMixed() {
  const root = mkdtempSync(join(tmpdir(), 'domain-choice-'));
  roots.push(root);
  writeMixedLegacyProject(root);
  const ex = spawnSync('python3', [EXTRACT, root], { encoding: 'utf-8' });
  if (ex.error) throw ex.error;
  expect(ex.status, ex.stderr).toBe(0);
  const sp = spawnSync(process.execPath, [SPLIT, root, '--budget-bytes', '10000000', '--max-entry-points', '100000'], { encoding: 'utf-8' });
  expect(sp.status, sp.stderr).toBe(0);
  const areasDir = join(root, '.excavator/intermediate/domain-areas');
  const manifest = JSON.parse(readFileSync(join(areasDir, 'manifest.json'), 'utf-8'));
  expect(manifest.areas).toHaveLength(1);
  const mixed = ['services/legacy/routes', 'services/legacy/services'];
  const domainOfArea = Object.fromEntries(Object.entries(AREA_MODULES).map(([area, module]) => [module, `domain:${area}`]));
  const assign = Object.fromEntries(manifest.modules.map((m) => [
    m.path,
    domainOfArea[m.path] ?? (mixed.includes(m.path) ? `domain:${MIXED_AREAS[0]}` : 'domain:shared'),
  ]));
  const plan = planFrom(assign, { kinds: { 'domain:shared': 'support' }, mixed });
  mkdirSync(join(root, '.excavator'), { recursive: true });
  writeFileSync(join(root, '.excavator/domain-plan.json'), JSON.stringify(plan));
  const context = JSON.parse(readFileSync(join(areasDir, 'area-001.context.json'), 'utf-8'));
  return { root, manifest, plan, context, output: join(areasDir, 'area-001.analysis.json') };
}

describe('choice check on the mixed legacy fixture', () => {
  const area = MIXED_AREAS[1];
  const flowFrom = (extra = {}) => ({ name: `legacy-${area}`, files: [`services/legacy/routes/${area}.js`, `services/legacy/services/${area}-service.js`], ...extra });

  function runCheckCommand(context) {
    const result = spawnSync('sh', ['-c', context.check], { encoding: 'utf-8' });
    if (result.error) throw result.error;
    return result;
  }

  it('gives every area context the command that checks its output', () => {
    const { context } = prepareMixed();
    expect(context.check).toMatch(/merge-domain-areas\.mjs' '.+' --check area-001$/);
  });

  it('rejects a mixed-routes flow without a choice, at the check and at the merge, with no fallback', async () => {
    const { root, manifest, plan, context, output } = prepareMixed();
    writeFileSync(output, JSON.stringify(areaOutput([flowFrom()], { token: manifest.token })));

    const check = runCheckCommand(context);
    expect(check.status, check.stderr).toBe(3);
    const allowed = plan.domains.map((d) => d.id).join(',');
    expect(check.stdout).toContain(`rejected-choice area-001 flow:legacy-${area} module=services/legacy/routes problem=missing allowed=${allowed}`);

    const out = [];
    const { exitCode } = await runMerge({ projectRoot: root, stdout: (t) => out.push(t), stderr: () => {} });
    expect(exitCode).toBe(3);
    const coverage = JSON.parse(readFileSync(join(root, '.excavator/reports/domain-coverage.json'), 'utf-8'));
    expect(coverage.areas[0].status).toBe('rejected-choice');
    expect(coverage.totals.flows).toBe(0);
    expect(coverage.flows.fallback).toEqual({ missing: 0, invalid: 0 });
    expect(out.join('')).toContain(`rejected-choice area-001 flow:legacy-${area} module=services/legacy/routes problem=missing`);
  });

  it('accepts the same flow with a choice and a reason, and homes it on the chosen domain', async () => {
    const { root, manifest, context, output } = prepareMixed();
    const chosen = flowFrom({ domain: `domain:${area}`, domainReason: `Changes ${area} records.` });
    writeFileSync(output, JSON.stringify(areaOutput([chosen], { token: manifest.token })));

    const check = runCheckCommand(context);
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout.trim()).toBe('area-001 accepted');

    const { exitCode } = await runMerge({ projectRoot: root, stdout: () => {}, stderr: () => {} });
    expect(exitCode).toBe(0);
    const coverage = JSON.parse(readFileSync(join(root, '.excavator/reports/domain-coverage.json'), 'utf-8'));
    expect(coverage.areas[0].status).toBe('accepted');
    expect(coverage.flows).toMatchObject({ byChoice: 1, fallback: { missing: 0, invalid: 0 }, support: { unchosen: 0 } });
    const merged = JSON.parse(readFileSync(join(root, '.excavator/intermediate/domain-analysis.json'), 'utf-8'));
    expect(merged.edges.find((e) => e.type === 'contains_flow' && e.target === `flow:legacy-${area}`).source).toBe(`domain:${area}`);
  });

  it('reaches the fallback only when the merge accepts the area without the check', async () => {
    const { root, manifest, output } = prepareMixed();
    writeFileSync(output, JSON.stringify(areaOutput([flowFrom()], { token: manifest.token })));
    const out = [];
    const { exitCode } = await runMerge({ projectRoot: root, acceptUnchosen: true, stdout: (t) => out.push(t), stderr: () => {} });
    expect(exitCode).toBe(0);
    const coverage = JSON.parse(readFileSync(join(root, '.excavator/reports/domain-coverage.json'), 'utf-8'));
    expect(coverage.areas[0]).toMatchObject({ status: 'accepted', unchosen: [{ flow: `flow:legacy-${area}`, module: 'services/legacy/routes', problem: 'missing' }] });
    expect(coverage.flows).toMatchObject({ byChoice: 0, fallback: { missing: 1, invalid: 0 } });
    expect(out.join('')).toMatch(/area-001 accepted .* unchosen=1/);
    expect(out.join('')).toContain(`fallback flow:legacy-${area} module=services/legacy/routes reason=missing`);
  });
});
