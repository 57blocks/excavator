/**
 * plan-domains.mjs — the module -> domain partition is decided once per
 * project and reused while the module set is unchanged.
 *
 * Before this, every area analyzer named its own domains, so the domain count
 * grew with the area count and the partition drifted between runs. The script
 * never writes a domain; these tests pin what it does own: the planner input
 * shape, the checks that gate an accepted plan, and the reuse rules.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PLAN_FORMAT, PLAN_INPUT_FORMAT, PLAN_FILE, SAMPLE_LIMITS, EXIT_REJECTED,
  moduleSetDigest, maxBusinessDomains, reconcilePlan, buildPlanInput, acceptPlan,
} from '../../skills/excavator-domain/plan-domains.mjs';
import { writeMultiModuleProject } from '../fixtures/domain-areas/multi-module.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXTRACT = resolve(repoRoot, 'skills/excavator-domain/extract-domain-context.py');
const SPLIT = resolve(repoRoot, 'skills/excavator-domain/split-domain-areas.mjs');
const PLAN = resolve(repoRoot, 'skills/excavator-domain/plan-domains.mjs');

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});
function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'domain-plan-'));
  roots.push(dir);
  return dir;
}

const NOW = new Date('2026-11-23T10:00:00Z');
const paths = (n) => Array.from({ length: n }, (_, i) => `src/m${String(i + 1).padStart(3, '0')}`);

/** A manifest and context for `modulePaths`, one file with one entry point and one export each. */
function material(modulePaths) {
  const manifest = { token: 't'.repeat(32), modules: [], areas: [] };
  const context = { entryPoints: [], fileSignatures: [] };
  for (const path of modulePaths) {
    const file = `${path}/index.js`;
    manifest.modules.push({ path, files: [file], entryPoints: 1, candidateFiles: [file], areas: ['area-001'] });
    context.entryPoints.push({ file, line: 1, type: 'http', description: 'route', match: `router.get('/${path}'` });
    context.fileSignatures.push({ file, exports: [`run_${path.replace(/\W/g, '_')}`] });
  }
  return { manifest, context };
}

const dom = (id, kind = 'business', extra = {}) => ({ id, kind, name: id.slice(7), summary: `${id} summary`, ...extra });
const input = (modulePaths, over = {}) => {
  const { manifest, context } = material(modulePaths);
  return buildPlanInput({ manifest, context, token: manifest.token, mode: 'new', plan: null, unassigned: modulePaths, outputPath: '/abs/plan.output.json', ...over });
};
const goodOutput = (inp, extra = {}) => ({
  planRun: { token: inp.planRun.token },
  domains: [dom('domain:alpha'), dom('domain:beta'), dom('domain:shared', 'support')],
  assignments: Object.fromEntries(inp.modules.map((m, i) => [m.path, i % 3 === 0 ? 'domain:alpha' : i % 3 === 1 ? 'domain:beta' : 'domain:shared'])),
  crossDomain: [{ source: 'domain:alpha', target: 'domain:beta', description: 'alpha calls beta' }],
  ...extra,
});

describe('pure helpers', () => {
  it('digests the sorted module paths, independent of input order', () => {
    expect(moduleSetDigest(['b', 'a'])).toBe(moduleSetDigest(['a', 'b']));
    expect(moduleSetDigest(['a', 'b'])).not.toBe(moduleSetDigest(['a', 'c']));
    expect(moduleSetDigest(['a', 'b'])).toMatch(/^[0-9a-f]{64}$/);
  });
  it('bounds business domains by max(3, ceil(sqrt(modules)))', () => {
    expect(maxBusinessDomains(1)).toBe(3);
    expect(maxBusinessDomains(9)).toBe(3);
    expect(maxBusinessDomains(88)).toBe(10);
    expect(maxBusinessDomains(290)).toBe(18);
  });
});

describe('O1 plan input', () => {
  it('lists every module once with exact omitted counts and is deterministic', () => {
    const big = 'src/big';
    const manifest = {
      token: 't'.repeat(32),
      modules: [
        { path: big, files: Array.from({ length: 25 }, (_, i) => `${big}/f${String(i).padStart(2, '0')}.js`), entryPoints: 10, areas: ['area-001'] },
        { path: 'src/small', files: ['src/small/a.js'], entryPoints: 0, areas: ['area-001'] },
      ],
    };
    const context = {
      entryPoints: Array.from({ length: 10 }, (_, i) => ({ file: `${big}/f00.js`, line: i + 1, type: 'http', description: 'desc', match: `router.get('/${i}'` })),
      fileSignatures: [
        { file: `${big}/f00.js`, exports: Array.from({ length: 10 }, (_, i) => `e${i}`) },
        { file: `${big}/f01.js`, exports: ['e5', 'x10', 'x11', 'x12', 'x13'] },
      ],
    };
    const build = (token) => buildPlanInput({ manifest, context, token, mode: 'new', plan: null, unassigned: [big, 'src/small'], outputPath: '/abs/o.json' });
    const a = build('t1');
    const row = a.modules[0];
    expect(a.modules.map((m) => m.path)).toEqual([big, 'src/small']);
    expect(row.files).toBe(25);
    expect(row.fileNames).toHaveLength(SAMPLE_LIMITS.fileNames);
    expect(row.fileNamesOmitted).toBe(5);
    expect(row.entryPoints).toBe(10);
    expect(row.entrySamples).toHaveLength(8);
    expect(row.entrySamplesOmitted).toBe(2);
    expect(row.exports).toHaveLength(12);
    expect(row.exportsOmitted).toBe(2); // 14 unique names (e5 repeats), 12 shown
    expect(row.assigned).toBeNull();
    expect(a.format).toBe(PLAN_INPUT_FORMAT);
    expect(a.limits).toEqual({ maxBusinessDomains: 3, maxSupportDomains: 3 });
    expect(a.output).toBe('/abs/o.json');
    expect(a.domains).toEqual([]);
    expect(a.modules[1]).toMatchObject({ files: 1, entryPoints: 0, entrySamples: [], entrySamplesOmitted: 0, exports: [], exportsOmitted: 0 });
    const b = build('t2');
    expect({ ...b, planRun: a.planRun }).toEqual(a);
    expect(b.planRun.token).toBe('t2');
  });
  it('cuts long entry samples and falls back to the description', () => {
    const manifest = { token: 't', modules: [{ path: 'm', files: ['m/a.js'], entryPoints: 2, areas: [] }] };
    const context = {
      entryPoints: [
        { file: 'm/a.js', line: 2, type: 'cron', description: 'scheduled job' },
        { file: 'm/a.js', line: 1, type: 'http', description: 'd', match: `  ${'x'.repeat(300)}  ` },
      ],
      fileSignatures: [],
    };
    const row = buildPlanInput({ manifest, context, token: 't', mode: 'new', plan: null, unassigned: ['m'], outputPath: '/o' }).modules[0];
    expect(row.entrySamples).toEqual(['x'.repeat(120), 'scheduled job']);
  });
  it('marks assigned modules and carries the domains in extend mode', () => {
    const { manifest, context } = material(['a', 'b']);
    const plan = { domains: [dom('domain:alpha')], modules: { a: 'domain:alpha' } };
    const inp = buildPlanInput({ manifest, context, token: 't', mode: 'extend', plan, unassigned: ['b'], outputPath: '/o' });
    expect(inp.mode).toBe('extend');
    expect(inp.modules.map((m) => m.assigned)).toEqual(['domain:alpha', null]);
    expect(inp.domains).toEqual(plan.domains);
  });
});

describe('O2 acceptPlan', () => {
  const ps = paths(9);
  const inp = () => input(ps);
  const reasonsOf = (r) => (r.ok ? [] : r.reasons.join('\n'));

  it('accepts a valid plan and writes sorted module keys, history and counts dropped cross-domain', () => {
    const i = inp();
    const out = goodOutput(i, {
      crossDomain: [
        { source: 'domain:alpha', target: 'domain:beta', description: 'ok' },
        { source: 'domain:alpha', target: 'domain:alpha', description: 'self' },
        { source: 'domain:alpha', target: 'domain:ghost', description: 'ghost' },
        { source: 'domain:beta', target: 'domain:alpha' },
      ],
    });
    out.assignments = Object.fromEntries(Object.entries(out.assignments).reverse());
    const r = acceptPlan({ input: i, output: out, plan: null, now: NOW });
    expect(r.ok).toBe(true);
    expect(r.dropped).toEqual({ crossDomain: 3 });
    expect(r.plan.format).toBe(PLAN_FORMAT);
    expect(r.plan.moduleSetDigest).toBe(moduleSetDigest(ps));
    expect(Object.keys(r.plan.modules)).toEqual([...ps].sort());
    expect(r.plan.domains.map((d) => d.id)).toEqual(['domain:alpha', 'domain:beta', 'domain:shared']);
    expect(r.plan.domains[0]).toEqual({ id: 'domain:alpha', kind: 'business', name: 'alpha', summary: 'domain:alpha summary', tags: [], entities: [], businessRules: [] });
    expect(r.plan.crossDomain).toEqual([{ source: 'domain:alpha', target: 'domain:beta', description: 'ok' }]);
    expect(r.plan.history).toEqual([{ mode: 'new', at: NOW.toISOString(), modules: 9, planned: 9 }]);
    expect(PLAN_FILE).toBe('domain-plan.json');
  });

  const rejectCases = [
    ['missing module', (o) => { delete o.assignments[ps[0]]; }, ps[0]],
    ['unknown module', (o) => { o.assignments['src/unknown'] = 'domain:alpha'; }, 'src/unknown'],
    ['undeclared domain', (o) => { o.assignments[ps[0]] = 'domain:nowhere'; }, 'domain:nowhere'],
    ['empty new domain', (o) => { o.domains.push(dom('domain:empty')); }, 'domain:empty'],
    ['support over limit', (o) => {
      o.domains = [dom('domain:alpha'), ...[1, 2, 3, 4].map((n) => dom(`domain:s${n}`, 'support'))];
      ps.forEach((p, k) => { o.assignments[p] = k === 0 ? 'domain:alpha' : `domain:s${((k - 1) % 4) + 1}`; });
    }, 'support'],
    ['wrong token', (o) => { o.planRun.token = 'stale'; }, 'token'],
    ['bad id', (o) => { o.domains[0].id = 'domain:Bad_Id'; o.assignments[ps[0]] = 'domain:Bad_Id'; }, 'domain:Bad_Id'],
    ['bad kind', (o) => { o.domains[0].kind = 'misc'; }, 'kind'],
    ['empty name', (o) => { o.domains[0].name = ' '; }, 'name'],
    ['duplicate id', (o) => { o.domains.push(dom('domain:alpha')); }, 'duplicate'],
    ['bad tags', (o) => { o.domains[0].tags = 'x'; }, 'tags'],
  ];
  for (const [label, mutate, mention] of rejectCases) {
    it(`rejects: ${label}`, () => {
      const i = inp();
      const out = goodOutput(i);
      mutate(out);
      const r = acceptPlan({ input: i, output: out, plan: null, now: NOW });
      expect(r.ok, label).toBe(false);
      expect(reasonsOf(r)).toContain(mention);
    });
  }

  it('rejects 11 business domains for 88 modules and states the limit 10', () => {
    const many = paths(88);
    const i = input(many);
    const domains = Array.from({ length: 11 }, (_, k) => dom(`domain:d${k}`));
    const assignments = Object.fromEntries(many.map((p, k) => [p, `domain:d${k % 11}`]));
    const r = acceptPlan({ input: i, output: { planRun: i.planRun, domains, assignments }, plan: null, now: NOW });
    expect(r.ok).toBe(false);
    expect(reasonsOf(r)).toMatch(/11.*10|10.*11/);
    // 10 business domains for the same modules are fine
    const ok = acceptPlan({ input: i, output: { planRun: i.planRun, domains: domains.slice(0, 10), assignments: Object.fromEntries(many.map((p, k) => [p, `domain:d${k % 10}`])) }, plan: null, now: NOW });
    expect(ok.ok).toBe(true);
  });

  it('collects all reasons instead of stopping at the first', () => {
    const i = inp();
    const out = goodOutput(i);
    delete out.assignments[ps[0]];
    out.assignments['src/unknown'] = 'domain:alpha';
    out.planRun.token = 'stale';
    const r = acceptPlan({ input: i, output: out, plan: null, now: NOW });
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects non-object output', () => {
    expect(acceptPlan({ input: inp(), output: null, plan: null, now: NOW }).ok).toBe(false);
    expect(acceptPlan({ input: inp(), output: [], plan: null, now: NOW }).ok).toBe(false);
  });

  describe('extend mode', () => {
    const base = {
      format: PLAN_FORMAT,
      moduleSetDigest: moduleSetDigest(['a', 'b']),
      modules: { a: 'domain:alpha', b: 'domain:beta' },
      domains: [dom('domain:alpha', 'business', { tags: ['t'] }), dom('domain:beta')],
      crossDomain: [{ source: 'domain:alpha', target: 'domain:beta', description: 'x' }],
      history: [{ mode: 'new', at: 'earlier', modules: 2, planned: 2 }],
    };
    const extendInput = () => {
      const { manifest, context } = material(['a', 'b', 'c']);
      return buildPlanInput({ manifest, context, token: manifest.token, mode: 'extend', plan: base, unassigned: ['c'], outputPath: '/o' });
    };
    it('adds only the new module, to an existing or a new domain, carrying the rest verbatim', () => {
      const i = extendInput();
      const r = acceptPlan({ input: i, output: { planRun: i.planRun, domains: [], assignments: { c: 'domain:beta' } }, plan: base, now: NOW });
      expect(r.ok).toBe(true);
      expect(r.plan.modules).toEqual({ a: 'domain:alpha', b: 'domain:beta', c: 'domain:beta' });
      expect(r.plan.domains).toEqual(base.domains);
      expect(r.plan.crossDomain).toEqual(base.crossDomain);
      expect(r.plan.history).toEqual([...base.history, { mode: 'extend', at: NOW.toISOString(), modules: 3, planned: 1 }]);
      const r2 = acceptPlan({ input: i, output: { planRun: i.planRun, domains: [dom('domain:gamma')], assignments: { c: 'domain:gamma' } }, plan: base, now: NOW });
      expect(r2.ok).toBe(true);
      expect(r2.plan.domains.map((d) => d.id)).toEqual(['domain:alpha', 'domain:beta', 'domain:gamma']);
    });
    it('rejects a change to an existing assignment', () => {
      const i = extendInput();
      const r = acceptPlan({ input: i, output: { planRun: i.planRun, domains: [], assignments: { c: 'domain:beta', a: 'domain:beta' } }, plan: base, now: NOW });
      expect(r.ok).toBe(false);
      expect(reasonsOf(r)).toContain('a');
    });
    it('rejects a new domain reusing an existing id', () => {
      const i = extendInput();
      const r = acceptPlan({ input: i, output: { planRun: i.planRun, domains: [dom('domain:alpha')], assignments: { c: 'domain:alpha' } }, plan: base, now: NOW });
      expect(r.ok).toBe(false);
      expect(reasonsOf(r)).toContain('domain:alpha');
    });
  });
});

// A project can shrink below the size its stored plan was made for: pruning
// keeps every domain that still holds a module, so the plan may hold more
// domains than the smaller project's limit. Extending such a plan must not
// fail on domains the planner cannot remove; only adding past the limit fails,
// and the reason says how to decide again.
describe('extend after a shrink', () => {
  const five = ['domain:a', 'domain:b', 'domain:c', 'domain:d', 'domain:e'];
  const ps = paths(10);
  const plan = {
    format: PLAN_FORMAT,
    moduleSetDigest: moduleSetDigest(ps),
    modules: Object.fromEntries(ps.map((p, i) => [p, five[i % 5]])),
    domains: five.map((id) => dom(id)),
    crossDomain: [],
    history: [],
  };
  const added = 'src/zzz';
  const build = () => {
    const { manifest, context } = material([...ps, added]);
    return buildPlanInput({ manifest, context, token: 't'.repeat(32), mode: 'extend', plan, unassigned: [added], outputPath: '/o' });
  };

  it('never sets the limit below the domains the plan already holds', () => {
    expect(maxBusinessDomains(11)).toBe(4);
    expect(build().limits.maxBusinessDomains).toBe(5);
  });

  it('accepts a new module assigned to an existing domain', () => {
    const inp = build();
    const r = acceptPlan({ input: inp, output: { planRun: inp.planRun, domains: [], assignments: { [added]: 'domain:a' } }, plan, now: NOW });
    expect(r.ok).toBe(true);
  });

  it('rejects adding a domain past the limit and names --replan', () => {
    const inp = build();
    const r = acceptPlan({ input: inp, output: { planRun: inp.planRun, domains: [dom('domain:f')], assignments: { [added]: 'domain:f' } }, plan, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.reasons.join('\n')).toMatch(/business domains: 6 exceeds the limit 5.*--replan/);
  });
});

describe('O3 reconcilePlan', () => {
  const stored = (modulePaths, over = {}) => {
    const modules = Object.fromEntries(modulePaths.map((p, i) => [p, i === modulePaths.length - 1 ? 'domain:beta' : 'domain:alpha']));
    return {
      format: PLAN_FORMAT,
      moduleSetDigest: moduleSetDigest(modulePaths),
      modules,
      domains: [dom('domain:alpha'), dom('domain:beta')],
      crossDomain: [{ source: 'domain:alpha', target: 'domain:beta', description: 'x' }],
      history: [],
      ...over,
    };
  };
  const ps = ['a', 'b', 'c'];

  it('reuses an unchanged module set untouched', () => {
    const s = stored(ps);
    const r = reconcilePlan({ stored: s, modulePaths: ps, replan: false });
    expect(r.mode).toBe('reused');
    expect(r.plan).toEqual(s);
    expect(r.unassigned).toEqual([]);
  });
  it('extends with only the new directory unassigned', () => {
    const s = stored(ps);
    const r = reconcilePlan({ stored: s, modulePaths: [...ps, 'd'], replan: false });
    expect(r.mode).toBe('extend');
    expect(r.unassigned).toEqual(['d']);
    expect(r.plan.modules).toEqual(s.modules);
    expect(r.plan.domains).toEqual(s.domains);
  });
  it('prunes a removed directory, drops the emptied domain and its cross-domain entries', () => {
    const s = stored(ps);
    const left = ['a', 'b'];
    const r = reconcilePlan({ stored: s, modulePaths: left, replan: false });
    expect(r.mode).toBe('reused');
    expect(r.plan.modules).toEqual({ a: 'domain:alpha', b: 'domain:alpha' });
    expect(r.plan.domains.map((d) => d.id)).toEqual(['domain:alpha']);
    expect(r.plan.crossDomain).toEqual([]);
    expect(r.plan.moduleSetDigest).toBe(moduleSetDigest(left));
    expect(r.pruned).toEqual({ modulesRemoved: ['c'], domainsEmptied: ['domain:beta'] });
  });
  it('removes one and adds one: extend over the pruned plan', () => {
    const r = reconcilePlan({ stored: stored(ps), modulePaths: ['a', 'b', 'z'], replan: false });
    expect(r.mode).toBe('extend');
    expect(r.unassigned).toEqual(['z']);
    expect(r.plan.domains.map((d) => d.id)).toEqual(['domain:alpha']);
  });
  it('replans everything on --replan', () => {
    const r = reconcilePlan({ stored: stored(ps), modulePaths: ps, replan: true });
    expect(r.mode).toBe('new');
    expect(r.plan).toBeNull();
    expect(r.unassigned).toEqual(ps);
    expect(r.reason).toMatch(/replan/);
  });
  it('treats missing or malformed stored plans as new, with a reason', () => {
    expect(reconcilePlan({ stored: null, modulePaths: ps, replan: false }).mode).toBe('new');
    const bad = [
      { ...stored(ps), format: 'other/9' },
      { ...stored(ps), modules: [] },
      { ...stored(ps), domains: {} },
      { ...stored(ps), modules: { a: 'domain:ghost', b: 'domain:alpha', c: 'domain:alpha' } },
    ];
    for (const s of bad) {
      const r = reconcilePlan({ stored: s, modulePaths: ps, replan: false });
      expect(r.mode).toBe('new');
      expect(r.unassigned).toEqual(ps);
      expect(r.reason).toBeTruthy();
    }
  });
});

describe('CLI end to end on the multi-module fixture', () => {
  function prepareProject() {
    const root = tempRoot();
    writeMultiModuleProject(root);
    const ex = spawnSync('python3', [EXTRACT, root], { encoding: 'utf-8' });
    if (ex.error) throw ex.error;
    expect(ex.status, ex.stderr).toBe(0);
    const sp = spawnSync(process.execPath, [SPLIT, root], { encoding: 'utf-8' });
    expect(sp.status, sp.stderr).toBe(0);
    const areasDir = join(root, '.excavator/intermediate/domain-areas');
    return { root, areasDir, planFile: join(root, '.excavator', PLAN_FILE) };
  }
  const run = (...args) => spawnSync(process.execPath, [PLAN, ...args], { encoding: 'utf-8' });

  it('prepare (new) -> accept -> prepare again is reused and writes no planner input', () => {
    const { root, areasDir, planFile } = prepareProject();
    const p1 = run('prepare', root);
    expect(p1.status, p1.stderr).toBe(0);
    expect(p1.stdout).toMatch(/^plan=new modules=\d+ toPlan=\d+ maxBusinessDomains=\d+ input=\S+ output=\S+/);
    const inp = JSON.parse(readFileSync(join(areasDir, 'plan.input.json'), 'utf-8'));
    expect(inp.output).toBe(join(areasDir, 'plan.output.json'));
    const manifest = JSON.parse(readFileSync(join(areasDir, 'manifest.json'), 'utf-8'));
    expect(inp.planRun.token).toBe(manifest.token);
    expect(inp.modules.map((m) => m.path)).toEqual(manifest.modules.map((m) => m.path));

    writeFileSync(join(areasDir, 'plan.output.json'), JSON.stringify(goodOutput(inp)));
    const a = run('accept', root);
    expect(a.status, a.stdout + a.stderr).toBe(0);
    expect(a.stdout).toMatch(/^plan accepted mode=new business=2 support=1 modules=\d+ crossDomainDropped=0/);
    const plan = JSON.parse(readFileSync(planFile, 'utf-8'));
    expect(Object.keys(plan.modules)).toEqual(Object.keys(plan.modules).sort());
    expect(Object.keys(plan.modules)).toHaveLength(manifest.modules.length);

    // The split wipes the areas dir; the plan lives in the data dir and survives.
    const sp = spawnSync(process.execPath, [SPLIT, root], { encoding: 'utf-8' });
    expect(sp.status, sp.stderr).toBe(0);
    const p2 = run('prepare', root);
    expect(p2.status, p2.stderr).toBe(0);
    expect(p2.stdout).toMatch(/^plan=reused modules=\d+ domains=3 digest=[0-9a-f]{64}/);
    expect(existsSync(join(areasDir, 'plan.input.json'))).toBe(false);
  });

  it('rejects a stale-token output with exit 3 and leaves no plan', () => {
    const { root, areasDir, planFile } = prepareProject();
    expect(run('prepare', root).status).toBe(0);
    const inp = JSON.parse(readFileSync(join(areasDir, 'plan.input.json'), 'utf-8'));
    writeFileSync(join(areasDir, 'plan.output.json'), JSON.stringify(goodOutput({ ...inp, planRun: { token: 'old' } })));
    const a = run('accept', root);
    expect(a.status).toBe(EXIT_REJECTED);
    expect(a.stdout).toMatch(/^rejected: token/m);
    expect(existsSync(planFile)).toBe(false);
    expect(JSON.parse(readFileSync(join(areasDir, 'plan.rejection.json'), 'utf-8')).reasons.length).toBeGreaterThan(0);
  });

  it('reports a missing output and exits 3', () => {
    const { root } = prepareProject();
    expect(run('prepare', root).status).toBe(0);
    const a = run('accept', root);
    expect(a.status).toBe(3);
    expect(a.stdout).toMatch(/rejected: missing/);
  });

  it('prepare without a manifest exits 1', () => {
    const root = tempRoot();
    expect(run('prepare', root).status).toBe(1);
  });
});
