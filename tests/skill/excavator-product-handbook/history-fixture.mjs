/**
 * The projects the history tests share (openspec change handbook-history-appendix):
 * a throwaway multi-repo parent holding two git repositories with fixed authors and
 * fixed commit times, and a plain directory that is in no repository. Every file is
 * purpose-built; git runs with the host's global and system configuration switched
 * off and an explicit identity, so no result depends on the machine.
 *
 * `mono` is one repository with two applications (`api`, `web`) that are changed
 * together in several commits, and `solo` is a second repository with one
 * application. The first commit of `mono` is written at 01:30 on 1 January 2023 in
 * a +02:00 time zone, which is 23:30 on 31 December 2022 in UTC: a year taken from
 * the author's local date and a year taken in UTC differ for it.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Fixed people: name and email. */
export const ANN = ['Ann', 'ann@example.test'];
export const BOB = ['Bob', 'bob@example.test'];
export const CY = ['Cy', 'cy@example.test'];
export const DEE = ['Dee', 'dee@example.test'];
export const EVE = ['Eve', 'eve@example.test'];

export const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0' };

/** Run git in `dir`. */
export function git(dir, args, env = {}) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', env: { ...GIT_ENV, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** A short throwaway directory; the caller removes it through `cleanups`. */
export function tempDir(cleanups, prefix = 'xh-') {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** `lines` numbered lines of text, the first one carrying `tag` so that two versions of a file differ. */
export const body = (tag, lines) => Array.from({ length: lines }, (_, index) => `${index === 0 ? tag : 'line'} ${index + 1}`).join('\n') + '\n';

/** Initialise a repository at `dir` (created when absent). */
function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  for (const [key, value] of Object.entries({ 'gc.auto': '0', 'maintenance.auto': 'false', 'commit.gpgsign': 'false', 'user.useConfigOnly': 'true' })) git(dir, ['config', key, value]);
}

/** Write `files` (path -> text) under `dir`, add them and commit with the author and the ISO time `when`. */
function commit(dir, files, [name, email], when, message) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git(dir, ['add', '-A']);
  const env = { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: when, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_COMMITTER_DATE: when };
  git(dir, ['commit', '-q', '--allow-empty-message', '-m', message], env);
}

/**
 * The multi-repo parent. Returns its real path.
 *
 * mono (applications `mono/api` and `mono/web`; 8 commits):
 *   c1 Ann  2023-01-01T01:30+02:00 (2022-12-31 23:30 UTC) adds api/main.go (12 lines), api/util.go (4), web/app.js (6)
 *   c2 Ann  2023-02-10 api/main.go + web/app.js     c3 Ann 2023-03-10 api/main.go + web/app.js
 *   c4 Bob  2023-04-10 api/main.go + web/app.js     c5 Ann 2023-05-01 api/main.go + api/util.go
 *   c6 Bob  2023-06-01 api/main.go + api/util.go    c7 Ann 2023-07-01 api/main.go + api/util.go
 *   c8 Cy   2024-01-15 adds web/src/view.js and the test files api/main_test.go, web/app.test.js, web/__tests__/extra.js
 * solo (application `solo`; 3 commits):
 *   s1 Dee 2024-03-01 adds index.js (3 lines), lib/Cart.java, lib/CartTest.java, lib/CartTests.java, spec/a.spec.ts, tools/tools.py, tools/test_tools.py, tools/tools_test.py, README.md
 *   s2 Dee 2025-05-05 index.js     s3 Eve 2025-06-06 index.js
 * `solo/node_modules/dep/dep.test.js` is on disk and not committed (a skipped directory).
 */
export function multiRepoProject(cleanups) {
  const parent = tempDir(cleanups);
  const mono = join(parent, 'mono');
  initRepo(mono);
  commit(mono, {
    'api/go.mod': 'module example.test/api\n',
    'api/main.go': body('v1', 12),
    'api/util.go': body('v1', 4),
    'web/package.json': '{ "name": "web" }\n',
    'web/app.js': body('v1', 6),
  }, ANN, '2023-01-01T01:30:00+0200', 'c1');
  commit(mono, { 'api/main.go': body('v2', 12), 'web/app.js': body('v2', 6) }, ANN, '2023-02-10T12:00:00+0000', 'c2');
  commit(mono, { 'api/main.go': body('v3', 12), 'web/app.js': body('v3', 6) }, ANN, '2023-03-10T12:00:00+0000', 'c3');
  commit(mono, { 'api/main.go': body('v4', 12), 'web/app.js': body('v4', 6) }, BOB, '2023-04-10T12:00:00+0000', 'c4');
  commit(mono, { 'api/main.go': body('v5', 12), 'api/util.go': body('v2', 4) }, ANN, '2023-05-01T12:00:00+0000', 'c5');
  commit(mono, { 'api/main.go': body('v6', 12), 'api/util.go': body('v3', 4) }, BOB, '2023-06-01T12:00:00+0000', 'c6');
  commit(mono, { 'api/main.go': body('v7', 12), 'api/util.go': body('v4', 4) }, ANN, '2023-07-01T12:00:00+0000', 'c7');
  commit(mono, {
    'web/src/view.js': body('v1', 3),
    'api/main_test.go': body('t1', 2),
    'web/app.test.js': body('t1', 2),
    'web/__tests__/extra.js': body('t1', 2),
  }, CY, '2024-01-15T12:00:00+0000', 'c8');

  const solo = join(parent, 'solo');
  initRepo(solo);
  commit(solo, {
    'package.json': '{ "name": "solo" }\n',
    'index.js': body('v1', 3),
    'lib/Cart.java': body('v1', 2),
    'lib/CartTest.java': body('t1', 2),
    'lib/CartTests.java': body('t1', 2),
    'spec/a.spec.ts': body('t1', 2),
    'tools/tools.py': body('v1', 2),
    'tools/test_tools.py': body('t1', 2),
    'tools/tools_test.py': body('t1', 2),
    'README.md': 'Notes.\n',
  }, DEE, '2024-03-01T12:00:00+0000', 's1');
  commit(solo, { 'index.js': body('v2', 3) }, DEE, '2025-05-05T12:00:00+0000', 's2');
  commit(solo, { 'index.js': body('v3', 3) }, EVE, '2025-06-06T12:00:00+0000', 's3');
  mkdirSync(join(solo, 'node_modules/dep'), { recursive: true });
  writeFileSync(join(solo, 'node_modules/dep/dep.test.js'), body('x', 2));
  return parent;
}

/** A plain directory in no repository: two applications, one with test files. */
export function plainProject(cleanups) {
  const dir = tempDir(cleanups);
  const files = {
    'shop/package.json': '{ "name": "shop" }\n',
    'shop/index.js': body('v1', 3),
    'shop/index.test.js': body('t1', 2),
    'shop/__tests__/a.js': body('t1', 2),
    'tool/go.mod': 'module example.test/tool\n',
    'tool/main.go': body('v1', 3),
    'tool/main_test.go': body('t1', 2),
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

/** A SHA-256 over every file under `root` (name and bytes, `.git` included), in name order. */
export function treeDigest(root) {
  const hash = createHash('sha256');
  const visit = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        hash.update(`dir ${childRel}\n`);
        visit(join(dir, entry.name), childRel);
      } else if (entry.isFile()) {
        hash.update(`file ${childRel} `);
        hash.update(readFileSync(join(dir, entry.name)));
        hash.update('\n');
      } else {
        hash.update(`other ${childRel}\n`);
      }
    }
  };
  visit(root, '');
  return hash.digest('hex');
}
