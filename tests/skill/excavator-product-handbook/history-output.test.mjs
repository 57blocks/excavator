// The Code health chapter (openspec changes handbook-history-appendix and handbook-skill-first): it comes after the feature chapters
// and before the coverage section, in both views; the product view shows a file by its name and the application it is in and never a
// path; a feature is named only when it has a chapter; a project with no version history, a missing file and a malformed file each
// have their own line; no fixed text or written line advises or evaluates. (The page data's half is in page-scripts.test.mjs.)
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { adviceWordsOf, wordsIn } from '../../../skills/excavator-product-handbook/lib/word-lists.mjs';
import { MAX_FILES_PER_COMMIT, MIN_TOGETHER } from '../../../skills/excavator/hotspots/co-change.mjs';
import { HOTSPOT_FILES, CO_CHANGE_PAIRS } from '../../../skills/excavator-product-handbook/lib/history-hotspots.mjs';
import { chapterText, newMdRun } from './md-run-fixture.mjs';
import { goodHistory, writeHistory } from './history-doc-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const ui = JSON.parse(readFileSync(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url), 'utf-8')).strings;
const text = (run, name) => readFileSync(join(run.out, name), 'utf-8');
const assemble = (run, views = 'product') => {
  const result = run.run('assemble', '--views', views);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return result;
};

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
/**
 * A run with the system chapter and the chapters of F1 and F3 (F2 has none), checked; the history file is not written.
 * Hotspots that cite F2 must not name it.
 */
function historyRun(cleanups_) {
  const run = newMdRun({ system: chapterText('System'), F1: chapterText('Orders'), F3: chapterText('Reminders') });
  cleanups_.push(run.cleanup);
  return run;
}

// The tests that only read share one run with a history file; the ones that change it build their own.
const sharedCleanups = [];
let sharedRun = null;
function shared() {
  if (sharedRun === null) {
    sharedRun = historyRun(sharedCleanups);
    writeHistory(sharedRun);
    assemble(sharedRun, 'product,technical');
  }
  return sharedRun;
}
afterAll(() => {
  while (sharedCleanups.length > 0) sharedCleanups.pop()();
});

describe('the Code health chapter', () => {
  it('comes after the feature chapters and before the coverage section, in both views', () => {
    const run = shared();
    for (const name of ['handbook.md', 'handbook-technical.md']) {
      const body = text(run, name);
      const at = (heading) => body.indexOf(`\n## ${heading}\n`);
      expect(at('Reminders'), name).toBeGreaterThan(0);
      expect(at(ui['md.history.heading']), name).toBeGreaterThan(at('Reminders'));
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
    const run = historyRun(cleanups);
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
    const run = historyRun(cleanups);
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
    const run = historyRun(cleanups);
    writeHistory(run, { ...goodHistory(), noHistory: { reason: 'inside-repository' }, years: [], apps: [{ dir: '.', first: null, last: null, commits: null, authors: null, authors80: null, reason: 'inside-repository' }], hotspots: [], coChange: [] });
    assemble(run);
    const body = historyOf(text(run, 'handbook.md'));
    expect(body).toContain('There is no version history to count: the project directory is inside a git repository that it is not the root of. The test files below are counted from the project files.');
    expect(body).toContain('| . | 9 | 2 |');
    expect(body).not.toContain(ui['md.history.yearsHeading']);
    expect(body).not.toContain(ui['md.history.hotspotsHeading']);
  });

  it('writes no chapter when the file is missing, and says the file is not in the format when it is malformed', () => {
    const run = historyRun(cleanups);
    assemble(run);
    expect(text(run, 'handbook.md')).not.toContain(`\n## ${ui['md.history.heading']}\n`);
    mkdirSync(join(run.out, 'entries'), { recursive: true });
    writeFileSync(join(run.out, 'entries/history.json'), '{"format":"excavator-product-handbook-history/1"}\n');
    assemble(run);
    expect(historyOf(text(run, 'handbook.md'))).toContain(ui['md.history.malformed']);
  });

  it('names a file by the features that have a chapter: a feature of the file with no chapter is left out', () => {
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

describe('no advice and no evaluation', () => {
  it('has none of the advice words in a fixed text of the chapter', () => {
    const words = adviceWordsOf(ui);
    expect(words.length).toBeGreaterThan(5);
    const keys = Object.keys(ui).filter((key) => key.startsWith('md.history.'));
    expect(keys.length).toBeGreaterThan(40);
    for (const key of keys) expect(wordsIn(ui[key], words), key).toEqual([]);
  });

  it('has none in the chapter of the handbook of either view', () => {
    const run = shared();
    const words = adviceWordsOf(ui);
    for (const name of ['handbook.md', 'handbook-technical.md']) {
      const body = text(run, name);
      expect(wordsIn(historyOf(body), words), name).toEqual([]);
    }
  });
});
