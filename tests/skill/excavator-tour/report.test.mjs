import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildTour, reportLines } from '../../../skills/excavator/tour-report.mjs';
import { sliceDraft } from '../../../skills/excavator/tour-slices.mjs';
import { recordRoundOne, settleTour } from '../../../skills/excavator/tour-verdicts.mjs';
import { OTHER_DIGEST, clearProducts, draftOf, makeGitProject, sourceLines, writeCandidatesFile, writeDraft, writeGraph, writeVerdicts } from './fixture.mjs';

const TOUR = join(process.cwd(), 'skills', 'excavator', 'tour.mjs');
const DIGEST = 'a'.repeat(64);

let project;
beforeAll(() => {
  project = makeGitProject({ 'a.go': sourceLines(10, 'a') });
});
afterAll(() => project.cleanup());
beforeEach(() => {
  clearProducts(project.root);
  writeCandidatesFile(project.root, project.revision, [{ id: 'file:a.go', filePath: 'a.go' }]);
});

const draft6 = () => {
  const draft = draftOf(6);
  draft.steps.forEach((step) => { step.description = `D${step.order} one. D${step.order} two. D${step.order} three.`; });
  return draft;
};
const readJson = (path) => JSON.parse(readFileSync(path, 'utf-8'));
const productPath = () => join(project.root, '.excavator', 'tour.json');

/**
 * Run both rounds on `draft`: `first` and `second` map a step order to its verdict rows ([[id, verdict], ...]);
 * a step with no rows gets `verified` for every sentence. `edits` replaces fields of the steps sent back.
 */
function settle({ draft = draft6(), first = {}, edits = {}, second = {} } = {}) {
  const located = writeDraft(project.root, draft);
  const one = sliceDraft(located, 1);
  for (const step of one.steps) writeVerdicts(located.tourDir, 1, step.order, first[step.order] ?? step.sentences.map((s) => [s.id, 'verified']));
  const rewrite = recordRoundOne(located.tourDir);
  if (rewrite.steps.length > 0) {
    for (const [order, fields] of Object.entries(edits)) Object.assign(draft.steps[order - 1], fields);
    writeDraft(project.root, draft);
    for (const step of sliceDraft(located, 2).steps) writeVerdicts(located.tourDir, 2, step.order, second[step.order] ?? step.sentences.map((s) => [s.id, 'verified']));
  }
  settleTour(located.tourDir);
  return located;
}

describe('buildTour', () => {
  it('stamps the source revision and the graph\'s facts digest, and carries the steps, sentences, removals and counts', () => {
    const located = settle({
      first: { 3: [['3.d1', 'contradicted', 'wrong'], ['3.d2', 'unverified'], ['3.d3', 'verified']] },
      edits: { 3: { description: 'Claim again. Fact two. Fact three.' } },
      second: { 3: [['3.d1', 'contradicted', 'still wrong'], ['3.d2', 'verified'], ['3.d3', 'unverified']] },
    });
    const product = buildTour(located);
    expect(Object.keys(product)).toEqual(['format', 'contentLanguage', 'sourceRevision', 'factDigest', 'steps', 'removed', 'gaps', 'counts']);
    expect(product).toMatchObject({ format: 'excavator-tour/1', contentLanguage: 'en', sourceRevision: project.revision, factDigest: DIGEST });
    expect(product.steps).toHaveLength(6);
    expect(product.steps[2]).toMatchObject({ order: 3, description: 'Fact two. Fact three.', nodeIds: ['file:a.go'] });
    expect(product.steps[2].sentences).toEqual([
      { id: '3.d1', kind: 'description', text: 'Fact two.', verdict: 'verified', reason: 'reason for 3.d2' },
      { id: '3.d2', kind: 'description', text: 'Fact three.', verdict: 'unverified', reason: 'reason for 3.d3' },
    ]);
    expect(product.removed).toEqual([{ step: 3, id: '3.d1', kind: 'description', text: 'Claim again.', verdict: 'contradicted', reason: 'still wrong', cause: 'contradicted' }]);
    expect(product.counts).toEqual({ steps: 6, sentences: 17, verified: 16, unverified: 1, contradicted: 0, unchecked: 0, removedSentences: 1, adviceLines: 0, removedSteps: 0 });
    expect(product.gaps).toEqual([]);
  });

  it('keeps no contradicted sentence in steps, and counts the steps removed whole', () => {
    const located = settle({
      first: { 5: [['5.d1', 'contradicted'], ['5.d2', 'contradicted'], ['5.d3', 'contradicted']], 2: [['2.d1', 'contradicted'], ['2.d2', 'verified'], ['2.d3', 'verified']] },
      edits: { 5: { description: 'R one. R two.' }, 2: { description: 'Fixed one. Fixed two.' } },
      second: { 5: [['5.d1', 'contradicted'], ['5.d2', 'contradicted']] },
    });
    const product = buildTour(located);
    expect(JSON.stringify(product.steps)).not.toContain('"contradicted"');
    expect(product.steps.map((step) => [step.order, step.originalOrder])).toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [5, 6]]);
    expect(product.counts).toMatchObject({ steps: 5, contradicted: 0, removedSentences: 2, removedSteps: 1 });
    expect(product.gaps).toEqual([]);
  });

  it('refuses a resolved tour that keeps a contradicted sentence in its steps', () => {
    const located = settle();
    const path = join(located.tourDir, 'resolved.json');
    const resolved = readJson(path);
    resolved.steps[0].sentences[0].verdict = 'contradicted';
    writeFileSync(path, JSON.stringify(resolved));
    expect(() => buildTour(located)).toThrow(/keeps 1 contradicted sentence\(s\) in its steps \(first: 1\.d1\)/);
  });

  it('recounts from the steps and does not trust the counts in resolved.json', () => {
    const located = settle();
    const path = join(located.tourDir, 'resolved.json');
    const resolved = readJson(path);
    resolved.counts = { steps: 99, sentences: 99, verified: 99, unverified: 99, contradicted: 99, unchecked: 99, removedSentences: 99, adviceLines: 99, removedSteps: 99 };
    writeFileSync(path, JSON.stringify(resolved));
    expect(buildTour(located).counts).toEqual({ steps: 6, sentences: 18, verified: 18, unverified: 0, contradicted: 0, unchecked: 0, removedSentences: 0, adviceLines: 0, removedSteps: 0 });
  });

  it('names fewer than five steps and unchecked sentences as gaps, and still writes the steps it has', () => {
    const rows = (order) => [[`${order}.d1`, 'contradicted'], [`${order}.d2`, 'contradicted'], [`${order}.d3`, 'contradicted']];
    const located = settle({
      first: { 2: rows(2), 3: rows(3), 4: [['4.d1', 'verified']] },
      edits: { 2: { description: 'x one. x two.' }, 3: { description: 'y one. y two.' } },
      second: { 2: [['2.d1', 'contradicted'], ['2.d2', 'contradicted']], 3: [['3.d1', 'contradicted'], ['3.d2', 'contradicted']] },
    });
    const product = buildTour(located);
    expect(product.steps).toHaveLength(4);
    expect(product.gaps.map((gap) => gap.kind)).toEqual(['few-steps', 'unchecked-sentences', 'verdict-problems']);
    expect(product.gaps[0]).toEqual({ kind: 'few-steps', reason: 'the tour has 4 step(s), fewer than 5', count: 4 });
    expect(product.gaps[1]).toMatchObject({ count: 2, samples: ['2.d2', '2.d3'] });
    expect(product.counts).toMatchObject({ steps: 4, unchecked: 2, removedSteps: 2 });
  });

  it('refuses when the graph, the source or the resolved file is not the one the run started from', () => {
    const located = settle();
    writeGraph(project.root, { paths: ['a.go'], factsDigest: OTHER_DIGEST });
    expect(() => buildTour(located)).toThrow(/candidates\.json was made from facts a{64} but knowledge-graph\.jsonl has b{64}/);
    writeCandidatesFile(project.root, 'git:0000000', [{ id: 'file:a.go', filePath: 'a.go' }]);
    expect(() => buildTour(located)).toThrow(/candidates\.json was made at git:0000000 but the source is now/);
    rmSync(join(located.tourDir, 'resolved.json'));
    expect(() => buildTour(located)).toThrow(/resolved\.json/);
  });
});

describe('the advice check of the product', () => {
  const zh = (...codePoints) => String.fromCharCode(...codePoints);
  const edited = (edit, language) => {
    const located = settle();
    const path = join(located.tourDir, 'resolved.json');
    const resolved = readJson(path);
    edit(resolved);
    if (language) resolved.contentLanguage = language;
    writeFileSync(path, JSON.stringify(resolved));
    return located;
  };

  it('counts the lines of the kept text that advise, and names them as a gap', () => {
    const product = buildTour(edited((resolved) => {
      resolved.steps[1].description = 'Fine one. You should split it. Fine three.';
      resolved.steps[2].title = 'Consider the router';
    }));
    expect(product.counts.adviceLines).toBe(2);
    expect(product.gaps).toEqual([{ kind: 'advisory-wording', reason: '2 line(s) of the tour use advisory wording', count: 2, samples: ['2.d2', '3 title'] }]);
  });

  it('is 0 for a tour that only says what the code does', () => {
    expect(buildTour(settle()).counts.adviceLines).toBe(0);
  });

  it('counts a Chinese hit in a zh product and not in an English one', () => {
    const edit = (resolved) => { resolved.steps[0].description = `One. abc${zh(0x5efa, 0x8bae)}def.`; };
    expect(buildTour(edited(edit, 'zh')).counts.adviceLines).toBe(1);
    expect(buildTour(edited(edit, 'en')).counts.adviceLines).toBe(0);
  });

  it('is the fifth reply line', () => {
    const lines = reportLines('/p/tour.json', { counts: { steps: 5, sentences: 10, verified: 10, unverified: 0, contradicted: 0, unchecked: 0, removedSentences: 0, adviceLines: 3, removedSteps: 0 } });
    expect(lines).toHaveLength(5);
    expect(lines[4]).toBe('advice check: 3 lines');
  });
});

describe('the report command', () => {
  const run = () => spawnSync(process.execPath, [TOUR, 'report', join(project.root, '.excavator', 'tour', 'draft.json')], { encoding: 'utf-8' });

  it('writes .excavator/tour.json, prints the five reply lines and nothing else, and leaves no temporary file', () => {
    settle({
      first: { 5: [['5.d1', 'contradicted'], ['5.d2', 'contradicted'], ['5.d3', 'contradicted']] },
      edits: { 5: { description: 'R one. R two.' } },
      second: { 5: [['5.d1', 'contradicted'], ['5.d2', 'contradicted']] },
    });
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.split('\n')).toEqual([
      productPath(),
      'steps: 5',
      'sentences: 15; verified: 15; unverified: 0; contradicted: 0; unchecked: 0',
      'removed: 2 sentences; 1 steps',
      'advice check: 0 lines',
      '',
    ]);
    expect(readdirSync(join(project.root, '.excavator')).filter((name) => name.includes('tmp'))).toEqual([]);
    expect(readJson(productPath()).counts.steps).toBe(5);
  });

  it('writes the same bytes twice', () => {
    settle();
    expect(run().status).toBe(0);
    const first = readFileSync(productPath());
    expect(run().status).toBe(0);
    expect(readFileSync(productPath()).equals(first)).toBe(true);
  });

  it('exits 1 with the reason and writes no product when the tour cannot be stamped', () => {
    settle();
    writeGraph(project.root, { paths: ['a.go'], factsDigest: OTHER_DIGEST });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('knowledge-graph.jsonl has');
    expect(() => readFileSync(productPath())).toThrow();
  });
});

describe('reportLines', () => {
  it('prints the path and the counts the product holds', () => {
    const counts = { steps: 7, sentences: 20, verified: 15, unverified: 3, contradicted: 0, unchecked: 2, removedSentences: 4, adviceLines: 2, removedSteps: 1 };
    expect(reportLines('/p/.excavator/tour.json', { counts })).toEqual([
      '/p/.excavator/tour.json',
      'steps: 7',
      'sentences: 20; verified: 15; unverified: 3; contradicted: 0; unchecked: 2',
      'removed: 4 sentences; 1 steps',
      'advice check: 2 lines',
    ]);
  });
});
