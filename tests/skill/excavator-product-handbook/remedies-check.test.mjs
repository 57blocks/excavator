// openspec change handbook-process-review, task 1.3: `check remedies` enforces only what guards against fabrication: every id
// of an id group exists, a block holds at most one id group, and every citation of a block is one of the citations of the items
// that block's id group names. The chapter's shape is a writing instruction and is not checked.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cite } from './md-run-fixture.mjs';
import { numberedRun } from './numbers-fixture.mjs';

const GOOD = `# Remedies

## Measures across processes

- **Merge entrances** Close orders from one screen [R1] (${cite('7')}; ${cite('8')}).

## Defect fixes

- **security** Move the secret out of the code [D1] (${cite('5')}).
- **display** Show the button and speed up the archive [D2, D3] (${cite('6')}; ${cite('8')}).

## To fix

1. **Fix** Show the late archive [D3] (${cite('8')}).
`;

const cleanups = [];
let withReview;
let noReview;
beforeAll(() => {
  withReview = numberedRun(cleanups);
  noReview = numberedRun(cleanups, { review: false });
});
afterAll(() => cleanups.forEach((fn) => fn()));

const verdict = (run, text) => {
  run.write('remedies', text);
  return run.check('remedies');
};
const rejects = (name, mutate, expected, { review = true } = {}) => it(`refuses ${name}`, () => {
  const result = verdict(review ? withReview : noReview, mutate(GOOD));
  expect(result.status, result.stdout).toBe(1);
  expect(result.stdout).toMatch(expected);
});

describe('check remedies', () => {
  it('passes a chapter whose ids exist and whose citations sit with the ids they come from', () => {
    const result = verdict(withReview, GOOD);
    expect(result.status, result.stdout).toBe(0);
  });
  it('passes a free-form chapter: any headings, paragraphs, no fixed sections', () => {
    const free = `# Anything\n\n## First thoughts\n\nThe secret is stored in the code [D1] (${cite('5')}).\n\n### Detail\n\n- A list item [R1, D2] (${cite('7')}; ${cite('6')}).\n\nA closing paragraph with its own ids [D2] (${cite('6')}).\n`;
    const result = verdict(withReview, free);
    expect(result.status, result.stdout).toBe(0);
  });
  rejects('an R id beyond the design problems', (t) => t.replace('[R1]', '[R200]'), /line 5: R200 is not a design problem: there are 3/);
  rejects('a D id beyond the defects', (t) => t.replace('[D3] (', '[D9] ('), /D9 is not a defect: there are 3/);
  rejects('an R id when the design problems are not available', (t) => t, /R1: the design problems are not available \(review.md is missing\)/, { review: false });
  rejects('a P id before the processes chapter exists', (t) => t.replace('[R1]', '[P1]'), /P1: the business processes are not available \(processes.md is missing\)/);
  rejects('a citation that is not among those of the named items', (t) => t.replace('[D1] (' + cite('5') + ')', '[D1] (' + cite('12') + ')'), /the citation `src\/forms\/order-form.js:12` is not one of the citations of D1/);
  rejects('a citation in a block without ids', (t) => t.replace('[D1] (', '('), /a citation must sit with the ids of the items it is copied from/);
  rejects('two id groups in a block', (t) => t.replace('[D1] (', '[D1] and [D2] ('), /the block holds 2 id groups/);
});
