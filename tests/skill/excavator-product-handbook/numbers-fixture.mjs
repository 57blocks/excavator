/**
 * Shared setup for the item-number tests (openspec change handbook-process-review, slice S0): a checked run with a defects
 * chapter of three defects (D1 security P0, D2 display P0, D3 display P1) and, unless left out, a design-problems chapter
 * rendered from batch files (R1 duplication medium, R2 complexity high, R3 dead end low).
 */

import { FORM, cite } from './md-run-fixture.mjs';
import { goodItem, reviewRun } from './review-fixture.mjs';

export const DEFECTS_THREE = `# Defects

## P0

- **security** **Secret in code** A secret is stored in the code, Orders (F1) (${cite('5')}).
- **display** **Hidden button** The list hides a button, Orders (F1) (${cite('6')}).

## P1

- **display** **Late archive** The archive page lags, Archive (F2) (${cite('8')}).

## P2

None.
`;

export const ITEMS = {
  b1: [
    goodItem(),
    goodItem({ dimension: 'complexity', impact: 'high', features: ['F1'], title: 'Sending takes many steps', situation: 'Creating an order takes 4 steps', consequence: 'A clerk needs several screens', cites: [`${FORM}:6`] }),
  ],
  b2: [goodItem({ dimension: 'dead-end', impact: 'low', features: ['F3'], title: 'A reminder cannot be stopped', situation: 'Sending a reminder is one step', consequence: 'Nobody can cancel it', cites: [`${FORM}:11`] })],
};

/** Writes the three batch files and renders and checks the design-problems chapter; returns the render result. */
export function renderReview(run, items = ITEMS) {
  run.writeBatch('b1', items.b1);
  run.writeBatch('b2', items.b2);
  run.writeBatch('cross', []);
  const result = run.render();
  if (result.status !== 0) throw new Error(`review render: ${result.stdout}`);
  return run.check('review');
}

/** A run with the defects chapter and, with `review`, the design-problems chapter. */
export function numberedRun(cleanups, { review = true } = {}) {
  const run = reviewRun(cleanups);
  run.write('defects', DEFECTS_THREE);
  run.check('defects');
  if (review) {
    run.facts();
    renderReview(run);
  }
  return run;
}

/** The cites of each item as `remedies-inputs` prints them. */
export const C = (range) => `${FORM}:${range}`;
