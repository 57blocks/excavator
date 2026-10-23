/**
 * The tour product in the packed page (openspec: changes/viewer-learn, design D8;
 * spec "every product lands in a visible state"): `.excavator/tour.json` is not run,
 * unreadable (with the reason), a different revision (its factDigest is not the
 * knowledge graph's factsDigest; both are written down) or included, and its payload
 * keeps only what the Learn panel reads.
 */

import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { packProject } from '../../../skills/excavator-view/pack.mjs';
import { factGraphJsonl, makeGitProject, tourProduct, writeProduct } from './fixture.mjs';
import { manifestOf, payloadIds, payloadText } from './page.mjs';
import { writeTemplate } from './plugin-fixture.mjs';

const DIGEST = 'c'.repeat(64);
const OTHER_DIGEST = 'd'.repeat(64);
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
const writeTour = (fields = {}) => writeProduct(project.root, 'tour.json', tourProduct({ sourceRevision: project.revision, factDigest: DIGEST, ...fields }));

const pack = () => {
  const result = packProject(project.root, { template: templatePath });
  const html = readFileSync(result.out, 'utf-8');
  const manifest = manifestOf(html);
  return { result, html, manifest, product: manifest.products.find((p) => p.name === 'tour') };
};

describe('tour product', () => {
  it('is not run, with the tour command, when there is no tour.json', () => {
    writeGraph();
    const { product, html } = pack();
    expect(product).toMatchObject({ name: 'tour', label: 'Tour', status: 'not-run', reason: null, command: '/excavator-tour', file: 'tour.json', payloads: [] });
    expect(payloadIds(html)).toEqual(['knowledge-graph']);
  });

  it('sits after hotspots and before the reports in the manifest', () => {
    writeGraph();
    expect(pack().manifest.products.map((p) => p.name)).toEqual(['knowledge-graph', 'semantics', 'domain-graph', 'unused-code', 'doc-map', 'hotspots', 'tour', 'reports']);
  });

  it('is included when its factDigest is the graph\'s factsDigest, with both digests and its counts recorded', () => {
    writeGraph();
    writeTour();
    const { product, html, result } = pack();
    expect(product).toMatchObject({ status: 'included', reason: null, revision: project.revision, payloads: ['tour'] });
    expect(product.factDigests).toEqual({ tour: DIGEST, graph: DIGEST });
    expect(product.revisionNote).toContain(DIGEST);
    expect(product.counts).toEqual({ steps: 2, sentences: 4, byVerdict: { verified: 2, unverified: 1, unchecked: 1 }, removedSentences: 1 });
    expect(payloadIds(html)).toEqual(['knowledge-graph', 'tour']);
    expect(result.products.find((p) => p.name === 'tour')).toMatchObject({ status: 'included', counts: product.counts });
  });

  it('keeps only the steps, the removals, the gaps, the counts and the content language in the payload, as written', () => {
    writeGraph();
    writeTour({ extra: { candidatesNote: 'not for the page' } });
    const payload = JSON.parse(payloadText(pack().html, 'tour'));
    const written = tourProduct({ sourceRevision: project.revision, factDigest: DIGEST });
    expect(Object.keys(payload)).toEqual(['contentLanguage', 'steps', 'removed', 'gaps', 'counts']);
    expect(payload).toEqual({ contentLanguage: 'en', steps: written.steps, removed: written.removed, gaps: written.gaps, counts: written.counts });
    expect(payloadText(pack().html, 'tour')).not.toMatch(/excavator-tour\/1|sourceRevision|factDigest|candidatesNote/);
  });

  it('writes the same bytes twice', () => {
    writeGraph();
    writeTour();
    expect(pack().html).toBe(pack().html);
  });

  it('is a different revision when its factDigest is not the graph\'s factsDigest, and writes both values', () => {
    writeGraph(OTHER_DIGEST);
    writeTour();
    const { product, html } = pack();
    expect(product.status).toBe('different-revision');
    expect(product.factDigests).toEqual({ tour: DIGEST, graph: OTHER_DIGEST });
    expect(product.reason).toContain(DIGEST);
    expect(product.reason).toContain(OTHER_DIGEST);
    expect(product.revision).toBe(project.revision);
    expect(payloadIds(html)).toEqual(['knowledge-graph', 'tour']);
    // Its node ids may not match this graph: the page gets no steps and no removed sentences to show.
    const written = tourProduct({ sourceRevision: project.revision, factDigest: DIGEST });
    const payload = JSON.parse(payloadText(html, 'tour'));
    expect(Object.keys(payload)).toEqual(['contentLanguage', 'gaps', 'counts']);
    expect(payload).toEqual({ contentLanguage: 'en', gaps: written.gaps, counts: written.counts });
    expect(payloadText(html, 'tour')).not.toContain(written.steps[0].title);
    expect(payloadText(html, 'tour')).not.toContain(written.removed[0].text);
  });

  it('is a different revision, never assumed current, when the tour or the graph records no digest', () => {
    writeProduct(project.root, 'knowledge-graph.jsonl', factGraphJsonl({ nodes: NODES }));
    writeTour({ factDigest: null });
    const both = pack().product;
    expect(both.status).toBe('different-revision');
    expect(both.factDigests).toEqual({ tour: null, graph: null });
    expect(both.reason).toMatch(/cannot be compared/);

    writeGraph();
    writeTour({ factDigest: null });
    expect(pack().product).toMatchObject({ status: 'different-revision', factDigests: { tour: null, graph: DIGEST } });
  });

  it('is unreadable when the file is not JSON', () => {
    writeGraph();
    writeProduct(project.root, 'tour.json', '{ not json');
    const { product, html } = pack();
    expect(product).toMatchObject({ status: 'unreadable', reason: expect.stringMatching(/tour\.json is not valid JSON/), payloads: [] });
    expect(payloadIds(html)).toEqual(['knowledge-graph']);
  });

  it('is unreadable when its format is not excavator-tour/1, and says which format it found', () => {
    writeGraph();
    writeTour({ extra: { format: 'excavator-tour/2' } });
    const { product, html } = pack();
    expect(product.status).toBe('unreadable');
    expect(product.reason).toContain('format "excavator-tour/2"');
    expect(product.reason).toContain('excavator-tour/1');
    expect(payloadIds(html)).toEqual(['knowledge-graph']);
  });

  it('is unreadable, naming the keys, when a required top-level field is missing', () => {
    writeGraph();
    writeProduct(project.root, 'tour.json', { format: 'excavator-tour/1', contentLanguage: 'en', sourceRevision: project.revision, steps: [] });
    const { product } = pack();
    expect(product.status).toBe('unreadable');
    expect(product.reason).toMatch(/missing the top-level key\(s\): factDigest, removed, gaps, counts/);
  });

  it('is unreadable when a step or a removal is not usable, and says which one', () => {
    writeGraph();
    const written = tourProduct({ sourceRevision: project.revision, factDigest: DIGEST });
    writeTour({ extra: { steps: [written.steps[0], { ...written.steps[1], title: 7 }] } });
    expect(pack().product.reason).toMatch(/tour\.json steps\[1\] has no string title/);
    writeTour({ extra: { steps: [{ ...written.steps[0], sentences: [{ id: 'x', text: 'A.' }] }] } });
    expect(pack().product.reason).toMatch(/tour\.json steps\[0\]\.sentences\[0\] has no string verdict/);
    writeTour({ extra: { removed: ['gone'] } });
    expect(pack().product.reason).toMatch(/tour\.json removed\[0\] is not an object/);
  });

  it('is unreadable when its steps keep a contradicted sentence, which no tour may show', () => {
    writeGraph();
    const written = tourProduct({ sourceRevision: project.revision, factDigest: DIGEST });
    const step = { ...written.steps[0], sentences: [{ ...written.steps[0].sentences[0], verdict: 'contradicted' }] };
    writeTour({ extra: { steps: [step] } });
    const { product, html } = pack();
    expect(product.status).toBe('unreadable');
    expect(product.reason).toMatch(/1 contradicted sentence/);
    expect(payloadIds(html)).toEqual(['knowledge-graph']);
  });

  it('is unreadable when a kept sentence has a verdict the viewer does not know', () => {
    writeGraph();
    const written = tourProduct({ sourceRevision: project.revision, factDigest: DIGEST });
    const step = { ...written.steps[0], sentences: [{ ...written.steps[0].sentences[0], verdict: 'plausible' }] };
    writeTour({ extra: { steps: [step] } });
    const { product, html } = pack();
    expect(product.status).toBe('unreadable');
    expect(product.reason).toMatch(/sentence s1\.d1 has verdict "plausible"/);
    expect(payloadIds(html)).toEqual(['knowledge-graph']);
  });

  it('is unreadable, and says why, when the knowledge graph cannot be read to compare the digest with', () => {
    writeTour();
    const { product, html } = pack();
    expect(product.status).toBe('unreadable');
    expect(product.reason).toMatch(/knowledge-graph\.jsonl is not readable.*cannot be compared/);
    expect(payloadIds(html)).toEqual([]);
  });
});
