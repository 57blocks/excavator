// O3 (output) of openspec change handbook-system-name: handbook.md and the page
// data carry the verified system name; without one (the name is null, was
// removed by verification, the overview was verified before this change, or
// the overview is not verified) the handbook has the plain title and says the
// code gives no name, and the page data has no project at all, never the
// directory name.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { entryDigest } from '../../../skills/excavator-product-handbook/lib/state.mjs';
import { SHIPPED_UI, judge, runHandbook, traceFeature, verifyChecked } from './helpers.mjs';
import { checkedOverviewRun, overviewRun } from './overview-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const STUB = '<!doctype html><html lang="und"><head><meta charset="UTF-8"><!-- xv:csp --></head><body><div id="root"></div><!-- xv:data --></body></html>';
const stubDir = mkdtempSync(join(tmpdir(), 'xhb-stub-'));
const stubPath = join(stubDir, 'template.html');
writeFileSync(stubPath, STUB);
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

const MISSING = 'No system name was found in the code.';
const read = (run, name) => readFileSync(join(run.out, name), 'utf-8');
const assemble = (run, ...args) => {
  const result = run.run('assemble', ...args);
  expect(result.status, result.stdout).toBe(0);
  return read(run, args.includes('technical') ? 'handbook-technical.md' : 'handbook.md');
};
const page = (run) => runHandbook(['page', run.out, '--project', run.root], { env: { ...process.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
const dataOf = (run) => JSON.parse(/<script type="application\/json" id="xv-product-handbook-data">([\s\S]*?)<\/script>/.exec(read(run, 'handbook.html'))[1]);
/** The first lines after the heading of the system overview. */
const afterOverviewHeading = (text) => text.slice(text.indexOf('## System overview')).split('\n').slice(1, 4);

function verifiedRun(adjust) {
  const run = checkedOverviewRun(cleanups, adjust);
  verifyChecked(run, 'overview');
  return run;
}

/** The run whose name verification removed in both rounds. */
function removedRun() {
  const run = checkedOverviewRun(cleanups);
  const reason = { verdict: 'unverified', reason: 'No line shown writes that name.' };
  expect(judge(run, 'overview', 1, (item) => (item.id === 'name' ? reason : 'verified')).status).toBe(0);
  expect(judge(run, 'overview', 2, () => reason).status).toBe(0);
  expect(traceFeature(run, 'overview').status).toBe(0);
  return run;
}

/** The run whose overview was verified before this change: no name key, the digest of that file. */
function oldRun() {
  const run = verifiedRun();
  const path = join(run.out, 'entries', 'overview.json');
  const doc = JSON.parse(readFileSync(path, 'utf-8'));
  delete doc.name;
  run.writeJson(path, doc);
  const state = run.readJson('state.json');
  state.overview.entryDigest = entryDigest(path);
  run.writeJson(join(run.out, 'state.json'), state);
  return run;
}

const UNNAMED = [
  ['the name is null', () => verifiedRun((doc) => { doc.name = null; })],
  ['verification removed the name', removedRun],
  ['the overview was verified before this change', oldRun],
  ['the overview is not verified', () => overviewRun(cleanups)],
];

describe('handbook.md: the title', () => {
  it('has the name in the title, and no sentence that says there is none', () => {
    const run = verifiedRun();
    const text = assemble(run);
    expect(text.startsWith('# handbook-fixture - Product handbook\n')).toBe(true);
    expect(text).not.toContain(MISSING);
  });

  it('has the name in the title of the technical view', () => {
    const run = verifiedRun();
    const text = assemble(run, '--views', 'technical');
    expect(text.startsWith('# handbook-fixture - Product handbook: technical view\n')).toBe(true);
  });

  for (const [what, make] of UNNAMED) {
    it(`has the plain title and the sentence that the code gives no name, first in the overview, when ${what}`, () => {
      const text = assemble(make());
      expect(text.startsWith('# Product handbook\n')).toBe(true);
      expect(afterOverviewHeading(text).filter((line) => line !== '')[0]).toBe(MISSING);
      expect(text.split(MISSING)).toHaveLength(2);
    });

    it(`has the plain title of the technical view and the same sentence when ${what}`, () => {
      const text = assemble(make(), '--views', 'technical');
      expect(text.startsWith('# Product handbook: technical view\n')).toBe(true);
      expect(afterOverviewHeading(text).filter((line) => line !== '')[0]).toBe(MISSING);
    });
  }

  it('lists a removed name among the removed items of the overview, with its claim', () => {
    const text = assemble(removedRun());
    expect(text).toContain('#### System overview: items removed: 1');
    expect(text).toContain('| System name > handbook-fixture | The code shown does not settle it | No line shown writes that name. |');
  });

  it('writes the title and the missing-name sentence from the run\'s ui.json, not from the program', () => {
    const table = JSON.parse(readFileSync(SHIPPED_UI, 'utf-8'));
    table.strings['md.titleNamed'] = '{name} / Handbook';
    table.strings['md.overview.nameMissing'] = 'The code names nothing.';
    const named = verifiedRun();
    named.writeJson(join(named.out, 'ui.json'), table);
    expect(assemble(named).startsWith('# handbook-fixture / Handbook\n')).toBe(true);
    const unnamed = verifiedRun((doc) => { doc.name = null; });
    unnamed.writeJson(join(unnamed.out, 'ui.json'), table);
    const text = assemble(unnamed);
    expect(text.startsWith('# Product handbook\n')).toBe(true);
    expect(afterOverviewHeading(text).filter((line) => line !== '')[0]).toBe('The code names nothing.');
  });
});

describe('page data: the project is the system name', () => {
  it('has the format 9 and the verified name in project', () => {
    const run = verifiedRun();
    expect(page(run).status).toBe(0);
    const data = dataOf(run);
    expect(data.format).toBe('excavator-product-handbook-page/17');
    expect(data.project).toBe('handbook-fixture');
    expect(Object.keys(data)).toEqual(['format', 'chunks', 'project', 'language', 'languageTag', 'ui', 'views', 'areas', 'domains', 'domainBasis', 'features', 'findings', 'remedies', 'topics', 'history', 'appendix', 'coverage', 'summary', 'system', 'entities']);
  });

  for (const [what, make] of UNNAMED) {
    it(`has null in project, never the directory name, when ${what}`, () => {
      const run = make();
      expect(page(run).status).toBe(0);
      const data = dataOf(run);
      expect(data.project).toBeNull();
      expect(read(run, 'handbook.html')).not.toMatch(/"project":"/);
    });
  }
});
