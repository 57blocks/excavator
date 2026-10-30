/**
 * hotspots.mjs (openspec: changes/change-hotspots, capability `change-hotspots`).
 *
 * Every fixture is a purpose-built synthetic repository made by scripted
 * commits with fixed authors, emails and dates, and git runs with the host's
 * global and system config switched off, so no result depends on the machine.
 * Commit times carry a +08:00 offset on purpose: the product keeps git's own
 * time text, and the "last changed" comparison must be by instant.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertConservation, buildHotspots, runHotspots, sinceToMs,
} from '../../../skills/excavator/hotspots.mjs';
import { countBlobLines, countBufferLines } from '../../../skills/excavator/hotspots/blob-lines.mjs';
import { readRepoHistory } from '../../../skills/excavator/hotspots/history.mjs';
import { countCoChanges } from '../../../skills/excavator/hotspots/co-change.mjs';
import { buildRows } from '../../../skills/excavator/hotspots/aggregate.mjs';
import { createLineage } from '../../../skills/excavator/hotspots/lineage.mjs';
import { explainNoHistory } from '../../../skills/excavator/hotspots/no-history.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '../../../skills/excavator/hotspots.mjs');

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

const roots = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

/** The in-process runs print the snapshot's "uncommitted changes ignored" notice; keep it out of the test log. */
const muteNotice = () => vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

function tempDir(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(dir);
  return dir;
}

function git(dir, args, env = {}) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', env: { ...GIT_ENV, ...env } });
}

function initRepo(prefix, config = {}) {
  const dir = tempDir(prefix);
  git(dir, ['init', '-q', '-b', 'main']);
  // no background gc: it can still hold files when the fixture is deleted
  for (const [key, value] of Object.entries({ 'gc.auto': '0', 'maintenance.auto': 'false', ...config })) git(dir, ['config', key, value]);
  return dir;
}

function writeFile(dir, path, content) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}

/** `2024-01-05` -> that day at 10:00 +08:00; a full timestamp is used as given. */
const stamp = (when) => (when.includes('T') ? when : `${when}T10:00:00+08:00`);

/** Stage the whole working tree and commit it with a fixed author and time. */
function stageAndCommit(dir, {
  when, who = 'alice', email = `${who}@example.test`, message = 'change',
}) {
  git(dir, ['add', '-A']);
  git(dir, ['-c', `user.name=${who}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', message], {
    GIT_AUTHOR_DATE: stamp(when),
    GIT_COMMITTER_DATE: stamp(when),
  });
}

/**
 * One scripted commit: renames first, then file writes (a string or Buffer
 * replaces the file), then removals; everything is staged and committed.
 */
function commit(dir, {
  files = {}, move = [], remove = [], ...author
}) {
  for (const [from, to] of move) {
    mkdirSync(dirname(join(dir, to)), { recursive: true });
    git(dir, ['mv', from, to]);
  }
  for (const [path, content] of Object.entries(files)) writeFile(dir, path, content);
  for (const path of remove) git(dir, ['rm', '-q', path]);
  stageAndCommit(dir, author);
}

/** A merge commit of `branch` into the checked-out branch, with a fixed author and time. */
function merge(dir, branch, when, who = 'alice') {
  git(dir, ['-c', `user.name=${who}`, '-c', `user.email=${who}@example.test`, 'merge', '--no-ff', '-q', branch, '-m', `merge ${branch}`], {
    GIT_AUTHOR_DATE: stamp(when),
    GIT_COMMITTER_DATE: stamp(when),
  });
}

const lines = (count, tag = 'line') => Array.from({ length: count }, (_, i) => `${tag} ${i + 1}\n`).join('');

function runScript(root, args = [], env = {}) {
  return spawnSync(process.execPath, [SCRIPT, root, ...args], { encoding: 'utf-8', env: { ...GIT_ENV, ...env } });
}

const productPath = (root) => join(root, '.excavator', 'hotspots.json');

function readProduct(root, args = [], env = {}) {
  const result = runScript(root, args, env);
  if (result.status !== 0) throw new Error(`hotspots.mjs exited ${result.status}\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(readFileSync(productPath(root), 'utf-8'));
}

const byPath = (rows) => Object.fromEntries(rows.map((row) => [row.path, row]));
const head = (dir) => git(dir, ['rev-parse', 'HEAD']).trim();

/** The product with the repo-independent noise removed, for "same result" comparisons. */
const counted = (product) => ({
  repos: product.repos, counts: product.counts, conservation: product.conservation, files: product.files, directories: product.directories,
});

/** a.txt renamed to b.txt, then a chain m.txt -> n.txt -> sub/o.txt (11 commits). */
function renameFixture() {
  const dir = initRepo('hotspots-rename-');
  let a = lines(10, 'a');
  commit(dir, { when: '2024-01-01', who: 'alice', files: { 'a.txt': a } });
  a += 'two\n';
  commit(dir, { when: '2024-01-02', who: 'bob', files: { 'a.txt': a } });
  a += 'three\n';
  commit(dir, { when: '2024-01-03', who: 'alice', files: { 'a.txt': a } });
  commit(dir, { when: '2024-01-04', who: 'alice', move: [['a.txt', 'b.txt']] });
  a += 'four\n';
  commit(dir, { when: '2024-01-05', who: 'carol', files: { 'b.txt': a } });
  a += 'five\n';
  commit(dir, { when: '2024-01-06', who: 'bob', files: { 'b.txt': a } });

  let m = lines(5, 'm');
  commit(dir, { when: '2024-01-07', who: 'alice', files: { 'm.txt': m } });
  commit(dir, { when: '2024-01-08', who: 'alice', move: [['m.txt', 'n.txt']] });
  m = m.replace('m 1\n', 'M 1\n');
  commit(dir, { when: '2024-01-09', who: 'bob', files: { 'n.txt': m } });
  commit(dir, { when: '2024-01-10', who: 'alice', move: [['n.txt', 'sub/o.txt']] });
  m += 'tail\n';
  commit(dir, { when: '2024-01-11', who: 'carol', files: { 'sub/o.txt': m } });
  return dir;
}

describe('history source and lineage', () => {
  it('carries a renamed file\'s history to its current path, along a whole rename chain', () => {
    const dir = renameFixture();
    const result = runScript(dir);
    expect(result.status).toBe(0);
    const product = JSON.parse(readFileSync(productPath(dir), 'utf-8'));

    expect(product.files).toEqual([
      {
        path: 'b.txt', commits: 6, authors: 3, added: 14, removed: 0, lastChanged: '2024-01-06T10:00:00+08:00', lines: 14, score: 84, lineageConflicts: 0,
      },
      {
        path: 'sub/o.txt', commits: 5, authors: 3, added: 7, removed: 1, lastChanged: '2024-01-11T10:00:00+08:00', lines: 6, score: 30, lineageConflicts: 0,
      },
    ]);
    expect(product.files.map((row) => row.path)).not.toContain('a.txt');
    expect(product.conservation).toEqual({ changesRead: 11, attributed: 11, outsideSelection: 0 });

    const summary = JSON.parse(result.stdout);
    expect(summary.product).toBe(productPath(dir));
    expect(summary.conservation).toEqual(product.conservation);
  });

  it('records the header the product promises', () => {
    const dir = renameFixture();
    const product = readProduct(dir);

    expect(product.format).toBe('excavator-hotspots/1');
    expect(product.sourceRevision).toBe(`git:${head(dir)}`);
    expect(product.sourceKind).toBe('git');
    expect(product.historyAvailable).toBe(true);
    expect(product.repos).toEqual([{
      path: '.', head: head(dir), shallow: false, boundaryCommits: 0, earliestVisibleCommit: '2024-01-01T10:00:00+08:00',
    }]);
    expect(product.window).toEqual({ since: null, sinceUtc: null });
    expect(product.counts).toEqual({ filesWithHistory: 2, filesWithoutHistory: 0, binaryFiles: 0, filesWithLineageConflicts: 0 });
    expect(product.bots).toEqual({ emailMarker: '[bot]@', commits: 0 });
    expect(product.featureGroups).toBeNull();
    expect(product.groups).toEqual([]);

    const assumptions = product.residualAssumptions.join('\n');
    for (const topic of [
      /Merge commits are not counted/, /similarity/, /Copies are not followed/, /single path map.*lineageConflicts/, /mailmap/,
      /blank lines and comments/, /rewritten/, /\.git\/config and \.git\/info\/attributes/,
      /more than 30 selected files are not counted for pairs/,
      /year of its committer date as git records it, in the committer's time zone; a rebased or cherry-picked commit counts in the year it was committed again/,
      /author email whose local part ends in \[bot\].*other automated accounts count as commits by people/,
      /feature group counts only the files its groups file lists.*nothing checks that those files make up a feature/,
    ]) {
      expect(assumptions).toMatch(topic);
    }
    for (const line of product.residualAssumptions) expect(line).toMatch(/^[\x20-\x7e]+$/);
  });

  it('counts only the commits after a delete and re-create of the same path', () => {
    const dir = initRepo('hotspots-recreate-');
    let p = lines(3, 'p');
    commit(dir, { when: '2024-01-01', who: 'alice', files: { 'p.txt': p, 'keep.txt': 'k\n' } });
    for (const [day, tail] of [['02', 'p4'], ['03', 'p5'], ['04', 'p6']]) {
      p += `${tail}\n`;
      commit(dir, { when: `2024-01-${day}`, who: 'alice', files: { 'p.txt': p } });
    }
    commit(dir, { when: '2024-01-05', who: 'alice', remove: ['p.txt'] });
    commit(dir, { when: '2024-01-06', who: 'bob', files: { 'p.txt': lines(2, 'new') } });
    commit(dir, { when: '2024-01-07', who: 'carol', files: { 'p.txt': `${lines(2, 'new')}tail\n` } });

    const product = readProduct(dir);
    expect(byPath(product.files)['p.txt']).toEqual({
      path: 'p.txt', commits: 2, authors: 2, added: 3, removed: 0, lastChanged: '2024-01-07T10:00:00+08:00', lines: 3, score: 6, lineageConflicts: 0,
    });
    expect(byPath(product.files)['keep.txt'].commits).toBe(1);
    // the four commits before the delete and the delete itself belong to no selected file
    expect(product.conservation).toEqual({ changesRead: 8, attributed: 3, outsideSelection: 5 });
  });

  it('recognises renames past git\'s default rename limit', () => {
    const dir = initRepo('hotspots-renamelimit-', { 'diff.renameLimit': '1' });
    commit(dir, { when: '2024-01-01', who: 'alice', files: { 'old1.txt': lines(20, 'alpha'), 'old2.txt': lines(20, 'beta') } });
    commit(dir, {
      when: '2024-01-02',
      who: 'bob',
      move: [['old1.txt', 'new1.txt'], ['old2.txt', 'new2.txt']],
      files: { 'new1.txt': `${lines(20, 'alpha')}extra\n`, 'new2.txt': `${lines(20, 'beta')}extra\n` },
    });

    // the fixture only means something if git, at its default limit, gives up on these renames
    const plain = execFileSync('git', ['log', '-1', '--no-merges', '-M', '--raw', '--format='], {
      cwd: dir, encoding: 'utf-8', env: { ...GIT_ENV, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'ignore'],
    });
    expect(plain).toMatch(/ D\told1\.txt/);
    expect(plain).not.toMatch(/ R\d+\t/);

    const product = readProduct(dir);
    const expected = (path) => ({
      path, commits: 2, authors: 2, added: 21, removed: 0, lastChanged: '2024-01-02T10:00:00+08:00', lines: 21, score: 42, lineageConflicts: 0,
    });
    expect(product.files).toEqual([expected('new1.txt'), expected('new2.txt')]);
    expect(product.conservation).toEqual({ changesRead: 4, attributed: 4, outsideSelection: 0 });
  });

  it('ignores staged, unstaged and untracked changes and leaves the repository alone', () => {
    const dir = initRepo('hotspots-dirty-');
    commit(dir, { when: '2024-01-01', files: { 'a.txt': lines(3), 'b.txt': lines(2) } });
    commit(dir, { when: '2024-01-02', files: { 'a.txt': `${lines(3)}more\n` } });
    const clean = readProduct(dir);

    writeFile(dir, 'a.txt', `${lines(3)}more\ndirty\n`); // unstaged
    writeFile(dir, 'b.txt', 'staged\n'); // staged
    git(dir, ['add', 'b.txt']);
    writeFile(dir, 'untracked.txt', 'u\n'); // untracked
    const before = { head: head(dir), status: git(dir, ['status', '--porcelain']), cached: git(dir, ['diff', '--cached', '--name-only']) };

    const dirty = readProduct(dir);

    expect(counted(dirty)).toEqual(counted(clean));
    expect(dirty.sourceRevision).toBe(clean.sourceRevision);
    expect({ head: head(dir), status: git(dir, ['status', '--porcelain']), cached: git(dir, ['diff', '--cached', '--name-only']) }).toEqual(before);
  });

  it('does not count a merge commit', () => {
    const dir = initRepo('hotspots-merge-');
    commit(dir, { when: '2024-01-01', files: { 'base.txt': lines(3), 'shared.txt': lines(3) } });
    git(dir, ['checkout', '-q', '-b', 'feat']);
    commit(dir, { when: '2024-01-02', who: 'bob', files: { 'feat.txt': lines(2), 'shared.txt': `${lines(3)}feat\n` } });
    git(dir, ['checkout', '-q', 'main']);
    commit(dir, { when: '2024-01-03', who: 'carol', files: { 'main.txt': lines(1) } });
    merge(dir, 'feat', '2024-01-04');
    expect(git(dir, ['rev-list', '--merges', '--count', 'HEAD']).trim()).toBe('1');

    const product = readProduct(dir);
    const files = byPath(product.files);
    expect(files['feat.txt'].commits).toBe(1);
    expect(files['main.txt'].commits).toBe(1);
    expect(files['base.txt'].commits).toBe(1);
    expect(files['shared.txt'].commits).toBe(2);
    expect(files['shared.txt'].authors).toBe(2);
    const root = byPath(product.directories)['.'];
    expect(root.commits).toBe(3);
    expect(root.authors).toBe(3); // alice, bob, carol: the merge's author adds nothing
    expect(product.conservation).toEqual({ changesRead: 5, attributed: 5, outsideSelection: 0 });
    expect(product.counts.filesWithLineageConflicts).toBe(0); // a clean merge of different paths is no conflict
  });

  it('counts an author once however many emails mailmap folds into one', () => {
    const dir = initRepo('hotspots-mailmap-');
    commit(dir, {
      when: '2024-01-01', files: { 'm.txt': lines(2), '.mailmap': 'Alice <alice@example.test> <alice.old@example.test>\n' },
    });
    commit(dir, { when: '2024-01-02', who: 'alice', email: 'alice.old@example.test', files: { 'm.txt': lines(3) } });
    commit(dir, { when: '2024-01-03', who: 'alice', email: 'alice@example.test', files: { 'm.txt': lines(4) } });
    commit(dir, { when: '2024-01-04', who: 'bob', files: { 'm.txt': lines(5) } });

    const row = byPath(readProduct(dir).files)['m.txt'];
    expect(row.commits).toBe(4);
    expect(row.authors).toBe(2);
  });

  it('keeps a path with spaces, non-ASCII text and a tab apart from its neighbours', () => {
    const dir = initRepo('hotspots-paths-');
    commit(dir, { when: '2024-01-01', files: { 'sp ace/orig é.txt': lines(4), 'tab\tname.txt': lines(2) } });
    commit(dir, {
      when: '2024-01-02', move: [['sp ace/orig é.txt', 'sp ace/é — dash.txt']], files: { 'sp ace/é — dash.txt': `${lines(4)}more\n` },
    });
    commit(dir, { when: '2024-01-03', files: { 'tab\tname.txt': `${lines(2)}more\n` } });

    const product = readProduct(dir);
    expect(byPath(product.files)['sp ace/é — dash.txt']).toMatchObject({ commits: 2, added: 5, removed: 0, lines: 5 });
    expect(byPath(product.files)['tab\tname.txt']).toMatchObject({ commits: 2, added: 3, removed: 0, lines: 3 });
    expect(product.directories.map((row) => row.path).sort()).toEqual(['.', 'sp ace']);
    expect(product.conservation).toEqual({ changesRead: 4, attributed: 4, outsideSelection: 0 });
  });

  it('reads a log that spans many pipe chunks', () => {
    const dir = initRepo('hotspots-bulk-');
    const name = (i) => `f${String(i).padStart(4, '0')}.txt`;
    const body = (i) => lines(3, `file ${i}`);
    const count = 2000;
    for (let i = 0; i < count; i += 1) writeFile(dir, `bulk/${name(i)}`, body(i));
    stageAndCommit(dir, { when: '2024-01-01', who: 'alice' });
    for (let i = 0; i < count; i += 1) writeFile(dir, `bulk/${name(i)}`, `${body(i)}more\n`);
    stageAndCommit(dir, { when: '2024-01-02', who: 'bob' });
    for (let i = 0; i < count / 2; i += 1) {
      mkdirSync(join(dir, 'moved'), { recursive: true });
      renameSync(join(dir, 'bulk', name(i)), join(dir, 'moved', name(i)));
    }
    stageAndCommit(dir, { when: '2024-01-03', who: 'carol' });
    // the log must be several chunks long for the token carry-over to matter
    expect(git(dir, ['log', '--raw', '--numstat', '-z', '-M', '-l0', '--format=%H']).length).toBeGreaterThan(5 * 65536);

    const product = readProduct(dir);

    expect(product.files).toHaveLength(count);
    const moved = product.files.filter((row) => row.path.startsWith('moved/'));
    const stayed = product.files.filter((row) => row.path.startsWith('bulk/'));
    expect(moved).toHaveLength(count / 2);
    expect(stayed).toHaveLength(count / 2);
    expect(moved.every((row) => row.commits === 3 && row.authors === 3 && row.added === 4 && row.removed === 0 && row.lines === 4 && row.score === 12)).toBe(true);
    expect(stayed.every((row) => row.commits === 2 && row.authors === 2 && row.added === 4 && row.removed === 0 && row.lines === 4 && row.score === 8)).toBe(true);
    expect(product.files.slice(0, count / 2).every((row) => row.path.startsWith('moved/'))).toBe(true);
    expect(product.conservation).toEqual({ changesRead: 5000, attributed: 5000, outsideSelection: 0 });
    expect(byPath(product.directories)['.']).toMatchObject({
      files: count, lines: count * 4, commits: 3, authors: 3, added: count * 4, removed: 0, score: 1000 * 12 + 1000 * 8,
    });
  });

  it('gives the same product under a hostile user-level git configuration', () => {
    const dir = renameFixture();
    const plain = readProduct(dir);

    const tools = tempDir('hotspots-gitconfig-');
    writeFileSync(join(tools, 'mailmap'), 'Alice <alice@example.test> <bob@example.test>\n'); // would fold bob into alice
    writeFileSync(join(tools, 'attributes'), '*.txt -diff\n'); // would make every text file binary to git
    const config = join(tools, 'config');
    writeFileSync(config, [
      '[mailmap]', `\tfile = ${join(tools, 'mailmap')}`,
      '[core]', `\tattributesFile = ${join(tools, 'attributes')}`, '\tquotePath = true', '\tbigFileThreshold = 1', // 1 byte: every file is binary to git
      '[log]', '\tshowSignature = true', '\tfollow = true',
      '[diff]', '\trenames = false', '\trenameLimit = 1', '\tnoprefix = true', '\talgorithm = patience',
      '[color]', '\tui = always',
      '[i18n]', '\tlogOutputEncoding = ISO-8859-1',
      '',
    ].join('\n'));
    const hostile = readProduct(dir, [], { GIT_CONFIG_GLOBAL: config });

    expect(hostile).toEqual(plain);
  });

  /**
   * Stands in for the runner image: the machine config trusts every directory, the repository is owned by
   * another uid, and the script's own isolation (which switches that config off for its history reads) is
   * the only thing that could make git refuse.
   */
  function foreignOwnerEnv() {
    const tools = tempDir('hotspots-trust-');
    const config = join(tools, 'config');
    writeFileSync(config, '[safe]\n\tdirectory = *\n');
    return { GIT_CONFIG_GLOBAL: config, GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' };
  }

  it('reads a repository owned by another uid, though the machine config is switched off for the history reads', () => {
    const dir = renameFixture();
    const plain = readProduct(dir);

    const foreign = readProduct(dir, [], foreignOwnerEnv());
    expect(counted(foreign)).toEqual(counted(plain));
  });

  it('reads a foreign-owned repository given by a symlinked path, trusting only the real path', () => {
    const dir = renameFixture();
    const plain = readProduct(dir);

    const links = tempDir('hotspots-link-');
    const link = join(links, 'repo-link');
    symlinkSync(dir, link);
    const foreign = readProduct(link, [], foreignOwnerEnv());
    expect(counted(foreign)).toEqual(counted(plain));
  });

  it('does not read the user attributes file, which git takes from outside its config', () => {
    const dir = renameFixture();
    const plain = readProduct(dir);

    const home = tempDir('hotspots-xdg-');
    writeFile(home, 'git/attributes', '*.txt -diff\n'); // $XDG_CONFIG_HOME/git/attributes
    const withUserAttributes = readProduct(dir, [], { XDG_CONFIG_HOME: home, HOME: home });

    expect(withUserAttributes).toEqual(plain);
    expect(plain.files[0].added).toBe(14); // not null: the text file stayed text
  });

  it('finds the history of a file renamed onto a path that was vacated by a deletion', () => {
    const dir = initRepo('hotspots-vacated-');
    commit(dir, { when: '2024-01-01', who: 'alice', files: { 'p.txt': lines(12, 'old p') } });
    commit(dir, { when: '2024-01-02', who: 'alice', files: { 'p.txt': lines(13, 'old p') } });
    commit(dir, { when: '2024-01-03', who: 'alice', remove: ['p.txt'] });
    const q = lines(12, 'q');
    commit(dir, { when: '2024-01-04', who: 'bob', files: { 'q.txt': q } });
    commit(dir, { when: '2024-01-05', who: 'bob', files: { 'q.txt': `${q}two\n` } });
    commit(dir, { when: '2024-01-06', who: 'bob', files: { 'q.txt': `${q}two\nthree\n` } });
    commit(dir, { when: '2024-01-07', who: 'carol', move: [['q.txt', 'p.txt']] });
    commit(dir, { when: '2024-01-08', who: 'carol', files: { 'p.txt': `${q}two\nthree\nfour\n` } });

    const product = readProduct(dir);

    // q's three commits, the rename and the edit after it; p's own two commits and its deletion are another file's
    expect(product.files).toEqual([{
      path: 'p.txt', commits: 5, authors: 2, added: 15, removed: 0, lastChanged: '2024-01-08T10:00:00+08:00', lines: 15, score: 75, lineageConflicts: 0,
    }]);
    expect(product.conservation).toEqual({ changesRead: 8, attributed: 5, outsideSelection: 3 });
  });
});

describe('git configuration and signed commits', () => {
  it('is not thrown off by signature text that log.showSignature prints into the log', () => {
    const tools = tempDir('hotspots-fakegpg-');
    // a stand-in gpg: signing writes a fixed armored block, verifying reports a good signature
    const gpg = join(tools, 'fakegpg.sh');
    writeFileSync(gpg, [
      '#!/bin/sh',
      'case "$*" in',
      '  *--verify*) echo "gpg: Good signature from \\"Fake Signer <fake@example.test>\\"" >&2; exit 0;;',
      '  *) cat >/dev/null; printf -- "-----BEGIN PGP SIGNATURE-----\\n\\nZmFrZQ==\\n-----END PGP SIGNATURE-----\\n"; echo "[GNUPG:] SIG_CREATED D 1 8 00 1704100000 ABCDEF" >&2; exit 0;;',
      'esac',
      '',
    ].join('\n'), { mode: 0o755 });
    // the repository's own config: the host's is switched off, this one is not
    const dir = initRepo('hotspots-signed-', { 'log.showSignature': 'true', 'gpg.program': gpg, 'user.signingkey': 'ABCDEF' });

    writeFile(dir, 'a.txt', lines(3));
    git(dir, ['add', '-A']);
    git(dir, ['-c', 'user.name=alice', '-c', 'user.email=alice@example.test', 'commit', '-q', '-S', '-m', 'signed'], {
      GIT_AUTHOR_DATE: stamp('2024-01-01'), GIT_COMMITTER_DATE: stamp('2024-01-01'),
    });
    // the fixture only means something if git really prints the verification text on stdout
    expect(git(dir, ['log', '-1', '--format=%H'])).toMatch(/Good signature/);

    const product = readProduct(dir);

    expect(product.files).toEqual([{
      path: 'a.txt', commits: 1, authors: 1, added: 3, removed: 0, lastChanged: '2024-01-01T10:00:00+08:00', lines: 3, score: 3, lineageConflicts: 0,
    }]);
  });
});

describe('only HEAD decides', () => {
  it('ignores an untracked .mailmap and the work tree\'s edits to a committed one', () => {
    const dir = initRepo('hotspots-mailmap-head-');
    commit(dir, { when: '2024-01-01', who: 'alice', files: { 'm.txt': lines(2) } });
    commit(dir, { when: '2024-01-02', who: 'bob', files: { 'm.txt': lines(3) } });
    const before = readProduct(dir);
    expect(byPath(before.files)['m.txt'].authors).toBe(2);

    writeFile(dir, '.mailmap', 'Alice <alice@example.test> <bob@example.test>\n'); // untracked, would fold bob into alice
    expect(counted(readProduct(dir))).toEqual(counted(before));

    // a committed .mailmap counts, whatever the work tree's copy says
    writeFile(dir, '.mailmap', 'Alice <alice@example.test> <bob@example.test>\n');
    commit(dir, { when: '2024-01-03', who: 'alice', files: { 'other.txt': lines(1) } });
    const folded = readProduct(dir);
    expect(byPath(folded.files)['m.txt'].authors).toBe(1);
    writeFile(dir, '.mailmap', '\n');
    expect(counted(readProduct(dir))).toEqual(counted(folded));
  });

  it('takes diff attributes from HEAD: -diff there makes a file binary, an untracked .gitattributes changes nothing', () => {
    const dir = initRepo('hotspots-attributes-');
    commit(dir, {
      when: '2024-01-01', files: { '.gitattributes': '*.dat -diff\n', 'raw.dat': lines(3), 'plain.txt': lines(3) },
    });
    commit(dir, { when: '2024-01-02', files: { 'raw.dat': lines(4), 'plain.txt': lines(4) } });
    const before = readProduct(dir);
    expect(byPath(before.files)['raw.dat']).toMatchObject({ commits: 2, added: null, removed: null, lines: 4, score: 8 });
    expect(byPath(before.files)['plain.txt']).toMatchObject({ commits: 2, added: 4, removed: 0, lines: 4, score: 8 });

    writeFile(dir, '.gitattributes', '* -diff\n'); // the committed one says otherwise
    expect(counted(readProduct(dir))).toEqual(counted(before));
    rmSync(join(dir, '.gitattributes'));
    git(dir, ['rm', '-q', '--cached', '.gitattributes']); // staged deletion: still not HEAD
    expect(counted(readProduct(dir))).toEqual(counted(before));
  });

  it('counts an author once however the case of the email differs', () => {
    const dir = initRepo('hotspots-case-');
    commit(dir, { when: '2024-01-01', who: 'alice', email: 'Alice@Example.test', files: { 'c.txt': lines(1) } });
    commit(dir, { when: '2024-01-02', who: 'alice', email: 'alice@example.TEST', files: { 'c.txt': lines(2) } });
    commit(dir, { when: '2024-01-03', who: 'bob', files: { 'c.txt': lines(3) } });
    expect(byPath(readProduct(dir).files)['c.txt']).toMatchObject({ commits: 3, authors: 2 });
  });
});

describe('lineage conflicts', () => {
  it('flags a path created separately on two parallel branches that were then merged', () => {
    const dir = initRepo('hotspots-parallel-create-');
    commit(dir, { when: '2024-01-01', who: 'alice', files: { 'base.txt': lines(2) } });
    git(dir, ['checkout', '-q', '-b', 'bx']);
    commit(dir, { when: '2024-01-02', who: 'bob', files: { 'p.txt': lines(3, 'p') } });
    git(dir, ['checkout', '-q', 'main']);
    git(dir, ['checkout', '-q', '-b', 'by']);
    commit(dir, { when: '2024-01-03', who: 'carol', files: { 'p.txt': lines(3, 'p') } });
    merge(dir, 'bx', '2024-01-04'); // both sides added the same file: a clean merge

    const product = readProduct(dir);

    // the walk meets the later creation first and ends the lineage there; the earlier creation is outside
    expect(byPath(product.files)['p.txt']).toEqual({
      path: 'p.txt', commits: 1, authors: 1, added: 3, removed: 0, lastChanged: '2024-01-03T10:00:00+08:00', lines: 3, score: 3, lineageConflicts: 1,
    });
    expect(byPath(product.files)['base.txt'].lineageConflicts).toBe(0);
    expect(product.counts.filesWithLineageConflicts).toBe(1);
    expect(product.conservation).toEqual({ changesRead: 3, attributed: 2, outsideSelection: 1 });
  });

  it('flags the same rename made on two parallel branches, and leaves the old path\'s history out', () => {
    const dir = initRepo('hotspots-parallel-rename-');
    commit(dir, { when: '2024-01-01', who: 'alice', files: { 'a.txt': lines(12, 'a') } });
    commit(dir, { when: '2024-01-02', who: 'alice', files: { 'a.txt': lines(13, 'a') } });
    git(dir, ['checkout', '-q', '-b', 'bx']);
    commit(dir, { when: '2024-01-03', who: 'bob', move: [['a.txt', 'b.txt']] });
    git(dir, ['checkout', '-q', 'main']);
    git(dir, ['checkout', '-q', '-b', 'by']);
    commit(dir, { when: '2024-01-04', who: 'carol', move: [['a.txt', 'b.txt']] });
    merge(dir, 'bx', '2024-01-05'); // both sides renamed alike: a clean merge

    const product = readProduct(dir);

    // The later rename takes b's lineage. The earlier one finds b without a lineage, so it ends a's: a's two
    // commits are neither b's nor anyone else's. Keeping a's mapping would give b the older history: 3 commits.
    expect(product.files).toEqual([{
      path: 'b.txt', commits: 1, authors: 1, added: 0, removed: 0, lastChanged: '2024-01-04T10:00:00+08:00', lines: 13, score: 13, lineageConflicts: 2,
    }]);
    expect(product.counts.filesWithLineageConflicts).toBe(1);
    expect(product.conservation).toEqual({ changesRead: 4, attributed: 1, outsideSelection: 3 });
  });

  it('reports no conflict anywhere in a linear history of adds, edits, renames and deletions', () => {
    const dir = renameFixture(); // adds, edits, a rename chain
    commit(dir, { when: '2024-02-01', files: { 'p.txt': lines(12, 'old p') } });
    commit(dir, { when: '2024-02-02', files: { 'p.txt': lines(13, 'old p') } });
    commit(dir, { when: '2024-02-03', remove: ['p.txt'] });
    commit(dir, { when: '2024-02-04', files: { 'q.txt': lines(12, 'q') } });
    commit(dir, { when: '2024-02-05', files: { 'q.txt': lines(13, 'q') } });
    commit(dir, { when: '2024-02-06', move: [['q.txt', 'p.txt']] }); // onto the path the deletion vacated
    commit(dir, { when: '2024-02-07', files: { 'r.txt': lines(3, 'r') } });
    commit(dir, { when: '2024-02-08', remove: ['r.txt'] });
    commit(dir, { when: '2024-02-09', files: { 'r.txt': lines(4, 'r') } }); // deleted, then created again
    commit(dir, { when: '2024-02-10', files: { 'r.txt': lines(5, 'r') } });

    const product = readProduct(dir);

    expect(product.files.map((row) => row.path).sort()).toEqual(['b.txt', 'p.txt', 'r.txt', 'sub/o.txt']);
    expect(product.files.map((row) => row.lineageConflicts)).toEqual([0, 0, 0, 0]);
    expect(product.counts.filesWithLineageConflicts).toBe(0);
  });
});

describe('the lineage walk', () => {
  const record = (status, path, oldPath = null) => ({ status, path, oldPath });

  it('attributes every record of a commit by the map after it, and moves the map back for all of them together', () => {
    // one commit renames b -> a and c -> b: path b is the old name of one record and the new name of the other
    const lineage = createLineage(['a', 'b']);
    const first = lineage.step([record('R', 'a', 'b'), record('R', 'b', 'c')]);
    expect(first.targets).toEqual(['a', 'b']);
    expect(first.conflicts).toEqual([]);

    // before that commit, path b held a's lineage and path c held b's
    const older = lineage.step([record('M', 'b'), record('M', 'c')]);
    expect(older.targets).toEqual(['a', 'b']);
    expect(older.conflicts).toEqual([]);
  });

  it('ends the old path\'s lineage when a rename goes to a path with no lineage', () => {
    // `old` is held by file `old`; the rename's new path belongs to no selected file
    const lineage = createLineage(['old']);
    const rename = lineage.step([record('R', 'gone', 'old')]);
    expect(rename.targets).toEqual([undefined]);
    expect(rename.conflicts).toEqual(['old']); // a rename cut a lineage

    const older = lineage.step([record('M', 'old')]);
    expect(older.targets).toEqual([undefined]); // older changes of `old` fall outside, not to the file that held it
    expect(older.conflicts).toEqual([]);
  });

  it('flags both files when two lineages claim one path', () => {
    // the new path T belongs to file T, but the old path already belongs to file U
    const lineage = createLineage(['T', 'U']);
    const { targets, conflicts } = lineage.step([record('R', 'T', 'U')]);
    expect(targets).toEqual(['T']);
    expect([...conflicts].sort()).toEqual(['T', 'U']);
    expect(lineage.step([record('M', 'U')]).targets).toEqual(['T']); // the old path now carries T's lineage
  });

  it('flags an older change after a lineage began on a path, but not the deletion before a re-creation', () => {
    const lineage = createLineage(['p']);
    expect(lineage.step([record('A', 'p')])).toEqual({ targets: ['p'], conflicts: [] }); // a lineage begins on p
    expect(lineage.step([record('M', 'p')])).toEqual({ targets: [undefined], conflicts: ['p'] });
    expect(lineage.step([record('M', 'p')]).conflicts).toEqual(['p']); // the cut stays until the path is released
    expect(lineage.step([record('D', 'p')]).conflicts).toEqual([]); // in linear history this is what precedes a creation
    expect(lineage.step([record('M', 'p')]).conflicts).toEqual([]); // and it released the path
  });

  it('forgets a cut when a rename gives the path a lineage again', () => {
    const lineage = createLineage(['p', 'q']);
    lineage.step([record('A', 'p')]); // a lineage begins on p
    lineage.step([record('R', 'q', 'p')]); // q's lineage moves back to p, which is no longer cut
    const ended = lineage.step([record('R', 'y', 'p')]); // y has no lineage: that ends the one on p
    expect(ended.conflicts).toEqual(['q']);
    expect(lineage.step([record('M', 'p')]).conflicts).toEqual([]); // the old cut on p is gone
  });
});

describe('window', () => {
  function windowFixture() {
    const dir = initRepo('hotspots-window-');
    commit(dir, { when: '2024-02-01T07:59:59+08:00', files: { 'w.txt': lines(4) } }); // 2024-01-31T23:59:59Z
    commit(dir, { when: '2024-02-01T08:00:00+08:00', files: { 'w.txt': `${lines(4)}five\n` } }); // exactly 2024-02-01T00:00:00Z
    commit(dir, { when: '2024-02-02T12:00:00+08:00', files: { 'w.txt': `${lines(4)}five\nsix\n` } });
    return dir;
  }

  it('keeps commits at or after 00:00 UTC of the start date and records the window', () => {
    const dir = windowFixture();
    const product = readProduct(dir, ['--since', '2024-02-01']);

    expect(product.window).toEqual({ since: '2024-02-01', sinceUtc: '2024-02-01T00:00:00Z' });
    expect(product.files).toEqual([{
      path: 'w.txt', commits: 2, authors: 1, added: 2, removed: 0, lastChanged: '2024-02-02T12:00:00+08:00', lines: 6, score: 12, lineageConflicts: 0,
    }]);
    expect(product.conservation).toEqual({ changesRead: 2, attributed: 2, outsideSelection: 0 });
  });

  it('reads all history without a start date', () => {
    const dir = windowFixture();
    const row = readProduct(dir).files[0];
    expect(row).toMatchObject({ commits: 3, added: 6, lines: 6, score: 18 });
  });

  it('reports a file with no commit in the window as 0 commits with no last change, not as missing history', () => {
    const dir = windowFixture();
    commit(dir, { when: '2024-01-15', files: { 'early.txt': lines(2) } }); // dated before the window
    const product = readProduct(dir, ['--since', '2024-02-01']);
    expect(byPath(product.files)['early.txt']).toEqual({
      path: 'early.txt', commits: 0, authors: 0, added: 0, removed: 0, lastChanged: null, lines: 2, score: 0, lineageConflicts: 0,
    });
  });

  it('compares last-change times by instant, not by their text', () => {
    const dir = initRepo('hotspots-instant-');
    commit(dir, { when: '2024-03-01T23:00:00-10:00', files: { 't.txt': lines(1) } }); // 2024-03-02T09:00Z
    commit(dir, { when: '2024-03-02T02:00:00+08:00', files: { 't.txt': lines(2) } }); // 2024-03-01T18:00Z
    expect(readProduct(dir).files[0].lastChanged).toBe('2024-03-01T23:00:00-10:00');
  });

  it.each([
    '2 years ago', '2024-1-5', '2024-02-30', '2023-02-29', '2024-13-01', '2024-00-10', '20240201', '',
  ])('rejects the window %j without writing a product', (since) => {
    const dir = initRepo('hotspots-badsince-');
    commit(dir, { when: '2024-01-01', files: { 'a.txt': lines(1) } });

    const result = runScript(dir, ['--since', since]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/--since/);
    expect(existsSync(join(dir, '.excavator'))).toBe(false);
  });

  it('rejects an unknown argument and a missing start date', () => {
    const dir = initRepo('hotspots-badargs-');
    commit(dir, { when: '2024-01-01', files: { 'a.txt': lines(1) } });
    for (const args of [['--since'], ['--bogus'], ['--since', '2024-01-01', 'extra']]) {
      const result = runScript(dir, args);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/Usage/);
    }
    expect(runScript('').status).not.toBe(0);
    expect(existsSync(join(dir, '.excavator'))).toBe(false);
  });

  it('turns a calendar date into the instant it opens in UTC', () => {
    expect(sinceToMs('2024-02-01')).toBe(Date.UTC(2024, 1, 1));
    expect(sinceToMs('2024-02-29')).toBe(Date.UTC(2024, 1, 29));
    expect(sinceToMs('1970-01-01')).toBe(0);
    expect(() => sinceToMs('2023-02-29')).toThrow(/--since/);
  });

  it('counts a commit by its UTC instant, whatever the time zone or hour of the run', () => {
    const dir = initRepo('hotspots-utc-');
    // 2026-10-16T01:30Z is in the window 2026-10-16; 2026-10-15T23:00Z is not. The newer commit is the older instant.
    commit(dir, { when: '2026-10-15T23:30:00-02:00', files: { 'u.txt': lines(3) } });
    commit(dir, { when: '2026-10-16T08:00:00+09:00', files: { 'u.txt': lines(4) } });
    const expected = {
      path: 'u.txt', commits: 1, authors: 1, added: 3, removed: 0, lastChanged: '2026-10-15T23:30:00-02:00', lines: 4, score: 4, lineageConflicts: 0,
    };

    // git's own --since would complete 2026-10-16 with the hour of the run; pin that hour so a leak shows
    const runs = [
      { TZ: 'UTC', GIT_TEST_DATE_NOW: String(Date.UTC(2026, 9, 17, 20) / 1000) },
      { TZ: 'America/Los_Angeles', GIT_TEST_DATE_NOW: String(Date.UTC(2026, 9, 16, 1) / 1000) },
    ];
    for (const env of runs) {
      const product = readProduct(dir, ['--since', '2026-10-16'], env);
      expect(product.window).toEqual({ since: '2026-10-16', sinceUtc: '2026-10-16T00:00:00Z' });
      expect(product.files).toEqual([expected]);
      expect(product.conservation).toEqual({ changesRead: 1, attributed: 1, outsideSelection: 0 });
    }
  });

  it('skips a commit outside the window whole, so its rename does not carry history into the window', () => {
    const dir = initRepo('hotspots-skip-');
    const body = lines(10, 'x');
    commit(dir, { when: '2024-02-10', files: { 'a.txt': body } });
    commit(dir, { when: '2024-01-01', move: [['a.txt', 'b.txt']] }); // dated before the window, shown after the commit below
    commit(dir, { when: '2024-02-15', files: { 'b.txt': `${body}more\n` } });

    const product = readProduct(dir, ['--since', '2024-02-01']);

    // the rename is not read, so the add of a.txt in the window finds no file to belong to
    expect(product.files).toEqual([{
      path: 'b.txt', commits: 1, authors: 1, added: 1, removed: 0, lastChanged: '2024-02-15T10:00:00+08:00', lines: 11, score: 11, lineageConflicts: 0,
    }]);
    expect(product.conservation).toEqual({ changesRead: 2, attributed: 1, outsideSelection: 1 });
  });
});

describe('counting and ranking', () => {
  it('orders files by score, then commits, then path', () => {
    const dir = initRepo('hotspots-rank-');
    const hundred = lines(100, 'row');
    const ten = lines(10, 'ten');
    commit(dir, {
      when: '2024-01-01', files: {
        'x.txt': hundred, 'y.txt': ten, 'z.txt': hundred, 'w.txt': hundred,
      },
    });
    commit(dir, { when: '2024-01-02', files: { 'x.txt': hundred.replace('row 1\n', 'ROW 1\n') } });
    for (let n = 2; n <= 10; n += 1) {
      commit(dir, { when: `2024-01-${String(n + 2).padStart(2, '0')}`, files: { 'y.txt': ten.replace(`ten ${n}\n`, `TEN ${n}\n`) } });
    }

    const product = readProduct(dir);
    expect(product.files.map((row) => [row.path, row.commits, row.lines, row.score])).toEqual([
      ['x.txt', 2, 100, 200], // highest score
      ['y.txt', 10, 10, 100], // ties z and w on score, more commits
      ['w.txt', 1, 100, 100], // ties z on score and commits, earlier path
      ['z.txt', 1, 100, 100],
    ]);
  });

  it('counts a commit once per directory however many of its files it touched', () => {
    const dir = initRepo('hotspots-dirs-');
    commit(dir, {
      when: '2024-01-01', who: 'alice', files: {
        'd/a.txt': lines(2), 'd/b.txt': lines(3), 'd/sub/c.txt': lines(4), 'top.txt': lines(1),
      },
    });
    commit(dir, { when: '2024-01-02', who: 'bob', files: { 'd/a.txt': `${lines(2)}more\n`, 'd/b.txt': `${lines(3)}more\n` } });
    commit(dir, { when: '2024-01-03', who: 'alice', files: { 'd/sub/c.txt': lines(4).replace('line 1\n', 'LINE 1\n') } });

    const product = readProduct(dir);
    const files = byPath(product.files);
    expect(files['d/a.txt']).toMatchObject({ commits: 2, authors: 2, added: 3, lines: 3, score: 6 });
    expect(files['d/b.txt']).toMatchObject({ commits: 2, authors: 2, added: 4, lines: 4, score: 8 });
    expect(files['d/sub/c.txt']).toMatchObject({ commits: 2, authors: 1, added: 5, removed: 1, lines: 4, score: 8 });

    const last = '2024-01-03T10:00:00+08:00';
    expect(product.directories).toEqual([
      {
        path: '.', files: 4, lines: 12, commits: 3, authors: 2, added: 13, removed: 1, lastChanged: last, score: 23, commitsByYear: { 2024: 3 }, concentration: { commitsByPeople: 3, topAuthorShare: 0.67, authorsFor80Percent: 2 },
      },
      {
        path: 'd', files: 3, lines: 11, commits: 3, authors: 2, added: 12, removed: 1, lastChanged: last, score: 22, commitsByYear: { 2024: 3 }, concentration: { commitsByPeople: 3, topAuthorShare: 0.67, authorsFor80Percent: 2 },
      },
      {
        path: 'd/sub', files: 1, lines: 4, commits: 2, authors: 1, added: 5, removed: 1, lastChanged: last, score: 8, commitsByYear: { 2024: 2 }, concentration: { commitsByPeople: 2, topAuthorShare: 1, authorsFor80Percent: 1 },
      },
    ]);
  });
});

describe('no history is visible, never 0', () => {
  it('marks every history field of a plain directory null and still counts lines', () => {
    const dir = tempDir('hotspots-plain-');
    writeFile(dir, 'a.txt', lines(3));
    writeFile(dir, 'b/c.txt', 'x\ny'); // no trailing newline: still 2 lines
    writeFile(dir, 'empty.txt', '');
    writeFile(dir, 'data.bin', Buffer.from([0, 1, 2, 3]));

    const product = readProduct(dir);

    expect(product.sourceKind).toBe('directory');
    expect(product.sourceRevision).toMatch(/^directory:/);
    expect(product.historyAvailable).toBe(false);
    expect(product.noHistory).toEqual({ reason: 'not-a-repository', repositoryRoot: null, pathInRepository: null });
    expect(product.repos).toEqual([]);
    expect(product.counts).toEqual({ filesWithHistory: 0, filesWithoutHistory: 4, binaryFiles: 1, filesWithLineageConflicts: 0 });
    expect(product.conservation).toEqual({ changesRead: 0, attributed: 0, outsideSelection: 0 });
    expect(product.coChange).toEqual({
      maxFilesPerCommit: 30, minTogether: 3, commitsCounted: null, commitsOverLimit: null, pairsListed: null, pairsBelowMinimum: null,
    });
    expect(product.pairs).toEqual([]);
    expect(product.bots).toEqual({ emailMarker: '[bot]@', commits: null });
    const none = {
      commits: null, authors: null, added: null, removed: null, lastChanged: null, score: null,
    };
    expect(product.files).toEqual([
      { path: 'a.txt', ...none, lines: 3, lineageConflicts: 0 },
      { path: 'b/c.txt', ...none, lines: 2, lineageConflicts: 0 },
      { path: 'data.bin', ...none, lines: null, lineageConflicts: 0 },
      { path: 'empty.txt', ...none, lines: 0, lineageConflicts: 0 },
    ]);
    expect(product.directories).toEqual([
      {
        path: '.', files: 4, lines: 5, ...none, commitsByYear: null, concentration: null,
      },
      {
        path: 'b', files: 1, lines: 2, ...none, commitsByYear: null, concentration: null,
      },
    ]);
  });

  it('explains a subdirectory of a repository by the repository root and its path in it', () => {
    const dir = initRepo('hotspots-subdir-');
    commit(dir, { when: '2024-01-01', files: { 'apps/web/a.txt': lines(3), 'apps/web/b/c.txt': lines(2), 'other.txt': lines(1) } });
    commit(dir, { when: '2024-01-02', files: { 'apps/web/a.txt': lines(4) } });

    const product = readProduct(join(dir, 'apps', 'web'));

    expect(product.sourceKind).toBe('directory');
    expect(product.historyAvailable).toBe(false);
    expect(product.noHistory).toEqual({ reason: 'inside-repository', repositoryRoot: '../..', pathInRepository: 'apps/web' });
    expect(product.files.map((row) => [row.path, row.commits, row.lines])).toEqual([['a.txt', null, 4], ['b/c.txt', null, 2]]);
  });

  it('refuses to write a product when git cannot start but a .git exists at, above or below the root', () => {
    const repo = initRepo('hotspots-nogit-');
    commit(repo, { when: '2024-01-01', files: { 'src/a.txt': lines(2) } });
    const parent = tempDir('hotspots-nogit-multi-');
    const member = join(parent, 'm');
    mkdirSync(member);
    git(member, ['init', '-q', '-b', 'main']);
    commit(member, { when: '2024-01-01', files: { 'x.txt': lines(1) } });
    const noGit = { PATH: tempDir('hotspots-empty-path-') };

    for (const [root, found] of [[repo, '.git'], [join(repo, 'src'), '../.git'], [parent, 'm/.git']]) {
      const result = runScript(root, [], noGit);
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain('git could not be started');
      expect(result.stderr).toContain(`the history in ${found} cannot be read`);
      expect(existsSync(productPath(root))).toBe(false);
    }

    // with no .git anywhere, git not starting changes nothing
    const plain = tempDir('hotspots-nogit-plain-');
    writeFile(plain, 'a.txt', lines(2));
    expect(readProduct(plain, [], noGit).noHistory).toEqual({ reason: 'not-a-repository', repositoryRoot: null, pathInRepository: null });
  });

  it('refuses to write a product when git does not accept the .git of the root or of a child directory', () => {
    const dir = tempDir('hotspots-broken-');
    writeFile(dir, 'a.txt', lines(2));
    writeFile(dir, '.git', `gitdir: ${join(dir, 'missing')}\n`);
    const parent = tempDir('hotspots-broken-child-');
    writeFile(parent, 'm/x.txt', lines(1));
    writeFile(parent, 'm/.git', `gitdir: ${join(parent, 'missing')}\n`);

    for (const [root, found] of [[dir, '.git in the project root'], [parent, 'm/.git']]) {
      const result = runScript(root);
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain(`git does not accept ${found}, so its history cannot be read`);
      expect(existsSync(productPath(root))).toBe(false);
    }
  });

  it('writes the product for a directory whose only child repository has no commit yet', () => {
    const parent = tempDir('hotspots-unborn-child-');
    writeFile(parent, 'notes.txt', lines(2));
    const child = join(parent, 'new');
    mkdirSync(child);
    git(child, ['init', '-q', '-b', 'main']);
    writeFile(child, 'y.txt', lines(3));

    const result = runScript(parent);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('has no commits (unborn HEAD)');
    const product = JSON.parse(readFileSync(productPath(parent), 'utf-8'));
    expect(product.noHistory).toEqual({ reason: 'not-a-repository', repositoryRoot: null, pathInRepository: null });
  });

  it('refuses to explain a repository root as a directory without history', () => {
    const dir = initRepo('hotspots-root-');
    commit(dir, { when: '2024-01-01', files: { 'a.txt': lines(1) } });
    expect(() => explainNoHistory(dir)).toThrow(/read it as a plain directory/);
  });

  it('skips the boundary commit of a shallow clone and says so', () => {
    const source = initRepo('hotspots-shallow-src-');
    commit(source, { when: '2024-01-01', files: { 'f.txt': lines(2), 'g.txt': lines(3), 'h.txt': lines(1) } });
    commit(source, { when: '2024-01-02', files: { 'g.txt': `${lines(3)}more\n` } });
    commit(source, { when: '2024-01-03', files: { 'f.txt': `${lines(2)}more\n` } });
    const clone = join(tempDir('hotspots-shallow-dst-'), 'clone');
    execFileSync('git', ['clone', '-q', '--depth', '2', `file://${source}`, clone], { env: GIT_ENV });
    expect(git(clone, ['rev-parse', '--is-shallow-repository']).trim()).toBe('true');

    const product = readProduct(clone);

    expect(product.repos).toEqual([{
      path: '.', head: head(clone), shallow: true, boundaryCommits: 1, earliestVisibleCommit: '2024-01-02T10:00:00+08:00',
    }]);
    const none = {
      commits: 0, authors: 0, added: 0, removed: 0, lastChanged: null, score: 0,
    };
    expect(product.files).toEqual([
      {
        path: 'f.txt', commits: 1, authors: 1, added: 1, removed: 0, lastChanged: '2024-01-03T10:00:00+08:00', lines: 3, score: 3, lineageConflicts: 0,
      },
      { path: 'g.txt', ...none, lines: 4, lineageConflicts: 0 },
      { path: 'h.txt', ...none, lines: 1, lineageConflicts: 0 },
    ]);
    // the boundary commit's changes are in no total
    expect(product.conservation).toEqual({ changesRead: 1, attributed: 1, outsideSelection: 0 });
    expect(product.counts).toEqual({ filesWithHistory: 3, filesWithoutHistory: 0, binaryFiles: 0, filesWithLineageConflicts: 0 });

    // a window past every commit empties the counts but not the facts about the clone
    const later = readProduct(clone, ['--since', '2024-01-04']);
    expect(later.repos).toEqual(product.repos);
    expect(later.files.map((row) => row.commits)).toEqual([0, 0, 0]);
    expect(later.conservation).toEqual({ changesRead: 0, attributed: 0, outsideSelection: 0 });
  });

  it('reads each member repository on its own and gives a file outside every member no history', () => {
    const parent = tempDir('hotspots-multi-');
    writeFile(parent, 'notes.txt', lines(4, 'note'));
    const a = join(parent, 'a');
    const b = join(parent, 'b');
    for (const dir of [a, b]) {
      mkdirSync(dir);
      git(dir, ['init', '-q', '-b', 'main']);
    }
    commit(a, { when: '2024-01-01', who: 'alice', files: { 'x.txt': lines(3) } });
    commit(a, { when: '2024-01-02', who: 'alice', files: { 'x.txt': lines(4) } });
    commit(b, { when: '2024-01-03', who: 'bob', files: { 'y.txt': lines(2) } });
    commit(b, { when: '2024-01-04', who: 'alice', files: { 'y.txt': lines(3) } });

    const product = readProduct(parent);

    expect(product.sourceKind).toBe('multi-repo');
    expect(product.sourceRevision).toMatch(/^multi-repo:/);
    expect(product.repos).toEqual([
      {
        path: 'a', head: head(a), shallow: false, boundaryCommits: 0, earliestVisibleCommit: '2024-01-01T10:00:00+08:00',
      },
      {
        path: 'b', head: head(b), shallow: false, boundaryCommits: 0, earliestVisibleCommit: '2024-01-03T10:00:00+08:00',
      },
    ]);
    expect(product.counts).toEqual({ filesWithHistory: 2, filesWithoutHistory: 1, binaryFiles: 0, filesWithLineageConflicts: 0 });
    expect(product.files).toEqual([
      {
        path: 'a/x.txt', commits: 2, authors: 1, added: 4, removed: 0, lastChanged: '2024-01-02T10:00:00+08:00', lines: 4, score: 8, lineageConflicts: 0,
      },
      {
        path: 'b/y.txt', commits: 2, authors: 2, added: 3, removed: 0, lastChanged: '2024-01-04T10:00:00+08:00', lines: 3, score: 6, lineageConflicts: 0,
      },
      {
        path: 'notes.txt', commits: null, authors: null, added: null, removed: null, lastChanged: null, lines: 4, score: null, lineageConflicts: 0,
      },
    ]);
    // a directory over both repos: commits are distinct per repo, alice is one author with 3 of the 4
    expect(byPath(product.directories)['.']).toEqual({
      path: '.', files: 3, lines: 11, commits: 4, authors: 2, added: 7, removed: 0, lastChanged: '2024-01-04T10:00:00+08:00', score: 14, commitsByYear: { 2024: 4 },
      concentration: { commitsByPeople: 4, topAuthorShare: 0.75, authorsFor80Percent: 2 },
    });
    expect(product.conservation).toEqual({ changesRead: 4, attributed: 4, outsideSelection: 0 });
  });

  it('counts the commits of two member repositories that share every commit once per repository', () => {
    const parent = tempDir('hotspots-twins-');
    const a = join(parent, 'a');
    mkdirSync(a);
    git(a, ['init', '-q', '-b', 'main']);
    commit(a, { when: '2024-01-01', who: 'alice', files: { 'x.txt': lines(2) } });
    commit(a, { when: '2024-01-02', who: 'bob', files: { 'x.txt': lines(3) } });
    execFileSync('git', ['clone', '-q', a, join(parent, 'b')], { env: GIT_ENV });
    expect(head(join(parent, 'b'))).toBe(head(a));

    const product = readProduct(parent);

    // the same shas in two repositories are four commits of the workspace, by the same two authors
    expect(byPath(product.directories)['.']).toMatchObject({ files: 2, commits: 4, authors: 2 });
    expect(byPath(product.files)['a/x.txt']).toMatchObject({ commits: 2, authors: 2 });
    expect(byPath(product.files)['b/x.txt']).toMatchObject({ commits: 2, authors: 2 });
  });

  it('gives a binary file commits and authors but no lines and no score', () => {
    const dir = initRepo('hotspots-binary-');
    const png = (tail) => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, tail]);
    // the default rules drop *.png; this project re-includes it
    commit(dir, {
      when: '2024-01-01',
      files: {
        '.excavatorignore': '!*.png\n', 'img/logo.png': png(1), 't.txt': lines(5), 'toggle.dat': 'a\nb\n',
      },
    });
    commit(dir, { when: '2024-01-02', files: { 'img/logo.png': png(2), 'toggle.dat': Buffer.from('a\nb\0\n') } });
    commit(dir, { when: '2024-01-03', files: { 'img/logo.png': png(3), 'toggle.dat': 'a\nb\nc\n' } });

    const product = readProduct(dir);

    expect(product.files).toEqual([
      // text at HEAD, but one of its three changes was binary to git: lines yes, added/removed no
      {
        path: 'toggle.dat', commits: 3, authors: 1, added: null, removed: null, lastChanged: '2024-01-03T10:00:00+08:00', lines: 3, score: 9, lineageConflicts: 0,
      },
      {
        path: 't.txt', commits: 1, authors: 1, added: 5, removed: 0, lastChanged: '2024-01-01T10:00:00+08:00', lines: 5, score: 5, lineageConflicts: 0,
      },
      // binary at HEAD: it ranks after every file that has a score
      {
        path: 'img/logo.png', commits: 3, authors: 1, added: null, removed: null, lastChanged: '2024-01-03T10:00:00+08:00', lines: null, score: null, lineageConflicts: 0,
      },
    ]);
    expect(product.counts).toEqual({ filesWithHistory: 3, filesWithoutHistory: 0, binaryFiles: 1, filesWithLineageConflicts: 0 });
    expect(byPath(product.directories)['.']).toEqual({
      path: '.', files: 3, lines: 8, commits: 3, authors: 1, added: 5, removed: 0, lastChanged: '2024-01-03T10:00:00+08:00', score: 14, commitsByYear: { 2024: 3 },
      concentration: { commitsByPeople: 3, topAuthorShare: 1, authorsFor80Percent: 1 },
    });
    // a directory of nothing but a binary file: its sums have no term, so they are null, not 0
    expect(byPath(product.directories).img).toEqual({
      path: 'img', files: 1, lines: null, commits: 3, authors: 1, added: null, removed: null, lastChanged: '2024-01-03T10:00:00+08:00', score: null, commitsByYear: { 2024: 3 },
      concentration: { commitsByPeople: 3, topAuthorShare: 1, authorsFor80Percent: 1 },
    });
  });
});

describe('files changed together', () => {
  /** Commit each list of files as one commit, a day apart, every file growing by one line. */
  function commitGroups(dir, groups, firstDay = 1) {
    const sizes = new Map();
    groups.forEach((group, i) => {
      const files = {};
      for (const path of group) {
        sizes.set(path, (sizes.get(path) ?? 0) + 1);
        files[path] = lines(sizes.get(path), path);
      }
      commit(dir, { when: new Date(Date.UTC(2024, 1, firstDay + i)).toISOString().slice(0, 10), files });
    });
  }

  it('lists pairs changed together at least 3 times with both shares, ordered by count then path', () => {
    const dir = initRepo('hotspots-pairs-');
    commitGroups(dir, [
      ['x', 'y', 'z'], ['x', 'y', 'z'], ['x', 'y'], ['x'], // x 4, y 3, z 2: x-y 3, x-z 2, y-z 2
      ['p', 'q'], ['p', 'q'], ['p', 'q'], ['p', 'q'], // p-q 4
      ['r', 's'], ['r', 's'], ['r', 's'], // r-s 3
    ]);

    const product = readProduct(dir);

    expect(product.pairs).toEqual([
      { a: 'p', b: 'q', together: 4, shareOfA: 1, shareOfB: 1 },
      { a: 'r', b: 's', together: 3, shareOfA: 1, shareOfB: 1 },
      { a: 'x', b: 'y', together: 3, shareOfA: 0.75, shareOfB: 1 },
    ]);
    expect(product.coChange).toEqual({
      maxFilesPerCommit: 30, minTogether: 3, commitsCounted: 10, commitsOverLimit: 0, pairsListed: 3, pairsBelowMinimum: 2,
    });

    // a window that leaves out the first commit leaves x-y at 2: counted, not listed
    const later = readProduct(dir, ['--since', '2024-02-02']);
    expect(later.pairs.map((pair) => `${pair.a}-${pair.b}`)).toEqual(['p-q', 'r-s']);
    expect(later.coChange).toMatchObject({ commitsCounted: 9, pairsBelowMinimum: 3 });
  });

  it('rounds a share half up from the exact quotient', () => {
    // in memory: 40 scripted commits would hold the test worker for seconds on a loaded machine
    const ids = (from, to) => new Set(Array.from({ length: to - from }, (_, i) => from + i));
    const histories = new Map([['h', { commits: ids(0, 40) }], ['k', { commits: ids(0, 23) }]]);

    // 23 of h's 40 commits is 57.5%: 0.58, where 23 / 40 * 100 in floating point rounds to 0.57
    expect(countCoChanges(histories).pairs).toEqual([{ a: 'h', b: 'k', together: 23, shareOfA: 0.58, shareOfB: 1 }]);
  });

  it('pairs the files of a commit with 30 selected files and leaves a commit with 31 out of every pair', () => {
    const dir = initRepo('hotspots-bulk-');
    const names = (tag, count) => Array.from({ length: count }, (_, i) => `${tag}${String(i + 1).padStart(2, '0')}`);
    commitGroups(dir, [names('f', 30), names('g', 31)]);

    const product = readProduct(dir);

    expect(product.coChange).toMatchObject({
      commitsCounted: 1, commitsOverLimit: 1, pairsListed: 0, pairsBelowMinimum: (30 * 29) / 2,
    });
    expect(byPath(product.files).g31.commits).toBe(1);
  });

  it('pairs a renamed file under its current path', () => {
    const dir = initRepo('hotspots-pair-rename-');
    commitGroups(dir, [['old.txt', 'y.txt'], ['old.txt', 'y.txt'], ['old.txt', 'y.txt']]);
    commit(dir, { when: '2024-03-01', move: [['old.txt', 'new.txt']] });

    expect(readProduct(dir).pairs).toEqual([{ a: 'new.txt', b: 'y.txt', together: 3, shareOfA: 0.75, shareOfB: 1 }]);
  });

  it('never pairs files of two member repositories, even when they share every commit', () => {
    const parent = tempDir('hotspots-pair-twins-');
    const a = join(parent, 'a');
    mkdirSync(a);
    git(a, ['init', '-q', '-b', 'main']);
    commitGroups(a, [['x.txt', 'y.txt'], ['x.txt', 'y.txt'], ['x.txt', 'y.txt']]);
    execFileSync('git', ['clone', '-q', a, join(parent, 'b')], { env: GIT_ENV });

    const product = readProduct(parent);

    expect(product.pairs).toEqual([
      { a: 'a/x.txt', b: 'a/y.txt', together: 3, shareOfA: 1, shareOfB: 1 },
      { a: 'b/x.txt', b: 'b/y.txt', together: 3, shareOfA: 1, shareOfB: 1 },
    ]);
    expect(product.coChange).toMatchObject({ commitsCounted: 6, pairsBelowMinimum: 0 });
  });
});

describe('commits by year', () => {
  it('counts a commit once per directory in the year of its committer date, with every year of the product', () => {
    const dir = initRepo('hotspots-years-');
    commit(dir, { when: '2020-06-01', files: { 'top.txt': lines(1) } });
    commit(dir, { when: '2021-06-01', files: { 'd/a.txt': lines(1), 'd/b.txt': lines(1) } });
    commit(dir, { when: '2023-06-01', files: { 'd/a.txt': lines(2) } });

    const dirs = byPath(readProduct(dir).directories);

    expect(dirs['.'].commitsByYear).toEqual({
      2020: 1, 2021: 1, 2022: 0, 2023: 1,
    });
    // one commit changed both files of d; the years before d's first commit are 0, not left out
    expect(dirs.d.commitsByYear).toEqual({
      2020: 0, 2021: 1, 2022: 0, 2023: 1,
    });
    expect(Object.keys(dirs.d.commitsByYear)).toEqual(['2020', '2021', '2022', '2023']);
  });

  it('takes the year as git prints the committer date, not the UTC year', () => {
    const dir = initRepo('hotspots-new-year-');
    commit(dir, { when: '2023-06-01', files: { 'a.txt': lines(1) } });
    // 2024-01-01T04:30Z in UTC: still 2023 where it was committed, as lastChanged shows it
    commit(dir, { when: '2023-12-31T23:30:00-05:00', files: { 'a.txt': lines(2) } });

    const product = readProduct(dir);
    const root = byPath(product.directories)['.'];

    expect(root.lastChanged).toBe('2023-12-31T23:30:00-05:00');
    expect(root.commitsByYear).toEqual({ 2023: 2 });
  });

  it('adds up to commits in every directory, across renames and two member repositories that share every commit', () => {
    const parent = tempDir('hotspots-years-twins-');
    const a = join(parent, 'a');
    mkdirSync(a);
    git(a, ['init', '-q', '-b', 'main']);
    commit(a, { when: '2022-03-01', files: { 'src/old.txt': lines(1), 'src/y.txt': lines(1) } });
    commit(a, { when: '2023-03-01', move: [['src/old.txt', 'lib/new.txt']] });
    commit(a, { when: '2024-03-01', files: { 'lib/new.txt': lines(2) } });
    execFileSync('git', ['clone', '-q', a, join(parent, 'b')], { env: GIT_ENV });

    const product = readProduct(parent);
    const dirs = byPath(product.directories);

    // the same three commits in each repository count once per repository
    expect(dirs['.'].commitsByYear).toEqual({ 2022: 2, 2023: 2, 2024: 2 });
    // the rename carries old.txt's 2022 commit to lib
    expect(dirs['a/lib'].commitsByYear).toEqual({ 2022: 1, 2023: 1, 2024: 1 });
    expect(dirs['a/src'].commitsByYear).toEqual({ 2022: 1, 2023: 0, 2024: 0 });
    for (const row of product.directories) {
      expect(Object.values(row.commitsByYear).reduce((sum, count) => sum + count, 0), row.path).toBe(row.commits);
    }
  });

  it('is an empty object when the window holds no commit', () => {
    const dir = initRepo('hotspots-years-empty-');
    commit(dir, { when: '2024-01-01', files: { 'd/a.txt': lines(1) } });

    const product = readProduct(dir, ['--since', '2025-01-01']);

    for (const row of product.directories) {
      expect(row).toMatchObject({ commits: 0, commitsByYear: {}, concentration: { commitsByPeople: 0, topAuthorShare: null, authorsFor80Percent: null } });
    }
    expect(product.bots.commits).toBe(0);
  });
});

describe('shares by author', () => {
  const BOT = '49699333+dependabot[bot]@users.noreply.github.com';

  it('gives the share of the author with the most commits and how few authors make up 80%, counting a commit once per directory', () => {
    const dir = initRepo('hotspots-shares-');
    let day = 1;
    const next = () => `2024-01-${String(day++).padStart(2, '0')}`;
    // d: alice 6 (each commit changes both files), bob 3, carol 1
    for (let i = 0; i < 6; i += 1) commit(dir, { when: next(), who: 'alice', files: { 'd/a.txt': lines(i + 1), 'd/b.txt': lines(i + 1) } });
    for (let i = 0; i < 3; i += 1) commit(dir, { when: next(), who: 'bob', files: { 'd/a.txt': lines(i + 10) } });
    commit(dir, { when: next(), who: 'carol', files: { 'd/b.txt': lines(20) } });
    // e: alice 4, bob 4, carol 2, so two authors make exactly 80%
    for (const [who, times] of [['alice', 4], ['bob', 4], ['carol', 2]]) {
      for (let i = 0; i < times; i += 1) commit(dir, { when: next(), who, files: { 'e/c.txt': `${who} ${i}\n` } });
    }

    const product = readProduct(dir);
    const dirs = byPath(product.directories);

    expect(dirs.d.concentration).toEqual({ commitsByPeople: 10, topAuthorShare: 0.6, authorsFor80Percent: 2 });
    expect(dirs.e.concentration).toEqual({ commitsByPeople: 10, topAuthorShare: 0.4, authorsFor80Percent: 2 });
    expect(dirs['.'].concentration).toEqual({ commitsByPeople: 20, topAuthorShare: 0.5, authorsFor80Percent: 2 });
    for (const row of product.files) expect(row).not.toHaveProperty('concentration');
  });

  it('leaves commits by bots out of the shares, counts them in the header, and writes no author name or email', () => {
    const dir = initRepo('hotspots-bots-');
    for (const day of ['01', '02', '03']) commit(dir, { when: `2024-01-${day}`, who: 'alice', files: { 'd/x.txt': lines(Number(day)) } });
    // "bot" inside a person's email is not the [bot] marker
    commit(dir, { when: '2024-01-04', who: 'abbot', email: 'abbot@example.test', files: { 'd/x.txt': lines(9) } });
    commit(dir, { when: '2024-01-05', who: 'dependabot[bot]', email: BOT, files: { 'deps/pom.xml': lines(1) } });
    commit(dir, { when: '2024-01-06', who: 'dependabot[bot]', email: BOT, files: { 'deps/pom.xml': lines(2) } });

    const product = readProduct(dir);
    const dirs = byPath(product.directories);

    expect(product.bots).toEqual({ emailMarker: '[bot]@', commits: 2 });
    expect(dirs.d).toMatchObject({ commits: 4, concentration: { commitsByPeople: 4, topAuthorShare: 0.75, authorsFor80Percent: 2 } });
    expect(dirs.deps).toMatchObject({ commits: 2, concentration: { commitsByPeople: 0, topAuthorShare: null, authorsFor80Percent: null } });
    expect(dirs['.'].commits).toBe(dirs['.'].concentration.commitsByPeople + product.bots.commits);
    const text = readFileSync(productPath(dir), 'utf-8');
    for (const identity of ['alice', 'abbot', 'dependabot', 'example.test', 'noreply']) expect(text).not.toContain(identity);
  });

  /** One directory `d` whose commits are by these emails, one commit each, through the aggregation alone. */
  function sharesOf(emails) {
    const ids = { authors: new Map(), years: [], authorOf: [] };
    emails.forEach((email, commitId) => {
      if (!ids.authors.has(email)) ids.authors.set(email, ids.authors.size);
      ids.authorOf[commitId] = ids.authors.get(email);
      ids.years[commitId] = '2024';
    });
    const history = {
      commits: new Set(emails.keys()), authors: new Set(ids.authorOf), added: 0, removed: 0, binaryChange: false, last: null, lastMs: -Infinity, lineageConflicts: 0,
    };
    const { directories, botCommits } = buildRows([{ path: 'd/a.txt', hasHistory: true, lines: 1 }], new Map([['d/a.txt', history]]), ids);
    return { ...byPath(directories).d.concentration, botCommits };
  }
  const repeat = (email, times) => Array(times).fill(email);

  it('rounds the share half up and counts authors until they reach 80% exactly or more', () => {
    expect(sharesOf(['a@x', 'a@x', 'b@x'])).toEqual({ commitsByPeople: 3, topAuthorShare: 0.67, authorsFor80Percent: 2, botCommits: 0 });
    // 1/8 = 0.125 rounds up; seven of eight authors make 87.5%, six make 75%
    expect(sharesOf(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((name) => `${name}@x`)))
      .toEqual({ commitsByPeople: 8, topAuthorShare: 0.13, authorsFor80Percent: 7, botCommits: 0 });
    expect(sharesOf([...repeat('a@x', 8), 'b@x', 'c@x'])).toMatchObject({ topAuthorShare: 0.8, authorsFor80Percent: 1 });
    expect(sharesOf([...repeat('a@x', 7), 'b@x', 'c@x', 'd@x'])).toMatchObject({ topAuthorShare: 0.7, authorsFor80Percent: 2 });
  });

  it('gives no share when every commit is by a bot, and counts a marker only at the end of the local part', () => {
    expect(sharesOf(['ci[bot]@x', 'ci[bot]@x'])).toEqual({ commitsByPeople: 0, topAuthorShare: null, authorsFor80Percent: null, botCommits: 2 });
    expect(sharesOf(['not[bot]here@x'])).toEqual({ commitsByPeople: 1, topAuthorShare: 1, authorsFor80Percent: 1, botCommits: 0 });
  });
});

describe('feature groups', () => {
  /** A groups file outside the project, so it is never one of the selected files. */
  function groupsFile(value) {
    const path = join(tempDir('hotspots-groups-file-'), 'groups.json');
    writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
    return path;
  }

  /** a.js and b.js changed together and apart, three files under src/, and old.js deleted (4 commits, 3 authors). */
  function groupsFixture() {
    const dir = initRepo('hotspots-groups-');
    commit(dir, {
      when: '2023-01-01',
      who: 'alice',
      files: {
        'a.js': lines(2, 'a'), 'b.js': lines(1, 'b'), 'src/x.js': lines(1, 'x'), 'src/y.js': lines(1, 'y'), 'src/z.js': lines(1, 'z'), 'old.js': lines(1, 'o'), 'other.js': lines(1, 't'),
      },
    });
    commit(dir, { when: '2024-01-02', who: 'bob', files: { 'a.js': lines(3, 'a'), 'b.js': lines(2, 'b') } });
    commit(dir, { when: '2024-01-03', who: 'alice', files: { 'a.js': lines(4, 'a') } });
    commit(dir, { when: '2024-01-04', who: 'carol', files: { 'src/x.js': lines(2, 'x') }, remove: ['old.js'] });
    return dir;
  }

  const noFiles = {
    files: 0, lines: null, commits: null, authors: null, added: null, removed: null, lastChanged: null, score: null, commitsByYear: null, concentration: null,
  };
  const withoutPath = ({ path, ...counts }) => counts;

  it('counts a commit once per group however many of its listed files it touched, in the groups file\'s order', () => {
    const dir = groupsFixture();
    const file = groupsFile({
      groups: [
        { name: 'g', paths: ['a.js', 'b.js'] },
        { name: 'dir', paths: ['src/'] },
        { name: 'dup', paths: ['src/', 'src/x.js'] },
        { name: 'h', paths: ['a.js', 'old.js', 'nope/'] },
        { name: 'bare', paths: ['src'] },
        { name: 'empty', paths: [] },
      ],
    });

    const product = readProduct(dir, ['--groups', file]);

    // a.js has 3 commits and b.js 2; 2 of them are the same commits, so g has 3
    expect(byPath(product.files)['a.js'].commits + byPath(product.files)['b.js'].commits).toBe(5);
    const src = withoutPath(byPath(product.directories).src);
    expect(product.groups).toEqual([
      {
        name: 'g', paths: ['a.js', 'b.js'], unmatchedPaths: [], files: 2, lines: 6, commits: 3, authors: 2, added: 6, removed: 0, lastChanged: '2024-01-03T10:00:00+08:00', score: 16,
        commitsByYear: { 2023: 1, 2024: 2 }, concentration: { commitsByPeople: 3, topAuthorShare: 0.67, authorsFor80Percent: 2 },
      },
      // a directory path stands for every selected file below it, counted as the directory is
      { name: 'dir', paths: ['src/'], unmatchedPaths: [], ...src },
      // src/x.js listed twice is one file, and its commits count once
      { name: 'dup', paths: ['src/', 'src/x.js'], unmatchedPaths: [], ...src },
      // a deleted file and a directory with no selected file are kept, not dropped
      {
        name: 'h', paths: ['a.js', 'old.js', 'nope/'], unmatchedPaths: ['old.js', 'nope/'], files: 1, lines: 4, commits: 3, authors: 2, added: 4, removed: 0, lastChanged: '2024-01-03T10:00:00+08:00', score: 12,
        commitsByYear: { 2023: 1, 2024: 2 }, concentration: { commitsByPeople: 3, topAuthorShare: 0.67, authorsFor80Percent: 2 },
      },
      // without the slash, src names a file called src, and there is none
      { name: 'bare', paths: ['src'], unmatchedPaths: ['src'], ...noFiles },
      { name: 'empty', paths: [], unmatchedPaths: [], ...noFiles },
    ]);
    expect(src).toMatchObject({ files: 3, commits: 2 });
    // a.js is in g and h, the three src files in dir and dup
    expect(product.featureGroups).toEqual({
      groupsListed: 6, filesInAGroup: 5, filesInSeveralGroups: 4, pathsUnmatched: 3,
    });
    // the product does not say where the groups file was
    expect(JSON.stringify(product)).not.toContain(dirname(file));
  });

  it('leaves the rest of the product as it is without groups, and takes the options in either order', () => {
    const dir = groupsFixture();
    const file = groupsFile({ groups: [{ name: 'g', paths: ['a.js', 'src/'] }] });

    const plain = readProduct(dir);
    const grouped = readProduct(dir, ['--groups', file]);
    const windowed = readProduct(dir, ['--groups', file, '--since', '2024-01-03']);
    const reordered = readProduct(dir, ['--since', '2024-01-03', '--groups', file]);

    expect(plain.featureGroups).toBeNull();
    expect(plain.groups).toEqual([]);
    expect(Object.keys(grouped)).toEqual(Object.keys(plain));
    const { featureGroups, groups, ...rest } = grouped;
    const { featureGroups: noGroupCounts, groups: noGroups, ...plainRest } = plain;
    expect(rest).toEqual(plainRest);
    expect(featureGroups).toEqual({
      groupsListed: 1, filesInAGroup: 4, filesInSeveralGroups: 0, pathsUnmatched: 0,
    });
    expect(groups[0]).toMatchObject({ files: 4, commits: 4 });
    expect(windowed.window.since).toBe('2024-01-03');
    expect(windowed.groups[0]).toMatchObject({ files: 4, commits: 2, commitsByYear: { 2024: 2 } });
    expect(reordered).toEqual(windowed);
  });

  it('refuses a malformed groups file and writes nothing', () => {
    const dir = groupsFixture();
    for (const [content, message] of [
      ['{"groups": [', /groups file is not JSON/],
      ['[]', /object with a "groups" array/],
      ['{}', /object with a "groups" array/],
      ['{"groups": {}}', /object with a "groups" array/],
      ['{"groups": ["a.js"]}', /groups\[0\] must be an object/],
      ['{"groups": [{"paths": []}]}', /groups\[0\]\.name must be a non-empty string/],
      ['{"groups": [{"name": "", "paths": []}]}', /groups\[0\]\.name must be a non-empty string/],
      ['{"groups": [{"name": "g", "paths": []}, {"name": "g", "paths": []}]}', /groups\[1\]\.name "g" is used by another group/],
      ['{"groups": [{"name": "g"}]}', /groups\[0\]\.paths must be an array of strings/],
      ['{"groups": [{"name": "g", "paths": "a.js"}]}', /groups\[0\]\.paths must be an array of strings/],
      ['{"groups": [{"name": "g", "paths": ["a.js", 1]}]}', /groups\[0\]\.paths must be an array of strings/],
    ]) {
      const result = runScript(dir, ['--groups', groupsFile(content)]);
      expect(result.status, content).toBe(1);
      expect(result.stderr).toMatch(message);
    }
    const missing = runScript(dir, ['--groups', join(tempDir('hotspots-groups-none-'), 'none.json')]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/groups file cannot be read/);
    const file = groupsFile({ groups: [] });
    for (const args of [['--groups'], ['--groups', file, '--groups', file], ['--groups', '--since', '2024-01-01']]) {
      const result = runScript(dir, args);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Usage/);
    }
    expect(existsSync(join(dir, '.excavator'))).toBe(false);
  });

  it('gives each group its files and lines but no history in a directory without git', () => {
    const plain = tempDir('hotspots-groups-plain-');
    writeFile(plain, 'a.js', lines(2));
    writeFile(plain, 'src/x.js', lines(3));

    const product = readProduct(plain, ['--groups', groupsFile({ groups: [{ name: 'g', paths: ['a.js', 'src/'] }] })]);

    expect(product.groups).toEqual([{
      name: 'g', paths: ['a.js', 'src/'], unmatchedPaths: [], ...noFiles, files: 2, lines: 5,
    }]);
    expect(product.featureGroups).toEqual({
      groupsListed: 1, filesInAGroup: 2, filesInSeveralGroups: 0, pathsUnmatched: 0,
    });
  });

  it('counts a group across member repositories without merging their commits, even when they share every commit', () => {
    const parent = tempDir('hotspots-groups-twins-');
    const a = join(parent, 'a');
    mkdirSync(a);
    git(a, ['init', '-q', '-b', 'main']);
    commit(a, { when: '2024-01-01', who: 'alice', files: { 'x.txt': lines(2) } });
    commit(a, { when: '2024-01-02', who: 'bob', files: { 'x.txt': lines(3) } });
    execFileSync('git', ['clone', '-q', a, join(parent, 'b')], { env: GIT_ENV });

    const product = readProduct(parent, ['--groups', groupsFile({ groups: [{ name: 'g', paths: ['a/x.txt', 'b/'] }] })]);

    expect(withoutPath(byPath(product.directories)['.'])).toMatchObject({ files: 2, commits: 4, authors: 2 });
    expect(product.groups).toEqual([{
      name: 'g', paths: ['a/x.txt', 'b/'], unmatchedPaths: [], ...withoutPath(byPath(product.directories)['.']),
    }]);
  });
});

describe('conservation', () => {
  it('counts changes under an ignored directory outside the selection', () => {
    const dir = initRepo('hotspots-ignored-');
    commit(dir, { when: '2024-01-01', files: { '.excavatorignore': 'legacy/\n', 'keep.txt': lines(2), 'legacy/old.txt': lines(1) } });
    for (const day of ['02', '03', '04', '05']) {
      commit(dir, { when: `2024-01-${day}`, files: { 'legacy/old.txt': lines(Number(day)) } });
    }
    commit(dir, { when: '2024-01-06', files: { 'keep.txt': lines(3) } });

    const product = readProduct(dir);

    expect(product.files.map((row) => row.path)).toEqual(['keep.txt']);
    expect(product.files[0].commits).toBe(2);
    // 5 changes under legacy/ plus the add of .excavatorignore, which the default rules never select
    expect(product.conservation).toEqual({ changesRead: 8, attributed: 2, outsideSelection: 6 });
  });

  it('refuses to write a product when the changes read do not add up', async () => {
    const dir = initRepo('hotspots-conserve-');
    commit(dir, { when: '2024-01-01', files: { 'a.txt': lines(2) } });
    const miscount = async (input) => {
      const history = await readRepoHistory(input);
      return { ...history, changesRead: history.changesRead + 1 };
    };
    muteNotice();

    await expect(runHotspots(dir, { readHistory: miscount })).rejects.toThrow(/conservation/);
    expect(existsSync(join(dir, '.excavator'))).toBe(false);
    await expect(buildHotspots(dir, { readHistory: readRepoHistory })).resolves.toMatchObject({
      conservation: { changesRead: 1, attributed: 1, outsideSelection: 0 },
    });
  });

  it('checks the arithmetic itself', () => {
    expect(() => assertConservation({ changesRead: 5, attributed: 3, outsideSelection: 2 })).not.toThrow();
    expect(() => assertConservation({ changesRead: 5, attributed: 3, outsideSelection: 1 })).toThrow(/conservation/);
    expect(() => assertConservation({ changesRead: 5, attributed: 4, outsideSelection: 2 })).toThrow(/conservation/);
  });
});

describe('writing the product', () => {
  it('refuses a .excavator that is a symlink and writes nothing through it', () => {
    const dir = initRepo('hotspots-symlink-');
    commit(dir, { when: '2024-01-01', files: { 'a.txt': lines(1) } });
    const elsewhere = tempDir('hotspots-elsewhere-');
    symlinkSync(elsewhere, join(dir, '.excavator'));

    const result = runScript(dir);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/\.excavator/);
    expect(existsSync(join(elsewhere, 'hotspots.json'))).toBe(false);
  });

  it('fails on a path that is not a project directory', () => {
    const missing = join(tempDir('hotspots-missing-'), 'nope');
    const result = runScript(missing);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/invalid project root/);
  });
});

describe('line counting', () => {
  const big = lines(40000, 'line'); // several pipe chunks long
  const cases = [
    ['empty', Buffer.alloc(0), { lines: 0, binary: false }],
    ['one line, no newline', Buffer.from('a'), { lines: 1, binary: false }],
    ['one line, newline', Buffer.from('a\n'), { lines: 1, binary: false }],
    ['two lines, no trailing newline', Buffer.from('a\nb'), { lines: 2, binary: false }],
    ['a lone newline', Buffer.from('\n'), { lines: 1, binary: false }],
    ['two blank lines', Buffer.from('\n\n'), { lines: 2, binary: false }],
    ['a large text file', Buffer.from(big), { lines: 40000, binary: false }],
    ['NUL in the first bytes', Buffer.from('ab\0cd\n'), { lines: 1, binary: true }],
    ['NUL at byte 7999', Buffer.from(`${'x'.repeat(7999)}\0\nmore\n`), { lines: 2, binary: true }],
    ['NUL at byte 8000 is past git\'s probe', Buffer.from(`${'x'.repeat(8000)}\0\n`), { lines: 1, binary: false }],
    ['a large binary file', Buffer.alloc(300000, 0), { lines: 1, binary: true }],
  ];

  it.each(cases)('counts %s from a buffer', (_name, buffer, expected) => {
    expect(countBufferLines(buffer)).toEqual(expected);
  });

  it('counts blobs through git in batches, one process per batch', async () => {
    const dir = initRepo('hotspots-blobs-');
    const items = cases.map(([name, buffer]) => ({
      path: name,
      oid: execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: dir, input: buffer, env: GIT_ENV, encoding: 'utf-8' }).trim(),
    }));
    let started = 0;
    const spawnGit = (...args) => {
      started += 1;
      return spawn(...args);
    };

    const results = await countBlobLines(dir, items, { batchSize: 4, spawnGit });

    expect(results).toEqual(cases.map(([, , expected]) => expected));
    expect(started).toBe(Math.ceil(items.length / 4));

    started = 0;
    await countBlobLines(dir, items, { spawnGit });
    expect(started).toBe(1);
    started = 0;
    await countBlobLines(dir, [], { spawnGit });
    expect(started).toBe(0);
  });

  it('fails on a missing object instead of reporting a count', async () => {
    const dir = initRepo('hotspots-blob-missing-');
    await expect(countBlobLines(dir, [{ path: 'x', oid: '0123456789abcdef0123456789abcdef01234567' }])).rejects.toThrow(/unreadable object/);
  });
});
