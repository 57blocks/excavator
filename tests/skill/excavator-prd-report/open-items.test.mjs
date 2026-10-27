// `lib/open-items.mjs`, `prd.mjs check-open-items` and the open items table of
// `aggregate` (openspec change prd-report-dedupe, design D5; oracle O3).
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { mergeProblems, mergedRows, openItemSources } from '../../../skills/excavator-prd-report/lib/open-items.mjs';
import { collectPageData } from '../../../skills/excavator-prd-report/lib/page-data.mjs';
import { addWrittenFeature, makeLaneRun, runPrd } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const HEAD = '| Item | What is known | What was searched |\n|---|---|---|\n';
const withOpenItems = (text, section) => text.replace(/^chapter: (\d+)$/m, 'openItems: Open items\nchapter: $1').concat(`\n### Open items\n\n${section}`);

/** Replace the open items section of chapter `id` of `run` with `section`. */
const setOpenItems = (run, id, section) => {
  const bare = run.readText(`features/${id}.md`).replace(/\n### Open items[\s\S]*$/, '\n').replace('openItems: Open items\n', '');
  run.writeText(`features/${id}.md`, withOpenItems(bare, section));
};

/**
 * The run of oracle O3: four written chapters.
 *   F1  three table rows; F1.2 and F1.3 ask the same question inside the chapter, F1.1 is also asked by F2
 *   F2  a three-cell row and a four-cell row
 *   F3  open items as a list (written directly: check-lane would refuse it); F3.2 is asked by F1 and F2 too
 *   F4  no open items section
 * Source order: F1.1 F1.2 F1.3 F2.1 F2.2 F3.1 F3.2.
 */
function makeRun() {
  const run = makeLaneRun();
  cleanups.push(run.cleanup);
  addWrittenFeature(run, 'F3', 1);
  addWrittenFeature(run, 'F4', 1);
  run.writeText('features/F1.md', withOpenItems(run.readText('features/F1.md'), [
    `${HEAD}| Whether refunds are paid | Not in the order code | the whole project |`,
    '| How a customer gets a token | The login route issues it | `src/orders/routes.js` |',
    '| How does a customer obtain a token | Seen in the route only | `src/orders/service.js` |',
    '',
  ].join('\n')));
  run.writeText('features/F2.md', withOpenItems(run.readText('features/F2.md'), [
    `${HEAD}| Refund payment rule | A comment mentions refunds | \`src/orders/service.js\` |`,
    '| Retention | 90 days | unknown | `src/orders/service.js` |',
    '',
  ].join('\n')));
  run.writeText('features/F3.md', withOpenItems(run.readText('features/F3.md'), [
    '- Is the refund rule configurable?',
    '  Nothing in the code reads a setting.',
    '* Which roles may reopen an order',
    '',
  ].join('\n')));
  return run;
}

const aggregateOk = (run) => {
  const out = runPrd(['aggregate', run.out, '--project', run.project]);
  expect(out.status, out.stdout + out.stderr).toBe(0);
  return out;
};
const check = (run) => runPrd(['check-open-items', run.out, '--project', run.project]);
const lines = (out) => out.stdout.split('\n').filter(Boolean);
const sourcesOf = (run) => run.readJson('open-items/sources.json');
const writeMerged = (run, value) => {
  mkdirSync(join(run.out, 'open-items'), { recursive: true });
  run.writeJson('open-items/merged.json', value);
};
/** A merge that passes: F1.1 with F2.1 and F3.2 (kept F2.1), and F1.2 with F1.3 (kept F1.3). */
const GROUPS = [{ keep: 'F2.1', also: ['F1.1', 'F3.2'] }, { keep: 'F1.3', also: ['F1.2'] }];
const goodMerge = (run) => ({ digest: sourcesOf(run).digest, groups: GROUPS });
/** The index with the statuses aggregate records, as the unit calls of openItemSources receive it. */
const aggregatedIndex = (run) => {
  aggregateOk(run);
  return run.readIndex();
};
const tableRows = (text) => text.trim().split('\n').slice(2);

describe('openItemSources: the items of the written chapters', () => {
  it('numbers the items of each feature from 1 and takes the fields of a three-cell row, a longer row and a list', () => {
    const run = makeRun();
    const { items, digest } = openItemSources(run.out, aggregatedIndex(run));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(items.map((item) => item.id)).toEqual(['F1.1', 'F1.2', 'F1.3', 'F2.1', 'F2.2', 'F3.1', 'F3.2']);
    expect(items.map((item) => item.feature)).toEqual(['F1', 'F1', 'F1', 'F2', 'F2', 'F3', 'F3']);
    expect(items[0]).toEqual({
      id: 'F1.1', feature: 'F1', item: 'Whether refunds are paid', known: 'Not in the order code', searched: 'the whole project',
    });
    expect(items[1].searched).toBe('`src/orders/routes.js`');
    expect(items[4]).toEqual({ id: 'F2.2', feature: 'F2', item: 'Retention — 90 days — unknown — `src/orders/service.js`', known: '', searched: '' });
    expect(items[5]).toEqual({ id: 'F3.1', feature: 'F3', item: 'Is the refund rule configurable? Nothing in the code reads a setting.', known: '', searched: '' });
    expect(items[6]).toEqual({ id: 'F3.2', feature: 'F3', item: 'Which roles may reopen an order', known: '', searched: '' });
  });

  it('reads numbered list items, and takes a section that is neither a table nor a list as one item', () => {
    const run = makeRun();
    const index = aggregatedIndex(run);
    setOpenItems(run, 'F3', '1. First question\n2. Second question\n');
    expect(openItemSources(run.out, index).items.filter((item) => item.feature === 'F3').map((item) => item.item)).toEqual(['First question', 'Second question']);
    setOpenItems(run, 'F3', 'Nobody could say\nwho owns refunds.\n');
    expect(openItemSources(run.out, index).items.filter((item) => item.feature === 'F3')).toEqual([
      { id: 'F3.1', feature: 'F3', item: 'Nobody could say who owns refunds.', known: '', searched: '' },
    ]);
  });

  it('takes no item from a feature that is not written or has no open items section, and none from an empty section', () => {
    const run = makeRun();
    const index = aggregatedIndex(run);
    index.features.find((feature) => feature.id === 'F2').status = 'failed';
    expect(openItemSources(run.out, index).items.map((item) => item.feature)).toEqual(['F1', 'F1', 'F1', 'F3', 'F3']);
    setOpenItems(run, 'F3', '\n');
    index.features.find((feature) => feature.id === 'F2').status = 'checked';
    expect(openItemSources(run.out, index).items.map((item) => item.feature)).toEqual(['F1', 'F1', 'F1', 'F2', 'F2']);
  });

  it('orders the features by chapter, not by id', () => {
    const run = makeRun();
    const index = aggregatedIndex(run);
    index.features.find((feature) => feature.id === 'F1').chapter = 9;
    expect(openItemSources(run.out, index).items.map((item) => item.id)).toEqual(['F2.1', 'F2.2', 'F3.1', 'F3.2', 'F1.1', 'F1.2', 'F1.3']);
  });

  it('keeps an escaped pipe in a cell as written', () => {
    const run = makeRun();
    const index = aggregatedIndex(run);
    setOpenItems(run, 'F1', `${HEAD}| Is a \\| b allowed | Unknown | nowhere |\n`);
    expect(openItemSources(run.out, index).items.find((item) => item.id === 'F1.1').item).toBe('Is a \\| b allowed');
  });
});

describe('prd.mjs check-open-items: sources.json', () => {
  it('writes sources.json as pretty JSON with the digest of the items, and the same bytes on a second run', () => {
    const run = makeRun();
    const first = check(run);
    expect(first.status).toBe(1);
    const text = run.readText('open-items/sources.json');
    expect(text.endsWith('\n')).toBe(true);
    const value = JSON.parse(text);
    expect(Object.keys(value)).toEqual(['digest', 'items']);
    expect(value.items).toHaveLength(7);
    expect(value.items[0]).toEqual({
      id: 'F1.1', feature: 'F1', item: 'Whether refunds are paid', known: 'Not in the order code', searched: 'the whole project',
    });
    expect(text).toBe(`${JSON.stringify(value, null, 2)}\n`);
    check(run);
    expect(run.readText('open-items/sources.json')).toBe(text);
    expect(readdirSync(join(run.out, 'open-items'))).toEqual(['sources.json']);
  });

  it('gives another digest when the text of an item changes', () => {
    const run = makeRun();
    check(run);
    const before = sourcesOf(run).digest;
    run.writeText('features/F3.md', run.readText('features/F3.md').replace('Which roles may reopen an order', 'Which roles may reopen orders'));
    check(run);
    expect(sourcesOf(run).digest).not.toBe(before);
  });

  it('does not write sources.json from aggregate', () => {
    const run = makeRun();
    aggregateOk(run);
    expect(existsSync(join(run.out, 'open-items'))).toBe(false);
  });
});

describe('prd.mjs check-open-items: the problems of merged.json', () => {
  const status = 'Open items: 7 written in the chapters, not merged';
  const expectOnly = (run, problem) => {
    const out = check(run);
    expect(lines(out)).toEqual([problem, status]);
    expect(out.status).toBe(1);
  };

  it('says the file is missing, and that nothing is merged', () => {
    expectOnly(makeRun(), 'open-items/merged.json is missing');
  });

  it('says the file is not valid JSON, with the parser message', () => {
    const run = makeRun();
    mkdirSync(join(run.out, 'open-items'));
    writeFileSync(join(run.out, 'open-items/merged.json'), '{ "digest": ');
    const out = check(run);
    expect(out.status).toBe(1);
    expect(lines(out)[0]).toMatch(/^open-items\/merged\.json is not valid JSON: .+/);
    expect(lines(out).at(-1)).toBe(status);
  });

  it('says the file is not an object with digest and groups', () => {
    for (const value of [[], 'x', null, { groups: [] }, { digest: 'x' }, { digest: 7, groups: [] }, { digest: 'x', groups: {} }]) {
      const run = makeRun();
      writeMerged(run, value);
      expectOnly(run, 'open-items/merged.json is not an object with digest and groups');
    }
  });

  it('says a key it does not read is not read, at the top and in a group', () => {
    const run = makeRun();
    check(run);
    writeMerged(run, { ...goodMerge(run), note: 'x' });
    expectOnly(run, 'open-items/merged.json has the key note, which is not read');
    writeMerged(run, { digest: sourcesOf(run).digest, groups: [{ keep: 'F2.1', also: ['F1.1'], reason: 'same question' }] });
    expectOnly(run, 'open-items/merged.json has the key reason, which is not read');
  });

  it('says a group whose keep or also is not an id and a non-empty list of ids', () => {
    const run = makeRun();
    check(run);
    const digest = sourcesOf(run).digest;
    const bad = [
      { keep: 'F2.1', also: [] },
      { keep: 'F2.1' },
      { also: ['F1.1'] },
      { keep: '', also: ['F1.1'] },
      { keep: 'F2.1', also: 'F1.1' },
      { keep: 'F2.1', also: [3] },
      'F2.1',
    ];
    for (const group of bad) {
      writeMerged(run, { digest, groups: [{ keep: 'F1.2', also: ['F1.3'] }, group] });
      expectOnly(run, 'group 2: keep and also must be an id and a non-empty list of ids');
    }
  });

  it('says the file was written for other open items when the digest differs', () => {
    const run = makeRun();
    check(run);
    writeMerged(run, { ...goodMerge(run), digest: 'stale' });
    expectOnly(run, 'open-items/merged.json was written for other open items; merge them again');
  });

  it('says an id that is not an open item', () => {
    const run = makeRun();
    check(run);
    writeMerged(run, { digest: sourcesOf(run).digest, groups: [{ keep: 'F1.2', also: ['F1.3'] }, { keep: 'F2.1', also: ['F9.9'] }] });
    expectOnly(run, 'group 2: F9.9 is not an open item');
    writeMerged(run, { digest: sourcesOf(run).digest, groups: [{ keep: 'F8.1', also: ['F1.1'] }] });
    expectOnly(run, 'group 1: F8.1 is not an open item');
  });

  it('says an id that is in more than one group, across groups and within one', () => {
    const run = makeRun();
    check(run);
    const digest = sourcesOf(run).digest;
    writeMerged(run, { digest, groups: [{ keep: 'F1.2', also: ['F1.3'] }, { keep: 'F2.1', also: ['F1.3'] }] });
    expectOnly(run, 'F1.3 is in more than one group');
    writeMerged(run, { digest, groups: [{ keep: 'F1.2', also: ['F1.3'] }, { keep: 'F1.3', also: ['F2.1'] }] });
    expectOnly(run, 'F1.3 is in more than one group');
    writeMerged(run, { digest, groups: [{ keep: 'F1.2', also: ['F1.3', 'F1.3'] }] });
    expectOnly(run, 'F1.3 is in more than one group');
  });

  it('says an id that is both keep and also in a group', () => {
    const run = makeRun();
    check(run);
    writeMerged(run, { digest: sourcesOf(run).digest, groups: [{ keep: 'F1.2', also: ['F1.3'] }, { keep: 'F2.1', also: ['F2.1', 'F2.2'] }] });
    expectOnly(run, 'group 2: F2.1 is both keep and also');
  });
});

describe('prd.mjs check-open-items: a passing merge', () => {
  it('exits 0 and prints the counts, M being N minus every id in an also list', () => {
    const run = makeRun();
    check(run);
    writeMerged(run, goodMerge(run));
    const out = check(run);
    expect(out.status, out.stdout).toBe(0);
    expect(lines(out)).toEqual(['Open items: 7 written in the chapters, 4 after merging']);
  });

  it('turns to the other open items when a chapter changes after the merge', () => {
    const run = makeRun();
    check(run);
    writeMerged(run, goodMerge(run));
    expect(check(run).status).toBe(0);
    run.writeText('features/F1.md', run.readText('features/F1.md').replace('Not in the order code', 'Not in the order code or the tests'));
    const out = check(run);
    expect(out.status).toBe(1);
    expect(lines(out)).toEqual([
      'open-items/merged.json was written for other open items; merge them again',
      'Open items: 7 written in the chapters, not merged',
    ]);
  });
});

describe('prd.mjs check-open-items: nothing to merge', () => {
  it('exits 0 without a merged file for one item, with m equal to n', () => {
    const run = makeRun();
    for (const id of ['F1', 'F2']) run.writeText(`features/${id}.md`, run.readText(`features/${id}.md`).replace(/\n### Open items[\s\S]*$/, '\n').replace('openItems: Open items\n', ''));
    run.writeText('features/F3.md', run.readText('features/F3.md').replace(/\n### Open items[\s\S]*$/, '\n### Open items\n\n- The only question\n'));
    const out = check(run);
    expect(out.status, out.stdout).toBe(0);
    expect(lines(out)).toEqual(['Open items: 1 written in the chapters, 1 after merging']);
    expect(run.readJson('open-items/sources.json').items).toHaveLength(1);
  });

  it('exits 0 for no item at all, and says none were written', () => {
    const run = makeRun();
    for (const id of ['F1', 'F2', 'F3']) run.writeText(`features/${id}.md`, run.readText(`features/${id}.md`).replace(/\n### Open items[\s\S]*$/, '\n').replace('openItems: Open items\n', ''));
    const out = check(run);
    expect(out.status, out.stdout).toBe(0);
    expect(lines(out)).toEqual(['Open items: none written in the chapters']);
    expect(run.readJson('open-items/sources.json')).toEqual({ digest: expect.stringMatching(/^[0-9a-f]{64}$/), items: [] });
  });
});

describe('prd.mjs check-open-items: usage', () => {
  it('requires --project and exactly one <out>', () => {
    const run = makeRun();
    expect(runPrd(['check-open-items', run.out]).status).toBe(2);
    expect(runPrd(['check-open-items', '--project', run.project]).status).toBe(2);
  });

  it('is in the usage text', () => {
    expect(runPrd(['--help']).stdout).toContain('check-open-items <out> --project <root>');
  });
});

describe('aggregate: tables/open-items.md', () => {
  const HEADER = ['| # | Item | What is known | What was searched | Features |', '|---|---|---|---|---|'];

  it('writes one row for each item when nothing is merged, with the features as ids', () => {
    const run = makeRun();
    aggregateOk(run);
    const text = run.readText('tables/open-items.md');
    expect(text.split('\n').slice(0, 2)).toEqual(HEADER);
    expect(text.endsWith('|\n')).toBe(true);
    expect(tableRows(text)).toEqual([
      '| 1 | Whether refunds are paid | Not in the order code | the whole project | F1 |',
      '| 2 | How a customer gets a token | The login route issues it | `src/orders/routes.js` | F1 |',
      '| 3 | How does a customer obtain a token | Seen in the route only | `src/orders/service.js` | F1 |',
      '| 4 | Refund payment rule | A comment mentions refunds | `src/orders/service.js` | F2 |',
      '| 5 | Retention — 90 days — unknown — `src/orders/service.js` |  |  | F2 |',
      '| 6 | Is the refund rule configurable? Nothing in the code reads a setting. |  |  | F3 |',
      '| 7 | Which roles may reopen an order |  |  | F3 |',
    ]);
  });

  it('writes a row for each group with the text of keep, at the place of its earliest member, and the features of the group', () => {
    const run = makeRun();
    check(run);
    writeMerged(run, goodMerge(run));
    aggregateOk(run);
    const rows = tableRows(run.readText('tables/open-items.md'));
    expect(rows).toEqual([
      '| 1 | Refund payment rule<br>Also asked in F1: Whether refunds are paid<br>Also asked in F3: Which roles may reopen an order | A comment mentions refunds | `src/orders/service.js` | F1, F2, F3 |',
      '| 2 | How does a customer obtain a token<br>Also asked in F1: How a customer gets a token | Seen in the route only | `src/orders/service.js` | F1 |',
      '| 3 | Retention — 90 days — unknown — `src/orders/service.js` |  |  | F2 |',
      '| 4 | Is the refund rule configurable? Nothing in the code reads a setting. |  |  | F3 |',
    ]);
  });

  it('lists the other members of a group of three in the Item cell, in source order, whether keep is the earliest, a middle or the last member', () => {
    const run = makeRun();
    check(run);
    const rowOf = (group) => {
      writeMerged(run, { digest: sourcesOf(run).digest, groups: [group] });
      aggregateOk(run);
      return tableRows(run.readText('tables/open-items.md'))[0];
    };
    // F1.1, F2.1 and F3.2 in source order; the order in merged.json and the choice of keep do not move them
    expect(rowOf({ keep: 'F1.1', also: ['F3.2', 'F2.1'] })).toBe(
      '| 1 | Whether refunds are paid<br>Also asked in F2: Refund payment rule<br>Also asked in F3: Which roles may reopen an order | Not in the order code | the whole project | F1, F2, F3 |',
    );
    expect(rowOf({ keep: 'F2.1', also: ['F3.2', 'F1.1'] })).toBe(
      '| 1 | Refund payment rule<br>Also asked in F1: Whether refunds are paid<br>Also asked in F3: Which roles may reopen an order | A comment mentions refunds | `src/orders/service.js` | F1, F2, F3 |',
    );
    expect(rowOf({ keep: 'F3.2', also: ['F2.1', 'F1.1'] })).toBe(
      '| 1 | Which roles may reopen an order<br>Also asked in F1: Whether refunds are paid<br>Also asked in F2: Refund payment rule |  |  | F1, F2, F3 |',
    );
  });

  it('names the feature of each other member, also for members of the same feature as keep', () => {
    const run = makeRun();
    check(run);
    writeMerged(run, { digest: sourcesOf(run).digest, groups: [{ keep: 'F1.3', also: ['F1.2', 'F1.1'] }] });
    aggregateOk(run);
    expect(tableRows(run.readText('tables/open-items.md'))[0]).toBe(
      '| 1 | How does a customer obtain a token<br>Also asked in F1: Whether refunds are paid<br>Also asked in F1: How a customer gets a token | Seen in the route only | `src/orders/service.js` | F1 |',
    );
  });

  it('writes a bare pipe in the text of another member as an escaped one', () => {
    const run = makeRun();
    setOpenItems(run, 'F3', '- Is a | b allowed\n- Is a \\| c allowed\n');
    check(run);
    writeMerged(run, { digest: sourcesOf(run).digest, groups: [{ keep: 'F1.1', also: ['F3.1', 'F3.2'] }] });
    aggregateOk(run);
    expect(tableRows(run.readText('tables/open-items.md'))[0]).toContain('<br>Also asked in F3: Is a \\| b allowed<br>Also asked in F3: Is a \\| c allowed |');
  });

  it('has the rows of the items less the also ids, for any passing merge', () => {
    const run = makeRun();
    check(run);
    const total = sourcesOf(run).items.length;
    for (const groups of [GROUPS, [GROUPS[0]], [{ keep: 'F3.2', also: ['F1.1', 'F2.1', 'F3.1'] }]]) {
      writeMerged(run, { digest: sourcesOf(run).digest, groups });
      aggregateOk(run);
      expect(tableRows(run.readText('tables/open-items.md'))).toHaveLength(total - groups.reduce((sum, group) => sum + group.also.length, 0));
    }
  });

  it('writes None. when no written chapter has an open item', () => {
    const run = makeRun();
    for (const id of ['F1', 'F2', 'F3']) run.writeText(`features/${id}.md`, run.readText(`features/${id}.md`).replace(/\n### Open items[\s\S]*$/, '\n').replace('openItems: Open items\n', ''));
    aggregateOk(run);
    expect(run.readText('tables/open-items.md')).toBe('None.\n');
  });

  it('writes an unescaped pipe in a list item as an escaped one, and leaves an escaped one alone', () => {
    const run = makeRun();
    setOpenItems(run, 'F3', '- Is a | b or a \\| c allowed\n');
    aggregateOk(run);
    expect(run.readText('tables/open-items.md')).toContain('| Is a \\| b or a \\| c allowed |');
  });

  it('writes the same bytes on a second run, merged or not', () => {
    const run = makeRun();
    aggregateOk(run);
    const unmerged = run.readText('tables/open-items.md');
    aggregateOk(run);
    expect(run.readText('tables/open-items.md')).toBe(unmerged);
    check(run);
    writeMerged(run, goodMerge(run));
    aggregateOk(run);
    const merged = run.readText('tables/open-items.md');
    aggregateOk(run);
    expect(run.readText('tables/open-items.md')).toBe(merged);
    expect(run.readText('tables/coverage.md')).toContain('Open items: 7 written in the chapters, 4 after merging');
  });

  it('renders every item on its own row when the merge is stale, and says so in the coverage section', () => {
    const run = makeRun();
    check(run);
    writeMerged(run, goodMerge(run));
    run.writeText('features/F1.md', run.readText('features/F1.md').replace('Not in the order code', 'Not in the order code or the tests'));
    aggregateOk(run);
    expect(tableRows(run.readText('tables/open-items.md'))).toHaveLength(7);
    expect(run.readText('tables/coverage.md')).toContain('Open items: 7 written in the chapters, not merged\n');
  });

  it('renders every item on its own row for a merge that fails a check, and for a file that is not JSON', () => {
    const run = makeRun();
    check(run);
    writeMerged(run, { digest: sourcesOf(run).digest, groups: [{ keep: 'F1.2', also: ['F1.3'] }, { keep: 'F2.1', also: ['F1.3'] }] });
    aggregateOk(run);
    expect(tableRows(run.readText('tables/open-items.md'))).toHaveLength(7);
    writeFileSync(join(run.out, 'open-items/merged.json'), 'not json');
    aggregateOk(run);
    expect(tableRows(run.readText('tables/open-items.md'))).toHaveLength(7);
    expect(run.readText('tables/coverage.md')).toContain('Open items: 7 written in the chapters, not merged');
  });

  it('says not merged in the coverage section when there is no merged file and at least two items', () => {
    const run = makeRun();
    aggregateOk(run);
    expect(run.readText('tables/coverage.md')).toContain('Open items: 7 written in the chapters, not merged');
  });

  it('puts the coverage line after the seed files line when there is one', () => {
    const run = makeRun();
    const index = run.readIndex();
    index.scope = 'src';
    run.writeIndex(index);
    aggregateOk(run);
    const coverage = run.readText('tables/coverage.md').split('\n');
    const at = coverage.findIndex((line) => line.startsWith('Seed files read outside the scope'));
    expect(at).toBeGreaterThan(0);
    expect(coverage[at + 1]).toBe('Open items: 7 written in the chapters, not merged');
    expect(coverage[at + 2]).toBe('');
  });

  it('says none were written, or n written with m equal to n, when there is nothing to merge', () => {
    const run = makeRun();
    for (const id of ['F1', 'F2', 'F3']) run.writeText(`features/${id}.md`, run.readText(`features/${id}.md`).replace(/\n### Open items[\s\S]*$/, '\n').replace('openItems: Open items\n', ''));
    aggregateOk(run);
    expect(run.readText('tables/coverage.md')).toContain('Open items: none written in the chapters\n');
  });

  it('leaves the files of a merge it does not use alone: aggregate never writes under open-items', () => {
    const run = makeRun();
    check(run);
    writeMerged(run, goodMerge(run));
    const before = ['sources.json', 'merged.json'].map((name) => readFileSync(join(run.out, 'open-items', name), 'utf-8'));
    aggregateOk(run);
    expect(['sources.json', 'merged.json'].map((name) => readFileSync(join(run.out, 'open-items', name), 'utf-8'))).toEqual(before);
  });
});

describe('page data: the open items table stays current with merged.json', () => {
  it('accepts a run aggregated with a merge, and refuses it once merged.json changes', () => {
    const run = makeRun();
    expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
    check(run);
    writeMerged(run, goodMerge(run));
    aggregateOk(run);
    const data = collectPageData(run.out, run.project);
    expect(data.tables.openItems).toBe(run.readText('tables/open-items.md').trim());
    expect(tableRows(data.tables.openItems)).toHaveLength(4);
    writeMerged(run, { digest: sourcesOf(run).digest, groups: [GROUPS[0]] });
    expect(() => collectPageData(run.out, run.project)).toThrow(/tables\/open-items\.md differs from what aggregate writes now/);
  });
});

describe('mergeProblems and mergedRows, called directly', () => {
  const sources = {
    digest: 'd',
    items: ['a', 'b', 'c', 'd'].map((id, at) => ({ id, feature: at < 2 ? 'F1' : 'F2', item: `item ${id}`, known: '', searched: '' })),
  };

  it('finds no problem in a merge that conserves the items, and orders the rows by the earliest member', () => {
    const merged = { digest: 'd', groups: [{ keep: 'd', also: ['b'] }] };
    expect(mergeProblems(merged, sources)).toEqual([]);
    expect(mergedRows(sources, merged)).toEqual([
      { item: 'item a', known: '', searched: '', features: ['F1'], also: [] },
      { item: 'item d', known: '', searched: '', features: ['F1', 'F2'], also: [{ feature: 'F1', item: 'item b' }] },
      { item: 'item c', known: '', searched: '', features: ['F2'], also: [] },
    ]);
  });

  it('carries every member but keep in a merged row, in source order, whatever the order in the file', () => {
    const merged = { digest: 'd', groups: [{ keep: 'b', also: ['d', 'a', 'c'] }] };
    expect(mergedRows(sources, merged)).toEqual([
      {
        item: 'item b',
        known: '',
        searched: '',
        features: ['F1', 'F2'],
        also: [{ feature: 'F1', item: 'item a' }, { feature: 'F2', item: 'item c' }, { feature: 'F2', item: 'item d' }],
      },
    ]);
  });

  it('gives a row for each item when the merge is null or has a problem', () => {
    const rows = mergedRows(sources, null);
    expect(rows.map((row) => row.item)).toEqual(['item a', 'item b', 'item c', 'item d']);
    expect(mergedRows(sources, { digest: 'x', groups: [{ keep: 'd', also: ['b'] }] })).toEqual(rows);
  });
});
