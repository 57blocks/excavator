// Oracle O1 (domain flow half) of openspec change handbook-free-chapter: check-domain-flows accepts each of the four kinds of edge,
// refuses every kind of node and edge that does not match the fact sheets and the chapters, keeps its attempts in state.json
// (three at most), and the checked diagram is drawn in handbook.md and in the page data, deterministically; a failed one and a
// missing one each have their fixed text.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FORM, GOOD_CHAPTER, goodEntryV3 } from './chapter-fixture.mjs';
import { clone, makeCheckedMapRun, runHandbook, verifyChecked } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const NO_LEGACY = { env: { EXCAVATOR_HANDBOOK_ALLOW_V2_ENTRY: '' } };
const ui = JSON.parse(readFileSync(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url), 'utf-8')).strings;
const ev = (file, passage) => ({ file, passage });
const STATUSES = "const statuses = ['Draft', 'Submitted'];";

const STUB = '<!doctype html><html lang="und"><head><meta charset="UTF-8"><!-- xv:csp --></head><body><div id="root"></div><!-- xv:data --></body></html>';
const stubDir = mkdtempSync(join(tmpdir(), 'xhb-flow-stub-'));
const stubPath = join(stubDir, 'template.html');
writeFileSync(stubPath, STUB);
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

/** F1 is a checked /3 entry (hand-over to F2, one transition) and F2 a verified /2 entry (hand-over to F1); both are in domain D1. */
function flowRun() {
  const run = makeCheckedMapRun();
  cleanups.push(run.cleanup);
  run.writeDomains();
  run.strict = (command, ...args) => runHandbook([command, run.out, ...args, '--project', run.root], NO_LEGACY);
  mkdirSync(join(run.out, 'chapters'), { recursive: true });
  writeFileSync(join(run.out, 'chapters', 'F1.md'), GOOD_CHAPTER);
  const first = goodEntryV3();
  first.transitions = [{ from: 'Draft', to: 'Submitted', by: 'The clerk sends the order.', evidence: [ev(FORM, STATUSES)] }];
  run.writeEntry('F1', first);
  expect(run.strict('check-entry', 'F1').status).toBe(0);
  const second = clone(run.entry);
  second.id = 'F2';
  second.operations[0].handoffs = [{ feature: 'F1', text: 'Reopened orders go back to the clerk.', evidence: [ev(FORM, "{ label: 'Customer Name', required: true },")] }];
  run.writeEntry('F2', second);
  expect(run.run('check-entry', 'F2').status).toBe(0);
  verifyChecked(run, 'F2');
  run.writeFlows = (doc) => writeFileSync(join(run.out, 'domain-flows.json'), `${JSON.stringify(doc, null, 2)}\n`);
  run.check = () => run.strict('check-domain-flows');
  run.state = () => JSON.parse(readFileSync(join(run.out, 'state.json'), 'utf-8'));
  return run;
}

/** A diagram of D1 that passes: every kind of node, and the four kinds of edge. */
const goodFlows = () => ({
  format: 'excavator-product-handbook-domain-flows/1',
  domains: [{
    domain: 'D1',
    nodes: [
      { id: 'n1', feature: 'F1' },
      { id: 'n2', feature: 'F2' },
      { id: 'n3', state: { feature: 'F1', label: 'Draft' } },
      { id: 'n4', state: { feature: 'F1', label: 'Submitted' } },
      { id: 'n5', item: { feature: 'F1', item: 'chapter.6' }, text: 'Draft' },
      { id: 'n6', item: { feature: 'F1', item: 'chapter.7' }, text: 'Submitted' },
    ],
    edges: [
      { from: 'n1', to: 'n2', text: 'archive' },
      { from: 'n2', to: 'n1' },
      { from: 'n3', to: 'n4', text: 'sends' },
      { from: 'n5', to: 'n6', text: 'sent' },
      { from: 'n5', to: 'n3' },
      { from: 'n4', to: 'n6', text: 'Submitted' },
    ],
  }],
});

describe('check-domain-flows accepts', () => {
  it('a diagram with a feature, a state and an item node and the four kinds of edge, and records it as checked', () => {
    const run = flowRun();
    run.writeFlows(goodFlows());
    const result = run.check();
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(result.lines).toEqual(['domain flows ok: 1 domains, 6 nodes, 6 edges']);
    expect(run.state().domainFlows).toEqual({ status: 'checked', attempts: 1, reasons: [] });
  });

  it('each kind of edge alone', () => {
    const edges = [
      [{ id: 'a', feature: 'F1' }, { id: 'b', feature: 'F2' }, { from: 'a', to: 'b' }],
      [{ id: 'a', state: { feature: 'F1', label: 'Draft' } }, { id: 'b', state: { feature: 'F1', label: 'Submitted' } }, { from: 'a', to: 'b' }],
      [{ id: 'a', item: { feature: 'F1', item: 'chapter.3' }, text: 'Customer Name' }, { id: 'b', item: { feature: 'F1', item: 'chapter.4' }, text: 'item count' }, { from: 'a', to: 'b' }],
      [{ id: 'a', item: { feature: 'F1', item: 'chapter.7' }, text: 'sent' }, { id: 'b', state: { feature: 'F1', label: 'Submitted' } }, { from: 'a', to: 'b' }],
      [{ id: 'a', state: { feature: 'F1', label: 'Draft' } }, { id: 'b', item: { feature: 'F1', item: 'chapter.6' }, text: 'Draft' }, { from: 'a', to: 'b' }],
    ];
    const run = flowRun();
    for (const [a, b, edge] of edges) {
      run.writeFlows({ ...goodFlows(), domains: [{ domain: 'D1', nodes: [a, b], edges: [edge] }] });
      const result = run.check();
      expect(result.status, `${JSON.stringify(edge)}\n${result.stdout}${result.stderr}`).toBe(0);
    }
  });

  it('a file that lists no domain at all', () => {
    const run = flowRun();
    run.writeFlows({ format: 'excavator-product-handbook-domain-flows/1', domains: [] });
    expect(run.check().lines).toEqual(['domain flows ok: 0 domains, 0 nodes, 0 edges']);
  });
});

/** The good file through `mutate` must be refused with a line matching `expected`; the good file then passes. */
function refuses(name, mutate, expected) {
  it(name, () => {
    const run = flowRun();
    const doc = goodFlows();
    mutate(doc.domains[0], doc);
    run.writeFlows(doc);
    const bad = run.check();
    expect(bad.status, `${bad.stdout}${bad.stderr}`).toBe(1);
    expect(bad.stdout).toMatch(expected);
    expect(bad.lines.at(-1)).toBe('Next: fix domain-flows.json and run check-domain-flows again (attempt 2 of 3)');
    expect(run.state().domainFlows).toMatchObject({ status: 'failed', attempts: 1 });
    run.writeFlows(goodFlows());
    expect(run.check().status).toBe(0);
  });
}

describe('check-domain-flows refuses', () => {
  refuses('a feature node of a feature that is not in the domain', (domain) => { domain.nodes[0].feature = 'F3'; }, /node n1: feature F3 is not in domain D1/);
  refuses('a feature node of a feature with no entry in the handbook', (domain) => { domain.nodes[0].feature = 'F5'; }, /node n1: feature F5 has no entry in the handbook/);
  refuses('a state label that is not in the fact sheet', (domain) => { domain.nodes[2].state.label = 'Archived'; }, /node n3: .*"Archived" is not a state of F1/);
  refuses('an item text that is not in the item', (domain) => { domain.nodes[4].text = 'Archived'; }, /node n5: .*"Archived" does not occur in chapter\.6/);
  refuses('an item text of more than 24 characters', (domain) => { domain.nodes[4].text = 'An order is Draft until it is sent'; }, /node n5: .*1 to 24 characters/);
  refuses('an item node of a feature with no chapter', (domain) => { domain.nodes.push({ id: 'n7', item: { feature: 'F2', item: 'chapter.1' }, text: 'x' }); }, /node n7: .*F2 has no chapter/);
  refuses('an item id that the chapter does not have', (domain) => { domain.nodes[4].item.item = 'chapter.99'; }, /node n5: .*chapter\.99 is not an item of F1/);
  refuses('a node id used twice', (domain) => { domain.nodes[1].id = 'n1'; }, /node n1: .*used more than once/);
  refuses('an edge with no matching kind (a feature to a state)', (domain) => { domain.edges.push({ from: 'n1', to: 'n3' }); }, /edge n1 -> n3: .*no kind of edge/);
  refuses('a state to state edge with no transition', (domain) => { domain.edges.push({ from: 'n4', to: 'n3' }); }, /edge n4 -> n3: .*no transition from "Submitted" to "Draft"/);
  refuses('an item to item edge that runs backwards in the chapter', (domain) => { domain.edges.push({ from: 'n6', to: 'n5' }); }, /edge n6 -> n5: .*comes later/);
  refuses('an item and a state edge whose label is not in the item', (domain) => { domain.edges.push({ from: 'n5', to: 'n4' }); }, /edge n5 -> n4: .*"Submitted" does not occur in chapter\.6/);
  refuses('an edge to a node that is not there', (domain) => { domain.edges.push({ from: 'n1', to: 'n9' }); }, /edge n1 -> n9: .*no node n9/);
  refuses('an edge text of more than 12 characters', (domain) => { domain.edges[0].text = 'finished orders'; }, /edge n1 -> n2: .*1 to 12 characters/);
  refuses('an edge text that is not in its source', (domain) => { domain.edges[0].text = 'cancel'; }, /edge n1 -> n2: .*"cancel" does not occur/);
  refuses('a domain that is not in domains.json', (domain) => { domain.domain = 'D9'; }, /domain D9: .*not a domain/);
  refuses('a domain listed twice', (_, doc) => { doc.domains.push(clone(doc.domains[0])); }, /domain D1: .*more than once/);
  refuses('a wrong format', (_, doc) => { doc.format = 'other/1'; }, /format/);
});

describe('check-domain-flows refuses a feature to feature edge with no hand-over', () => {
  it('with an entry on both ends but the hand-over the other way', () => {
    const run = flowRun();
    const doc = goodFlows();
    doc.domains[0].edges = [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n1' }];
    run.writeFlows(doc);
    expect(run.check().status).toBe(0);
    // F1 hands over to F2 only: a second hand-over target the fact sheet does not have is refused.
    const entry = goodEntryV3();
    entry.handoffs = [];
    entry.transitions = [{ from: 'Draft', to: 'Submitted', by: 'The clerk sends the order.', evidence: [ev(FORM, STATUSES)] }];
    run.writeEntry('F1', entry);
    expect(run.strict('check-entry', 'F1').status).toBe(0);
    const result = run.check();
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/edge n1 -> n2: .*no hand-over from F1 to F2/);
  });
});

describe('check-domain-flows reports', () => {
  it('a missing file with a line that says so, and records no attempt', () => {
    const run = flowRun();
    const result = run.check();
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/domain-flows\.json is missing/);
    expect(run.state().domainFlows).toBeUndefined();
  });

  it('every problem on its own line, so one file shows all of them', () => {
    const run = flowRun();
    const doc = goodFlows();
    doc.domains[0].nodes[2].state.label = 'Archived';
    doc.domains[0].edges[0].text = 'cancel';
    run.writeFlows(doc);
    const result = run.check();
    expect(result.lines.filter((line) => /^D1 /.test(line) || /^domain D1/.test(line))).toHaveLength(2);
  });

  it('three failed attempts as the end of the road, and no fourth attempt', () => {
    const run = flowRun();
    const doc = goodFlows();
    doc.domains[0].edges[0].text = 'cancel';
    run.writeFlows(doc);
    expect(run.check().lines.at(-1)).toBe('Next: fix domain-flows.json and run check-domain-flows again (attempt 2 of 3)');
    expect(run.check().lines.at(-1)).toBe('Next: fix domain-flows.json and run check-domain-flows again (attempt 3 of 3)');
    const third = run.check();
    expect(third.status).toBe(1);
    expect(third.lines.at(-1)).toBe('Next: the domain flows stay failed (3 of 3 attempts); the handbook draws none');
    expect(run.state().domainFlows).toMatchObject({ status: 'failed', attempts: 3 });
    run.writeFlows(goodFlows());
    const fourth = run.check();
    expect(fourth.status).toBe(1);
    expect(fourth.lines.at(-1)).toBe('Next: the domain flows stay failed (3 of 3 attempts); the handbook draws none');
    expect(run.state().domainFlows.status).toBe('failed');
  });

  it('a state that keeps domainFlows when another unit writes it', () => {
    const run = flowRun();
    run.writeFlows(goodFlows());
    expect(run.check().status).toBe(0);
    expect(run.strict('check-entry', 'F1').status).toBe(0);
    expect(run.strict('mark', 'F3', 'dispatched').status).toBe(0);
    expect(run.state().domainFlows).toMatchObject({ status: 'checked', attempts: 1 });
  });
});

const read = (run, name) => readFileSync(join(run.out, name), 'utf-8');
const assembled = (run) => {
  const result = run.strict('assemble');
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  return read(run, 'handbook.md');
};
const pageData = (run) => {
  const result = runHandbook(['page', run.out, '--project', run.root], { env: { ...process.env, ...NO_LEGACY.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  return JSON.parse(/<script type="application\/json" id="xv-product-handbook-data">([\s\S]*?)<\/script>/.exec(read(run, 'handbook.html'))[1]);
};
/** The text of the domain section `name` of handbook.md: from its heading to the next heading of the same level. */
const domainSection = (md, name) => {
  const start = md.indexOf(`### ${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = md.indexOf('\n### ', start + 4);
  return end === -1 ? md.slice(start) : md.slice(start, end);
};

describe('the domain flow in the outputs', () => {
  it('is a mermaid flowchart right after what the domain does, with the labels of the nodes and the texts of the edges', () => {
    const run = flowRun();
    run.writeFlows(goodFlows());
    expect(run.check().status).toBe(0);
    const section = domainSection(assembled(run), 'Customer orders');
    const flow = section.indexOf(`#### ${ui['md.entities.domain.flowHeading']}`);
    expect(flow).toBeGreaterThan(section.indexOf(`#### ${ui['md.entities.domain.whatItDoes']}`));
    expect(flow).toBeLessThan(section.indexOf(`#### ${ui['md.entities.domain.relationsHeading']}`));
    const fenced = /```mermaid\nflowchart LR\n([\s\S]*?)```/.exec(section.slice(flow))[1];
    expect(fenced).toContain('["Orders"]');
    expect(fenced).toContain('["Archive"]');
    expect(fenced).toContain('["Draft"]');
    expect(fenced).toContain('["Submitted"]');
    expect(fenced.match(/-->/g)).toHaveLength(6);
    expect(fenced).toContain('-->|"archive"|');
    expect(section).not.toContain(ui['md.entities.domain.flowFailed']);
  });

  it('is the same bytes when written again', () => {
    const run = flowRun();
    run.writeFlows(goodFlows());
    expect(run.check().status).toBe(0);
    const first = assembled(run);
    const data = pageData(run);
    expect(assembled(run)).toBe(first);
    expect(pageData(run)).toEqual(data);
    expect(read(run, 'handbook.md')).toBe(first);
  });

  it('says the none text where the file was never written, and no flowchart', () => {
    const run = flowRun();
    const md = assembled(run);
    expect(domainSection(md, 'Customer orders')).toContain(ui['md.entities.domain.flowNone']);
    expect(md).not.toContain(ui['md.entities.domain.flowFailed']);
    expect(md).not.toContain('flowchart LR\n  N0');
  });

  it('says the none text for a domain the file does not list', () => {
    const run = flowRun();
    run.writeFlows(goodFlows());
    expect(run.check().status).toBe(0);
    const md = assembled(run);
    expect(domainSection(md, 'System upkeep')).toContain(ui['md.entities.domain.flowNone']);
    expect(domainSection(md, 'Customer orders')).not.toContain(ui['md.entities.domain.flowNone']);
  });

  it('says the failed text on every domain after three failed attempts, in handbook.md and in the page data', () => {
    const run = flowRun();
    const doc = goodFlows();
    doc.domains[0].edges[0].text = 'cancel';
    run.writeFlows(doc);
    for (let attempt = 0; attempt < 3; attempt += 1) expect(run.check().status).toBe(1);
    const md = assembled(run);
    for (const name of ['Customer orders', 'System upkeep']) {
      const section = domainSection(md, name);
      expect(section).toContain(ui['md.entities.domain.flowFailed']);
      expect(section).not.toContain('flowchart');
    }
    const domains = pageData(run).entities.domains;
    expect(domains.map((domain) => domain.flow)).toEqual([{ status: 'failed' }, { status: 'failed' }]);
  });

  it('draws no diagram once the chapter it was checked against changed', () => {
    const run = flowRun();
    run.writeFlows(goodFlows());
    expect(run.check().status).toBe(0);
    const entry = goodEntryV3();
    entry.transitions = [];
    run.writeEntry('F1', entry);
    expect(run.strict('check-entry', 'F1').status).toBe(0);
    const md = assembled(run);
    expect(domainSection(md, 'Customer orders')).toContain(ui['md.entities.domain.flowFailed']);
  });
});
