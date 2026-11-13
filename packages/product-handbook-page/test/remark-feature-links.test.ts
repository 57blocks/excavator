// The remark plugin that links `Title (F12)` to its chapter, on hand-made trees: the two parenthesis forms, the title before the
// reference against the bare id, ids the page lacks, the node kinds it leaves alone, and the chapter's own id.
import { describe, expect, it } from 'vitest';

import { remarkFeatureLinks } from '../src/lib/remark-feature-links';

const OPEN = String.fromCharCode(0xff08);
const CLOSE = String.fromCharCode(0xff09);
const titles = { F1: 'Orders', F2: 'Leave requests', F3: 'Billing' };
const hrefOf = (id: string): string => `#/product/chapter/${id}`;

type Node = { type: string; value?: string; url?: string; children?: Node[]; data?: { hProperties?: Record<string, string> } };
const text = (value: string): Node => ({ type: 'text', value });
const run = (children: Node[], own?: string): Node[] => {
  const tree: Node = { type: 'root', children: [{ type: 'paragraph', children }] };
  remarkFeatureLinks({ titles, hrefOf, own })(tree);
  return (tree.children as Node[])[0].children as Node[];
};
const shape = (nodes: Node[]): string[] => nodes.map((node) => (node.type === 'link' ? `[${node.children?.[0].value}](${node.url}|${node.data?.hProperties?.['data-feature']})` : node.value ?? `<${node.type}>`));

describe('remarkFeatureLinks', () => {
  it('turns the title before an ASCII reference into the link and drops the reference', () => {
    expect(shape(run([text('See Orders (F1) now')]))).toEqual(['See ', '[Orders](#/product/chapter/F1|F1)', ' now']);
  });

  it('does the same with full-width parentheses', () => {
    expect(shape(run([text(`See Leave requests ${OPEN}F2${CLOSE} now`)]))).toEqual(['See ', '[Leave requests](#/product/chapter/F2|F2)', ' now']);
  });

  it('links only the id, parentheses kept, when the title is not right before it', () => {
    expect(shape(run([text('The approval step (F3) runs')]))).toEqual(['The approval step (', '[F3](#/product/chapter/F3|F3)', ') runs']);
    expect(shape(run([text(`The approval step ${OPEN}F3${CLOSE} runs`)]))).toEqual(['The approval step ' + OPEN, '[F3](#/product/chapter/F3|F3)', CLOSE + ' runs']);
  });

  it('leaves a reference to an id the page does not have as written', () => {
    expect(shape(run([text('Unknown (F99) here')]))).toEqual(['Unknown (F99) here']);
  });

  it('leaves the chapter its own id', () => {
    expect(shape(run([text('Orders (F1) and Billing (F3)')], 'F1'))).toEqual(['Orders (F1) and ', '[Billing](#/product/chapter/F3|F3)']);
  });

  it('handles several references in one text', () => {
    expect(shape(run([text('Orders (F1), Billing (F3)')]))).toEqual(['[Orders](#/product/chapter/F1|F1)', ', ', '[Billing](#/product/chapter/F3|F3)']);
  });

  it('leaves inline code, links and headings alone and goes into emphasis', () => {
    const inline = run([{ type: 'inlineCode', value: 'Orders (F1)' }, { type: 'link', url: 'x', children: [text('Orders (F1)')] }, { type: 'emphasis', children: [text('Billing (F3)')] }]);
    expect(inline[0].value).toBe('Orders (F1)');
    expect(inline[1].children?.[0].value).toBe('Orders (F1)');
    expect(shape(inline[2].children as Node[])).toEqual(['[Billing](#/product/chapter/F3|F3)']);
    const tree: Node = { type: 'root', children: [{ type: 'heading', children: [text('Orders (F1)')] }, { type: 'code', value: 'Orders (F1)' }] };
    remarkFeatureLinks({ titles, hrefOf })(tree);
    expect(tree.children?.[0].children?.[0].value).toBe('Orders (F1)');
    expect(tree.children?.[1].value).toBe('Orders (F1)');
  });
});
