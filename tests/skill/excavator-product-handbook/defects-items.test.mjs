// Oracle of openspec change handbook-page-structure (tasks 1.1 and 1.2, design D2): the defects
// parser splits items into level, category and feature ids, and `defectsReasons` turns each
// unsplittable item, unknown id and uncovered feature into a reason. Full-width marks are built
// from code points so that this file holds only ASCII.
import { readFileSync } from 'node:fs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFECT_CATEGORIES, DEFECT_LEVELS, defectsReasons, parseDefects } from '../../../skills/excavator-product-handbook/lib/defects-items.mjs';

const NONE = 'None.';
const STRINGS = { 'chapter.none': NONE, 'chapter.problems': 'Known defects' };
const open = String.fromCharCode(0xff08);
const close = String.fromCharCode(0xff09);

const dirs = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
});
function newOut(chapters = {}) {
  const out = mkdtempSync(join(tmpdir(), 'xhb-defects-'));
  dirs.push(out);
  mkdirSync(join(out, 'chapters'));
  for (const [name, text] of Object.entries(chapters)) writeFileSync(join(out, 'chapters', `${name}.md`), text);
  return out;
}
const parse = (text) => parseDefects(text, { none: NONE });
const problemsSection = (count) => `# F\n\n## Known defects\n\n${Array.from({ length: count }, (_, i) => `- problem ${i}`).join('\n') || NONE}\n`;

describe('parseDefects', () => {
  it('takes the level, category, ids and text of items under P0, P1 and P2', () => {
    const { items, problems } = parse(`# Defects

Intro.

| Level | Count |
| --- | --- |
| P0 | 1 |

## P0

- **security** A secret is written into the code, Orders (F1) (\`a.js:1-2\`).

## P1

- **display** The page hides a button, Archive (F2) (\`a.js:3-4\`).

## P2

${NONE}
`);
    expect(problems).toEqual([]);
    expect(items.map((item) => [item.level, item.category, item.features, item.line])).toEqual([
      ['P0', 'security', ['F1'], 11],
      ['P1', 'display', ['F2'], 15],
    ]);
    expect(items[0].text).toContain('A secret is written');
    expect(DEFECT_LEVELS).toEqual(['P0', 'P1', 'P2']);
  });

  it('collects several ids in order of first mention with ASCII and full-width parentheses, and accepts system', () => {
    const { items, problems } = parse(`## P1\n\n- **contract** Orders (F7) and Archive ${open}F12${close} disagree; Orders (F7) again; the shell (system).\n`);
    expect(problems).toEqual([]);
    expect(items[0].features).toEqual(['F7', 'F12', 'system']);
  });

  it('joins a wrapped item over three lines and ends it at the next item or a paragraph', () => {
    const { items, problems } = parse(`## P0

- **time** The cut-off is wrong
  for Orders (F1)
continues here (\`a.js:1-2\`).
- **other** Next item, Archive (F2).

A paragraph after a blank line is not part of it, (F3).

- **other** Last, Admin (F4).
`);
    expect(problems).toEqual([]);
    expect(items.map((item) => [item.line, item.features])).toEqual([[3, ['F1']], [6, ['F2']], [10, ['F4']]]);
    expect(items[0].text).toBe('**time** The cut-off is wrong for Orders (F1) continues here (`a.js:1-2`).');
  });

  it('reports an item without an id, without a category, with an unknown category, and outside a level', () => {
    const { items, problems } = parse(`- **display** an intro bullet that is a plain note without level (F1)

- plain intro bullet is not an item

## P0

- **display** no id here.
- No category (F1).
- **colour** Unknown word (F1).
- **time** fine (F2).

## Notes

- **display** under a heading that is not a level (F1).
`);
    expect(items.map((item) => item.line)).toEqual([10]);
    expect(problems).toEqual([
      { line: 1, missing: ['level'] },
      { line: 7, missing: ['feature'] },
      { line: 8, missing: ['category'] },
      { line: 9, missing: ['category'], category: 'colour' },
      { line: 14, missing: ['level'] },
    ]);
  });

  it('skips the none line, plain or as a list item, and fenced code', () => {
    const { items, problems } = parse(`## P0\n\n${NONE}\n\n## P1\n\n- ${NONE}\n\n## P2\n\n\`\`\`\n- **x** in a fence\n\`\`\`\n`);
    expect(items).toEqual([]);
    expect(problems).toEqual([]);
  });
});

describe('defectsReasons', () => {
  const ids = ['F1', 'F2'];
  const good = `## P0\n\n- **security** Secret, Orders (F1).\n`;

  it('turns a problem into a line-numbered reason naming what is missing', () => {
    const reasons = defectsReasons(newOut(), `## P0\n\n- **colour** x (F1).\n- **time** y.\n`, ids, STRINGS);
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toMatch(/^line 3: .*"colour" is not in the fixed list/);
    expect(reasons[1]).toMatch(/^line 4: .*names no feature id/);
  });

  it('rejects an id that is not on the map and accepts system', () => {
    const reasons = defectsReasons(newOut(), `## P0\n\n- **time** a (F9).\n- **time** b (system).\n`, ids, STRINGS);
    expect(reasons).toEqual(['line 3: feature id F9 is not a feature of map.json']);
  });

  it('fails the coverage rule for a feature with problems no defect mentions, and passes once one does', () => {
    const out = newOut({ F2: problemsSection(3) });
    const reasons = defectsReasons(out, good, ids, STRINGS);
    expect(reasons).toEqual(['F2: its "Known defects" section has 3 items but no defect item names F2']);
    const covered = `${good}\n## P1\n\n- **display** Hidden, Archive (F2).\n`;
    expect(defectsReasons(out, covered, ids, STRINGS)).toEqual([]);
  });

  it('counts the system chapter, ignores a none-only section and a missing chapter', () => {
    const out = newOut({ system: problemsSection(1), F1: problemsSection(0) });
    expect(defectsReasons(out, good, ids, STRINGS)).toEqual(['system: its "Known defects" section has 1 item but no defect item names system']);
  });
});

describe('contract with the prompt', () => {
  it('lists the categories of sections/features.md in order', () => {
    const text = readFileSync(new URL('../../../skills/excavator-product-handbook/sections/features.md', import.meta.url), 'utf-8');
    const names = Array.from(text.matchAll(/^- `([a-z-]+)`: /gm), (found) => found[1]);
    expect(names).toEqual([...DEFECT_CATEGORIES]);
  });
});
