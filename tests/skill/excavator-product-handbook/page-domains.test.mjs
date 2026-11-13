// Oracle of openspec change handbook-page-domain-map (task 2.1): the page data /21 carries the
// domains (four states, the intro and body of each section, the hand-overs), the lead and the
// search index, the same bytes for the same input.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FORM, cite } from './md-run-fixture.mjs';
import { STUB, dataOf, html, pageRun, runPage } from './page-md-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
const stubDir = mkdtempSync(join(tmpdir(), 'xhb-stub-'));
const stubPath = join(stubDir, 'template.html');
writeFileSync(stubPath, STUB);
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

const C1 = `${FORM}:5-6`;
const C2 = `${FORM}:10-11`;
const DOMAINS_MD = `# Domains

The domains of the product (${cite('5')}).

## Order handling

Orders and the archive live here (${cite('5')}).

A second paragraph about orders (${cite('10')}).

- Orders (F1) hands work to Reminders (F3) (\`${C1}\`).

\`\`\`mermaid
flowchart LR
  A[Order] --> B[Reminder]
\`\`\`

## Automatic work

| Feature | Use |
| --- | --- |
| Reminders (F3) | Sends mail (\`${C2}\`) |

## Last words

Closing line (${cite('10')}).
`;

const goodList = () => ({
  domains: [
    { name: 'Order handling', features: ['F1', 'F2', 'F5'] },
    { name: 'Automatic work', features: ['F3', 'F4'] },
    { name: 'Last words', features: [] },
  ],
  handovers: [
    { from: 'Order handling', to: 'Automatic work', what: 'Orders (F1) hands work to Reminders (F3) and again Orders (F1) and Nothing (F99)', cites: [C1] },
    { from: 'Automatic work', to: 'Order handling', what: 'Admin tool (F4) reads Archive (F2)', cites: [C2] },
  ],
});

function make({ list = goodList(), chapter = DOMAINS_MD, check = true } = {}) {
  const run = pageRun(cleanups);
  if (chapter !== null) run.write('domains', chapter);
  if (list !== null) writeFileSync(join(run.out, 'domains.json'), `${JSON.stringify(list, null, 2)}\n`);
  if (check && chapter !== null) run.check('domains');
  return run;
}
const page = (run, options = {}) => {
  const result = runPage(run, { template: stubPath, ...options });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return dataOf(html(run));
};

describe('page data /21: domains.state', () => {
  it('ok when the record passed and the file is the checked one', () => {
    const run = make();
    expect(run.readJson('state.json').chapters.domains.status).toBe('passed');
    expect(page(run).domains.state).toBe('ok');
  });

  it('missing when there is no domains.json', () => {
    const data = page(make({ list: null }));
    expect(data.domains).toEqual({ state: 'missing', list: [], handovers: [] });
  });

  it('missing when the chapter has no record', () => {
    expect(page(make({ chapter: null })).domains).toEqual({ state: 'missing', list: [], handovers: [] });
  });

  it('missing when the passed record has no json digest', () => {
    const run = make();
    const state = run.readJson('state.json');
    delete state.chapters.domains.json;
    writeFileSync(join(run.out, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
    expect(page(run).domains.state).toBe('missing');
  });

  it('failed when the chapter did not pass', () => {
    const list = goodList();
    list.domains[0].name = 'No such heading';
    const data = page(make({ list }));
    expect(data.domains).toEqual({ state: 'failed', list: [], handovers: [] });
  });

  it('changed when the file differs from the checked one', () => {
    const run = make();
    writeFileSync(join(run.out, 'domains.json'), `${JSON.stringify({ ...goodList(), handovers: [] })}\n`);
    expect(page(run).domains).toEqual({ state: 'changed', list: [], handovers: [] });
  });
});

describe('page data /21: domains.list', () => {
  it('has ids d1.. in the file order, the features and the keys in a fixed order', () => {
    const { domains } = page(make());
    expect(domains.list.map((domain) => [domain.id, domain.name, domain.features])).toEqual([
      ['d1', 'Order handling', ['F1', 'F2', 'F5']],
      ['d2', 'Automatic work', ['F3', 'F4']],
      ['d3', 'Last words', []],
    ]);
    expect(Object.keys(domains)).toEqual(['state', 'list', 'handovers']);
    expect(Object.keys(domains.list[0])).toEqual(['id', 'name', 'features', 'intro', 'body']);
  });

  it('cuts the section at its heading: first paragraph is the intro, the rest the body', () => {
    const [first] = page(make()).domains.list;
    expect(first.intro.product).toBe('Orders and the archive live here.');
    expect(first.intro.technical).toBe(`Orders and the archive live here (${cite('5')}).`);
    expect(first.body.product.startsWith('A second paragraph about orders.')).toBe(true);
    expect(first.body.product).toContain('- Orders (F1) hands work to Reminders (F3).');
    expect(first.body.product).toContain('```mermaid\nflowchart LR');
    expect(first.body.technical.startsWith(`A second paragraph about orders (${cite('10')}).`)).toBe(true);
    expect(first.body.technical).toContain(`(\`${C1}\`)`);
    // The next domain's heading and text are not in this section; the heading line itself is dropped.
    expect(first.body.technical).not.toContain('Automatic work');
    expect(first.body.technical).not.toContain('## Order handling');
  });

  it('a section that starts with a table has no intro; all of it is the body', () => {
    const second = page(make()).domains.list[1];
    expect(second.intro).toEqual({ product: '', technical: '' });
    expect(second.body.technical).toContain('| Reminders (F3) |');
    expect(second.body.product).toContain('Reminders (F3)');
    expect(second.body.product).not.toContain(C2);
  });

  it('the last domain runs to the end of the chapter', () => {
    const last = page(make()).domains.list[2];
    expect(last.intro.product).toBe('Closing line.');
    expect(last.body).toEqual({ product: '', technical: '' });
  });

  it('a product-only page has only the product text and no citation anywhere in the domains', () => {
    const { domains } = page(make(), { views: 'product' });
    expect(Object.keys(domains.list[0].intro)).toEqual(['product']);
    expect(JSON.stringify(domains)).not.toContain(FORM);
    expect(domains.handovers.every((item) => !('cites' in item))).toBe(true);
  });
});

describe('page data /21: domains.handovers', () => {
  it('uses domain ids, the features named as (F<n>) that are in the map, once each in order', () => {
    const { handovers } = page(make()).domains;
    expect(handovers.map((item) => [item.from, item.to, item.features])).toEqual([
      ['d1', 'd2', ['F1', 'F3']],
      ['d2', 'd1', ['F4', 'F2']],
    ]);
    expect(Object.keys(handovers[0])).toEqual(['from', 'to', 'what', 'features', 'cites']);
    expect(handovers[1].what).toBe('Admin tool (F4) reads Archive (F2)');
  });

  it('has cites with the technical view only', () => {
    expect(page(make()).domains.handovers.map((item) => item.cites)).toEqual([[C1], [C2]]);
    expect(page(make(), { views: 'product' }).domains.handovers.map((item) => 'cites' in item)).toEqual([false, false]);
  });
});

describe('page data /21: lead and search', () => {
  it('lead is the first paragraph of the system chapter, citations out', () => {
    expect(page(make()).lead).toBe('The clerk fills in the "Customer Name" field.');
  });

  it('lead is empty without a system chapter', () => {
    const run = make();
    rmSync(join(run.out, 'chapters', 'system.md'));
    expect(page(run).lead).toBe('');
  });

  it('search lists the domains, then each chapter with its ## and ### headings numbered from 0', () => {
    const run = make();
    run.write('F1', `${readFileSync(join(run.out, 'chapters', 'F1.md'), 'utf-8').replace('## Open questions', `### A sub part\n\nText (${cite('5')}).\n\n\`\`\`text\n## Not a heading\n\`\`\`\n\n## Open questions`)}`);
    run.check('F1');
    const { search } = page(run);
    expect(Object.keys(search[0])).toEqual(['kind', 'title', 'chapter', 'domain', 'heading', 'level']);
    expect(search.slice(0, 3)).toEqual([
      { kind: 'domain', title: 'Order handling', chapter: null, domain: 'd1', heading: null, level: null },
      { kind: 'domain', title: 'Automatic work', chapter: null, domain: 'd2', heading: null, level: null },
      { kind: 'domain', title: 'Last words', chapter: null, domain: 'd3', heading: null, level: null },
    ]);
    const rest = search.slice(3).map((item) => [item.kind, item.title, item.chapter, item.heading, item.level]);
    const f1 = rest.filter((item) => item[2] === 'F1');
    expect(f1).toEqual([
      ['chapter', 'Orders', 'F1', null, null],
      ['heading', 'Operations', 'F1', 0, 2],
      ['heading', 'A sub part', 'F1', 1, 3],
      ['heading', 'Open questions', 'F1', 2, 2],
      ['heading', 'Problems', 'F1', 3, 2],
    ]);
    const order = rest.filter((item) => item[0] === 'chapter').map((item) => item[2]);
    expect(order).toEqual(['system', 'domains', 'F1']);
    expect(rest[0][0]).toBe('chapter');
    expect(rest[0][2]).toBe('system');
  });

  it('search has no domain item when the domains are not ok', () => {
    expect(page(make({ list: null })).search.some((item) => item.kind === 'domain')).toBe(false);
  });

  it('the same input gives the same page, byte for byte', () => {
    const run = make();
    page(run);
    const first = html(run);
    page(run);
    expect(html(run)).toBe(first);
  });
});

describe('page data /21: architecture', () => {
  const FENCE_TEXT = (label) => `\`\`\`mermaid\nflowchart LR\n  A[${label}] --> B[Store]\n\`\`\`\n`;
  const system = (body) => `# System\n\nThe system in one line (${cite('5')}).\n\n${body}`;
  const withSystem = (text) => {
    const run = make();
    run.write('system', text);
    run.check('system');
    return run;
  };
  const SECTION = `## Overview\n\nFirst words (${cite('5')}).\n\n## Architecture\n\nThe apps and the store (\`${C1}\`).\n\n${FENCE_TEXT('Web')}\n| App | Use |\n| --- | --- |\n| Web | Orders (${cite('10')}) |\n\n## Operations\n\nSecond words (${cite('10')}).\n\n${FENCE_TEXT('Later')}`;

  it('is the level-2 section that holds the first diagram, without its heading line, up to the next level-2 heading', () => {
    const { architecture } = page(withSystem(system(SECTION)));
    expect(Object.keys(architecture)).toEqual(['product', 'technical']);
    expect(architecture.technical.startsWith('The apps and the store')).toBe(true);
    expect(architecture.technical).toContain('flowchart LR\n  A[Web] --> B[Store]');
    expect(architecture.technical).toContain('| Web | Orders (');
    expect(architecture.technical).not.toContain('## ');
    expect(architecture.technical).not.toContain('First words');
    expect(architecture.technical).not.toContain('Second words');
    expect(architecture.technical).not.toContain('Later');
  });

  it('shows the citations in the technical text and none in the product text', () => {
    const { architecture } = page(withSystem(system(SECTION)));
    expect(architecture.technical).toContain(`\`${C1}\``);
    expect(architecture.product).not.toMatch(/order-form\.js/);
    expect(architecture.product).toContain('The apps and the store');
    expect(architecture.product).toContain('flowchart LR');
  });

  it('a heading line inside a fence does not end the section', () => {
    const text = system(`## Architecture\n\n\`\`\`mermaid\nflowchart LR\n  A --> B\n\`\`\`\n\n\`\`\`text\n## Not a heading\n\`\`\`\n\nAfter (${cite('5')}).\n\n## Next\n\nElse (${cite('5')}).\n`);
    const { architecture } = page(withSystem(text));
    expect(architecture.technical).toContain('## Not a heading');
    expect(architecture.technical).toContain('After');
    expect(architecture.technical).not.toContain('Else');
  });

  it('is empty in every view when the first diagram comes before the first level-2 heading', () => {
    const text = `# System\n\n${FENCE_TEXT('Early')}\n## Later heading\n\nWords (${cite('5')}).\n\n${FENCE_TEXT('Second')}`;
    expect(page(withSystem(text)).architecture).toEqual({ product: '', technical: '' });
  });

  it('is empty when the system chapter has no diagram', () => {
    expect(page(make()).architecture).toEqual({ product: '', technical: '' });
  });

  it('is empty without a system chapter', () => {
    const run = make();
    rmSync(join(run.out, 'chapters', 'system.md'));
    expect(page(run).architecture).toEqual({ product: '', technical: '' });
  });

  it('has only the selected view, and sits right after lead', () => {
    const data = page(withSystem(system(SECTION)), { views: 'product' });
    expect(Object.keys(data.architecture)).toEqual(['product']);
    const keys = Object.keys(data);
    expect(keys[keys.indexOf('lead') + 1]).toBe('architecture');
  });

  it('the same input gives the same text twice', () => {
    const run = withSystem(system(SECTION));
    const first = page(run).architecture;
    expect(page(run).architecture).toEqual(first);
  });
});
