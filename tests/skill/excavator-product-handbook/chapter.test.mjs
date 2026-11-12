// Oracle O1 of openspec change handbook-free-chapter, chapter half: check-chapter
// accepts a good chapter and a lead-in, rejects each class of bad chapter with the
// item id and a reason, reports the counts; the parse cuts items at citation
// groups and keeps ids stable; rendering with items removed treats each kind of block.
// Every rejection is a pair: the bad chapter fails with its line, then the good one passes.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseChapter } from '../../../skills/excavator-product-handbook/lib/chapter-parse.mjs';
import { renderChapter } from '../../../skills/excavator-product-handbook/lib/chapter-render.mjs';
import { FORM, GOOD_CHAPTER, GOOD_COUNTS, NO_NOTES } from './chapter-fixture.mjs';
import { MARK, latinUi, makeCheckedMapRun, markedMap, makeRun, translatedUi } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

function newRun() {
  const run = makeCheckedMapRun();
  cleanups.push(run.cleanup);
  run.writeChapter = (text, id = 'F1') => {
    mkdirSync(join(run.out, 'chapters'), { recursive: true });
    writeFileSync(join(run.out, 'chapters', `${id}.md`), text);
  };
  return run;
}

const check = (run) => run.run('check-chapter', 'F1');

/** A bad chapter (the good one through `mutate`) must fail with `expected`; the good one then passes. */
function rejects(name, mutate, expected, { prepare } = {}) {
  it(name, () => {
    const run = newRun();
    prepare?.(run);
    run.writeChapter(mutate(GOOD_CHAPTER));
    const bad = check(run);
    expect(bad.status, `${bad.stdout}${bad.stderr}`).toBe(1);
    expect(bad.stdout).toMatch(expected);
    run.writeChapter(GOOD_CHAPTER);
    const good = check(run);
    expect(good.status, `${good.stdout}${good.stderr}`).toBe(0);
  });
}

/** A content finding is a note, not a refusal: the chapter still passes (exit 0), prints `note:` with `expected`, and counts it by kind. */
function notes(name, mutate, expected, kind, { prepare } = {}) {
  it(`notes ${name} and does not refuse`, () => {
    const run = newRun();
    prepare?.(run);
    run.writeChapter(mutate(GOOD_CHAPTER));
    const result = check(run);
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    const line = result.lines.find((one) => one.startsWith('note: '));
    expect(line, result.stdout).toMatch(expected);
    expect(result.lines.at(-1)).toMatch(new RegExp(`^Notes: 1 .*${kind} 1`));
  });
}

describe('check-chapter: accepts', () => {
  it('passes the good chapter, with a lead-in before its table, and reports the counts', () => {
    const run = newRun();
    run.writeChapter(GOOD_CHAPTER);
    const result = check(run);
    expect(result.lines).toEqual(['F1: chapter ok', GOOD_COUNTS, NO_NOTES]);
    expect(result.status).toBe(0);
  });

  it('accepts a range written with an en dash, and a no-diagram line in place of a diagram', () => {
    const run = newRun();
    const text = GOOD_CHAPTER.replace('order-form.js:3-6', 'order-form.js:3\u20136').replace(/```mermaid[\s\S]*```\n/, '<!-- no-diagram: the order has one step -->\n');
    run.writeChapter(text);
    const result = check(run);
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[1]).toBe('Chapter: 5 sentences, 1 table rows, 6 citations, 0 diagrams, 0 arrows');
  });

  it('records nothing: no state.json entry, no file', () => {
    const run = newRun();
    run.writeChapter(GOOD_CHAPTER);
    const before = JSON.stringify(run.readJson('state.json'));
    check(run);
    expect(JSON.stringify(run.readJson('state.json'))).toBe(before);
  });

  it('refuses a chapter that is not there', () => {
    const run = newRun();
    const result = check(run);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/chapters\/F1\.md: chapter missing/);
  });
});

describe('check-chapter: sentences and citations', () => {
  rejects('a sentence with no citation', (text) => `${text}\nA sentence with no citation at all.\n`, /uncited sentence "A sentence with no citation at all\."/);

  rejects('text after the last citation of a paragraph', (text) => text.replace('(`src/forms/order-form.js:9`).', '(`src/forms/order-form.js:9`). And more words.'), /uncited sentence "And more words\."/);

  rejects('a citation without a line', (text) => text.replace('order-form.js:9`', 'order-form.js`'), /chapter\.\d+ \(line \d+\): citation `src\/forms\/order-form\.js` is not written as <path>:<n>/);

  rejects('a citation that leaves the project', (text) => text.replace('src/roles.js:1', '../project/src/roles.js:1'), /citation `\.\.\/project\/src\/roles\.js:1`: \.\.\/project\/src\/roles\.js leaves the project/);

  rejects('a citation into .excavator', (text) => text.replace('src/roles.js:1', '.excavator/notes.txt:1'), /\.excavator\/notes\.txt is under \.excavator/, {
    prepare: (run) => {
      mkdirSync(join(run.root, '.excavator'));
      writeFileSync(join(run.root, '.excavator/notes.txt'), 'Clerks create orders.\n');
    },
  });

  rejects('a citation of a file that does not exist', (text) => text.replace('src/roles.js:1', 'src/missing.js:1'), /src\/missing\.js is not a file in the project/);

  rejects('lines past the end of the file', (text) => text.replace('order-form.js:9`', 'order-form.js:99`'), /lines 99-99 are not inside src\/forms\/order-form\.js, which has 12 lines/);

  rejects('lines in the wrong order', (text) => text.replace('order-form.js:3-6', 'order-form.js:6-3'), /lines 6-3 are not inside/);

  rejects('line zero', (text) => text.replace('order-form.js:9`', 'order-form.js:0`'), /lines 0-0 are not inside/);

  rejects('a citation of more than 80 lines', (text) => text.replace('src/roles.js:1', 'src/long.js:1-81'), /81 lines; cite at most 80/, {
    prepare: (run) => writeFileSync(join(run.root, 'src/long.js'), `${Array.from({ length: 100 }, (_, i) => `// line ${i + 1}`).join('\n')}\n`),
  });

  it('accepts exactly 80 lines', () => {
    const run = newRun();
    writeFileSync(join(run.root, 'src/long.js'), `${Array.from({ length: 100 }, (_, i) => `// line ${i + 1}`).join('\n')}\n`);
    run.writeChapter(GOOD_CHAPTER.replace('src/roles.js:1', 'src/long.js:1-80'));
    expect(check(run).status).toBe(0);
  });
});

describe('check-chapter: content findings are notes', () => {
  notes('a number that the citation does not state', (text) => text.replace('limited to 35000', 'limited to 36000'), /chapter\.\d+ \(sentence, line 5\) number: number 36000 does not occur in the passages of its citations \(src\/forms\/order-form\.js:6-6\)/, 'number');

  notes('a number that only another citation states', (text) => text.replace('hold 100000 bytes (`src/forms/order-form.js:9`)', 'hold 100000 bytes (`src/forms/order-form.js:6`)'), /number 100000 does not occur/, 'number');

  notes('a quoted text that the citation lacks', (text) => text.replace('\u201cCustomer Name\u201d', '\u201cCustomer Nom\u201d'), /the quoted text "Customer Nom" does not occur/, 'quote');

  notes('a quoted text in straight quotes', (text) => text.replace('\u201cCustomer Name\u201d', '"Client Name"'), /the quoted text "Client Name" does not occur/, 'quote');

  notes('a quoted text in corner brackets', (text) => text.replace('\u201cCustomer Name\u201d', '\u300cClient Name\u300d'), /the quoted text "Client Name" does not occur/, 'quote');

  notes('a code-shaped word', (text) => text.replace('The item count is limited', 'The itemCount check is limited'), /"itemCount" is not allowed in reader text \(camelCase identifier\)/, 'code');

  it('lets a code-shaped span stand inside a quoted text that the citation holds', () => {
    const run = newRun();
    writeFileSync(join(run.root, 'src/fields.js'), "const field = { label: 'user_name' };\n");
    run.writeChapter(GOOD_CHAPTER.replace('The item count is limited to 35000', 'The field \u201cuser_name\u201d (`src/fields.js:1`) and the item count are limited to 35000'));
    expect(check(run).status).toBe(0);
  });

  notes('a word of advice', (text) => text.replace('The clerk fills in', 'The clerk should fill in'), /"should" is a word of advice/, 'advice');

  notes('a code-shaped word in a table row', (text) => text.replace('Creates an order', 'Creates an order_row'), /"order_row" is not allowed in reader text \(underscore identifier\)/, 'code');

  it('notes every finding of one run, not only the first', () => {
    const run = newRun();
    run.writeChapter(GOOD_CHAPTER.replace('limited to 35000', 'limited to 36000').replace('should', 'x').replace('The clerk fills in', 'The clerk should fill in'));
    const bad = check(run);
    expect(bad.status).toBe(0);
    expect(bad.stdout).toMatch(/note: chapter\.\d+ \(sentence, line 5\) number: number 36000/);
    expect(bad.stdout).toMatch(/advice: "should" is a word of advice/);
    expect(bad.lines.at(-1)).toMatch(/^Notes: 2 .*number 1.*advice 1/);
  });
});

describe('check-chapter: tables, diagrams and headings', () => {
  rejects('a table row with no citation', (text) => text.replace('Creates an order `src/roles.js:1` |', 'Creates an order |'), /chapter\.\d+ \(line \d+\): a table row without a citation/);

  it('takes the citation of a row from any cell', () => {
    const run = newRun();
    run.writeChapter(GOOD_CHAPTER.replace('| Clerk | Creates an order `src/roles.js:1` |', '| Clerk `src/roles.js:1` | Creates an order |'));
    expect(check(run).status).toBe(0);
  });

  for (const word of ['alt', 'else', 'end', 'loop', 'note', 'opt', 'par', 'rect', 'activate', 'autonumber']) {
    rejects(`a sequence diagram with the line "${word}"`, (text) => text.replace('S-->>C: Confirms', `${word} Something\nS-->>C: Confirms`), new RegExp(`"${word} Something" is not allowed in a sequence diagram`));
  }

  rejects('an arrow with no citation line', (text) => text.replace('%% `src/forms/order-form.js:3-6`\n', ''), /chapter\.\d+ \(line \d+\): an arrow needs its citation on the next line/);

  rejects('a diagram that is not a sequence diagram', (text) => text.replace('sequenceDiagram', 'flowchart TD'), /must be a sequence diagram whose first line is sequenceDiagram/);

  rejects('a fenced block that is not mermaid', (text) => `${text}\n\`\`\`js\nconst a = 1;\n\`\`\`\n`, /a fenced block must be mermaid/);

  rejects('a chapter with neither a diagram nor a no-diagram line', (text) => text.replace(/```mermaid[\s\S]*```\n/, ''), /every chapter needs a sequence diagram with at least one arrow, or one line <!-- no-diagram: <reason> -->/);

  rejects('an empty no-diagram reason', (text) => text.replace(/```mermaid[\s\S]*```\n/, '<!-- no-diagram:  -->\n'), /the no-diagram line needs a reason/);

  rejects('a heading with no cited item under it', (text) => `${text}\n## Nothing here\n`, /chapter\.\d+ \(line \d+\): the heading "Nothing here" has no cited item under it/);

  it('lets a heading stand for the items under it: its numbers are read against their citations', () => {
    const run = newRun();
    run.writeChapter(GOOD_CHAPTER.replace('## Placing an order', '## Placing an order of 35000'));
    expect(check(run).lines.at(-1)).toMatch(/^Notes: 0/);
    run.writeChapter(GOOD_CHAPTER.replace('## Placing an order', '## Placing an order of 77777'));
    const bad = check(run);
    expect(bad.status).toBe(0);
    expect(bad.stdout).toMatch(/note: chapter\.2 \(heading, line 3\) number: number 77777 does not occur/);
  });
});

describe('check-chapter: the language of the run', () => {
  function chineseRun() {
    const run = makeRun();
    cleanups.push(run.cleanup);
    run.writeJson(join(run.out, 'ui.json'), translatedUi('Chinese'));
    run.writeMap(markedMap(run.map, 'Chinese'));
    expect(run.run('check-map').status).toBe(0);
    mkdirSync(join(run.out, 'chapters'), { recursive: true });
    return run;
  }

  it('notes a sentence in ASCII letters in a run with its own script, and passes the marked one without a note', () => {
    const run = chineseRun();
    const marked = GOOD_CHAPTER
      .replace('# Orders', `# ${MARK}Orders`)
      .replace('## Placing an order', `## ${MARK}Placing an order`)
      .replace('The clerk fills in', `${MARK}The clerk fills in`)
      .replace('The item count is', `${MARK}The item count is`)
      .replace('An upload may', `${MARK}An upload may`)
      .replace('- An order', `- ${MARK}An order`)
      .replace('- A sent', `- ${MARK}A sent`)
      .replace('| Clerk | Creates', `| Clerk | ${MARK}Creates`)
      .replace('C->>S: Sends', `C->>S: ${MARK}Sends`)
      .replace('S-->>C: Confirms', `S-->>C: ${MARK}Confirms`);
    writeFileSync(join(run.out, 'chapters', 'F1.md'), marked);
    const good = run.run('check-chapter', 'F1');
    expect(good.status, good.stdout).toBe(0);
    expect(good.lines.at(-1)).toMatch(/language 0/);
    writeFileSync(join(run.out, 'chapters', 'F1.md'), marked.replace(`${MARK}An upload`, 'An upload'));
    const bad = run.run('check-chapter', 'F1');
    expect(bad.status).toBe(0);
    expect(bad.stdout).toMatch(/note: chapter\.\d+ \(sentence, line \d+\) language: written only in ASCII letters; the run's language is Chinese/);
  });

  it('does not check a language written in Latin letters', () => {
    const run = makeRun();
    cleanups.push(run.cleanup);
    run.writeJson(join(run.out, 'ui.json'), latinUi('French'));
    run.writeMap(markedMap(run.map, 'French', ''));
    expect(run.run('check-map').status).toBe(0);
    mkdirSync(join(run.out, 'chapters'), { recursive: true });
    writeFileSync(join(run.out, 'chapters', 'F1.md'), GOOD_CHAPTER);
    const quiet = run.run('check-chapter', 'F1');
    expect(quiet.status).toBe(0);
    expect(quiet.lines.at(-1)).toMatch(/language 0/);
  });
});

describe('the parse: items, ids and claims', () => {
  const ids = (parsed) => parsed.items.map((item) => item.id);

  it('cuts a paragraph at its citation groups: three citations in two groups make two sentences', () => {
    const parsed = parseChapter('First (`a.js:1`; `b.js:2`). Second `c.js:3`.\n');
    expect(parsed.items.map((item) => [item.kind, item.text, item.raw])).toEqual([
      ['sentence', 'First (`a.js:1`; `b.js:2`).', ['a.js:1', 'b.js:2']],
      ['sentence', 'Second `c.js:3`.', ['c.js:3']],
    ]);
    expect(parsed.problems).toEqual([]);
  });

  it('gives a citation group in parentheses at the end of a sentence to that sentence', () => {
    const parsed = parseChapter('A thing (`a.js:1`). Another thing (`b.js:2`).\n');
    expect(parsed.items.map((item) => item.own)).toEqual(['A thing.', 'Another thing.']);
  });

  it('takes the claim without citations, with the heading path as context', () => {
    const parsed = parseChapter('# Top\n\n## Part\n\nThe field is shown `a.js:1`.\n');
    expect(parsed.items.map((item) => [item.kind, item.claim])).toEqual([['heading', 'Top'], ['heading', 'Top > Part'], ['sentence', 'Top > Part: The field is shown.']]);
  });

  it('makes a data row one item, with the header cells in its claim, and an arrow one item with display names', () => {
    const parsed = parseChapter('| Role | Can do |\n| --- | --- |\n| Clerk | Creates `a.js:1` |\n\n```mermaid\nsequenceDiagram\nparticipant C as Clerk\nC->>S: Sends it\n%% `b.js:2`\n```\n');
    const [row, arrow] = parsed.items;
    expect([row.kind, row.claim, row.raw]).toEqual(['row', 'Role: Clerk; Can do: Creates', ['a.js:1']]);
    expect([arrow.kind, arrow.claim, arrow.raw]).toEqual(['arrow', 'Clerk -> S: Sends it', ['b.js:2']]);
  });

  it('gives a heading the first 5 distinct citations of the items under it, up to a heading of the same or a higher level', () => {
    const lines = Array.from({ length: 7 }, (_, i) => `Fact ${i + 1} \`f.js:${i + 1}\`. Again \`f.js:1\`.`).join('\n\n');
    const parsed = parseChapter(`## A\n\n${lines}\n\n### Inner\n\nDeep \`g.js:1\`.\n\n## B\n\nOther \`h.js:1\`.\n`);
    const [a, inner, b] = parsed.items.filter((item) => item.kind === 'heading');
    expect(a.raw).toEqual(['f.js:1', 'f.js:2', 'f.js:3', 'f.js:4', 'f.js:5']);
    expect(inner.raw).toEqual(['g.js:1']);
    expect(b.raw).toEqual(['h.js:1']);
  });

  it('numbers items chapter.1, chapter.2, ... in document order across all kinds, deterministically', () => {
    const first = parseChapter(GOOD_CHAPTER);
    expect(ids(first)).toEqual(Array.from({ length: first.items.length }, (_, i) => `chapter.${i + 1}`));
    expect(first.items.map((item) => item.kind)).toEqual(['heading', 'heading', 'sentence', 'sentence', 'sentence', 'sentence', 'sentence', 'row', 'arrow', 'arrow']);
    expect(parseChapter(GOOD_CHAPTER).items).toEqual(first.items);
  });

  it('does not renumber when items are removed: the full text parses as before', () => {
    const before = parseChapter(GOOD_CHAPTER);
    renderChapter(GOOD_CHAPTER, ['chapter.3', 'chapter.8']);
    expect(parseChapter(GOOD_CHAPTER).items).toEqual(before.items);
  });

  it('does not treat a lead-in as an item, and a colon line with no list, table or diagram after it as a sentence', () => {
    expect(parseChapter('Steps:\n\n- One `a.js:1`.\n').items.map((item) => item.id)).toEqual(['chapter.1']);
    expect(parseChapter('Steps:\n\nNothing follows `a.js:1`.\n').problems.join('\n')).toMatch(/uncited sentence "Steps:"/);
  });
});

describe('rendering a chapter with items removed', () => {
  const text = `# Top

Alpha one \`a.js:1\`. Alpha two \`a.js:2\`. Alpha three \`a.js:3\`.

Lead in:

- First \`b.js:1\`.
- Second \`b.js:2\`.

## Part

Beta \`c.js:1\`.

Rows:

| Name | Value |
| --- | --- |
| One | x \`d.js:1\` |
| Two | y \`d.js:2\` |

\`\`\`mermaid
sequenceDiagram
participant A as Alice
participant B as Bob
participant C as Carol
A->>B: Hello
%% \`e.js:1\`
B-->>C: Hi
%% \`e.js:2\`
\`\`\`
`;
  const parsed = parseChapter(text);
  const idOf = (needle) => parsed.items.find((item) => item.text.includes(needle)).id;

  it('returns the text as written when nothing is removed', () => {
    expect(parsed.problems).toEqual([]);
    expect(renderChapter(text)).toBe(text);
  });

  it('takes a sentence out of its paragraph', () => {
    const out = renderChapter(text, [idOf('Alpha two')]);
    expect(out).toContain('Alpha one `a.js:1`. Alpha three `a.js:3`.');
    expect(out).not.toContain('Alpha two');
  });

  it('drops a paragraph whose sentences are all removed', () => {
    const out = renderChapter(text, [idOf('Alpha one'), idOf('Alpha two'), idOf('Alpha three')]);
    expect(out).not.toContain('Alpha');
    expect(out).toContain('# Top\n\nLead in:');
  });

  it('takes a row out of its table', () => {
    const out = renderChapter(text, [idOf('One |')]);
    expect(out).toContain('| Name | Value |\n| --- | --- |\n| Two | y `d.js:2` |');
    expect(out).not.toContain('| One |');
  });

  it('takes an arrow and its citation line out of the diagram, with the participant no arrow uses any more', () => {
    const out = renderChapter(text, [idOf('B-->>C')]);
    expect(out).toContain('A->>B: Hello\n%% `e.js:1`\n```');
    expect(out).not.toContain('Hi');
    expect(out).not.toContain('Carol');
    expect(out).toContain('participant B as Bob');
  });

  it('drops a heading so its content joins the section before it', () => {
    const out = renderChapter(text, [idOf('## Part')]);
    expect(out).not.toContain('## Part');
    expect(out).toContain('Beta `c.js:1`.');
    expect(out.indexOf('- Second')).toBeLessThan(out.indexOf('Beta'));
  });

  it('drops a lead-in when everything after it in its list is gone, and keeps it while one item stays', () => {
    expect(renderChapter(text, [idOf('First')])).toContain('Lead in:\n\n- Second `b.js:2`.');
    const out = renderChapter(text, [idOf('First'), idOf('Second')]);
    expect(out).not.toContain('Lead in:');
    expect(out).not.toContain('- First');
  });

  it('drops a lead-in with its table when every row is removed, and an empty table with it', () => {
    const out = renderChapter(text, [idOf('One |'), idOf('Two |')]);
    expect(out).not.toContain('Rows:');
    expect(out).not.toContain('| Name |');
  });

  it('drops a diagram whose arrows are all removed', () => {
    const out = renderChapter(text, [idOf('A->>B'), idOf('B-->>C')]);
    expect(out).not.toContain('mermaid');
    expect(out).not.toContain('participant');
  });
});
