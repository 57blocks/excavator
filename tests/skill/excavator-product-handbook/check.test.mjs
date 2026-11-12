// Oracles O1 and O2 of openspec change handbook-skill-first: the check command finds each
// class of problem in a Markdown chapter (a red and a green sample per rule), never changes a
// chapter, records attempts by content, refuses an older state.json and gates the cross chapters.
// Non-English text is built from code points so that this file holds only ASCII.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeRun } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const FORM = 'src/forms/order-form.js';
const c = (range, file = FORM) => `\`${file}:${range}\``;
const wide = (...points) => String.fromCharCode(...points);

const GOOD = `# Orders

## Placing an order

The clerk fills in the "Customer Name" field (${c('5')}).

- An order is Draft until it is sent (${c('10')}).

## Open questions

Nobody can tell how long drafts live.

## Problems

None found.
`;

function newRun() {
  const run = makeRun();
  cleanups.push(run.cleanup);
  run.writeMap();
  mkdirSync(join(run.out, 'chapters'), { recursive: true });
  mkdirSync(join(run.root, 'node_modules'), { recursive: true });
  writeFileSync(join(run.root, 'node_modules', 'dep.js'), 'x\n');
  writeFileSync(join(run.root, 'src', 'long.js'), `${Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n')}\n`);
  run.write = (name, text) => writeFileSync(join(run.out, 'chapters', `${name}.md`), text);
  run.check = (...args) => run.run('check', ...args);
  return run;
}

/** `mutate(GOOD)` must fail F1 with a reason matching `expected`; GOOD itself passes in a fresh run. */
function rejects(name, mutate, expected, { file = 'F1' } = {}) {
  it(name, () => {
    const run = newRun();
    run.write(file, mutate(GOOD));
    const bad = run.check(file);
    expect(bad.status, bad.stdout + bad.stderr).toBe(1);
    expect(bad.stdout).toMatch(expected);
    run.write(file, GOOD);
    expect(run.check(file).status).toBe(0);
  });
}

/** `mutate(GOOD)` passes (an exempt shape). */
function accepts(name, mutate) {
  it(name, () => {
    const run = newRun();
    run.write('F1', mutate(GOOD));
    const result = run.check('F1');
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
}

describe('good chapter', () => {
  it('passes with the passed line and Next: go on', () => {
    const run = newRun();
    run.write('F1', GOOD);
    const result = run.check('F1');
    expect(result.lines).toEqual(['chapters/F1.md: passed', 'Next: go on']);
    expect(result.status).toBe(0);
  });
});

describe('A: citations', () => {
  rejects('a line past the end of the file', (t) => t.replace(c('10'), c('13')), /line \d+: citation `src\/forms\/order-form\.js:13`.*which has 12 lines/);
  rejects('a reversed range', (t) => t.replace(c('10'), c('9-3')), /line \d+: citation/);
  rejects('a span of 81 lines', (t) => t.replace(c('10'), c('1-81', 'src/long.js')), /81 lines; cite at most 80/);
  accepts('a span of 80 lines', (t) => t.replace(c('10'), c('1-80', 'src/long.js')));
  rejects('a path under node_modules', (t) => t.replace(c('10'), c('1', 'node_modules/dep.js')), /node_modules/);
  rejects('a path outside the project', (t) => t.replace(c('10'), c('1', '../x.js')), /leaves the project/);
  rejects('a citation inside a heading', (t) => t.replace('# Orders', `# Orders ${c('99')}`), /line 1: citation/);
});

describe('B: fact lines must cite', () => {
  rejects('an uncited paragraph sentence', (t) => t.replace(`field (${c('5')}).`, `field (${c('5')}). Orders can be cancelled.`), /line 5: a fact without a citation: Orders can be cancelled\./);
  rejects('an uncited list item', (t) => t.replace(`- An order is Draft until it is sent (${c('10')}).`, '- An order is Draft until it is sent.'), /line 7: a fact without a citation: An order is Draft/);
  rejects('an uncited table data row', (t) => t.replace('## Open questions', '| Role | Can do |\n| --- | --- |\n| Clerk | Creates an order |\n\n## Open questions'), /a fact without a citation: \| Clerk/);
  accepts('a cited table data row, header and separator without citations', (t) => t.replace('## Open questions', `| Role | Can do |\n| --- | --- |\n| Clerk | Creates an order ${c('1', 'src/roles.js')} |\n\n## Open questions`));
  accepts('a lead-in line ending with a colon', (t) => t.replace('## Open questions', `Who can do what:\n\n| Role | Can do |\n| --- | --- |\n| Clerk | Creates an order ${c('1', 'src/roles.js')} |\n\n## Open questions`));
  accepts('a lead-in with a full-width colon', (t) => t.replace('## Open questions', `${wide(0x89d2, 0x8272)}${wide(0xff1a)}\n\n- Clerk ${c('1', 'src/roles.js')}\n\n## Open questions`));
  accepts('a fenced block without citations', (t) => t.replace('## Open questions', '```text\nplain words\nwithout citations\n```\n\n## Open questions'));
  accepts('the open questions section holds uncited lines', (t) => t.replace('Nobody can tell how long drafts live.', 'Nobody can tell how long drafts live.\n\n- Is a draft kept?\n\n| Q | A |\n| --- | --- |\n| Who | Unknown |'));
  accepts('a fixed-text line (None found.) under Problems', (t) => t);
  accepts('the not-verified fixed line as a quote', (t) => t.replace('## Open questions', '> Not verified: this chapter was written by a model from the source code, and its sentences were not checked one by one against the code.\n\n## Open questions'));
  accepts('the not-passed fixed line with a count', (t) => t.replace('None found.', 'This chapter did not pass the final check; 3 problems remain, and the chapter is kept as written.'));
  rejects('an uncited sentence after a dotted path in a citation', (t) => t.replace(`(${c('5')}).`, `(${c('5')}). It also holds ${c('2', 'src/menu.js')} and more. Third without any.`), /a fact without a citation: Third without any\./);
});

describe('C: paragraph length', () => {
  const five = (extra) => `A one (${c('1', 'src/roles.js')}). B two (${c('2', 'src/menu.js')}). C three (${c('5')}). D four (${c('6')}). ${extra}`;
  rejects('a 5-sentence paragraph, dotted paths in citations not counted', (t) => t.replace(`The clerk fills in the "Customer Name" field (${c('5')}).`, five(`E five (${c('9')}).`)), /line 5: a paragraph of 5 sentences; at most 4/);
  accepts('a 4-sentence paragraph whose citations hold many dots', (t) => t.replace(`The clerk fills in the "Customer Name" field (${c('5')}).`, five('').trim()));
  it('counts sentences ended by full-width enders', () => {
    const run = newRun();
    const sentence = `${wide(0x4e00, 0x4e8c)}${c('5')}${wide(0x3002)}`;
    run.write('F1', GOOD.replace(`The clerk fills in the "Customer Name" field (${c('5')}).`, sentence.repeat(5)));
    const bad = run.check('F1');
    expect(bad.stdout).toMatch(/a paragraph of 5 sentences/);
    run.write('F1', GOOD.replace(`The clerk fills in the "Customer Name" field (${c('5')}).`, sentence.repeat(4)));
    expect(run.check('F1').status).toBe(0);
  });
  it('flags an uncited full-width sentence', () => {
    const run = newRun();
    run.write('F1', GOOD.replace(`The clerk fills in the "Customer Name" field (${c('5')}).`, `${wide(0x4e00)}${c('5')}${wide(0x3002)}${wide(0x4e8c, 0x4e09)}${wide(0x3002)}`));
    expect(run.check('F1').stdout).toContain(`a fact without a citation: ${wide(0x4e8c, 0x4e09, 0x3002)}`);
  });
});

describe('D: list or table in a feature chapter', () => {
  const noList = (t) => t.replace(/- An order is Draft[^\n]*\n/, `A draft stays Draft until it is sent (${c('10')}).\n`);
  rejects('a feature chapter without a list or a table', noList, /no list or table; write fields, steps and rules as lists or tables/);
  it('a system chapter does not need one', () => {
    const run = newRun();
    run.write('system', noList(GOOD));
    expect(run.check('system').status).toBe(0);
  });
});

describe('E: mermaid', () => {
  const diagram = (first) => (t) => t.replace('## Open questions', `\`\`\`mermaid\n${first}\n  A --> B\n\`\`\`\n\n## Open questions`);
  rejects('a mermaid block that does not start with a diagram type', diagram('A --> B'), /a mermaid block must start with a diagram type, found: A --> B/);
  accepts('a flowchart block', diagram('flowchart TD'));
  accepts('a stateDiagram-v2 block', diagram('stateDiagram-v2'));
});

describe('F: code-shaped words', () => {
  rejects('a camelCase word outside quotes', (t) => t.replace('The clerk fills in', 'The orderForm fills in'), /line 5: "orderForm" is not allowed in reader text \(camelCase identifier\)/);
  accepts('the same word inside quotes', (t) => t.replace('"Customer Name"', '"orderForm"'));
  rejects('a snake_case word in a list item', (t) => t.replace('An order is Draft', 'An order_row is Draft'), /"order_row" is not allowed/);
  rejects('a call form in a heading', (t) => t.replace('## Placing an order', '## Placing an order()'), /line 3: "order\(" is not allowed/);
  accepts('a citation path is not reader text', (t) => t);
});

describe('G: advice words', () => {
  rejects('an advice word in a feature chapter', (t) => t.replace('Nobody can tell', 'Nobody can say whether to improve'), /"improve" is a word of advice; only the remedies chapter gives advice/);
  it('the remedies chapter may use advice words', () => {
    const run = newRun();
    run.write('remedies', `# Remedies\n\nWe recommend a change (${c('5')}).\n`);
    const result = run.check('remedies');
    expect(result.status, result.stdout).toBe(0);
  });
  it('another cross chapter may not', () => {
    const run = newRun();
    run.write('findings', `# Findings\n\nWe recommend a change (${c('5')}).\n`);
    expect(run.check('findings').stdout).toMatch(/"recommend" is a word of advice/);
  });
});

describe('H: sections', () => {
  rejects('a missing Problems section', (t) => t.replace(/## Problems[\s\S]*$/, ''), /missing the section "Problems"/);
  rejects('a missing Open questions section', (t) => t.replace(/## Open questions\n\nNobody can tell how long drafts live\.\n\n/, ''), /missing the section "Open questions"/);
  it('a cross chapter does not need them', () => {
    const run = newRun();
    run.write('domains', `# Domains\n\n- Orders (${c('5')})\n`);
    expect(run.check('domains').status).toBe(0);
  });
});

describe('the command', () => {
  it('never changes a chapter file', () => {
    const run = newRun();
    const bad = GOOD.replace('Draft until', 'Draft until').replace(`(${c('10')})`, '');
    run.write('F1', bad);
    run.write('F2', GOOD);
    const before = [readFileSync(join(run.out, 'chapters', 'F1.md')), readFileSync(join(run.out, 'chapters', 'F2.md'))];
    run.check();
    run.check('F1');
    const after = [readFileSync(join(run.out, 'chapters', 'F1.md')), readFileSync(join(run.out, 'chapters', 'F2.md'))];
    expect(after[0].equals(before[0])).toBe(true);
    expect(after[1].equals(before[1])).toBe(true);
  });

  it('checks every chapter when none is named, and takes names with or without .md', () => {
    const run = newRun();
    run.write('F1', GOOD);
    run.write('F2', GOOD.replace(c('10'), c('13')));
    const all = run.check();
    expect(all.status).toBe(1);
    expect(all.stdout).toContain('chapters/F1.md: passed');
    expect(all.stdout).toContain('chapters/F2.md: failed (attempt 1)');
    expect(all.lines.at(-1)).toMatch(/^Next: delete each failed chapter whose attempt is 1/);
    expect(run.check('F1.md').lines).toEqual(['chapters/F1.md: passed', 'Next: go on']);
  });

  it('reports an unknown chapter and still checks the others', () => {
    const run = newRun();
    run.write('F1', GOOD);
    run.write('extra', GOOD);
    const result = run.check();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('chapters/F1.md: passed');
    expect(result.stdout).toContain('chapters/extra.md: failed');
    expect(result.stdout).toContain('  - unknown chapter');
    expect(JSON.parse(readFileSync(join(run.out, 'state.json'), 'utf-8')).chapters.extra).toBeUndefined();
  });

  it('records attempts by content: same bytes keep the attempt, changed bytes add one', () => {
    const run = newRun();
    const bad = GOOD.replace(c('10'), c('13'));
    run.write('F1', bad);
    expect(run.check('F1').stdout).toContain('failed (attempt 1)');
    expect(run.check('F1').stdout).toContain('failed (attempt 1)');
    run.write('F1', bad.replace('Draft', 'Open'));
    expect(run.check('F1').stdout).toContain('failed (attempt 2)');
    const state = JSON.parse(readFileSync(join(run.out, 'state.json'), 'utf-8'));
    expect(state.format).toBe('excavator-product-handbook-state/2');
    expect(state.chapters.F1.status).toBe('failed');
    expect(state.chapters.F1.attempts).toBe(2);
    expect(state.chapters.F1.reasons[0]).toMatch(/^line \d+: citation/);
    expect(state.chapters.F1.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(run.out, 'state.json.lock'))).toBe(false);
  });

  it('--no-record prints the same without a count and writes nothing', () => {
    const run = newRun();
    run.write('F1', GOOD.replace(c('10'), c('13')));
    const first = run.check('F1', '--no-record');
    expect(first.status).toBe(1);
    expect(first.lines[0]).toBe('chapters/F1.md: failed');
    run.check('F1', '--no-record');
    expect(existsSync(join(run.out, 'state.json'))).toBe(false);
    expect(run.check('F1').stdout).toContain('failed (attempt 1)');
    const written = readFileSync(join(run.out, 'state.json'), 'utf-8');
    run.check('F1', '--no-record');
    expect(readFileSync(join(run.out, 'state.json'), 'utf-8')).toBe(written);
  });

  it('refuses --no-record together with --before cross', () => {
    const run = newRun();
    const result = run.check('--before', 'cross', '--no-record');
    expect(result.status).toBe(2);
    expect(existsSync(join(run.out, 'state.json'))).toBe(false);
  });

  it('refuses a state.json of format /1 and changes nothing', () => {
    const run = newRun();
    run.write('F1', GOOD);
    const old = `${JSON.stringify({ format: 'excavator-product-handbook-state/1', units: {} })}\n`;
    writeFileSync(join(run.out, 'state.json'), old);
    for (const args of [['F1'], ['--before', 'cross']]) {
      const result = run.check(...args);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('state.json is from an older version of this skill (excavator-product-handbook-state/1); run again with --fresh');
    }
    expect(readFileSync(join(run.out, 'state.json'), 'utf-8')).toBe(old);
  });
});

describe('--before cross', () => {
  const ids = ['F1', 'F2', 'F3', 'F4', 'F5'];
  it('lists the features without a checked chapter, then reports ready (failed twice counts)', () => {
    const run = newRun();
    for (const id of ids.slice(0, 3)) run.write(id, GOOD);
    run.check('F1', 'F2', 'F3');
    const missing = run.check('--before', 'cross');
    expect(missing.status).toBe(1);
    expect(missing.lines).toEqual(['missing: F4', 'missing: F5', 'Next: write and check these features before the cross chapters']);

    run.write('F4', GOOD);
    run.write('F5', GOOD.replace(c('10'), c('13')));
    run.check('F4', 'F5');
    expect(run.check('--before', 'cross').lines).toEqual(['missing: F5', 'Next: write and check these features before the cross chapters']);
    run.write('F5', GOOD.replace(c('10'), c('12-13')));
    run.check('F5');
    const ready = run.check('--before', 'cross');
    expect(ready.status).toBe(0);
    expect(ready.lines).toEqual(['Cross chapters: ready (5 features)']);
  });

  it('says so when the map is missing', () => {
    const run = newRun();
    rmMap(run);
    const result = run.check('--before', 'cross');
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/map\.json is missing/);
  });
});

const rmMap = (run) => rmSync(join(run.out, 'map.json'));
