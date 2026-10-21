/**
 * Synthetic projects for the report-viewer tests: a temporary git repository
 * with one commit, plus hand-built `.excavator/` products. Nothing here is
 * derived from a real project.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const GRAPH_FORMAT = 'excavator-knowledge-graph-lines/1';

const git = (cwd, ...args) => execFileSync('git', args, {
  cwd,
  encoding: 'utf-8',
  env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test' },
}).trim();

/** A committed git repository in a fresh temp directory; returns { root, revision, cleanup }. */
export function makeGitProject(files = { 'src/main.js': 'export function main() {}\n' }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'xv-fixture-')));
  git(root, 'init', '-q');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'fixture');
  return { root, revision: `git:${git(root, 'rev-parse', 'HEAD')}`, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Write a file under the project's `.excavator/`. */
export function writeProduct(root, name, content) {
  const path = join(root, '.excavator', name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
}

export function unusedProduct(revision, extra = {}) {
  return {
    format: 'excavator-unused-code/1',
    sourceRevision: revision,
    counts: { candidates: 3, removedByDecision: 1, testOnly: 0, unused: 2, byConfidence: { high: 1, medium: 1, low: 0 } },
    conservation: { candidates: 3, removedByDecision: 1, testOnly: 0, unused: 2, holds: true },
    residualAssumptions: ['fixture assumption'],
    decisions: [],
    unused: [
      { id: 'u1', name: 'orphan', language: 'javascript', file: 'src/main.js', lineRange: [1, 1], reason: 'unreferenced', confidence: 'high' },
      { id: 'u2', name: 'leaf', language: 'javascript', file: 'src/main.js', lineRange: [1, 1], reason: 'only-reachable-from-unused', confidence: 'medium' },
    ],
    groups: [],
    testOnly: [],
    ...extra,
  };
}

export function docMapProduct(revision, extra = {}) {
  return {
    format: 'excavator-doc-map/1',
    docsRoot: 'docs',
    converters: {},
    code: revision === undefined ? null : { root: '.', revision },
    counts: { files: 1, read: 1, units: 1, found: 1, notFound: 0, notChecked: 0 },
    residualAssumptions: [],
    documents: [{ path: 'a.md', format: 'text', status: 'read', units: 1 }],
    units: [{ document: 'a.md', id: 'a-1', title: 'A', quote: 'quote', line: 1, page: null, code: null }],
    coverage: null,
    ...extra,
  };
}

export function hotspotsProduct(revision, extra = {}) {
  return {
    format: 'excavator-hotspots/1',
    sourceRevision: revision,
    historyAvailable: true,
    noHistory: null,
    window: { since: null, sinceUtc: null },
    counts: { filesWithHistory: 1, filesWithoutHistory: 0, binaryFiles: 0, filesWithLineageConflicts: 0 },
    residualAssumptions: [],
    files: [{ path: 'src/main.js', commits: 1, authors: 1, added: 1, removed: 0, lastChanged: null, lines: 1, score: 1, lineageConflicts: 0 }],
    directories: [],
    pairs: [],
    groups: [],
    ...extra,
  };
}

/** A knowledge-graph JSONL text with the given node and edge types. */
export function graphJsonl({ name = 'fixture', nodes = [], edges = [], gaps = [], coverage, header = {} } = {}) {
  const lines = [{
    record: 'header',
    format: GRAPH_FORMAT,
    keys: ['project', 'nodes', 'edges', 'gaps', ...(coverage ? ['coverage'] : [])],
    fields: { project: { name, languages: ['javascript'], frameworks: ['express'], description: 'a fixture' }, kind: 'knowledge', ...header },
    counts: { nodes: nodes.length, edges: edges.length, gaps: gaps.length },
  }];
  nodes.forEach((type, i) => lines.push({ record: 'node', node: { id: `n${i}`, type, name: `n${i}` } }));
  edges.forEach((type, i) => lines.push({ record: 'edge', edge: { source: 'n0', target: `n${i}`, type } }));
  gaps.forEach((gap) => lines.push({ record: 'gap', gap }));
  if (coverage) lines.push({ record: 'coverage', coverage });
  return `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;
}

export function sourceManifest(revision) {
  return { sourceRevision: revision };
}
