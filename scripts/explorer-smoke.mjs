#!/usr/bin/env node
/**
 * explorer-smoke.mjs
 *
 * The offline smoke of the dashboard copy: builds a small synthetic data object (a hand-written knowledge graph in
 * the dashboard's format, a domain graph, a name table, the four products and two sources), puts it and the content
 * security policy into the built template `packages/explorer/dist/explorer.html` with the packer's own
 * `assembleExplorerPage` (the data as an index block and gzip parts, cut at a tiny part limit so the graph, a product
 * and the sources each span several parts), opens the result from file:// in headless Chrome with view-smoke.mjs and
 * asserts, in one probe over the page as it opens and one over the structural view:
 *   - network and console: no request, no failed load, no policy violation, no console error or exception;
 *   - defaults: with a domain graph the page opens on Domain with the domain graph drawn;
 *   - header: its controls are exactly the Domain | Structural switch, the search box and the language switch;
 *   - no counts: no "N nodes / edges / files / flows / steps / relations" text and no "N drawn of M" in the right
 *     panel or on the canvas (cards, edge labels, the Relations control);
 *   - domain overview: the domains with their kind word, business before support, a click opens one;
 *   - language switch: English shows the English names, the language button brings the translations back;
 *   - structural overview: runtime units, a tech stack with one spelling per name, layers, external systems, the
 *     most changed files, and the unused-code entry that opens the list and selects a row's node;
 *   - node panel: a file listed in hotspots shows the Hotspot section, an unused function the Unused code section,
 *     a file a doc-map unit cites the Documents section;
 *   - status line: one line naming each product's state, the details behind it (revision, coverage), no banner;
 *   - uncovered languages: the knowledge graph's coverage names the languages it did not analyse, with no numbers;
 *   - relations on the canvas: edge labels are kind words, stand-ins say what they are, the control says what is
 *     not drawn without a number;
 *   - content: the title says Excavator, no visible text names the upstream product, a layer drills in and a file's
 *     code opens from the inlined sources;
 *   - states: a page whose products were not run shows each state, with no table and no number;
 *   - layout: at 768 and 375 wide the page does not scroll sideways, and at 375 the drawer holds the two switches.
 * It then opens the same data with the graph's layers removed and asserts the structural view still draws, now from
 * the groups the copy derives.
 *
 *   node scripts/explorer-smoke.mjs [--screenshot <png>] [--self-check]
 *
 * `--self-check` is the instrument check: it also runs pages with a planted fault and requires that each assertion
 * it was written to catch goes red (an external stylesheet, a thrown error, a graph the page cannot read, a Diff
 * button back in the header, a count on the canvas or in the panel, domains out of order, a duplicated framework
 * name, products' files left out, a status line that drops a state, a full coverage record, no name table, ...).
 *
 * Needs `pnpm -r build` (the template) and a local Chrome. Prints one line per check and exits 1 when any fails.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chunkExplorerData } from '../skills/excavator-view/data-chunks.mjs';
import { assembleExplorerPage } from '../skills/excavator-view/page-assembly.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(here, '..', 'packages', 'explorer', 'dist', 'explorer.html');
const CSP_MARKER = '<!-- xv:csp -->';
const DATA_MARKER = '<!-- xv:data -->';
/** The part limit of the smoke's pages: tiny, so each data file and the sources are cut into several parts (the packer's default is 16 Mi characters). */
const SMOKE_PART_CHARS = 256;

/** The sources the code viewer shows, by the file path of a node. */
const SOURCES = {
  'src/main.js': 'import { helper } from "./util.js";\n\nexport function main() {\n  return helper(1);\n}\n',
  'src/util.js': 'export function helper(n) {\n  return n + 1;\n}\n',
};

function sourceFile(path) {
  const content = SOURCES[path];
  return { path, language: 'javascript', content, sizeBytes: Buffer.byteLength(content), lineCount: content.split('\n').length - 1 };
}

const productEntry = (name, status, extra = {}) => ({ name, status, reason: null, revision: null, revisionNote: null, command: `/excavator-${name}`, ...extra });

/**
 * A small graph in the dashboard's format: two layers, two files, three functions, and the
 * fields of ours the copy shows (design D4b): a verified summary, a contradicted one that was
 * blanked, edge evidence, a mentions edge, a coverage record and a gap; and the pack's freshness
 * report for a graph made from another revision than the packed one (design D2).
 */
export function fixtureData() {
  const node = (id, type, name, extra = {}) => ({ id, type, name, summary: `${name} summary`, tags: ['fixture'], complexity: 'simple', ...extra });
  const edge = (source, target, type, evidence) => ({ source, target, type, direction: 'forward', weight: 0.5, ...(evidence ? { evidence: [evidence], provenance: 'extracted' } : {}) });
  const nodes = [
    node('file:src/main.js', 'file', 'main.js', { filePath: 'src/main.js', displayName: 'Main entry' }),
    node('file:src/util.js', 'file', 'util.js', { filePath: 'src/util.js' }),
    node('function:src/main.js:main', 'function', 'main', { filePath: 'src/main.js', lineRange: [3, 5] }),
    node('function:src/util.js:helper', 'function', 'helper', { filePath: 'src/util.js', lineRange: [1, 3], verification: 'verified' }),
    node('function:src/util.js:leaf', 'function', 'leaf', { filePath: 'src/util.js', lineRange: [1, 3], summary: '', verification: 'contradicted' }),
  ];
  const edges = [
    edge('file:src/main.js', 'function:src/main.js:main', 'contains'),
    edge('file:src/util.js', 'function:src/util.js:helper', 'contains'),
    edge('file:src/util.js', 'function:src/util.js:leaf', 'contains'),
    edge('file:src/main.js', 'file:src/util.js', 'imports', { file: 'src/main.js', line: 1, source: 'import-map' }),
    edge('file:src/util.js', 'file:src/main.js', 'mentions', { file: 'src/util.js', line: 2, source: 'lexical' }),
    edge('function:src/main.js:main', 'function:src/util.js:helper', 'calls'),
  ];
  const graph = {
    version: '1.0.0',
    project: { name: 'fixture', languages: ['javascript', 'JavaScript'], frameworks: ['express', 'Express'], description: 'A synthetic project.', analyzedAt: '2026-01-01T00:00:00.000Z', gitCommitHash: 'abc123' },
    nodes,
    edges,
    layers: [
      { id: 'layer:app', name: 'App', description: 'Entry points.', nodeIds: ['file:src/main.js', 'function:src/main.js:main'] },
      { id: 'layer:lib', name: 'Library', description: 'Helpers.', nodeIds: ['file:src/util.js', 'function:src/util.js:helper', 'function:src/util.js:leaf'] },
    ],
    tour: [{ order: 1, title: 'Start at main', description: 'main calls the helper.', nodeIds: ['file:src/main.js', 'function:src/util.js:helper'] }],
    coverage: { files: 3, byLanguage: { javascript: { files: 2, parsed: 2, zeroSymbol: 0, skipped: {} }, css: { files: 1, parsed: 0, zeroSymbol: 0, skipped: { 'no-extractor': 1 } } } },
    gaps: [{ kind: 'calls-unresolved', scope: 'javascript', reason: 'callee not declared in the project', count: 1, samples: ['src/main.js:4 -> external'] }],
  };
  // The product files the explorer-products views read, and the packer's states for them: unused-code and doc-map
  // at the packed revision, hotspots made from another revision (so its notice shows).
  const revision = `git:${'a'.repeat(40)}`;
  const otherRevision = `git:${'c'.repeat(40)}`;
  const unusedRow = (name, id, over = {}) => ({ id, name, owner: null, language: 'javascript', file: 'src/util.js', lineRange: [1, 3], visibility: 'private', reason: 'unreferenced', confidence: 'high', group: null, signals: [], referrers: [], ...over });
  const unused = {
    format: 'excavator-unused-code/1',
    sourceRevision: revision,
    counts: {
      candidates: 4, removedByDecision: 0, testOnly: 1, unused: 3, unreferenced: 2, onlyReachableFromUnused: 1, groups: 1,
      byConfidence: { high: 2, medium: 1, low: 0 },
      byLanguage: { javascript: { candidates: 4, calls: 9, unused: 3, high: 2, medium: 1, low: 0 } },
    },
    conservation: { candidates: 4, removedByDecision: 0, testOnly: 1, unused: 3, holds: true },
    residualAssumptions: ['A function a framework calls by name may be listed here.'],
    decisions: [{ kind: 'entry', reason: 'Program entries', query: 'main', hits: 1 }],
    unused: [
      unusedRow('leaf', 'function:src/util.js:leaf', { group: 1, signals: [{ signal: 'capped' }], referrers: [{ id: 'function:src/gone.js:orphan', edge: 'calls', reverse: false }] }),
      unusedRow('orphan', 'function:src/gone.js:orphan', { file: 'src/gone.js', group: 1, referrers: [] }),
      unusedRow('main', 'function:src/main.js:main', { file: 'src/main.js', lineRange: [3, 5], confidence: 'medium', reason: 'only-reachable-from-unused' }),
    ],
    groups: [{ group: 1, entries: ['function:src/gone.js:orphan'], members: ['function:src/gone.js:orphan', 'function:src/util.js:leaf'] }],
    testOnly: [unusedRow('helper', 'function:src/util.js:helper', { reason: undefined, confidence: undefined })],
  };
  const yearsFile = (path, score, commits, byYear) => ({ path, score, commits, authors: 1, added: 10, removed: 2, lines: score === null ? null : 40, lastChanged: '2026-01-02T03:04:05+00:00', lineageConflicts: 0, commitsByYear: byYear });
  const dir = (path, score, commits, byYear) => ({ path, score, commits, authors: 1, files: 1, lines: 40, added: 10, removed: 2, lastChanged: '2026-01-02T03:04:05+00:00', commitsByYear: byYear, concentration: { commitsByPeople: commits, topAuthorShare: 1, authorsFor80Percent: 1 } });
  const hotspots = {
    format: 'excavator-hotspots/1',
    sourceRevision: otherRevision,
    sourceKind: 'git',
    historyAvailable: true,
    window: { since: null, sinceUtc: null },
    repos: [{ path: '.', head: 'abc', shallow: false, boundaryCommits: 0, earliestVisibleCommit: 'abc' }],
    bots: { commits: 0, emailMarker: '[bot]@' },
    counts: { filesWithHistory: 2, filesWithoutHistory: 1, binaryFiles: 1, filesWithLineageConflicts: 0 },
    conservation: { changesRead: 10, attributed: 8, outsideSelection: 2 },
    coChange: { maxFilesPerCommit: 50, minTogether: 2, commitsCounted: 5, commitsOverLimit: 0, pairsListed: 1, pairsBelowMinimum: 0 },
    featureGroups: null,
    residualAssumptions: ['Renames the history does not show count as new files.'],
    files: [yearsFile('src/main.js', 300, 5, { 2024: 2, 2025: 3 }), yearsFile('src/util.js', 120, 3, { 2025: 3 }), yearsFile('assets/logo.png', null, 1, { 2025: 1 })],
    directories: [dir('.', 420, 8, { 2024: 3, 2025: 5 }), dir('src', 420, 8, { 2024: 3, 2025: 5 }), dir('assets', 0, 1, { 2025: 1 })],
    pairs: [{ a: 'src/main.js', b: 'src/util.js', together: 3, shareOfA: 0.6, shareOfB: 1 }],
    groups: [],
  };
  const docUnit = (id, title, quote, line, code) => ({ document: 'docs/a.md', id, title, quote, line, page: null, code });
  const docMap = {
    format: 'excavator-doc-map/1',
    docsRoot: 'docs',
    converters: { md: 'built-in' },
    code: { root: '.', revision },
    counts: { files: 2, read: 1, empty: 0, noConverter: 0, unsupported: 1, failed: 0, units: 3, found: 2, notFound: 1, notChecked: 0 },
    documents: [
      { path: 'docs/a.md', format: 'md', status: 'read', reason: null, chars: 120, lines: 12, pages: null, units: 3 },
      { path: 'docs/b.pdf', format: 'pdf', status: 'unsupported', reason: 'no converter for pdf', chars: null, lines: null, pages: null, units: null },
    ],
    units: [
      docUnit('A1', 'Run <b>once</b>', 'The program runs the helper once.', 4, { status: 'found', evidence: [{ file: 'src/main.js', line: 4, code: 'return helper(1);' }], searched: [] }),
      docUnit('A2', 'Leave quietly', 'The program leaves quietly.', 8, { status: 'not-found', evidence: [], searched: [{ pattern: 'leave', paths: ['src'] }] }),
      docUnit('A3', 'Add one', 'The helper adds one.', 9, { status: 'found', evidence: [{ file: 'src/util.js', line: 2, code: 'return n + 1;' }], searched: [] }),
    ],
    coverage: {
      sourceRevision: revision,
      counts: { files: 3, documents: 1, code: 2, withEvidence: 2, withoutEvidence: 0, evidence: 2, outside: 0 },
      directories: [{ path: 'src', files: 2, withEvidence: 2, units: [1, 3] }],
      files: [{ path: 'src/main.js', units: [1] }, { path: 'src/util.js', units: [3] }],
      outside: [],
      documents: ['docs/a.md'],
    },
    residualAssumptions: ['A document may describe a function the code names differently.'],
  };
  const docMapChecks = { checks: [{ unit: 1, file: 'src/main.js', line: 4, verdict: 'does', reason: 'It calls the helper once.' }] };
  // The relations product: two units, a linked HTTP call, a call to an external system, a caller and a receiver alone,
  // and a linked call whose caller's node the knowledge graph does not have (drawn on no graph, counted).
  const relSite = (unit, file, line, quote, nodeId = null, evidence = []) => ({ unit, family: 'js', file, line, quote, nodeId, nodeIdBy: nodeId === null ? 'none' : 'line', evidence });
  const relations = {
    format: 'excavator-relations/1',
    sourceRevision: revision,
    factDigest: null,
    status: 'complete',
    units: [{ id: 'unit:web', name: 'Web', root: 'src', kind: 'runtime', evidence: [] }, { id: 'unit:api', name: 'Api', root: 'src', kind: 'runtime', evidence: [] }],
    externals: [{ id: 'external:mail' }],
    relations: [
      { id: 'rel:1', kind: 'http', bucket: 'linked', area: 'area-001', reason: 'Asks for the helper', confidence: 'high', address: { method: 'GET', path: '/helper' }, addressKey: 'GET /helper',
        caller: relSite('unit:web', 'src/main.js', 4, 'return helper(1);', 'function:src/main.js:main', [{ file: 'src/main.js', line: 1, quote: 'import { helper } from "./util.js";' }]),
        receiver: { ...relSite('unit:api', 'src/util.js', 1, 'export function helper(n) {', 'function:src/util.js:helper'), addressKey: 'GET /helper' } },
      { id: 'rel:2', kind: 'external', bucket: 'linked', area: 'area-002', reason: 'Sends the mail', confidence: 'high', address: { name: 'mail' }, addressKey: 'external:mail',
        caller: relSite('unit:api', 'src/util.js', 2, 'return n + 1;', 'function:src/util.js:helper'), receiver: { external: 'external:mail' } },
      { id: 'rel:3', kind: 'http', bucket: 'caller-only', area: 'area-001', reason: 'Posts a refund', confidence: 'medium', address: { method: 'POST', path: '/refund' }, addressKey: 'POST /refund',
        caller: relSite('unit:web', 'src/gone.js', 3, 'post("/refund")'), receiver: null },
      { id: 'rel:4', kind: 'http', bucket: 'receiver-only', area: 'area-002', reason: 'Health check', confidence: 'high', address: { method: 'GET', path: '/health' }, addressKey: 'GET /health',
        caller: null, receiver: { ...relSite('unit:api', 'src/util.js', 1, 'export function helper(n) {', 'function:src/util.js:helper'), addressKey: 'GET /health' } },
      { id: 'rel:5', kind: 'http', bucket: 'quote-failed', area: 'area-002', reason: 'Lists the jobs', confidence: 'low', role: 'receiver', address: null,
        rejection: { reason: 'quote-mismatch', detail: 'not within 3 lines' }, receiver: { file: 'src/util.js', line: 2, quote: 'listJobs()' } },
      { id: 'rel:6', kind: 'http', bucket: 'linked', area: 'area-001', reason: 'Asks for the helper again', confidence: 'high', address: { method: 'GET', path: '/helper' }, addressKey: 'GET /helper',
        caller: relSite('unit:web', 'src/main.js', 3, 'export function main() {', 'function:src/main.js:gone'),
        receiver: { ...relSite('unit:api', 'src/util.js', 1, 'export function helper(n) {', 'function:src/util.js:helper'), addressKey: 'GET /helper' } },
    ],
    buckets: { caller: { linked: 3, 'caller-only': 1 }, receiver: { linked: 2, 'receiver-only': 1, 'quote-failed': 1 } },
    outOfScope: {},
    measurements: {
      http: { ends: 4, quoteFailed: 1, quoteFailureRate: 0.25, verified: 3, unresolved: 0, unresolvedShare: 0, linked: 1, agreement: { status: 'no-previous-run', jaccard: null }, escalation: { candidate: true, reasons: ['quote-failure'] } },
      external: { ends: 1, quoteFailed: 0, quoteFailureRate: 0, verified: 1, unresolved: 0, unresolvedShare: 0, linked: 1, agreement: { status: 'no-previous-run', jaccard: null }, escalation: { candidate: false, reasons: [] } },
    },
  };
  const relationsCoverage = {
    status: 'complete',
    thresholds: { quoteFailureRate: 0.2, unresolvedShare: 0.5, agreement: 0.8 },
    areas: [{ areaId: 'area-001', status: 'accepted' }, { areaId: 'area-002', status: 'accepted' }],
    buckets: relations.buckets,
    rejections: {},
    outOfScope: {},
    conservation: { ok: true, endsIn: 8, inBuckets: 8, duplicates: 0 },
    files: { buckets: { cited: 2, 'silent-zero': 1 }, configFiles: 0, configCited: 0, split: {}, rows: [{ file: 'src/main.js', unit: 'unit:web', status: 'cited' }, { file: 'src/util.js', unit: 'unit:api', status: 'cited' }, { file: 'src/gone.js', unit: 'unit:web', status: 'silent-zero' }] },
    units: [{ id: 'unit:web', candidateFiles: 2 }, { id: 'unit:api', candidateFiles: 1 }],
    anchors: {},
    measurements: relations.measurements,
    escalationCandidates: [{ kind: 'http', reasons: ['quote-failure'] }],
  };
  const domain = {
    version: '1.0.0',
    project: graph.project,
    nodes: [
      node('domain:run', 'domain', 'Running', { summary: 'Runs the program.', domainMeta: { kind: 'support', entities: [], businessRules: [], crossDomainInteractions: [] } }),
      node('domain:pay', 'domain', 'Payments', { summary: 'Takes payments.\nSecond line.', domainMeta: { kind: 'business', entities: [], businessRules: [], crossDomainInteractions: [] } }),
      node('domain:misc', 'domain', 'Other', { summary: '', domainMeta: { entities: [], businessRules: [], crossDomainInteractions: [] } }),
      node('flow:run', 'flow', 'Run once', { domainMeta: { entryPoint: 'src/main.js', entryType: 'cli' } }),
      node('step:run:1', 'step', 'Call helper', { filePath: 'src/main.js', lineRange: [3, 5] }),
    ],
    edges: [edge('domain:run', 'flow:run', 'contains_flow'), edge('flow:run', 'step:run:1', 'flow_step')],
    layers: [],
    tour: [],
  };
  return {
    'knowledge-graph.json': graph,
    'domain-graph.json': domain,
    'name-translations.json': { language: 'French', names: { Running: 'Execution', Payments: 'Paiements', 'Main entry': 'Entree principale', 'Takes payments.\nSecond line.': 'Prend les paiements.\nDeuxieme ligne.', Library: 'Bibliotheque', 'Entry points.': 'Points d\'entree.' }, counts: { names: 6, translated: 6, english: 0, identical: 0, mismatched: 0, unused: 0, refused: 0 } },
    'meta.json': { lastAnalyzedAt: '2026-01-01T00:00:00.000Z', gitCommitHash: 'abc123', version: '1.0.0', analyzedFiles: 2 },
    'staleness.json': { graphs: { knowledge: { status: 'revision', graphRevision: `git:${'b'.repeat(40)}`, currentRevision: `git:${'a'.repeat(40)}` } } },
    'unused-code.json': unused,
    'hotspots.json': hotspots,
    'doc-map.json': docMap,
    'doc-map-checks.json': docMapChecks,
    'relations-graph.json': relations,
    'relations-coverage.json': relationsCoverage,
    'products.json': {
      snapshotRevision: revision,
      products: [
        productEntry('unused-code', 'included', { revision }),
        productEntry('hotspots', 'different-revision', { revision: otherRevision }),
        productEntry('doc-map', 'included', { revision }),
        productEntry('relations', 'included', { revision, coverage: { state: 'included', reason: null } }),
      ],
    },
    sources: Object.fromEntries(Object.keys(SOURCES).map((path) => [path, sourceFile(path)])),
  };
}

/** The fixture's graph without one node (and what refers to it): a row whose node the graph does not have. */
export function withoutNode(data, id) {
  const graph = data['knowledge-graph.json'];
  return {
    ...data,
    'knowledge-graph.json': {
      ...graph,
      nodes: graph.nodes.filter((n) => n.id !== id),
      edges: graph.edges.filter((e) => e.source !== id && e.target !== id),
      layers: graph.layers.map((l) => ({ ...l, nodeIds: l.nodeIds.filter((n) => n !== id) })),
    },
  };
}

/** The fixture with main.js and main in no layer: main's call to helper has an end that no layer holds. */
export function withMainInNoLayer(data) {
  const graph = data['knowledge-graph.json'];
  const out = new Set(['file:src/main.js', 'function:src/main.js:main']);
  return { ...data, 'knowledge-graph.json': { ...graph, layers: graph.layers.map((l) => ({ ...l, nodeIds: l.nodeIds.filter((n) => !out.has(n)) })) } };
}

/** The fixture with its products not run or unreadable: no product file, and a state each. */
export function withUnavailableProducts(data) {
  const rest = { ...data };
  for (const key of ['unused-code.json', 'hotspots.json', 'doc-map.json', 'doc-map-checks.json', 'relations-graph.json', 'relations-coverage.json']) delete rest[key];
  return {
    ...rest,
    'products.json': {
      snapshotRevision: data['products.json'].snapshotRevision,
      products: [
        productEntry('unused-code', 'unreadable', { reason: 'unused-code.json is not valid JSON' }),
        productEntry('hotspots', 'not-run', { reason: 'hotspots.json was not found' }),
        productEntry('doc-map', 'not-run', { reason: 'doc-map.json was not found' }),
        productEntry('relations', 'not-run', { reason: 'relations-graph.json was not found' }),
      ],
    },
  };
}

/** The fixture's graph without one node (and what refers to it). */
/** A copy of the page data whose feature groups carry the names, descriptions and project texts /excavator-domain stores. */
export function withStoredGroups(data) {
  const flowRef = { id: 'flow:run', rule: 'route', scope: null, origin: null };
  return {
    ...data,
    'feature-groups.json': {
      format: 'excavator-view-feature-groups/3',
      named: ['domain:run'],
      project: { introduction: 'The stored introduction.', technicalOverview: 'The stored technical overview.' },
      domains: { 'domain:run': [{ id: 'word:run', kind: 'feature', label: 'Stored name', description: 'Does the stored thing.', codeLabel: 'codelabel-run', file: null, flows: [flowRef] }] },
    },
  };
}

export function withoutLayers(data) {
  return { ...data, 'knowledge-graph.json': { ...data['knowledge-graph.json'], layers: [] } };
}

/** The pack's manifest for a page of `data`: the state of each of the eight products, as the packer writes it. */
export function manifestFor(data) {
  const fromFile = new Map((data['products.json']?.products ?? []).map((p) => [p.name, p]));
  const state = (name, present) => ({ name, status: present ? 'included' : 'not-run' });
  return {
    products: [
      state('knowledge-graph', data['knowledge-graph.json'] !== undefined),
      { name: 'semantics', status: 'not-run' },
      state('domain-graph', data['domain-graph.json'] !== undefined),
      ...['unused-code', 'doc-map', 'hotspots'].map((name) => ({ name, status: fromFile.get(name)?.status ?? 'not-run' })),
      state('tour', (data['knowledge-graph.json']?.tour ?? []).length > 0),
      { name: 'relations', status: fromFile.get('relations')?.status ?? 'not-run' },
    ],
  };
}

/** The wait signal view-smoke.mjs needs: the dashboard has no ready attribute of its own, so the page's own markup says when it has drawn. */
const READY_SCRIPT = `(function(){var r=document.documentElement;var t=setInterval(function(){if(document.querySelector('.react-flow__node')||/Failed to load|Invalid knowledge graph/.test(document.body.innerText)){clearInterval(t);r.setAttribute('data-xv-ready','1');}},50);})();`;

/**
 * The planted faults that are page scripts: each keeps its defect in place (a timer puts it back after the page
 * redraws), so the probe sees it whenever it looks.
 */
const keep = (body) => `<script>setInterval(function(){try{${body}}catch(e){}},40);</script>`;
const SCRIPT_FAULTS = {
  'thrown-error': '<script>setTimeout(function(){throw new Error("planted fault");},200);</script>',
  // A Diff button back in the header.
  'header-diff': keep(`var h=document.querySelector('header');if(h&&!h.querySelector('[data-planted]')){var b=document.createElement('button');b.setAttribute('data-planted','1');b.textContent='Diff';h.appendChild(b);}`),
  // A count on the canvas, in the panel, and the Relations control's old sentence.
  'count-canvas': keep(`var f=document.querySelector('.react-flow');if(f&&!f.querySelector('[data-planted]')){var s=document.createElement('span');s.setAttribute('data-planted','1');s.textContent='12 nodes';f.appendChild(s);}`),
  'count-aside': keep(`var a=document.querySelector('aside');if(a&&!a.querySelector('[data-planted]')){var s=document.createElement('span');s.setAttribute('data-planted','1');s.textContent='3 files';a.insertBefore(s,a.firstChild);}`),
  'drawn-of': keep(`var f=document.querySelector('.react-flow');if(f&&!f.querySelector('[data-planted]')){var s=document.createElement('span');s.setAttribute('data-planted','1');s.textContent='491 drawn of 492 in this view';f.appendChild(s);}`),
  'edge-count': keep(`document.querySelectorAll('.react-flow__edge-text').forEach(function(t){if(!/ 376$/.test(t.textContent))t.textContent=t.textContent+' 376';});`),
  // Support domains before business ones.
  'domain-order': keep(`var rows=[].slice.call(document.querySelectorAll('aside [data-excavator-domain-row]'));if(rows.length>1){var li=function(r){return r.parentNode};var support=rows.filter(function(r){return r.getAttribute('data-excavator-domain-kind')==='support'})[0];var biz=rows.filter(function(r){return r.getAttribute('data-excavator-domain-kind')==='business'})[0];if(support&&biz&&li(support).compareDocumentPosition(li(biz))&2){li(support).parentNode.insertBefore(li(support),li(rows[0]));}}`),
  // The framework name twice, in both spellings.
  'stack-dup': keep(`document.querySelectorAll('aside p').forEach(function(p){if(/^Frameworks:/.test(p.textContent)&&p.textContent!=='Frameworks: Express, express')p.textContent='Frameworks: Express, express';});`),
  // A status line that leaves out the product that was not run.
  'status-missing': keep(`var s=document.querySelector('[data-excavator-status-summary]');if(s&&/Semantics not run/.test(s.textContent))s.textContent=s.textContent.replace(/ [\\u00b7] Semantics not run/,'');`),
  'wrong-title': keep(`document.title='Planted'`),
  'upstream-name': keep(`if(!document.querySelector('[data-planted]')){var d=document.createElement('div');d.setAttribute('data-planted','1');d.textContent='Understand Anything';document.body.appendChild(d);}`),
  // A banner above the graph.
  banner: keep(`var h=document.querySelector('header');if(h&&!document.querySelector('[data-planted]')){var d=document.createElement('div');d.setAttribute('data-planted','1');d.className='bg-amber-950/30 border-b';d.style.width='100%';d.textContent='The graph may be stale';h.parentNode.insertBefore(d,h.nextSibling);}`),
  // Layer rows that no longer drill in.
  'no-drill': `<script>document.addEventListener('click',function(e){if(e.target.closest&&e.target.closest('[data-excavator-layer-row]')){e.stopImmediatePropagation();e.preventDefault();}},true);</script>`,
};

/** The number of distinct parts the index gives a data file (its fields' parts) or the sources table (its paths' parts). */
function partsOf(index, name) {
  const entry = index.files[name];
  if (!entry) return 0;
  if ('value' in entry) return 1;
  if ('paths' in entry) return new Set(Object.values(entry.paths)).size;
  return new Set(entry.fields.flatMap((field) => field.parts ?? [field.part])).size;
}

/** The fixture with a data change a fault stands for. */
function faultData(data, fault) {
  if (fault === 'no-graph') return { ...data, 'knowledge-graph.json': undefined };
  if (fault === 'no-domain') return { ...data, 'domain-graph.json': undefined };
  if (fault === 'no-sources') return { ...data, sources: undefined };
  if (fault === 'no-name-table') return { ...data, 'name-translations.json': undefined };
  // The products' files are left out while the manifest still says they are included.
  if (fault === 'no-product-files') return { ...data, 'unused-code.json': undefined, 'hotspots.json': undefined, 'doc-map.json': undefined, 'doc-map-checks.json': undefined };
  // A coverage record in which every language was analysed.
  if (fault === 'full-coverage') {
    const graph = data['knowledge-graph.json'];
    return { ...data, 'knowledge-graph.json': { ...graph, coverage: { files: 3, byLanguage: { javascript: { files: 3, parsed: 3, zeroSymbol: 0, skipped: {} } } } } };
  }
  return data;
}

/**
 * The template filled by the packer's own `assembleExplorerPage`: the policy, the data (index and gzip parts) and the
 * manifest; `fault` plants one defect the smoke must catch. The wait signal and a planted script go into a temporary
 * copy of the template, next to its markers.
 */
export function assemble(template, data, fault = null) {
  const payload = faultData(data, fault);
  const extraHead = fault === 'external-url' ? '<link rel="stylesheet" href="https://example.invalid/planted.css">' : '';
  const extraBody = SCRIPT_FAULTS[fault] ?? '';

  // The pages that have the data must really be cut: a smoke over single-part files would not run the part reader's joins.
  if (fault === null) {
    const { index } = chunkExplorerData(payload, { partChars: SMOKE_PART_CHARS });
    for (const name of ['knowledge-graph.json', 'unused-code.json', 'sources'].filter((key) => payload[key] !== undefined)) {
      if (partsOf(index, name) < 2) throw new Error(`the smoke data ${name} is in fewer than two parts at ${SMOKE_PART_CHARS} characters`);
    }
  }

  const dir = mkdtempSync(join(tmpdir(), 'explorer-smoke-template-'));
  try {
    const templatePath = join(dir, 'explorer.html');
    const text = template
      .replace(CSP_MARKER, () => `${CSP_MARKER}${extraHead}`)
      .replace(DATA_MARKER, () => `${DATA_MARKER}<script>${READY_SCRIPT}</script>${extraBody}`);
    writeFileSync(templatePath, text);
    return assembleExplorerPage({ templatePath, data: payload, manifest: manifestFor(data), partChars: SMOKE_PART_CHARS }).toString('utf-8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** What every probe reads the page through (stringified into the page). */
function makeHelpers() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Once any wait has run out, later waits are not waited out: a broken page must finish well inside the script's time.
  let broken = false;
  const until = async (test, tries = 60) => {
    for (let i = 0; i < (broken ? 1 : tries); i++) {
      try { if (test()) return true; } catch { /* not there yet */ }
      await sleep(50);
    }
    broken = true;
    return false;
  };
  const press = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const cards = () => [...document.body.querySelectorAll('.react-flow__node')];
  const card = (id) => document.querySelector('.react-flow__node[data-id="' + id + '"]');
  const aside = () => document.querySelector('aside');
  const asideText = () => aside()?.innerText ?? '';
  const flowText = () => document.querySelector('.react-flow')?.innerText ?? '';
  const edgeTexts = () => [...document.querySelectorAll('.react-flow__edge-text')].map((e) => e.textContent.trim());
  const section = (name) => aside()?.querySelector('[data-excavator-section="' + name + '"]') ?? null;
  const buttonIn = (root, test) => [...(root?.querySelectorAll('button') ?? [])].find((b) => test(b.textContent.trim()));
  const headerButton = (text) => buttonIn(document.querySelector('header'), (t) => t === text);
  const lit = (el) => Boolean(el) && el.getAttribute('aria-pressed') === 'true';
  const esc = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const COUNT = /\b\d+\s+(relations?|nodes?|edges?|files?|flows?|steps?|connections?)\b|\b\d+ drawn of \d+/i;
  // The text where counts must not be: the right panel, the canvas (cards, controls) and the edge labels.
  // An edge label is a kind word: a digit in one is a count.
  const countsSeen = () => [...[asideText(), flowText()].join('\n').split('\n').filter((line) => COUNT.test(line)), ...edgeTexts().filter((t) => /\d/.test(t))];
  const domainRows = () => [...document.querySelectorAll('aside [data-excavator-domain-row]')].map((r) => ({
    id: r.getAttribute('data-excavator-domain-row'),
    kind: r.getAttribute('data-excavator-domain-kind'),
    label: r.querySelector('[data-excavator-domain-label]')?.textContent ?? null,
    original: r.querySelector('[data-excavator-domain-original]')?.textContent ?? null,
    kindWord: [...r.querySelectorAll('span')].map((s) => s.textContent).find((t) => t === 'business' || t === 'support') ?? null,
  }));
  const statusSummary = () => document.querySelector('[data-excavator-status-summary]')?.textContent ?? '';
  return { sleep, until, press, cards, card, aside, asideText, flowText, edgeTexts, section, buttonIn, headerButton, lit, esc, countsSeen, domainRows, statusSummary };
}

const probe = (body) => `(async () => { const h = (${makeHelpers})(); return await (${body})(h); })()`;

/** The page as it opens: defaults, header, domain overview, language switch, status line. */
async function mainBody(h) {
  const opacities = () => [...document.querySelectorAll('.react-flow__node:not(.react-flow__node-band-heading)')].map((n) => Number(getComputedStyle(n).opacity));
  // The cards' bounding box (not headings or lane separators) is centred in the canvas when the content is narrower than the pane.
  const centred = () => {
    const rects = [...document.querySelectorAll('.react-flow__node:not(.react-flow__node-band-heading):not(.react-flow__node-lane-band)')].map((n) => n.getBoundingClientRect());
    const pane = document.querySelector('.react-flow')?.getBoundingClientRect();
    if (rects.length === 0 || !pane) return false;
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    return right - left >= pane.width - 80 || Math.abs((left + right) / 2 - (pane.left + pane.right) / 2) <= 40;
  };
  const started = Date.now();
  const out = { title: document.title };
  await h.until(() => h.cards().length > 0 || /Failed to load|Invalid knowledge graph/.test(document.body.innerText));
  await h.sleep(500);
  out.cards = h.cards().length;
  out.defaults = { domain: h.lit(h.headerButton('Domain')), structural: h.lit(h.headerButton('Structural')), domainCard: h.cards().some((n) => /^domain:/.test(n.getAttribute('data-id') ?? '')) };
  out.header = [...document.querySelectorAll('header button, header input')].map((e) => (e.tagName === 'INPUT' ? 'input:' + e.type : e.textContent.trim()));
  out.upstreamName = /understand/i.test(document.body.innerText.replace(/[/]understand[-a-z]*/g, ''));
  out.banner = Boolean(document.querySelector('[data-excavator-banner]')) || [...document.querySelectorAll('body *:not(aside):not(aside *)')].some((e) => /bg-(amber|red)-/.test(e.getAttribute('class') ?? '') && e.getBoundingClientRect().width > window.innerWidth / 2);
  if (out.cards === 0) return out;
  await h.until(() => h.domainRows().length > 0);
  out.domainRows = h.domainRows();
  out.counts = h.countsSeen();
  // The language switch: English shows the English names, the language button brings the translations back.
  const language = h.headerButton('French');
  const english = h.headerButton('English');
  out.language = { lit: h.lit(language), englishLit: h.lit(english) };
  h.press(english);
  await h.sleep(300);
  out.english = { rows: h.domainRows(), lit: h.lit(h.headerButton('English')) };
  h.press(language);
  await h.sleep(300);
  out.french = { rows: h.domainRows(), lit: h.lit(h.headerButton('French')) };
  // Descriptions come in their translation only, on the card and in the panel list (first line), with no English line.
  const payCard = document.querySelector('.react-flow__node[data-id="domain:pay"]')?.textContent ?? '';
  const payRow = document.querySelector('aside [data-excavator-domain-row="domain:pay"]');
  out.descriptions = { card: payCard, row: payRow?.textContent ?? '', rowTitle: payRow?.querySelector('[title]')?.getAttribute('title') ?? '' };
  // Opening a domain shows its node; Escape returns to the list.
  out.overviewCentred = centred();
  out.overviewNoBar = !document.querySelector('[data-excavator-bar]');
  const firstBack = document.querySelector('[data-excavator-back]');
  out.backDisabledOnLoad = (!firstBack || firstBack.disabled === true) && !document.querySelector('[data-excavator-panel-back]');
  const row = document.querySelector('aside [data-excavator-domain-row="domain:run"]');
  // A panel list selects and never navigates: the panel shows the domain with an Open button; Open enters it.
  h.press(row);
  out.rowOpenButton = await h.until(() => Boolean(h.aside()?.querySelector('[data-excavator-open="node"]')));
  out.rowStayedOnOverview = !h.buttonIn(h.aside(), (t) => /All domains/.test(t));
  h.press(h.aside()?.querySelector('[data-excavator-open="node"]'));
  out.opened = await h.until(() => h.buttonIn(h.aside(), (t) => /All domains/.test(t)));
  out.openedTitle = h.asideText();
  // At domain level every flow is listed once: no "contains flow" connection rows beside the Flows list.
  // The Back and breadcrumb bar must not cover a node after placement.
  const barClear = () => {
    const bar = document.querySelector('[data-excavator-bar]')?.getBoundingClientRect();
    if (!bar) return false;
    return ![...document.querySelectorAll('.react-flow__node')].some((n) => {
      const r = n.getBoundingClientRect();
      return r.left < bar.right && r.right > bar.left && r.top < bar.bottom && r.bottom > bar.top;
    });
  };
  const flowRows = () => h.section('Flows')?.querySelectorAll('button').length ?? 0;
  out.containsRows = /contains flow/i.test(h.asideText());
  out.domainFlowRows = flowRows();
  // A click on a panel list item goes to that node: from the group level a flow row opens the lanes of its group,
  // selects the flow and pans it into the canvas; a row already on screen changes nothing but the selection.
  const crumb = () => document.querySelector('[data-excavator-domain-breadcrumb]')?.textContent ?? '';
  const flowButton = h.section('Flows')?.querySelector('button');
  const flowName = flowButton?.textContent ?? '';
  // Move the view a little, as a user would, so a restored viewport differs from a fresh placement.
  await h.sleep(300);
  const transformBefore = document.querySelector('.react-flow__viewport')?.style.transform;
  const pane = document.querySelector('.react-flow__pane');
  pane?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, ctrlKey: true, clientX: 300, clientY: 300 }));
  await h.sleep(400);
  const viewportOf = () => {
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(document.querySelector('.react-flow__viewport')?.style.transform ?? '');
    return m ? { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) } : null;
  };
  const viewportBefore = viewportOf();
  out.viewMoved = document.querySelector('.react-flow__viewport')?.style.transform !== transformBefore;
  out.groupsBarClear = barClear();
  const beforeCrumb = crumb();
  out.beforeCrumbName = beforeCrumb.split('/').pop();
  if (flowButton) h.press(flowButton);
  await h.sleep(900);
  const goCard = [...document.querySelectorAll('.react-flow__node-flow-node')].find((n) => n.textContent.includes(flowName.trim().split(' ')[0]));
  const frame = document.querySelector('.react-flow')?.getBoundingClientRect();
  const box = goCard?.getBoundingClientRect();
  out.goLanes = Boolean(document.querySelector('.react-flow__node-lane-band')) && crumb() !== beforeCrumb;
  out.goSelected = Boolean(goCard) && Number(getComputedStyle(goCard).opacity) === 1 && h.asideText().includes(flowName.trim()) && !h.buttonIn(h.aside(), (t) => /go to/i.test(t));
  out.goInside = Boolean(box && frame) && box.left >= frame.left && box.right <= frame.right && box.top >= frame.top && box.bottom <= frame.bottom;
  // The Domain view shows names, not code: no route or path on the cards; one muted Code line in the panel.
  out.noCodeOnCards = ![...document.querySelectorAll('.react-flow__node-flow-node, .react-flow__node-step-node, [data-excavator-group-card]')].some((n) => /src\/main\.js/.test(n.textContent));
  out.codeLines = [...(h.aside()?.querySelectorAll('[data-excavator-code-line]') ?? [])].map((n) => n.textContent);
  out.codeNowhereElse = (h.asideText().match(/src\/main\.js/g) ?? []).length === 1;
  const crumbOnLanes = crumb();
  const nodeCount = document.querySelectorAll('.react-flow__node').length;
  const stepButton = h.section('Steps')?.querySelector('button');
  if (stepButton) h.press(stepButton);
  await h.sleep(500);
  out.goStable = Boolean(stepButton) && crumb() === crumbOnLanes && document.querySelectorAll('.react-flow__node').length === nodeCount;
  // Back is a history back: it returns to the group level just left, with the viewport it had and nothing selected.
  // The panel's Back is the same history Back, named after the view it returns to.
  const panelBack = document.querySelector('[data-excavator-panel-back]');
  out.panelBackLabel = panelBack?.textContent ?? null;
  out.canvasBackEnabled = document.querySelector('[data-excavator-back]')?.disabled === false;
  if (panelBack) panelBack.click();
  await h.sleep(800);
  const viewportAfter = viewportOf();
  out.backRestored =
    crumb() === beforeCrumb &&
    Boolean(document.querySelector('[data-excavator-group-card]')) &&
    Boolean(viewportBefore && viewportAfter) &&
    Math.abs(viewportBefore.x - viewportAfter.x) <= 1 &&
    Math.abs(viewportBefore.y - viewportAfter.y) <= 1 &&
    Math.abs(viewportBefore.zoom - viewportAfter.zoom) <= 0.01 &&
    !h.aside()?.querySelector('[data-excavator-code-line]');
  // Inside a group the panel lists that group's flows only; the canvas breadcrumb is the only trail.
  // A view switch is a navigation: Back from Structural returns to the Domain level that was left.
  const levelCrumb = crumb();
  h.press(h.headerButton('Structural'));
  await h.until(() => h.section('Runtime units'));
  const structuralBack = document.querySelector('[data-excavator-back]');
  out.structuralBackEnabled = Boolean(structuralBack) && structuralBack.disabled === false;
  if (structuralBack && !structuralBack.disabled) structuralBack.click();
  await h.sleep(900);
  out.switchBack = h.lit(h.headerButton('Domain')) && crumb() === levelCrumb && Boolean(document.querySelector('[data-excavator-group-card]'));
  const groupCard = document.querySelector('[data-excavator-group-card]');
  out.groupCardFlows = Number(/(\d+) flows/.exec(groupCard?.textContent ?? '')?.[1] ?? -1);
  // One rule on every level: a single click selects and never enters; click, click (detail 2) and dblclick enters.
  const mouse = (el, type, detail) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, detail }));
  if (groupCard) mouse(groupCard, 'click', 1);
  await h.sleep(300);
  out.groupLevelKept = Boolean(document.querySelector('[data-excavator-group-card]')) && !document.querySelector('.react-flow__node-flow-node');
  if (groupCard) {
    mouse(groupCard, 'click', 1);
    mouse(groupCard, 'click', 2);
    mouse(groupCard, 'dblclick', 2);
  }
  await h.sleep(400);
  out.groupFlowRows = flowRows();
  out.lanesBarClear = barClear();
  out.lanesCentred = centred();
  out.lanesUndimmed = opacities().length > 0 && opacities().every((o) => o === 1);
  out.groupContainsRows = /contains flow/i.test(h.asideText());
  const flowCard = document.querySelector('.react-flow__node-flow-node > div');
  const stepCard = document.querySelector('.react-flow__node-step-node > div');
  if (flowCard) flowCard.click();
  await h.sleep(200);
  if (stepCard) stepCard.click();
  await h.sleep(300);
  out.panelTrail = Boolean(h.aside()?.querySelector('[data-excavator-panel-breadcrumb]'));
  for (let i = 0; i < 4; i += 1) {
    h.esc();
    await h.sleep(250);
  }
  out.listBack = await h.until(() => h.domainRows().length > 0);
  // A double click on a domain card opens the domain too (the zoom pane must not swallow it).
  const card = document.querySelector('.react-flow__node[data-id="domain:run"] > div');
  if (card) {
    // The first click selects the card; entering must leave nothing selected, so one Escape returns to the list.
    card.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    card.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
  }
  out.dblOpened = await h.until(() => h.buttonIn(h.aside(), (t) => /All domains/.test(t)));
  h.esc();
  out.dblBack = await h.until(() => h.domainRows().length > 0);
  // Selecting a domain card dims the others to 0.3; the same click again restores them; entering shows nothing dimmed.
  const domainCard = document.querySelector('.react-flow__node[data-id="domain:run"] > div');
  const clickOf = (el, detail) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
  clickOf(domainCard, 1);
  await h.sleep(250);
  out.dimmedOnSelect = opacities().some((o) => o < 0.5) && Number(getComputedStyle(document.querySelector('.react-flow__node[data-id="domain:run"]')).opacity) === 1;
  clickOf(domainCard, 1);
  await h.sleep(250);
  out.undimmedOnToggle = opacities().every((o) => o === 1);
  // React Flow's own selection must follow the store: after the second click nothing keeps the selected class.
  out.noSelectedClass = document.querySelectorAll('.react-flow__node.selected').length === 0;
  // The status line: the summary, then the details behind it.
  out.summary = h.statusSummary();
  const details = h.buttonIn(document.querySelector('[data-excavator-status-line]'), (t) => t === 'Details');
  h.press(details);
  await h.sleep(150);
  out.details = [...document.querySelectorAll('[data-excavator-status-line] li')].map((li) => li.textContent.trim());
  h.press(h.buttonIn(document.querySelector('[data-excavator-status-line]'), (t) => t === 'Details'));
  out.elapsedMs = Date.now() - started;
  return out;
}

/** The structural view: overview, canvas relations, unused list, node facts, layer drill and code. */
async function structBody(h) {
  const started = Date.now();
  const out = {};
  await h.until(() => h.cards().length > 0);
  await h.sleep(300);
  h.press(h.headerButton('Structural'));
  await h.until(() => h.cards().some((n) => !/^domain:/.test(n.getAttribute('data-id') ?? '')) && h.section('Runtime units'));
  await h.sleep(500);
  out.cards = h.cards().filter((n) => !/^domain:/.test(n.getAttribute('data-id') ?? '')).length;
  const text = (name) => h.section(name)?.innerText ?? null;
  out.units = text('Runtime units');
  out.frameworks = (h.section('Runtime units')?.innerText.match(/Frameworks: (.*)/) ?? [])[1] ?? null;
  out.languages = (h.section('Runtime units')?.innerText.match(/Languages: (.*)/) ?? [])[1] ?? null;
  out.layers = [...document.querySelectorAll('aside [data-excavator-layer-row]')].map((b) => b.getAttribute('data-excavator-layer-row'));
  out.layerRowTexts = [...document.querySelectorAll('aside [data-excavator-layer-row]')].map((b) => b.textContent);
  out.externals = text('External systems');
  out.changed = text('Most changed files');
  // The relations on the canvas: edge labels, stand-ins, the control's line.
  await h.until(() => h.edgeTexts().length > 0 && document.querySelector('[data-excavator-relation-node]'), 80);
  out.edgeLabels = h.edgeTexts();
  out.standIns = [...document.querySelectorAll('[data-excavator-relation-node]')].map((e) => e.innerText);
  out.relationsPanel = document.querySelector('[data-excavator-relations-panel]')?.innerText ?? null;
  out.counts = h.countsSeen();
  // The unused-code entry opens the list; a row selects its node, and the node panel shows the Unused code section.
  const entry = h.buttonIn(h.section('Unused code'), (t) => /unused-code candidates/.test(t));
  out.unusedEntry = Boolean(entry);
  h.press(entry);
  out.unusedList = await h.until(() => document.querySelector('aside [data-excavator-unused-list]'));
  const items = [...document.querySelectorAll('aside [data-excavator-unused-list] li')];
  out.unusedRows = items.map((li) => li.innerText.replace(/\s+/g, ' ').trim());
  h.press(items.find((li) => /leaf/.test(li.innerText))?.querySelector('button'));
  out.unusedFacts = await h.until(() => document.querySelector('aside [data-excavator-node-unused]'));
  out.unusedFactsText = document.querySelector('aside [data-excavator-node-unused]')?.innerText ?? null;
  h.esc();
  await h.sleep(300);
  // A file in the hotspots and cited by a doc-map unit shows both sections.
  const fileRow = h.buttonIn(h.section('Most changed files'), (t) => /src\/main\.js/.test(t));
  h.press(fileRow);
  out.hotspotFacts = await h.until(() => document.querySelector('aside [data-excavator-hotspot]'));
  out.documentsFacts = await h.until(() => document.querySelector('aside [data-excavator-node-documents]'), 20);
  out.hotspotText = h.section('Hotspot')?.innerText ?? null;
  out.documentsText = document.querySelector('aside [data-excavator-node-documents]')?.innerText ?? null;
  out.communicationHeading = h.section('Communication')?.querySelector('h3')?.textContent ?? null;
  out.nodeCounts = h.countsSeen();
  h.esc();
  await h.sleep(300);
  // A layer row selects the layer (the panel shows it with Open); Open drills in.
  h.press(document.querySelector('aside [data-excavator-layer-row="layer:lib"]'));
  await h.until(() => Boolean(h.aside()?.querySelector('[data-excavator-open="layer"]')));
  h.press(h.aside()?.querySelector('[data-excavator-open="layer"]'));
  const container = () => document.querySelector('.react-flow__node [aria-expanded="false"]');
  out.drilled = await h.until(() => container());
  // A folder box opens on a double click; a single click would only select it.
  container()?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
  await h.until(() => h.card('file:src/util.js'));
  h.press(h.card('file:src/util.js')?.firstElementChild);
  await h.until(() => h.buttonIn(h.aside(), (t) => /open code/i.test(t)));
  out.connectionsHeading = h.section('Connections')?.querySelector('h3')?.textContent ?? null;
  out.drillCounts = h.countsSeen();
  h.press(h.buttonIn(h.aside(), (t) => /open code/i.test(t)));
  out.codeShown = await h.until(() => /return n [+] 1/.test(document.body.innerText));
  out.elapsedMs = Date.now() - started;
  return out;
}

/** The page whose products were not run: each section says why it is empty. */
async function notRunBody(h) {
  const out = {};
  await h.until(() => h.cards().length > 0);
  await h.sleep(300);
  h.press(h.headerButton('Structural'));
  await h.until(() => h.section('Runtime units'));
  await h.sleep(600);
  out.relations = h.section('Runtime units')?.innerText ?? null;
  out.hotspots = h.section('Most changed files')?.innerText ?? null;
  out.unused = h.section('Unused code')?.innerText ?? null;
  out.unusedButton = Boolean(h.buttonIn(h.section('Unused code'), (t) => /unused-code candidates/.test(t)));
  out.summary = h.statusSummary();
  out.control = document.querySelector('[data-excavator-relations-panel]')?.innerText ?? null;
  out.relationEdges = h.edgeTexts().length;
  out.counts = h.countsSeen();
  return out;
}

/** The page whose main.js no layer holds: the structural overview's relation edges, by id. */
async function noLayerRelationBody(h) {
  const out = {};
  await h.until(() => h.cards().length > 0);
  await h.sleep(300);
  h.press(h.headerButton('Structural'));
  await h.until(() => document.querySelector('.react-flow__node[data-id="layer:lib"]') && document.querySelector('[data-excavator-relation-node]'));
  await h.sleep(400);
  out.edges = [...document.querySelectorAll('.react-flow__edge')].map((e) => e.getAttribute('data-id')).filter((id) => id && id.startsWith('relation|')).sort();
  return out;
}

/** The page whose graph has no layers: the structural view draws from derived groups. */
async function groupsBody(h) {
  const out = {};
  await h.until(() => h.cards().length > 0);
  await h.sleep(300);
  h.press(h.headerButton('Structural'));
  await h.until(() => h.cards().some((n) => !/^domain:/.test(n.getAttribute('data-id') ?? '')));
  await h.sleep(400);
  out.cards = h.cards().filter((n) => !/^domain:/.test(n.getAttribute('data-id') ?? '')).length;
  out.layerRows = document.querySelectorAll('aside [data-excavator-layer-row]').length;
  return out;
}

/** The page with stored groups and project texts: the panels and a group card show the stored names and texts. */
async function storedBody(h) {
  const out = {};
  await h.until(() => h.cards().length > 0);
  await h.sleep(400);
  out.introduction = h.asideText().includes('The stored introduction.');
  h.press(document.querySelector('aside [data-excavator-domain-row="domain:run"]'));
  await h.until(() => Boolean(h.aside()?.querySelector('[data-excavator-open="node"]')));
  h.press(h.aside()?.querySelector('[data-excavator-open="node"]'));
  await h.until(() => document.querySelector('[data-excavator-group-card]'));
  const card = document.querySelector('[data-excavator-group-card]');
  out.cardText = card?.textContent ?? '';
  out.cardDescription = card?.querySelector('[data-excavator-group-description]')?.getAttribute('title') ?? null;
  out.codeLabelSeen = document.body.innerText.includes('codelabel-run');
  h.press(h.headerButton('Structural'));
  await h.until(() => h.section('Runtime units'));
  out.technical = h.asideText().includes('The stored technical overview.');
  return out;
}

/** At a narrow width: no sideways scroll; on a phone the drawer holds the two switches. */
async function narrowBody(h) {
  const out = { width: window.innerWidth, mobile: window.innerWidth < 768 };
  await h.until(() => h.cards().length > 0);
  await h.sleep(600);
  const doc = document.documentElement;
  const sideways = () => Math.max(doc.scrollWidth, document.body.scrollWidth) > window.innerWidth + 1;
  out.sideways = sideways();
  if (out.mobile) {
    h.press(document.querySelector('[aria-label="Open menu"]'));
    await h.sleep(500);
    const drawer = document.querySelector('[role="dialog"]');
    out.drawer = [...(drawer?.querySelectorAll('button') ?? [])].map((b) => b.textContent.trim()).filter((t) => ['Domain', 'Structural', 'French', 'English'].includes(t));
    out.sidewaysOpen = sideways();
  } else {
    out.header = [...document.querySelectorAll('header button, header input')].map((e) => (e.tagName === 'INPUT' ? 'input:' + e.type : e.textContent.trim()));
  }
  return out;
}

function runChrome(html, { screenshot = null, width = 1440, height = 900, body = mainBody } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'explorer-smoke-'));
  try {
    const page = join(dir, 'explorer.html');
    writeFileSync(page, html);
    const args = [join(here, 'view-smoke.mjs'), page, '--width', String(width), '--height', String(height), '--eval', probe(body)];
    if (screenshot) args.push('--screenshot', resolve(screenshot));
    const run = spawnSync(process.execPath, args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    if (run.stdout.trim() === '') throw new Error(`view-smoke gave no result: ${run.stderr.trim()}`);
    return JSON.parse(run.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const readEval = (result) => (result.evalResult && !result.evalResult.error ? result.evalResult : {});

/** One check made of named conditions: ok when all hold; the detail names those that do not. */
function verdict(name, conditions) {
  const failed = conditions.filter(([, ok]) => !ok).map(([label]) => label);
  return { name, ok: failed.length === 0, detail: failed.length === 0 ? `${conditions.length} conditions hold` : `FAILED: ${failed.join('; ')}` };
}

const has = (text, part) => typeof text === 'string' && text.includes(part);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The network and console checks, shared by every page. */
function judgeClean(result) {
  const network = [...result.extraRequests, ...result.loadFailures, ...result.cspViolations.map((v) => `${v.directive} ${v.blocked}`)];
  const consoleProblems = [...result.consoleErrors, ...result.exceptions, ...result.logErrors];
  return [
    { name: 'network', ok: network.length === 0, detail: network.length === 0 ? 'no request, no failed load, no policy violation' : network.join('; ') },
    { name: 'console', ok: consoleProblems.length === 0, detail: consoleProblems.length === 0 ? 'no console error or exception' : consoleProblems.join('; ').slice(0, 300) },
  ];
}

const noCounts = (lines) => verdict('no counts', [['no node, edge, file, flow, step or relation count and no "N drawn of M"', Array.isArray(lines) && lines.length === 0]]);

/** The page as it opens. */
export function judgeMain(result) {
  const p = readEval(result);
  const rows = p.domainRows ?? [];
  const kinds = rows.map((r) => r.kind);
  const labels = (list) => (list ?? []).map((r) => r.label);
  const originals = (list) => (list ?? []).map((r) => r.original);
  const summary = p.summary ?? '';
  const details = p.details ?? [];
  return [
    ...judgeClean(result),
    { name: 'cards', ok: p.cards >= 1 && result.ready === '1', detail: `${p.cards} cards, ready=${result.ready}` },
    verdict('defaults', [
      ['Domain is lit', p.defaults?.domain === true],
      ['Structural is not lit', p.defaults?.structural === false],
      ['the domain graph is drawn', p.defaults?.domainCard === true],
    ]),
    verdict('header', [['the controls are exactly Domain, Structural, the search box, French, English', same(p.header, ['Domain', 'Structural', 'input:text', 'French', 'English'])]]),
    noCounts(p.counts),
    verdict('domain overview', [
      ['three domains listed', rows.length === 3],
      ['business first, then support, then no kind', same(kinds, ['business', 'support', ''])],
      ['each shows its kind word', same(rows.map((r) => r.kindWord), ['business', 'support', null])],
      ['a translated name has its English original under it', rows[0]?.label === 'Paiements' && rows[0]?.original === 'Payments'],
      ['a click opens the domain, Escape returns to the list', p.opened === true && has(p.openedTitle, 'All domains') && p.listBack === true],
      ['the panel lists each flow once: no contains-flow rows, and inside a group only that group\'s flows', p.containsRows === false && p.groupContainsRows === false && p.groupCardFlows > 0 && p.groupFlowRows === p.groupCardFlows && p.domainFlowRows === p.groupCardFlows],
      ['the panel shows no navigation trail of its own in the domain view', p.panelTrail === false],
      ['a panel list item goes to its node: the lanes of its group open, the flow is selected and inside the canvas', p.goLanes === true && p.goSelected === true && p.goInside === true],
      ['the cards show names, not routes or paths; the panel has one Code line', p.noCodeOnCards === true && p.codeLines.length === 1 && /src\/main\.js/.test(p.codeLines[0]) && p.codeNowhereElse === true],
      ['Back is a history back: same level, selection and viewport', p.viewMoved === true && p.backRestored === true],
      ['the panel Back names the view it returns to and the canvas Back is enabled with it', typeof p.panelBackLabel === 'string' && p.panelBackLabel.startsWith('\u2190 ') && p.panelBackLabel.endsWith(p.beforeCrumbName) && p.canvasBackEnabled === true],
      ['a view switch to Structural and Back returns to the Domain level left', p.structuralBackEnabled === true && p.switchBack === true],
      ['Back is disabled on first load, and the panel has no Back', p.backDisabledOnLoad === true],
      ['the overview has no bar on first load, and the bar clears the nodes on the group level and in the lanes', p.overviewNoBar === true && p.groupsBarClear === true && p.lanesBarClear === true],
      ['a panel item already on screen changes only the selection', p.goStable === true],
      ['a single click on a group card leaves the group level in place', p.groupLevelKept === true],
      ['the panel list selects: the domain shows with an Open button and the canvas stays on the overview', p.rowOpenButton === true && p.rowStayedOnOverview === true],
      ['a click on a domain card dims the others, and the same click again restores them', p.dimmedOnSelect === true && p.undimmedOnToggle === true],
      ['after the second click no node keeps the selected class', p.noSelectedClass === true],
      ['entering a group by double click shows the lanes with nothing selected or dimmed', p.lanesUndimmed === true],
      ['the overview and the lanes are centred in the canvas', p.overviewCentred === true && p.lanesCentred === true],
      ['a double click on a domain card opens it too', p.dblOpened === true && p.dblBack === true],
    ]),
    verdict('language switch', [
      ['the translations show first, the language button lit', p.language?.lit === true && p.language?.englishLit === false],
      ['English shows the English names', same(labels(p.english?.rows), ['Payments', 'Running', 'Other']) && originals(p.english?.rows).every((o) => o === null) && p.english?.lit === true],
      ['a domain description shows in its translation only: card, panel list (first line) and its tooltip', has(p.descriptions?.card, 'Prend les paiements.') && !has(p.descriptions?.card, 'Takes payments.') && has(p.descriptions?.row, 'Prend les paiements.') && !has(p.descriptions?.row, 'Deuxieme') && !has(p.descriptions?.row, 'Takes payments.') && has(p.descriptions?.rowTitle, 'Deuxieme ligne.')],
      ['the language button brings the translations back', same(labels(p.french?.rows), ['Paiements', 'Execution', 'Other']) && p.french?.lit === true],
    ]),
    verdict('status line', [
      ['the summary names each product state', has(summary, 'included') && has(summary, 'Hotspots different revision') && has(summary, 'Semantics not run')],
      ['the details say the graph was made from another revision', details.some((d) => /was made from git:bbbbbbbb; this page was packed at git:aaaaaaaa/.test(d))],
      ['the details name the semantics product that was not run', details.some((d) => /^Semantics: not run/.test(d))],
      ['no banner above the graph', p.banner === false],
    ]),
    verdict('uncovered languages', [
      ['the details name the language that was not analysed', details.includes('Knowledge graph: not analysed: css')],
      ['the line has no digit', details.filter((d) => /not analysed|partly analysed/.test(d)).every((d) => !/\d/.test(d))],
    ]),
    verdict('content', [
      ['the title says Excavator', p.title === 'Excavator'],
      ['no visible text names the upstream product', p.upstreamName === false],
    ]),
    { name: 'probe time', ok: typeof p.elapsedMs === 'number' && p.elapsedMs < 12000, detail: `${p.elapsedMs} ms of the 15000 ms the page's script is given` },
  ];
}

/** The structural view. */
export function judgeStruct(result) {
  const p = readEval(result);
  const labels = p.edgeLabels ?? [];
  return [
    ...judgeClean(result),
    { name: 'cards', ok: p.cards >= 2 && result.ready === '1', detail: `${p.cards} cards at the top level` },
    verdict('structural overview', [
      ['runtime units are listed', has(p.units, 'Web') && has(p.units, 'Api')],
      ['the tech stack shows each name once', p.frameworks === 'Express' && p.languages === 'JavaScript'],
      ['both layers are listed', same(p.layers, ['layer:app', 'layer:lib'])],
      ['a layer name shows in its translation only in the LAYERS list', (p.layerRowTexts ?? []).some((t) => t.includes('Bibliotheque') && !t.includes('Library'))],
      ['the external system is listed', has(p.externals, 'mail')],
      ['the most changed files are listed', has(p.changed, 'src/main.js') && has(p.changed, 'src/util.js')],
      ['the unused-code entry opens the list', p.unusedEntry === true && p.unusedList === true && (p.unusedRows ?? []).some((r) => /leaf/.test(r))],
    ]),
    noCounts([...(p.counts ?? []), ...(p.nodeCounts ?? []), ...(p.drillCounts ?? [])]),
    verdict('relations on the canvas', [
      ['edge labels are kind words', labels.length > 0 && labels.every((t) => /^[a-z]+$/.test(t))],
      ['a stand-in says what it is', (p.standIns ?? []).some((t) => /External system/.test(t)) && (p.standIns ?? []).every((t) => !/\d/.test(t))],
      ['the control says what is not drawn, with no digit', has(p.relationsPanel, 'Some relations are not drawn') && !/\d/.test((p.relationsPanel ?? '').replace('Relations', ''))],
    ]),
    verdict('node panel', [
      ['a function listed in unused shows the Unused code section', has(p.unusedFactsText, 'leaf')],
      ['a file listed in hotspots shows the Hotspot section with its rank and co-changed file', p.hotspotFacts === true && has(p.hotspotText, 'rank 1') && has(p.hotspotText, 'src/util.js')],
      ['a file cited by a doc-map unit shows the Documents section', p.documentsFacts === true && has(p.documentsText, 'Run <b>once</b>')],
      ['headings carry no count', p.communicationHeading === 'Communication' && (p.connectionsHeading === null || p.connectionsHeading === 'Connections')],
    ]),
    verdict('content', [
      ['a layer row selects the layer and its Open button drills in', p.drilled === true],
      ['a file\'s code opens from the inlined sources', p.codeShown === true],
    ]),
    { name: 'probe time', ok: typeof p.elapsedMs === 'number' && p.elapsedMs < 12000, detail: `${p.elapsedMs} ms of the 15000 ms the page's script is given` },
  ];
}

/** The page whose products were not run. */
export function judgeNotRun(result) {
  const p = readEval(result);
  return [
    ...judgeClean(result),
    verdict('states', [
      ['the units section says why it is empty', has(p.relations, 'Relations: not run (/excavator-relations)')],
      ['the most changed files say why', has(p.hotspots, 'Hotspots: not run')],
      ['the unused-code section says why, with no list entry', has(p.unused, 'Unused code: unreadable (unused-code.json is not valid JSON)') && p.unusedButton === false],
      ['the status line names the states', has(p.summary, 'not run')],
      ['the Relations control says why nothing is drawn', has(p.control, 'Not drawn: the relations product is not run')],
      ['no relation edge', p.relationEdges === 0],
    ]),
    noCounts(p.counts),
  ];
}

/** The page whose graph has no layers. */
export function judgeNoLayers(result) {
  const p = readEval(result);
  return [
    ...judgeClean(result),
    { name: 'cards', ok: p.cards >= 1 && result.ready === '1', detail: `${p.cards} cards at the top level, ready=${result.ready}` },
    { name: 'groups', ok: p.layerRows >= 1, detail: `${p.layerRows} derived groups listed in the panel` },
  ];
}

/**
 * The page whose main.js no layer holds: rel:1 (main calls helper) has an end in no layer and is drawn in no view;
 * rel:2 (helper calls the mail system) is still drawn.
 */
export function judgeNoLayerRelation(result) {
  const p = readEval(result);
  return [
    ...judgeClean(result),
    verdict('relation with an end in no layer', [
      ['the relation with an end in no layer is no edge, and the other relation still is', JSON.stringify(p.edges) === JSON.stringify(['relation|external|layer:lib|relations:external:mail'])],
    ]),
  ];
}

/** The page with stored groups. */
export function judgeStored(result) {
  const p = readEval(result);
  return [
    ...judgeClean(result),
    verdict('stored groups', [
      ['the overview panel shows the stored introduction', p.introduction === true],
      ['a group card shows the stored name and its description, and never the code label', p.cardText.includes('Stored name') && p.cardDescription === 'Does the stored thing.' && p.codeLabelSeen === false],
      ['the structural overview shows the stored technical overview', p.technical === true],
    ]),
  ];
}

/** A narrow page. */
export function judgeNarrow(result, width) {
  const p = readEval(result);
  return [
    ...judgeClean(result),
    verdict('layout', [
      ['no sideways scroll', p.sideways === false],
      width < 768
        ? ['the drawer holds the Domain | Structural and the language switch', same(p.drawer, ['Domain', 'Structural', 'French', 'English']) && p.sidewaysOpen === false]
        : ['the header holds the switches and the search box', same(p.header, ['Domain', 'Structural', 'input:text', 'French', 'English'])],
    ]),
  ];
}

function report(label, checks) {
  for (const check of checks) process.stdout.write(`${check.ok ? 'ok  ' : 'FAIL'} ${label} ${check.name}: ${check.detail}\n`);
  return checks.every((check) => check.ok);
}

const PAGES = {
  main: { body: mainBody, judge: judgeMain },
  struct: { body: structBody, judge: judgeStruct },
};

/** Each planted fault: the page it runs on and the checks that must go red. */
const PLANTED = [
  { fault: 'external-url', page: 'main', red: ['network'] },
  { fault: 'thrown-error', page: 'main', red: ['console'] },
  { fault: 'no-domain', page: 'main', red: ['defaults'] },
  { fault: 'header-diff', page: 'main', red: ['header'] },
  { fault: 'no-name-table', page: 'main', red: ['header', 'language switch'] },
  { fault: 'count-canvas', page: 'main', red: ['no counts'] },
  { fault: 'count-aside', page: 'main', red: ['no counts'] },
  { fault: 'domain-order', page: 'main', red: ['domain overview'] },
  { fault: 'status-missing', page: 'main', red: ['status line'] },
  { fault: 'banner', page: 'main', red: ['status line'] },
  { fault: 'full-coverage', page: 'main', red: ['uncovered languages'] },
  { fault: 'wrong-title', page: 'main', red: ['content'] },
  { fault: 'upstream-name', page: 'main', red: ['content'] },
  { fault: 'count-canvas', page: 'struct', red: ['no counts'] },
  { fault: 'drawn-of', page: 'struct', red: ['no counts'] },
  { fault: 'edge-count', page: 'struct', red: ['no counts', 'relations on the canvas'] },
  { fault: 'stack-dup', page: 'struct', red: ['structural overview'] },
  { fault: 'no-product-files', page: 'struct', red: ['node panel', 'structural overview'] },
  { fault: 'no-graph', page: 'struct', red: ['cards'] },
  { fault: 'no-sources', page: 'struct', red: ['content'] },
  { fault: 'no-drill', page: 'struct', red: ['content'] },
];

function main(argv) {
  if (!existsSync(TEMPLATE)) throw new Error(`${TEMPLATE} does not exist: run \`pnpm -r build\` first`);
  const template = readFileSync(TEMPLATE, 'utf-8');
  const data = fixtureData();
  const shot = argv.includes('--screenshot') ? argv[argv.indexOf('--screenshot') + 1] : null;

  let ok = report('main', judgeMain(runChrome(assemble(template, data), { screenshot: shot })));
  ok = report('structural', judgeStruct(runChrome(assemble(template, data), { body: structBody }))) && ok;
  ok = report('not-run', judgeNotRun(runChrome(assemble(template, withUnavailableProducts(data)), { body: notRunBody }))) && ok;
  ok = report('no-layers', judgeNoLayers(runChrome(assemble(template, withoutLayers(data)), { body: groupsBody }))) && ok;
  ok = report('no-layer-relation', judgeNoLayerRelation(runChrome(assemble(template, withMainInNoLayer(data)), { body: noLayerRelationBody }))) && ok;
  ok = report('stored', judgeStored(runChrome(assemble(template, withStoredGroups(data)), { body: storedBody }))) && ok;
  for (const width of [768, 375]) {
    ok = report(`width-${width}`, judgeNarrow(runChrome(assemble(template, data), { width, height: width === 375 ? 812 : 1024, body: narrowBody }), width)) && ok;
  }
  if (argv.includes('--self-check')) {
    // Each planted fault must turn the checks it targets red.
    const seenRed = (checks, name) => !checks.find((check) => check.name === name).ok;
    for (const { fault, page, red } of PLANTED) {
      const { body, judge } = PAGES[page];
      const checks = judge(runChrome(assemble(template, data, fault), { body }));
      for (const name of red) {
        const target = checks.find((check) => check.name === name);
        const seen = !target.ok;
        process.stdout.write(`${seen ? 'ok  ' : 'FAIL'} planted ${fault} (${page}): ${name} is ${target.ok ? 'green (not caught)' : 'red'} (${target.detail.slice(0, 140)})\n`);
        ok = ok && seen;
      }
    }
    // The not-run page: the states assertion is red on the page whose products are included, and a graph with no data makes the derived groups red.
    {
      const included = judgeNotRun(runChrome(assemble(template, data), { body: notRunBody }));
      const seen = seenRed(included, 'states');
      process.stdout.write(`${seen ? 'ok  ' : 'FAIL'} planted included-products (not-run page): states is ${seen ? 'red' : 'green (not caught)'}\n`);
      ok = ok && seen;
      const groups = judgeNoLayers(runChrome(assemble(template, withoutLayers(data), 'no-graph'), { body: groupsBody }));
      const groupsSeen = seenRed(groups, 'cards');
      process.stdout.write(`${groupsSeen ? 'ok  ' : 'FAIL'} planted no-graph (no-layers page): cards is ${groupsSeen ? 'red' : 'green (not caught)'}\n`);
      ok = ok && groupsSeen;
      const wide = judgeNarrow(runChrome(assemble(template, data, 'no-name-table'), { width: 375, height: 812, body: narrowBody }), 375);
      const wideSeen = seenRed(wide, 'layout');
      process.stdout.write(`${wideSeen ? 'ok  ' : 'FAIL'} planted no-name-table (width-375): layout is ${wideSeen ? 'red' : 'green (not caught)'}\n`);
      ok = ok && wideSeen;
    }
  }
  return ok;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)) ? 0 : 1);
  } catch (error) {
    process.stderr.write(`explorer-smoke failed: ${error.message}\n`);
    process.exit(1);
  }
}
