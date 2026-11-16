/**
 * Shared setup for the design-problems tests (openspec change handbook-design-review): a run on the synthetic
 * fixture project whose five feature chapters have operations, steps, a state diagram and hand-overs, so
 * that the facts the script counts are known, and a valid item to mutate.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runHandbook } from './helpers.mjs';
import { FORM, chapterText, cite, newMdRun } from './md-run-fixture.mjs';

const f = (range) => cite(range, FORM);

/** F1: two operations (4 and 1 top-level steps, 1 of them server-side), 3 states, 3 arrows, 1 hand-over. */
const F1 = `# Orders

## Overview

Orders are created and sent by clerks (${f('5')}).

## Operations

### Create an order

Steps:

1. The clerk opens the form (${f('5')}).
2. The clerk saves a draft (${f('6')}; \`src/roles.js:1-2\`).
3. The clerk sends the order (${f('10')}).

Server-side steps:

1. The server stores the order (${f('12')}; \`src/menu.js:4\`).

### Cancel an order

1. The clerk cancels the order (${f('7')}).

## States

\`\`\`mermaid
stateDiagram-v2
  [*] --> Draft
  Draft --> Sent : send
  Sent --> Archived
\`\`\`

## Hand-overs

- Sent orders go to the archive (${f('10')}).

## Points to confirm

None.

## Known defects

None.
`;

const simple = (title, operation, steps) => `# ${title}

## Operations

### ${operation}

${steps.map((step, at) => {
  const [range, text = 'A step of the work', extra = []] = Array.isArray(step) ? step : [step];
  return `${at + 1}. ${text} (${[f(range), ...extra.map((cite) => `\`${cite}\``)].join('; ')}).`;
}).join('\n')}

## Points to confirm

None.

## Known defects

None.
`;

export const FEATURE_CHAPTERS = {
  F1,
  F2: simple('Archive', 'Archive an order', ['8', ['9', 'Orders are archived after 30 days']]),
  F3: simple('Reminders', 'Send a reminder', ['11']),
  F4: simple('Admin tool', 'Run the tool', [['12', 'A step of the work', ['src/menu.js:3-5']]]),
  F5: simple('Orders list', 'List orders', [['5-6', 'A step of the work', ['src/roles.js:2-3']]]),
};

/** A checked run with the five feature chapters (areas: A1 holds F1 and F2, A2 holds F3 to F5). */
export function reviewRun(cleanups, { extra = {} } = {}) {
  const run = newMdRun({ ...FEATURE_CHAPTERS, ...extra });
  cleanups.push(run.cleanup);
  mkdirSync(join(run.out, 'entries', 'review'), { recursive: true });
  run.writeBatch = (batch, items) => run.writeJson(join(run.out, 'entries', 'review', `${batch}.json`), { items });
  run.facts = (...args) => runHandbook(['review', 'facts', run.out, ...args, '--project', run.root]);
  run.render = (...args) => runHandbook(['review', 'render', run.out, ...args, '--project', run.root]);
  run.readFacts = () => JSON.parse(readFileSync(join(run.out, 'entries', 'review-facts.json'), 'utf-8'));
  return run;
}

/** A batch-b1 item that holds: a duplication between F1 and F2, citing one line of each chapter. */
export const goodItem = (over = {}) => ({
  dimension: 'duplication',
  impact: 'medium',
  features: ['F1', 'F2'],
  title: 'Two places end an order',
  situation: 'Both features let the clerk close an order',
  consequence: 'A clerk has to know which screen to use',
  cites: [`${FORM}:7`, `${FORM}:8`],
  ...over,
});

export { writeFileSync, chapterText };
