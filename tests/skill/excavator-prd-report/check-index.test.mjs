// `prd.mjs check-index <out>`: the index schema, the candidate conservation,
// inferred candidates and seed files inside the project (openspec change
// prd-feature-pipeline, design D2; scenario "candidate assignment lost").
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeLaneRun, makeTempDir, runPrd } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
function laneRun() {
  const run = makeLaneRun();
  cleanups.push(run.cleanup);
  return run;
}
const reasons = (out) => out.stdout.split('\n').filter(Boolean);

describe('prd.mjs check-index', () => {
  it('passes the valid index and writes the computed conservation and the defaults back', () => {
    const run = laneRun();
    const out = runPrd(['check-index', run.out, '--project', run.project]);
    expect(out.status, out.stdout + out.stderr).toBe(0);
    const index = run.readIndex();
    expect(index.conservation).toEqual({ candidates: 3, assigned: 3, unassigned: 0, holds: true });
    expect(index.features[0]).toMatchObject({ status: 'planned', attempts: 0, failure: null });
    expect(index.features[0].counts).toEqual({ diagrams: 0, evidence: 0, findings: { product: 0, technical: 0 }, verification: null });
    // A second run on the written index is stable.
    const before = run.readText('index.json');
    expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
    expect(run.readText('index.json')).toBe(before);
  });

  it('fails and names the candidate that is in no feature and not unassigned', () => {
    const run = laneRun();
    const index = run.readIndex();
    index.features[1].entrypoints = [];
    run.writeIndex(index);
    const out = runPrd(['check-index', run.out, '--project', run.project]);
    expect(out.status).toBe(1);
    expect(reasons(out)).toContain('c2: in no feature and not in unassigned');
    expect(run.readIndex().conservation).toEqual({ candidates: 3, assigned: 2, unassigned: 0, holds: false });
  });

  it('passes when that candidate is listed as unassigned instead', () => {
    const run = laneRun();
    const index = run.readIndex();
    index.features[1].entrypoints = [];
    index.unassigned = ['c2'];
    run.writeIndex(index);
    const out = runPrd(['check-index', run.out, '--project', run.project]);
    expect(out.status, out.stdout).toBe(0);
    expect(run.readIndex().conservation).toEqual({ candidates: 3, assigned: 2, unassigned: 1, holds: true });
  });

  it('fails a candidate in two features, or in a feature and unassigned', () => {
    const run = laneRun();
    const index = run.readIndex();
    index.features[1].entrypoints = ['c2', 'c1'];
    index.unassigned = ['c2'];
    run.writeIndex(index);
    const out = runPrd(['check-index', run.out, '--project', run.project]);
    expect(out.status).toBe(1);
    expect(reasons(out)).toContain('c1: in more than one feature: F1, F2');
    expect(reasons(out)).toContain('c2: in feature F2 and in unassigned');
  });

  it('fails an entrypoint or unassigned id that is not a candidate', () => {
    const run = laneRun();
    const index = run.readIndex();
    index.features[0].entrypoints.push('c99');
    index.unassigned = ['c98'];
    run.writeIndex(index);
    const out = runPrd(['check-index', run.out, '--project', run.project]);
    expect(out.status).toBe(1);
    expect(reasons(out)).toContain('F1: entrypoint c99 is not a candidate');
    expect(reasons(out)).toContain('unassigned: c98 is not a candidate');
  });

  it('fails an inferred candidate whose line is past the end of its file, or whose file is missing', () => {
    const run = laneRun();
    const index = run.readIndex();
    index.candidates.items[2].line = 7;
    index.candidates.items.push({ id: 'i2', kind: 'job', file: 'src/jobs/nightly.js', line: 1, text: 'x', framework: 'custom', provenance: 'inferred' });
    index.unassigned = ['i2'];
    run.writeIndex(index);
    const out = runPrd(['check-index', run.out, '--project', run.project]);
    expect(out.status).toBe(1);
    expect(reasons(out)).toContain('i1: line 7 is past the end of web/src/OrderForm.tsx (6 lines)');
    expect(reasons(out)).toContain('i2: src/jobs/nightly.js is not a file in the project');
  });

  it('fails seed files that leave the project: .., absolute, a symlink out, a missing file', () => {
    const run = laneRun();
    const outside = makeTempDir('xprd-outside-');
    cleanups.push(outside.cleanup);
    writeFileSync(join(outside.root, 'secret.js'), 'module.exports = 1;\n');
    mkdirSync(join(run.project, 'links'));
    symlinkSync(join(outside.root, 'secret.js'), join(run.project, 'links/secret.js'));
    const index = run.readIndex();
    index.features[1].seedFiles = ['../outside.js', join(run.project, 'src/orders/service.js'), 'links/secret.js', 'src/missing.js'];
    run.writeIndex(index);
    const out = runPrd(['check-index', run.out, '--project', run.project]);
    expect(out.status).toBe(1);
    const lines = reasons(out).filter((line) => line.startsWith('F2: seed file'));
    expect(lines).toHaveLength(4);
    expect(lines.join('\n')).toMatch(/\.\.\/outside\.js/);
    expect(lines.join('\n')).toMatch(/links\/secret\.js resolves outside the project/);
  });

  it('fails a candidate from the script whose file or line does not exist, as it fails an inferred one', () => {
    const run = laneRun();
    const index = run.readIndex();
    index.candidates.items.push({ id: 'c9', kind: 'route', file: 'server/ghost.js', line: 4242, text: 'router.get(...)', framework: 'express' });
    index.candidates.items[0].line = 4242;
    index.features[0].entrypoints.push('c9');
    run.writeIndex(index);
    const out = runPrd(['check-index', run.out, '--project', run.project]);
    expect(out.status).toBe(1);
    expect(reasons(out)).toContain('c9: server/ghost.js is not a file in the project');
    expect(reasons(out)).toContain('c1: line 4242 is past the end of src/orders/routes.js (8 lines)');
  });

  it('fails a pattern candidate that differs from the entrypoints.json item of its id, field by field, and lets an inferred one through', () => {
    const run = laneRun();
    const index = run.readIndex();
    index.candidates.items[0].text = "router.post('/orders',   (req, res) =>";
    index.candidates.items[1].line = 5;
    index.candidates.items[1].framework = 'koa';
    index.candidates.items[1].provenance = 'pattern';
    index.candidates.items[2].text = 'a summary the model wrote';
    index.candidates.items.push({ ...index.candidates.items[0], id: 'c3', text: "router.post('/orders', (req, res) => res.status(201).json(createOrder(req.body)));" });
    index.features[0].entrypoints.push('c3');
    run.writeIndex(index);
    const out = runPrd(['check-index', run.out, '--project', run.project]);
    expect(out.status).toBe(1);
    expect(reasons(out)).toEqual([
      'c1: differs from entrypoints.json in text; copy a listed candidate unchanged',
      'c2: differs from entrypoints.json in line, framework; copy a listed candidate unchanged',
      'c3: is not in entrypoints.json; a candidate the script did not list has provenance "inferred"',
    ]);
  });

  it('fails pattern candidates without entrypoints.json, and passes without it when every candidate is inferred', () => {
    const run = laneRun();
    rmSync(join(run.out, 'entrypoints.json'));
    const out = runPrd(['check-index', run.out, '--project', run.project]);
    expect(out.status).toBe(1);
    expect(reasons(out)).toEqual(['index: entrypoints.json is missing; write it with prd.mjs entrypoints (Phase 1): every candidate without provenance "inferred" must be one of its items']);
    const index = run.readIndex();
    for (const item of index.candidates.items) item.provenance = 'inferred';
    run.writeIndex(index);
    expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
  });

  it('fails when entrypoints.json is not JSON or has no items', () => {
    const run = laneRun();
    writeFileSync(join(run.out, 'entrypoints.json'), '{');
    expect(reasons(runPrd(['check-index', run.out, '--project', run.project]))[0]).toMatch(/^index: entrypoints\.json is not valid JSON/);
    writeFileSync(join(run.out, 'entrypoints.json'), '{"items": 3}');
    expect(reasons(runPrd(['check-index', run.out, '--project', run.project]))).toEqual(['index: entrypoints.json has no items list']);
  });

  it('fails a malformed schema with one line per problem', () => {
    const run = laneRun();
    const index = run.readIndex();
    index.format = 'excavator-prd-report/0';
    index.features[0].kind = 'page';
    index.features[1].id = 'X2';
    index.features[1].tiers = ['middle'];
    index.candidates.items[0].kind = 'endpoint';
    delete index.glossary;
    run.writeIndex(index);
    const out = runPrd(['check-index', run.out, '--project', run.project]);
    expect(out.status).toBe(1);
    const text = out.stdout;
    for (const pattern of [/format/, /F1: kind/, /X2/, /tiers/, /c1: kind/, /glossary/]) expect(text).toMatch(pattern);
  });

  it('fails a feature id that repeats, and a candidate id that repeats', () => {
    const run = laneRun();
    const index = run.readIndex();
    index.features[1].id = 'F1';
    index.candidates.items[1].id = 'c1';
    run.writeIndex(index);
    const out = runPrd(['check-index', run.out, '--project', run.project]);
    expect(out.status).toBe(1);
    expect(reasons(out)).toContain('F1: the feature id repeats');
    expect(reasons(out)).toContain('c1: the candidate id repeats');
  });

  it('exits 2 when the out directory or its index is missing, and 1 when the index is not JSON', () => {
    const run = laneRun();
    expect(runPrd(['check-index', join(run.root, 'nowhere')]).status).toBe(2);
    expect(runPrd(['check-index']).status).toBe(2);
    run.writeText('index.json', '{ not json');
    const broken = runPrd(['check-index', run.out, '--project', run.project]);
    expect(broken.status).toBe(1);
    expect(broken.stdout).toMatch(/^index: /);
  });
});
