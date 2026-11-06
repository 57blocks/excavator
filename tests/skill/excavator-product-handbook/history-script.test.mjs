// O1 (history) of openspec change handbook-history-appendix: `handbook.mjs history <out> --project <root>` writes
// <out>/entries/history.json from git and the project files with no model: commits per year (author time, UTC) with the
// distinct-commit total and the count of each application, the first and last commit, commits, authors and the authors
// that make up 80% of the commits of each application, the top files by score with their application and the verified
// features that cite them, the file pairs changed together across applications only, and the source and test files of
// each application by a fixed naming convention. A project outside git writes `noHistory` with the reason and still
// counts the test files. The project directory is byte-identical before and after.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildHotspots } from '../../../skills/excavator/hotspots.mjs';
import { authorsFor, readCommits } from '../../../skills/excavator-product-handbook/lib/history-facts.mjs';
import { HISTORY_FORMAT, checkHistoryShape, loadHistorySection } from '../../../skills/excavator-product-handbook/lib/history-shape.mjs';
import { isTestFile } from '../../../skills/excavator-product-handbook/lib/history-tests.mjs';
import { HANDBOOK_SCRIPT } from './helpers.mjs';
import { GIT_ENV, git, multiRepoProject, plainProject, tempDir, treeDigest } from './history-fixture.mjs';
import { spawnSync } from 'node:child_process';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

/** `handbook.mjs history <out> --project <root>`, with the host's git configuration switched off. */
function runHistory(out, root, extra = []) {
  const result = spawnSync(process.execPath, [HANDBOOK_SCRIPT, 'history', out, '--project', root, ...extra], { encoding: 'utf-8', env: GIT_ENV });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, lines: result.stdout.split('\n').filter((line) => line !== '') };
}

const readHistory = (out) => JSON.parse(readFileSync(join(out, 'entries/history.json'), 'utf-8'));

/** The project and its history, written once per test that needs it. */
function written() {
  const root = multiRepoProject(cleanups);
  const out = tempDir(cleanups, 'xh-out-');
  const result = runHistory(out, root);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return { root, out, result, history: readHistory(out) };
}

describe('handbook.mjs history: the years', () => {
  it('counts the commits of each year by author time in UTC, the total as distinct commits and the count of each application', () => {
    const { history } = written();
    // The first commit of mono is 2023-01-01 01:30 at +02:00, which is 2022-12-31 in UTC.
    expect(history.years).toEqual([
      { year: 2022, commits: 1, byApp: { 'mono/api': 1, 'mono/web': 1 } },
      { year: 2023, commits: 6, byApp: { 'mono/api': 6, 'mono/web': 3 } },
      { year: 2024, commits: 2, byApp: { 'mono/api': 1, 'mono/web': 1, solo: 1 } },
      { year: 2025, commits: 2, byApp: { solo: 2 } },
    ]);
  });

  it('has a row for every year from the first commit to the last, a year without commits with a zero and no application', () => {
    const root = multiRepoProject(cleanups);
    writeFileSync(join(root, 'solo/index.js'), 'export const late = 1;\n');
    spawnSync('git', ['-C', join(root, 'solo'), 'add', '-A'], { env: GIT_ENV });
    spawnSync('git', ['-C', join(root, 'solo'), '-c', 'user.name=Dee', '-c', 'user.email=dee@example.test', 'commit', '-q', '-m', 'late'], { env: { ...GIT_ENV, GIT_AUTHOR_DATE: '2027-01-02T12:00:00+0000', GIT_COMMITTER_DATE: '2027-01-02T12:00:00+0000' } });
    const out = tempDir(cleanups, 'xh-out-');
    expect(runHistory(out, root).status).toBe(0);
    const { years } = readHistory(out);
    expect(years.map((row) => row.year)).toEqual([2022, 2023, 2024, 2025, 2026, 2027]);
    expect(years[4]).toEqual({ year: 2026, commits: 0, byApp: {} });
    expect(years[5]).toEqual({ year: 2027, commits: 1, byApp: { solo: 1 } });
  });
});

describe('the commits read for an application', () => {
  const cleanups = [];
  afterEach(() => { while (cleanups.length > 0) cleanups.pop()(); });

  it('keeps a commit of a merged branch whose change the main line also made, which a simplified log would drop', () => {
    const root = tempDir(cleanups);
    const who = (name, when) => ({ GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: `${name}@example.test`, GIT_AUTHOR_DATE: when, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: `${name}@example.test`, GIT_COMMITTER_DATE: when });
    git(root, ['init', '-q', '-b', 'main']);
    writeFileSync(join(root, 'a.js'), 'one\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'one'], who('ann', '2023-01-01T00:00:00+0000'));
    git(root, ['checkout', '-q', '-b', 'topic']);
    writeFileSync(join(root, 'b.js'), 'same\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'branch'], who('bob', '2023-02-01T00:00:00+0000'));
    git(root, ['checkout', '-q', 'main']);
    writeFileSync(join(root, 'b.js'), 'same\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'main'], who('ann', '2023-03-01T00:00:00+0000'));
    git(root, ['merge', '-q', '--no-ff', '-m', 'merge', 'topic'], who('cy', '2023-04-01T00:00:00+0000'));
    const commits = readCommits(root, '.');
    expect(commits.map((c) => c.author).sort()).toEqual(['ann@example.test', 'ann@example.test', 'bob@example.test']);
  });
});

describe('handbook.mjs history: the applications', () => {
  it('writes the first and last commit day, the commits, the authors and the authors of 80% of the commits of each application', () => {
    const { history } = written();
    expect(history.apps).toEqual([
      { dir: 'mono/api', first: '2022-12-31', last: '2024-01-15', commits: 8, authors: 3, authors80: 2, reason: null },
      { dir: 'mono/web', first: '2022-12-31', last: '2024-01-15', commits: 5, authors: 3, authors80: 2, reason: null },
      { dir: 'solo', first: '2024-03-01', last: '2025-06-06', commits: 3, authors: 2, authors80: 2, reason: null },
    ]);
  });

  it('counts the authors of 80% as the fewest authors, most commits first, whose commits are not fewer than 80% (exactly 80% is enough)', () => {
    expect(authorsFor([5, 2, 1])).toBe(2); // 5 of 8 is 62.5%, 7 of 8 is 87.5%
    expect(authorsFor([3, 1, 1])).toBe(2); // 4 of 5 is exactly 80%
    expect(authorsFor([1, 1, 1, 1, 1])).toBe(4); // 4 of 5 is exactly 80%
    expect(authorsFor([9, 1])).toBe(1); // 9 of 10 is 90%
    expect(authorsFor([8, 1, 1])).toBe(1); // 8 of 10 is exactly 80%
    expect(authorsFor([7, 1, 1, 1])).toBe(2); // 7 of 10 is 70%, 8 of 10 is 80%
    expect(authorsFor([1])).toBe(1);
    expect(authorsFor([])).toBe(0);
  });

  it('writes null for every fact of an application outside any repository, with the reason, and still counts its files', () => {
    const root = multiRepoProject(cleanups);
    mkdirSync(join(root, 'loose'), { recursive: true });
    writeFileSync(join(root, 'loose/package.json'), '{ "name": "loose" }\n');
    writeFileSync(join(root, 'loose/run.js'), 'run();\n');
    writeFileSync(join(root, 'loose/run.test.js'), 'test();\n');
    const out = tempDir(cleanups, 'xh-out-');
    expect(runHistory(out, root).status).toBe(0);
    const history = readHistory(out);
    expect(history.noHistory).toBeNull();
    expect(history.apps.find((row) => row.dir === 'loose')).toEqual({ dir: 'loose', first: null, last: null, commits: null, authors: null, authors80: null, reason: 'not-a-repository' });
    expect(history.tests.find((row) => row.dir === 'loose')).toEqual({ dir: 'loose', sourceFiles: 1, testFiles: 1 });
    // The other applications and the years are not changed by it.
    expect(history.apps.filter((row) => row.reason === null).map((row) => row.dir)).toEqual(['mono/api', 'mono/web', 'solo']);
    expect(history.years.map((row) => row.commits)).toEqual([1, 6, 2, 2]);
  });
});

describe('handbook.mjs history: the hotspots', () => {
  it('lists the files by commits x lines, highest first, with the application, the counts and the last change day', () => {
    const { history } = written();
    expect(history.hotspots.slice(0, 5)).toEqual([
      { path: 'mono/api/main.go', app: 'mono/api', commits: 7, authors: 2, lines: 12, last: '2023-07-01', features: [] },
      { path: 'mono/web/app.js', app: 'mono/web', commits: 4, authors: 2, lines: 6, last: '2023-04-10', features: [] },
      { path: 'mono/api/util.go', app: 'mono/api', commits: 4, authors: 2, lines: 4, last: '2023-07-01', features: [] },
      { path: 'solo/index.js', app: 'solo', commits: 3, authors: 2, lines: 3, last: '2025-06-06', features: [] },
      { path: 'mono/web/src/view.js', app: 'mono/web', commits: 1, authors: 1, lines: 3, last: '2024-01-15', features: [] },
    ]);
    expect(history.hotspots.length).toBeLessThanOrEqual(15);
  });

  it('keeps at most 15 files', () => {
    const root = multiRepoProject(cleanups);
    const files = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`extra/e${String(index).padStart(2, '0')}.js`, `export const e${index} = ${index};\n`]));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, 'solo/extra'), { recursive: true });
      writeFileSync(join(root, 'solo', path), text);
    }
    spawnSync('git', ['-C', join(root, 'solo'), 'add', '-A'], { env: GIT_ENV });
    spawnSync('git', ['-C', join(root, 'solo'), '-c', 'user.name=Dee', '-c', 'user.email=dee@example.test', 'commit', '-q', '-m', 'many'], { env: { ...GIT_ENV, GIT_AUTHOR_DATE: '2025-07-07T12:00:00+0000', GIT_COMMITTER_DATE: '2025-07-07T12:00:00+0000' } });
    const out = tempDir(cleanups, 'xh-out-');
    expect(runHistory(out, root).status).toBe(0);
    expect(readHistory(out).hotspots).toHaveLength(15);
  });

  it('names the verified features whose entries cite the file, in the order of the state, and no feature that is not verified', () => {
    const root = multiRepoProject(cleanups);
    const out = tempDir(cleanups, 'xh-out-');
    const cite = (...files) => ({ evidence: files.map((file) => ({ file, passage: 'p' })), nested: [{ evidence: [{ file: files[0], passage: 'q' }] }] });
    writeFileSync(join(out, 'state.json'), `${JSON.stringify({ format: 'excavator-product-handbook-state/1', features: { F1: { status: 'verified', attempts: 1 }, F2: { status: 'checked', attempts: 1 }, F3: { status: 'verified', attempts: 1 } } })}\n`);
    mkdirSync(join(out, 'entries'), { recursive: true });
    writeFileSync(join(out, 'entries/F1.json'), `${JSON.stringify({ purpose: cite('mono/api/main.go') })}\n`);
    writeFileSync(join(out, 'entries/F2.json'), `${JSON.stringify({ purpose: cite('solo/index.js', 'mono/api/main.go') })}\n`);
    writeFileSync(join(out, 'entries/F3.json'), `${JSON.stringify({ who: [cite('mono/web/app.js', 'mono/api/main.go')] })}\n`);
    expect(runHistory(out, root).status).toBe(0);
    const byPath = Object.fromEntries(readHistory(out).hotspots.map((row) => [row.path, row.features]));
    expect(byPath['mono/api/main.go']).toEqual(['F1', 'F3']);
    expect(byPath['mono/web/app.js']).toEqual(['F3']);
    expect(byPath['solo/index.js']).toEqual([]);
  });

  it('leaves out a file with no score and a file with no commit', () => {
    const { history } = written();
    expect(history.hotspots.every((row) => row.commits >= 1 && Number.isInteger(row.lines))).toBe(true);
  });
});

describe('handbook.mjs history: the files changed together', () => {
  it('lists only pairs whose two files are in different applications, with their shared commits', () => {
    const { root, history } = written();
    // The instrument: the hotspot product does list the pair inside one application, so the filter has something to remove.
    return buildHotspots(root).then((product) => {
      const inOne = product.pairs.find((pair) => pair.a === 'mono/api/main.go' && pair.b === 'mono/api/util.go');
      expect(inOne?.together).toBe(4);
      expect(product.pairs).toHaveLength(2);
      expect(history.coChange).toEqual([{ a: 'mono/api/main.go', b: 'mono/web/app.js', commits: 4 }]);
    });
  });
});

describe('handbook.mjs history: the source and test files', () => {
  it('counts the source files and the test files of each application by the fixed naming convention', () => {
    const { history } = written();
    expect(history.tests).toEqual([
      { dir: 'mono/api', sourceFiles: 2, testFiles: 1 },
      { dir: 'mono/web', sourceFiles: 2, testFiles: 2 },
      { dir: 'solo', sourceFiles: 3, testFiles: 5 },
    ]);
  });

  it('recognizes each convention and nothing else', () => {
    for (const name of ['a_test.go', 'src/a_test.go', 'a.test.js', 'a.test.tsx', 'a.spec.ts', 'test_a.py', 'a/test_b.py', 'a_test.py', 'FooTest.java', 'FooTests.java', 'src/__tests__/a.js', '__tests__/b/c.ts']) {
      expect(isTestFile(name), name).toBe(true);
    }
    for (const name of ['a.go', 'testing.go', 'contest.py', 'a_tester.py', 'Test.txt', 'FooTesting.java', 'a.js', 'tests/a.js', 'src/__tests__x/a.js', 'latest_test_data.json']) {
      expect(isTestFile(name), name).toBe(false);
    }
  });

  it('does not count a directory the candidate lister skips', () => {
    const { history } = written();
    // solo/node_modules/dep/dep.test.js is on disk and not counted.
    expect(history.tests.find((row) => row.dir === 'solo').testFiles).toBe(5);
  });
});

describe('handbook.mjs history: a project that is not in git', () => {
  it('writes noHistory with the reason, null application rows with the reason, no years, hotspots or pairs, and the test counts', () => {
    const root = plainProject(cleanups);
    const out = tempDir(cleanups, 'xh-out-');
    const result = runHistory(out, root);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const history = readHistory(out);
    expect(history.noHistory).toEqual({ reason: 'not-a-repository' });
    expect(history.years).toEqual([]);
    expect(history.hotspots).toEqual([]);
    expect(history.coChange).toEqual([]);
    expect(history.apps).toEqual([
      { dir: 'shop', first: null, last: null, commits: null, authors: null, authors80: null, reason: 'not-a-repository' },
      { dir: 'tool', first: null, last: null, commits: null, authors: null, authors80: null, reason: 'not-a-repository' },
    ]);
    expect(history.tests).toEqual([
      { dir: 'shop', sourceFiles: 1, testFiles: 2 },
      { dir: 'tool', sourceFiles: 1, testFiles: 1 },
    ]);
    expect(result.lines).toEqual(['History: no version history (not-a-repository); 3 test files in 2 applications.']);
  });
});

describe('handbook.mjs history: a project that is a directory inside a repository', () => {
  it('writes noHistory with the reason inside-repository, as the hotspot product reads it, and counts the test files', () => {
    const parent = multiRepoProject(cleanups);
    const out = tempDir(cleanups, 'xh-out-');
    const result = runHistory(out, join(parent, 'mono/api'));
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const history = readHistory(out);
    expect(history.noHistory).toEqual({ reason: 'inside-repository' });
    expect(history.years).toEqual([]);
    expect(history.apps).toEqual([{ dir: '.', first: null, last: null, commits: null, authors: null, authors80: null, reason: 'inside-repository' }]);
    expect(history.tests).toEqual([{ dir: '.', sourceFiles: 2, testFiles: 1 }]);
    expect(result.lines).toEqual(['History: no version history (inside-repository); 1 test file in 1 application.']);
  });
});

describe('handbook.mjs history: the project is not written to', () => {
  it('leaves every file of a multi-repo project, .git included, byte-identical', () => {
    const root = multiRepoProject(cleanups);
    const before = treeDigest(root);
    const out = tempDir(cleanups, 'xh-out-');
    expect(runHistory(out, root).status).toBe(0);
    expect(treeDigest(root)).toBe(before);
  });

  it('leaves a plain directory byte-identical and writes no .excavator in it', () => {
    const root = plainProject(cleanups);
    const before = treeDigest(root);
    const out = tempDir(cleanups, 'xh-out-');
    expect(runHistory(out, root).status).toBe(0);
    expect(treeDigest(root)).toBe(before);
  });

  it('writes only entries/history.json into the out directory and keeps the other files of the run as they are', () => {
    const root = multiRepoProject(cleanups);
    const out = tempDir(cleanups, 'xh-out-');
    mkdirSync(join(out, 'entries'), { recursive: true });
    writeFileSync(join(out, 'entries/F1.json'), '{"a":1}\n');
    writeFileSync(join(out, 'data.json'), '{"b":2}\n');
    writeFileSync(join(out, 'state.json'), '{"format":"x","features":{}}\n');
    const before = treeDigest(out);
    expect(runHistory(out, root).status).toBe(0);
    const files = { 'entries/F1.json': '{"a":1}\n', 'data.json': '{"b":2}\n', 'state.json': '{"format":"x","features":{}}\n' };
    for (const [path, text] of Object.entries(files)) expect(readFileSync(join(out, path), 'utf-8')).toBe(text);
    expect(treeDigest(out)).not.toBe(before);
  });
});

describe('handbook.mjs history: the file and the command', () => {
  it('writes the same bytes from the same input, with no local path in them', () => {
    const root = multiRepoProject(cleanups);
    const a = tempDir(cleanups, 'xh-out-');
    const b = tempDir(cleanups, 'xh-out-');
    expect(runHistory(a, root).status).toBe(0);
    expect(runHistory(b, root).status).toBe(0);
    const text = readFileSync(join(a, 'entries/history.json'), 'utf-8');
    expect(text).toBe(readFileSync(join(b, 'entries/history.json'), 'utf-8'));
    expect(text).not.toContain(root);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('prints one line with the counts', () => {
    const { result } = written();
    expect(result.lines).toEqual(['History: 4 years (2022 to 2025), 3 applications, 11 commits; 1 pair changed together across applications; 8 test files (7 source files).']);
  });

  it('stamps the format and the file passes its own shape check', () => {
    const { history } = written();
    expect(history.format).toBe(HISTORY_FORMAT);
    expect(HISTORY_FORMAT).toBe('excavator-product-handbook-history/1');
    expect(checkHistoryShape(history)).toEqual([]);
  });

  it('exits 2 for a missing out directory argument, a missing --project, a project that is not a directory and an unknown option', () => {
    const root = multiRepoProject(cleanups);
    const out = tempDir(cleanups, 'xh-out-');
    const run = (...args) => spawnSync(process.execPath, [HANDBOOK_SCRIPT, 'history', ...args], { encoding: 'utf-8', env: GIT_ENV }).status;
    expect(run()).toBe(2);
    expect(run(out)).toBe(2);
    expect(run(out, '--project', join(out, 'absent'))).toBe(2);
    expect(run(out, '--project', root, '--views', 'product')).toBe(2);
    expect(run(out, 'extra', '--project', root)).toBe(2);
  });
});

describe('the shape check and the loader of history.json', () => {
  it('refuses a missing key, a wrong type and a count that is not a whole number', () => {
    const { history } = written();
    const without = (key) => Object.fromEntries(Object.entries(history).filter(([name]) => name !== key));
    expect(checkHistoryShape(without('years')).join('\n')).toContain('years');
    expect(checkHistoryShape({ ...history, years: [{ year: '2022', commits: 1, byApp: {} }] })).not.toEqual([]);
    expect(checkHistoryShape({ ...history, apps: [{ ...history.apps[0], commits: 1.5 }] })).not.toEqual([]);
    expect(checkHistoryShape({ ...history, hotspots: [{ ...history.hotspots[0], features: 'F1' }] })).not.toEqual([]);
    expect(checkHistoryShape({ ...history, noHistory: { reason: 'because' } })).not.toEqual([]);
    expect(checkHistoryShape({ ...history, tests: [{ dir: 'x', sourceFiles: -1, testFiles: 0 }] })).not.toEqual([]);
    expect(checkHistoryShape({ ...history, format: 'x' })).not.toEqual([]);
  });

  it('loads a written file as ok, a missing one as missing and a broken one as malformed', () => {
    const { out } = written();
    const loaded = loadHistorySection(out);
    expect(loaded.state).toBe('ok');
    expect(loaded.history.apps).toHaveLength(3);
    const empty = tempDir(cleanups, 'xh-out-');
    expect(loadHistorySection(empty)).toEqual({ state: 'missing' });
    mkdirSync(join(empty, 'entries'), { recursive: true });
    writeFileSync(join(empty, 'entries/history.json'), '{"format":"excavator-product-handbook-history/1"}\n');
    expect(loadHistorySection(empty)).toEqual({ state: 'malformed' });
    writeFileSync(join(empty, 'entries/history.json'), 'not json');
    expect(loadHistorySection(empty)).toEqual({ state: 'malformed' });
  });
});
