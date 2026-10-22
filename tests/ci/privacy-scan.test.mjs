// scripts/ci/privacy-scan.mjs (openspec change ci-merge-gate, capability
// `change-review`). Synthetic lists in a throwaway repository: the real
// lists live only in the repository's secrets. Each added line counts once,
// in the commit that adds it, even when a later commit removes it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/ci/privacy-scan.mjs');
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const NAME = 'zqalpha';
const SPACED = 'Zq Beta';
const CORPUS = 'zqgamma';

let dir;
let repo;
let names;
let corpus;
let base;

function git(...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd: repo, encoding: 'utf-8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function write(files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
}

function commit(message, files, ...options) {
  write(files);
  git('add', '-A');
  git('commit', '-q', '-m', message, ...options);
  return git('rev-parse', 'HEAD');
}

// Merges a branch into the current one and returns the git result, without
// failing on a conflict.
function merge(...args) {
  return spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', '-q', ...args], { cwd: repo, env: ENV });
}

function scan(...texts) {
  return spawnSync(process.execPath, [SCRIPT, base, git('rev-parse', 'HEAD'), names, corpus, ...texts], {
    cwd: repo, encoding: 'utf-8', env: ENV,
  });
}

function counts(result) {
  const found = {};
  for (const line of result.stdout.split('\n')) {
    const match = /^(names|corpus)\s+(.+?)\s+(\d+)$/.exec(line);
    if (match) found[`${match[1]} ${match[2]}`] = Number(match[3]);
  }
  return found;
}

function nonzero(result) {
  return Object.fromEntries(Object.entries(counts(result)).filter(([, count]) => count > 0));
}

function expectNoListedText(result) {
  const output = `${result.stdout}${result.stderr}`.toLowerCase();
  for (const word of [NAME, SPACED.toLowerCase(), CORPUS]) expect(output).not.toContain(word);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'privacy-scan-'));
  repo = join(dir, 'repo');
  mkdirSync(repo);
  names = join(dir, 'names');
  corpus = join(dir, 'corpus');
  writeFileSync(names, `\n${NAME}\n  \n${SPACED}\n`);
  writeFileSync(corpus, `\\b${CORPUS}\\b\n\n`);
  git('init', '-q', '-b', 'main');
  base = commit('init', {
    'README.md': 'readme\n',
    'openspec/a.md': 'a\n',
    'docs/a.md': 'a\n',
    'skills/s/SKILL.md': 's\n',
    'src/a.js': 'const a = 1;\n',
    'pnpm-lock.yaml': 'lock\n',
  });
  git('checkout', '-q', '-b', 'feature');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('privacy-scan', () => {
  it('passes a range with nothing from either list, though the lists carry blank lines', () => {
    commit('feat: add b', { 'src/b.js': 'const b = 2;\n' });
    const result = scan();
    expect(result.status).toBe(0);
    expect(Object.keys(counts(result))).toHaveLength(10);
    expect(nonzero(result)).toEqual({});
    expect(result.stdout).toContain('1 commits in');
    expect(result.stdout).toContain('0 matching lines');
  });

  it('counts a name in an added line in code, openspec/, docs/ and root Markdown, ignoring case', () => {
    commit('feat: x', {
      'src/a.js': `const a = '${NAME.toUpperCase()}';\n`,
      'openspec/a.md': `a ${SPACED.toLowerCase()}\n`,
      'docs/a.md': `${NAME}\n`,
      'README.md': `${NAME}\n`,
    });
    const result = scan();
    expect(result.status).toBe(1);
    expect(nonzero(result)).toEqual({ 'names added lines': 4 });
    expect(result.stdout).toContain('4 matching lines; the text is not printed');
    expectNoListedText(result);
  });

  it('does not count a name in the lockfile', () => {
    commit('chore: lock', { 'pnpm-lock.yaml': `lock ${NAME}\n` });
    const result = scan();
    expect(result.status).toBe(0);
    expect(nonzero(result)).toEqual({});
  });

  it('counts a corpus pattern an integrity hash hits by chance only outside the lockfile', () => {
    const line = `    resolution: {integrity: sha512-Qx/${CORPUS}+Rt==}\n`;
    commit('chore: lock', { 'pnpm-lock.yaml': line, 'src/hash.txt': line });
    const result = scan();
    expect(result.status).toBe(1);
    expect(nonzero(result)).toEqual({ 'corpus added lines': 1 });
    expectNoListedText(result);
  });

  it('does not count a corpus name in openspec/, docs/ or root Markdown', () => {
    commit('docs: record', {
      'openspec/a.md': `verified on ${CORPUS}\n`,
      'docs/a.md': `${CORPUS}\n`,
      'README.md': `${CORPUS}\n`,
    });
    const result = scan();
    expect(result.status).toBe(0);
    expect(nonzero(result)).toEqual({});
  });

  it('counts a corpus name in code and in Markdown below the root', () => {
    commit('feat: y', {
      'src/a.js': `// ${CORPUS.toUpperCase()}\n`,
      'skills/s/SKILL.md': `${CORPUS}\n`,
    });
    const result = scan();
    expect(result.status).toBe(1);
    expect(nonzero(result)).toEqual({ 'corpus added lines': 2 });
    expectNoListedText(result);
  });

  it('counts a line a later commit removes', () => {
    commit('feat: add', { 'src/b.js': `${NAME}\n` });
    commit('fix: remove', { 'src/b.js': 'clean\n' });
    const result = scan();
    expect(result.status).toBe(1);
    expect(nonzero(result)).toEqual({ 'names added lines': 1 });
  });

  it('counts a line a merged side branch adds and deletes, which a path filter alone would hide', () => {
    git('checkout', '-q', '-b', 'side');
    commit('feat: add', { 'src/c.js': `${NAME}\n` });
    git('rm', '-q', 'src/c.js');
    git('commit', '-q', '-m', 'fix: delete');
    git('checkout', '-q', 'feature');
    commit('feat: b', { 'src/b.js': 'b\n' });
    expect(merge('--no-ff', '-m', 'merge side', 'side').status).toBe(0);
    const result = scan();
    expect(result.status).toBe(1);
    expect(nonzero(result)).toEqual({ 'names added lines': 1 });
  });

  it('counts a line a merge commit writes resolving a conflict, even when a later commit removes it', () => {
    git('checkout', '-q', 'main');
    base = commit('main moves', { 'src/a.js': 'const a = 2;\n' });
    git('checkout', '-q', 'feature');
    commit('feat: change a', { 'src/a.js': 'const a = 3;\n' });
    expect(merge('main').status).not.toBe(0);
    expect(git('rev-parse', '--verify', 'MERGE_HEAD')).toBe(base);
    write({ 'src/a.js': `const a = '${NAME}';\n` });
    git('add', '-A');
    git('commit', '-q', '--no-edit');
    commit('fix: a', { 'src/a.js': 'const a = 4;\n' });
    const result = scan();
    expect(result.status).toBe(1);
    expect(nonzero(result)).toEqual({ 'names added lines': 1 });
  });

  it('counts files a clean merge commit adds on its own, binary ones included', () => {
    git('checkout', '-q', '-b', 'side');
    commit('feat: c', { 'src/c.js': 'c\n' });
    git('checkout', '-q', 'feature');
    commit('feat: b', { 'src/b.js': 'b\n' });
    expect(merge('--no-ff', '--no-commit', 'side').status).toBe(0);
    write({ 'src/d.js': `${NAME}\n`, 'src/e.bin': `x\0y\n${NAME}\n` });
    git('add', '-A');
    git('commit', '-q', '-m', 'merge side');
    const result = scan();
    expect(result.status).toBe(1);
    expect(nonzero(result)).toEqual({ 'names added lines': 2 });
  });

  it('reads files git calls binary, files a -diff attribute hides, and UTF-16 text', () => {
    commit('feat: files', {
      '.gitattributes': 'hidden.txt -diff\n',
      'hidden.txt': `${NAME}\n`,
      'nul.bin': `x\0y\n${NAME}\n`,
      'utf16.txt': Buffer.from(`${NAME}\n`, 'utf16le'),
    });
    const result = scan();
    expect(result.status).toBe(1);
    expect(nonzero(result)).toEqual({ 'names added lines': 3 });
    expectNoListedText(result);
  });

  it('counts an added line whose own text starts with ++, and no diff header', () => {
    commit('feat: plus', { 'src/c.js': `++ ${NAME}\n` });
    const result = scan();
    expect(nonzero(result)).toEqual({ 'names added lines': 1 });
  });

  it('counts names in paths, and a corpus name in a path only outside docs/', () => {
    commit('feat: files', {
      [`src/${NAME}.js`]: 'const c = 1;\n',
      [`src/${CORPUS}.js`]: 'const d = 1;\n',
      [`docs/${CORPUS}.md`]: 'x\n',
    });
    const result = scan();
    expect(result.status).toBe(1);
    expect(nonzero(result)).toEqual({ 'names paths': 1, 'corpus paths': 1 });
    expectNoListedText(result);
  });

  it('counts names in commit messages', () => {
    commit(`feat: mention ${NAME}`, { 'src/b.js': 'b\n' });
    commit(`docs: verified on ${CORPUS}`, { 'docs/a.md': 'b\n' });
    const result = scan();
    expect(result.status).toBe(1);
    expect(nonzero(result)).toEqual({ 'names commit messages': 1, 'corpus commit messages': 1 });
    expectNoListedText(result);
  });

  it('counts names in an author', () => {
    commit('feat: b', { 'src/b.js': 'b\n' }, '--author', `${SPACED} <dev@${CORPUS}.example>`);
    const result = scan();
    expect(result.status).toBe(1);
    expect(nonzero(result)).toEqual({ 'names authors': 1, 'corpus authors': 1 });
    expectNoListedText(result);
  });

  it('counts names in the pull request text files', () => {
    commit('feat: add b', { 'src/b.js': 'b\n' });
    writeFileSync(join(dir, 'title'), `Add ${NAME.toUpperCase()} support\n`);
    writeFileSync(join(dir, 'body'), `Tested on ${CORPUS}.\n\nMore text.\n`);
    const result = scan(join(dir, 'title'), join(dir, 'body'));
    expect(result.status).toBe(1);
    expect(nonzero(result)).toEqual({ 'names pull request text': 1, 'corpus pull request text': 1 });
    expectNoListedText(result);
  });

  it('fails with exit 2 on a merge with more than two parents', () => {
    for (const branch of ['x', 'y']) {
      git('checkout', '-q', '-b', branch, 'main');
      commit(`feat: ${branch}`, { [`src/${branch}.js`]: `${branch}\n` });
    }
    git('checkout', '-q', 'feature');
    commit('feat: b', { 'src/b.js': 'b\n' });
    expect(merge('-m', 'octopus', 'x', 'y').status).toBe(0);
    expect(git('rev-list', '--parents', '-1', 'HEAD').split(' ')).toHaveLength(4);
    const result = scan();
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('1 merges in');
  });

  it('fails with exit 2 when a list is missing, blank or invalid, before reading anything', () => {
    commit('feat: add b', { 'src/b.js': `${NAME}\n` });
    const cases = [
      [() => { names = join(dir, 'absent'); }, 'the names list is unavailable'],
      [() => { writeFileSync(names, '\n  \n\r\n'); }, 'the names list is unavailable'],
      [() => { corpus = join(dir, 'absent'); }, 'the corpus list is unavailable'],
      [() => { writeFileSync(corpus, '\n \n'); }, 'the corpus list is unavailable'],
      [() => { writeFileSync(corpus, '(\n'); }, 'the corpus list is invalid: entry 1'],
    ];
    const saved = [names, corpus];
    for (const [setUp, message] of cases) {
      [names, corpus] = saved;
      writeFileSync(names, `${NAME}\n`);
      writeFileSync(corpus, `${CORPUS}\n`);
      setUp();
      const result = scan();
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(message);
      expectNoListedText(result);
    }
  });

  it('fails with exit 2 when a ref is not a commit', () => {
    base = 'no-such-ref';
    const result = scan();
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
  });
});
