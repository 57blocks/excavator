// O2 of openspec change handbook-outline: with an outline, the second-level headings of handbook.md are the chapter
// titles in the outline's order (no part level); without a usable outline they are the default order with the fixed
// titles, and the coverage section says which outline was used and lists the blocks left out with their reasons.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SHIPPED_UI, clone, makeCheckedMapRun, runHandbook, verifyChecked } from './helpers.mjs';
import { goodOutline, outlineWithout, writeOutline } from './outline-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const UI = JSON.parse(readFileSync(SHIPPED_UI, 'utf-8')).strings;

function verifiedRun() {
  const run = makeCheckedMapRun();
  cleanups.push(run.cleanup);
  run.writeEntry('F1', clone(run.entry));
  expect(run.run('check-entry', 'F1').status).toBe(0);
  verifyChecked(run);
  return run;
}

const assemble = (run) => {
  const result = run.run('assemble', '--views', 'product,technical');
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  return { product: readFileSync(join(run.out, 'handbook.md'), 'utf-8'), technical: readFileSync(join(run.out, 'handbook-technical.md'), 'utf-8') };
};

/** The second-level headings of a handbook, outside fenced blocks. */
function chapters(text) {
  let fenced = false;
  const out = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    else if (!fenced && line.startsWith('## ')) out.push(line.slice(3));
  }
  return out;
}
const sectionOf = (text, heading) => {
  const start = text.indexOf(`\n## ${heading}\n`);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const next = text.indexOf('\n## ', start + 4);
  return text.slice(start, next === -1 ? undefined : next);
};

/** The titles of the chapters a run writes: the blocks that have no lines in a run with nothing verified to write them from (the recommendations) are not written. */
const NO_LINES = ['recommendations'];
const titlesOf = (outline, technical) => outline.parts.flatMap((part) => part.chapters)
  .filter((c) => !NO_LINES.includes(c.block))
  .filter((c) => technical || !['architecture', 'data', 'applications-matrix', 'dictionaries', 'applications', 'systems'].includes(c.block ?? c.list))
  .map((c) => c.title);

describe('assemble with an outline', () => {
  it('writes the chapters in the outline order under the chapter titles, coverage last, and no part titles', () => {
    const run = verifiedRun();
    const outline = goodOutline();
    writeOutline(run, outline);
    const { product, technical } = assemble(run);
    expect(chapters(product)).toEqual([...titlesOf(outline, false), UI['md.coverage.heading']]);
    expect(chapters(technical)).toEqual([...titlesOf(outline, true), UI['md.coverage.heading']]);
    for (const part of outline.parts) expect(product).not.toContain(part.title);
  });

  it('follows a different order: the order is the outline\'s, not the old fixed one', () => {
    const run = verifiedRun();
    const outline = goodOutline();
    outline.parts = [outline.parts[3], outline.parts[0], outline.parts[1], outline.parts[2]];
    writeOutline(run, outline);
    const { product } = assemble(run);
    expect(chapters(product)).toEqual([...titlesOf(outline, false), UI['md.coverage.heading']]);
    expect(chapters(product)[0]).toBe('How the code changed');
  });

  it('puts the content of a block under its chapter: the flow diagram under the business chapter, the domain features under the domains chapter', () => {
    const run = verifiedRun();
    writeOutline(run);
    const { product, technical } = assemble(run);
    expect(sectionOf(product, 'How work moves')).toContain(UI['md.entities.domains.flowNone']);
    expect(sectionOf(product, 'Work areas')).toContain('Order handling');
    expect(sectionOf(product, 'Work areas')).toContain(UI['md.section.operations']);
    expect(sectionOf(product, 'What this product is')).toContain(UI['md.overview.applicationsHeading']);
    expect(sectionOf(technical, 'How it is built')).toContain(UI['md.entities.systems.diagramNone']);
    expect(sectionOf(technical, 'Status meanings')).toContain(UI['md.dict.notWritten']);
    expect(sectionOf(technical, 'Words used')).toContain(UI['md.appendix.glossaryNote']);
  });

  it('writes no chapter for a block that has no lines, as before the outline: the coverage section says why', () => {
    const run = verifiedRun();
    writeOutline(run);
    const { product } = assemble(run);
    expect(chapters(product)).not.toContain('What to do about it');
    expect(chapters(product)).toContain('Questions across areas');
    expect(sectionOf(product, UI['md.coverage.heading'])).toContain(UI['md.coverage.remediesHeading']);
  });

  it('keeps a block left out out of the text and lists it with its reason in the coverage section', () => {
    const run = verifiedRun();
    writeOutline(run, outlineWithout(['history', 'glossary']));
    const { product } = assemble(run);
    expect(chapters(product)).not.toContain('How the code changed');
    expect(product).not.toContain(UI['md.history.note']);
    const coverage = sectionOf(product, UI['md.coverage.heading']);
    expect(coverage).toContain(UI['md.coverage.outlineUnplacedHeading']);
    expect(coverage).toContain(`${UI['md.history.heading']}: Nothing readers need is in it.`);
    expect(coverage).toContain(`${UI['md.appendix.glossaryHeading']}: Nothing readers need is in it.`);
    expect(coverage).not.toContain(UI['md.coverage.outlineDefault']);
  });

  it('lists no left-out blocks when none is left out', () => {
    const run = verifiedRun();
    writeOutline(run);
    const { product } = assemble(run);
    expect(sectionOf(product, UI['md.coverage.heading'])).toContain(UI['md.coverage.outlineUsed']);
    expect(product).not.toContain(UI['md.coverage.outlineUnplacedHeading']);
  });
});

describe('assemble without a usable outline', () => {
  it('writes the default order under the fixed titles and says so in the coverage section', () => {
    const run = verifiedRun();
    const { product, technical } = assemble(run);
    expect(chapters(product)).toEqual([
      UI['page.nav.overview'], UI['page.nav.business'], UI['md.matrix.roleFeature.heading'], UI['page.nav.group.areas'], UI['page.nav.notifications'], UI['page.nav.jobs'], UI['page.nav.topics'],
      UI['md.history.heading'], UI['page.nav.findings'], UI['md.appendix.openHeading'], UI['md.appendix.glossaryHeading'], UI['md.appendix.sourcesHeading'], UI['md.coverage.heading'],
    ]);
    expect(chapters(technical).slice(0, 8)).toEqual([UI['page.nav.overview'], UI['page.nav.business'], UI['page.nav.architecture'], UI['md.data.heading'], UI['md.matrix.roleFeature.heading'], UI['md.matrix.applicationDomain.heading'], UI['md.dict.heading'], UI['page.nav.group.applications']]);
    const coverage = sectionOf(product, UI['md.coverage.heading']);
    expect(coverage).toContain(UI['md.coverage.outlineDefault']);
  });

  it('names the domains chapter for domains when the run has a domains file', () => {
    const run = verifiedRun();
    run.writeDomains();
    const { product } = assemble(run);
    expect(chapters(product)).toContain(UI['page.nav.group.domains']);
    expect(chapters(product)).not.toContain(UI['page.nav.group.areas']);
  });

  it('a file that fails check-outline falls back the same way, with every problem line in the coverage section', () => {
    const run = verifiedRun();
    const outline = goodOutline();
    outline.parts[0].chapters.push({ title: 'Again', block: 'history' });
    outline.parts[1].chapters.pop();
    writeOutline(run, outline);
    expect(run.run('check-outline').status).toBe(1);
    const { product } = assemble(run);
    expect(chapters(product)[0]).toBe(UI['page.nav.overview']);
    const coverage = sectionOf(product, UI['md.coverage.heading']);
    expect(coverage).toContain(UI['md.coverage.outlineFailed']);
    expect(coverage).toContain('history: placed more than once');
    expect(coverage).toContain('topics: not placed');
    expect(coverage).not.toContain(UI['md.coverage.outlineUsed']);
  });

  it('a file that is not JSON falls back with the reason', () => {
    const run = verifiedRun();
    rmSync(join(run.out, 'outline.json'), { force: true });
    run.writeJson(join(run.out, 'outline.json'), { format: 'x' });
    const { product } = assemble(run);
    expect(sectionOf(product, UI['md.coverage.heading'])).toContain(UI['md.coverage.outlineFailed']);
  });
});

describe('page data', () => {
  const STUB = '<!doctype html><html lang="und"><head><meta charset="UTF-8"><!-- xv:csp --></head><body><div id="root"></div><!-- xv:data --></body></html>';
  const stubDir = mkdtempSync(join(tmpdir(), 'xhb-stub-'));
  const stubPath = join(stubDir, 'template.html');
  writeFileSync(stubPath, STUB);
  afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

  const pageData = (run) => {
    const result = runHandbook(['page', run.out, '--project', run.root, '--views', 'product,technical'], { env: { ...process.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    return JSON.parse(/<script type="application\/json" id="xv-product-handbook-data">([\s\S]*?)<\/script>/.exec(readFileSync(join(run.out, 'handbook.html'), 'utf-8'))[1]);
  };

  it('carries the written outline: parts, chapters with their block or list and their view, and the blocks left out', () => {
    const run = verifiedRun();
    const outline = outlineWithout(['history']);
    writeOutline(run, outline);
    const { outline: got, format } = pageData(run);
    expect(format).toBe('excavator-product-handbook-page/18');
    expect(got.source).toBe('outline');
    expect(got.problems).toEqual([]);
    expect(got.parts.map((part) => part.title)).toEqual(outline.parts.map((part) => part.title));
    expect(got.parts[0].chapters).toEqual([
      { title: 'What this product is', block: 'overview', technical: false },
      { title: 'How work moves', block: 'business', technical: false },
      { title: 'Work areas', list: 'domains', technical: false },
    ]);
    expect(got.parts[2].chapters.map((c) => [c.block ?? c.list, c.technical])).toEqual([['architecture', true], ['applications', true], ['systems', true], ['data', true], ['applications-matrix', true], ['dictionaries', true]]);
    expect(got.unplaced).toEqual([{ block: 'history', title: UI['md.history.heading'], reason: 'Nothing readers need is in it.' }]);
  });

  it('carries the default outline and the problem lines when the written one fails', () => {
    const run = verifiedRun();
    expect(pageData(run).outline).toMatchObject({ source: 'default', problems: [], unplaced: [] });
    const outline = goodOutline();
    outline.parts[1].chapters.pop();
    writeOutline(run, outline);
    const got = pageData(run).outline;
    expect(got.source).toBe('default');
    expect(got.problems).toEqual(['topics: not placed; put it in a chapter or in unplaced with a reason']);
    expect(got.parts.map((part) => part.title)).toEqual([UI['page.nav.group.system'], UI['page.nav.group.applications'], UI['page.nav.group.areas'], UI['page.nav.group.systems'], UI['page.nav.group.topics'], UI['page.nav.group.health'], UI['page.nav.group.appendix']]);
  });
});
