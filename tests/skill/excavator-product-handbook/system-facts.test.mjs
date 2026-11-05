// O1 (facts) of openspec change handbook-system-overview: the facts of the
// overview come from the script: languages, frameworks, files and lines, git
// statistics or "no version history", the counts of the whole system and the
// roles of each area from verified entries only. The same state gives the same
// bytes, and nothing in them is a run time or a local path.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clone, confirmChecked, runHandbook, verifyChecked } from './helpers.mjs';
import { checkedOverviewRun } from './overview-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const STUB = '<!doctype html><html lang="und"><head><meta charset="UTF-8"><!-- xv:csp --></head><body><div id="root"></div><!-- xv:data --></body></html>';
const stubDir = mkdtempSync(join(tmpdir(), 'xhb-stub-'));
const stubPath = join(stubDir, 'template.html');
writeFileSync(stubPath, STUB);
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

const page = (run) => runHandbook(['page', run.out, '--project', run.root], { env: { ...process.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
const dataOf = (run) => JSON.parse(/<script type="application\/json" id="xv-product-handbook-data">([\s\S]*?)<\/script>/.exec(readFileSync(join(run.out, 'handbook.html'), 'utf-8'))[1]);
const systemOf = (run) => {
  const made = page(run);
  expect(made.status, made.stdout + made.stderr).toBe(0);
  return dataOf(run).system;
};

/** A verified overview over the fixture project. */
function verifiedOverview(adjust) {
  const run = checkedOverviewRun(cleanups, adjust);
  verifyChecked(run, 'overview');
  return run;
}

/** Run git in `cwd` with a fixed identity and date, no user or system configuration. */
function git(cwd, args, { name = 'Dev', email = 'dev@example.org', date = '2024-01-01T12:00:00+0000' } = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: name,
      GIT_AUTHOR_EMAIL: email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: name,
      GIT_COMMITTER_EMAIL: email,
      GIT_COMMITTER_DATE: date,
    },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

/** Commit a change to `file` (a path under `cwd`) with an author and a date: a commit that touches no file is not in the history of any directory. */
function commit(cwd, file, who) {
  writeFileSync(join(cwd, file), `${who.date}\n`);
  git(cwd, ['add', '-A'], who);
  git(cwd, ['commit', '-q', '-m', `change ${file}`], who);
}

/** The line count of a text the way a reader of the file counts it: a final newline does not start a line. */
const linesOf = (text) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));

/** The JavaScript files of the fixture project (no test file, nothing under a skipped directory), by walking the copy. */
function javascriptFiles(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !['node_modules', '.git', 'dist', 'build', 'vendor', '.excavator'].includes(entry.name)) walk(join(dir, entry.name));
      else if (entry.isFile() && entry.name.endsWith('.js') && !/\.test\./.test(entry.name)) found.push(join(dir, entry.name));
    }
  };
  walk(root);
  return found;
}

describe('system facts: languages, frameworks, files and lines of an application', () => {
  it('counts the source files of the application by extension and the lines of the same files; the frameworks come from the candidates, most first', () => {
    const run = verifiedOverview();
    const [app] = systemOf(run).applications;
    const files = javascriptFiles(run.root);
    expect(app.dir).toBe('.');
    expect(app.name).toBe('Order tool');
    expect(app.languages).toEqual([{ language: 'JavaScript', files: files.length }]);
    expect(app.files).toBe(files.length);
    expect(app.lines).toBe(files.reduce((sum, file) => sum + linesOf(readFileSync(file, 'utf-8')), 0));
    const byFramework = new Map();
    for (const item of run.candidates.items) byFramework.set(item.framework, (byFramework.get(item.framework) ?? 0) + 1);
    const expected = [...byFramework].map(([framework, candidates]) => ({ framework, candidates })).sort((a, b) => b.candidates - a.candidates || a.framework.localeCompare(b.framework));
    expect(expected.length).toBeGreaterThan(0);
    expect(app.frameworks).toEqual(expected);
  });

  it('counts a missing final newline as a line, groups the languages by file count, and skips test files, binary files and skipped directories', () => {
    const run = verifiedOverview();
    const before = systemOf(run).applications[0];
    writeFileSync(join(run.root, 'src', 'extra.ts'), 'a\nb\nc');
    writeFileSync(join(run.root, 'src', 'second.ts'), 'a\n');
    writeFileSync(join(run.root, 'src', 'extra.test.ts'), 'a\nb\nc\nd\n');
    writeFileSync(join(run.root, 'src', 'blob.ts'), Buffer.from([0x61, 0x00, 0x62, 0x0a]));
    mkdirSync(join(run.root, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(run.root, 'node_modules', 'dep', 'index.js'), 'x\n');
    const after = systemOf(run).applications[0];
    expect(after.files - before.files).toBe(2);
    expect(after.lines - before.lines).toBe(4);
    expect(after.languages).toEqual([{ language: 'JavaScript', files: before.files }, { language: 'TypeScript', files: 2 }]);
  });

  it('is the same on two runs, holds no project path and no run time', () => {
    const run = verifiedOverview();
    const first = JSON.stringify(systemOf(run));
    expect(JSON.stringify(systemOf(run))).toBe(first);
    expect(first).not.toContain(run.root);
    expect(first).not.toContain(run.out);
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(runHandbook(['assemble', run.out, '--project', run.root]).status).toBe(0);
    const md = readFileSync(join(run.out, 'handbook.md'), 'utf-8');
    expect(runHandbook(['assemble', run.out, '--project', run.root]).status).toBe(0);
    expect(readFileSync(join(run.out, 'handbook.md'), 'utf-8')).toBe(md);
    expect(md).not.toContain(run.root);
  });
});

describe('system facts: version history', () => {
  it('a directory outside any git work tree says there is no version history', () => {
    const run = verifiedOverview();
    expect(systemOf(run).applications[0].history).toBeNull();
    runHandbook(['assemble', run.out, '--project', run.root]);
    const md = readFileSync(join(run.out, 'handbook.md'), 'utf-8');
    expect(md).toContain('| . | Order tool | Serves the order pages and sends reminders. | JavaScript (');
    expect(md.match(/No version history/g)).toHaveLength(4);
  });

  it('counts the first and last commit date, the commits without merges and the distinct author emails of the directory', () => {
    const run = verifiedOverview();
    git(run.root, ['init', '-q']);
    git(run.root, ['checkout', '-q', '-b', 'main']);
    git(run.root, ['add', '-A']);
    git(run.root, ['commit', '-q', '-m', 'one'], { name: 'A', email: 'a@example.org', date: '2023-02-01T10:00:00+0000' });
    git(run.root, ['checkout', '-q', '-b', 'topic']);
    commit(run.root, 'topic.txt', { name: 'B', email: 'b@example.org', date: '2023-06-15T10:00:00+0000' });
    git(run.root, ['checkout', '-q', 'main']);
    commit(run.root, 'main.txt', { name: 'A again', email: 'A@example.org', date: '2024-01-20T10:00:00+0000' });
    git(run.root, ['merge', '-q', '--no-ff', '-m', 'merge', 'topic'], { name: 'C', email: 'c@example.org', date: '2024-05-01T10:00:00+0000' });
    const [app] = systemOf(run).applications;
    expect(app.history).toEqual({ first: '2023-02-01', last: '2024-01-20', commits: 3, authors: 2 });
    runHandbook(['assemble', run.out, '--project', run.root]);
    const md = readFileSync(join(run.out, 'handbook.md'), 'utf-8');
    expect(md).toMatch(/\| 2023-02-01 \| 2024-01-20 \| 3 \| 2 \|/);
    expect(md).not.toContain('No version history');
  });

  it('counts only the history under the directory of the application', () => {
    const run = verifiedOverview((doc, r) => {
      mkdirSync(join(r.root, 'tools'), { recursive: true });
      writeFileSync(join(r.root, 'tools', 'package.json'), '{ "name": "tools" }\n');
      writeFileSync(join(r.root, 'tools', 'run.js'), 'module.exports = 1;\n');
      doc.applications.push({ dir: 'tools', name: 'Tools', does: 'Runs maintenance work.', evidence: [{ file: 'tools/package.json', passage: '{ "name": "tools" }' }] });
    });
    git(run.root, ['init', '-q']);
    git(run.root, ['checkout', '-q', '-b', 'main']);
    git(run.root, ['add', '-A']);
    git(run.root, ['commit', '-q', '-m', 'one'], { date: '2022-03-03T10:00:00+0000' });
    writeFileSync(join(run.root, 'tools', 'run.js'), 'module.exports = 2;\n');
    git(run.root, ['commit', '-q', '-am', 'two'], { name: 'T', email: 't@example.org', date: '2022-09-09T10:00:00+0000' });
    const apps = Object.fromEntries(systemOf(run).applications.map((app) => [app.dir, app]));
    expect(apps.tools.history).toEqual({ first: '2022-03-03', last: '2022-09-09', commits: 2, authors: 2 });
    expect(apps['.'].history.commits).toBe(2);
  });
});

describe('system facts: counts and areas', () => {
  /** Write, check and verify (or only confirm) the entry of feature `id` with the given roles. */
  function writeUnit(run, id, roles, finish) {
    const entry = clone(run.entry);
    entry.id = id;
    entry.who = roles.map((role) => ({ role, can: `Works as ${role}.`, evidence: run.entry.who[0].evidence }));
    run.writeEntry(id, entry);
    expect(run.run('check-entry', id).status).toBe(0);
    finish(run, id);
  }

  it('counts applications, files, lines, areas, features, verified features and roles, from the script', () => {
    const run = verifiedOverview();
    writeUnit(run, 'F1', ['Clerk'], verifyChecked);
    const { counts, applications } = systemOf(run);
    expect(counts).toEqual({ applications: 1, files: applications[0].files, lines: applications[0].lines, areas: 2, features: 5, featuresWithEntry: 1, roles: 2 });
  });

  it('lists the roles of an area from its verified entries, in the order of the map roles, not the order of the entries', () => {
    const run = verifiedOverview();
    writeUnit(run, 'F1', ['Approver'], verifyChecked);
    writeUnit(run, 'F2', ['Clerk'], verifyChecked);
    expect(systemOf(run).areas).toEqual([
      { id: 'A1', name: 'Order handling', features: 2, verified: 2, roles: ['Clerk', 'Approver'] },
      { id: 'A2', name: 'Automatic work', features: 3, verified: 0, roles: [] },
    ]);
  });

  it('takes no role from a confirmed entry and does not count it as verified', () => {
    const run = verifiedOverview();
    writeUnit(run, 'F1', ['Clerk'], verifyChecked);
    writeUnit(run, 'F2', ['Approver'], confirmChecked);
    expect(run.readJson('state.json').features.F2.status).toBe('confirmed');
    const [area] = systemOf(run).areas;
    expect(area).toEqual({ id: 'A1', name: 'Order handling', features: 2, verified: 1, roles: ['Clerk'] });
  });
});
