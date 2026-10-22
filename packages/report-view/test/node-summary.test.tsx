import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NodeSummary } from '../src/components/NodeSummary';
import type { GraphNode } from '../src/data/graph';
import { buildIndex } from '../src/data/indexes';
import type { SemanticPayload } from '../src/data/semantics';
import { CONTRADICTED_NOTICE, NO_SUMMARY_NOTICE, nodeSummaryView } from '../src/lib/node-summary';

const NODES: GraphNode[] = [
  { id: 'file:a.ts', type: 'file', name: 'a.ts', filePath: 'a.ts', summary: '', tags: [] },
  { id: 'function:a.ts:one', type: 'function', name: 'one', filePath: 'a.ts', summary: '', tags: [] },
  { id: 'function:a.ts:two', type: 'function', name: 'two', filePath: 'a.ts', summary: '', tags: [] },
  { id: 'function:a.ts:three', type: 'function', name: 'three', filePath: 'a.ts', summary: '', tags: [] },
  { id: 'function:a.ts:four', type: 'function', name: 'four', filePath: 'a.ts', summary: '', tags: [] },
  { id: 'function:a.ts:own', type: 'function', name: 'own', filePath: 'a.ts', summary: 'Written into the graph itself.', tags: ['lazy'] },
];
const SECRET = 'Spawns a worker per request and never joins it.';
const PAYLOAD: SemanticPayload = {
  entries: [
    { id: 'function:a.ts:one', summary: 'Parses the header.', tags: ['parse'], verification: 'verified' },
    { id: 'function:a.ts:two', summary: 'Guesses the encoding.', tags: [], verification: 'unverified' },
    { id: 'function:a.ts:three', summary: '', tags: ['worker'], verification: 'contradicted' },
    { id: 'file:a.ts', summary: 'The parser module.', tags: [] },
  ],
};
const index = buildIndex({ nodes: NODES, edges: [] }, PAYLOAD);
const view = (id: string) => {
  const found = nodeSummaryView(index, id);
  if (!found) throw new Error(`no node ${id}`);
  return found;
};

describe('nodeSummaryView', () => {
  it('shows a verified or unverified summary with its verdict as written', () => {
    expect(view('function:a.ts:one')).toMatchObject({ text: 'Parses the header.', notice: null, verdict: 'verified', verdictLabel: 'Verified', source: 'semantic' });
    expect(view('function:a.ts:two')).toMatchObject({ text: 'Guesses the encoding.', verdict: 'unverified', verdictLabel: 'Unverified' });
  });

  it('shows a summary with no verdict as unchecked', () => {
    expect(view('file:a.ts')).toMatchObject({ text: 'The parser module.', verdict: 'unchecked', verdictLabel: 'Unchecked' });
  });

  it('says in place of a contradicted summary that it disagrees with the source, and has no text', () => {
    const contradicted = view('function:a.ts:three');
    expect(contradicted).toMatchObject({ text: null, notice: 'This summary disagrees with the source and is not shown.', verdict: 'contradicted', tags: ['worker'] });
    expect(CONTRADICTED_NOTICE).toBe('This summary disagrees with the source and is not shown.');
  });

  it('takes the graph\'s own summary when no entry has the node, and says when there is none', () => {
    expect(view('function:a.ts:own')).toMatchObject({ text: 'Written into the graph itself.', tags: ['lazy'], source: 'graph', verdict: 'unchecked' });
    expect(view('function:a.ts:four')).toMatchObject({ text: null, notice: NO_SUMMARY_NOTICE, source: 'none' });
  });

  it('has no view for a node the graph lacks', () => {
    expect(nodeSummaryView(index, 'function:gone')).toBeNull();
  });

  it('hides a contradicted text even if one reaches it through an index built by hand', () => {
    const hand = buildIndex({ nodes: NODES, edges: [] });
    hand.semantics.byNode.set('function:a.ts:one', { summary: SECRET, tags: [], verification: 'contradicted', source: 'semantic' });
    expect(nodeSummaryView(hand, 'function:a.ts:one')?.text).toBeNull();
  });
});

describe('NodeSummary', () => {
  it('draws the sentence and the verdict for a contradicted summary, and never its text', () => {
    const hand = buildIndex({ nodes: NODES, edges: [] });
    hand.semantics.byNode.set('function:a.ts:three', { summary: SECRET, tags: [], verification: 'contradicted', source: 'semantic' });
    const html = renderToStaticMarkup(<NodeSummary view={nodeSummaryView(hand, 'function:a.ts:three')!} />);
    expect(html).toContain('This summary disagrees with the source and is not shown.');
    expect(html).toContain('Contradicted');
    expect(html).toContain('data-xv-summary="contradicted"');
    expect(html).not.toContain(SECRET);
  });

  it('draws the text, the verdict and the tags of a summary that is shown', () => {
    const html = renderToStaticMarkup(<NodeSummary view={view('function:a.ts:one')} />);
    expect(html).toContain('Parses the header.');
    expect(html).toContain('Verified');
    expect(html).toContain('parse');
    expect(html).not.toContain('is not shown');
  });
});
