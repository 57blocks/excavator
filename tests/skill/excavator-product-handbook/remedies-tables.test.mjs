// openspec change handbook-process-review, task 1.2: `remedies-inputs <out>` prints the defect and design-problem tables the
// remedies writer may name, numbered like the checks and the page number them, and says so when a source is not available.
import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runHandbook } from './helpers.mjs';
import { ITEMS, numberedRun } from './numbers-fixture.mjs';
import { FORM } from './md-run-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
const inputs = (run) => runHandbook(['remedies-inputs', run.out]);

describe('remedies-inputs', () => {
  it('prints one line per defect and per design problem, then its citations', () => {
    const run = numberedRun(cleanups);
    const result = inputs(run);
    expect(result.status).toBe(0);
    expect(result.stdout.split('\n').filter((line) => line !== '')).toEqual([
      'DEFECT D1 P0 security F1 Secret in code',
      `  cites: ${FORM}:5`,
      'DEFECT D2 P0 display F1 Hidden button',
      `  cites: ${FORM}:6`,
      'DEFECT D3 P1 display F2 Late archive',
      `  cites: ${FORM}:8`,
      'DESIGN R1 medium duplication F1,F2 Two places end an order',
      `  cites: ${FORM}:7; ${FORM}:8`,
      'DESIGN R2 high complexity F1 Sending takes many steps',
      `  cites: ${FORM}:6`,
      'DESIGN R3 low dead-end F3 A reminder cannot be stopped',
      `  cites: ${FORM}:11`,
      'PROCESS none: processes.md is missing',
    ]);
  });

  it('says in one line that the design problems are not written', () => {
    const lines = inputs(numberedRun(cleanups, { review: false })).lines;
    expect(lines.slice(-2)).toEqual(['DESIGN none: review.md is missing', 'PROCESS none: processes.md is missing']);
    expect(lines).toHaveLength(8);
  });

  it('says so for a defects chapter that is missing, and for a design problems chapter edited after its render', () => {
    const run = numberedRun(cleanups);
    writeFileSync(join(run.out, 'entries', 'review', 'b1.json'), JSON.stringify({ items: [ITEMS.b1[0]] }));
    expect(inputs(run).lines.filter((line) => line.startsWith('DESIGN'))).toEqual(['DESIGN none: review.md changed after it was rendered from its batch files']);
    const bare = numberedRun(cleanups, { review: false });
    writeFileSync(join(bare.out, 'chapters', 'defects.md'), '# Defects\n\nedited\n');
    expect(inputs(bare).lines[0]).toBe('DEFECT none: defects.md did not pass the check, or changed after it');
  });
});
