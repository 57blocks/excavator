/**
 * Synthetic projects for the report-viewer tests: a temporary git repository
 * with one commit, plus hand-built `.excavator/` products. Nothing here is
 * derived from a real project.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { auditSemanticCacheFields } from '../../../skills/excavator/semantic-language-audit.mjs';

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

/** A parent directory that is not a repository, holding one committed git repository per member name. */
export function makeMultiRepoProject(members) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'xv-multi-')));
  for (const [name, files] of Object.entries(members)) {
    const dir = join(root, name);
    mkdirSync(dir);
    git(dir, 'init', '-q');
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'fixture');
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
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

export function sourceManifest(revision, entries) {
  return entries === undefined ? { sourceRevision: revision } : { sourceRevision: revision, entries };
}

/** A knowledge graph that records its facts digest and the file each node belongs to, as the Full-mode graph does. */
export function factGraphJsonl({ factsDigest, nodes }) {
  const lines = [{
    record: 'header',
    format: GRAPH_FORMAT,
    keys: ['project', 'nodes'],
    fields: { project: { name: 'fixture', languages: ['javascript'], frameworks: [], ...(factsDigest === undefined ? {} : { factsDigest }) }, kind: 'knowledge' },
    counts: { nodes: nodes.length },
  }];
  for (const { id, filePath } of nodes) {
    lines.push({ record: 'node', node: { id, type: id.split(':')[0], name: id, filePath, summary: '', tags: [] } });
  }
  return `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;
}

/** A semantic-cache entry with the language audit the writer records, so the plugin's own gate accepts it. */
export function semanticEntry({ summary, tags = [], semanticSourceHash, verification }) {
  const fields = { summary, tags, semanticSourceHash, ...(verification === undefined ? {} : { verification }) };
  return { ...fields, languageAudit: auditSemanticCacheFields({ fields }) };
}

export function semanticCache(entries, extra = {}) {
  return { version: '2.0.0', contentLanguage: 'en', entries, ...extra };
}

export function semanticGraph({ factDigest, layers = [], extra = {} }) {
  return { version: '2.0.0', contentLanguage: 'en', factDigest, generatedAt: '2026-01-01T00:00:00.000Z', model: 'fixture', layers, relations: [], gaps: [], ...extra };
}

/**
 * A domain graph as the Domain skill saves it: two domains, one cross-domain edge, a flow in each, and steps whose
 * `flow_step` weights are not in the order they are listed in (the page sorts by weight). `extra` replaces top-level keys.
 */
export function domainGraph({ sourceRevision, factDigest, extra = {} } = {}) {
  const step = (flow, name, extra2 = {}) => ({ id: `step:${flow}:${name}`, type: 'step', name, summary: `Does ${name}.`, filePath: 'src/a.js', nodeIds: ['file:src/a.js'], evidence: [{ file: 'src/a.js', line: 1, source: 'rule' }], ...extra2 });
  const nodes = [
    { id: 'domain:billing', type: 'domain', name: 'Billing', summary: 'Charges customers.', tags: [], complexity: 'moderate', domainMeta: { entities: ['Invoice'], businessRules: ['An invoice is issued once'] } },
    { id: 'domain:shipping', type: 'domain', name: 'Shipping', summary: 'Moves parcels.', tags: [], complexity: 'simple', domainMeta: { entities: ['Parcel'] } },
    { id: 'flow:charge', type: 'flow', name: 'Charge a customer', summary: 'Takes payment.', tags: [], complexity: 'moderate', domainMeta: { entryPoint: 'POST /charge', entryType: 'http' } },
    { id: 'flow:dispatch', type: 'flow', name: 'Dispatch a parcel', summary: 'Hands a parcel to a carrier.', tags: [], complexity: 'simple', domainMeta: { entryPoint: 'dispatch', entryType: 'cli' } },
    step('charge', 'capture', { nodeIds: ['function:src/a.js:run', 'function:src/gone.js:x'], unresolvedNodeIds: ['function:src/gone.js:x'] }),
    step('charge', 'validate'),
    step('charge', 'receipt', { filePath: 'src/b.js', nodeIds: ['file:src/b.js'], evidence: [], provenance: 'inferred' }),
    step('dispatch', 'pick', { filePath: 'src/b.js', nodeIds: ['function:src/b.js:load'] }),
  ];
  const edges = [
    { source: 'domain:billing', target: 'flow:charge', type: 'contains_flow', direction: 'forward', weight: 1 },
    { source: 'domain:shipping', target: 'flow:dispatch', type: 'contains_flow', direction: 'forward', weight: 1 },
    { source: 'flow:charge', target: 'step:charge:capture', type: 'flow_step', direction: 'forward', weight: 0.6 },
    { source: 'flow:charge', target: 'step:charge:validate', type: 'flow_step', direction: 'forward', weight: 0.2 },
    { source: 'flow:charge', target: 'step:charge:receipt', type: 'flow_step', direction: 'forward', weight: 0.9 },
    { source: 'flow:dispatch', target: 'step:dispatch:pick', type: 'flow_step', direction: 'forward', weight: 0.2 },
    { source: 'domain:billing', target: 'domain:shipping', type: 'cross_domain', direction: 'forward', description: 'Billing tells Shipping when an order is paid.', weight: 0.7 },
  ];
  return {
    version: '2.0.0',
    contentLanguage: 'en',
    ...(sourceRevision === undefined ? {} : { sourceRevision }),
    ...(factDigest === undefined ? {} : { factDigest }),
    project: { name: 'fixture', languages: ['javascript'], frameworks: [], description: '' },
    nodes,
    edges,
    layers: [],
    tour: [],
    gaps: [{ kind: 'step-file-anchored', scope: 'domain', reason: '1 step is anchored to a whole file', count: 1, samples: ['step:charge:receipt'] }],
    languageAudit: { status: 'accepted', fields: 1 },
    ...extra,
  };
}
