// The links of a hand-over text to the features it names (task 4.3): the title before the reference becomes the link and the
// reference goes; otherwise the reference is replaced by a link with the chapter's title; an unknown reference stays.
import { describe, expect, it } from 'vitest';

import { linkFeatures } from '../src/lib/feature-links';

const titles: Record<string, string> = { F1: 'Order entry', F2: 'Invoicing' };
const of = (text: string) => linkFeatures(text, (id) => titles[id]);

describe('linkFeatures', () => {
  it('links the title that stands right before the reference and drops the reference', () => {
    expect(of('Sends Order entry (F1) onward.')).toEqual([{ kind: 'text', text: 'Sends ' }, { kind: 'link', id: 'F1', text: 'Order entry' }, { kind: 'text', text: ' onward.' }]);
  });

  it('replaces a reference that follows other words by a link with the chapter title', () => {
    expect(of('Sends the order (F1) onward.')).toEqual([{ kind: 'text', text: 'Sends the order ' }, { kind: 'link', id: 'F1', text: 'Order entry' }, { kind: 'text', text: ' onward.' }]);
  });

  it('keeps a reference to a chapter the page does not have, as written', () => {
    expect(of('Sends it (F9) onward.')).toEqual([{ kind: 'text', text: 'Sends it (F9) onward.' }]);
    expect(of('See (F9) and Invoicing (F2).')).toEqual([{ kind: 'text', text: 'See (F9) and ' }, { kind: 'link', id: 'F2', text: 'Invoicing' }, { kind: 'text', text: '.' }]);
  });

  it('handles several references, a reference at the start and a text with none', () => {
    expect(of('(F1) and Invoicing (F2)')).toEqual([{ kind: 'link', id: 'F1', text: 'Order entry' }, { kind: 'text', text: ' and ' }, { kind: 'link', id: 'F2', text: 'Invoicing' }]);
    expect(of('Nothing to link.')).toEqual([{ kind: 'text', text: 'Nothing to link.' }]);
    expect(of('')).toEqual([]);
  });

  it('does not take the title from before an earlier reference', () => {
    expect(of('Order entry (F1) (F1)')).toEqual([{ kind: 'link', id: 'F1', text: 'Order entry' }, { kind: 'text', text: ' ' }, { kind: 'link', id: 'F1', text: 'Order entry' }]);
  });
});
