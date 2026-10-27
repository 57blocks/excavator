// `prd.mjs aggregate`, the tables of the document skeleton and the features to
// retry (openspec change prd-report-prd-shape, design D4, D6, D7; oracle O3).
import { afterEach, describe, expect, it } from 'vitest';

import { makeLaneRun, makeSkeletonRun, runPrd } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
const track = (run) => {
  cleanups.push(run.cleanup);
  return run;
};
const aggregateOk = (run) => {
  const out = runPrd(['aggregate', run.out, '--project', run.project]);
  expect(out.status, out.stdout + out.stderr).toBe(0);
  return out.json;
};

describe('aggregate: terminology, roles and open items (D4)', () => {
  it('writes the glossary in the order of index.json, with a pipe in a cell escaped', () => {
    const run = track(makeSkeletonRun());
    aggregateOk(run);
    expect(run.readText('tables/terminology.md')).toBe([
      '| Term | Meaning |',
      '|---|---|',
      '| Order | A customer\'s request for goods, with a status of open or cancelled. |',
      '| Cancelled \\| void | An order a support agent ended. |',
      '',
    ].join('\n'));
    const index = run.readIndex();
    index.glossary = [];
    run.writeIndex(index);
    aggregateOk(run);
    expect(run.readText('tables/terminology.md')).toBe('None.\n');
  });

  it('writes the actors of the written features, columns in the order of the index actors, roles in order of first appearance, features in chapter order', () => {
    const run = track(makeSkeletonRun());
    aggregateOk(run);
    expect(run.readText('tables/roles.md')).toBe([
      '### Actors by feature',
      '',
      '| Feature | customer | support agent |',
      '|---|---|---|',
      '| F3 Roles and permissions |  |  |',
      '| F1 Order placement | x |  |',
      '| F2 Order cancellation |  | x |',
      '',
      '### Permission roles',
      '',
      '| Role | Features |',
      '|---|---|',
      '| admin | F3 Roles and permissions, F2 Order cancellation |',
      '| normal | F3 Roles and permissions |',
      '',
    ].join('\n'));
  });

  // Change prd-report-prd-shape, design D12: the columns are the index's names, in its order.
  it('orders the actor columns as the index lists the actors, and leaves out the names no written feature uses', () => {
    const run = track(makeSkeletonRun());
    const index = run.readIndex();
    index.actors = ['Payment service', 'support agent', 'Night operator', 'customer'];
    run.writeIndex(index);
    aggregateOk(run);
    expect(run.readText('tables/roles.md').split('\n').slice(0, 8)).toEqual([
      '### Actors by feature',
      '',
      '| Feature | support agent | customer |',
      '|---|---|---|',
      '| F3 Roles and permissions |  |  |',
      '| F1 Order placement |  | x |',
      '| F2 Order cancellation | x |  |',
      '',
    ]);
  });

  it('leaves out an actor only a failed feature uses', () => {
    const run = track(makeSkeletonRun());
    run.writeText('features/F1.md', run.readText('features/F1.md').replace('```mermaid', '```text'));
    aggregateOk(run);
    expect(run.readText('tables/roles.md')).toContain('| Feature | support agent |\n');
  });

  it('fails a feature whose chapter names an actor outside the index, so its name is in no column', () => {
    const run = track(makeSkeletonRun());
    run.writeText('features/F1.md', run.readText('features/F1.md').replace('actors: [customer]', 'actors: [customer, Auditor]'));
    aggregateOk(run);
    const f1 = run.readIndex().features.find((f) => f.id === 'F1');
    expect(f1.status).toBe('failed');
    expect(f1.failure.reasons).toContain('F1: actor "Auditor" is not one of the index\'s actors');
    expect(run.readText('tables/roles.md')).not.toContain('Auditor');
  });

  it('says so when no written feature lists an actor or a permission role', () => {
    const run = track(makeLaneRun());
    for (const id of ['F1', 'F2']) {
      run.writeText(`features/${id}.md`, run.readText(`features/${id}.md`).replace(/^actors: .*$/m, 'actors: []').replace(/^permissionRoles: .*$/m, 'permissionRoles: []'));
    }
    aggregateOk(run);
    expect(run.readText('tables/roles.md')).toBe('### Actors by feature\n\nNo written feature lists an actor.\n\n### Permission roles\n\nNo written feature lists a permission role.\n');
  });

  it('leaves a failed feature out of the roles and open items tables', () => {
    const run = track(makeSkeletonRun());
    run.writeText('features/F1.md', run.readText('features/F1.md').replace('```mermaid', '```text'));
    aggregateOk(run);
    expect(run.readIndex().features.find((f) => f.id === 'F1').status).toBe('failed');
    expect(run.readText('tables/roles.md')).not.toContain('customer');
    expect(run.readText('tables/open-items.md')).toBe('None.\n');
  });

  it('collects the open items section of each chapter under its feature, as the chapter wrote it', () => {
    const run = track(makeSkeletonRun());
    aggregateOk(run);
    expect(run.readText('tables/open-items.md')).toBe([
      '### F1 Order placement',
      '',
      '| Item | What is known | What was searched |',
      '|---|---|---|',
      '| Whether open orders expire | The status never changes on its own | `src/orders/service.js`, the whole project |',
      '',
    ].join('\n'));
  });

  it('fails a chapter whose open items heading stopped being its last ### heading, so no section is lost', () => {
    const run = track(makeSkeletonRun());
    run.writeText('features/F1.md', `${run.readText('features/F1.md')}\n### A later flow\n`);
    aggregateOk(run);
    const f1 = run.readIndex().features.find((f) => f.id === 'F1');
    expect(f1.status).toBe('failed');
    expect(f1.failure.reasons).toContain('F1: open items heading "Open items" is not the last ### heading');
  });
});

describe('aggregate: the coverage line about seed files outside the scope (D7)', () => {
  const coverageOf = (run) => run.readText('tables/coverage.md');
  const LINE = /^Seed files read outside the scope: .*$/m;

  it('counts the seed files outside a scope that is a directory by first-level directory, each file once', () => {
    const run = track(makeLaneRun());
    const index = run.readIndex();
    index.scope = 'src/orders';
    index.features[0].seedFiles = ['src/orders/routes.js', 'web/src/OrderForm.tsx', 'web/src/Other.tsx', 'package.json'];
    index.features[1].seedFiles = ['src/orders/service.js', 'web/src/OrderForm.tsx', 'docs/orders.md', 'src/ordersX/y.js'];
    run.writeIndex(index);
    aggregateOk(run);
    expect(coverageOf(run).match(LINE)[0]).toBe('Seed files read outside the scope: (root) 1, docs 1, src 1, web 2.');
  });

  it('says none when every seed file is under the scope', () => {
    const run = track(makeLaneRun());
    const index = run.readIndex();
    index.scope = 'src';
    index.features[0].seedFiles = ['src/orders/routes.js', 'src/orders/service.js'];
    run.writeIndex(index);
    aggregateOk(run);
    expect(coverageOf(run).match(LINE)[0]).toBe('Seed files read outside the scope: none.');
  });

  it('reads ./svc and ./svc/ as svc, and still has no such line for . or ./', () => {
    const lineFor = (scope) => {
      const run = track(makeLaneRun());
      const index = run.readIndex();
      index.scope = scope;
      index.features[0].seedFiles = ['src/orders/routes.js', 'web/src/OrderForm.tsx'];
      index.features[1].seedFiles = ['src/orders/service.js'];
      run.writeIndex(index);
      aggregateOk(run);
      return coverageOf(run).match(LINE)?.[0] ?? null;
    };
    const plain = lineFor('src');
    expect(plain).toBe('Seed files read outside the scope: web 1.');
    for (const scope of ['./src', './src/', '././src', 'src/']) expect(lineFor(scope), scope).toBe(plain);
    for (const scope of ['.', './', '././']) expect(lineFor(scope), scope).toBeNull();
  });

  it('has no such line when the scope is null, a file, missing, or leaves the project', () => {
    for (const scope of [null, 'src/orders/service.js', 'nowhere', '../outside', '/etc', 'src/../src']) {
      const run = track(makeLaneRun());
      const index = run.readIndex();
      index.scope = scope;
      run.writeIndex(index);
      aggregateOk(run);
      expect(coverageOf(run), String(scope)).not.toMatch(LINE);
      expect(coverageOf(run), String(scope)).toMatch(/^3 candidates:/m);
    }
  });

  it('writes the line right after the counts and before the candidate table, with the uncovered frameworks line first', () => {
    const run = track(makeLaneRun());
    const index = run.readIndex();
    index.scope = 'src';
    index.candidates.uncovered = ['spring'];
    run.writeIndex(index);
    aggregateOk(run);
    const lines = coverageOf(run).split('\n');
    expect(lines[0]).toBe('### Coverage');
    expect(lines[3]).toBe('Frameworks with no entrypoint patterns: spring.');
    expect(lines[4]).toBe('Seed files read outside the scope: web 1.');
    expect(lines[5]).toBe('');
    expect(lines[6]).toMatch(/^\| Candidate /);
  });
});

describe('aggregate: the features to retry (D6)', () => {
  /** Fail `id` with an advice word in a finding; `attempts` dispatches are recorded. */
  function failLane(run, id, attempts) {
    const findings = run.readJson(`findings/${id}.json`);
    findings.findings[0].statement = 'The route should check the quantity.';
    run.writeJson(`findings/${id}.json`, findings);
    for (let k = 0; k < attempts; k += 1) expect(runPrd(['mark', run.out, id, 'dispatched', '--project', run.project]).status).toBe(0);
  }

  it('lists the failed features with fewer than two attempts, in chapter order, not by id', () => {
    const run = track(makeLaneRun());
    const index = run.readIndex();
    index.features[0].chapter = 2;
    index.features[1].chapter = 1;
    run.writeIndex(index);
    run.writeText('features/F1.md', run.readText('features/F1.md').replace('chapter: 1', 'chapter: 2'));
    run.writeText('features/F2.md', run.readText('features/F2.md').replace('chapter: 2', 'chapter: 1'));
    failLane(run, 'F1', 1);
    failLane(run, 'F2', 0);
    expect(aggregateOk(run).retryable).toEqual(['F2', 'F1']);
  });

  it('leaves out a failed feature that has had two attempts, and a feature that did not fail', () => {
    const run = track(makeLaneRun());
    failLane(run, 'F1', 2);
    const printed = aggregateOk(run);
    expect(printed.features.failed).toBe(1);
    expect(printed.retryable).toEqual([]);
  });

  it('lists a feature failed in the verification step after one attempt', () => {
    const run = track(makeLaneRun());
    expect(runPrd(['mark', run.out, 'F2', 'dispatched', '--project', run.project]).status).toBe(0);
    run.writeText('verification/F2.txt', 'not a reply\n');
    const printed = aggregateOk(run);
    expect(run.readIndex().features[1].failure.step).toBe('verify');
    expect(printed.retryable).toEqual(['F2']);
  });
});
