import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { sliceDraft } from '../../../skills/excavator/tour-slices.mjs';
import { OTHER_DIGEST, clearProducts, draftOf, makeGitProject, sourceLines, writeCandidatesFile, writeGraph, writeDraft, writeVerdicts } from './fixture.mjs';

const TOUR = join(process.cwd(), 'skills', 'excavator', 'tour.mjs');

let project;
beforeAll(() => {
  project = makeGitProject({
    'a.go': sourceLines(10, 'a'),
    'big.go': sourceLines(300, 'big'),
    'big2.go': sourceLines(300, 'big2'),
    'crlf.go': 'one\r\ntwo\r\nthree\r\n',
    'short.go': sourceLines(5, 's'),
  });
});
afterAll(() => project.cleanup());
beforeEach(() => {
  clearProducts(project.root);
  writeCandidatesFile(project.root, project.revision, [
    { id: 'file:a.go', filePath: 'a.go' },
    { id: 'function:a.go:f', type: 'function', filePath: 'a.go', lineRange: [3, 5] },
    { id: 'file:big.go', filePath: 'big.go' },
    { id: 'function:big.go:long', type: 'function', filePath: 'big.go', lineRange: [10, 200] },
    { id: 'file:big2.go', filePath: 'big2.go' },
    { id: 'function:big2.go:long', type: 'function', filePath: 'big2.go', lineRange: [10, 200] },
    { id: 'file:crlf.go', filePath: 'crlf.go' },
    { id: 'function:short.go:late', type: 'function', filePath: 'short.go', lineRange: [9, 12] },
    { id: 'function:short.go:edge', type: 'function', filePath: 'short.go', lineRange: [4, 9] },
    { id: 'file:gone.go', filePath: 'gone.go' },
  ]);
});

const slice = (draft, round = 1) => {
  const located = writeDraft(project.root, draft);
  const index = sliceDraft(located, round);
  return { located, index, read: (order) => JSON.parse(readFileSync(join(located.tourDir, index.steps.find((s) => s.order === order).input), 'utf-8')) };
};
const withStep = (n, order, extra) => {
  const draft = draftOf(n);
  draft.steps[order - 1] = { ...draft.steps[order - 1], ...extra };
  return draft;
};

describe('slices: sentences', () => {
  it('splits the description and the language lesson and numbers them <order>.d<n> and <order>.l<n>', () => {
    const { read } = slice(withStep(5, 3, { description: 'First. Second! Third?', languageLesson: 'Lesson one. Lesson two.' }));
    expect(read(3).sentences).toEqual([
      { id: '3.d1', text: 'First.' }, { id: '3.d2', text: 'Second!' }, { id: '3.d3', text: 'Third?' },
      { id: '3.l1', text: 'Lesson one.' }, { id: '3.l2', text: 'Lesson two.' },
    ]);
  });

  it('gives the verifier only the step number, the sentences and the snippets', () => {
    const { read } = slice(draftOf(5));
    expect(Object.keys(read(1)).sort()).toEqual(['format', 'sentences', 'snippets', 'step']);
    expect(Object.keys(read(1).snippets[0]).sort()).toEqual(['endLine', 'filePath', 'nodeId', 'outline', 'startLine', 'text', 'truncatedLines', 'truncatedOutline']);
    expect(readFileSync(join(project.root, '.excavator', 'tour', 'slices', 'round-1', 'step-1.json'), 'utf-8')).not.toMatch(/reason|summary|candidate|reasons|outlineLines/);
  });

  it('writes a round index with every sentence, and the paths of the verifier input and output', () => {
    const { index, located } = slice(draftOf(5));
    expect(index.steps).toHaveLength(5);
    expect(index.steps[0]).toMatchObject({ order: 1, input: join('slices', 'round-1', 'step-1.json'), output: join('verdicts', 'round-1', 'step-1.json') });
    expect(index.steps[0].sentences.map((s) => s.id)).toEqual(['1.d1', '1.d2']);
    expect(existsSync(join(located.tourDir, 'verdicts', 'round-1'))).toBe(true);
    expect(index.contentLanguage).toBe('en');
  });
});

describe('slices: snippets', () => {
  it('cuts a node by its line range, inclusive, and a file node from its first line', () => {
    const { read } = slice(withStep(5, 1, { nodeIds: ['function:a.go:f', 'file:a.go'] }));
    const [fn, file] = read(1).snippets;
    expect(fn).toMatchObject({ nodeId: 'function:a.go:f', startLine: 3, endLine: 5, truncatedLines: 0, text: 'a 3\na 4\na 5' });
    expect(file).toMatchObject({ startLine: 1, endLine: 10, truncatedLines: 0 });
    expect(file.text.split('\n')).toHaveLength(10);
  });

  it('shows at most 120 lines of a node and writes the number cut at the end of the snippet', () => {
    const { read, index } = slice(withStep(5, 1, { nodeIds: ['function:big.go:long'] }));
    const [snippet] = read(1).snippets;
    // Lines 10..200 are 191 lines; 120 are shown (10..129) and 71 cut.
    expect(snippet).toMatchObject({ startLine: 10, endLine: 129, truncatedLines: 71 });
    expect(snippet.text.split('\n')).toHaveLength(121);
    expect(snippet.text.endsWith('\n[... 71 more lines not shown]')).toBe(true);
    expect(index.steps[0]).toMatchObject({ snippetLines: 120, truncatedLines: 71 });
  });

  it('cuts a file node at 120 lines and says how many of the other 180 it left out', () => {
    const { read } = slice(withStep(5, 1, { nodeIds: ['file:big.go'] }));
    expect(read(1).snippets[0]).toMatchObject({ startLine: 1, endLine: 120, truncatedLines: 180 });
    expect(read(1).snippets[0].text.endsWith('[... 180 more lines not shown]')).toBe(true);
  });

  it('holds a step to 400 lines in all, and says when a node got none of them', () => {
    const { read, index } = slice(withStep(5, 2, { nodeIds: ['file:big.go', 'file:big2.go', 'function:big.go:long', 'file:a.go', 'file:crlf.go'] }));
    const snippets = read(2).snippets;
    // 120 + 120 + 120 = 360, then the 40 left go to a.go's 10 lines (a file node), 30 to spare; crlf gets its 3 lines.
    expect(snippets.map((s) => (s.startLine === null ? 0 : s.endLine - s.startLine + 1))).toEqual([120, 120, 120, 10, 3]);
    expect(index.steps[1].snippetLines).toBe(373);
    // Now overrun the budget. The two functions (191 lines each) come first with 120 each; the file heads then share the 160 left, in citation order.
    const over = slice(withStep(5, 2, { nodeIds: ['file:big.go', 'file:big2.go', 'function:big.go:long', 'function:big2.go:long', 'file:a.go'] }));
    const lines = over.read(2).snippets.map((s) => (s.startLine === null ? 0 : s.endLine - s.startLine + 1));
    expect(lines).toEqual([120, 40, 120, 120, 0]);
    expect(over.read(2).snippets[1].truncatedLines).toBe(300 - 40);
    expect(over.read(2).snippets[2].truncatedLines).toBe(191 - 120);
    expect(over.read(2).snippets[4]).toMatchObject({ startLine: null, truncatedLines: 10, note: "the step's 400-line budget was used up by earlier nodes" });
    expect(over.read(2).snippets[4].text).toBe('[... 10 more lines not shown]');
  });

  it('strips carriage returns and clamps a range that runs past the end of the file', () => {
    const { read } = slice(withStep(5, 1, { nodeIds: ['file:crlf.go', 'function:short.go:edge'] }));
    const [crlf, edge] = read(1).snippets;
    expect(crlf.text).toBe('one\ntwo\nthree');
    expect(edge).toMatchObject({ startLine: 4, endLine: 5, text: 's 4\ns 5', truncatedLines: 0 });
  });

  it('gives an empty snippet and the reason for a node whose lines start after the end, or whose file cannot be read', () => {
    const { read } = slice(withStep(5, 1, { nodeIds: ['function:short.go:late', 'file:gone.go'] }));
    const [late, gone] = read(1).snippets;
    expect(late).toMatchObject({ startLine: null, text: '', note: "the node's lines start after the end of the file (5 lines)" });
    expect(gone.text).toBe('');
    expect(gone.note).toMatch(/^the source could not be read: /);
  });
});

const outlineNode = (path, type, name, lineRange, extra = {}) => ({ id: `${type}:${path}:${name}`, type, name, filePath: path, ...(lineRange ? { lineRange } : {}), summary: 'SECRET SUMMARY TEXT', tags: [], ...extra });
const CANDIDATES = [
  { id: 'file:a.go', filePath: 'a.go' },
  { id: 'function:a.go:f', type: 'function', filePath: 'a.go', lineRange: [3, 5] },
  { id: 'file:big.go', filePath: 'big.go' },
  { id: 'file:big2.go', filePath: 'big2.go' },
  { id: 'function:big.go:long', type: 'function', filePath: 'big.go', lineRange: [10, 200] },
];
const entriesOf = (path, count) => Array.from({ length: count }, (_, i) => ({ node: outlineNode(path, 'function', `fn${String(i).padStart(3, '0')}`, [i + 1, i + 1]) }));

describe('slices: the outline of a file node', () => {
  it('lists the nodes the file contains as type, name and lines, sorted by line, with no summary text', () => {
    writeCandidatesFile(project.root, project.revision, CANDIDATES, {
      contains: {
        'file:a.go': [
          { node: outlineNode('a.go', 'function', 'late', [9, 10]) },
          { node: outlineNode('a.go', 'class', 'Thing', [1, 8]) },
          { node: outlineNode('a.go', 'function', 'nolines', null) },
          { node: outlineNode('a.go', 'function', 'early', [2, 3]) },
          { node: outlineNode('a.go', 'function', 'bTie', [2, 2]) },
        ],
      },
    });
    const { read, located, index } = slice(withStep(5, 1, { nodeIds: ['file:a.go', 'function:a.go:f'] }));
    const [file, fn] = read(1).snippets;
    // Sorted by first line, then id; a node without a line range comes last.
    expect(file.outline).toEqual([
      'class Thing [1-8]',
      'function bTie [2-2]',
      'function early [2-3]',
      'function late [9-10]',
      'function nolines [no line range]',
    ]);
    expect(file.truncatedOutline).toBe(0);
    expect(fn.outline).toBeUndefined();
    expect(readFileSync(join(located.tourDir, index.steps[0].input), 'utf-8')).not.toContain('SECRET SUMMARY TEXT');
    // Opening lines (10), the function's 3 lines and the 5 outline lines.
    expect(index.steps[0].snippetLines).toBe(10 + 3 + 5);
  });

  it('names a contained node the graph lacks, and gives a file with nothing contained an empty outline', () => {
    writeCandidatesFile(project.root, project.revision, CANDIDATES, { contains: { 'file:a.go': [{ id: 'function:a.go:ghost' }] } });
    const { read } = slice(withStep(5, 1, { nodeIds: ['file:a.go', 'file:big.go'] }));
    expect(read(1).snippets[0].outline).toEqual(['unresolved function:a.go:ghost']);
    expect(read(1).snippets[1].outline).toEqual([]);
  });

  it('counts outline lines toward the step budget and writes the entries cut as the last outline line', () => {
    writeCandidatesFile(project.root, project.revision, CANDIDATES, { contains: { 'file:big.go': entriesOf('big.go', 250), 'file:big2.go': entriesOf('big2.go', 200), 'file:a.go': entriesOf('a.go', 4) } });
    const { read, index } = slice(withStep(5, 1, { nodeIds: ['file:big.go', 'file:big2.go', 'file:a.go'] }));
    const [first, second, third] = read(1).snippets;
    // The outlines are first in line: 250 for big.go, 150 of big2.go's 200 (the 400 are then spent), none of a.go's 4.
    expect(first.outline).toHaveLength(250);
    expect(first.truncatedOutline).toBe(0);
    expect(second.outline).toHaveLength(151);
    expect(second.outline[150]).toBe('[... 50 more outline entries not shown]');
    expect(second.truncatedOutline).toBe(50);
    expect(third.outline).toEqual(['[... 4 more outline entries not shown]']);
    expect(third.truncatedOutline).toBe(4);
    // No file head is left to show.
    expect(first).toMatchObject({ startLine: null, truncatedLines: 300 });
    expect(index.steps[0].snippetLines).toBe(400);
    expect(index.steps[0].truncatedLines).toBe(300 + 300 + 10 + 50 + 4);
  });

  it('spends the step budget on functions first, then every file outline, then file heads in citation order', () => {
    writeCandidatesFile(project.root, project.revision, CANDIDATES, { contains: { 'file:big.go': entriesOf('big.go', 100), 'file:big2.go': entriesOf('big2.go', 100) } });
    const { read } = slice(withStep(5, 1, { nodeIds: ['file:big.go', 'function:big.go:long', 'file:big2.go'] }));
    const [bigHead, fn, big2Head] = read(1).snippets;
    // 400 = the function's 120, both outlines' 100 each, and the 80 left to the first file head; the second head gets nothing.
    expect(fn).toMatchObject({ startLine: 10, endLine: 129 });
    expect(bigHead.outline).toHaveLength(100);
    expect(big2Head.outline).toHaveLength(100);
    expect(bigHead).toMatchObject({ startLine: 1, endLine: 80, truncatedLines: 220 });
    expect(big2Head).toMatchObject({ startLine: null, truncatedLines: 300 });
  });

  it('reads the graph only when a cited node is a file node', () => {
    writeCandidatesFile(project.root, project.revision, CANDIDATES);
    rmSync(join(project.root, '.excavator', 'knowledge-graph.jsonl'));
    const onlyFunction = draftOf(5);
    onlyFunction.steps.forEach((step) => { step.nodeIds = ['function:a.go:f']; });
    expect(() => slice(onlyFunction)).not.toThrow();
    expect(() => slice(withStep(5, 1, { nodeIds: ['file:a.go'] }))).toThrow(/needs knowledge-graph\.jsonl, which cannot be read/);
  });

  it('refuses a graph made from other facts than the candidates', () => {
    writeCandidatesFile(project.root, project.revision, CANDIDATES);
    writeGraph(project.root, { paths: ['a.go'], factsDigest: OTHER_DIGEST });
    expect(() => slice(withStep(5, 1, { nodeIds: ['file:a.go'] }))).toThrow(/candidates\.json was made from facts a{64} but knowledge-graph\.jsonl has b{64}/);
  });
});

describe('slices: refusals and rounds', () => {
  it('refuses a draft that fails the structure check', () => {
    const located = writeDraft(project.root, draftOf(4));
    expect(() => sliceDraft(located, 1)).toThrow(/fails the structure check/);
    expect(existsSync(join(located.tourDir, 'slices'))).toBe(false);
  });

  it('refuses candidates made at another source revision', () => {
    writeCandidatesFile(project.root, 'git:0000000', [{ id: 'file:a.go', filePath: 'a.go' }]);
    const located = writeDraft(project.root, draftOf(5));
    expect(() => sliceDraft(located, 1)).toThrow(/candidates\.json was made at git:0000000/);
  });

  it('re-slicing round 1 removes the verdicts, the rewrite list, the later round and the resolved tour', () => {
    const { located } = slice(draftOf(5));
    writeVerdicts(located.tourDir, 1, 1, [['1.d1', 'verified'], ['1.d2', 'verified']]);
    writeFileSync(join(located.tourDir, 'rewrite.json'), '{}');
    writeFileSync(join(located.tourDir, 'resolved.json'), '{}');
    writeVerdicts(located.tourDir, 2, 1, [['1.d1', 'verified']]);
    sliceDraft(located, 1);
    expect(readdirSync(join(located.tourDir, 'verdicts', 'round-1'))).toEqual([]);
    for (const gone of ['rewrite.json', 'resolved.json', 'round-2.json', join('verdicts', 'round-2'), join('slices', 'round-2')]) {
      expect(existsSync(join(located.tourDir, gone))).toBe(false);
    }
  });

  it('round 2 slices only the steps round 1 sent back, and refuses an edit to a step that was not sent back', () => {
    const draft = draftOf(5);
    const { located } = slice(draft);
    writeFileSync(join(located.tourDir, 'rewrite.json'), JSON.stringify({ steps: [{ order: 2 }, { order: 4 }] }));
    draft.steps[1].description = 'Rewritten. Again rewritten.';
    writeDraft(project.root, draft);
    const round2 = sliceDraft(located, 2);
    expect(round2.steps.map((step) => step.order)).toEqual([2, 4]);
    expect(round2.steps[0].sentences.map((s) => s.text)).toEqual(['Rewritten.', 'Again rewritten.']);
    draft.steps[2].title = 'Sneaked in';
    writeDraft(project.root, draft);
    expect(() => sliceDraft(located, 2)).toThrow(/changed after round 1 in step\(s\) that were not sent back \(3\)/);
  });

  it('round 2 without a rewrite list is refused', () => {
    const { located } = slice(draftOf(5));
    expect(() => sliceDraft(located, 2)).toThrow(/rewrite\.json/);
  });
});

describe('the slices command', () => {
  it('prints per-step counts and the input and output paths, exit 0', () => {
    writeDraft(project.root, withStep(5, 1, { nodeIds: ['function:big.go:long'] }));
    const result = spawnSync(process.execPath, [TOUR, 'slices', join(project.root, '.excavator', 'tour', 'draft.json')], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    const printed = JSON.parse(result.stdout);
    expect(printed.round).toBe(1);
    expect(printed.steps[0]).toMatchObject({ order: 1, sentences: 2, snippetLines: 120, truncatedLines: 71 });
    expect(printed.steps[0].inputPath).toBe(join(printed.tourDir, 'slices', 'round-1', 'step-1.json'));
  });

  it('exits 1 with the usage for a bad round', () => {
    const result = spawnSync(process.execPath, [TOUR, 'slices', join(project.root, '.excavator', 'tour', 'draft.json'), '--round', '3'], { encoding: 'utf-8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage:');
  });
});
