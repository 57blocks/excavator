// artifact-view task 4.1: the committed dev fixture is exactly what its
// generator produces (fixed clock, synthetic project), so it cannot drift
// from the bake unnoticed.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { SAMPLE_BUNDLE, makeSampleBundle } from './fixtures/make-sample-bundle.mjs';

describe('packages/view/fixtures/sample.bundle.txt', () => {
  it('is byte-identical to a fresh run of make-sample-bundle.mjs', async () => {
    const fresh = await makeSampleBundle();
    const committed = readFileSync(SAMPLE_BUNDLE, 'utf-8');
    expect(Buffer.from(committed).equals(Buffer.from(fresh)), 'run: node tests/view/fixtures/make-sample-bundle.mjs').toBe(true);
  }, 120_000);

  it('the comparison sees a one-character change (instrument check)', async () => {
    const fresh = await makeSampleBundle();
    const flipped = `${fresh.slice(0, -2)}${fresh.at(-2) === 'A' ? 'B' : 'A'}\n`;
    expect(Buffer.from(flipped).equals(Buffer.from(fresh))).toBe(false);
  }, 120_000);
});
