import { describe, expect, it } from 'vitest';

import type { DomainNode } from '../src/data/domain';
import { ARROWS_NOTE, DOMAIN_NOTE, domainCountsText, evidenceTarget, metaSections, revisionNote, stepTarget } from '../src/lib/domain-details';
import { NOT_IN_GRAPH } from '../src/lib/locate';

describe('metaSections', () => {
  it('writes each field of domainMeta as a titled section, in the order the file has them', () => {
    const sections = metaSections({ entities: ['Invoice', 'Payment'], businessRules: ['An invoice is issued once'], entryPoint: 'POST /charge', entryType: 'http' });
    expect(sections.map((s) => [s.title, s.items])).toEqual([
      ['Entities', ['Invoice', 'Payment']], ['Business rules', ['An invoice is issued once']], ['Entry point', ['POST /charge']], ['Entry type', ['http']],
    ]);
  });

  it('says a list with nothing in it is empty rather than leaving it out', () => {
    expect(metaSections({ entities: [] })).toEqual([{ key: 'entities', title: 'Entities', items: [], empty: true }]);
  });

  it('writes numbers and booleans as text, and anything nested as JSON, and drops nothing', () => {
    const sections = metaSections({ count: 3, flag: false, nested: { a: [1, 2] }, mixed: ['x', 5, { y: 1 }], nothing: null });
    expect(sections.map((s) => s.items)).toEqual([['3'], ['false'], ['{"a":[1,2]}'], ['x', '5', '{"y":1}'], []]);
    expect(sections[4]).toMatchObject({ key: 'nothing', empty: true });
  });

  it('has no sections for no domainMeta', () => {
    expect(metaSections(undefined)).toEqual([]);
    expect(metaSections({})).toEqual([]);
  });
});

describe('what the sidebar says in fixed words', () => {
  it('says the domain graph is a model\'s description of the code and not a fact of it', () => {
    expect(DOMAIN_NOTE).toBe('The domain graph is derived by a model from the code; it describes the code and is not itself a fact of the code.');
  });

  it('says the arrows of a flow are the order of its steps, not edges', () => {
    expect(ARROWS_NOTE).toMatch(/flow_step/);
    expect(ARROWS_NOTE).toMatch(/not edges of the domain graph/);
  });

  it('uses the words the locate lists use for what the graph lacks', () => {
    expect(NOT_IN_GRAPH).toBe('Not in the graph.');
  });
});

describe('the code a step or an evidence line opens', () => {
  const step: DomainNode = { id: 'step:a', type: 'step', name: 'Capture', filePath: 'src/a.js', lineRange: [4, 9] };

  it('opens a step at its file and lines, as a node the drawer can show', () => {
    expect(stepTarget(step)).toMatchObject({ id: 'step:a', type: 'step', name: 'Capture', filePath: 'src/a.js', lineRange: [4, 9] });
  });

  it('has nothing to open for a step with no file, and for a range that is not two numbers it opens the file alone', () => {
    expect(stepTarget({ ...step, filePath: undefined })).toBeNull();
    expect(stepTarget({ ...step, filePath: '' })).toBeNull();
    expect(stepTarget({ ...step, lineRange: undefined })?.lineRange).toBeUndefined();
    expect(stepTarget({ ...step, lineRange: [3] as unknown as [number, number] })?.lineRange).toBeUndefined();
  });

  it('opens an evidence line as that one line of its file', () => {
    expect(evidenceTarget({ file: 'src/b.js', line: 12, source: 'rule' })).toMatchObject({ filePath: 'src/b.js', lineRange: [12, 12], name: 'src/b.js:12' });
    expect(evidenceTarget({ file: 'src/b.js' })?.lineRange).toBeUndefined();
    expect(evidenceTarget({ file: '' })).toBeNull();
    expect(evidenceTarget({ file: 'src/b.js', line: 0 })?.lineRange).toBeUndefined();
  });
});

describe('revisionNote', () => {
  const product = { status: 'different-revision', revision: 'git:0', reason: null };

  it('says nothing for a domain graph made at this revision from these facts', () => {
    expect(revisionNote({ status: 'included', revision: 'git:1', reason: null }, 'git:1')).toBeNull();
  });

  it('writes both revisions when the revision differs', () => {
    expect(revisionNote(product, 'git:1')).toBe('The domain graph was made at git:0; the source snapshot is git:1.');
  });

  it('writes both digests when the facts differ, and both sentences when both do', () => {
    const reason = "domain-graph.json was made from other facts than knowledge-graph.jsonl: its factDigest is aa and the graph's factsDigest is bb";
    expect(revisionNote({ ...product, revision: 'git:1', reason }, 'git:1')).toBe(`${reason}.`);
    expect(revisionNote({ ...product, reason }, 'git:1')).toBe(`The domain graph was made at git:0; the source snapshot is git:1. ${reason}.`);
  });
});

describe('domainCountsText', () => {
  it('lists what the packer counted in the domain graph, with the singular where it is one', () => {
    expect(domainCountsText({ domains: 9, flows: 36, steps: 150, crossDomain: 14 })).toBe('9 domains, 36 flows, 150 steps and 14 cross-domain edges.');
    expect(domainCountsText({ domains: 1, flows: 1, steps: 1, crossDomain: 1 })).toBe('1 domain, 1 flow, 1 step and 1 cross-domain edge.');
    expect(domainCountsText({ domains: 1234, flows: 0, steps: 0, crossDomain: 0 })).toBe('1,234 domains, 0 flows, 0 steps and 0 cross-domain edges.');
  });

  it('says nothing when the packer gave no counts', () => {
    expect(domainCountsText(undefined)).toBeNull();
    expect(domainCountsText({ stale: 1 } as never)).toBeNull();
  });
});
