// The side of a step of an operation from its citations, and the marking of the runs of server steps for the page
// (openspec change handbook-page-structure, design D22).
import { describe, expect, it } from 'vitest';

import { SERVER_STEPS_END, directorySides, markServerSteps, stepSide } from '../../../skills/excavator-product-handbook/lib/step-sides.mjs';

const CANDIDATES = { items: [
  { kind: 'route', file: 'api/handlers/orders.go' },
  { kind: 'job', file: 'api/jobs/nightly.go' },
  { kind: 'page', file: 'web/src/pages/Orders.tsx' },
  { kind: 'route', file: 'app/server/routes.js' },
  { kind: 'page', file: 'app/client/Home.tsx' },
  { kind: 'main', file: 'main.go' },
] };
const SIDES = directorySides(CANDIDATES);
const OPS = 'Operations';
const MARK = 'Server-side steps:';
const marks = { sides: SIDES, operations: OPS, marker: MARK };
const web = (n) => `(\`web/src/pages/Orders.tsx:${n}\`)`;
const api = (n) => `(\`api/handlers/orders.go:${n}\`)`;

describe('directorySides and stepSide', () => {
  it('sides a top-level directory by the kinds of its candidates, and leaves a directory with both kinds and a file at the root unsided', () => {
    expect(Object.fromEntries(SIDES)).toEqual({ api: 'server', web: 'client', app: 'mixed' });
    expect(directorySides(CANDIDATES.items)).toEqual(SIDES);
  });

  it('gives a step the side of all its cited files, and none when it cites both sides, an unsided directory or nothing', () => {
    expect(stepSide(`1. The server stores it ${api('3-9')}.`, SIDES)).toBe('server');
    expect(stepSide(`1. The page shows it ${web('3')}; it also ${web('9')}.`, SIDES)).toBe('client');
    expect(stepSide(`1. Sent and stored (${'`web/src/pages/Orders.tsx:3`'}; ${'`api/handlers/orders.go:4`'}).`, SIDES)).toBeNull();
    expect(stepSide('1. Rendered (`app/client/Home.tsx:2`).', SIDES)).toBeNull();
    expect(stepSide('1. Nothing cited.', SIDES)).toBeNull();
  });
});

describe('markServerSteps', () => {
  const chapter = (steps) => ['# Orders', '', `## ${OPS}`, '', '### Place an order', '', ...steps, '', '## Rules', '', `- A rule ${api(1)}.`, ''].join('\n');

  it('marks each run of server steps, ends a run the operation goes on after, and keeps the steps in their order and numbers', () => {
    const text = chapter([`1. The clerk sends it ${web(1)}.`, `2. The server checks it ${api(2)}.`, `3. The server stores it ${api(3)}.`, `4. The page shows it ${web(4)}.`, `5. The server emails ${api(5)}.`]);
    const lines = markServerSteps(text, marks).split('\n');
    const at = (start) => lines.findIndex((line) => line.startsWith(start));
    expect(lines.filter((line) => line === MARK)).toHaveLength(2);
    expect(lines.filter((line) => line === SERVER_STEPS_END)).toHaveLength(1);
    expect(at('1.') < lines.indexOf(MARK)).toBe(true);
    expect(lines.indexOf(MARK) < at('2.') && at('3.') < lines.indexOf(SERVER_STEPS_END) && lines.indexOf(SERVER_STEPS_END) < at('4.')).toBe(true);
    expect(lines.lastIndexOf(MARK) > at('4.') && lines.lastIndexOf(MARK) < at('5.')).toBe(true);
    // A blank line before the marker, so that it does not read as a continuation of the step before it.
    expect(lines[lines.indexOf(MARK) - 1]).toBe('');
    expect(lines.filter((line) => /^\d+\. /.test(line)).map((line) => line.slice(0, 2))).toEqual(['1.', '2.', '3.', '4.', '5.']);
  });

  it('keeps an indented continuation line with its step, and a fenced block between steps ends a run', () => {
    const text = chapter([`1. The server checks it`, `   and stores it ${api(2)}.`, '', '```mermaid', 'flowchart LR', '  A --> B', '```', '', `2. The server emails ${api(5)}.`]);
    const lines = markServerSteps(text, marks).split('\n');
    expect(lines.indexOf('   and stores it (`api/handlers/orders.go:2`).')).toBe(lines.indexOf('1. The server checks it') + 1);
    expect(lines.filter((line) => line === MARK)).toHaveLength(2);
    expect(lines.filter((line) => line === SERVER_STEPS_END)).toHaveLength(1);
  });

  it('leaves alone an operation whose writer wrote the marker, steps outside the operations section, and a project without both a server and a page directory', () => {
    const written = chapter([`1. The clerk sends it ${web(1)}.`, '', MARK, '', `2. The server stores it ${api(3)}.`]);
    expect(markServerSteps(written, marks)).toBe(written);
    const rulesOnly = ['# Orders', '', '## Rules', '', `1. The server stores it ${api(3)}.`, ''].join('\n');
    expect(markServerSteps(rulesOnly, marks)).toBe(rulesOnly);
    const text = chapter([`1. The server stores it ${api(3)}.`]);
    expect(markServerSteps(text, { ...marks, sides: directorySides({ items: [{ kind: 'page', file: 'web/a.tsx' }] }) })).toBe(text);
    expect(markServerSteps(text, { ...marks, sides: directorySides({ items: [{ kind: 'route', file: 'api/a.go' }] }) })).toBe(text);
    expect(markServerSteps(text, { ...marks, marker: '' })).toBe(text);
  });

  it('writes no end line after a run that closes its operation, and marks every operation of the section', () => {
    const text = ['## Operations', '', '### One', '', `1. The server stores it ${api(3)}.`, '', '### Two', '', `1. The page shows it ${web(1)}.`, `2. The server stores it ${api(3)}.`, ''].join('\n');
    const out = markServerSteps(text, marks);
    expect(out.split('\n').filter((line) => line === MARK)).toHaveLength(2);
    expect(out).not.toContain(SERVER_STEPS_END);
  });
});
