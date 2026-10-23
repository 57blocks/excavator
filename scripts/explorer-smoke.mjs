#!/usr/bin/env node
/**
 * explorer-smoke.mjs
 *
 * The offline smoke of the dashboard copy (openspec: changes/viewer-explorer,
 * design O3): builds a small synthetic data object (a hand-written knowledge
 * graph in the dashboard's format, a domain graph, a tour and two sources),
 * puts it and the content security policy into the built template
 * `packages/explorer/dist/explorer.html` the way the packing step will, opens
 * the result from file:// in headless Chrome with view-smoke.mjs and asserts:
 *   - network: no request, no failed load and no policy violation;
 *   - console: no console error, exception or log error;
 *   - cards: the graph's cards render (one per layer at the top level);
 *   - our data: the overview lists the coverage record and the gaps, a node shows its
 *     verdict, a summary the verifier blanked says so, and the connections show their
 *     evidence and the mentions edge (design D4b); the freshness report says the graph
 *     was made from another revision, and the banner names both (design D2);
 *   - content: the page title says Excavator, no visible text names the upstream
 *     product, a layer drills in, and a file's code opens from the inlined sources;
 *   - products (openspec: changes/explorer-products): the header has no Files / Classes
 *     buttons and no type chips, three product buttons stand there, no onboarding overlay
 *     appears, Unused covers the graph area only (the graph stays mounted) and says its
 *     state, and a second click closes the view with the selected node still selected;
 *   - unused view, hotspots view, doc map view: each view's stat numbers equal its product's
 *     counts, Unused with only "high" lists counts.byConfidence.high rows, a clicked row shows
 *     its details in the sidebar, Show in graph closes the view and selects the node (the
 *     sidebar shows its node info), Escape clears the row and then closes the view, Open code
 *     shows the inlined source at the row's line, a row that is not in the graph or whose
 *     source is not inlined says so, a not-found unit shows its quote and searched record and
 *     no code location, an unchecked place says so, and product text is shown as text;
 *   - states: a page whose products are not run or unreadable shows only each state (with the
 *     command for a product that was not run), no table and no number;
 *   - layout: at 768 and 375 wide no view makes the page scroll sideways, and at 375 the row
 *     details sit above the table.
 * It then opens the same data with the graph's layers removed and asserts the
 * structural view still draws, now from the groups the copy derives, which the
 * legend calls groups (the page with layers must call them layers).
 *
 *   node scripts/explorer-smoke.mjs [--screenshot <png>] [--self-check]
 *
 * `--self-check` is the instrument check: it also runs pages with a planted fault
 * (an external stylesheet, a thrown error, a graph the page cannot read, the removed header
 * buttons and onboarding put back, the product files left out, product counts that no longer
 * match, a graph without the unused node, a page packed without source) and requires that each
 * assertion it was written to catch goes red.
 *
 * Needs `pnpm -r build` (the template) and a local Chrome. Prints one line per
 * check and exits 1 when any fails.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTENT_SECURITY_POLICY } from '../skills/excavator-view/page-assembly.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(here, '..', 'packages', 'explorer', 'dist', 'explorer.html');
const CSP_MARKER = '<!-- xv:csp -->';
const DATA_MARKER = '<!-- xv:data -->';
const DATA_GLOBAL = '__EXCAVATOR_EXPLORER_DATA__';

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
    node('file:src/main.js', 'file', 'main.js', { filePath: 'src/main.js' }),
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
    project: { name: 'fixture', languages: ['javascript'], frameworks: [], description: 'A synthetic project.', analyzedAt: '2026-01-01T00:00:00.000Z', gitCommitHash: 'abc123' },
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
  const domain = {
    version: '1.0.0',
    project: graph.project,
    nodes: [
      node('domain:run', 'domain', 'Running', { domainMeta: { entities: [], businessRules: [], crossDomainInteractions: [] } }),
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
    'meta.json': { lastAnalyzedAt: '2026-01-01T00:00:00.000Z', gitCommitHash: 'abc123', version: '1.0.0', analyzedFiles: 2 },
    'staleness.json': { graphs: { knowledge: { status: 'revision', graphRevision: `git:${'b'.repeat(40)}`, currentRevision: `git:${'a'.repeat(40)}` } } },
    'unused-code.json': unused,
    'hotspots.json': hotspots,
    'doc-map.json': docMap,
    'doc-map-checks.json': docMapChecks,
    'products.json': {
      snapshotRevision: revision,
      products: [
        productEntry('unused-code', 'included', { revision }),
        productEntry('hotspots', 'different-revision', { revision: otherRevision }),
        productEntry('doc-map', 'included', { revision }),
      ],
    },
    sources: Object.fromEntries(Object.keys(SOURCES).map((path) => [path, sourceFile(path)])),
  };
}

/** The fixture with every product's counts changed, as a product whose numbers no longer match what the page was checked against. */
export function withWrongCounts(data) {
  return {
    ...data,
    'unused-code.json': { ...data['unused-code.json'], counts: { ...data['unused-code.json'].counts, unused: 9, byConfidence: { high: 5, medium: 1, low: 0 } } },
    'hotspots.json': { ...data['hotspots.json'], counts: { ...data['hotspots.json'].counts, filesWithHistory: 9 } },
    'doc-map.json': { ...data['doc-map.json'], counts: { ...data['doc-map.json'].counts, units: 9 } },
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

/** The fixture with its products not run or unreadable: no product file, and a state each. */
export function withUnavailableProducts(data) {
  const rest = { ...data };
  for (const key of ['unused-code.json', 'hotspots.json', 'doc-map.json', 'doc-map-checks.json']) delete rest[key];
  return {
    ...rest,
    'products.json': {
      snapshotRevision: data['products.json'].snapshotRevision,
      products: [
        productEntry('unused-code', 'unreadable', { reason: 'unused-code.json is not valid JSON' }),
        productEntry('hotspots', 'not-run', { reason: 'hotspots.json was not found' }),
        productEntry('doc-map', 'not-run', { reason: 'doc-map.json was not found' }),
      ],
    },
  };
}

/** The wait signal view-smoke.mjs needs: the dashboard has no ready attribute of its own, so the page's own markup says when it has drawn. */
const READY_SCRIPT = `(function(){var r=document.documentElement;var t=setInterval(function(){if(document.querySelector('.react-flow__node')||/Failed to load|Invalid knowledge graph/.test(document.body.innerText)){clearInterval(t);r.setAttribute('data-xv-ready','1');}},50);})();`;

/** The fault 'legacy-chrome': puts back a Files button, a type chip and the onboarding text once the page has drawn. */
const LEGACY_CHROME_SCRIPT = `<script>setTimeout(function(){var h=document.querySelector('header');var f=document.createElement('button');f.textContent='Files';h.appendChild(f);var c=document.createElement('button');c.innerHTML='<span class="rounded-full"></span>Code';h.appendChild(c);var o=document.createElement('div');o.textContent='EXCAVATOR GET STARTED Welcome to the knowledge graph';document.body.appendChild(o);},100);</script>`;

const BACKSLASH = String.fromCharCode(92);
const jsonForScript = (value) => JSON.stringify(value).replace(/</g, `${BACKSLASH}u003c`);

/**
 * The template filled the way the packing step will: the policy at its marker
 * and the data at its marker; `fault` plants one defect the smoke must catch.
 */
export function assemble(template, data, fault = null) {
  for (const marker of [CSP_MARKER, DATA_MARKER]) {
    if (template.split(marker).length !== 2) throw new Error(`the template must contain ${marker} exactly once`);
  }
  let payload = data;
  let extraHead = '';
  let extraBody = '';
  if (fault === 'external-url') extraHead = '<link rel="stylesheet" href="https://example.invalid/planted.css">';
  else if (fault === 'thrown-error') extraBody = '<script>setTimeout(function(){throw new Error("planted fault");},200);</script>';
  else if (fault === 'no-graph') payload = { ...data, 'knowledge-graph.json': undefined };
  else if (fault === 'no-products') payload = { ...data, 'unused-code.json': undefined, 'products.json': undefined };
  else if (fault === 'legacy-chrome') extraBody = LEGACY_CHROME_SCRIPT;
  else if (fault === 'wrong-counts') payload = withWrongCounts(data);
  else if (fault === 'node-missing') payload = withoutNode(data, 'function:src/util.js:leaf');
  else if (fault === 'no-sources') payload = { ...data, sources: undefined };
  const csp = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">${extraHead}`;
  const dataScript = `<script>window.${DATA_GLOBAL}=${jsonForScript(payload)};${READY_SCRIPT}</script>${extraBody}`;
  return template.replace(CSP_MARKER, () => csp).replace(DATA_MARKER, () => dataScript);
}

/** Runs in the page once it has drawn: what the checks read. */
const PROBE = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Once a product view has failed to show, later waits are not waited out: a broken page must finish well inside the script's time.
  let broken = false;
  const until = async (test, tries = 60) => { for (let i = 0; i < (broken ? 1 : tries); i++) { if (test()) return true; await sleep(50); } return false; };
  const cards = () => [...document.body.querySelectorAll('.react-flow__node')];
  const started = Date.now();
  const out = { title: document.title, cards: cards().length, drilled: false, codeShown: false };
  await sleep(400);
  // No onboarding overlay and no Files / Classes or type-chip buttons in the header; the three product buttons stand there.
  out.onboardingShown = /GET STARTED|Welcome to the knowledge graph/.test(document.body.innerText);
  const headerButtons = [...document.querySelectorAll('header button')];
  out.headerFilesClasses = headerButtons.some((b) => /^(files|classes)$/i.test(b.textContent.trim()));
  out.headerTypeChips = headerButtons.some((b) => b.querySelector('span.rounded-full'));
  out.productButtons = [...document.querySelectorAll('header [data-excavator-product-button]')].map((b) => b.textContent.trim());
  // The visible text names no upstream product (a slash command in an empty state is not the product name).
  out.upstreamName = /understand/i.test(document.body.innerText.replace(/[/]understand[-a-z]*/g, ''));
  // The legend counts what the top level draws: "<n> layers", or "<n> groups" when the graph had no layers.
  const legend = [...document.querySelectorAll('header span')].map((e) => /^\\d+ (layers|groups)$/.exec(e.textContent.trim())).find(Boolean);
  out.legend = legend ? legend[1] : null;
  // The pack's freshness report reaches the banner (it loads after the graph draws).
  const bannerText = /Knowledge graph may not match the current source[\\s\\S]*was made from git:bbbbbbbb; this page was packed at git:aaaaaaaa[.]/;
  out.revisionBanner = await until(() => bannerText.test(document.body.innerText));
  if (out.cards === 0) return out;
  await sleep(300);
  const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
  const card = (id) => document.querySelector('.react-flow__node[data-id="' + id + '"]');
  const press = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  // What the product views are read through. innerText follows text-transform, so labels are matched ignoring case or read from data attributes.
  const pv = {
    button: (name) => document.querySelector('header [data-excavator-product-button="' + name + '"]'),
    overlay: () => document.querySelector('[data-excavator-product-view]'),
    side: () => document.querySelector('aside')?.innerText ?? '',
    stat: (label) => document.querySelector('[data-excavator-product-view] [data-excavator-stat="' + label + '"] [data-excavator-stat-value]')?.getAttribute('data-excavator-stat-value') ?? null,
    rows: (name) => [...document.querySelectorAll('[data-excavator-table="' + name + '"] tbody tr')],
    row: (name, key) => document.querySelector('[data-excavator-table="' + name + '"] tr[data-excavator-row="' + key + '"]'),
    detail: () => document.querySelector('aside [data-excavator-row-detail]'),
    action: (name) => document.querySelector('aside [data-excavator-row-actions] [data-excavator-action="' + name + '"]'),
    note: (name) => document.querySelector('aside [data-excavator-row-actions] [data-excavator-note="' + name + '"]')?.innerText ?? null,
    chip: (name) => document.querySelector('[data-excavator-product-view] [data-excavator-chip="' + name + '"]'),
    tab: (name) => document.querySelector('[data-excavator-product-view] [data-excavator-tab="' + name + '"]'),
    esc: () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    open: async (name) => { press(pv.button(name)); if (!(await until(() => pv.overlay()?.getAttribute('data-excavator-product-view') === name, 20))) broken = true; await sleep(150); },
    pick: async (table, key) => { press(pv.row(table, key)); if (!(await until(() => pv.detail(), 20))) broken = true; await sleep(80); },
  };
  // Our data (design D4b): the overview of Deep Dive shows coverage and gaps; a node shows its verdict, a blanked summary says why, a connection shows its evidence.
  if (card('layer:lib')) {
    button('Deep Dive').click();
    await sleep(300);
    out.coverage = document.querySelector('[data-excavator=coverage]')?.innerText ?? null;
    out.gaps = document.querySelector('[data-excavator=gaps]')?.innerText ?? null;
    card('layer:lib').click();
    await until(() => document.querySelector('[aria-label^="Cluster"][aria-expanded="false"]'));
    press(document.querySelector('[aria-label^="Cluster"][aria-expanded="false"]'));
    await until(() => card('function:src/util.js:leaf'));
    const panel = async (id) => { press(card(id)?.firstElementChild); await sleep(300); return document.body.innerText; };
    const leafText = await panel('function:src/util.js:leaf');
    out.leafRemoved = leafText.includes('The summary was removed: the source contradicts it.') && /Contradicted/.test(leafText);
    out.helperVerified = /Verified/.test(await panel('function:src/util.js:helper'));
    const utilText = await panel('file:src/util.js');
    out.evidence = (utilText.match(/src[/](main|util)[.]js:[0-9]+/g) || []).sort();
    // util.js is the source of the mentions edge: its label is the locale's forward one.
    out.mentions = /(^|[\\n])mentions([\\n]|$)/.test(utilText);
    // Product views (explorer-products): with util.js selected, Unused covers the graph area, leaves the graph mounted and is a column no wider than 1100px.
    const selectedBefore = pv.side();
    const cardsBefore = cards().length;
    press(pv.button('unused'));
    await until(() => pv.overlay());
    const shown = pv.overlay();
    const box = shown ? shown.getBoundingClientRect() : null;
    const column = shown ? shown.firstElementChild.getBoundingClientRect() : null;
    const headerBox = document.querySelector('header').getBoundingClientRect();
    const sideBox = document.querySelector('aside').getBoundingClientRect();
    out.unusedView = Boolean(shown) && shown.getAttribute('data-excavator-product-view') === 'unused' && /Unused code/i.test(shown.innerText);
    out.unusedStatus = await until(() => { const h = pv.overlay()?.querySelector('[data-excavator-view-header]')?.innerText ?? ''; return /included/i.test(h) && /Revision git:aaaaaaaa/.test(h); });
    if (!out.unusedStatus) broken = true;
    out.graphMounted = cards().length === cardsBefore && cardsBefore > 0;
    out.overlayArea = Boolean(box) && box.top >= headerBox.bottom - 1 && box.right <= sideBox.left + 1 && getComputedStyle(shown).position === 'absolute' && getComputedStyle(shown).backgroundColor !== 'rgba(0, 0, 0, 0)';
    out.columnCentred = Boolean(column) && column.width <= 1100.5 && Math.abs((column.left - box.left) - (box.right - column.right)) < 24;
    out.unusedPressed = pv.button('unused').getAttribute('aria-pressed') === 'true';
    press(pv.button('unused'));
    await sleep(200);
    out.viewClosed = pv.overlay() === null;
    out.selectionKept = selectedBefore.includes('util.js') && pv.side() === selectedBefore;
    // Structural, the mode already shown, closes a view the same way; the rows used only by tests open nothing.
    press(pv.button('unused'));
    await until(() => pv.overlay());
    const inert = pv.rows('test-only');
    press(inert[0]);
    await sleep(150);
    out.testOnlyInert = inert.length === 1 && inert.every((r) => !r.hasAttribute('tabindex')) && pv.detail() === null;
    press(document.querySelector('header button[title="Structural"]'));
    await sleep(200);
    out.structuralKept = pv.overlay() === null && pv.side() === selectedBefore;
    button('Project').click();
    await until(() => card('layer:app'));
    button('Learn').click();
    await sleep(300);
  }
  // A layer card drills into the layer: the level's own cards replace the layers. A page without the fixture's layers has no such card.
  const app = cards().find((n) => /App/.test(n.textContent));
  if (!app) return out;
  app.click();
  out.drilled = await until(() => cards().some((n) => /Cluster/.test(n.textContent)));
  // A file's code opens from the file list by double-click and is read from the inlined sources.
  const tab = [...document.querySelectorAll('button')].filter((b) => /^files$/i.test(b.textContent.trim())).pop();
  tab.click();
  await sleep(200);
  const leaf = (text) => [...document.body.querySelectorAll('div,span,button')].find((e) => e.children.length === 0 && e.textContent.trim() === text);
  leaf('src').click();
  await sleep(200);
  leaf('main.js').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  out.codeShown = await until(() => /return helper[(]1[)]/.test(document.body.innerText));
  pv.esc();
  await sleep(300);
  // The three views with their rows (explorer-products); each starts from the graph.
  const ADVICE = /safe to delete|should (be )?(removed|deleted)|can be (removed|deleted)|recommend/i;
  const LEAF = 'function:src/util.js:leaf';
  const ORPHAN = 'function:src/gone.js:orphan';
  const MAIN = 'function:src/main.js:main';

  // Unused: counts, the high filter, the row details in the sidebar, rows that are not in the graph or have no source, Escape, Open code, Show in graph.
  await pv.open('unused');
  const unused = { advice: ADVICE.test(pv.overlay()?.innerText ?? ''), stats: { unused: pv.stat('Unused'), unreferenced: pv.stat('Unreferenced'), onlyReachable: pv.stat('Only reachable from unused'), testOnly: pv.stat('Test only') }, rowsAll: pv.rows('unused').length };
  press(pv.chip('Confidence:high'));
  await sleep(150);
  unused.high = { text: document.querySelector('[data-excavator-shown=unused]')?.innerText ?? null, rows: pv.rows('unused').length };
  press(pv.chip('Confidence:high'));
  await sleep(100);
  await pv.pick('unused', LEAF);
  const detailText = (pv.detail()?.innerText ?? null);
  unused.detail = {
    text: detailText,
    marked: Boolean(pv.row('unused', LEAF)?.hasAttribute('data-excavator-row-selected')),
    show: Boolean(pv.action('show-in-graph')),
    code: Boolean(pv.action('open-code')),
    groupOthers: document.querySelector('aside [data-excavator-group-others]')?.getAttribute('data-excavator-group-others') ?? null,
    referrers: document.querySelector('aside [data-excavator-referrers]')?.getAttribute('data-excavator-referrers') ?? null,
  };
  await pv.pick('unused', ORPHAN);
  unused.orphan = { graphNote: pv.note('graph'), codeNote: pv.note('code'), show: Boolean(pv.action('show-in-graph')), code: Boolean(pv.action('open-code')) };
  pv.esc();
  await sleep(150);
  unused.escapeRow = pv.detail() === null && pv.overlay() !== null;
  pv.esc();
  await sleep(150);
  unused.escapeView = pv.overlay() === null;
  await pv.open('unused');
  await pv.pick('unused', MAIN);
  press(pv.action('open-code'));
  unused.openCode = await until(() => /return helper[(]1[)]/.test(document.body.innerText) && document.querySelector('[data-excavator-line-marked]'));
  unused.markedLines = document.querySelectorAll('[data-excavator-line-marked]').length;
  pv.esc();
  await sleep(250);
  unused.escapeCodeFirst = document.querySelector('[data-excavator-line-marked]') === null && pv.detail() !== null && pv.overlay() !== null;
  await pv.pick('unused', LEAF);
  press(pv.action('show-in-graph'));
  await sleep(500);
  unused.show = { closed: pv.overlay() === null, rowGone: pv.detail() === null, side: pv.side() };
  out.unusedViewRows = unused;

  // Hotspots (made from another revision): the notice, counts, a file row, a directory row, Show in graph.
  await pv.open('hotspots');
  const hotspots = {
    notice: document.querySelector('[data-excavator-notice=revision]')?.innerText ?? null,
    stats: { withHistory: pv.stat('Files with history'), withoutHistory: pv.stat('Files without history'), binary: pv.stat('Binary files'), conflicts: pv.stat('Lineage conflicts') },
    rows: pv.rows('files').length,
    years: document.querySelector('[data-excavator-years]')?.getAttribute('data-excavator-years') ?? null,
    advice: ADVICE.test(pv.overlay()?.innerText ?? ''),
  };
  await pv.pick('files', 'src/main.js');
  hotspots.file = {
    text: (pv.detail()?.innerText ?? null),
    years: pv.detail()?.querySelector('[data-excavator-row-years]')?.getAttribute('data-excavator-row-years') ?? null,
    together: pv.detail()?.querySelector('[data-excavator-co-change]')?.getAttribute('data-excavator-co-change') ?? null,
    show: Boolean(pv.action('show-in-graph')),
    code: Boolean(pv.action('open-code')),
  };
  press(pv.tab('directories'));
  await sleep(150);
  hotspots.tabClearedRow = pv.detail() === null;
  await pv.pick('directories', 'src');
  hotspots.dir = { text: (pv.detail()?.innerText ?? null), show: Boolean(pv.action('show-in-graph')), code: Boolean(pv.action('open-code')), note: pv.note('graph') };
  press(pv.tab('files'));
  await sleep(150);
  await pv.pick('files', 'src/main.js');
  press(pv.action('show-in-graph'));
  await sleep(500);
  hotspots.show = { closed: pv.overlay() === null, side: pv.side() };
  out.hotspotsViewRows = hotspots;

  // Doc map: counts, the not-found unit (quote and searched record, no code location), an unchecked place, a checked one, text shown as text.
  await pv.open('doc-map');
  const docmap = {
    stats: { documents: pv.stat('Documents'), units: pv.stat('Units'), found: pv.stat('Code found'), notFound: pv.stat('No code found') },
    rows: pv.rows('units').length,
    asText: Boolean(pv.overlay()) && pv.overlay().innerText.includes('Run <b>once</b>') && pv.overlay().querySelector('b') === null,
    advice: ADVICE.test(pv.overlay()?.innerText ?? ''),
  };
  await pv.pick('units', '2');
  docmap.notFound = { text: (pv.detail()?.innerText ?? null), evidence: (pv.detail()?.querySelectorAll('[data-excavator-evidence]').length ?? -1), searched: pv.detail()?.querySelector('[data-excavator-searched]')?.getAttribute('data-excavator-searched') ?? null, code: Boolean(pv.action('open-code')), show: Boolean(pv.action('show-in-graph')) };
  await pv.pick('units', '3');
  docmap.unchecked = { text: (pv.detail()?.innerText ?? null), check: pv.detail()?.querySelector('[data-excavator-check]')?.getAttribute('data-excavator-check') ?? null };
  await pv.pick('units', '1');
  docmap.checked = { text: (pv.detail()?.innerText ?? null), check: pv.detail()?.querySelector('[data-excavator-check]')?.getAttribute('data-excavator-check') ?? null, show: Boolean(pv.action('show-in-graph')), code: Boolean(pv.action('open-code')) };
  out.docmapViewRows = docmap;
  press(pv.button('doc-map'));
  await sleep(200);
  out.elapsedMs = Date.now() - started;
  return out;
})()`;

/** Runs in the page of the unavailable-products fixture: opens each view and reads only its state. */
const PROBE_STATES = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test) => { for (let i = 0; i < 60; i++) { if (test()) return true; await sleep(50); } return false; };
  const press = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const out = { views: {} };
  await until(() => document.querySelector('.react-flow__node'));
  await sleep(500);
  for (const name of ['unused', 'hotspots', 'doc-map']) {
    const button = document.querySelector('header [data-excavator-product-button="' + name + '"]');
    press(button);
    await until(() => document.querySelector('[data-excavator-product-view="' + name + '"]'));
    await sleep(250);
    const view = document.querySelector('[data-excavator-product-view]');
    out.views[name] = {
      state: view.querySelector('[data-excavator-state]')?.innerText ?? null,
      tables: view.querySelectorAll('[data-excavator-table]').length,
      stats: view.querySelectorAll('[data-excavator-stat]').length,
      sections: view.querySelectorAll('[data-excavator-section]').length,
    };
    press(button);
    await sleep(150);
  }
  return out;
})()`;

/** Runs at 768 and 375 wide: opens each view, chooses its first row, and measures whether the page scrolls sideways and where the row details are. */
const PROBE_NARROW = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test) => { for (let i = 0; i < 60; i++) { if (test()) return true; await sleep(50); } return false; };
  const press = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const out = { width: window.innerWidth, mobile: window.innerWidth < 768, views: {} };
  await until(() => document.querySelector('.react-flow__node'));
  await sleep(600);
  const doc = document.documentElement;
  const sideways = () => Math.max(doc.scrollWidth, document.body.scrollWidth) > window.innerWidth + 1;
  const buttonFor = (name) => document.querySelector((out.mobile ? '' : 'header ') + '[data-excavator-product-button="' + name + '"]');
  const toggle = async (name) => {
    if (out.mobile) { press(document.querySelector('[aria-label="Open menu"]')); await sleep(400); }
    press(buttonFor(name));
    await sleep(300);
  };
  const MAIN_TABLE = { unused: 'unused', hotspots: 'files', 'doc-map': 'units' };
  for (const name of ['unused', 'hotspots', 'doc-map']) {
    await toggle(name);
    await until(() => document.querySelector('[data-excavator-product-view="' + name + '"] [data-excavator-table="' + MAIN_TABLE[name] + '"]'));
    const view = document.querySelector('[data-excavator-product-view]');
    const rec = { sideways: sideways(), overlaySideways: view.scrollWidth > view.clientWidth + 1, tables: [...view.querySelectorAll('[data-excavator-table]')].length, tablesScrollInside: [...view.querySelectorAll('[data-excavator-table] > div')].filter((d) => d.scrollWidth > d.clientWidth + 1).length };
    const row = document.querySelector('[data-excavator-table="' + MAIN_TABLE[name] + '"] tbody tr');
    press(row);
    await sleep(400);
    const inline = view.querySelector('[data-excavator-row-inline]');
    const table = view.querySelector('[data-excavator-table="' + MAIN_TABLE[name] + '"]');
    rec.afterRow = {
      sideways: sideways(),
      overlaySideways: view.scrollWidth > view.clientWidth + 1,
      inline: Boolean(inline),
      inlineAboveTable: Boolean(inline) && inline.getBoundingClientRect().top < table.getBoundingClientRect().top,
      sidebarDetail: Boolean(document.querySelector('aside [data-excavator-row-detail]')),
    };
    await toggle(name);
    out.views[name] = rec;
  }
  return out;
})()`;

function runChrome(html, { screenshot = null, width = 1440, height = 900, probe = PROBE } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'explorer-smoke-'));
  try {
    const page = join(dir, 'explorer.html');
    writeFileSync(page, html);
    const args = [join(here, 'view-smoke.mjs'), page, '--width', String(width), '--height', String(height), '--eval', probe];
    if (screenshot) args.push('--screenshot', resolve(screenshot));
    const run = spawnSync(process.execPath, args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    if (run.stdout.trim() === '') throw new Error(`view-smoke gave no result: ${run.stderr.trim()}`);
    return JSON.parse(run.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The three assertions, as `{ name, ok, detail }`, over one view-smoke result. */
export function judge(result) {
  const probe = result.evalResult && !result.evalResult.error ? result.evalResult : { cards: 0, title: null };
  const network = [...result.extraRequests, ...result.loadFailures, ...result.cspViolations.map((v) => `${v.directive} ${v.blocked}`)];
  const consoleProblems = [...result.consoleErrors, ...result.exceptions, ...result.logErrors];
  return [
    { name: 'network', ok: network.length === 0, detail: network.length === 0 ? 'no request, no failed load, no policy violation' : network.join('; ') },
    { name: 'console', ok: consoleProblems.length === 0, detail: consoleProblems.length === 0 ? 'no console error or exception' : consoleProblems.join('; ').slice(0, 300) },
    { name: 'cards', ok: probe.cards >= 2 && result.ready === '1', detail: `${probe.cards} cards at the top level (the fixture has 2 layers), ready=${result.ready}` },
    {
      name: 'our data',
      ok: /COVERAGE [(]3 FILES[)]/i.test(probe.coverage ?? '') && /no-extractor 1/.test(probe.coverage ?? '') && /calls-unresolved/.test(probe.gaps ?? '') && /src[/]main[.]js:4 -> external/.test(probe.gaps ?? '')
        && probe.leafRemoved === true && probe.helperVerified === true && JSON.stringify(probe.evidence) === JSON.stringify(['src/main.js:1', 'src/util.js:2']) && probe.mentions === true
        && probe.revisionBanner === true,
      detail: `coverage=${probe.coverage ? 'shown' : 'missing'} gaps=${probe.gaps ? 'shown' : 'missing'} blanked summary explained=${probe.leafRemoved} verdict=${probe.helperVerified} evidence=${(probe.evidence ?? []).join(',')} mentions=${probe.mentions} revision banner=${probe.revisionBanner}`,
    },
    {
      name: 'content',
      ok: probe.title === 'Excavator' && probe.upstreamName === false && probe.drilled === true && probe.codeShown === true && probe.legend === 'layers',
      detail: `title=${probe.title} upstreamName=${probe.upstreamName} layer drilled=${probe.drilled} code from inlined sources=${probe.codeShown} legend=${probe.legend}`,
    },
    {
      name: 'products',
      ok: probe.onboardingShown === false && probe.headerFilesClasses === false && probe.headerTypeChips === false
        && JSON.stringify(probe.productButtons) === JSON.stringify(['Unused', 'Hotspots', 'Doc map'])
        && probe.unusedView === true && probe.unusedStatus === true && probe.graphMounted === true && probe.overlayArea === true && probe.columnCentred === true
        && probe.unusedPressed === true && probe.viewClosed === true && probe.selectionKept === true && probe.structuralKept === true && probe.testOnlyInert === true,
      detail: `onboarding=${probe.onboardingShown} Files/Classes=${probe.headerFilesClasses} type chips=${probe.headerTypeChips} buttons=${(probe.productButtons ?? []).join('|')} unused view=${probe.unusedView} state and revision=${probe.unusedStatus} graph mounted=${probe.graphMounted} covers graph area only=${probe.overlayArea} centred column<=1100=${probe.columnCentred} pressed=${probe.unusedPressed} closed by a second click=${probe.viewClosed} selection kept=${probe.selectionKept} kept after Structural=${probe.structuralKept} test-only rows inert=${probe.testOnlyInert}`,
    },
    ...judgeViews(probe),
    // view-smoke gives the page's script 15 s; a probe near that limit would fail by timing, not by a defect.
    { name: 'probe time', ok: typeof probe.elapsedMs === 'number' && probe.elapsedMs < 12000, detail: `${probe.elapsedMs} ms of the 15000 ms the page's script is given` },
  ];
}

/** One check made of named conditions: ok when all hold; the detail names those that do not. */
function verdict(name, conditions) {
  const failed = conditions.filter(([, ok]) => !ok).map(([label]) => label);
  return { name, ok: failed.length === 0, detail: failed.length === 0 ? `${conditions.length} conditions hold` : `FAILED: ${failed.join('; ')}` };
}

const has = (text, part) => typeof text === 'string' && text.includes(part);

/** The three product views, against the counts of the unchanged fixture (so product data that was altered cannot agree with itself). */
function judgeViews(probe) {
  const expected = fixtureData();
  const unusedCounts = expected['unused-code.json'].counts;
  const hotspotsCounts = expected['hotspots.json'].counts;
  const docCounts = expected['doc-map.json'].counts;
  const u = probe.unusedViewRows ?? {};
  const h = probe.hotspotsViewRows ?? {};
  const d = probe.docmapViewRows ?? {};
  const revisionA = `git:${'a'.repeat(40)}`;
  const revisionC = `git:${'c'.repeat(40)}`;
  const string = (n) => String(n);
  return [
    verdict('unused view', [
      ['stat Unused equals counts.unused', u.stats?.unused === string(unusedCounts.unused)],
      ['stat Unreferenced equals counts.unreferenced', u.stats?.unreferenced === string(unusedCounts.unreferenced)],
      ['stat Only reachable equals counts.onlyReachableFromUnused', u.stats?.onlyReachable === string(unusedCounts.onlyReachableFromUnused)],
      ['stat Test only equals counts.testOnly', u.stats?.testOnly === string(unusedCounts.testOnly)],
      [`the table lists ${unusedCounts.unused} rows`, u.rowsAll === unusedCounts.unused],
      [`only high lists counts.byConfidence.high (${unusedCounts.byConfidence.high}) rows`, u.high?.rows === unusedCounts.byConfidence.high && has(u.high?.text, `Showing ${unusedCounts.byConfidence.high} of ${unusedCounts.unused}`)],
      ['a row shows name, id, signal, location', has(u.detail?.text, 'leaf') && has(u.detail?.text, 'function:src/util.js:leaf') && has(u.detail?.text, 'capped') && has(u.detail?.text, 'src/util.js:1-3')],
      ['the row details replace the sidebar and the row is marked', u.detail?.marked === true && u.detail?.text !== undefined],
      ['group members and referrers are listed', u.detail?.groupOthers === '1' && u.detail?.referrers === '1'],
      ['Show in graph and Open code are offered for a node in the graph with its source', u.detail?.show === true && u.detail?.code === true],
      ['a row not in the graph says so and has no Show in graph', u.orphan?.graphNote === 'Not in the graph.' && u.orphan?.show === false],
      ['a row whose source is not inlined says so and has no Open code', u.orphan?.codeNote === 'The source of this file is not in this page.' && u.orphan?.code === false],
      ['Escape clears the row first, then closes the view', u.escapeRow === true && u.escapeView === true],
      ['Open code shows the inlined source with its line marked', u.openCode === true && u.markedLines >= 1],
      ['Escape closes the code viewer before the row', u.escapeCodeFirst === true],
      ['Show in graph closes the view and the sidebar shows the node info', u.show?.closed === true && u.show?.rowGone === true && has(u.show?.side, 'leaf') && /summary was removed/i.test(u.show?.side ?? '')],
      ['no advisory wording', u.advice === false],
    ]),
    verdict('hotspots view', [
      ['a notice names both revisions', has(h.notice, revisionC) && has(h.notice, revisionA)],
      ['stat Files with history equals counts', h.stats?.withHistory === string(hotspotsCounts.filesWithHistory)],
      ['stat Files without history equals counts', h.stats?.withoutHistory === string(hotspotsCounts.filesWithoutHistory)],
      ['stat Binary files equals counts', h.stats?.binary === string(hotspotsCounts.binaryFiles)],
      ['stat Lineage conflicts equals counts', h.stats?.conflicts === string(hotspotsCounts.filesWithLineageConflicts)],
      ['the files table lists every file', h.rows === expected['hotspots.json'].files.length],
      ['the project commits per year come from the root row', h.years === '2024:3,2025:5'],
      ['a file row shows its commits per year and the files changed with it', has(h.file?.text, 'src/main.js') && h.file?.years === '2024:2,2025:3' && h.file?.together === 'src/util.js:3'],
      ['a file row offers Show in graph and Open code', h.file?.show === true && h.file?.code === true],
      ['changing the table clears the row', h.tabClearedRow === true],
      ['a directory row shows its fields, has no Show in graph and says why', has(h.dir?.text, 'src') && h.dir?.show === false && h.dir?.code === false && h.dir?.note === 'No single node of the graph stands for this directory.'],
      ['Show in graph closes the view and the sidebar shows the node info', h.show?.closed === true && has(h.show?.side, 'main.js')],
      ['no advisory wording', h.advice === false],
    ]),
    verdict('doc map view', [
      ['stat Documents equals counts.files', d.stats?.documents === string(docCounts.files)],
      ['stat Units equals counts.units', d.stats?.units === string(docCounts.units)],
      ['stat Code found equals counts.found', d.stats?.found === string(docCounts.found)],
      ['stat No code found equals counts.notFound', d.stats?.notFound === string(docCounts.notFound)],
      ['the units table lists every unit', d.rows === docCounts.units],
      ['product text is shown as text', d.asText === true],
      ['a not-found unit shows its quote and searched record', has(d.notFound?.text, 'The program leaves quietly.') && has(d.notFound?.text, 'Pattern: leave') && d.notFound?.searched === '1'],
      ['a not-found unit shows no code location and no code buttons', d.notFound?.evidence === 0 && d.notFound?.code === false && d.notFound?.show === false],
      ['a place with no check says not checked', d.unchecked?.check === 'not-checked' && /Not checked/.test(d.unchecked?.text ?? '')],
      ['a checked place shows its verdict and reason verbatim', d.checked?.check === 'does' && has(d.checked?.text, 'It calls the helper once.')],
      ['an evidence place offers Show in graph and Open code', d.checked?.show === true && d.checked?.code === true],
      ['no advisory wording', d.advice === false],
    ]),
  ];
}

/** The assertions for the page whose products were not run or are unreadable: each view says its state and shows no data. */
export function judgeStates(result) {
  const probe = result.evalResult && !result.evalResult.error ? result.evalResult : { views: {} };
  const [network, consoleCheck] = judge({ ...result, evalResult: null });
  const view = (name) => probe.views?.[name] ?? {};
  const none = (v) => v.tables === 0 && v.stats === 0 && v.sections === 1;
  return [
    network,
    consoleCheck,
    verdict('states', [
      ['unreadable unused-code says so with the reason', has(view('unused').state, 'Status: unreadable') && has(view('unused').state, 'unused-code.json is not valid JSON')],
      ['not-run hotspots gives its command', has(view('hotspots').state, 'Status: not run') && has(view('hotspots').state, 'Command: /excavator-hotspots')],
      ['not-run doc-map gives its command', has(view('doc-map').state, 'Status: not run') && has(view('doc-map').state, 'Command: /excavator-doc-map')],
      ['no view shows a table, a number or any other card', none(view('unused')) && none(view('hotspots')) && none(view('doc-map'))],
    ]),
  ];
}

/** The assertions for a narrow page: no view scrolls the page sideways, and the row details are where the width puts them. */
export function judgeLayout(result, width) {
  const probe = result.evalResult && !result.evalResult.error ? result.evalResult : { views: {}, mobile: null };
  const [network, consoleCheck] = judge({ ...result, evalResult: null });
  const names = ['unused', 'hotspots', 'doc-map'];
  const views = probe.views ?? {};
  const conditions = [[`the page is ${width} wide`, probe.width === width]];
  for (const name of names) {
    const v = views[name];
    conditions.push([`${name}: no sideways scroll of the page or the view`, Boolean(v) && v.sideways === false && v.overlaySideways === false && v.afterRow?.sideways === false && v.afterRow?.overlaySideways === false]);
    conditions.push([
      probe.mobile ? `${name}: the row details are above the table, not in the sidebar` : `${name}: the row details are in the sidebar`,
      Boolean(v) && (probe.mobile ? v.afterRow?.inline === true && v.afterRow?.inlineAboveTable === true && v.afterRow?.sidebarDetail === false : v.afterRow?.sidebarDetail === true && v.afterRow?.inline === false),
    ]);
  }
  return [network, consoleCheck, verdict(`layout ${width}`, conditions)];
}

/** The fixture with no layers in its graph, as an analysis that writes none gives it. */
export function withoutLayers(data) {
  return { ...data, 'knowledge-graph.json': { ...data['knowledge-graph.json'], layers: [] } };
}

/** The assertions for the page whose graph has no layers: it is still clean, draws cards, and calls them groups. */
export function judgeNoLayers(result) {
  const probe = result.evalResult && !result.evalResult.error ? result.evalResult : { cards: 0, legend: null };
  const [network, consoleCheck] = judge(result);
  return [
    network,
    consoleCheck,
    { name: 'cards', ok: probe.cards >= 1 && result.ready === '1', detail: `${probe.cards} cards at the top level, ready=${result.ready}` },
    { name: 'groups', ok: probe.legend === 'groups', detail: `legend=${probe.legend}` },
  ];
}

function report(label, checks) {
  for (const check of checks) process.stdout.write(`${check.ok ? 'ok  ' : 'FAIL'} ${label} ${check.name}: ${check.detail}\n`);
  return checks.every((check) => check.ok);
}

function main(argv) {
  if (!existsSync(TEMPLATE)) throw new Error(`${TEMPLATE} does not exist: run \`pnpm -r build\` first`);
  const template = readFileSync(TEMPLATE, 'utf-8');
  const data = fixtureData();
  const shot = argv.includes('--screenshot') ? argv[argv.indexOf('--screenshot') + 1] : null;

  const clean = runChrome(assemble(template, data), { screenshot: shot });
  let ok = report('clean', judge(clean));
  ok = report('no-layers', judgeNoLayers(runChrome(assemble(template, withoutLayers(data))))) && ok;
  ok = report('unavailable-products', judgeStates(runChrome(assemble(template, withUnavailableProducts(data)), { probe: PROBE_STATES }))) && ok;
  for (const width of [768, 375]) {
    ok = report(`width-${width}`, judgeLayout(runChrome(assemble(template, data), { width, height: width === 375 ? 812 : 1024, probe: PROBE_NARROW }), width)) && ok;
  }
  if (argv.includes('--self-check')) {
    // Each planted fault must turn the assertions it targets red.
    const planted = [
      { fault: 'external-url', red: ['network'] },
      { fault: 'thrown-error', red: ['console'] },
      { fault: 'no-graph', red: ['cards'] },
      { fault: 'legacy-chrome', red: ['products'] },
      { fault: 'no-products', red: ['products'] },
      { fault: 'wrong-counts', red: ['unused view', 'hotspots view', 'doc map view'] },
      { fault: 'node-missing', red: ['unused view'] },
      { fault: 'no-sources', red: ['unused view'] },
    ];
    for (const { fault, red } of planted) {
      const checks = judge(runChrome(assemble(template, data, fault)));
      for (const name of red) {
        const target = checks.find((check) => check.name === name);
        const seen = !target.ok;
        process.stdout.write(`${seen ? 'ok  ' : 'FAIL'} planted ${fault}: ${name} is ${target.ok ? 'green (not caught)' : 'red'} (${target.detail.slice(0, 120)})\n`);
        ok = ok && seen;
      }
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
