import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { packProject } from '../../../skills/excavator-view/pack.mjs';
import { collectProducts } from '../../../skills/excavator-view/products.mjs';
import { factGraphJsonl, makeGitProject, semanticCache, semanticEntry, semanticGraph, sourceManifest, writeProduct } from './fixture.mjs';
import { explorerPage } from './page.mjs';
import { writeTemplate } from './plugin-fixture.mjs';

const DIGEST = 'a'.repeat(64);
const OTHER_DIGEST = 'b'.repeat(64);
const CONTRADICTED_TEXT = 'Opens a socket to the billing service and retries forever.';

// Nodes of two files; the manifest records the content hash each file has now.
const NODES = [
  { id: 'file:src/a.js', filePath: 'src/a.js' },
  { id: 'function:src/a.js:run', filePath: 'src/a.js' },
  { id: 'file:src/b.js', filePath: 'src/b.js' },
  { id: 'function:src/b.js:load', filePath: 'src/b.js' },
];
const HASH_A = '1'.repeat(64);
const HASH_B = '2'.repeat(64);

let project;
let templateDir;
let templatePath;
beforeAll(() => {
  project = makeGitProject();
  ({ dir: templateDir, path: templatePath } = writeTemplate());
});
afterAll(() => {
  project.cleanup();
  rmSync(templateDir, { recursive: true, force: true });
});
beforeEach(() => rmSync(join(project.root, '.excavator'), { recursive: true, force: true }));

/** Write the graph and the source manifest, then the semantic cache and graph given; entries are { id: entry fields }. */
function writeFull({ entries, cache = {}, layers, graphDigest = DIGEST, layerDigest = DIGEST, graph = true } = {}) {
  writeProduct(project.root, 'knowledge-graph.jsonl', factGraphJsonl({ factsDigest: graphDigest, nodes: NODES }));
  writeProduct(project.root, 'source-manifest.json', sourceManifest(project.revision, [
    { path: 'src/a.js', contentHash: HASH_A },
    { path: 'src/b.js', contentHash: HASH_B },
  ]));
  writeProduct(project.root, 'semantic-cache.json', semanticCache(Object.fromEntries(Object.entries(entries ?? {}).map(([id, fields]) => [id, semanticEntry(fields)])), cache));
  if (graph) writeProduct(project.root, 'semantic-graph.json', semanticGraph({ factDigest: layerDigest, layers: layers ?? [] }));
}

// The entry and the bytes the packer read for the semantic files (the page's node summaries are made from them), and the packed page.
const pack = () => {
  const result = packProject(project.root, { explorerTemplate: templatePath });
  const html = readFileSync(result.out, 'utf-8');
  const products = collectProducts(join(project.root, '.excavator'), project.revision);
  return { result, html, ...explorerPage(html), product: products.entries.find((p) => p.name === 'semantics'), payloads: products.payloads };
};
const payloadIds = (packed) => packed.payloads.map((p) => p.id);
const payloadText = (packed, id) => packed.payloads.find((p) => p.id === id)?.bytes.toString('utf-8') ?? null;
const payloadOf = (packed) => JSON.parse(payloadText(packed, 'semantics'));

describe('semantics product', () => {
  it('is not run, with the full-mode command, when there is no semantic-cache.json, and the graph is still included', () => {
    writeProduct(project.root, 'knowledge-graph.jsonl', factGraphJsonl({ factsDigest: DIGEST, nodes: NODES }));
    const packed = pack();
    expect(packed.product).toMatchObject({ status: 'not-run', command: '/excavator --full', payloads: [] });
    expect(packed.manifest.products.find((p) => p.name === 'knowledge-graph').status).toBe('included');
    expect(payloadIds(packed)).toEqual(['knowledge-graph']);
  });

  it('inlines fresh entries with only id, summary, tags and verification, and notes that it records no revision', () => {
    writeFull({
      entries: {
        'file:src/a.js': { summary: 'Entry point of the app.', tags: ['entry'], semanticSourceHash: HASH_A, verification: 'verified' },
        'function:src/b.js:load': { summary: 'Loads the data.', tags: ['io', 'data'], semanticSourceHash: HASH_B },
      },
      layers: [{ id: 'layer:core', name: 'Core', description: 'The core.', nodeIds: ['file:src/a.js', 'file:src/b.js'] }],
    });
    const packed = pack();
    expect(packed.product).toMatchObject({ status: 'included', revisionNote: 'no revision recorded', payloads: ['semantics'] });
    expect(payloadIds(packed)).toEqual(['knowledge-graph', 'semantics']);
    expect(payloadOf(packed)).toEqual({
      entries: [
        { id: 'file:src/a.js', summary: 'Entry point of the app.', tags: ['entry'], verification: 'verified' },
        { id: 'function:src/b.js:load', summary: 'Loads the data.', tags: ['io', 'data'] },
      ],
      layers: [{ id: 'layer:core', name: 'Core', description: 'The core.', nodeIds: ['file:src/a.js', 'file:src/b.js'] }],
    });
    const text = payloadText(packed, 'semantics');
    expect(text).not.toMatch(/semanticSourceHash|languageAudit/);
    expect(text).not.toContain(HASH_A);
    expect(packed.result.products.find((p) => p.name === 'semantics').status).toBe('included');
    expect(packed.manifest.products.find((p) => p.name === 'semantics')).toEqual({ name: 'semantics', status: 'included' });
    // The page holds neither the hashes nor the audit, and the node of an entry carries the entry's summary.
    expect(packed.html).not.toMatch(/semanticSourceHash|languageAudit/);
    expect(packed.data['knowledge-graph.json'].nodes.find((n) => n.id === 'file:src/a.js').summary).toBe('Entry point of the app.');
  });

  it('leaves out an entry that is not fresh and counts it: another hash, a node the graph lacks, a file the manifest lacks', () => {
    writeFull({
      entries: {
        'file:src/a.js': { summary: 'Fresh.', semanticSourceHash: HASH_A },
        'function:src/a.js:run': { summary: 'Written for older source.', semanticSourceHash: '9'.repeat(64) },
        'function:src/gone.js:x': { summary: 'For a node that is not in the graph.', semanticSourceHash: HASH_A },
        'file:src/b.js': { summary: 'Also fresh.', semanticSourceHash: HASH_B },
      },
    });
    const packed = pack();
    expect(payloadOf(packed).entries.map((e) => e.id)).toEqual(['file:src/a.js', 'file:src/b.js']);
    expect(packed.product.counts).toMatchObject({ entries: 2, stale: 2 });
    expect(payloadText(packed, 'semantics')).not.toContain('Written for older source.');
    expect(packed.html).not.toContain('Written for older source.');
  });

  it('keeps a contradicted entry\'s verdict and blanks its summary, so the text is nowhere in the page', () => {
    writeFull({
      entries: {
        'function:src/a.js:run': { summary: CONTRADICTED_TEXT, tags: ['network'], semanticSourceHash: HASH_A, verification: 'contradicted' },
        'file:src/a.js': { summary: 'Entry point.', semanticSourceHash: HASH_A, verification: 'verified' },
      },
    });
    const packed = pack();
    expect(payloadOf(packed).entries.find((e) => e.id === 'function:src/a.js:run')).toEqual({ id: 'function:src/a.js:run', summary: '', tags: ['network'], verification: 'contradicted' });
    expect(packed.html).not.toContain(CONTRADICTED_TEXT);
    expect(payloadText(packed, 'semantics')).not.toContain(CONTRADICTED_TEXT);
  });

  it('counts the inlined entries by verdict, with no verdict as unchecked, and the layers', () => {
    writeFull({
      entries: {
        'file:src/a.js': { summary: 'One.', semanticSourceHash: HASH_A, verification: 'verified' },
        'function:src/a.js:run': { summary: 'Two.', semanticSourceHash: HASH_A, verification: 'verified' },
        'file:src/b.js': { summary: 'Three.', semanticSourceHash: HASH_B, verification: 'unverified' },
        'function:src/b.js:load': { summary: CONTRADICTED_TEXT, semanticSourceHash: HASH_B, verification: 'contradicted' },
        'function:src/zzz.js:y': { summary: 'Stale.', semanticSourceHash: HASH_B },
      },
      layers: [{ id: 'l1', name: 'One', nodeIds: [] }, { id: 'l2', name: 'Two', nodeIds: [] }],
    });
    expect(pack().product.counts).toEqual({ entries: 4, stale: 1, byVerdict: { verified: 2, unverified: 1, contradicted: 1, unchecked: 0 }, layers: 2 });
    writeFull({ entries: { 'file:src/a.js': { summary: 'No verdict.', semanticSourceHash: HASH_A } } });
    expect(pack().product.counts.byVerdict).toEqual({ verified: 0, unverified: 0, contradicted: 0, unchecked: 1 });
    expect(payloadOf(pack()).entries[0]).not.toHaveProperty('verification');
  });

  it('is unreadable when the semantic graph\'s factDigest is not the knowledge graph\'s factsDigest, and names both', () => {
    writeFull({ entries: { 'file:src/a.js': { summary: 'x.', semanticSourceHash: HASH_A } }, layerDigest: OTHER_DIGEST });
    const packed = pack();
    expect(packed.product.status).toBe('unreadable');
    expect(packed.product.reason).toContain(DIGEST);
    expect(packed.product.reason).toContain(OTHER_DIGEST);
    expect(payloadIds(packed)).not.toContain('semantics');
  });

  it('is unreadable when the knowledge graph records no factsDigest but the semantic graph has one', () => {
    writeFull({ entries: {}, graphDigest: null });
    const packed = pack();
    expect(packed.product.status).toBe('unreadable');
    expect(packed.product.reason).toContain('not recorded');
  });

  it('is included without layers when there is no semantic graph', () => {
    writeFull({ entries: { 'file:src/a.js': { summary: 'x.', semanticSourceHash: HASH_A } }, graph: false });
    const packed = pack();
    expect(packed.product.status).toBe('included');
    expect(payloadOf(packed).layers).toEqual([]);
    expect(packed.product.counts.layers).toBe(0);
  });

  it('is unreadable when the cache is not in the English the viewer reads', () => {
    writeFull({ entries: { 'file:src/a.js': { summary: 'x.', semanticSourceHash: HASH_A } }, cache: { contentLanguage: 'fr' } });
    const packed = pack();
    expect(packed.product).toMatchObject({ status: 'unreadable', reason: expect.stringContaining('"fr"') });
    expect(payloadIds(packed)).not.toContain('semantics');
  });

  it('is unreadable when the cache has another schema version or is not JSON', () => {
    writeFull({ entries: {}, cache: { version: '1.0.0' } });
    expect(pack().product).toMatchObject({ status: 'unreadable', reason: expect.stringContaining('"1.0.0"') });
    writeProduct(project.root, 'semantic-cache.json', '{"entries": ');
    expect(pack().product.reason).toMatch(/semantic-cache\.json is not valid JSON/);
  });

  it('is unreadable when the semantic graph is not in English or lacks its layers', () => {
    writeFull({ entries: {} });
    writeProduct(project.root, 'semantic-graph.json', semanticGraph({ factDigest: DIGEST, extra: { contentLanguage: 'fr' } }));
    expect(pack().product.reason).toContain('semantic-graph.json');
    writeProduct(project.root, 'semantic-graph.json', { version: '2.0.0', contentLanguage: 'en', factDigest: DIGEST });
    expect(pack().product.reason).toMatch(/missing the top-level key\(s\): layers/);
  });

  it('says why when freshness cannot be judged without a source manifest, and is not shown without a readable graph', () => {
    writeFull({ entries: {} });
    rmSync(join(project.root, '.excavator', 'source-manifest.json'));
    expect(pack().product.reason).toMatch(/source-manifest\.json is missing/);
    writeFull({ entries: {} });
    writeProduct(project.root, 'knowledge-graph.jsonl', 'not a header\n');
    expect(pack().product).toMatchObject({ status: 'not-shown', reason: 'there is no knowledge graph to hold it' });
  });

  it('packs the same bytes twice', () => {
    writeFull({
      entries: {
        'function:src/b.js:load': { summary: 'b.', semanticSourceHash: HASH_B, verification: 'verified' },
        'file:src/a.js': { summary: 'a.', semanticSourceHash: HASH_A },
      },
      layers: [{ id: 'l', name: 'L', nodeIds: ['file:src/a.js'] }],
    });
    const first = pack().html;
    expect(pack().html).toBe(first);
    expect(payloadOf(pack()).entries.map((e) => e.id)).toEqual(['file:src/a.js', 'function:src/b.js:load']);
  });
});
