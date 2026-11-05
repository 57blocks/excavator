// O1 (shape, labels, callers, conservation) of openspec change
// handbook-system-overview: check-overview and try-overview check the
// overview file against the project, record the result like check-entry, and
// print every reason with the place and the name. Every rejection is paired
// with a control that passes.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { clone } from './helpers.mjs';
import { checkedOverviewRun, overviewRun } from './overview-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const stateOf = (run) => run.readJson('state.json');
const withOverview = (adjust) => overviewRun(cleanups, adjust);

describe('check-overview: the good overview', () => {
  it('passes, prints one line and records the overview as checked with attempts 0 under its own key', () => {
    const run = withOverview();
    const result = run.run('check-overview');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['overview: checked']);
    const state = stateOf(run);
    expect(state.overview).toEqual({ status: 'checked', attempts: 0 });
    expect(Object.keys(state.features).sort()).toEqual(['F1', 'F2', 'F3', 'F4', 'F5']);
  });

  it('try-overview prints ok and records nothing', () => {
    const run = withOverview();
    const before = JSON.stringify(stateOf(run));
    const result = run.run('try-overview');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['overview: ok']);
    expect(JSON.stringify(stateOf(run))).toBe(before);
    expect(stateOf(run).overview).toBeUndefined();
  });
});

describe('check-overview: the shape', () => {
  const shapeCases = {
    'an extra key': [(doc) => { doc.extra = 1; }, /\(top level\): unexpected key "extra"/],
    'a missing key': [(doc) => { delete doc.audiences; }, /\(top level\): missing key "audiences"/],
    'more than 3 summary items': [(doc) => {
      doc.summary = Array.from({ length: 4 }, (_, i) => ({ text: `Staff place order ${i}.`, evidence: doc.summary[0].evidence }));
    }, /summary: must have at most 3 items/],
    'no summary item': [(doc) => { doc.summary = []; }, /summary: must have at least 1 item/],
    'no application': [(doc) => { doc.applications = []; }, /applications: must have at least 1 item/],
    'a wrong id': [(doc) => { doc.id = 'F1'; }, /^id: must be "overview"/],
    'a caller list that is empty': [(doc) => { doc.integrations[0].callers = []; }, /integrations\[0\]\.callers: must have at least 1 item/],
    'an item without evidence': [(doc) => { doc.audiences[0].evidence = []; }, /audiences\[0\]\.evidence: must have at least 1 item/],
  };
  for (const [name, [adjust, pattern]] of Object.entries(shapeCases)) {
    it(`reports ${name} and records the overview as failed`, () => {
      const run = withOverview(adjust);
      const result = run.run('check-overview');
      expect(result.status).toBe(1);
      expect(result.lines.some((line) => pattern.test(line)), result.stdout).toBe(true);
      expect(result.lines.at(-1)).toMatch(/^Next: /);
      expect(stateOf(run).overview.status).toBe('failed');
      expect(stateOf(run).overview.failure.step).toBe('check-entry');
    });
  }

  it('reports each shape problem on its own line', () => {
    const run = withOverview((doc) => {
      doc.extra = 1;
      delete doc.unknowns;
    });
    const result = run.run('try-overview');
    expect(result.status).toBe(1);
    expect(result.lines.filter((line) => /^\(top level\):/.test(line))).toHaveLength(2);
  });
});

describe('check-overview: citations and values', () => {
  it('refuses a citation that points to a documentation file, and accepts the same passage from source', () => {
    const docs = ['docs/guide.md', 'docs/guide.MDX', 'notes.txt', 'docs/a.rst', 'docs/a.adoc'];
    for (const file of docs) {
      const run = withOverview();
      mkdirSync(join(run.root, 'docs'), { recursive: true });
      writeFileSync(join(run.root, file), '# Guide\nStaff place orders.\n');
      run.overview.summary[0].evidence = [{ file, passage: 'Staff place orders.' }];
      run.overview.summary[0].text = 'Staff place orders.';
      run.writeOverview();
      const result = run.run('try-overview');
      expect(result.status, file).toBe(1);
      expect(result.lines[0], file).toMatch(/^summary\[0\]\.evidence\[0\]: .* is a documentation file/);
    }
    expect(withOverview().run('try-overview').status).toBe(0);
  });

  it('names the place and the name of an external system that its citation does not hold', () => {
    const run = withOverview((doc) => { doc.integrations[0].system = 'Teams'; });
    const result = run.run('check-overview');
    expect(result.status).toBe(1);
    expect(result.lines[0]).toMatch(/^integrations\[0\]\.system: label "Teams" does not occur in this item's passages/);
  });

  it('runs the reader-text gate over the narrative: a code-shaped word in an application name is refused', () => {
    const run = withOverview((doc) => { doc.applications[0].name = 'order_tool'; });
    const result = run.run('try-overview');
    expect(result.status).toBe(1);
    expect(result.lines[0]).toMatch(/^applications\[0\]\.name: "order_tool" is not allowed in reader text/);
  });

  it('refuses a number that its citation does not state and a passage that is not in its file', () => {
    const run = withOverview((doc) => { doc.summary[0].text = 'Staff place 7 orders.'; doc.audiences[0].evidence[0].passage = 'const ROLES = [none];'; });
    const result = run.run('try-overview');
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/summary\[0\]\.text: number 7 does not occur/);
    expect(result.stdout).toMatch(/audiences\[0\]\.evidence\[0\]: passage not in src\/roles\.js/);
  });

  it('does not take who from the map roles: a customer is a user too', () => {
    const run = withOverview((doc) => { doc.audiences[0].who = 'Customer'; });
    expect(run.run('try-overview').status).toBe(0);
  });
});

describe('check-overview: callers', () => {
  it('refuses a caller that is not an application listed in the overview and names it', () => {
    const run = withOverview((doc) => { doc.integrations[0].callers = ['services/web']; });
    const result = run.run('check-overview');
    expect(result.status).toBe(1);
    expect(result.lines[0]).toMatch(/^integrations\[0\]\.callers\[0\]: "services\/web" is not the directory of an application listed in this overview/);
  });
});

describe('check-overview: application conservation', () => {
  /** A run whose project holds two more application roots next to the fixture's own, as nested packages are not roots. */
  function manyRoots(adjust) {
    return withOverview((doc, run) => {
      for (const dir of ['api', 'web']) {
        mkdirSync(join(run.root, 'repos', dir, 'src'), { recursive: true });
        writeFileSync(join(run.root, 'repos', dir, 'package.json'), '{ "name": "x" }\n');
      }
      rmSync(join(run.root, 'package.json'));
      doc.applications = ['repos/api', 'repos/web'].map((dir) => ({ dir, name: `App ${dir.slice(6)}`, does: 'Serves requests.', evidence: [{ file: `${dir}/package.json`, passage: '{ "name": "x" }' }] }));
      doc.integrations[0].callers = ['repos/api'];
      adjust?.(doc, run);
    });
  }

  it('passes when every application root is covered', () => {
    const run = manyRoots();
    const result = run.run('try-overview');
    expect(result.status, result.stdout).toBe(0);
  });

  it('reports the application root nobody covers, by its directory', () => {
    const run = manyRoots((doc) => { doc.applications.pop(); });
    const result = run.run('check-overview');
    expect(result.status).toBe(1);
    expect(result.lines.filter((line) => line.includes('repos/web'))).toHaveLength(1);
    expect(result.lines.some((line) => /^applications: the application root "repos\/web" is not covered by any listed application/.test(line)), result.stdout).toBe(true);
  });

  it('reports two applications that name the same directory', () => {
    const run = manyRoots((doc) => { doc.applications[1].dir = 'repos/api'; });
    const result = run.run('check-overview');
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/^applications\[1\]\.dir: "repos\/api" is already the directory of applications\[0\]/m);
    expect(result.stdout).toMatch(/application root "repos\/web" is not covered/);
  });

  it('reports a directory that holds no build manifest, and a directory that does not exist', () => {
    const run = manyRoots((doc, r) => {
      mkdirSync(join(r.root, 'repos', 'docs'), { recursive: true });
      doc.applications.push({ dir: 'repos/docs', name: 'Docs', does: 'Holds notes.', evidence: doc.applications[0].evidence });
      doc.applications.push({ dir: 'repos/none', name: 'None', does: 'Holds nothing.', evidence: doc.applications[0].evidence });
    });
    const result = run.run('try-overview');
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/^applications\[2\]\.dir: "repos\/docs" holds no build manifest/m);
    expect(result.stdout).toMatch(/^applications\[3\]\.dir: "repos\/none" holds no build manifest/m);
  });

  it('accepts a listed application that sits below an application root, next to one that is the root', () => {
    const run = manyRoots((doc, r) => {
      mkdirSync(join(r.root, 'repos', 'api', 'tools'), { recursive: true });
      writeFileSync(join(r.root, 'repos', 'api', 'tools', 'package.json'), '{ "name": "tools" }\n');
      doc.applications.push({ dir: 'repos/api/tools', name: 'Tools', does: 'Runs maintenance work.', evidence: [{ file: 'repos/api/tools/package.json', passage: '{ "name": "tools" }' }] });
    });
    expect(run.run('try-overview').status).toBe(0);
  });

  it('the single application root is the project root when the project root holds a manifest', () => {
    const run = withOverview();
    expect(run.run('try-overview').status).toBe(0);
    run.overview.applications[0].dir = 'src';
    run.overview.integrations[0].callers = ['src'];
    run.writeOverview();
    const result = run.run('try-overview');
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/"src" holds no build manifest/);
    expect(result.stdout).toMatch(/application root "\." is not covered/);
  });
});

describe('check-overview: the record in state.json', () => {
  it('a missing file is lane-wrote-nothing with a Next line, a second failure stays failed', () => {
    const run = withOverview();
    rmSync(join(run.out, 'entries', 'overview.json'));
    const first = run.run('check-overview');
    expect(first.status).toBe(1);
    expect(first.lines[0]).toBe('overview: lane-wrote-nothing: entries/overview.json is missing');
    expect(first.lines.at(-1)).toMatch(/^Next: delete overview's entry, mark it dispatched and re-dispatch it once/);
    expect(stateOf(run).overview).toMatchObject({ status: 'failed', attempts: 0, failure: { step: 'lane' } });

    expect(run.run('mark', 'overview', 'dispatched').lines).toEqual(['overview: dispatched, attempts 1']);
    expect(run.run('mark', 'overview', 'dispatched').lines).toEqual(['overview: dispatched, attempts 2']);
    expect(run.run('mark', 'overview', 'dispatched').status).toBe(1);
    const second = run.run('check-overview');
    expect(second.lines.at(-1)).toBe('Next: overview stays failed (2 of 2 attempts)');
  });

  it('mark records a lane that wrote nothing under the overview key', () => {
    const run = withOverview();
    expect(run.run('mark', 'overview', 'failed', 'lane', 'wrote-nothing').lines).toEqual(['overview: failed at lane: wrote-nothing']);
    expect(stateOf(run).overview.failure).toEqual({ step: 'lane', reasons: ['wrote-nothing'] });
    expect(stateOf(run).features.F1.status).toBe('planned');
  });

  it('refuses to dispatch an overview that is already checked', () => {
    const run = checkedOverviewRun(cleanups);
    const result = run.run('mark', 'overview', 'dispatched');
    expect(result.status).toBe(1);
    expect(result.lines[0]).toBe('overview: already checked; it is not written again');
  });

  it('keeps the overview key when check-map runs again on the same map', () => {
    const run = checkedOverviewRun(cleanups);
    expect(run.run('check-map').status).toBe(0);
    expect(stateOf(run).overview.status).toBe('checked');
  });
});

describe('the overview id is reserved', () => {
  it('check-map refuses a feature whose id is overview', () => {
    const run = withOverview();
    const map = clone(run.map);
    map.features[0].id = 'overview';
    run.writeMap(map);
    const result = run.run('check-map');
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/features\[0\]\.id: "overview" is reserved for the system overview/);
    expect(existsSync(join(run.out, 'handbook.md'))).toBe(false);
  });
});
