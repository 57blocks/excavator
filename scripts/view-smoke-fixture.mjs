#!/usr/bin/env node
/**
 * view-smoke-fixture.mjs
 *
 * Writes the synthetic project the view smoke runs on (openspec:
 * changes/viewer-app, design O3): a one-commit Git repository and hand-built
 * `.excavator/` products, so `pack.mjs` has every product to pack and
 * `view-smoke.mjs` has numbers to check. Nothing here is derived from a real
 * project.
 *
 *   node scripts/view-smoke-fixture.mjs <empty-directory>
 *
 * prints one JSON line: { root, revision, expected }, where `expected` is what
 * each page should count (the `data-xv-count-*` values the smoke reads back).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GRAPH_FORMAT = 'excavator-knowledge-graph-lines/1';

const SOURCES = {
  'src/main.js': 'import { helper } from "./util.js";\n\nexport function main() {\n  return helper(1);\n}\n\nfunction orphan() {\n  return 0;\n}\n',
  'src/util.js': 'export function helper(n) {\n  return n + 1;\n}\n\nexport function leaf() {\n  return orphanless();\n}\n',
  'lib/data.py': 'def load():\n    return []\n\n\ndef unused_loader():\n    return None\n',
  'docs/guide.md': '# Guide\n\nThe main function runs the helper.\n',
};

const git = (cwd, ...args) => execFileSync('git', args, {
  cwd,
  encoding: 'utf-8',
  env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test' },
}).trim();

function writeJson(root, name, value) {
  const path = join(root, '.excavator', name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
}

function graphText() {
  const node = (id, type, name, extra = {}) => ({ record: 'node', node: { id, type, name, ...extra } });
  const edge = (source, target, type) => ({ record: 'edge', edge: { source, target, type } });
  const nodes = [
    node('file:src/main.js', 'file', 'main.js', { filePath: 'src/main.js' }),
    node('file:src/util.js', 'file', 'util.js', { filePath: 'src/util.js' }),
    node('file:lib/data.py', 'file', 'data.py', { filePath: 'lib/data.py' }),
    node('function:src/main.js:main', 'function', 'main', { filePath: 'src/main.js', lineRange: [3, 5] }),
    node('function:src/main.js:orphan', 'function', 'orphan', { filePath: 'src/main.js', lineRange: [7, 9] }),
    node('function:src/util.js:helper', 'function', 'helper', { filePath: 'src/util.js', lineRange: [1, 3] }),
    node('function:src/util.js:leaf', 'function', 'leaf', { filePath: 'src/util.js', lineRange: [5, 7] }),
    node('function:lib/data.py:load', 'function', 'load', { filePath: 'lib/data.py', lineRange: [1, 2] }),
    node('function:lib/data.py:unused_loader', 'function', 'unused_loader', { filePath: 'lib/data.py', lineRange: [5, 6] }),
    node('document:docs/guide.md', 'document', 'guide.md', { filePath: 'docs/guide.md' }),
  ];
  const edges = [
    edge('file:src/main.js', 'function:src/main.js:main', 'contains'),
    edge('file:src/main.js', 'function:src/main.js:orphan', 'contains'),
    edge('file:src/util.js', 'function:src/util.js:helper', 'contains'),
    edge('file:src/util.js', 'function:src/util.js:leaf', 'contains'),
    edge('file:lib/data.py', 'function:lib/data.py:load', 'contains'),
    edge('file:lib/data.py', 'function:lib/data.py:unused_loader', 'contains'),
    edge('file:src/main.js', 'file:src/util.js', 'imports'),
    edge('function:src/main.js:main', 'function:src/util.js:helper', 'calls'),
  ];
  const gaps = [{ record: 'gap', gap: { kind: 'dynamic-call', scope: 'src/util.js', reason: 'call target is computed', count: 2 } }];
  const coverage = {
    record: 'coverage',
    coverage: {
      files: 4,
      ignored: 1,
      byLanguage: {
        javascript: { files: 2, parsed: 2, zeroSymbol: 0, skipped: {}, kinds: { function: 4, class: 0, import: 1, export: 3, call: 1 } },
        python: { files: 1, parsed: 1, zeroSymbol: 0, skipped: { 'too-large': 0 }, kinds: { function: 2, class: 0, import: 0, export: 0, call: 0 } },
      },
    },
  };
  const header = {
    record: 'header',
    format: GRAPH_FORMAT,
    keys: ['project', 'nodes', 'edges', 'gaps', 'coverage'],
    fields: { project: { name: 'smoke-fixture', languages: ['javascript', 'python'], frameworks: [], description: 'a synthetic project' }, kind: 'knowledge' },
    counts: { nodes: nodes.length, edges: edges.length, gaps: gaps.length },
  };
  return `${[header, ...nodes, ...edges, ...gaps, coverage].map((record) => JSON.stringify(record)).join('\n')}\n`;
}

function unusedProduct(revision) {
  const row = (id, name, file, lineRange, reason, confidence, group, language = 'javascript') => ({ id, name, language, file, lineRange, owner: null, visibility: 'private', reason, confidence, group, signals: [] });
  return {
    format: 'excavator-unused-code/1',
    sourceRevision: revision,
    counts: {
      candidates: 6, removedByDecision: 2, testOnly: 1, unused: 3, unreferenced: 2, onlyReachableFromUnused: 1, groups: 2,
      byConfidence: { high: 1, medium: 1, low: 1 },
      byLanguage: { javascript: { candidates: 4, calls: 3, unused: 2, high: 1, medium: 1, low: 0 }, python: { candidates: 2, calls: 0, unused: 1, high: 0, medium: 0, low: 1 } },
    },
    conservation: { candidates: 6, removedByDecision: 2, testOnly: 1, unused: 3, holds: true },
    residualAssumptions: ['The fixture lists only what it was written to list.'],
    decisions: [{ kind: 'framework-entry', reason: 'a callback the framework invokes', query: '.name | test("^on")', hits: 2 }],
    unused: [
      row('function:src/main.js:orphan', 'orphan', 'src/main.js', [7, 9], 'unreferenced', 'high', 0),
      row('function:src/util.js:leaf', 'leaf', 'src/util.js', [5, 7], 'only-reachable-from-unused', 'medium', 0),
      row('function:lib/data.py:unused_loader', 'unused_loader', 'lib/data.py', [5, 6], 'unreferenced', 'low', 1, 'python'),
    ],
    groups: [],
    testOnly: [row('function:src/util.js:helper', 'helper', 'src/util.js', [1, 3], 'unreferenced', 'low', 1)],
  };
}

function docMapProduct(revision) {
  const evidence = (file, line, code) => ({ file, line, code });
  return {
    format: 'excavator-doc-map/1',
    docsRoot: 'docs',
    converters: {},
    code: { root: '.', revision },
    counts: { files: 2, read: 1, empty: 0, noConverter: 0, unsupported: 0, failed: 1, units: 3, found: 2, notFound: 1, notChecked: 0 },
    residualAssumptions: ['Units are listed by each document\'s own structure.'],
    documents: [
      { path: 'guide.md', format: 'markdown', status: 'read', chars: 40, lines: 3, pages: null, units: 3 },
      { path: 'broken.docx', format: 'docx', status: 'failed', reason: 'the file could not be converted', chars: null, lines: null, pages: null, units: null },
    ],
    units: [
      { document: 'guide.md', id: 'G-1', title: 'Run the helper', quote: 'The main function runs the helper.', line: 3, page: null, code: { status: 'found', evidence: [evidence('src/main.js', 4, 'return helper(1);'), evidence('src/util.js', 2, 'return n + 1;')], searched: [] } },
      { document: 'guide.md', id: 'G-2', title: 'Load data', quote: 'Data is loaded from <b>disk</b>.', line: 5, page: null, code: { status: 'found', evidence: [evidence('lib/data.py', 2, 'return []')], searched: [] } },
      { document: 'guide.md', id: 'G-3', title: 'Send mail', quote: 'The system sends a welcome mail.', line: 7, page: null, code: { status: 'not-found', evidence: [], searched: [{ pattern: 'send.*mail', paths: ['src', 'lib'] }] } },
    ],
    coverage: {
      sourceRevision: revision,
      counts: { files: 4, documents: 1, code: 3, withEvidence: 3, withoutEvidence: 0, evidence: 3, outside: 0 },
      directories: [{ path: 'src', files: 2, withEvidence: 2, units: [1] }, { path: 'lib', files: 1, withEvidence: 1, units: [2] }],
      files: [{ path: 'src/main.js', units: [1] }, { path: 'src/util.js', units: [1] }, { path: 'lib/data.py', units: [2] }],
      outside: [],
      documents: ['docs/guide.md'],
    },
  };
}

const DOC_MAP_CHECKS = {
  checks: [
    { unit: 1, file: 'src/main.js', line: 4, verdict: 'does', reason: 'it calls the helper' },
    { unit: 1, file: 'src/util.js', line: 2, verdict: 'not', reason: 'it only adds one' },
    { unit: 2, file: 'lib/data.py', line: 2, verdict: 'none', reason: null },
  ],
};

function hotspotsProduct(revision) {
  const file = (path, over) => ({ path, commits: 3, authors: 1, added: 10, removed: 2, lastChanged: '2026-01-02T03:04:05+00:00', lines: 10, score: 30, lineageConflicts: 0, ...over });
  return {
    format: 'excavator-hotspots/1',
    sourceRevision: revision,
    historyAvailable: true,
    noHistory: null,
    sourceKind: 'git',
    window: { since: null, sinceUtc: null },
    counts: { filesWithHistory: 3, filesWithoutHistory: 0, binaryFiles: 0, filesWithLineageConflicts: 0 },
    conservation: { changesRead: 12, attributed: 9, outsideSelection: 3 },
    residualAssumptions: ['History is read from HEAD only.'],
    files: [file('src/main.js', { score: 90, commits: 9 }), file('src/util.js', { score: 40, commits: 4 }), file('lib/data.py', { score: 5, commits: 1, lastChanged: null })],
    directories: [
      { path: 'src', files: 2, commits: 13, authors: 1, added: 20, removed: 4, lines: 18, score: 130, lastChanged: '2026-01-02T03:04:05+00:00', commitsByYear: { 2025: 6, 2026: 7 }, concentration: { commitsByPeople: 13, topAuthorShare: 1, authorsFor80Percent: 1 } },
      { path: 'lib', files: 1, commits: 1, authors: 1, added: 3, removed: 0, lines: 6, score: 5, lastChanged: null },
    ],
    pairs: [{ a: 'src/main.js', b: 'src/util.js', together: 4, shareOfA: 0.44, shareOfB: 1 }],
    coChange: { maxFilesPerCommit: 30, minTogether: 3, commitsCounted: 4, commitsOverLimit: 0, pairsListed: 1, pairsBelowMinimum: 0 },
    groups: [],
    featureGroups: null,
  };
}

const HOSTILE = '</script><img src=x onerror=alert(1)>';

/**
 * Create the smoke project in `dir` (an existing, empty directory): the sources,
 * one commit, and every product the viewer reads. Returns where it is, its
 * revision and the counts each page should show.
 */
export function makeSmokeProject(dir) {
  const root = realpathSync(resolve(dir));
  if (readdirSync(root).length > 0) throw new Error(`${root} is not empty`);
  git(root, 'init', '-q');
  for (const [path, text] of Object.entries(SOURCES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'fixture');
  const revision = `git:${git(root, 'rev-parse', 'HEAD')}`;

  writeJson(root, 'knowledge-graph.jsonl', graphText());
  writeJson(root, 'source-manifest.json', { sourceRevision: revision });
  writeJson(root, 'unused-code.json', unusedProduct(revision));
  writeJson(root, 'doc-map.json', docMapProduct(revision));
  writeJson(root, 'doc-map/checks.json', DOC_MAP_CHECKS);
  writeJson(root, 'hotspots.json', hotspotsProduct(revision));
  writeJson(root, 'hotspots-report.md', `# Hotspots\n\nTwo files change most.\n\n| File | Commits |\n|---|---|\n| src/main.js | 9 |\n\n${HOSTILE}\n\n<script>alert(2)</script>\n\n[a route](#/code?path=src%2Fmain.js) and [elsewhere](https://example.test/x)\n`);
  writeJson(root, 'doc-map-report.md', '# Doc map\n\nOne unit has no code.\n');

  return {
    root,
    revision,
    expected: {
      overview: { nodes: 10, edges: 8, gaps: 1 },
      unused: { unused: 3, 'unused-shown': 3 },
      'doc-map': { units: 3, 'units-shown': 3, checks: 3 },
      hotspots: { files: 3, directories: 2, pairs: 1, groups: 0 },
      code: { sources: 3 },
      reports: { reports: 2 },
    },
  };
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    const [dir] = process.argv.slice(2);
    if (!dir) throw new Error('Usage: node scripts/view-smoke-fixture.mjs <empty-directory>');
    process.stdout.write(`${JSON.stringify(makeSmokeProject(dir))}\n`);
  } catch (error) {
    process.stderr.write(`view-smoke-fixture failed: ${error.message}\n`);
    process.exit(1);
  }
}
