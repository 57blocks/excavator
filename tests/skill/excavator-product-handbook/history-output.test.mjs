// O2 of openspec change handbook-history-appendix: the Code health chapter comes after the Cross-cutting topics chapter and before the
// coverage section, the Appendix chapter after the coverage section, both in the product and the technical view; the product view
// shows a file by its name and the application it is in and never a path; a project with no version history, a missing file and a
// malformed file each have their own line; the appendix writes the open questions, the glossary and the sources and scope from
// the verified entries and the records of the run; no fixed text or written line advises or evaluates; and the page data is /14
// with `history` and `appendix`, the paths only in the technical part.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { adviceWordsOf, wordsIn } from '../../../skills/excavator-product-handbook/lib/word-lists.mjs';
import { MAX_FILES_PER_COMMIT, MIN_TOGETHER } from '../../../skills/excavator/hotspots/co-change.mjs';
import { HOTSPOT_FILES, CO_CHANGE_PAIRS } from '../../../skills/excavator-product-handbook/lib/history-hotspots.mjs';
import { runHandbook } from './helpers.mjs';
import { appendixRun, countEvidenceItems, goodHistory, writeHistory } from './appendix-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const STUB = '<!doctype html><html lang="und"><head><meta charset="UTF-8"><!-- xv:csp --></head><body><div id="root"></div><!-- xv:data --></body></html>';
const stubDir = mkdtempSync(join(tmpdir(), 'xhb-stub-'));
const stubPath = join(stubDir, 'template.html');
writeFileSync(stubPath, STUB);
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

const ui = JSON.parse(readFileSync(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url), 'utf-8')).strings;
const text = (run, name) => readFileSync(join(run.out, name), 'utf-8');
const assemble = (run, views = 'product') => {
  const result = run.run('assemble', '--views', views);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return result;
};
const page = (run, views = 'product,technical') => runHandbook(['page', run.out, '--project', run.root, '--views', views], { env: { ...process.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
const dataOf = (run) => JSON.parse(/<script type="application\/json" id="xv-product-handbook-data">([\s\S]*?)<\/script>/.exec(text(run, 'handbook.html'))[1]);

/** The part of the handbook between a heading and the next heading of the same or a higher level. */
function section(body, heading) {
  const level = heading.match(/^#+/)[0].length;
  const start = body.indexOf(`\n${heading}\n`);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const rest = body.slice(start + heading.length + 2);
  const end = rest.search(new RegExp(`^#{1,${level}} `, 'm'));
  return end === -1 ? rest : rest.slice(0, end);
}
const historyOf = (body) => section(body, `## ${ui['md.history.heading']}`);
const appendixOfBody = (body) => section(body, `## ${ui['md.appendix.heading']}`);

// The tests that only read share one run with a history file; the ones that change it build their own.
const sharedCleanups = [];
let sharedRun = null;
function shared() {
  if (sharedRun === null) {
    sharedRun = appendixRun(sharedCleanups);
    writeHistory(sharedRun);
    assemble(sharedRun, 'product,technical');
  }
  return sharedRun;
}
afterAll(() => {
  while (sharedCleanups.length > 0) sharedCleanups.pop()();
});

describe('the Code health chapter', () => {
  it('comes after the Cross-cutting topics chapter and before the coverage section, in both views', () => {
    const run = shared();
    for (const name of ['handbook.md', 'handbook-technical.md']) {
      const body = text(run, name);
      const at = (heading) => body.indexOf(`\n## ${heading}\n`);
      expect(at(ui['md.topics.heading']), name).toBeGreaterThan(0);
      expect(at(ui['md.history.heading']), name).toBeGreaterThan(at(ui['md.topics.heading']));
      expect(at(ui['md.coverage.heading']), name).toBeGreaterThan(at(ui['md.history.heading']));
    }
  });

  it('writes the commits of each year as a table and a bar chart a script draws from it, a year without commits with a zero', () => {
    const run = shared();
    const part = section(historyOf(text(run, 'handbook.md')), `### ${ui['md.history.yearsHeading']}`);
    expect(part).toContain('| Year | Commits | By application |\n| --- | --- | --- |\n| 2022 | 3 | .: 3 |\n| 2023 | 0 | - |\n| 2024 | 5 | .: 5 |');
    expect(part).toContain('```mermaid\nxychart-beta\n  title "Commits per year"\n  x-axis [2022, 2023, 2024]\n  y-axis "Commits" 0 --> 5\n  bar [3, 0, 5]\n```');
    expect(part).toContain(ui['md.history.chartNote']);
  });

  it('writes each application with its first and last commit, commits, authors and the authors that make up 80% of the commits', () => {
    const run = shared();
    const part = section(historyOf(text(run, 'handbook.md')), `### ${ui['md.history.appsHeading']}`);
    expect(part).toContain('| Directory | First commit | Last commit | Commits | Authors | Authors with 80% of the commits |');
    expect(part).toContain('| . | 2022-03-01 | 2024-09-09 | 8 | 2 | 1 |');
  });

  it('writes an application without history with its reason in the first cell and dashes after it', () => {
    const run = appendixRun(cleanups);
    const doc = goodHistory();
    doc.apps = [{ dir: '.', first: null, last: null, commits: null, authors: null, authors80: null, reason: 'no-commits' }];
    writeHistory(run, doc);
    assemble(run);
    expect(historyOf(text(run, 'handbook.md'))).toContain('| . | No version history: the repository has no commit under the directory | - | - | - | - |');
  });

  it('writes the files that change most with the file name, the application and the verified features that cite it, and no path in the product view', () => {
    const run = shared();
    const part = section(historyOf(text(run, 'handbook.md')), `### ${ui['md.history.hotspotsHeading']}`);
    expect(part).toContain('| File | Application | Commits | Authors | Lines | Last change | Features |');
    // F2 cites the file in the file, but its entry is not verified: it is not named.
    expect(part).toContain('| orders.js | . | 5 | 2 | 20 | 2024-09-09 | Orders, Reminders |');
    expect(part).toContain('| app.js | . | 2 | 1 | 9 | 2023-01-01 | - |');
    expect(historyOf(text(run, 'handbook.md'))).not.toContain('src/');
  });

  it('writes no uncertain mark and no note about it when no listed file has an uncertain count', () => {
    const run = shared();
    for (const name of ['handbook.md', 'handbook-technical.md']) {
      const part = section(historyOf(text(run, name)), `### ${ui['md.history.hotspotsHeading']}`);
      expect(part, name).not.toContain('uncertain');
      expect(part, name).not.toContain(ui['md.history.uncertainNote']);
    }
  });

  it('writes the commits of a file with an uncertain count as "commits (n uncertain)" and one note after the hotspots note, in both views', () => {
    const run = appendixRun(cleanups);
    const doc = goodHistory();
    doc.hotspots[0].uncertain = 3;
    writeHistory(run, doc);
    assemble(run, 'product,technical');
    for (const [name, first] of [['handbook.md', '| orders.js | . | 5 (3 uncertain) | 2 | 20 | 2024-09-09 | Orders, Reminders |'], ['handbook-technical.md', '| src/routes/orders.js | . | 5 (3 uncertain) | 2 | 20 | 2024-09-09 | Orders, Reminders |']]) {
      const part = section(historyOf(text(run, name)), `### ${ui['md.history.hotspotsHeading']}`);
      expect(part, name).toContain(first);
      // a file without an uncertain count keeps its plain number
      expect(part, name).toMatch(/\| \S*app\.js \| \. \| 2 \| 1 \| 9 \|/);
      expect(part.split(ui['md.history.uncertainNote']).length - 1, name).toBe(1);
      expect(part.indexOf(ui['md.history.uncertainNote']), name).toBeGreaterThan(part.indexOf(ui['md.history.hotspotsNote']));
      expect(part.indexOf(ui['md.history.uncertainNote']), name).toBeLessThan(part.indexOf('| File |') === -1 ? part.indexOf('| Path |') : part.indexOf('| File |'));
    }
  });

  it('ships the two fixed texts of the uncertain count', () => {
    expect(ui['md.history.commitsUncertain']).toBe('{commits} ({uncertain} uncertain)');
    expect(ui['md.history.uncertainNote']).toBe('A count marked uncertain is for a file whose history branches: at that many commits git could not tell which file of the same name was changed, so the count can leave out or include those commits.');
  });

  it('writes the path of each file in the technical view', () => {
    const run = shared();
    const body = historyOf(text(run, 'handbook-technical.md'));
    expect(body).toContain('| Path | Application | Commits | Authors | Lines | Last change | Features |');
    expect(body).toContain('| src/routes/orders.js | . | 5 | 2 | 20 | 2024-09-09 | Orders, Reminders |');
    expect(body).toContain('| src/app.js (.) | src/routes/orders.js (.) | 4 |');
  });

  it('writes the pairs changed together by file name and application in the product view', () => {
    const run = shared();
    const part = section(historyOf(text(run, 'handbook.md')), `### ${ui['md.history.coChangeHeading']}`);
    expect(part).toContain('| First file | Second file | Commits together |\n| --- | --- | --- |\n| app.js (.) | orders.js (.) | 4 |');
  });

  it('writes the source and test files of each application and names the conventions that decide which file is a test', () => {
    const run = shared();
    const part = section(historyOf(text(run, 'handbook.md')), `### ${ui['md.history.testsHeading']}`);
    expect(part).toContain('conventions: *_test.go; *.test.*; *.spec.*; test_*.py; *_test.py; *Test.java and *Tests.java; any file in a __tests__ directory.');
    expect(part).toContain('| Directory | Source files | Test files |\n| --- | --- | --- |\n| . | 9 | 2 |');
  });

  it('says the project has no version history, with the reason, and still writes the test counts', () => {
    const run = appendixRun(cleanups);
    writeHistory(run, { ...goodHistory(), noHistory: { reason: 'inside-repository' }, years: [], apps: [{ dir: '.', first: null, last: null, commits: null, authors: null, authors80: null, reason: 'inside-repository' }], hotspots: [], coChange: [] });
    assemble(run);
    const body = historyOf(text(run, 'handbook.md'));
    expect(body).toContain('There is no version history to count: the project directory is inside a git repository that it is not the root of. The test files below are counted from the project files.');
    expect(body).toContain('| . | 9 | 2 |');
    expect(body).not.toContain(ui['md.history.yearsHeading']);
    expect(body).not.toContain(ui['md.history.hotspotsHeading']);
  });

  it('says it was not written when the file is missing, and that the file is not in the format when it is malformed, and still writes the appendix', () => {
    const run = appendixRun(cleanups);
    assemble(run);
    expect(historyOf(text(run, 'handbook.md'))).toContain(ui['md.history.notWritten']);
    expect(historyOf(text(run, 'handbook.md'))).not.toContain('###');
    expect(text(run, 'handbook.md')).toContain(`\n## ${ui['md.appendix.heading']}\n`);
    writeFileSync(join(run.out, 'entries/history.json'), '{"format":"excavator-product-handbook-history/1"}\n');
    assemble(run);
    expect(historyOf(text(run, 'handbook.md'))).toContain(ui['md.history.malformed']);
  });

  it('names a file by the features still verified: a feature of the file that is not verified now is left out', () => {
    const run = shared();
    expect(historyOf(text(run, 'handbook.md'))).not.toContain('Archive');
  });

  it('states the limits it counts by, as constants of the hotspot product and the lists it keeps', () => {
    expect(MIN_TOGETHER).toBe(3);
    expect(MAX_FILES_PER_COMMIT).toBe(30);
    expect(HOTSPOT_FILES).toBe(15);
    expect(CO_CHANGE_PAIRS).toBe(10);
    expect(ui['md.history.coChangeNote']).toContain('at least 3 commits');
    expect(ui['md.history.coChangeNote']).toContain('more than 30 files');
    expect(ui['md.history.coChangeNote']).toContain('The 10 pairs');
    expect(ui['md.history.hotspotsNote']).toContain('The 15 files');
  });
});

describe('the Appendix chapter', () => {
  it('is the last chapter, after the coverage section, in both views, with the three parts in order', () => {
    const run = shared();
    for (const name of ['handbook.md', 'handbook-technical.md']) {
      const body = text(run, name);
      const headings = [...body.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
      expect(headings.at(-1), name).toBe(ui['md.appendix.heading']);
      expect(headings.at(-2), name).toBe(ui['md.coverage.heading']);
      expect([...appendixOfBody(body).matchAll(/^### (.+)$/gm)].map((match) => match[1]), name).toEqual([ui['md.appendix.openHeading'], ui['md.appendix.glossaryHeading'], ui['md.appendix.sourcesHeading']]);
    }
  });

  it('writes the open questions by domain, each with the feature, its own words and the place searched, and none of a feature that is not verified', () => {
    const run = shared();
    const part = section(appendixOfBody(text(run, 'handbook.md')), `### ${ui['md.appendix.openHeading']}`);
    expect(part).toContain('Open questions: 2.');
    expect(part).toContain('#### Customer orders\n\n| Feature | Question | Searched |\n| --- | --- | --- |\n| Orders | Who approves a large order | the order form and the routes of the orders area |');
    expect(part).toContain('#### System upkeep\n\n| Feature | Question | Searched |\n| --- | --- | --- |\n| Reminders | Who approves a large order | the order form and the routes of the orders area |');
    expect(part).not.toContain('Where the archive is kept');
  });

  it('writes the glossary with the kind, the meaning with its features and the features of each term, in code point order, and nothing that was removed', () => {
    const run = shared();
    const part = section(appendixOfBody(text(run, 'handbook.md')), `### ${ui['md.appendix.glossaryHeading']}`);
    expect(part).toContain('Terms: 4.');
    expect(part).toContain('| Term | Kind | Meaning | Features |\n| --- | --- | --- | --- |\n| Clerk | Role | Create an order. (Orders, Reminders) | Orders, Reminders |\n| Draft | State label | The order is not sent yet. (Orders, Reminders) | Orders, Reminders |\n| New Order | Entry name, Screen name | - | Orders, Reminders |\n| Orders | Entry name | - | Orders, Reminders |');
    expect(part).not.toContain('Submitted');
    expect(part).not.toContain('Approver');
  });

  it('writes the sources and scope: what was read and not read, the checks, and the counts of each section as state.json holds them', () => {
    const run = shared();
    const part = section(appendixOfBody(text(run, 'handbook.md')), `### ${ui['md.appendix.sourcesHeading']}`);
    for (const key of ['md.appendix.read', 'md.appendix.notRead', 'md.appendix.checks', 'md.appendix.sectionsNote']) expect(part).toContain(ui[key]);
    const state = run.readJson('state.json');
    const records = Object.values(state.features).flatMap((entry) => entry.removed ?? []);
    const again = Object.values(state.features).reduce((sum, entry) => sum + Math.max(0, entry.attempts - 1), 0);
    const items = ['F1', 'F3'].reduce((sum, id) => sum + countEvidenceItems(run.readJson(`entries/${id}.json`)), 0);
    expect(part).toContain('| Section | Units | Verified units | Items kept | Removed by the verifiers | Removed by the tracers | Written again |');
    expect(part).toContain('| System overview | 1 | 0 | 0 | 0 | 0 | 0 |');
    expect(part).toContain(`| Feature entries | 5 | 2 | ${items} | ${records.filter((one) => one.step !== 'trace').length} | ${records.filter((one) => one.step === 'trace').length} | ${again} |`);
    expect(part).toContain('| Findings of the features | 5 | 0 | 0 | 0 | 0 | 0 |');
    expect(part).toContain('| System findings | 1 | 0 | 0 | 0 | 0 | 0 |');
    expect(part).toContain('| Part | Kept | Left out |\n| --- | --- | --- |\n| Levels of the groups of findings | 0 | 0 |\n| Causes, measures and recommendations | 0 | 0 |\n| Rows of the cross-cutting topics | 0 | 0 |');
  });

  it('counts the removals the tracers made apart from the ones the verifiers made', () => {
    const run = shared();
    const part = section(appendixOfBody(text(run, 'handbook.md')), `### ${ui['md.appendix.sourcesHeading']}`);
    expect(part).toMatch(/\| Feature entries \| 5 \| 2 \| \d+ \| 2 \| 1 \| \d+ \|/);
  });

  it('is written when no entry is verified: None. for the questions and the terms, and the sections with their units', () => {
    const run = appendixRun(cleanups);
    const state = run.readJson('state.json');
    for (const id of ['F1', 'F3']) state.features[id] = { status: 'planned', attempts: 0 };
    run.writeJson(join(run.out, 'state.json'), state);
    assemble(run);
    const body = appendixOfBody(text(run, 'handbook.md'));
    expect(section(body, `### ${ui['md.appendix.openHeading']}`)).toContain('Open questions: 0.\n\nNone.');
    expect(section(body, `### ${ui['md.appendix.glossaryHeading']}`)).toContain('Terms: 0.\n\nNone.');
  });
});

describe('no advice and no evaluation', () => {
  it('has none of the advice words in a fixed text of the two chapters', () => {
    const words = adviceWordsOf(ui);
    expect(words.length).toBeGreaterThan(5);
    const keys = Object.keys(ui).filter((key) => key.startsWith('md.history.') || key.startsWith('md.appendix.'));
    expect(keys.length).toBeGreaterThan(70);
    for (const key of keys) expect(wordsIn(ui[key], words), key).toEqual([]);
  });

  it('has none in the two chapters of the handbook of either view', () => {
    const run = shared();
    const words = adviceWordsOf(ui);
    for (const name of ['handbook.md', 'handbook-technical.md']) {
      const body = text(run, name);
      expect(wordsIn(historyOf(body), words), name).toEqual([]);
      expect(wordsIn(appendixOfBody(body), words), name).toEqual([]);
    }
  });
});

describe('the page data', () => {
  it('has the format /14, history and appendix between topics and coverage, and no path outside the technical part', () => {
    const run = shared();
    const made = page(run);
    expect(made.status, made.stdout).toBe(0);
    const data = dataOf(run);
    expect(data.format).toBe('excavator-product-handbook-page/17');
    const keys = Object.keys(data);
    expect(keys.slice(keys.indexOf('topics'), keys.indexOf('topics') + 4)).toEqual(['topics', 'history', 'appendix', 'coverage']);
    const { technical, ...product } = data;
    expect(JSON.stringify(product)).not.toContain('src/routes');
    expect(JSON.stringify(product)).not.toContain('src/app.js');
    expect(JSON.stringify(technical)).toContain('src/routes/orders.js');
  });

  it('holds the history with the file names, the features still verified, and the conventions', () => {
    const run = shared();
    page(run);
    const { history } = dataOf(run);
    expect(Object.keys(history)).toEqual(['state', 'noHistory', 'years', 'apps', 'hotspots', 'coChange', 'tests', 'conventions']);
    expect(history.state).toBe('ok');
    expect(history.hotspots[0]).toEqual({ name: 'orders.js', app: '.', commits: 5, authors: 2, lines: 20, last: '2024-09-09', uncertain: 0, features: ['F1', 'F3'] });
    expect(history.coChange).toEqual([{ a: 'app.js', appA: '.', b: 'orders.js', appB: '.', commits: 4 }]);
    expect(history.years).toEqual(goodHistory().years);
    expect(history.conventions).toEqual(['goTest', 'dotTest', 'dotSpec', 'pyPrefix', 'pySuffix', 'javaTest', 'testsDir']);
  });

  it('holds the uncertain count of each hotspot file in the page data', () => {
    const run = appendixRun(cleanups);
    const doc = goodHistory();
    doc.hotspots[1].uncertain = 4;
    writeHistory(run, doc);
    page(run);
    expect(dataOf(run).history.hotspots.map((row) => row.uncertain)).toEqual([0, 4]);
  });

  it('holds the paths of the hotspot files and of each file of a pair in the technical part, in the order of the rows', () => {
    const run = shared();
    page(run);
    const { technical } = dataOf(run);
    expect(technical.history).toEqual({ hotspots: ['src/routes/orders.js', 'src/app.js'], coChange: [{ a: 'src/app.js', b: 'src/routes/orders.js' }] });
  });

  it('holds the appendix with the ids of the features and the domains', () => {
    const run = shared();
    page(run);
    const { appendix } = dataOf(run);
    expect(Object.keys(appendix)).toEqual(['open', 'glossary', 'sources']);
    expect(appendix.open.map((row) => [row.feature, row.domain])).toEqual([['F1', 'D1'], ['F3', 'D2']]);
    expect(appendix.glossary.map((row) => row.term)).toEqual(['Clerk', 'Draft', 'New Order', 'Orders']);
    expect(appendix.sources.parts.map((part) => part.id)).toEqual(['overview', 'features', 'findings', 'system-findings']);
  });

  it('says the history is missing in the page data when the file is not there, and the appendix is still there', () => {
    const run = appendixRun(cleanups);
    page(run, 'product');
    const data = dataOf(run);
    expect(data.history).toEqual({ state: 'missing', noHistory: null, years: [], apps: [], hotspots: [], coChange: [], tests: [], conventions: ['goTest', 'dotTest', 'dotSpec', 'pyPrefix', 'pySuffix', 'javaTest', 'testsDir'] });
    expect(data.appendix.open).toHaveLength(2);
  });
});
