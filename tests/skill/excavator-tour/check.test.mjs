import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { checkDraft } from '../../../skills/excavator/tour-check.mjs';
import { clearProducts, draftOf, draftStep, makeGitProject, writeCandidatesFile, writeDraft } from './fixture.mjs';

const TOUR = join(process.cwd(), 'skills', 'excavator', 'tour.mjs');
const IDS = new Set(['file:a.go', 'file:b.go', 'file:c.go', 'file:d.go', 'file:e.go', 'file:f.go', 'file:g.go']);
const issuesOf = (draft) => checkDraft(draft, IDS);
const withStep = (n, order, extra) => {
  const draft = draftOf(n);
  draft.steps[order - 1] = { ...draft.steps[order - 1], ...extra };
  return draft;
};

describe('checkDraft', () => {
  it('passes a well-formed tour, with and without language lessons', () => {
    expect(issuesOf(draftOf(5))).toEqual([]);
    expect(issuesOf(withStep(15, 2, { languageLesson: 'Go reads settings from the environment. It is common.' }))).toEqual([]);
  });

  it('needs 5 to 15 steps', () => {
    expect(issuesOf(draftOf(4))).toEqual(['the tour has 4 step(s); it needs 5 to 15']);
    expect(issuesOf(draftOf(16))).toEqual(['the tour has 16 step(s); it needs 5 to 15']);
    expect(issuesOf(draftOf(15))).toEqual([]);
  });

  it('says which order is missing when the orders have a gap', () => {
    const draft = { steps: [1, 2, 4, 5, 6].map((order) => draftStep(order)) };
    const [issue] = issuesOf(draft);
    expect(issue).toBe('step orders must run 1..5 without a gap or a repeat: missing 3; unexpected 6 (found 1, 2, 4, 5, 6)');
  });

  it('names a repeated order, and steps listed out of order', () => {
    const repeated = draftOf(5);
    repeated.steps[4].order = 4;
    expect(issuesOf(repeated)).toEqual(['step orders must run 1..5 without a gap or a repeat: missing 5; repeated 4 (found 1, 2, 3, 4, 4)']);
    const shuffled = draftOf(5);
    [shuffled.steps[0], shuffled.steps[1]] = [shuffled.steps[1], shuffled.steps[0]];
    expect(issuesOf(shuffled)).toEqual(['steps must be listed in order, but the orders are 2, 1, 3, 4, 5']);
  });

  it('lists the step and the id when nodeIds has an id outside the candidate set', () => {
    expect(issuesOf(withStep(5, 3, { nodeIds: ['file:a.go', 'file:elsewhere.go'] }))).toEqual([
      'step 3: nodeIds contains "file:elsewhere.go", which is not in the candidate set',
    ]);
  });

  it('needs 1 to 5 distinct node ids', () => {
    expect(issuesOf(withStep(5, 1, { nodeIds: [] }))).toEqual(['step 1: nodeIds has 0 id(s); it needs 1 to 5']);
    expect(issuesOf(withStep(5, 1, { nodeIds: ['file:a.go', 'file:b.go', 'file:c.go', 'file:d.go', 'file:e.go', 'file:f.go'] }))).toEqual(['step 1: nodeIds has 6 id(s); it needs 1 to 5']);
    expect(issuesOf(withStep(5, 1, { nodeIds: ['file:a.go', 'file:b.go', 'file:c.go', 'file:d.go', 'file:e.go'] }))).toEqual([]);
    expect(issuesOf(withStep(5, 2, { nodeIds: ['file:a.go', 'file:a.go'] }))).toEqual(['step 2: nodeIds repeats "file:a.go"']);
  });

  it('needs a description of 2 to 5 sentences', () => {
    expect(issuesOf(withStep(5, 1, { description: 'Only one sentence.' }))).toEqual(['step 1: description has 1 sentence(s); it needs 2 to 5']);
    expect(issuesOf(withStep(5, 1, { description: 'A one. B two. C three. D four. E five.' }))).toEqual([]);
    expect(issuesOf(withStep(5, 1, { description: 'A one. B two. C three. D four. E five. F six.' }))).toEqual(['step 1: description has 6 sentence(s); it needs 2 to 5']);
  });

  it('allows at most 3 sentences in a language lesson, and no empty lesson', () => {
    expect(issuesOf(withStep(5, 1, { languageLesson: 'One. Two. Three.' }))).toEqual([]);
    expect(issuesOf(withStep(5, 1, { languageLesson: 'One. Two. Three. Four.' }))).toEqual(['step 1: languageLesson has 4 sentence(s); the limit is 3']);
    expect(issuesOf(withStep(5, 1, { languageLesson: '' }))).toEqual(['step 1: languageLesson must be a non-empty string when present']);
  });

  it('allows a title of 60 characters and not 61', () => {
    expect(issuesOf(withStep(5, 1, { title: 'x'.repeat(60) }))).toEqual([]);
    expect(issuesOf(withStep(5, 1, { title: 'x'.repeat(61) }))).toEqual(['step 1: title has 61 characters; the limit is 60']);
    expect(issuesOf(withStep(5, 1, { title: ' ' }))).toEqual(['step 1: title must be a non-empty string']);
  });

  it('lists every problem, not the first', () => {
    const draft = withStep(5, 2, { description: 'One.', nodeIds: ['file:zzz.go'], title: 'x'.repeat(70) });
    expect(issuesOf(draft)).toHaveLength(3);
  });

  it('rejects a draft that is not an object with a steps array', () => {
    expect(issuesOf([])).toEqual(['the draft must be an object with a steps array']);
    expect(issuesOf({ steps: 'no' })).toEqual(['the draft must be an object with a steps array']);
    expect(issuesOf({ steps: [1, 2, 3, 4, 5] })).toContain('the step at position 1 is not an object');
  });
});

describe('the check command', () => {
  let project;
  beforeAll(() => {
    project = makeGitProject({ 'a.go': 'package a\n', 'b.go': 'package b\n' });
  });
  afterAll(() => project.cleanup());
  beforeEach(() => clearProducts(project.root));
  const run = () => spawnSync(process.execPath, [TOUR, 'check', join(project.root, '.excavator', 'tour', 'draft.json')], { encoding: 'utf-8' });

  it('exits 0 for a passing draft and prints ok', () => {
    writeCandidatesFile(project.root, project.revision, [{ id: 'file:a.go', filePath: 'a.go' }]);
    writeDraft(project.root, draftOf(5));
    const result = run();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, steps: 5, issues: [] });
  });

  it('exits 1 and lists the problems when the draft cites an id outside the candidates', () => {
    writeCandidatesFile(project.root, project.revision, [{ id: 'file:a.go', filePath: 'a.go' }]);
    const draft = draftOf(5);
    draft.steps[1].nodeIds = ['file:b.go'];
    writeDraft(project.root, draft);
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('step 2: nodeIds contains "file:b.go", which is not in the candidate set');
    expect(JSON.parse(result.stdout).ok).toBe(false);
  });

  it('exits 1 and says to run candidates when there is no candidate set', () => {
    writeDraft(project.root, draftOf(5));
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('run `tour.mjs candidates <projectRoot>` first');
  });

  it('exits 1 for a draft that is not JSON, and for a path outside .excavator/tour', () => {
    writeCandidatesFile(project.root, project.revision, [{ id: 'file:a.go', filePath: 'a.go' }]);
    writeDraft(project.root, '{ not json');
    expect(run().status).toBe(1);
    const elsewhere = spawnSync(process.execPath, [TOUR, 'check', join(project.root, 'draft.json')], { encoding: 'utf-8' });
    expect(elsewhere.status).toBe(1);
    expect(elsewhere.stderr).toContain('the draft must be <project>/.excavator/tour/<file>');
  });
});
