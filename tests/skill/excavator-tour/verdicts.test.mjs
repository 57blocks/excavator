import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { sliceDraft } from '../../../skills/excavator/tour-slices.mjs';
import { titleFromNames } from '../../../skills/excavator/tour-titles.mjs';
import { recordRoundOne, settleTour } from '../../../skills/excavator/tour-verdicts.mjs';
import { clearProducts, draftOf, makeGitProject, sourceLines, titled, writeCandidatesFile, writeDraft, writeVerdicts } from './fixture.mjs';

const TOUR = join(process.cwd(), 'skills', 'excavator', 'tour.mjs');

let project;
beforeAll(() => {
  project = makeGitProject({ 'a.go': sourceLines(10, 'a') });
});
afterAll(() => project.cleanup());
beforeEach(() => {
  clearProducts(project.root);
  writeCandidatesFile(project.root, project.revision, [{ id: 'file:a.go', filePath: 'a.go' }]);
});

/** A draft of 6 steps: step n has descriptions "Dn one. Dn two. Dn three." (ids n.d1..n.d3) unless `extra` says otherwise. */
const draft6 = (edit = () => {}) => {
  const draft = draftOf(6);
  draft.steps.forEach((step) => { step.description = `D${step.order} one. D${step.order} two. D${step.order} three.`; });
  edit(draft);
  return draft;
};
const ok = (order, n) => Array.from({ length: n }, (_, i) => [`${order}.d${i + 1}`, 'verified']);

/** Slice round 1 of `draft` and give every sentence of every step the verdict `all` unless `rows[order]` is given. */
function roundOne(draft, rows = {}, all = 'verified') {
  const located = writeDraft(project.root, draft);
  const index = sliceDraft(located, 1);
  for (const step of index.steps) {
    writeVerdicts(located.tourDir, 1, step.order, rows[step.order] ? titled(step.order, rows[step.order]) : step.sentences.map((s) => [s.id, all]));
  }
  return { located, index };
}
const readJson = (path) => JSON.parse(readFileSync(path, 'utf-8'));

describe('verdicts round 1', () => {
  it('lists the steps with a contradicted sentence, with the sentence and the reason, and counts the verdicts', () => {
    const { located } = roundOne(draft6(), {
      2: [['2.d1', 'contradicted', 'the code has no retry'], ['2.d2', 'unverified'], ['2.d3', 'verified']],
      5: [['5.d1', 'verified'], ['5.d2', 'verified'], ['5.d3', 'contradicted', 'wrong direction']],
    });
    const product = recordRoundOne(located.tourDir);
    expect(product.steps).toEqual([
      { order: 2, title: 'Step 2', contradicted: [{ id: '2.d1', text: 'D2 one.', reason: 'the code has no retry' }] },
      { order: 5, title: 'Step 5', contradicted: [{ id: '5.d3', text: 'D5 three.', reason: 'wrong direction' }] },
    ]);
    // Each step has its title and three description sentences: 24 in all.
    expect(product.counts).toEqual({ steps: 6, verified: 21, unverified: 1, contradicted: 2, unchecked: 0, sentBack: 2 });
    expect(readJson(join(located.tourDir, 'rewrite.json')).steps).toHaveLength(2);
  });

  it('sends nothing back when no sentence is contradicted', () => {
    const { located } = roundOne(draft6());
    expect(recordRoundOne(located.tourDir).steps).toEqual([]);
  });

  it('records a sentence with no verdict as unchecked, whether the sentence, the file or the JSON is missing', () => {
    const { located } = roundOne(draft6(), {
      1: [['1.d1', 'verified'], ['1.d2', 'verified']], // 1.d3 missing
      3: [],
    });
    rmSync(join(located.tourDir, 'verdicts', 'round-1', 'step-2.json'));
    writeFileSync(join(located.tourDir, 'verdicts', 'round-1', 'step-4.json'), '{ not json');
    const product = recordRoundOne(located.tourDir);
    // Step 1 lacks 1.d3, step 2 has no file (title and three sentences), step 3 has only its title, step 4 is not JSON.
    expect(product.counts).toMatchObject({ unchecked: 1 + 4 + 3 + 4, contradicted: 0 });
    expect(product.problems).toEqual([
      'step 1: sentence 1.d3 has no verdict',
      'step 2: no verdict file (verdicts/round-1/step-2.json)',
      'step 3: sentence 3.d1 has no verdict',
      'step 3: sentence 3.d2 has no verdict',
      'step 3: sentence 3.d3 has no verdict',
      expect.stringMatching(/^step 4: the verdict file is not valid JSON/),
    ]);
  });

  it('treats a verdict that is none of the three words, a duplicated id and a foreign id as no verdict', () => {
    const { located } = roundOne(draft6(), {
      1: [['1.d1', 'partial'], ['1.d2', 'verified'], ['1.d2', 'contradicted'], ['1.d3', 'verified'], ['9.d9', 'contradicted']],
    });
    const product = recordRoundOne(located.tourDir);
    expect(product.steps).toEqual([]);
    expect(product.problems.slice(0, 3)).toEqual([
      'step 1: a verdict names "9.d9", which is not a sentence of the step; ignored',
      'step 1: sentence 1.d1 has the verdict "partial", which is not one of verified, unverified, contradicted; discarded',
      'step 1: sentence 1.d2 has 2 verdict(s); all discarded'.replace('verdict(s)', 'verdicts'),
    ]);
    expect(product.counts).toMatchObject({ verified: 15 + 1 + 6, unchecked: 2 });
  });
});

describe('verdicts round 2', () => {
  /** Round 1 with `rows`, then the model rewrites the steps in `edits` ({ order: fields }) and round 2 is sliced and judged with `second`. */
  function twoRounds({ first, edits, second = {} }) {
    const draft = draft6();
    const { located } = roundOne(draft, first);
    recordRoundOne(located.tourDir);
    for (const [order, fields] of Object.entries(edits ?? {})) Object.assign(draft.steps[order - 1], fields);
    writeDraft(project.root, draft);
    const index = sliceDraft(located, 2);
    for (const step of index.steps) writeVerdicts(located.tourDir, 2, step.order, second[step.order] ? titled(step.order, second[step.order]) : step.sentences.map((s) => [s.id, 'verified']));
    return { located, resolved: settleTour(located.tourDir) };
  }

  it('keeps the rewritten text and records no removal when the rewrite passes', () => {
    const { resolved } = twoRounds({
      first: { 3: [['3.d1', 'verified'], ['3.d2', 'contradicted', 'no such call'], ['3.d3', 'verified']] },
      edits: { 3: { description: 'New one. New two.' } },
    });
    expect(resolved.removed).toEqual([]);
    expect(resolved.rewritten).toEqual([3]);
    expect(resolved.steps[2]).toMatchObject({ order: 3, originalOrder: 3, description: 'New one. New two.' });
    expect(resolved.steps[2].sentences).toEqual([
      { id: '3.t', kind: 'title', text: 'Step 3', verdict: 'verified', reason: 'reason for 3.t' },
      { id: '3.d1', kind: 'description', text: 'New one.', verdict: 'verified', reason: 'reason for 3.d1' },
      { id: '3.d2', kind: 'description', text: 'New two.', verdict: 'verified', reason: 'reason for 3.d2' },
    ]);
    expect(resolved.counts).toMatchObject({ steps: 6, removedSentences: 0, removedSteps: 0, contradicted: 0 });
  });

  it('removes a sentence that is contradicted twice, keeps the rest, and records the removal', () => {
    const { resolved } = twoRounds({
      first: { 3: [['3.d1', 'verified'], ['3.d2', 'contradicted'], ['3.d3', 'verified']] },
      edits: { 3: { description: 'Same claim. Other fact. Third fact.' } },
      second: { 3: [['3.d1', 'contradicted', 'still wrong'], ['3.d2', 'verified'], ['3.d3', 'unverified']] },
    });
    expect(resolved.removed).toEqual([{ step: 3, id: '3.d1', kind: 'description', text: 'Same claim.', verdict: 'contradicted', reason: 'still wrong', cause: 'contradicted' }]);
    expect(resolved.steps[2].description).toBe('Other fact. Third fact.');
    expect(resolved.steps[2].sentences.map((s) => [s.id, s.verdict])).toEqual([['3.t', 'verified'], ['3.d1', 'verified'], ['3.d2', 'unverified']]);
    expect(resolved.counts).toMatchObject({ steps: 6, sentences: 23, verified: 22, unverified: 1, removedSentences: 1, removedSteps: 0, replacedTitles: 0 });
    expect(JSON.stringify(resolved.steps)).not.toContain('Same claim');
  });

  it('removes a step whose description is all contradicted, renumbers the rest, and records every sentence', () => {
    const { resolved } = twoRounds({
      first: { 5: [['5.d1', 'contradicted'], ['5.d2', 'contradicted'], ['5.d3', 'contradicted']] },
      edits: { 5: { description: 'R one. R two.', languageLesson: 'A lesson about the code.' } },
      second: { 5: [['5.d1', 'contradicted', 'a'], ['5.d2', 'contradicted', 'b'], ['5.l1', 'verified', 'fine']] },
    });
    expect(resolved.steps.map((step) => [step.order, step.originalOrder])).toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [5, 6]]);
    expect(resolved.steps[4].sentences.map((s) => s.id)).toEqual(['5.t', '5.d1', '5.d2', '5.d3']);
    expect(resolved.steps[4].title).toBe('Step 6');
    expect(resolved.steps[4].description).toBe('D6 one. D6 two. D6 three.');
    expect(resolved.removed).toEqual([
      { step: 5, id: '5.t', kind: 'title', text: 'Step 5', verdict: 'verified', reason: 'reason for 5.t', cause: 'step-removed' },
      { step: 5, id: '5.d1', kind: 'description', text: 'R one.', verdict: 'contradicted', reason: 'a', cause: 'contradicted' },
      { step: 5, id: '5.d2', kind: 'description', text: 'R two.', verdict: 'contradicted', reason: 'b', cause: 'contradicted' },
      { step: 5, id: '5.l1', kind: 'languageLesson', text: 'A lesson about the code.', verdict: 'verified', reason: 'fine', cause: 'step-removed' },
    ]);
    expect(resolved.counts).toMatchObject({ steps: 5, removedSentences: 4, removedSteps: 1, replacedTitles: 0 });
  });

  it('still resolves to fewer than five steps and leaves the gap to report', () => {
    const rows = Object.fromEntries([2, 3].map((order) => [order, [[`${order}.d1`, 'contradicted'], [`${order}.d2`, 'contradicted'], [`${order}.d3`, 'contradicted']]]));
    const { resolved } = twoRounds({
      first: rows,
      edits: { 2: { description: 'x one. x two.' }, 3: { description: 'y one. y two.' } },
      second: { 2: [['2.d1', 'contradicted'], ['2.d2', 'contradicted']], 3: [['3.d1', 'contradicted'], ['3.d2', 'contradicted']] },
    });
    expect(resolved.steps).toHaveLength(4);
    expect(resolved.counts.removedSteps).toBe(2);
  });

  it('rebuilds the language lesson from its remaining sentences, and drops it when none remain', () => {
    const edits = { 2: { languageLesson: 'Lesson A. Lesson B.' }, 4: { languageLesson: 'Lesson C.' } };
    const draft = draft6((d) => { d.steps[1].languageLesson = 'Old A. Old B.'; d.steps[3].languageLesson = 'Old C.'; });
    const { located } = roundOne(draft, { 2: [...ok(2, 3), ['2.l1', 'contradicted'], ['2.l2', 'verified']], 4: [...ok(4, 3), ['4.l1', 'contradicted']] });
    recordRoundOne(located.tourDir);
    Object.assign(draft.steps[1], edits[2]);
    Object.assign(draft.steps[3], edits[4]);
    writeDraft(project.root, draft);
    const round2 = sliceDraft(located, 2);
    for (const step of round2.steps) {
      writeVerdicts(located.tourDir, 2, step.order, step.sentences.map((s) => [s.id, s.id.endsWith('l1') ? 'contradicted' : 'verified']));
    }
    const resolved = settleTour(located.tourDir);
    expect(resolved.steps[1].languageLesson).toBe('Lesson B.');
    expect(resolved.steps[3].languageLesson).toBeUndefined();
    expect(resolved.removed.map((r) => [r.id, r.kind])).toEqual([['2.l1', 'languageLesson'], ['4.l1', 'languageLesson']]);
  });

  it('keeps unverified and unchecked sentences and counts them', () => {
    const { located } = roundOne(draft6(), { 1: [['1.d1', 'unverified'], ['1.d2', 'verified']] });
    recordRoundOne(located.tourDir);
    const resolved = settleTour(located.tourDir);
    expect(resolved.steps[0].sentences.map((s) => s.verdict)).toEqual(['verified', 'unverified', 'verified', 'unchecked']);
    expect(resolved.steps[0].sentences[3].reason).toBe('no verdict was recorded for this sentence');
    expect(resolved.counts).toMatchObject({ unverified: 1, unchecked: 1, removedSentences: 0 });
  });

  it('settles without a round-2 slice when nothing was sent back, taking the round-1 text verbatim', () => {
    const { located } = roundOne(draft6());
    recordRoundOne(located.tourDir);
    const resolved = settleTour(located.tourDir);
    expect(resolved.rewritten).toEqual([]);
    expect(resolved.steps[0].description).toBe('D1 one. D1 two. D1 three.');
    expect(resolved.contentLanguage).toBe('en');
  });

  it('refuses to settle while a step round 1 sent back has no round-2 slice', () => {
    const { located } = roundOne(draft6(), { 4: [['4.d1', 'contradicted'], ['4.d2', 'verified'], ['4.d3', 'verified']] });
    recordRoundOne(located.tourDir);
    expect(() => settleTour(located.tourDir)).toThrow(/step\(s\) 4 were sent back by round 1 but have no round-2 slice/);
  });

  it('writes the same bytes twice', () => {
    const { located } = roundOne(draft6());
    recordRoundOne(located.tourDir);
    settleTour(located.tourDir);
    const first = readFileSync(join(located.tourDir, 'resolved.json'));
    settleTour(located.tourDir);
    expect(readFileSync(join(located.tourDir, 'resolved.json')).equals(first)).toBe(true);
  });
});

describe('the title of a step', () => {
  const NAMED = [
    { id: 'file:a.go', filePath: 'a.go', name: 'a.go' },
    { id: 'function:a.go:Handle', type: 'function', filePath: 'a.go', lineRange: [1, 3], name: 'Handle' },
  ];
  /** Round 1 and round 2 where step 4 cites Handle then a.go and its title gets `t1` and then `t2`; its description passes unless `description2` says. */
  function titleRounds({ t1 = 'contradicted', t2 = 'contradicted', description2 = 'verified' } = {}) {
    writeCandidatesFile(project.root, project.revision, NAMED);
    const draft = draft6((d) => { d.steps[3].nodeIds = ['function:a.go:Handle', 'file:a.go']; d.steps[3].title = 'Legacy handler'; });
    const { located } = roundOne(draft, { 4: [['4.t', t1, 'no legacy marker in the code'], ...ok(4, 3)] });
    const rewrite = recordRoundOne(located.tourDir);
    draft.steps[3].title = 'Old handler';
    writeDraft(project.root, draft);
    const index = sliceDraft(located, 2);
    writeVerdicts(located.tourDir, 2, 4, [['4.t', t2, 'nothing marks it old'], ...index.steps[0].sentences.filter((s) => s.kind !== 'title').map((s) => [s.id, description2])]);
    return { rewrite, resolved: settleTour(located.tourDir) };
  }

  it('is sent back in rewrite.json when round 1 contradicts it', () => {
    const { rewrite } = titleRounds();
    expect(rewrite.steps).toEqual([{ order: 4, title: 'Legacy handler', contradicted: [{ id: '4.t', text: 'Legacy handler', reason: 'no legacy marker in the code' }] }]);
  });

  it('is replaced by the names of the cited nodes in nodeIds order when round 2 contradicts it again, and the original goes into removed', () => {
    const { resolved } = titleRounds();
    const step = resolved.steps[3];
    expect(step).toMatchObject({ order: 4, originalOrder: 4, title: 'Handle, a.go', description: 'D4 one. D4 two. D4 three.' });
    expect(step.sentences.map((s) => s.id)).toEqual(['4.d1', '4.d2', '4.d3']);
    expect(resolved.removed).toEqual([{ step: 4, id: '4.t', kind: 'title', text: 'Old handler', verdict: 'contradicted', reason: 'nothing marks it old', cause: 'contradicted' }]);
    expect(resolved.counts).toMatchObject({ steps: 6, sentences: 23, removedSentences: 1, removedSteps: 0, replacedTitles: 1 });
  });

  it('keeps a title the rewrite fixed, with its verdict, as the step\'s first sentence', () => {
    const { resolved } = titleRounds({ t2: 'unverified' });
    expect(resolved.steps[3].title).toBe('Old handler');
    expect(resolved.steps[3].sentences[0]).toEqual({ id: '4.t', kind: 'title', text: 'Old handler', verdict: 'unverified', reason: 'nothing marks it old' });
    expect(resolved.removed).toEqual([]);
    expect(resolved.counts.replacedTitles).toBe(0);
  });

  it('removes the step only when every description sentence goes, whatever happens to the title', () => {
    const { resolved } = titleRounds({ description2: 'contradicted' });
    expect(resolved.steps.map((step) => step.originalOrder)).toEqual([1, 2, 3, 5, 6]);
    expect(resolved.removed.map((r) => [r.id, r.kind, r.cause])).toEqual([['4.t', 'title', 'contradicted'], ['4.d1', 'description', 'contradicted'], ['4.d2', 'description', 'contradicted'], ['4.d3', 'description', 'contradicted']]);
    expect(resolved.counts).toMatchObject({ steps: 5, removedSteps: 1, replacedTitles: 0 });
  });

  it('renumbers a kept title with its step', () => {
    const { resolved } = titleRounds({ description2: 'contradicted' });
    expect(resolved.steps[3].sentences[0]).toMatchObject({ id: '4.t', kind: 'title', text: 'Step 5' });
  });

  it('refuses to replace a title when a cited node has no name in the candidates', () => {
    writeCandidatesFile(project.root, project.revision, [{ id: 'file:a.go', filePath: 'a.go', name: '' }]);
    const draft = draft6();
    const { located } = roundOne(draft, { 2: [['2.t', 'contradicted'], ...ok(2, 3)] });
    recordRoundOne(located.tourDir);
    const index = sliceDraft(located, 2);
    writeVerdicts(located.tourDir, 2, 2, index.steps[0].sentences.map((s) => [s.id, s.kind === 'title' ? 'contradicted' : 'verified']));
    expect(() => settleTour(located.tourDir)).toThrow(/file:a\.go has no name in candidates\.json/);
  });
});

describe('titleFromNames', () => {
  const ELLIPSIS = String.fromCharCode(0x2026);
  it('joins the names with a comma and a space when they fit in 60 characters', () => {
    expect(titleFromNames(['Handle', 'a.go'])).toBe('Handle, a.go');
    const exact = ['x'.repeat(29), 'y'.repeat(29)];
    expect(titleFromNames(exact)).toBe(`${exact[0]}, ${exact[1]}`);
    expect([...titleFromNames(exact)]).toHaveLength(60);
  });

  it('keeps the whole names that fit and ends with a comma and an ellipsis when one is left out', () => {
    const names = ['a'.repeat(25), 'b'.repeat(25), 'c'.repeat(25)];
    expect(titleFromNames(names)).toBe(`${names[0]}, ${names[1]}, ${ELLIPSIS}`);
  });

  it('cuts a first name that alone does not fit to 59 characters and an ellipsis', () => {
    expect(titleFromNames(['n'.repeat(70), 'short'])).toBe(`${'n'.repeat(59)}${ELLIPSIS}`);
    expect([...titleFromNames(['n'.repeat(70)])]).toHaveLength(60);
  });

  it('counts characters, not UTF-16 units', () => {
    const wide = String.fromCodePoint(0x1f600).repeat(58);
    expect(titleFromNames([wide])).toBe(wide);
  });
});

describe('the verdicts command', () => {
  const run = (...args) => spawnSync(process.execPath, [TOUR, 'verdicts', join(project.root, '.excavator', 'tour', 'draft.json'), ...args], { encoding: 'utf-8' });

  it('round 1 prints the steps to rewrite; round 2 prints the counts', () => {
    roundOne(draft6(), { 2: [['2.d1', 'contradicted'], ['2.d2', 'verified'], ['2.d3', 'verified']] });
    const first = run('--round', '1');
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({ round: 1, rewrite: [2], counts: { contradicted: 1, sentBack: 1 } });
    const refused = run('--round', '2');
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('no round-2 slice');
  });

  it('exits 1 with the usage without --round', () => {
    expect(run().status).toBe(1);
    expect(run().stderr).toContain('Usage:');
  });

  it('exits 1 when round 1 was never sliced', () => {
    mkdirSync(join(project.root, '.excavator', 'tour'), { recursive: true });
    writeDraft(project.root, draft6());
    const result = run('--round', '1');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('round-1.json');
  });
});
