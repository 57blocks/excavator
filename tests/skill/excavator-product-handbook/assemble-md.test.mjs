// Oracle O3 of openspec change handbook-skill-first: assemble joins the checked Markdown chapters
// in the outline's or the default order, the product view holds no citation and the technical view
// every citation group as written, every chapter carries the fixed sentences, an unchecked or
// changed chapter refuses the run with nothing written, and the coverage section is last.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { HANDBOOK_SCRIPT } from './helpers.mjs';
import { CROSS, FORM, chapterText, cite, newMdRun } from './md-run-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
const make = (chapters, options) => {
  const run = newMdRun(chapters, options);
  cleanups.push(run.cleanup);
  return run;
};

const NOT_VERIFIED = 'Not verified: this chapter was written by a model from the source code, and its sentences were not checked one by one against the code.';
const ANY_CITATION = /`[^`\n]*:\d+(?:-\d+)?`/;
const outputs = (run) => ({ product: run.read('handbook.md'), technical: run.read('handbook-technical.md') });

describe('views', () => {
  it('product view: no citation, punctuation kept; technical view: every group byte for byte', () => {
    const run = make({ F1: chapterText('Orders'), system: chapterText('System') });
    const result = run.assemble('--views', 'product,technical');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const { product, technical } = outputs(run);
    expect(product).not.toMatch(ANY_CITATION);
    expect(product).not.toContain('order-form.js');
    expect(product).toContain('The clerk fills in the "Customer Name" field.');
    expect(product).toContain('- An order is Draft until it is sent.');
    expect(technical).toContain(`field (${cite('5')}).`);
    expect(technical).toContain(`- An order is Draft until it is sent (${cite('10')}).`);
    const asWritten = chapterText('Orders').replace('# Orders\n', `# Orders\n\n${NOT_VERIFIED}\n`).replace(/^(#{1,5}) /gm, '#$1 ');
    expect(technical).toContain(asWritten.trimEnd());
  });

  it('keeps table rows and cells, and never touches a fenced block', () => {
    const fence = `\`\`\`mermaid\nflowchart TD\n  A[\`${FORM}:5\`] --> B\n\`\`\``;
    const rows = `\n| Role | Can do |\n| --- | --- |\n| Clerk ${cite('1', 'src/roles.js')} | Creates an order ${cite('2', 'src/roles.js')} |\n| Approver | ${cite('1', 'src/roles.js')} |\n\n${fence}\n\n`;
    const text = chapterText('Orders', rows);
    const run = make({ F1: text });
    expect(run.check('F1').status, run.check('F1').stdout).toBe(0);
    expect(run.assemble().status).toBe(0);
    const product = run.read('handbook.md');
    expect(product).toContain('| Clerk | Creates an order |');
    expect(product).toContain('| Approver | |');
    expect(product).toContain(fence);
    const outside = product.replace(fence, '');
    expect(outside).not.toMatch(ANY_CITATION);
  });

  it('keeps the full-width full stop a citation group carried', () => {
    const wide = (...points) => String.fromCharCode(...points);
    const sentence = `${wide(0x4e00, 0x4e8c)} ${cite('5')}${wide(0x3002)}`;
    const run = make({ F1: chapterText('Orders').replace(`The clerk fills in the "Customer Name" field (${cite('5')}).`, sentence) });
    expect(run.check('F1').status).toBe(0);
    run.assemble();
    expect(run.read('handbook.md')).toContain(`${wide(0x4e00, 0x4e8c)}${wide(0x3002)}\n`);
  });

  it('the title is the only level-1 heading: every chapter heading moves one level down, fences untouched', () => {
    const fence = '```mermaid\nflowchart LR\n# not a heading\n```';
    const run = make({ F1: chapterText('Orders', `\n${fence}\n`), system: chapterText('System') });
    expect(run.check('F1').status).toBe(0);
    run.assemble('--views', 'product,technical');
    for (const text of Object.values(outputs(run))) {
      expect(text.replace(fence, '').split('\n').filter((line) => /^# /.test(line))).toHaveLength(1);
      expect(text).toContain('\n## Orders\n');
      expect(text).toContain('\n## System\n');
      expect(text).toContain(fence);
    }
  });

  it('writes only the selected views and removes the other file', () => {
    const run = make({ F1: chapterText() });
    run.assemble('--views', 'product,technical');
    expect(existsSync(join(run.out, 'handbook-technical.md'))).toBe(true);
    const result = run.assemble();
    expect(result.lines).toEqual([join(run.out, 'handbook.md')]);
    expect(existsSync(join(run.out, 'handbook-technical.md'))).toBe(false);
    run.assemble('--views', 'technical');
    expect(existsSync(join(run.out, 'handbook.md'))).toBe(false);
  });

  it('title: md.title and md.titleTechnical on top', () => {
    const run = make({ F1: chapterText() });
    run.assemble('--views', 'product,technical');
    const { product, technical } = outputs(run);
    expect(product.startsWith('# Product handbook\n')).toBe(true);
    expect(technical.startsWith('# Product handbook: technical view\n')).toBe(true);
  });
});

describe('fixed sentences', () => {
  it('every chapter carries the not-verified sentence right after its first heading, as its own paragraph', () => {
    const run = make({ F1: chapterText('Orders'), F2: chapterText('Archive'), system: chapterText('System') });
    run.assemble('--views', 'product,technical');
    for (const text of Object.values(outputs(run))) {
      expect(text.split(NOT_VERIFIED).length - 1).toBe(3);
      expect(text).toContain(`## Archive\n\n${NOT_VERIFIED}\n\n### Placing an order`);
    }
  });

  it('a chapter without a level-1 heading gets the sentence on top', () => {
    const run = make({ F1: chapterText('Orders').replace('# Orders\n\n', '') });
    run.assemble();
    expect(run.read('handbook.md')).toContain(`${NOT_VERIFIED}\n\n### Placing an order`);
  });

  it('a chapter that failed twice also says it did not pass, with its number of reasons', () => {
    const run = make({ F1: chapterText('Orders'), F2: chapterText('Archive').replace(cite('10'), cite('99')) }, { check: false });
    run.check();
    run.write('F2', chapterText('Archive').replace(cite('10'), cite('98')));
    run.check('F2');
    const state = JSON.parse(run.read('state.json'));
    expect(state.chapters.F2).toMatchObject({ status: 'failed', attempts: 2 });
    run.assemble('--views', 'product,technical');
    const notPassed = `This chapter did not pass the final check; ${state.chapters.F2.reasons.length} problems remain, and the chapter is kept as written.`;
    for (const text of Object.values(outputs(run))) {
      expect(text).toContain(`## Archive\n\n${NOT_VERIFIED}\n\n${notPassed}\n`);
      expect(text.split('problems remain').length - 1).toBe(1);
    }
  });
});

describe('refusals write nothing', () => {
  it('a chapter with no record', () => {
    const run = make({ F1: chapterText() });
    run.write('F2', chapterText('Archive'));
    const result = run.assemble();
    expect(result.status).toBe(1);
    expect(result.lines).toEqual(['chapters/F2.md was not checked', 'Next: run check for these chapters, then assemble again']);
    expect(existsSync(join(run.out, 'handbook.md'))).toBe(false);
  });

  it('a chapter that changed after its check', () => {
    const run = make({ F1: chapterText(), F2: chapterText('Archive') });
    run.write('F2', `${chapterText('Archive')}\n`);
    run.write('F1', chapterText('Orders').replace('Draft', 'Open'));
    const result = run.assemble('--views', 'product,technical');
    expect(result.status).toBe(1);
    expect(result.lines).toEqual(['chapters/F1.md changed after its check', 'chapters/F2.md changed after its check', 'Next: run check for these chapters, then assemble again']);
    expect(existsSync(join(run.out, 'handbook.md'))).toBe(false);
    expect(existsSync(join(run.out, 'handbook-technical.md'))).toBe(false);
  });

  it('a state.json of format /1', () => {
    const run = make({ F1: chapterText() });
    writeFileSync(join(run.out, 'state.json'), `${JSON.stringify({ format: 'excavator-product-handbook-state/1', units: {} })}\n`);
    const result = run.assemble();
    expect(result.status).toBe(1);
    expect(result.lines).toEqual(['state.json is from an older version of this skill (excavator-product-handbook-state/1); run again with --fresh']);
    expect(existsSync(join(run.out, 'handbook.md'))).toBe(false);
  });

  it('a chapter file that is no chapter of this run', () => {
    const run = make({ F1: chapterText() });
    run.write('F99', chapterText('Gone'));
    const result = run.assemble();
    expect(result.status).toBe(1);
    expect(result.lines).toEqual(['chapters/F99.md is not a chapter of this run: not system, a cross chapter or a feature id of map.json', 'Next: remove these files, then this command again']);
    expect(existsSync(join(run.out, 'handbook.md'))).toBe(false);
  });

  it('a map that no longer holds every candidate exactly once', () => {
    const run = make({ F1: chapterText() });
    const map = JSON.parse(run.read('map.json'));
    map.features[0].candidates.pop();
    writeFileSync(join(run.out, 'map.json'), `${JSON.stringify(map)}\n`);
    const result = run.assemble();
    expect(result.status).toBe(1);
    expect(result.lines[0]).toMatch(/^map\.json: .*not in any feature and not in unassigned/);
    expect(result.lines.at(-1)).toBe('Next: run check-map, then this command again');
    expect(existsSync(join(run.out, 'handbook.md'))).toBe(false);
  });

  it('a stale handbook of an earlier run stays untouched by a refusal', () => {
    const run = make({ F1: chapterText() });
    run.assemble();
    const before = run.read('handbook.md');
    run.write('F1', `${chapterText()}\nExtra.\n`);
    expect(run.assemble().status).toBe(1);
    expect(run.read('handbook.md')).toBe(before);
  });
});

describe('order', () => {
  const indexOfTitle = (text, title) => text.indexOf(`# ${title}\n`);
  const chapters = () => ({ system: chapterText('System'), F1: chapterText('Orders'), F2: chapterText('Archive'), domains: chapterText('Domains'), defects: chapterText('Defects'), remedies: chapterText('Remedies') });

  it('default order: system, domains, features in map order, defects, remedies', () => {
    const run = make({ ...chapters(), roles: chapterText('Roles'), notifications: chapterText('Notifications'), topics: chapterText('Topics') });
    const result = run.assemble();
    expect(result.lines).toEqual([join(run.out, 'handbook.md')]);
    const text = run.read('handbook.md');
    const order = ['System', 'Domains', 'Roles', 'Orders', 'Archive', 'Notifications', 'Topics', 'Defects', 'Remedies'].map((title) => indexOfTitle(text, title));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text.slice(text.indexOf('## Coverage'))).toContain('No outline was written for this project');
  });

  it('a valid outline sets the order and is named in the coverage section', () => {
    const run = make(chapters());
    run.writeJson(join(run.out, 'outline.json'), {
      format: 'excavator-product-handbook-outline/2',
      language: 'English',
      parts: [{ title: 'Orders first', chapters: ['F2', 'F1'] }, { title: 'Rest', chapters: ['system', 'domains', 'defects'] }],
      unplaced: [{ block: 'remedies', reason: 'Not wanted by this reader.' }],
    });
    const result = run.assemble();
    expect(result.lines).toEqual([join(run.out, 'handbook.md')]);
    const text = run.read('handbook.md');
    expect(indexOfTitle(text, 'Archive')).toBeLessThan(indexOfTitle(text, 'Orders'));
    expect(indexOfTitle(text, 'Orders')).toBeLessThan(indexOfTitle(text, 'System'));
    expect(text).not.toContain('# Remedies\n');
    const coverage = text.slice(text.indexOf('## Coverage'));
    expect(coverage).toContain('The chapters and their order are those of the outline written for this project.');
    expect(coverage).toContain('- Orders first: 2 chapters');
    expect(coverage).toContain('remedies: Not wanted by this reader.');
  });

  const broken = (name, doc, expected) => it(`outline that breaks conservation (${name}): default order, Outline: lines, exit 0`, () => {
    const run = make(chapters());
    run.writeJson(join(run.out, 'outline.json'), { format: 'excavator-product-handbook-outline/2', language: 'English', unplaced: [], ...doc });
    const result = run.assemble();
    expect(result.status, result.stdout).toBe(0);
    const problems = result.lines.filter((line) => line.startsWith('Outline: '));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).toMatch(expected);
    const text = run.read('handbook.md');
    expect(indexOfTitle(text, 'System')).toBeLessThan(indexOfTitle(text, 'Orders'));
    expect(indexOfTitle(text, 'Orders')).toBeLessThan(indexOfTitle(text, 'Archive'));
    const coverage = text.slice(text.indexOf('## Coverage'));
    expect(coverage).toContain('did not pass its check');
    for (const line of problems) expect(coverage).toContain(line);
  });
  broken('a block missing', { parts: [{ title: 'P', chapters: ['system', 'F1', 'F2', 'domains', 'defects'] }] }, /block "remedies" is neither/);
  broken('a block twice', { parts: [{ title: 'P', chapters: ['system', 'F1', 'F2', 'domains', 'defects', 'remedies', 'F1'] }] }, /"F1" is placed 2 times/);
  broken('an unknown block', { parts: [{ title: 'P', chapters: ['system', 'F1', 'F2', 'domains', 'defects', 'remedies', 'nope'] }] }, /"nope" is not a block/);
  broken('an empty part', { parts: [{ title: 'P', chapters: ['system', 'F1', 'F2', 'domains', 'defects', 'remedies'] }, { title: 'Empty', chapters: [] }] }, /part "Empty" is empty/);
  broken('an empty reason', { parts: [{ title: 'P', chapters: ['system', 'F1', 'F2', 'domains', 'defects'] }], unplaced: [{ block: 'remedies', reason: ' ' }] }, /unplaced\[0\] needs a block and a reason/);
  broken('a wrong format', { format: 'excavator-product-handbook-outline/1', parts: [] }, /format must be excavator-product-handbook-outline\/2/);
});

describe('coverage section', () => {
  it('is last and lists the unassigned, link-only, chapterless and failed items and the cross chapters waiting', () => {
    const run = make({ system: chapterText('System'), F1: chapterText('Orders'), F2: chapterText('Archive').replace(cite('10'), cite('99')) });
    const result = run.assemble();
    expect(result.status).toBe(0);
    const text = run.read('handbook.md');
    const coverage = text.slice(text.indexOf('## Coverage'));
    expect(text.trimEnd().endsWith(coverage.trimEnd())).toBe(true);
    expect(coverage).toContain('Entrypoint candidates listed:');
    expect(coverage).toContain('None is missing and none is counted twice.');
    expect(coverage).toContain('A health check that no reader uses.');
    expect(coverage).toMatch(/### Features reached only by a link\n\n- F2 Archive \(Order handling\)/);
    expect(coverage).toMatch(/### Features without a chapter\n\n- F3 Reminders \(Automatic work\)\n- F4 Admin tool \(Automatic work\)\n- F5 Orders \(Automatic work\)/);
    expect(coverage).toMatch(/### Chapters that did not pass the final check\n\n- F2: [1-9]\d* problems recorded/);
    for (const name of CROSS) expect(coverage).toContain(`- ${name}`);
    expect(coverage).toContain('These chapters wait for the features that have no chapter yet.');
    expect(coverage).toContain('No outline was written for this project');
  });

  it('with every feature written, no waiting sentence and no feature listed', () => {
    const chapters = Object.fromEntries(['system', 'F1', 'F2', 'F3', 'F4', 'F5', ...CROSS].map((name) => [name, chapterText(name)]));
    const run = make(chapters);
    run.assemble();
    const coverage = run.read('handbook.md');
    expect(coverage).toContain('Every feature has a chapter.');
    expect(coverage).toContain('Every chapter across the features is written.');
    expect(coverage).not.toContain('wait for the features');
  });
});

describe('blocks the scripts write', () => {
  it('data and dictionaries are technical-only, the code health is in both views, and the outline places them', () => {
    const run = make({ system: chapterText('System'), F1: chapterText('Orders') });
    const scripts = spawnSync(process.execPath, [HANDBOOK_SCRIPT, 'data', run.root, run.out], { encoding: 'utf-8' });
    expect(scripts.status, scripts.stdout + scripts.stderr).toBe(0);
    expect(run.run('history').status).toBe(0);
    expect(existsSync(join(run.out, 'data.json'))).toBe(true);
    expect(existsSync(join(run.out, 'entries', 'history.json'))).toBe(true);
    expect(run.assemble('--views', 'product,technical').status).toBe(0);
    const { product, technical } = outputs(run);
    expect(technical).toContain('\n## Data\n');
    expect(product).not.toContain('\n## Data\n');
    expect(product).toContain('\n## Code health\n');
    expect(technical).toContain('\n## Code health\n');
    expect(technical.indexOf('# Orders\n')).toBeLessThan(technical.indexOf('\n## Data\n'));
    expect(technical.indexOf('\n## Data\n')).toBeLessThan(technical.indexOf('\n## Code health\n'));
    run.writeJson(join(run.out, 'outline.json'), { format: 'excavator-product-handbook-outline/2', language: 'English', parts: [{ title: 'All', chapters: ['system', 'F1', 'history'] }], unplaced: [{ block: 'data', reason: 'Not for this reader.' }, { block: 'dictionaries', reason: 'Not for this reader.' }] });
    const placed = run.assemble();
    expect(placed.lines.filter((line) => line.startsWith('Outline:'))).toEqual([]);
  });
});
