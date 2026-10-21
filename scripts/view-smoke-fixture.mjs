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
 *   node scripts/view-smoke-fixture.mjs <empty-directory> [--full]
 *
 * prints one JSON line: { root, revision, expected }, where `expected` is what
 * each page should count (the `data-xv-count-*` values the smoke reads back).
 * `--full` writes the Full-mode shape of the graph instead: node summaries and
 * tags empty, the summaries in a semantic cache (one entry stale, one
 * contradicted) and the layers in a semantic graph, and a domain graph made
 * from that graph's facts (two domains, three flows, five steps).
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditSemanticCacheFields } from '../skills/excavator/semantic-language-audit.mjs';

const GRAPH_FORMAT = 'excavator-knowledge-graph-lines/1';

const SOURCES = {
  'src/main.js': 'import { helper } from "./util.js";\n\nexport function main() {\n  return helper(1);\n}\n\nfunction orphan() {\n  return 0;\n}\n',
  'src/util.js': 'export function helper(n) {\n  return n + 1;\n}\n\nexport function leaf() {\n  return orphanless();\n}\n',
  'src/core/index.js': 'import { run } from "./engine/run.js";\n\nexport function start() {\n  return run();\n}\n',
  'src/core/engine/run.js': 'import { helper } from "../../util.js";\n\nexport function run() {\n  return helper(2);\n}\n',
  'lib/data.py': 'def load():\n    return []\n\n\ndef unused_loader():\n    return None\n',
  'docs/guide.md': '# Guide\n\nThe main function runs the helper.\n',
  'scripts/build.sh': '#!/bin/sh\necho build\n',
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

function graphText({ factsDigest } = {}) {
  const node = (id, type, name, extra = {}) => ({ record: 'node', node: { id, type, name, ...extra } });
  const edge = (source, target, type) => ({ record: 'edge', edge: { source, target, type } });
  const nodes = [
    node('file:src/main.js', 'file', 'main.js', { filePath: 'src/main.js' }),
    node('file:src/util.js', 'file', 'util.js', { filePath: 'src/util.js' }),
    node('file:lib/data.py', 'file', 'data.py', { filePath: 'lib/data.py' }),
    node('file:src/core/index.js', 'file', 'index.js', { filePath: 'src/core/index.js' }),
    node('file:src/core/engine/run.js', 'file', 'run.js', { filePath: 'src/core/engine/run.js' }),
    node('function:src/core/index.js:start', 'function', 'start', { filePath: 'src/core/index.js', lineRange: [3, 5] }),
    node('function:src/core/engine/run.js:run', 'function', 'run', { filePath: 'src/core/engine/run.js', lineRange: [3, 5] }),
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
    edge('file:src/core/index.js', 'function:src/core/index.js:start', 'contains'),
    edge('file:src/core/engine/run.js', 'function:src/core/engine/run.js:run', 'contains'),
    edge('file:src/main.js', 'file:src/util.js', 'imports'),
    edge('function:src/main.js:main', 'function:src/util.js:helper', 'calls'),
    edge('file:src/main.js', 'file:src/core/index.js', 'imports'),
    edge('file:src/core/index.js', 'file:src/core/engine/run.js', 'imports'),
    edge('file:src/core/engine/run.js', 'file:src/util.js', 'imports'),
    edge('function:src/core/index.js:start', 'function:src/core/engine/run.js:run', 'calls'),
    edge('function:src/core/engine/run.js:run', 'function:src/util.js:helper', 'calls'),
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
    fields: { project: { name: 'smoke-fixture', languages: ['javascript', 'python'], frameworks: [], description: 'a synthetic project', ...(factsDigest ? { factsDigest } : {}) }, kind: 'knowledge' },
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
    counts: { filesWithHistory: 4, filesWithoutHistory: 0, binaryFiles: 0, filesWithLineageConflicts: 0 },
    conservation: { changesRead: 12, attributed: 10, outsideSelection: 2 },
    residualAssumptions: ['History is read from HEAD only.'],
    // scripts/build.sh is a file of the repository that the graph has no node for.
    files: [file('src/main.js', { score: 90, commits: 9 }), file('src/util.js', { score: 40, commits: 4 }), file('lib/data.py', { score: 5, commits: 1, lastChanged: null }), file('scripts/build.sh', { score: 3, commits: 1, lines: 2 })],
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

const FACTS_DIGEST = 'f'.repeat(64);
/** The text a verifier rejected: the Full smoke checks it is in neither the page's text nor its data. */
export const CONTRADICTED_SUMMARY = 'Spawns a worker pool for every call and never joins it.';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** The Full-mode files: a manifest with each file's content hash, the semantic cache and the semantic graph. */
function fullFiles(revision) {
  const hashes = Object.fromEntries(Object.entries(SOURCES).map(([path, text]) => [path, sha256(text)]));
  const entry = (summary, path, extra = {}, hash = hashes[path]) => {
    const fields = { summary, tags: extra.tags ?? [], semanticSourceHash: hash, ...(extra.verification ? { verification: extra.verification } : {}) };
    return { ...fields, languageAudit: auditSemanticCacheFields({ fields }) };
  };
  return {
    manifest: { sourceRevision: revision, entries: Object.entries(hashes).map(([path, contentHash]) => ({ path, contentHash })) },
    cache: {
      version: '2.0.0',
      contentLanguage: 'en',
      entries: {
        'file:src/main.js': entry('Entry module that calls the helper.', 'src/main.js', { tags: ['entry'], verification: 'verified' }),
        'function:src/main.js:main': entry('Runs the helper on one.', 'src/main.js', { verification: 'verified' }),
        'function:src/main.js:orphan': entry(CONTRADICTED_SUMMARY, 'src/main.js', { tags: ['concurrency'], verification: 'contradicted' }),
        'file:src/util.js': entry('Small numeric helpers.', 'src/util.js'),
        'function:src/util.js:helper': entry('Adds one to a number.', 'src/util.js', { verification: 'unverified' }),
        // Written for source that has since changed: stale, so not shown.
        'function:src/util.js:leaf': entry('Computed from older source.', 'src/util.js', {}, sha256('older source')),
        'file:lib/data.py': entry('Loads data from disk.', 'lib/data.py'),
        'function:lib/data.py:load': entry('Returns an empty list.', 'lib/data.py', { verification: 'verified' }),
      },
    },
    graph: {
      version: '2.0.0',
      contentLanguage: 'en',
      factDigest: FACTS_DIGEST,
      generatedAt: '2026-01-01T00:00:00.000Z',
      model: 'fixture',
      layers: [
        { id: 'layer:app', name: 'Application', description: 'The code that runs the program.', nodeIds: ['file:src/main.js', 'file:src/util.js'] },
        { id: 'layer:data', name: 'Data', description: 'Loading data.', nodeIds: ['file:lib/data.py'] },
      ],
      relations: [],
      gaps: [],
    },
  };
}

/**
 * The domain graph of the Full fixture: two domains joined by one cross-domain edge, three flows, five steps. The weights
 * of the first flow's steps are not in the order they are written in; one step names a node the graph lacks and one names none.
 */
function domainGraphFile(revision) {
  const node = (id, type, name, summary, extra = {}) => ({ id, type, name, summary, tags: [], complexity: 'simple', ...extra });
  const step = (flow, slug, name, summary, extra) => node(`step:${flow}:${slug}`, 'step', name, summary, extra);
  const edge = (source, target, type, weight, extra = {}) => ({ source, target, type, direction: 'forward', weight, ...extra });
  return {
    version: '2.0.0',
    contentLanguage: 'en',
    sourceRevision: revision,
    factDigest: FACTS_DIGEST,
    nodes: [
      node('domain:app', 'domain', 'Application', 'Runs the program.', { domainMeta: { entities: ['Session'], businessRules: ['Start-up runs once per process'] } }),
      node('domain:data', 'domain', 'Data', 'Loads the data the program needs.', { domainMeta: { entities: ['Record'] } }),
      node('flow:start-up', 'flow', 'Start up', 'Starts the program and reports the result.', { domainMeta: { entryPoint: 'main', entryType: 'cli' } }),
      node('flow:cleanup', 'flow', 'Clean up', 'Removes what a run leaves behind.', { domainMeta: { entryPoint: 'purge', entryType: 'cli' } }),
      node('flow:load-data', 'flow', 'Load data', 'Reads the data from disk.', { domainMeta: { entryPoint: 'load', entryType: 'call' } }),
      step('start-up', 'report', 'Report result', 'Hands the result back to the caller.', { filePath: 'src/main.js', nodeIds: ['function:src/main.js:main'], evidence: [{ file: 'src/main.js', line: 4, source: 'rule' }] }),
      step('start-up', 'begin', 'Begin', 'Starts the engine from the program entry.', { filePath: 'src/core/index.js', nodeIds: ['function:src/core/index.js:start', 'function:src/gone.js:x'], unresolvedNodeIds: ['function:src/gone.js:x'], evidence: [{ file: 'src/core/index.js', line: 4, source: 'rule' }], provenance: 'inferred' }),
      step('start-up', 'run', 'Run the engine', 'Runs the engine on its input.', { filePath: 'src/core/engine/run.js', nodeIds: ['function:src/core/engine/run.js:run', 'file:src/core/engine/run.js'], evidence: [] }),
      step('cleanup', 'purge', 'Purge', 'Deletes the temporary files.', { nodeIds: [], evidence: [] }),
      step('load-data', 'read', 'Read', 'Reads the records.', { filePath: 'lib/data.py', nodeIds: ['function:lib/data.py:load'], evidence: [{ file: 'lib/data.py', line: 2, source: 'rule' }] }),
    ],
    edges: [
      edge('domain:app', 'flow:start-up', 'contains_flow', 1),
      edge('domain:app', 'flow:cleanup', 'contains_flow', 1),
      edge('domain:data', 'flow:load-data', 'contains_flow', 1),
      edge('flow:start-up', 'step:start-up:report', 'flow_step', 0.9),
      edge('flow:start-up', 'step:start-up:begin', 'flow_step', 0.2),
      edge('flow:start-up', 'step:start-up:run', 'flow_step', 0.5),
      edge('flow:cleanup', 'step:cleanup:purge', 'flow_step', 1),
      edge('flow:load-data', 'step:load-data:read', 'flow_step', 1),
      edge('domain:app', 'domain:data', 'cross_domain', 0.7, { description: 'Application asks Data to load what it needs.' }),
    ],
    gaps: [],
  };
}

/** What the domain view should show, for the smoke's checks. */
const DOMAIN_EXPECTED = {
  counts: { domains: 2, flows: 3, steps: 5, links: 1 },
  cards: ['Application', 'Data'],
  note: 'The domain graph is derived by a model from the code; it describes the code and is not itself a fact of the code.',
  link: 'Application asks Data to load what it needs.',
  domain: { id: 'domain:app', level: 'domain:domain:app', flows: ['flow:start-up', 'flow:cleanup'] },
  flow: { id: 'flow:start-up', level: 'flow:domain:app:flow:start-up', steps: ['step:start-up:begin', 'step:start-up:run', 'step:start-up:report'], names: ['Begin', 'Run the engine', 'Report result'] },
  // The first step by weight: its first nodeId is in the graph; the second is not.
  step: { id: 'step:start-up:begin', anchors: ['function:src/core/index.js:start'], missing: ['function:src/gone.js:x'], evidence: { label: 'src/core/index.js:4', file: 'src/core/index.js', highlight: '4-4', marked: ['4'] } },
  digests: { domain: FACTS_DIGEST, graph: 'e'.repeat(64) },
};

/**
 * What the graph page should show at each level the smoke visits: the route
 * path, the entries drawn, the files under the level, the labels of the
 * entries and the one to click to go down (a directory-grouped graph and a
 * layered one group differently).
 */
function graphExpected(full) {
  // What the interaction checks expect: where a search result lives (the level differs with the grouping), what a focus counts, and a path.
  const interaction = (runLevel, helperLevel) => ({
    search: [
      { query: 'run', id: 'function:src/core/engine/run.js:run', level: runLevel, file: 'src/core/engine/run.js', lines: '3-5', name: 'run' },
      { query: 'helper', id: 'function:src/util.js:helper', level: helperLevel, file: 'src/util.js', lines: '1-3', name: 'helper' },
    ],
    // helper: contained by util.js, called by main and by run: three distinct nodes at the other end of its edges.
    focus: { id: 'function:src/util.js:helper', level: helperLevel, neighbours: 3, edges: 3 },
    // start calls run, run calls helper.
    path: { from: 'function:src/core/index.js:start', to: 'function:src/util.js:helper', steps: 2, none: { from: 'function:lib/data.py:load' } },
  });
  if (full) {
    return {
      mode: 'layers',
      levels: [
        { path: '', nodes: 3, files: 5, labels: ['Application', 'Not in any layer', 'Data'], open: 'Not in any layer' },
        { path: '~unlayered/src/core', nodes: 2, files: 2, labels: ['engine', 'index.js'], open: 'engine' },
        { path: '~unlayered/src/core/engine', nodes: 1, files: 1, labels: ['run.js'] },
      ],
      interaction: interaction('~unlayered/src/core/engine', 'layer:app/src'),
    };
  }
  return {
    mode: 'directories',
    levels: [
      { path: '', nodes: 3, files: 5, labels: ['src/core', 'src', 'lib'], open: 'src/core' },
      { path: 'src/core', nodes: 2, files: 2, labels: ['engine', 'index.js'], open: 'engine' },
      { path: 'src/core/engine', nodes: 1, files: 1, labels: ['run.js'] },
    ],
    interaction: interaction('src/core/engine', 'src'),
  };
}

const HOSTILE = '</script><img src=x onerror=alert(1)>';

/**
 * Create the smoke project in `dir` (an existing, empty directory): the sources,
 * one commit, and every product the viewer reads. Returns where it is, its
 * revision and the counts each page should show. With `full`, the graph is
 * Full-mode shaped and the semantic files are written (see the top of the file).
 */
export function makeSmokeProject(dir, { full = false } = {}) {
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

  const semantic = full ? fullFiles(revision) : null;
  writeJson(root, 'knowledge-graph.jsonl', graphText({ factsDigest: full ? FACTS_DIGEST : undefined }));
  writeJson(root, 'source-manifest.json', semantic ? semantic.manifest : { sourceRevision: revision });
  if (semantic) {
    writeJson(root, 'semantic-cache.json', semantic.cache);
    writeJson(root, 'semantic-graph.json', semantic.graph);
    writeJson(root, 'domain-graph.json', domainGraphFile(revision));
  }
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
      overview: {
        nodes: 14, edges: 15, gaps: 1,
        ...(full ? { 'semantic-entries': 7, 'semantic-stale': 1, 'semantic-verified': 3, 'semantic-unverified': 1, 'semantic-contradicted': 1, 'semantic-unchecked': 2, 'semantic-layers': 2, 'summaries-shown': 6 } : {}),
      },
      unused: { unused: 3, 'unused-shown': 3 },
      'doc-map': { units: 3, 'units-shown': 3, checks: 3 },
      hotspots: { files: 4, directories: 2, pairs: 1, groups: 0 },
      code: { sources: 6 },
      graph: graphExpected(full),
      ...(full ? { domain: DOMAIN_EXPECTED } : {}),
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
    const args = process.argv.slice(2);
    const full = args.includes('--full');
    const [dir] = args.filter((arg) => arg !== '--full');
    if (!dir) throw new Error('Usage: node scripts/view-smoke-fixture.mjs <empty-directory> [--full]');
    process.stdout.write(`${JSON.stringify(makeSmokeProject(dir, { full }))}\n`);
  } catch (error) {
    process.stderr.write(`view-smoke-fixture failed: ${error.message}\n`);
    process.exit(1);
  }
}
