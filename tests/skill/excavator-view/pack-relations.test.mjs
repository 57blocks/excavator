/**
 * The relations product on the explorer page: one visible state (included, not run, unreadable, different revision),
 * judged against the snapshot's revision and the knowledge graph's factsDigest the way the domain graph is; its
 * coverage report packed beside it only when it comes from the same run; the files of its sites embedded; its state
 * in the reply's product line.
 */

import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { GRAPH_FORMAT } from '../../../skills/excavator-relations/merge-relations.mjs';
import { packProject } from '../../../skills/excavator-view/pack.mjs';
import { collectProducts } from '../../../skills/excavator-view/products.mjs';
import { replyLines } from '../../../skills/excavator-view/reply.mjs';
import { factGraphJsonl, makeGitProject, relationsCoverage, relationsGraph, writeProduct } from './fixture.mjs';
import { explorerPage } from './page.mjs';
import { writeTemplate } from './plugin-fixture.mjs';

const DIGEST = 'a'.repeat(64);
const OTHER_DIGEST = 'b'.repeat(64);
const FILES = {
  'web/src/orders.js': "export const load = () => fetch('/orders');\n",
  'web/src/config.js': 'const base = "/";\n',
  'api/src/routes.js': "app.get('/orders', list);\n",
  'worker/src/mail.js': 'mailer.send(receipt);\n',
  'api/src/jobs.js': 'run();\n',
};

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

const writeGraph = (factsDigest = DIGEST) => writeProduct(project.root, 'knowledge-graph.jsonl', factGraphJsonl({ factsDigest, nodes: [{ id: 'file:web/src/orders.js', filePath: 'web/src/orders.js' }] }));
const writeRelations = (fields = {}) => writeProduct(project.root, 'relations-graph.json', relationsGraph({ format: GRAPH_FORMAT, sourceRevision: project.revision, factDigest: DIGEST, ...fields }));
const writeCoverage = (fields = {}) => writeProduct(project.root, 'reports/relations-coverage.json', relationsCoverage(fields));

const pack = (options = {}) => {
  const result = packProject(project.root, { explorerTemplate: templatePath, ...options });
  const html = readFileSync(result.out, 'utf-8');
  const products = collectProducts(join(project.root, '.excavator'), project.revision);
  return { result, html, ...explorerPage(html), product: products.entries.find((p) => p.name === 'relations'), payloads: products.payloads };
};
const payloadIds = (packed) => packed.payloads.map((p) => p.id);
const stateOnPage = (packed) => packed.data['products.json'].products.find((p) => p.name === 'relations');

describe('relations product', () => {
  it('is not run, with the relations command, when there is no relations-graph.json', () => {
    writeGraph();
    const packed = pack();
    expect(packed.product).toMatchObject({ name: 'relations', label: 'Relations', status: 'not-run', command: '/excavator-relations', file: 'relations-graph.json', payloads: [] });
    expect(packed.data).not.toHaveProperty('relations-graph.json');
    expect(stateOnPage(packed)).toMatchObject({ status: 'not-run', command: '/excavator-relations' });
  });

  it('includes a graph made at this revision from these facts, with its counts and the coverage report of the same run', () => {
    writeGraph();
    writeRelations();
    writeCoverage();
    const packed = pack();
    expect(packed.product).toMatchObject({ status: 'included', revision: project.revision, reason: null, payloads: ['relations', 'relations-coverage'] });
    expect(packed.product.counts).toEqual({ units: 3, relations: 6, linked: 2, externals: 1 });
    expect(packed.product.coverage).toEqual({ state: 'included', reason: null });
    expect(payloadIds(packed)).toEqual(['knowledge-graph', 'relations', 'relations-coverage']);
    const graph = packed.data['relations-graph.json'];
    expect(Object.keys(graph)).toEqual(['status', 'units', 'externals', 'relations', 'buckets', 'outOfScope', 'measurements']);
    expect(graph.relations).toHaveLength(6);
    expect(graph.relations[0].caller.evidence).toEqual([{ file: 'web/src/config.js', line: 1, quote: 'const base = "/"' }]);
    const coverage = packed.data['relations-coverage.json'];
    expect(coverage).not.toHaveProperty('token');
    expect(coverage.escalationCandidates).toEqual([{ kind: 'http', reasons: ['quote-failure'] }]);
    expect(coverage.files.rows).toHaveLength(4);
    expect(stateOnPage(packed)).toMatchObject({ status: 'included', coverage: { state: 'included', reason: null } });
  });

  it('keeps the graph and says why when the coverage report is absent, from another run, or unreadable', () => {
    writeGraph();
    writeRelations();
    expect(pack().product.coverage).toEqual({ state: 'not-run', reason: 'reports/relations-coverage.json was not produced' });
    writeCoverage({ inputDigest: 'z'.repeat(64) });
    let packed = pack();
    expect(packed.product.status).toBe('included');
    expect(packed.product.coverage.state).toBe('other-run');
    expect(packed.product.coverage.reason).toContain(`inputDigest ${'z'.repeat(64)}`);
    expect(packed.data).toHaveProperty('relations-graph.json');
    expect(packed.data).not.toHaveProperty('relations-coverage.json');
    writeProduct(project.root, 'reports/relations-coverage.json', '{ nope');
    packed = pack();
    expect(packed.product.coverage).toMatchObject({ state: 'unreadable', reason: expect.stringMatching(/relations-coverage\.json is not valid JSON/) });
    writeCoverage({ format: 'excavator-relations-coverage/0' });
    expect(pack().product.coverage).toMatchObject({ state: 'unreadable', reason: expect.stringContaining('"excavator-relations-coverage/0"') });
    expect(stateOnPage(pack()).coverage.state).toBe('unreadable');
  });

  it('is a different revision when its sourceRevision is not the snapshot\'s, and keeps the graph', () => {
    writeGraph();
    writeRelations({ sourceRevision: 'git:0123456789abcdef' });
    const packed = pack();
    expect(packed.product).toMatchObject({ status: 'different-revision', revision: 'git:0123456789abcdef', payloads: ['relations'] });
    expect(packed.data).toHaveProperty('relations-graph.json');
  });

  it('is a different revision when it records no sourceRevision, and says so', () => {
    writeGraph();
    writeRelations({ sourceRevision: null });
    const { product } = pack();
    expect(product.status).toBe('different-revision');
    expect(product.reason).toContain('records no sourceRevision');
  });

  it('is a different revision when its factDigest is not the graph\'s factsDigest, and writes both down', () => {
    writeGraph(OTHER_DIGEST);
    writeRelations();
    const { product } = pack();
    expect(product.status).toBe('different-revision');
    expect(product.reason).toContain(`factDigest is ${DIGEST}`);
    expect(product.reason).toContain(`factsDigest is ${OTHER_DIGEST}`);
  });

  it('is a different revision, and says why, when the knowledge graph cannot be read to compare its factDigest with', () => {
    writeRelations();
    const packed = pack();
    expect(packed.product.status).toBe('different-revision');
    expect(packed.product.reason).toMatch(/knowledge-graph\.jsonl is not readable.*cannot be compared/);
    expect(packed.data).toHaveProperty('relations-graph.json');
  });

  it('is judged on the source revision alone when it was made without a knowledge graph', () => {
    writeRelations({ factDigest: null });
    expect(pack().product).toMatchObject({ status: 'included', reason: null });
    writeGraph(OTHER_DIGEST);
    expect(pack().product).toMatchObject({ status: 'included', reason: null });
  });

  it('is unreadable when the format is not the one /excavator-relations writes, and names both', () => {
    writeGraph();
    writeRelations({ format: 'excavator-relations/0' });
    const packed = pack();
    expect(packed.product.status).toBe('unreadable');
    expect(packed.product.reason).toContain('"excavator-relations/0"');
    expect(packed.product.reason).toContain(GRAPH_FORMAT);
    expect(packed.data).not.toHaveProperty('relations-graph.json');
  });

  it('is unreadable, naming the keys, when a required top-level field is missing', () => {
    writeGraph();
    writeProduct(project.root, 'relations-graph.json', { format: GRAPH_FORMAT, sourceRevision: project.revision, factDigest: DIGEST, units: [] });
    expect(pack().product.reason).toMatch(/missing the top-level key\(s\): externals, relations, buckets, measurements/);
  });

  it('is unreadable when a record is not usable, and says which one', () => {
    writeGraph();
    writeRelations({ extra: { units: [{ id: 'unit:a', name: 'a' }, { id: 'unit:b' }] } });
    expect(pack().product.reason).toMatch(/units\[1\] has no string name/);
    writeRelations({ extra: { relations: [{ id: 'rel:1', kind: 'http' }] } });
    expect(pack().product.reason).toMatch(/relations\[0\] has no string bucket/);
  });

  it('is unreadable when the file is not JSON', () => {
    writeGraph();
    writeProduct(project.root, 'relations-graph.json', '{ not json');
    expect(pack().product).toMatchObject({ status: 'unreadable', reason: expect.stringMatching(/relations-graph\.json is not valid JSON/) });
  });

  it('embeds the files of its sites, their evidence and the coverage rows, so each one opens', () => {
    writeGraph();
    writeRelations();
    writeCoverage();
    const { data } = pack();
    for (const path of ['web/src/orders.js', 'web/src/config.js', 'api/src/routes.js', 'worker/src/mail.js', 'api/src/jobs.js']) {
      expect(data.sources[path]?.content).toBe(FILES[path]);
    }
  });

  it('writes the same bytes twice', () => {
    writeGraph();
    writeRelations();
    writeCoverage();
    expect(pack().html).toBe(pack().html);
  });

  it('is in the result and the reply\'s product line', () => {
    writeGraph();
    writeRelations();
    const packed = pack();
    expect(packed.result.products.find((p) => p.name === 'relations')).toMatchObject({ status: 'included', counts: { units: 3, relations: 6, linked: 2, externals: 1 } });
    expect(packed.manifest.products.map((p) => p.name)).toContain('relations');
    expect(replyLines('/x/p.html', 1, packed.manifest)[3]).toMatch(/; tour not run; relations included$/);
  });
});
