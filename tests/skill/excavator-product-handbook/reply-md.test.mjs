// The reply command of the Markdown handbook: the closing lines in a fixed order, the chapter
// counts computed from the chapters and state.json, the same refusals as assemble.
import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CROSS, chapterText, cite, newMdRun } from './md-run-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
const make = (chapters, options) => {
  const run = newMdRun(chapters, options);
  cleanups.push(run.cleanup);
  return run;
};

const CANDIDATES = 'Candidates: 7 listed, 6 in features, 1 unassigned; none missing, none counted twice';

describe('reply', () => {
  it('prints the lines in order with counts, failed chapters and unwritten features', () => {
    const run = make({ system: chapterText('System'), F1: chapterText('Orders'), F2: chapterText('Archive').replace(cite('10'), cite('99')) });
    run.assemble('--views', 'product,technical');
    const result = run.reply('--views', 'product,technical');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.lines).toEqual([
      `Handbook: ${join(run.out, 'handbook.md')}`,
      `Technical handbook: ${join(run.out, 'handbook-technical.md')}`,
      'Page: not written',
      'Chapters: 12 (passed 2, failed 1, not written 9)',
      'Failed: F2',
      'Not written: F3, F4, F5',
      CANDIDATES,
    ]);
  });

  it('with everything written: no Failed and no Not written line; the page line when the page exists', () => {
    const chapters = Object.fromEntries(['system', 'F1', 'F2', 'F3', 'F4', 'F5', ...CROSS].map((name) => [name, chapterText(name)]));
    const run = make(chapters);
    run.assemble();
    writeFileSync(join(run.out, 'handbook.html'), '<html></html>');
    expect(run.reply().lines).toEqual([
      `Handbook: ${join(run.out, 'handbook.md')}`,
      `Page: ${join(run.out, 'handbook.html')}`,
      'Chapters: 12 (passed 12, failed 0, not written 0)',
      CANDIDATES,
    ]);
  });

  it('names a selected view whose file is missing', () => {
    const run = make({ F1: chapterText() });
    run.assemble();
    const result = run.reply('--views', 'product,technical');
    expect(result.status).toBe(1);
    expect(result.lines).toEqual(['handbook-technical.md: missing', 'Next: run assemble, then this command again']);
  });

  it('refuses a chapter that was not checked or changed, and a state of format /1', () => {
    const run = make({ F1: chapterText() });
    run.assemble();
    run.write('F2', chapterText('Archive'));
    expect(run.reply().lines).toEqual(['chapters/F2.md was not checked', 'Next: run check for these chapters, then assemble again']);
    run.check('F2');
    run.write('F1', `${chapterText()}\nMore.\n`);
    expect(run.reply().lines[0]).toBe('chapters/F1.md changed after its check');
    writeFileSync(join(run.out, 'state.json'), `${JSON.stringify({ format: 'excavator-product-handbook-state/1', units: {} })}\n`);
    const old = run.reply();
    expect(old.status).toBe(1);
    expect(old.lines).toEqual(['state.json is from an older version of this skill (excavator-product-handbook-state/1); run again with --fresh']);
  });
});
