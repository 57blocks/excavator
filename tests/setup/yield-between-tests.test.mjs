import { describe, expect, it } from 'vitest';

// Guards tests/setup/yield-between-tests.mjs: without it, the second test runs
// before the event loop turns and the immediate queued by the first has not run.
describe('the event loop turns between tests', () => {
  let turned = false;

  it('queues a macrotask from a synchronous test', () => {
    setImmediate(() => { turned = true; });
  });

  it('sees that macrotask run before it starts', () => {
    expect(turned).toBe(true);
  });
});
