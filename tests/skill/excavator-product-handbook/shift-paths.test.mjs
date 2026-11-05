// The path an item has in an entry after other items were removed from it: a removed
// sibling before it moves it up by one, at every level of the path.
import { describe, expect, it } from 'vitest';

import { shiftedPath } from '../../../skills/excavator-product-handbook/lib/shift-paths.mjs';

const gone = (...paths) => new Set(paths);

describe('shiftedPath', () => {
  it('leaves a path alone when nothing before it was removed', () => {
    expect(shiftedPath('states[1]', gone())).toBe('states[1]');
    expect(shiftedPath('states[0]', gone('states[1]'))).toBe('states[0]');
    expect(shiftedPath('purpose', gone('who[0]'))).toBe('purpose');
  });

  it('moves an item up by each removed sibling before it, and not for those after it or in another list', () => {
    expect(shiftedPath('states[3]', gone('states[0]', 'states[2]', 'states[4]', 'where[1]'))).toBe('states[1]');
  });

  it('shifts every level of a path, reading the removed paths as they were before the removal', () => {
    const removed = gone('screens[0]', 'screens[0].fields[0]', 'screens[1].fields[0]', 'screens[1].fields[0].rules[0]');
    expect(shiftedPath('screens[1].fields[1].rules[2]', removed)).toBe('screens[0].fields[0].rules[2]');
    expect(shiftedPath('operations[2].sentences[1]', gone('operations[0]', 'operations[2].sentences[0]'))).toBe('operations[1].sentences[0]');
  });
});
