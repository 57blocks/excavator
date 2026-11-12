#!/usr/bin/env node
// Deterministic survey of the code to recover intent from: repositories, sizes, languages,
// documents, and the files that usually hold intent (contracts, schemas, infrastructure, decisions).
// Facts only; no model is involved.
// Usage: node inventory.mjs [--out <file>] <root> [<root> …]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';

const MAX_READ_BYTES = 2 * 1024 * 1024;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'target', 'vendor', '.next', '.turbo', 'coverage', '.venv', '__pycache__', '.skopo', '.tomo']);
const CODE = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  go: 'Go', rs: 'Rust', py: 'Python', java: 'Java', kt: 'Kotlin', scala: 'Scala', cs: 'C#', rb: 'Ruby', php: 'PHP',
  pl: 'Perl', pm: 'Perl', swift: 'Swift', m: 'Objective-C', c: 'C', h: 'C', cpp: 'C++', hpp: 'C++', dart: 'Dart',
  ex: 'Elixir', exs: 'Elixir', erl: 'Erlang', clj: 'Clojure', vue: 'Vue', svelte: 'Svelte', sql: 'SQL', sol: 'Solidity',
  xhtml: 'JSF', jsp: 'JSP', tf: 'Terraform', hcl: 'HCL', sh: 'Shell', proto: 'Protobuf', graphql: 'GraphQL', prisma: 'Prisma',
};
const DOC_EXT = new Set(['md', 'mdx', 'rst', 'adoc', 'txt']);
// Files that often state intent, grouped by what they usually hold.
const NOTABLE = [
  ['guide', /(^|\/)(README|AGENTS|CLAUDE|ARCHITECTURE|CONTRIBUTING|SECURITY|CHANGELOG|DESIGN)[^/]*\.(md|mdx|rst|txt)$/i],
  ['decision', /(^|\/)(adr|adrs|decisions?|rfcs?)\/[^/]+\.(md|mdx|rst)$/i],
  ['contract', /(openapi|swagger)[^/]*\.(ya?ml|json)$|\.(proto|graphql|gql|avsc)$|(^|\/)asyncapi[^/]*\.(ya?ml|json)$/i],
  ['schema', /schema\.prisma$|(^|\/)migrations?\/|\.sql$|(^|\/)models?\.py$|\.entity\.(ts|java)$/i],
  ['infrastructure', /\.(tf|hcl)$|(^|\/)Chart\.yaml$|(^|\/)(k8s|kubernetes|helm|deploy|infra)\/|docker-compose[^/]*\.ya?ml$|(^|\/)Dockerfile[^/]*$/i],
  ['pipeline', /(^|\/)\.github\/workflows\/|\.gitlab-ci\.yml$|(^|\/)Jenkinsfile$|(^|\/)\.circleci\//i],
  ['configuration', /(^|\/)\.env\.example$|env[-_.]manifest|(^|\/)config\/[^/]+\.(ya?ml|json|toml)$/i],
  ['legal', /(^|\/)(LICENSE|NOTICE|TERMS|PRIVACY)[^/]*$/i],
];

const git = (cwd, args) => {
  try { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
};
const isRepo = (dir) => existsSync(join(dir, '.git'));

function findRepos(root) {
  if (isRepo(root)) return [root];
  const kids = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !SKIP_DIRS.has(d.name)).map((d) => join(root, d.name));
  const repos = kids.filter(isRepo);
  return repos.length ? repos : [root]; // a plain directory is surveyed as it is
}

function walk(dir, base = dir, out = []) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.isDirectory()) { if (!SKIP_DIRS.has(d.name)) walk(join(dir, d.name), base, out); }
    else if (d.isFile()) out.push(relative(base, join(dir, d.name)));
  }
  return out;
}

function readSmall(file) {
  try { return statSync(file).size <= MAX_READ_BYTES ? readFileSync(file, 'utf8') : null; } catch { return null; }
}

function excavatorState(repo, head) {
  const dir = join(repo, '.excavator');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const revisionOf = (f) => {
    const p = join(dir, f);
    if (!existsSync(p)) return null;
    const text = readSmall(p) ?? readFileSync(p, { encoding: 'utf8' }).slice(0, 4096);
    return text.match(/"sourceRevision"\s*:\s*"([^"]+)"/)?.[1] ?? null;
  };
  const meta = existsSync(join(dir, 'meta.json')) ? JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) : {};
  // Excavator writes revisions as "git:<sha>"; meta.json carries the bare commit.
  const revision = (revisionOf('source-manifest.json') ?? revisionOf('domain-graph.json') ?? meta.gitCommitHash ?? null)?.replace(/^git:/, '') ?? null;
  const fresh = Boolean(head && revision && revision.length >= 7 && head.startsWith(revision));
  return { files, sourceRevision: revision, fresh };
}

// The branch a recovery must read: the remote's default (origin/HEAD), else a local main or master.
function branchState(repo) {
  const branch = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const remoteDefault = git(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])?.replace(/^origin\//, '') ?? null;
  const localGuess = ['main', 'master'].find((b) => git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]));
  const defaultBranch = remoteDefault ?? localGuess ?? null;
  const upstream = defaultBranch && git(repo, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${defaultBranch}`]) ? `origin/${defaultBranch}` : null;
  const count = (range) => (upstream ? Number(git(repo, ['rev-list', '--count', range]) ?? 0) : null);
  return {
    branch,
    defaultBranch,
    onDefaultBranch: Boolean(defaultBranch) && branch === defaultBranch,
    // As of the last fetch; the survey never fetches.
    behindRemoteDefault: count(`HEAD..${upstream}`),
    aheadOfRemoteDefault: count(`${upstream}..HEAD`),
  };
}

function surveyRepo(repo) {
  const head = git(repo, ['rev-parse', 'HEAD']);
  const listed = head ? git(repo, ['ls-files'])?.split('\n').filter(Boolean) : null;
  const files = listed ?? walk(repo);
  const byLanguage = {};
  const topLevel = {};
  const notable = Object.fromEntries(NOTABLE.map(([k]) => [k, []]));
  const docs = [];
  let codeLines = 0;
  for (const f of files) {
    if (f.split('/').some((part) => SKIP_DIRS.has(part))) continue;
    const ext = extname(f).slice(1).toLowerCase();
    const top = f.includes('/') ? f.split('/')[0] : '.';
    topLevel[top] ??= { files: 0, codeLines: 0 };
    topLevel[top].files += 1;
    for (const [kind, re] of NOTABLE) if (re.test(f)) notable[kind].push(f);
    if (CODE[ext]) {
      const text = readSmall(join(repo, f));
      const lines = text ? text.split('\n').length : 0;
      byLanguage[CODE[ext]] = (byLanguage[CODE[ext]] ?? 0) + lines;
      topLevel[top].codeLines += lines;
      codeLines += lines;
    } else if (DOC_EXT.has(ext)) {
      const text = readSmall(join(repo, f));
      if (text) docs.push({ path: f, words: text.split(/\s+/).filter(Boolean).length });
    }
  }
  docs.sort((a, b) => b.words - a.words);
  // A skopository's root holds skopo.json (or, before the manifest, a lock). One below an examples or
  // fixtures folder illustrates the format; it is not this repository's own skopo.
  const skopoRoots = [...new Set(files.filter((f) => ['skopo.json', 'spec.lock.json'].includes(basename(f)))
    .map((f) => f.replace(/\/?(skopo|spec\.lock)\.json$/, '') || '.'))];
  const isExample = (d) => d.split('/').some((part) => /^(examples?|fixtures?)$/.test(part));
  const skopo = skopoRoots.filter((d) => !isExample(d));
  const exampleSkopo = skopoRoots.filter(isExample);
  return {
    path: repo,
    name: basename(repo),
    git: head ? {
      head,
      ...branchState(repo),
      dirtyFiles: (git(repo, ['status', '--porcelain']) ?? '').split('\n').filter(Boolean).length,
      commits: Number(git(repo, ['rev-list', '--count', 'HEAD']) ?? 0),
      firstCommit: git(repo, ['log', '--reverse', '--format=%as', '--max-parents=0'])?.split('\n')[0] ?? null,
      lastCommit: git(repo, ['log', '-1', '--format=%as']),
    } : null,
    files: files.length,
    codeLines,
    byLanguage: Object.fromEntries(Object.entries(byLanguage).sort((a, b) => b[1] - a[1])),
    topLevel: Object.fromEntries(Object.entries(topLevel).sort((a, b) => b[1].codeLines - a[1].codeLines)),
    docs: { files: docs.length, words: docs.reduce((n, d) => n + d.words, 0), largest: docs.slice(0, 25) },
    notable: Object.fromEntries(Object.entries(notable).map(([k, v]) => [k, { count: v.length, sample: v.slice(0, 40) }])),
    excavator: excavatorState(repo, head),
    existingSkopo: skopo,
    exampleSkopo,
  };
}

// --- main -------------------------------------------------------------------------------
const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : null;
const roots = (args.length ? args : [process.cwd()]).map((r) => resolve(r));
for (const r of roots) if (!existsSync(r)) { console.error(`inventory: no such directory: ${r}`); process.exit(2); }

const repos = roots.flatMap(findRepos).map(surveyRepo);
const result = {
  surveyedAt: new Date().toISOString(),
  roots,
  topology: repos.length > 1 ? 'multi-repository' : 'single-repository',
  totals: {
    repos: repos.length,
    files: repos.reduce((n, r) => n + r.files, 0),
    codeLines: repos.reduce((n, r) => n + r.codeLines, 0),
    docWords: repos.reduce((n, r) => n + r.docs.words, 0),
  },
  repos,
};
if (out) writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);

console.log(`${result.topology}: ${result.totals.repos} repos · ${result.totals.files} files · ${result.totals.codeLines} code lines · ${result.totals.docWords} doc words`);
for (const r of repos) {
  const langs = Object.entries(r.byLanguage).slice(0, 4).map(([l, n]) => `${l} ${n}`).join(', ');
  const notes = Object.entries(r.notable).filter(([, v]) => v.count).map(([k, v]) => `${k} ${v.count}`).join(', ');
  console.log(`- ${r.name}: ${r.codeLines} lines (${langs || 'no code'}); docs ${r.docs.files} files / ${r.docs.words} words; ${notes || 'nothing notable'}`);
  if (r.git) {
    const g = r.git;
    console.log(`  git ${g.branch}@${g.head.slice(0, 8)} · ${g.commits} commits ${g.firstCommit} → ${g.lastCommit}${g.dirtyFiles ? ` · ${g.dirtyFiles} uncommitted files` : ''}`);
    if (!g.defaultBranch) console.log('  ⚠ default branch unknown (no origin/HEAD, no main or master)');
    else if (!g.onDefaultBranch) console.log(`  ⚠ on ${g.branch}, not the default branch ${g.defaultBranch}`);
    if (g.behindRemoteDefault) console.log(`  ⚠ ${g.behindRemoteDefault} commits behind origin/${g.defaultBranch} as of the last fetch`);
  }
  if (r.excavator) console.log(`  .excavator: ${r.excavator.files.join(', ')} · ${r.excavator.fresh ? 'fresh' : `stale or unknown (revision ${r.excavator.sourceRevision ?? 'none'})`}`);
  if (r.existingSkopo.length) console.log(`  existing skopo: ${r.existingSkopo.join(', ')}`);
  if (r.exampleSkopo.length) console.log(`  example skopositories (not this repository's skopo): ${r.exampleSkopo.join(', ')}`);
}
if (out) console.log(`written: ${out}`);
