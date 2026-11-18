// openspec change handbook-process-review, task 5.7 (design D7, the change after S4): the business processes are written
// in parts, one per group of the design-problems domain batches, and joined into one chapter; `processes check-part`,
// `parts`, `reset`, `skip`, `join` and `facts <part>` work from the files.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runHandbook } from './helpers.mjs';
import { cite } from './md-run-fixture.mjs';
import { reviewRun } from './review-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const section = (name, line) => `## ${name}\n\n### Features\n\n- ${line}\n\n### Hand-overs\n\nNone.\n`;
const DOMAINS = `# Domains\n\n${section('Operations', `Orders are taken here (${cite('5')}).`)}\n${section('Archive', `Archived orders stay readable (${cite('9')}).`)}`;

const B1 = `## Place an order

1. The clerk: **Create an order** (Orders (F1)) (${cite('5')}).
2. The system: **Archive an order** (Archive (F2)) (${cite('8')}).

## Remind a customer

1. The system: **Send a reminder** (Reminders (F3)) (${cite('11')}).
`;
const B2 = `## Run the admin tool

1. The operator: **Run the tool** (Admin tool (F4)) (${cite('12')}).
`;

/** A run whose domains chapter passed: part b1 is Operations (F1, F3), part b2 is Archive (F2, F4, F5); F1 hands over to F2. */
function partsRun() {
  const run = reviewRun(cleanups, { extra: { domains: DOMAINS } });
  run.writeJson(join(run.out, 'domains.json'), { domains: [{ name: 'Operations', features: ['F1', 'F3'] }, { name: 'Archive', features: ['F2', 'F4', 'F5'] }], handovers: [] });
  run.check('domains');
  run.writeJson(join(run.out, 'domains.json'), {
    domains: [{ name: 'Operations', features: ['F1', 'F3'] }, { name: 'Archive', features: ['F2', 'F4', 'F5'] }],
    handovers: [{ from: 'Operations', to: 'Archive', what: 'Sent orders' }, { from: 'Elsewhere', to: 'Nowhere', what: 'Nothing' }],
  });
  run.write('F1', run.read('chapters/F1.md').replace('- Sent orders go to the archive (', '- Sent orders go to the archive, Archive (F2) ('));
  run.part = (id, text) => {
    mkdirSync(join(run.out, 'entries', 'processes'), { recursive: true });
    writeFileSync(join(run.out, 'entries', 'processes', `${id}.md`), text);
  };
  run.cmd = (sub, ...args) => runHandbook(['processes', sub, run.out, ...args, '--project', run.root]);
  return run;
}

describe('processes check-part', () => {
  it('passes a part whose processes start in its own features and may step into others', () => {
    const run = partsRun();
    run.part('b1', B1);
    const result = run.cmd('check-part', 'b1');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['b1: passed']);
  });

  it('refuses a process whose first step is a feature of another part', () => {
    const run = partsRun();
    run.part('b2', `${B2}\n## Misplaced\n\n1. The clerk: **Create an order** (Orders (F1)) (${cite('5')}).\n`);
    const result = run.cmd('check-part', 'b2');
    expect(result.status).toBe(1);
    expect(result.lines).toEqual(['line 5: process "Misplaced" starts with F1, which is not a feature of this part (Archive); a process belongs to the part of its first step\'s feature']);
  });

  it('refuses a level-1 heading', () => {
    const run = partsRun();
    run.part('b2', `# Business processes\n\n${B2}`);
    const result = run.cmd('check-part', 'b2');
    expect(result.status).toBe(1);
    expect(result.lines).toContain('line 1: a part has no level-1 heading; the chapter title is added when the parts are joined');
  });

  it('refuses an invented operation with the part line number', () => {
    const run = partsRun();
    run.part('b2', B2.replace('Run the tool', 'Run a made-up tool'));
    const result = run.cmd('check-part', 'b2');
    expect(result.status).toBe(1);
    expect(result.lines[0]).toMatch(/^line 3: "Run a made-up tool" is not an operation of F4/);
  });

  it('refuses a citation of a file the project does not have, at the part line', () => {
    const run = partsRun();
    run.part('b2', B2.replace(cite('12'), '`src/nope.js:3`'));
    const result = run.cmd('check-part', 'b2');
    expect(result.status).toBe(1);
    expect(result.lines.some((line) => /^line 3: /.test(line) && line.includes('src/nope.js'))).toBe(true);
  });

  it('refuses a part that was not written, passes an empty one and refuses an unknown part', () => {
    const run = partsRun();
    expect(run.cmd('check-part', 'b1').lines).toEqual(['the part was not written']);
    run.part('b1', '  \n');
    expect(run.cmd('check-part', 'b1').status).toBe(0);
    const unknown = run.cmd('check-part', 'b9');
    expect(unknown.status).toBe(1);
    expect(unknown.lines[0]).toContain('b1, b2');
  });
});

describe('processes parts, reset, skip and join', () => {
  it('states each part from its file', () => {
    const run = partsRun();
    run.part('b1', B1);
    const result = run.cmd('parts');
    expect(result.status).toBe(0);
    expect(result.lines).toEqual(['b1\tdone\tOperations\tF1,F3', 'b2\twrite\tArchive\tF2,F4,F5', '  the part was not written']);
  });

  it('does not join while a part is write and writes nothing', () => {
    const run = partsRun();
    run.part('b1', B1);
    const result = run.cmd('join');
    expect(result.status).toBe(1);
    expect(result.lines).toEqual(['b2\twrite\tArchive']);
    expect(existsSync(join(run.out, 'chapters', 'processes.md'))).toBe(false);
  });

  it('joins done parts, skipping an empty one, into a chapter that passes check processes', () => {
    const run = partsRun();
    run.part('b1', B1);
    run.part('b2', B2);
    const result = run.cmd('join');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['processes.md: joined 2 parts, 3 processes']);
    expect(run.read('chapters/processes.md')).toBe(`# Business processes\n\n${B1.trim()}\n\n${B2.trim()}\n`);
    const checked = run.check('processes');
    expect(checked.status, checked.stdout).toBe(0);
    expect(run.cmd('skip', 'b2').lines).toEqual(['b2: emptied']);
    expect(run.cmd('join').lines).toEqual(['processes.md: joined 1 parts, 2 processes']);
  });

  it('resets a part by deleting its file and skips by writing an empty file', () => {
    const run = partsRun();
    run.part('b1', B1);
    expect(run.cmd('reset', 'b1').lines).toEqual(['b1: cleared']);
    expect(existsSync(join(run.out, 'entries', 'processes', 'b1.md'))).toBe(false);
    expect(run.cmd('skip', 'b1').lines).toEqual(['b1: emptied']);
    expect(readFileSync(join(run.out, 'entries', 'processes', 'b1.md'), 'utf-8')).toBe('');
    expect(run.cmd('reset', 'b7').status).toBe(1);
    expect(run.cmd('skip', 'b7').lines[0]).toContain('b1, b2');
  });
});

describe('processes facts <part>', () => {
  it('prints the part\'s and linked features\' operations, the related edges and the domain hand-overs only', () => {
    const run = partsRun();
    const result = runHandbook(['processes', 'facts', run.out, 'b2']);
    expect(result.status, result.stderr).toBe(0);
    const kinds = result.lines.map((line) => line.split('\t').slice(0, 2).join(' '));
    expect(kinds).toContain('OP F1');
    expect(kinds).toContain('OP F2');
    expect(kinds).toContain('OP F4');
    expect(kinds).toContain('OP F5');
    expect(kinds.some((kind) => kind.endsWith(' F3'))).toBe(false);
    expect(result.lines.filter((line) => line.startsWith('EDGE'))).toEqual([expect.stringMatching(/^EDGE\tF1\tF2\tF1\.md:\d+$/)]);
    expect(result.lines.filter((line) => line.startsWith('HANDOVER'))).toEqual(['HANDOVER\tOperations -> Archive: Sent orders']);
    expect(result.lines.at(-1)).toBe('Counts: 5 operations in 4 features, 0 features unread, 1 edges, 1 domain hand-overs, in part b2');
  });

  it('keeps the unscoped output and refuses an unknown part', () => {
    const run = partsRun();
    const all = runHandbook(['processes', 'facts', run.out]);
    expect(all.status).toBe(0);
    expect(all.lines.some((line) => line.startsWith('OP\tF3'))).toBe(true);
    expect(all.lines.filter((line) => line.startsWith('HANDOVER'))).toHaveLength(2);
    const unknown = runHandbook(['processes', 'facts', run.out, 'b9']);
    expect(unknown.status).toBe(1);
    expect(unknown.lines[0]).toContain('b1, b2');
  });
});

