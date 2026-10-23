/**
 * The explorer page the packer writes (openspec: changes/viewer-explorer, spec
 * "offline explorer", design D4, oracle O1; changes/retire-view-html, design D1-D3):
 * the data object keeps the products' content and changes only the shape, the tour
 * replaces the graph's own tour only for the same facts, a missing product is a
 * missing key, `--no-source` leaves the source table out, the issue count is the
 * copy's own validator's, and the manifest names every product's state.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import vm from 'node:vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { writeKnowledgeGraphAtomic } from '../../../skills/excavator/knowledge-graph-store.mjs';
import { CONTENT_SECURITY_POLICY } from '../../../skills/excavator-view/page-assembly.mjs';
import { packProject } from '../../../skills/excavator-view/pack.mjs';
import { collectProducts } from '../../../skills/excavator-view/products.mjs';
import { docMapProduct, domainGraph, hotspotsProduct, makeGitProject, semanticCache, semanticEntry, semanticGraph, sourceManifest, tourProduct, unusedProduct, writeProduct } from './fixture.mjs';
import { FIXTURE_TEMPLATE, writeTemplate } from './plugin-fixture.mjs';

const DIGEST = 'e'.repeat(64);
const OTHER_DIGEST = '9'.repeat(64);

const FILES = {
  'src/a.js': 'export function run() {\n  return load();\n}\n',
  'src/b.js': 'export function load() {\n  return 2;\n}\n',
  'src/é.js': 'const x = 1;\n',
};

const node = (id, type, name, extra = {}) => ({ id, type, name, summary: `${name} summary`, tags: ['t'], complexity: 'simple', ...extra });
const edge = (source, target, type) => ({ source, target, type, direction: 'forward', weight: 0.5 });

/** A graph in the shape the explorer reads: layers, a tour of its own, coverage, gaps, mentions edges and one edge type the copy does not know. */
function graph(extra = {}) {
  return {
    version: '1.0.0',
    project: { name: 'fixture', languages: ['javascript'], frameworks: [], description: 'd', analyzedAt: '2026-01-01T00:00:00.000Z', gitCommitHash: 'abc', factsDigest: DIGEST },
    nodes: [
      node('file:src/a.js', 'file', 'a.js', { filePath: 'src/a.js' }),
      node('file:src/b.js', 'file', 'b.js', { filePath: 'src/b.js' }),
      node('function:src/a.js:run', 'function', 'run', { filePath: 'src/a.js', lineRange: [1, 3] }),
      node('function:src/b.js:load', 'function', 'load', { filePath: 'src/b.js', lineRange: [1, 3] }),
    ],
    edges: [
      edge('file:src/a.js', 'function:src/a.js:run', 'contains'),
      edge('file:src/b.js', 'function:src/b.js:load', 'contains'),
      edge('function:src/a.js:run', 'function:src/b.js:load', 'calls'),
      edge('file:src/a.js', 'file:src/b.js', 'mentions'),
      edge('file:src/b.js', 'file:src/a.js', 'mentions'),
      edge('file:src/a.js', 'file:src/b.js', 'reexports'),
    ],
    layers: [
      { id: 'layer:app', name: 'App', description: 'Entry.', nodeIds: ['file:src/a.js', 'function:src/a.js:run'] },
      { id: 'layer:lib', name: 'Lib', description: 'Helpers.', nodeIds: ['file:src/b.js', 'function:src/b.js:load'] },
    ],
    tour: [{ order: 1, title: 'Graph own step', description: 'From the graph.', nodeIds: ['file:src/a.js'] }],
    coverage: { files: 3, byLanguage: { javascript: { files: 2, parsed: 2, zeroSymbol: 0, skipped: {} }, css: { files: 1, parsed: 0, zeroSymbol: 0, skipped: { 'no-extractor': 1 } } } },
    gaps: [{ kind: 'g', reason: 'a gap', count: 1 }],
    ...extra,
  };
}

let project;
let templateDir;
let templatePath;
beforeAll(() => {
  project = makeGitProject(FILES);
  ({ dir: templateDir, path: templatePath } = writeTemplate());
});
afterAll(() => {
  project.cleanup();
  rmSync(templateDir, { recursive: true, force: true });
});
beforeEach(() => rmSync(join(project.root, '.excavator'), { recursive: true, force: true }));

function writeGraphTo(root, value) {
  const path = join(root, '.excavator', 'knowledge-graph.jsonl');
  mkdirSync(dirname(path), { recursive: true });
  writeKnowledgeGraphAtomic(path, value);
}
const writeGraph = (value = graph()) => writeGraphTo(project.root, value);
const BLOCK = (id) => new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`);

/** Pack and read the explorer page back the way the browser would: the data block, the manifest block, the script that exposes the data. */
function pack(options) {
  const result = packProject(project.root, { explorerTemplate: templatePath, ...options });
  const html = readFileSync(result.out, 'utf-8');
  return {
    result,
    html,
    data: JSON.parse(BLOCK('xv-explorer-data').exec(html)[1]),
    manifest: JSON.parse(BLOCK('xv-explorer-manifest').exec(html)[1]),
  };
}

describe('the data keeps the content of the products', () => {
  it('joins the knowledge graph back with every node, edge, layer, tour step, gap and the coverage', () => {
    writeGraph();
    const { data } = pack();
    const original = graph();
    const joined = data['knowledge-graph.json'];
    expect(joined.nodes).toHaveLength(4);
    expect(joined.edges).toHaveLength(6);
    expect(joined.layers).toHaveLength(2);
    expect(joined.tour).toHaveLength(1);
    expect(joined.gaps).toHaveLength(1);
    expect(joined).toEqual(original);
    expect(Object.keys(joined)).toEqual(Object.keys(original));
  });

  it('writes a project outside git as an empty commit hash, the one form the copy accepts, and changes nothing else', () => {
    const original = graph();
    original.project.gitCommitHash = null;
    writeGraph(original);
    const joined = pack().data['knowledge-graph.json'];
    expect(joined.project).toEqual({ ...original.project, gitCommitHash: '' });
    expect({ ...joined, project: null }).toEqual({ ...original, project: null });
  });

  it('names a graph that carries a snapshot directory name after the project root folder, and keeps any other name', () => {
    const original = graph();
    original.project.name = 'excavator-snapshot-multi-Ab12Cd';
    writeGraph(original);
    const joined = pack().data['knowledge-graph.json'];
    expect(joined.project).toEqual({ ...original.project, name: basename(project.root) });
    expect({ ...joined, project: null }).toEqual({ ...original, project: null });

    writeGraph(graph());
    expect(pack().data['knowledge-graph.json'].project.name).toBe('fixture');
  });

  it('writes the domain graph of a project outside git with an empty commit hash too', () => {
    writeGraph();
    const domain = domainGraph({ sourceRevision: project.revision, factDigest: DIGEST });
    domain.project = { ...graph().project, gitCommitHash: null };
    writeProduct(project.root, 'domain-graph.json', domain);
    const packed = pack().data['domain-graph.json'];
    expect(packed.project.gitCommitHash).toBe('');
    expect({ ...packed, project: null }).toEqual({ ...domain, project: null });
  });

  it('passes the domain graph and meta.json on as written', () => {
    const domain = domainGraph({ sourceRevision: project.revision, factDigest: DIGEST });
    const meta = { lastAnalyzedAt: '2026-01-01T00:00:00.000Z', gitCommitHash: '', version: '1.0.0', analyzedFiles: 3 };
    writeGraph();
    writeProduct(project.root, 'domain-graph.json', domain);
    writeProduct(project.root, 'meta.json', meta);
    const { data } = pack();
    expect(data['domain-graph.json']).toEqual(domain);
    expect(data['domain-graph.json'].nodes).toHaveLength(8);
    expect(data['domain-graph.json'].edges).toHaveLength(7);
    expect(data['meta.json']).toEqual(meta);
  });

  it('writes the keys in a fixed order and no key the products do not give', () => {
    writeGraph();
    writeProduct(project.root, 'domain-graph.json', domainGraph({ sourceRevision: project.revision, factDigest: DIGEST }));
    writeProduct(project.root, 'meta.json', '{}');
    expect(Object.keys(pack().data)).toEqual(['knowledge-graph.json', 'domain-graph.json', 'meta.json', 'staleness.json', 'products.json', 'sources']);
  });

  it('packs the same bytes twice', () => {
    writeGraph();
    writeProduct(project.root, 'meta.json', '{}');
    const first = pack().html;
    expect(pack().html).toBe(first);
  });
});

describe('the semantic product of a full analysis', () => {
  const HASH_A = '1'.repeat(64);
  const HASH_B = '2'.repeat(64);
  const ALL_LAYER = { id: 'layer:all', name: 'All', description: 'Every file.', nodeIds: ['file:src/a.js', 'file:src/b.js'] };

  /** The graph, the source manifest, the semantic cache (entries are { id: entry fields }) and the semantic graph with the layers given. */
  function writeFull({ entries, layers, layerDigest = DIGEST }) {
    writeGraph();
    writeProduct(project.root, 'source-manifest.json', sourceManifest(project.revision, [
      { path: 'src/a.js', contentHash: HASH_A },
      { path: 'src/b.js', contentHash: HASH_B },
    ]));
    writeProduct(project.root, 'semantic-cache.json', semanticCache(Object.fromEntries(Object.entries(entries).map(([id, fields]) => [id, semanticEntry(fields)]))));
    writeProduct(project.root, 'semantic-graph.json', semanticGraph({ factDigest: layerDigest, layers }));
  }
  const nodeOf = (data, id) => data['knowledge-graph.json'].nodes.find((n) => n.id === id);

  it('takes a node\'s summary and tags from its entry first, blanks a contradicted summary, and keeps the node\'s own when the entry has none', () => {
    writeFull({
      entries: {
        'file:src/a.js': { summary: 'Runs the job.', tags: ['entry'], semanticSourceHash: HASH_A, verification: 'verified' },
        'function:src/a.js:run': { summary: 'Opens a socket and retries forever.', tags: [], semanticSourceHash: HASH_A, verification: 'contradicted' },
        'file:src/b.js': { summary: '', tags: [], semanticSourceHash: HASH_B },
      },
      layers: [ALL_LAYER],
    });
    const { data, manifest, html } = pack();
    expect(nodeOf(data, 'file:src/a.js')).toMatchObject({ summary: 'Runs the job.', tags: ['entry'] });
    expect(nodeOf(data, 'function:src/a.js:run')).toMatchObject({ summary: '', tags: ['t'] });
    expect(nodeOf(data, 'file:src/b.js')).toMatchObject({ summary: 'b.js summary', tags: ['t'] });
    expect(nodeOf(data, 'function:src/b.js:load')).toMatchObject({ summary: 'load summary', tags: ['t'] });
    expect(html).not.toContain('retries forever');
    expect(manifest.rows.find((row) => row.key === 'semantics')).toEqual({ key: 'semantics', status: 'merged', reason: "3 nodes; 0 entries for ids the graph lacks; 1 layers replace the graph's" });
  });

  it('blanks a summary the graph itself marks contradicted, with or without a semantic cache, and keeps the verdict', () => {
    const contradictedGraph = () => {
      const value = graph();
      Object.assign(value.nodes.find((n) => n.id === 'function:src/b.js:load'), { summary: 'Opens a socket and retries forever.', verification: 'contradicted' });
      return value;
    };
    writeGraph(contradictedGraph());
    let packed = pack();
    expect(nodeOf(packed.data, 'function:src/b.js:load')).toMatchObject({ summary: '', verification: 'contradicted' });
    expect(packed.html).not.toContain('retries forever');

    writeFull({ entries: { 'file:src/a.js': { summary: 'Runs the job.', tags: [], semanticSourceHash: HASH_A } }, layers: [] });
    writeGraph(contradictedGraph());
    packed = pack();
    expect(nodeOf(packed.data, 'function:src/b.js:load')).toMatchObject({ summary: '', verification: 'contradicted' });
    expect(nodeOf(packed.data, 'file:src/a.js')).toMatchObject({ summary: 'Runs the job.' });
    expect(packed.html).not.toContain('retries forever');
  });

  it('carries each entry\'s verdict onto its node, and writes none for an entry without one', () => {
    writeFull({
      entries: {
        'file:src/a.js': { summary: 'Runs the job.', tags: [], semanticSourceHash: HASH_A, verification: 'verified' },
        'function:src/a.js:run': { summary: 'Opens a socket.', tags: [], semanticSourceHash: HASH_A, verification: 'contradicted' },
        'file:src/b.js': { summary: 'Loads.', tags: [], semanticSourceHash: HASH_B },
      },
      layers: [ALL_LAYER],
    });
    const { data } = pack();
    expect(nodeOf(data, 'file:src/a.js').verification).toBe('verified');
    expect(nodeOf(data, 'function:src/a.js:run').verification).toBe('contradicted');
    expect(nodeOf(data, 'file:src/b.js')).not.toHaveProperty('verification');
    expect(nodeOf(data, 'function:src/b.js:load')).not.toHaveProperty('verification');
  });

  it('replaces the graph\'s layers with the semantic graph\'s, and keeps them when it has none or was made from other facts', () => {
    writeFull({ entries: {}, layers: [ALL_LAYER] });
    expect(pack().data['knowledge-graph.json'].layers).toEqual([ALL_LAYER]);

    writeFull({ entries: {}, layers: [] });
    expect(pack().data['knowledge-graph.json'].layers).toEqual(graph().layers);

    writeFull({ entries: {}, layers: [ALL_LAYER], layerDigest: OTHER_DIGEST });
    const { data, manifest } = pack();
    expect(data['knowledge-graph.json']).toEqual(graph());
    expect(manifest.rows.find((row) => row.key === 'semantics')).toMatchObject({ status: 'not-merged', reason: expect.stringMatching(/made from other facts/) });
  });

  it('merges nothing without a semantic cache and says so', () => {
    writeGraph();
    const { data, manifest } = pack();
    expect(data['knowledge-graph.json']).toEqual(graph());
    expect(manifest.rows.find((row) => row.key === 'semantics')).toEqual({ key: 'semantics', status: 'not-merged', reason: 'semantic-cache.json was not produced' });
  });
});

describe('the tour', () => {
  const writeTour = (fields) => writeProduct(project.root, 'tour.json', tourProduct({ sourceRevision: project.revision, factDigest: DIGEST, ...fields }));

  it('replaces the graph\'s tour with the steps of tour.json when it was made from the graph\'s facts', () => {
    writeGraph();
    writeTour();
    const { data, manifest } = pack();
    expect(data['knowledge-graph.json'].tour).toEqual([
      { order: 1, title: 'Where the program starts', description: 'The entry file calls run. It reads the settings first.', nodeIds: ['file:src/a.js', 'function:src/a.js:run'] },
      { order: 2, title: 'Loading data', description: 'The loader opens one file.', nodeIds: ['file:src/a.js'] },
    ]);
    // Only the four fields of the copy's tour step: no sentences, no original order, no language lesson.
    for (const step of data['knowledge-graph.json'].tour) expect(Object.keys(step)).toEqual(['order', 'title', 'description', 'nodeIds']);
    expect(manifest.rows.find((row) => row.key === 'tour').status).toBe('replaces-graph-tour');
  });

  it('keeps the graph\'s own tour when tour.json was made from other facts', () => {
    writeGraph();
    writeTour({ factDigest: OTHER_DIGEST });
    const { data, manifest } = pack();
    expect(data['knowledge-graph.json'].tour).toEqual(graph().tour);
    const row = manifest.rows.find((item) => item.key === 'tour');
    expect(row.status).toBe('keeps-graph-tour');
    expect(row.reason).toContain(OTHER_DIGEST);
  });

  it('keeps the graph\'s own tour when there is no tour.json or it cannot be read', () => {
    writeGraph();
    expect(pack().data['knowledge-graph.json'].tour).toEqual(graph().tour);
    writeProduct(project.root, 'tour.json', '{');
    const { data, manifest } = pack();
    expect(data['knowledge-graph.json'].tour).toEqual(graph().tour);
    expect(manifest.rows.find((item) => item.key === 'tour').reason).toMatch(/tour\.json is not valid JSON/);
  });

  it('adds the tour to a graph that has none of its own', () => {
    const { tour, ...withoutTour } = graph();
    writeGraph(withoutTour);
    writeTour();
    expect(pack().data['knowledge-graph.json'].tour).toHaveLength(2);
  });
});

describe('a product that is missing is a missing key', () => {
  it('gives no key but the product states for an empty .excavator, and still writes the page', () => {
    const { data, manifest, result } = pack();
    expect(Object.keys(data)).toEqual(['products.json']);
    expect(result.issues).toBeNull();
    expect(manifest.rows.filter((row) => row.status === 'not-run').map((row) => row.key)).toEqual(['knowledge-graph.json', 'domain-graph.json', 'meta.json', 'unused-code.json', 'hotspots.json', 'doc-map.json']);
    expect(manifest.rows.map((row) => row.key)).toEqual(['knowledge-graph.json', 'semantics', 'tour', 'domain-graph.json', 'meta.json', 'staleness.json', 'unused-code.json', 'hotspots.json', 'doc-map.json', 'doc-map-checks.json', 'products.json', 'sources', 'diff-overlay.json', 'config.json']);
  });

  it('gives no domain-graph.json key when there is no domain graph, and no meta.json key without meta.json', () => {
    writeGraph();
    const { data } = pack();
    expect(Object.keys(data)).toEqual(['knowledge-graph.json', 'staleness.json', 'products.json', 'sources']);
  });

  it('gives no key for a domain graph or a meta.json that cannot be read, and says why', () => {
    writeGraph();
    writeProduct(project.root, 'domain-graph.json', '{}');
    writeProduct(project.root, 'meta.json', '[1]');
    const { data, manifest } = pack();
    expect(Object.keys(data)).toEqual(['knowledge-graph.json', 'staleness.json', 'products.json', 'sources']);
    expect(manifest.rows.find((row) => row.key === 'domain-graph.json')).toMatchObject({ status: 'unreadable', reason: expect.stringMatching(/domain-graph\.json has version null/) });
    expect(manifest.rows.find((row) => row.key === 'meta.json')).toMatchObject({ status: 'unreadable', reason: expect.stringMatching(/not a JSON object/) });
  });

  it('gives no graph key for a knowledge graph whose records the store refuses, and says why', () => {
    writeGraph();
    const path = join(project.root, '.excavator', 'knowledge-graph.jsonl');
    writeProduct(project.root, 'knowledge-graph.jsonl', `${readFileSync(path, 'utf-8')}{"record":"mystery"}\n`);
    const { data, manifest, result } = pack();
    expect(data['knowledge-graph.json']).toBeUndefined();
    expect(result.issues).toBeNull();
    expect(manifest.rows.find((row) => row.key === 'knowledge-graph.json')).toMatchObject({ status: 'unreadable', reason: expect.stringMatching(/unknown record type/) });
    expect(manifest.rows.find((row) => row.key === 'tour').status).toBe('unused');
  });

  it('reports a refused graph as unreadable, and the semantics and tour it would hold as not shown', () => {
    writeGraph();
    const path = join(project.root, '.excavator', 'knowledge-graph.jsonl');
    writeProduct(project.root, 'knowledge-graph.jsonl', `${readFileSync(path, 'utf-8')}{"record":"mystery"}\n`);
    writeProduct(project.root, 'source-manifest.json', sourceManifest(project.revision, []));
    writeProduct(project.root, 'semantic-cache.json', semanticCache({}));
    writeProduct(project.root, 'semantic-graph.json', semanticGraph({ factDigest: DIGEST }));
    writeProduct(project.root, 'tour.json', tourProduct({ sourceRevision: project.revision, factDigest: DIGEST }));
    const { manifest, result } = pack();
    const states = Object.fromEntries(manifest.products.map(({ name, status }) => [name, status]));
    expect(states).toMatchObject({ 'knowledge-graph': 'unreadable', semantics: 'not-shown', tour: 'not-shown' });
    expect(result.products.find((p) => p.name === 'knowledge-graph')).toMatchObject({ status: 'unreadable', reason: expect.stringMatching(/unknown record type/) });
    expect(result.products.find((p) => p.name === 'tour')).toMatchObject({ status: 'not-shown', reason: 'there is no knowledge graph to hold it' });
  });

  it('reports readable semantics and a readable tour as not shown when there is no graph at all, and a bad one as unreadable', () => {
    writeProduct(project.root, 'semantic-cache.json', semanticCache({}));
    writeProduct(project.root, 'tour.json', tourProduct({ sourceRevision: project.revision, factDigest: DIGEST }));
    const states = (result) => Object.fromEntries(result.products.map(({ name, status, reason }) => [name, { status, reason }]));
    expect(states(pack().result)).toMatchObject({
      'knowledge-graph': { status: 'not-run' },
      semantics: { status: 'not-shown', reason: 'there is no knowledge graph to hold it' },
      tour: { status: 'not-shown', reason: 'there is no knowledge graph to hold it' },
    });
    writeProduct(project.root, 'tour.json', '{');
    expect(states(pack().result).tour).toMatchObject({ status: 'unreadable', reason: expect.stringMatching(/tour\.json is not valid JSON/) });
  });

  it('judges a graph whose body the store refuses as unreadable where every product is judged, so the domain graph is not compared with it', () => {
    writeGraph();
    const path = join(project.root, '.excavator', 'knowledge-graph.jsonl');
    writeProduct(project.root, 'knowledge-graph.jsonl', `${readFileSync(path, 'utf-8')}{"record":"mystery"}\n`);
    writeProduct(project.root, 'domain-graph.json', domainGraph({ sourceRevision: project.revision, factDigest: DIGEST }));
    const { entries } = collectProducts(join(project.root, '.excavator'), project.revision);
    const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry]));
    expect(byName['knowledge-graph']).toMatchObject({ status: 'unreadable', reason: expect.stringMatching(/unknown record type/) });
    expect(byName['domain-graph'].status).toBe('unreadable');
  });

  it('reports a semantic graph that fails its own checks as unreadable with its own reason, whatever happened to the knowledge graph', () => {
    const graphs = {
      'no graph': () => rmSync(join(project.root, '.excavator', 'knowledge-graph.jsonl'), { force: true }),
      'a refused header': () => writeProduct(project.root, 'knowledge-graph.jsonl', 'not a header\n'),
      'a refused body': () => {
        writeGraph();
        const path = join(project.root, '.excavator', 'knowledge-graph.jsonl');
        writeProduct(project.root, 'knowledge-graph.jsonl', `${readFileSync(path, 'utf-8')}{"record":"mystery"}\n`);
      },
      'a readable graph': () => writeGraph(),
    };
    writeProduct(project.root, 'source-manifest.json', sourceManifest(project.revision, []));
    writeProduct(project.root, 'semantic-cache.json', semanticCache({}));
    writeProduct(project.root, 'semantic-graph.json', JSON.stringify({ ...semanticGraph({ factDigest: DIGEST }), layers: undefined }));
    const seen = Object.fromEntries(Object.entries(graphs).map(([name, write]) => {
      write();
      const semantics = pack().result.products.find((p) => p.name === 'semantics');
      return [name, { status: semantics.status, reason: semantics.reason }];
    }));
    for (const name of Object.keys(graphs)) {
      expect(seen[name], name).toEqual({ status: 'unreadable', reason: 'semantic-graph.json is missing the top-level key(s): layers' });
    }
  });

  it('names the two keys no product produces', () => {
    writeGraph();
    const rows = pack().manifest.rows.filter((row) => row.status === 'not-produced');
    expect(rows.map((row) => row.key)).toEqual(['diff-overlay.json', 'config.json']);
  });
});

describe('the unused-code, hotspots and doc-map products', () => {
  const OTHER_REVISION = `git:${'1'.repeat(40)}`;
  const CHECKS = { checks: [{ document: 'a.md', unit: 'a-1', verdict: 'confirmed' }] };
  const stateOf = (data, name) => data['products.json'].products.find((item) => item.name === name);

  it('passes each product through as written when it is included, with its state', () => {
    writeGraph();
    const unused = unusedProduct(project.revision);
    const hotspots = hotspotsProduct(project.revision);
    const docMap = docMapProduct(project.revision);
    writeProduct(project.root, 'unused-code.json', unused);
    writeProduct(project.root, 'hotspots.json', hotspots);
    writeProduct(project.root, 'doc-map.json', docMap);
    writeProduct(project.root, 'doc-map/checks.json', CHECKS);
    const { data, manifest } = pack();
    expect(Object.keys(data)).toEqual(['knowledge-graph.json', 'staleness.json', 'unused-code.json', 'hotspots.json', 'doc-map.json', 'doc-map-checks.json', 'products.json', 'sources']);
    expect(data['unused-code.json']).toEqual(unused);
    expect(data['hotspots.json']).toEqual(hotspots);
    expect(data['doc-map.json']).toEqual(docMap);
    expect(data['doc-map-checks.json']).toEqual(CHECKS);
    expect(data['products.json'].snapshotRevision).toBe(project.revision);
    expect(data['products.json'].products.map((item) => item.name)).toEqual(['unused-code', 'hotspots', 'doc-map']);
    for (const item of data['products.json'].products) {
      expect(Object.keys(item)).toEqual(['name', 'status', 'reason', 'revision', 'revisionNote', 'command']);
      expect(item).toMatchObject({ status: 'included', reason: null, revision: project.revision });
    }
    expect(stateOf(data, 'unused-code').command).toBe('/excavator-unused-code');
    expect(stateOf(data, 'hotspots').command).toBe('/excavator-hotspots');
    expect(stateOf(data, 'doc-map').command).toBe('/excavator-doc-map');
    for (const key of ['unused-code.json', 'hotspots.json', 'doc-map.json', 'doc-map-checks.json', 'products.json']) {
      expect(manifest.rows.find((row) => row.key === key)).toMatchObject({ status: 'included' });
    }
  });

  it('gives no content key and a not-run state for a product that was not produced, and no checks without a doc map', () => {
    writeGraph();
    const { data, manifest } = pack();
    expect(Object.keys(data)).toEqual(['knowledge-graph.json', 'staleness.json', 'products.json', 'sources']);
    for (const name of ['unused-code', 'hotspots', 'doc-map']) {
      expect(stateOf(data, name)).toMatchObject({ status: 'not-run', reason: null, revision: null, command: `/excavator-${name}` });
      expect(manifest.rows.find((row) => row.key === `${name}.json`)).toEqual({ key: `${name}.json`, status: 'not-run', reason: `${name}.json was not produced` });
    }
    expect(manifest.rows.find((row) => row.key === 'doc-map-checks.json').status).toBe('unused');
  });

  it('gives no content key and the reason for a product that cannot be read', () => {
    writeGraph();
    writeProduct(project.root, 'unused-code.json', '{"format":"excavator-unused-code/1"}');
    writeProduct(project.root, 'hotspots.json', 'not json');
    writeProduct(project.root, 'doc-map.json', docMapProduct(project.revision));
    writeProduct(project.root, 'doc-map/checks.json', '{}');
    const { data, manifest } = pack();
    expect(Object.keys(data)).toEqual(['knowledge-graph.json', 'staleness.json', 'products.json', 'sources']);
    expect(stateOf(data, 'unused-code')).toMatchObject({ status: 'unreadable', reason: expect.stringMatching(/missing the top-level key/) });
    expect(stateOf(data, 'hotspots')).toMatchObject({ status: 'unreadable', reason: expect.stringMatching(/hotspots\.json is not valid JSON/) });
    expect(stateOf(data, 'doc-map')).toMatchObject({ status: 'unreadable', reason: expect.stringMatching(/doc-map\/checks\.json is missing/) });
    expect(manifest.rows.find((row) => row.key === 'unused-code.json')).toMatchObject({ status: 'unreadable', reason: expect.stringMatching(/missing the top-level key/) });
    expect(manifest.rows.find((row) => row.key === 'doc-map-checks.json').status).toBe('unused');
  });

  it('keeps the content of a product made from another revision and records both revisions', () => {
    writeGraph();
    const unused = unusedProduct(OTHER_REVISION);
    writeProduct(project.root, 'unused-code.json', unused);
    writeProduct(project.root, 'hotspots.json', hotspotsProduct(OTHER_REVISION));
    writeProduct(project.root, 'doc-map.json', docMapProduct(OTHER_REVISION));
    writeProduct(project.root, 'doc-map/checks.json', CHECKS);
    const { data, manifest } = pack();
    expect(data['unused-code.json']).toEqual(unused);
    expect(data['hotspots.json']).toBeDefined();
    expect(data['doc-map.json']).toBeDefined();
    expect(data['doc-map-checks.json']).toEqual(CHECKS);
    expect(stateOf(data, 'unused-code')).toMatchObject({ status: 'different-revision', revision: OTHER_REVISION });
    expect(manifest.rows.find((row) => row.key === 'unused-code.json')).toMatchObject({ status: 'different-revision' });
  });

  it('gives a doc map without checks.json no checks key, and says so', () => {
    writeGraph();
    writeProduct(project.root, 'doc-map.json', docMapProduct(project.revision));
    const { data, manifest } = pack();
    expect(data['doc-map.json']).toBeDefined();
    expect(data['doc-map-checks.json']).toBeUndefined();
    expect(manifest.rows.find((row) => row.key === 'doc-map-checks.json')).toEqual({ key: 'doc-map-checks.json', status: 'not-run', reason: 'doc-map/checks.json was not produced' });
  });

  it('reports the size of each new key and packs the same bytes twice', () => {
    writeGraph();
    writeProduct(project.root, 'unused-code.json', unusedProduct(project.revision));
    const first = pack();
    expect(first.result.keys['unused-code.json']).toBe(Buffer.byteLength(JSON.stringify(first.data['unused-code.json'])));
    expect(first.result.keys['products.json']).toBe(Buffer.byteLength(JSON.stringify(first.data['products.json'])));
    expect(pack().html).toBe(first.html);
  });
});

describe('the freshness report', () => {
  const OTHER_REVISION = `git:${'f'.repeat(40)}`;
  const writeManifestAt = (revision) => writeProduct(project.root, 'source-manifest.json', sourceManifest(revision, [{ path: 'src/a.js', contentHash: '1'.repeat(64) }]));
  const fresh = () => ({ status: 'fresh', graphCommitHash: project.revision, headCommitHash: project.revision, changedFileCount: 0, changedFiles: [], commitsBehind: 0, commitsAhead: 0 });

  it('says a graph made from the packed revision is fresh, for the knowledge and the domain graph', () => {
    writeGraph();
    writeManifestAt(project.revision);
    writeProduct(project.root, 'domain-graph.json', domainGraph({ sourceRevision: project.revision, factDigest: DIGEST }));
    const { data, manifest } = pack();
    expect(data['staleness.json']).toEqual({ graphs: { knowledge: fresh(), domain: fresh() } });
    expect(manifest.rows.find((row) => row.key === 'staleness.json')).toEqual({ key: 'staleness.json', status: 'included', reason: 'knowledge graph: same revision; domain graph: same revision' });
  });

  it('names the revision a graph was made from when it is not the packed one, and says when a graph records none', () => {
    writeGraph();
    writeManifestAt(OTHER_REVISION);
    writeProduct(project.root, 'domain-graph.json', domainGraph({ sourceRevision: project.revision, factDigest: DIGEST }));
    expect(pack().data['staleness.json']).toEqual({ graphs: {
      knowledge: { status: 'revision', graphRevision: OTHER_REVISION, currentRevision: project.revision },
      domain: fresh(),
    } });

    rmSync(join(project.root, '.excavator', 'source-manifest.json'));
    rmSync(join(project.root, '.excavator', 'domain-graph.json'));
    const { data, manifest } = pack();
    expect(data['staleness.json']).toEqual({ graphs: { knowledge: { status: 'revision', graphRevision: null, currentRevision: project.revision } } });
    expect(manifest.rows.find((row) => row.key === 'staleness.json').reason).toBe('knowledge graph: no revision recorded');
  });

  it('writes no report without a knowledge graph', () => {
    const { data, manifest } = pack();
    expect(data['staleness.json']).toBeUndefined();
    expect(manifest.rows.find((row) => row.key === 'staleness.json')).toEqual({ key: 'staleness.json', status: 'unused', reason: 'there is no knowledge graph to compare' });
  });
});

describe('the source table', () => {
  it('holds the embedded files in the shape the code viewer reads', () => {
    writeGraph();
    const { data, result } = pack();
    const text = FILES['src/a.js'];
    expect(data.sources['src/a.js']).toEqual({ path: 'src/a.js', content: text, sizeBytes: Buffer.byteLength(text), lineCount: 3 });
    expect(Object.keys(data.sources)).toEqual(['src/a.js', 'src/b.js']);
    expect(result.source.counts.embedded).toBe(2);
  });

  it('counts bytes, not characters, and gives no language of its own', () => {
    writeGraph(graph({ nodes: [...graph().nodes, node('file:src/é.js', 'file', 'é.js', { filePath: 'src/é.js' })] }));
    const { data } = pack();
    expect(data.sources['src/é.js'].sizeBytes).toBe(Buffer.byteLength(FILES['src/é.js']));
    expect(Object.keys(data.sources['src/a.js'])).not.toContain('language');
  });

  it('is left out under --no-source', () => {
    writeGraph();
    const { data, manifest } = pack({ noSource: true });
    expect('sources' in data).toBe(false);
    expect(manifest.rows.find((row) => row.key === 'sources')).toMatchObject({ status: 'not-embedded', reason: expect.stringMatching(/not to embed/) });
    expect(data['knowledge-graph.json'].nodes).toHaveLength(4);
  });

  it('is left out when no referenced file can be embedded', () => {
    writeGraph(graph({ nodes: [node('file:gone.js', 'file', 'gone.js', { filePath: 'gone.js' })], edges: [], layers: [], tour: [] }));
    const { data, manifest } = pack();
    expect('sources' in data).toBe(false);
    expect(manifest.rows.find((row) => row.key === 'sources').reason).toMatch(/no referenced file/);
  });
});

describe('the issue count is the copy\'s own', () => {
  it('counts what the copy\'s validateGraph reports, grouped by level and category', () => {
    writeGraph();
    const { result, manifest } = pack();
    expect(result.issues.total).toBeGreaterThan(0);
    // The `reexports` edge is an edge type the copy does not know; the `mentions` edges it knows (design D4b).
    expect(result.issues.byKind).toEqual({ 'dropped:invalid-edge': 1 });
    expect(Object.values(result.issues.byKind).reduce((sum, n) => sum + n, 0)).toBe(result.issues.total);
    expect(manifest.issues).toEqual(result.issues);
  });

  it('is zero for a graph the copy accepts as it is', () => {
    writeGraph(graph({ edges: graph().edges.filter((e) => e.type !== 'reexports') }));
    expect(pack().result.issues).toEqual({ total: 0, byKind: {}, fatal: null });
  });

  it('counts a refusal as an issue, so it never reads as zero', () => {
    writeGraph(graph({ project: { name: 'no languages' } }));
    const { issues } = pack().result;
    expect(issues.total).toBe(1);
    expect(issues.fatal).toBe('Missing or invalid project metadata');
    expect(issues.byKind).toEqual({ fatal: 1 });
  });

  it('does not change the graph it counts', () => {
    writeGraph();
    const { data, result } = pack();
    expect(data['knowledge-graph.json']).toEqual(graph());
    expect(result.keys['knowledge-graph.json']).toBe(Buffer.byteLength(JSON.stringify(graph())));
  });
});

describe('the explorer page', () => {
  it('has the policy and the template\'s other bytes unchanged', () => {
    writeGraph();
    const { html } = pack();
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">`);
    const rest = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '<!-- xv:csp -->').replace(/<script type="application\/json" id="xv-explorer-data">[\s\S]*<script type="application\/json" id="xv-explorer-manifest">[^<]*<\/script>/, '<!-- xv:data -->');
    expect(rest).toBe(FIXTURE_TEMPLATE);
  });

  it('writes every < of the data as an escape, so no content can close the element', () => {
    writeGraph(graph({ nodes: [node('file:src/a.js', 'file', '</script><b>', { filePath: 'src/a.js' })], edges: [], layers: [], tour: [] }));
    const { html, data } = pack();
    expect(BLOCK('xv-explorer-data').exec(html)[1]).not.toContain('<');
    expect(data['knowledge-graph.json'].nodes[0].name).toBe('</script><b>');
  });

  it('exposes the data object on the page global the copy reads, with every key an own property', () => {
    const odd = makeGitProject(Object.fromEntries([['__proto__', 'x = 1;\n'], ['src/a.js', 'a\n']]));
    try {
      const { path } = writeTemplate();
      writeGraphTo(odd.root, graph({ nodes: [node('file:__proto__', 'file', '__proto__', { filePath: '__proto__' })], edges: [], layers: [], tour: [] }));
      const result = packProject(odd.root, { explorerTemplate: path });
      const html = readFileSync(result.out, 'utf-8');
      const script = /<script>(window\.__EXCAVATOR_EXPLORER_DATA__=[^<]*)<\/script>/.exec(html)[1];
      const dataText = BLOCK('xv-explorer-data').exec(html)[1];
      const window = {};
      vm.runInNewContext(script, { window, JSON, document: { getElementById: (id) => (id === 'xv-explorer-data' ? { textContent: dataText } : null) } });
      expect(Object.hasOwn(window.__EXCAVATOR_EXPLORER_DATA__.sources, '__proto__')).toBe(true);
    } finally {
      odd.cleanup();
    }
  });

  it('reports each key\'s size in bytes in the result', () => {
    writeGraph();
    const { result, data } = pack();
    expect(Object.keys(result.keys)).toEqual(Object.keys(data));
    expect(result.keys.sources).toBe(Buffer.byteLength(JSON.stringify(data.sources)));
    expect(result.bytes).toBe(readFileSync(result.out).length);
  });
});

describe('a template or validator that was not built', () => {
  let scratch;
  beforeEach(() => { scratch = mkdtempSync(join(tmpdir(), 'xv-explorer-unbuilt-')); });
  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

  it('writes no page when the explorer template is missing, and says to build', () => {
    writeGraph();
    expect(() => packProject(project.root, { explorerTemplate: join(scratch, 'explorer.html') })).toThrow(/the explorer template .* does not exist: run `pnpm build`/);
    expect(existsSync(join(project.root, '.excavator', 'explorer.html'))).toBe(false);
  });

  it('writes no page when the validator is missing, and says to build', () => {
    writeGraph();
    expect(() => packProject(project.root, { explorerTemplate: templatePath, explorerValidator: join(scratch, 'schema.cjs') })).toThrow(/the explorer validator .* does not exist: run `pnpm build`/);
    expect(existsSync(join(project.root, '.excavator', 'explorer.html'))).toBe(false);
  });
});
