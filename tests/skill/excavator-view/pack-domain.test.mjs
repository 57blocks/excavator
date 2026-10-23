import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { packProject } from '../../../skills/excavator-view/pack.mjs';
import { domainGraph, factGraphJsonl, makeGitProject, writeProduct } from './fixture.mjs';
import { manifestOf, payloadIds, payloadText } from './page.mjs';
import { writeTemplate } from './plugin-fixture.mjs';

const DIGEST = 'a'.repeat(64);
const OTHER_DIGEST = 'b'.repeat(64);
const NODES = [
  { id: 'file:src/a.js', filePath: 'src/a.js' },
  { id: 'function:src/a.js:run', filePath: 'src/a.js' },
];

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

const writeGraph = (factsDigest = DIGEST) => writeProduct(project.root, 'knowledge-graph.jsonl', factGraphJsonl({ factsDigest, nodes: NODES }));
const writeDomain = (fields) => writeProduct(project.root, 'domain-graph.json', domainGraph({ sourceRevision: project.revision, factDigest: DIGEST, ...fields }));

const pack = () => {
  const result = packProject(project.root, { template: templatePath });
  const html = readFileSync(result.out, 'utf-8');
  return { result, html, product: manifestOf(html).products.find((p) => p.name === 'domain-graph') };
};

describe('domain graph product', () => {
  it('is not run, with the domain command, when there is no domain-graph.json', () => {
    writeGraph();
    const packed = pack();
    expect(packed.product).toMatchObject({ status: 'not-run', command: '/excavator-domain', file: 'domain-graph.json', payloads: [] });
    expect(payloadIds(packed.html)).toEqual(['knowledge-graph']);
  });

  it('includes a graph made at this revision from these facts, as its own payload of nodes, edges and gaps', () => {
    writeGraph();
    writeDomain();
    const packed = pack();
    expect(packed.product).toMatchObject({ status: 'included', revision: project.revision, reason: null, payloads: ['domain-graph'] });
    expect(packed.product.counts).toEqual({ domains: 2, flows: 2, steps: 4, crossDomain: 1 });
    expect(payloadIds(packed.html)).toEqual(['knowledge-graph', 'domain-graph']);
    const payload = JSON.parse(payloadText(packed.html, 'domain-graph'));
    expect(Object.keys(payload)).toEqual(['nodes', 'edges', 'gaps']);
    expect(payload.nodes).toHaveLength(8);
    expect(payload.edges).toHaveLength(7);
    expect(payload.gaps).toHaveLength(1);
    // The language audit, the project block and the empty layer and tour lists are not the page's to show.
    expect(payloadText(packed.html, 'domain-graph')).not.toMatch(/languageAudit|"project"|"tour"/);
    expect(packed.result.products.find((p) => p.name === 'domain-graph')).toMatchObject({ status: 'included', counts: { domains: 2, flows: 2, steps: 4, crossDomain: 1 } });
  });

  it('keeps the project block\'s description, and only that, as projectDescription when it is written', () => {
    writeGraph();
    writeDomain({ extra: { project: { name: 'fixture', languages: ['javascript'], frameworks: [], description: 'Bills customers and ships parcels.', analyzedAt: 'x' } } });
    const payload = JSON.parse(payloadText(pack().html, 'domain-graph'));
    expect(Object.keys(payload)).toEqual(['nodes', 'edges', 'gaps', 'projectDescription']);
    expect(payload.projectDescription).toBe('Bills customers and ships parcels.');
    expect(payloadText(pack().html, 'domain-graph')).not.toMatch(/"project"|analyzedAt/);
  });

  it('keeps every field of a step, so the page can list its nodeIds, unresolved ids, evidence and provenance', () => {
    writeGraph();
    writeDomain();
    const { nodes } = JSON.parse(payloadText(pack().html, 'domain-graph'));
    expect(nodes.find((n) => n.id === 'step:charge:capture')).toMatchObject({ nodeIds: ['function:src/a.js:run', 'function:src/gone.js:x'], unresolvedNodeIds: ['function:src/gone.js:x'], evidence: [{ file: 'src/a.js', line: 1, source: 'rule' }] });
    expect(nodes.find((n) => n.id === 'step:charge:receipt').provenance).toBe('inferred');
    expect(nodes.find((n) => n.id === 'domain:billing').domainMeta.entities).toEqual(['Invoice']);
  });

  it('writes the same bytes twice', () => {
    writeGraph();
    writeDomain();
    expect(payloadText(pack().html, 'domain-graph')).toBe(payloadText(pack().html, 'domain-graph'));
    expect(pack().html).toBe(pack().html);
  });

  it('is unreadable when the version is not 2.0.0, and says which version it found', () => {
    writeGraph();
    writeDomain({ extra: { version: '1.0.0' } });
    const { product, html } = pack();
    expect(product.status).toBe('unreadable');
    expect(product.reason).toContain('version "1.0.0"');
    expect(product.reason).toContain('version 2.0.0');
    expect(payloadIds(html)).toEqual(['knowledge-graph']);
  });

  it('is unreadable when the content language is not en, and names the language', () => {
    writeGraph();
    writeDomain({ extra: { contentLanguage: 'de' } });
    const { product } = pack();
    expect(product.status).toBe('unreadable');
    expect(product.reason).toContain('contentLanguage "de"');
  });

  it('is unreadable, naming the keys, when a required top-level field is missing', () => {
    writeGraph();
    writeProduct(project.root, 'domain-graph.json', { version: '2.0.0', contentLanguage: 'en', sourceRevision: project.revision });
    const { product } = pack();
    expect(product.status).toBe('unreadable');
    expect(product.reason).toMatch(/missing the top-level key\(s\): nodes, edges, factDigest/);
  });

  it('is unreadable when a record is not usable, and says which one', () => {
    writeGraph();
    writeDomain({ extra: { nodes: [{ id: 'domain:a', type: 'domain', name: 'A' }, { id: 7, type: 'step', name: 'B' }] } });
    expect(pack().product.reason).toMatch(/nodes\[1\] has no string id/);
    writeDomain({ extra: { edges: [{ source: 'a', target: 'b' }] } });
    expect(pack().product.reason).toMatch(/edges\[0\] has no string type/);
  });

  it('is unreadable when the file is not JSON', () => {
    writeGraph();
    writeProduct(project.root, 'domain-graph.json', '{ not json');
    expect(pack().product).toMatchObject({ status: 'unreadable', reason: expect.stringMatching(/domain-graph\.json is not valid JSON/) });
  });

  it('is unreadable, and says why, when the knowledge graph cannot be read to compare the facts digest with', () => {
    writeDomain();
    const { product, html } = pack();
    expect(product.status).toBe('unreadable');
    expect(product.reason).toMatch(/knowledge-graph\.jsonl is not readable.*cannot be compared/);
    expect(payloadIds(html)).toEqual([]);
  });

  it('is a different revision when its sourceRevision is not the snapshot\'s, and keeps the graph', () => {
    writeGraph();
    writeDomain({ sourceRevision: 'git:0123456789abcdef' });
    const { product, html } = pack();
    expect(product).toMatchObject({ status: 'different-revision', revision: 'git:0123456789abcdef', payloads: ['domain-graph'] });
    expect(payloadIds(html)).toEqual(['knowledge-graph', 'domain-graph']);
  });

  it('is a different revision when its factDigest is not the graph\'s factsDigest, and writes both values', () => {
    writeGraph(OTHER_DIGEST);
    writeDomain();
    const { product } = pack();
    expect(product.status).toBe('different-revision');
    expect(product.revision).toBe(project.revision);
    expect(product.reason).toContain(DIGEST);
    expect(product.reason).toContain(OTHER_DIGEST);
    expect(product.payloads).toEqual(['domain-graph']);
  });

  it('says so when the graph records no facts digest at all', () => {
    writeProduct(project.root, 'knowledge-graph.jsonl', factGraphJsonl({ nodes: NODES }));
    writeDomain();
    const { product } = pack();
    expect(product.status).toBe('different-revision');
    expect(product.reason).toContain('not recorded');
  });

  it('does not call a graph with both keys equal a different revision', () => {
    writeGraph();
    writeDomain();
    expect(pack().product.status).toBe('included');
  });

  it('counts zero flows, steps and cross-domain edges for a graph that has none', () => {
    writeGraph();
    writeDomain({ extra: { nodes: [{ id: 'domain:a', type: 'domain', name: 'A' }], edges: [] } });
    expect(pack().product.counts).toEqual({ domains: 1, flows: 0, steps: 0, crossDomain: 0 });
  });

  it('embeds the source of a file only a step names, so the code drawer can open it', () => {
    writeGraph();
    const graph = domainGraph({ sourceRevision: project.revision, factDigest: DIGEST });
    graph.nodes.push({ id: 'step:charge:log', type: 'step', name: 'log', filePath: 'src/main.js', nodeIds: [], evidence: [{ file: 'src/other.js', line: 3, source: 'rule' }] });
    writeProduct(project.root, 'domain-graph.json', graph);
    const manifest = manifestOf(pack().html);
    expect(manifest.source.files['src/main.js']).toMatchObject({ bucket: 'embedded' });
    // A cited file the snapshot does not have is listed, and says so.
    expect(manifest.source.files['src/other.js']).toMatchObject({ bucket: 'notInSnapshot' });
  });
});
