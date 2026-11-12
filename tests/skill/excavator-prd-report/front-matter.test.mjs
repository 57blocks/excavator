// The chapter front-matter reader: the lists of change prd-report-prd-shape
// (design D3) hold titles with a colon in them, quoted or not.
import { describe, expect, it } from 'vitest';

import { parseFrontMatter } from '../../../skills/excavator-prd-report/lib/front-matter.mjs';

const parse = (lines) => parseFrontMatter(`---\n${lines.join('\n')}\n---\n## Body\n`);

describe('parseFrontMatter: flows with a colon in the title', () => {
  it('reads quoted items of a dash list', () => {
    const read = parse(['id: F1', 'flows:', '  - "Flow 1: Password sign-in"', "  - 'Flow 2: Google sign-in'", 'openItems: Open items', 'chapter: 2']);
    expect(read.ok).toBe(true);
    expect(read.data.flows).toEqual(['Flow 1: Password sign-in', 'Flow 2: Google sign-in']);
    expect(read.data.openItems).toBe('Open items');
    expect(read.data.chapter).toBe(2);
  });

  it('reads unquoted items of a dash list and the items of an inline list, commas in quotes kept', () => {
    expect(parse(['flows:', '  - Flow 1: Password sign-in']).data.flows).toEqual(['Flow 1: Password sign-in']);
    expect(parse(['flows: ["Flow 1: Sign in, then out", Flow 2: Refresh]']).data.flows).toEqual(['Flow 1: Sign in, then out', 'Flow 2: Refresh']);
  });

  it('reads an empty list written as [] and one written as a key with no items', () => {
    expect(parse(['flows: []', 'actors: [A, B]']).data).toEqual({ flows: [], actors: ['A', 'B'] });
    expect(parse(['flows:', 'chapter: 1']).data.flows).toEqual([]);
  });
});
