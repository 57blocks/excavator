// Oracle O1 (assembly half) of openspec change handbook-free-chapter: a checked /3
// entry goes into handbook.md and the page marked as not verified, the product view
// carries no citation and the technical view keeps them, the coverage section counts
// the not-verified features and their content notes, the sequence diagram comes from
// the chapter, the aggregations read the fact sheet the same way they read a /2 entry,
// the cross-cutting topics read the chapter items, a /3 entry is never sliced, and
// a later state write keeps the chapter.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { itemClaims } from '../../../skills/excavator-product-handbook/lib/claims.mjs';
import { identityKeys } from '../../../skills/excavator-product-handbook/lib/name-keys.mjs';
import { restorePageData, splitPageData } from '../../../skills/excavator-product-handbook/lib/page-units.mjs';
import { setUnitState } from '../../../skills/excavator-product-handbook/lib/unit.mjs';
import { trimEntry } from '../../../skills/excavator-product-handbook/lib/trim-entry.mjs';
import { FORM, GOOD_CHAPTER, goodEntryV3 } from './chapter-fixture.mjs';
import { clone, makeCheckedMapRun, runHandbook, verifyChecked } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const NO_LEGACY = { env: { EXCAVATOR_HANDBOOK_ALLOW_V2_ENTRY: '' } };
const ui = JSON.parse(readFileSync(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url), 'utf-8')).strings;
const MARK = ui['md.feature.unverified'];
const CHIP = ui['md.status.unverified'];
const ev = (file, passage) => ({ file, passage });

const STUB = '<!doctype html><html lang="und"><head><meta charset="UTF-8"><!-- xv:csp --></head><body><div id="root"></div><!-- xv:data --></body></html>';
const stubDir = mkdtempSync(join(tmpdir(), 'xhb-stub-'));
const stubPath = join(stubDir, 'template.html');
writeFileSync(stubPath, STUB);
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

/** The run with its domains file written and a `strict` command that runs without the variable that lets a /2 entry pass check-entry. */
function twoRun() {
  const run = makeCheckedMapRun();
  cleanups.push(run.cleanup);
  run.writeDomains();
  run.strict = (command, ...args) => runHandbook([command, run.out, ...args, '--project', run.root], NO_LEGACY);
  return run;
}

/** A checked map run with the chapter and the /3 entry of F1 written and checked. */
function v3Run({ chapter = GOOD_CHAPTER, entry = goodEntryV3() } = {}) {
  const run = twoRun();
  mkdirSync(join(run.out, 'chapters'), { recursive: true });
  writeFileSync(join(run.out, 'chapters', 'F1.md'), chapter);
  run.writeEntry('F1', entry);
  const checked = run.strict('check-entry', 'F1');
  expect(checked.status, `${checked.stdout}${checked.stderr}`).toBe(0);
  return run;
}

const read = (run, name) => readFileSync(join(run.out, name), 'utf-8');
const assembled = (run, views) => {
  const result = run.strict('assemble', ...(views === undefined ? [] : ['--views', views]));
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  return result;
};
const pageData = (run, views) => {
  const result = runHandbook(['page', run.out, '--project', run.root, ...(views === undefined ? [] : ['--views', views])], { env: { ...process.env, ...NO_LEGACY.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  return JSON.parse(/<script type="application\/json" id="xv-product-handbook-data">([\s\S]*?)<\/script>/.exec(read(run, 'handbook.html'))[1]);
};
const sectionOf = (body, from, to) => {
  const start = body.indexOf(from);
  expect(start, from).toBeGreaterThanOrEqual(0);
  const end = to === undefined ? -1 : body.indexOf(to, start + from.length);
  return end === -1 ? body.slice(start) : body.slice(start, end);
};

describe('a checked /3 entry in handbook.md', () => {
  it('is written with the not-verified mark first and its chapter text, without any citation, in the product view', () => {
    const run = v3Run();
    assembled(run);
    const md = read(run, 'handbook.md');
    const section = sectionOf(md, '### Orders\n', '\n### Archive');
    expect(section).toContain(MARK);
    expect(section.indexOf(MARK)).toBeLessThan(section.indexOf('The clerk fills in the'));
    expect(section).toContain('The clerk fills in the \u201cCustomer Name\u201d field.');
    expect(section).toContain('The item count is limited to 35000.');
    expect(section).toContain('| Clerk | Creates an order |');
    expect(section).not.toContain('order-form.js');
    expect(section).not.toContain('%%');
    expect(section).toContain('```mermaid');
    expect(section).toContain('C->>S: Sends the order');
    expect(section).toContain('S-->>C: Confirms the order');
    expect(md).not.toContain('src/forms/order-form.js:');
  });

  it('keeps the backticked citations and the %% lines in the technical view', () => {
    const run = v3Run();
    assembled(run, 'product,technical');
    const md = read(run, 'handbook-technical.md');
    const section = sectionOf(md, '### Orders\n', '\n### Archive');
    expect(section).toContain(MARK);
    expect(section).toContain('The item count is limited to 35000 (`src/forms/order-form.js:6`).');
    expect(section).toContain(`%% \`${FORM}:3-6\``);
  });

  it('marks the feature in the list of its domain', () => {
    const run = v3Run();
    assembled(run);
    const line = read(run, 'handbook.md').split('\n').find((row) => row.startsWith('  - Orders'));
    expect(line, 'the list row of F1').toBeDefined();
    expect(line).toContain(CHIP);
  });

  it('writes the quick reference of the fact sheet after the chapter', () => {
    const run = v3Run();
    assembled(run);
    const section = sectionOf(read(run, 'handbook.md'), '### Orders\n', '\n### Archive');
    expect(section).toContain(ui['md.section.factSheet']);
    expect(section.indexOf(ui['md.section.factSheet'])).toBeGreaterThan(section.indexOf('Confirms the order'));
    expect(section).toContain('Staff place new orders for customers.');
    expect(section).toContain('Draft');
  });

  it('counts the not-verified features and each kind of content note in the coverage section, and does not list the feature as unwritten', () => {
    const run = v3Run({ chapter: GOOD_CHAPTER.replace('limited to 35000', 'limited to 36000') });
    assembled(run);
    const coverage = sectionOf(read(run, 'handbook.md'), `## ${ui['md.coverage.heading']}`);
    expect(coverage).toContain(ui['md.coverage.unverifiedHeading']);
    expect(coverage).toContain('1 of 5 features are written but not verified.');
    expect(coverage).toContain('- F1 Orders: number 1, quote 0, code 0, advice 0, language 0');
    const unwritten = sectionOf(coverage, `### ${ui['md.coverage.unwrittenHeading']}`, `### ${ui['md.coverage.unverifiedHeading']}`);
    expect(unwritten).not.toContain('F1');
  });

  it('writes no not-verified part for a run with no /3 entry', () => {
    const run = twoRun();
    run.writeEntry('F1', clone(run.entry));
    expect(run.run('check-entry', 'F1').status).toBe(0);
    verifyChecked(run, 'F1');
    assembled(run);
    const md = read(run, 'handbook.md');
    expect(md).not.toContain(MARK);
    expect(md).not.toContain(ui['md.coverage.unverifiedHeading']);
  });

  it('keeps a verified /2 feature as it was, next to a /3 one: the mark appears once', () => {
    const run = v3Run();
    const second = clone(run.entry);
    second.id = 'F2';
    run.writeEntry('F2', second);
    expect(run.run('check-entry', 'F2').status).toBe(0);
    verifyChecked(run, 'F2');
    assembled(run);
    const md = read(run, 'handbook.md');
    expect(md.split(MARK).length - 1).toBe(1);
    expect(md).toContain('#### Place an order');
  });

  it('is refused when the chapter changed after it was checked', () => {
    const run = v3Run();
    writeFileSync(join(run.out, 'chapters', 'F1.md'), `${GOOD_CHAPTER}\nA sentence with no citation.\n`);
    const result = run.strict('assemble');
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/F1: .*chapters\/F1\.md/);
  });
});

describe('a checked /3 entry on the page', () => {
  it('splits into pieces with one piece for each block of the chapter and restores to the same data', () => {
    const data = pageData(v3Run(), 'product,technical');
    const { core, units } = splitPageData(data);
    const unit = [...units()].find((one) => one.key === 'feature:F1');
    expect(unit.pieces.filter((piece) => 'chapterBlock' in piece)).toHaveLength(9);
    expect(core.features[0].entry).toBeNull();
    expect(restorePageData(core, [...units()])).toEqual(data);
  });

  it('is in the data as not verified, with the blocks of its chapter and no citation in the product part', () => {
    const run = v3Run();
    const data = pageData(run);
    const feature = data.features.find((one) => one.id === 'F1');
    expect(feature.unverified).toBe(true);
    expect(data.features.find((one) => one.id === 'F2')).not.toHaveProperty('unverified');
    expect(feature.entry.chapter.map((block) => block.kind)).toEqual(['heading', 'heading', 'paragraph', 'paragraph', 'list', 'list', 'paragraph', 'table', 'diagram']);
    expect(feature.entry.chapter[2].text).toBe('The clerk fills in the \u201cCustomer Name\u201d field. The item count is limited to 35000.');
    expect(feature.entry.chapter[7]).toEqual({ kind: 'table', header: ['Role', 'Can do'], rows: [['Clerk', 'Creates an order']] });
    expect(feature.entry.chapter[8]).toEqual({
      kind: 'diagram',
      sequence: { participants: ['Clerk', 'System'], steps: [{ from: 0, to: 1 }, { from: 1, to: 0 }] },
      arrows: ['Sends the order', 'Confirms the order'],
    });
    expect(feature.entry.operations).toEqual([]);
    expect(JSON.stringify(data)).not.toContain('order-form.js:');
    expect(data.technical).toBeUndefined();
    expect(data.coverage.unverified).toEqual([{ feature: 'F1', notes: { number: 0, quote: 0, code: 0, advice: 0, language: 0 } }]);
  });

  it('puts the citations of the chapter items into the technical locations', () => {
    const run = v3Run();
    const data = pageData(run, 'product,technical');
    const unit = data.technical.locations.find((one) => one.id === 'F1');
    const item = unit.items.find((one) => one.claim.includes('The item count is limited to 35000'));
    expect(item.citations).toEqual([{ file: FORM, startLine: 6, endLine: 6 }]);
  });
});

/** The F1 content both formats share: a hand-over to F3 (another domain), a transition, a notification. */
function sharedContent(entry) {
  const form = FORM;
  const statuses = "const statuses = ['Draft', 'Submitted'];";
  const handoff = { feature: 'F3', text: 'Sent orders are reminded about every day.', evidence: [ev(form, statuses)] };
  entry.states = [
    { label: 'Draft', meaning: 'The order is not sent yet.', evidence: [ev(form, statuses)] },
    { label: 'Submitted', meaning: 'The order was sent.', evidence: [ev(form, statuses)] },
  ];
  entry.transitions = [{ from: 'Draft', to: 'Submitted', by: 'The clerk sends the order.', evidence: [ev(form, statuses)] }];
  entry.notifications = [{ trigger: 'An order is sent', recipient: 'Approver', channel: 'Email', content: 'The approver learns of the order.', evidence: [ev(form, statuses)] }];
  entry.unknowns = [{ item: 'Who approves a large order', searched: 'the order form and the routes of the orders area' }];
  return handoff;
}

describe('the aggregations read a /3 fact sheet as they read a /2 entry', () => {
  it('gives the same relations, matrices, notifications, open questions and glossary for the same content', () => {
    const three = goodEntryV3();
    three.handoffs = [sharedContent(three)];
    const runThree = v3Run({ entry: three });

    const runTwo = twoRun();
    const two = clone(runTwo.entry);
    const handoff = sharedContent(two);
    two.operations[0].handoffs = [handoff];
    runTwo.writeEntry('F1', two);
    expect(runTwo.run('check-entry', 'F1').status).toBe(0);
    verifyChecked(runTwo, 'F1');

    const viewOf = (data) => ({
      domains: data.entities.domains.map((domain) => ({ id: domain.id, purposes: domain.purposes, relations: domain.relations, states: domain.states, transitions: domain.transitions })),
      flows: data.entities.domainFlows,
      roles: data.entities.roles,
      roleFeature: data.entities.roleFeature,
      notifications: data.summary.notifications,
      open: data.appendix.open,
      glossary: data.appendix.glossary,
    });
    const fromThree = viewOf(pageData(runThree));
    const fromTwo = viewOf(pageData(runTwo));
    expect(fromThree.flows).toEqual([{ from: 'D1', to: 'D2', count: 1 }]);
    expect(fromThree.notifications).toHaveLength(1);
    expect(fromThree.glossary.length).toBeGreaterThan(0);
    expect(fromThree).toEqual(fromTwo);

    const section = (run) => sectionOf(read(run, 'handbook.md'), `## ${ui['md.summary.notifications.heading']}`, `## ${ui['md.summary.jobs.heading']}`);
    assembled(runThree);
    assembled(runTwo);
    const rows = (text) => text.split('\n').filter((line) => line.startsWith('|'));
    expect(rows(section(runThree))).toEqual(rows(section(runTwo)));
  });
});

describe('the counts labelled verified leave out a checked /3 entry', () => {
  // The overview counts every written entry, a checked /3 included (openspec change handbook-run-precision); the notifications summary
  // still counts the fact sheets that list notifications, so a /3 entry stays out of it.
  it('counts both features in the overview for a verified /2 and a checked /3, and one in the notifications summary', () => {
    const run = v3Run();
    const second = clone(run.entry);
    second.id = 'F2';
    run.writeEntry('F2', second);
    expect(run.run('check-entry', 'F2').status).toBe(0);
    verifyChecked(run, 'F2');
    const data = pageData(run);
    expect(data.system.counts.featuresWithEntry).toBe(2);
    expect(data.summary.counts.featuresWithEntry).toBe(1);
    expect(data.system.domains.find((row) => row.id === 'D1').verified).toBe(2);
    expect(data.system.areas.find((row) => row.id === 'A1').verified).toBe(2);
    expect(data.appendix.sources.parts.find((row) => row.id === 'features').verified).toBe(1);
    assembled(run);
    expect(read(run, 'handbook.md')).toContain('Features with an entry: 2.');
  });
});

describe('the cross-cutting topics read a checked /3 entry', () => {
  it('lists its chapter items as <feature id>#chapter.<n> and marks every line of it as not verified', () => {
    const run = v3Run();
    const facts = run.strict('topic-facts', '--lane', 'D1');
    expect(facts.status, `${facts.stdout}${facts.stderr}`).toBe(0);
    const rows = facts.lines.filter((line) => !line.startsWith('domain:')).map((line) => line.split('\t'));
    const sentence = rows.find((row) => row[0] === 'F1#chapter.4');
    expect(sentence, 'the row of chapter.4').toBeDefined();
    expect(sentence[3]).toBe('Orders > Placing an order: The item count is limited to 35000.');
    expect(rows.find((row) => row[0] === 'F1#chapter.1'), 'a heading is no fact').toBeUndefined();
    expect(rows.find((row) => row[0] === 'F1#who[0]'), 'the fact sheet keeps its path form').toBeDefined();
    for (const row of rows.filter((one) => one[0].startsWith('F1#'))) expect(row.at(-1), row[0]).toBe(CHIP);
  });

  it('leaves a verified /2 entry\'s lines with no mark', () => {
    const run = twoRun();
    run.writeEntry('F1', clone(run.entry));
    expect(run.run('check-entry', 'F1').status).toBe(0);
    verifyChecked(run, 'F1');
    const facts = run.run('topic-facts', '--lane', 'D1');
    expect(facts.status).toBe(0);
    expect(facts.stdout).not.toContain(CHIP);
  });
});

describe('a /3 entry is never sliced', () => {
  it('slices exits 1 with one line that says /3 entries are not verified in this version, and writes nothing', () => {
    const run = v3Run();
    for (const command of [['slices', 'F1'], ['verdicts', 'F1', '--round', '1']]) {
      const result = run.strict(...command);
      expect(result.status, command.join(' ')).toBe(1);
      expect(result.lines, command.join(' ')).toEqual(['F1: /3 entries are not verified in this version; the handbook writes a checked one marked as not verified']);
    }
    expect(run.readJson('state.json').features.F1.status).toBe('checked');
  });

  it('claims, trimming and the name keys do not throw on a fact sheet', () => {
    const entry = goodEntryV3();
    expect(() => itemClaims(entry, ui)).not.toThrow();
    expect(() => trimEntry(entry, new Set())).not.toThrow();
    expect(() => identityKeys('feature', entry)).not.toThrow();
  });
});

describe('state writers keep the chapter', () => {
  it('carries chapter over every later write of the feature, and mark failed keeps it', () => {
    const run = v3Run();
    const before = run.readJson('state.json').features.F1.chapter;
    expect(before.items.length).toBeGreaterThan(0);
    const state = { features: { F1: { status: 'checked', attempts: 1, chapter: before } } };
    setUnitState(state, 'F1', { status: 'confirmed', attempts: 1, entryDigest: 'x' });
    expect(state.features.F1.chapter).toBe(before);
    setUnitState(state, 'F1', { status: 'checked', attempts: 1, chapter: { items: [], notes: [] } });
    expect(state.features.F1.chapter).toEqual({ items: [], notes: [] });
    const marked = run.strict('mark', 'F1', 'failed', 'lane', 'the lane wrote nothing');
    expect(marked.status, `${marked.stdout}${marked.stderr}`).toBe(0);
    expect(run.readJson('state.json').features.F1.chapter).toEqual(before);
  });
});
