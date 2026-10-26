// `prd.mjs assemble <out>`: one PRD.md, byte for byte the same from the same
// input, in the order of the document skeleton: overview, Terminology, Flow
// index, Roles, the chapters, Open items, Appendix; failed features only in the
// appendix (openspec changes prd-feature-pipeline, design D7, and
// prd-report-prd-shape, design D4; oracle O3).
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { makeLaneRun, makeSkeletonRun, runPrd } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
function aggregated(mutate = () => {}, make = makeLaneRun) {
  const run = make();
  cleanups.push(run.cleanup);
  mutate(run);
  expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
  expect(runPrd(['aggregate', run.out, '--project', run.project]).status).toBe(0);
  return run;
}
const assembleOk = (run) => {
  const out = runPrd(['assemble', run.out, '--project', run.project]);
  expect(out.status, out.stdout + out.stderr).toBe(0);
  return out;
};
const prd = (run) => readFileSync(join(run.out, 'PRD.md'), 'utf-8');
/** The `##` headings of a PRD, outside code fences, as their text. */
const sectionsOf = (text) => [...text.matchAll(/^## (.*)$/gm)].map((match) => match[1]);

describe('prd.mjs assemble', () => {
  it('writes PRD.md: overview, Terminology, Flow index, Roles, the chapters without front-matter, Open items, then the appendix', () => {
    const run = aggregated();
    const out = assembleOk(run);
    expect(out.stdout.trim()).toBe(join(run.out, 'PRD.md'));
    const text = prd(run);
    expect(text.startsWith('# Orders\n')).toBe(true);
    expect(sectionsOf(text)).toEqual(['Terminology', 'Flow index', 'Roles', 'Order placement', 'Order cancellation', 'Open items', 'Appendix']);
    const at = (part) => text.indexOf(part);
    expect(at('flowchart LR\n  Customer --> Orders')).toBeLessThan(at('## Terminology'));
    expect(at('### Coverage')).toBeGreaterThan(at('## Appendix'));
    expect(at('### Verification')).toBeGreaterThan(at('### Coverage'));
    expect(text).not.toMatch(/^id: F1$/m);
    expect(text).not.toContain('\n---\n');
    expect(text).not.toContain('## Roles by feature');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  it('gives the same bytes on a second run', () => {
    const run = aggregated();
    assembleOk(run);
    const first = prd(run);
    assembleOk(run);
    expect(prd(run)).toBe(first);
  });

  it('orders the chapters by chapter, not by id, and the flow index and the roles follow', () => {
    const run = aggregated((r) => {
      const index = r.readIndex();
      index.features[0].chapter = 2;
      index.features[1].chapter = 1;
      r.writeIndex(index);
      r.writeText('features/F1.md', r.readText('features/F1.md').replace('chapter: 1', 'chapter: 2'));
      r.writeText('features/F2.md', r.readText('features/F2.md').replace('chapter: 2', 'chapter: 1'));
    });
    assembleOk(run);
    const text = prd(run);
    expect(text.indexOf('## Order cancellation')).toBeLessThan(text.indexOf('## Order placement'));
    expect(text.indexOf('| F2.1 |')).toBeLessThan(text.indexOf('| F1.1 |'));
  });

  it('lists a failed feature with its reasons in the appendix and leaves its chapter out of the body and the flow index', () => {
    const run = aggregated((r) => {
      const findings = r.readJson('findings/F2.json');
      findings.findings[0].evidence[0].passage = 'return order;';
      r.writeJson('findings/F2.json', findings);
    });
    assembleOk(run);
    const text = prd(run);
    expect(text).not.toContain('## Order cancellation');
    expect(text).not.toContain('A support agent cancels an order');
    expect(text).not.toContain('F2.1');
    const appendix = text.slice(text.indexOf('## Appendix'));
    expect(appendix).toContain('### Failed features');
    expect(appendix).toContain('| F2 | Order cancellation | check-lane | F2-1: the passage occurs 2 times in src/orders/service.js; quote more of it until it occurs once |');
  });

  it('lists a feature that was never written in the appendix', () => {
    const run = aggregated((r) => {
      rmSync(join(r.out, 'features/F2.md'));
      rmSync(join(r.out, 'findings/F2.json'));
      rmSync(join(r.out, 'verification/F2.txt'));
    });
    assembleOk(run);
    const appendix = prd(run).slice(prd(run).indexOf('## Appendix'));
    expect(appendix).toContain('### Features not written');
    expect(appendix).toContain('| F2 | Order cancellation | planned |');
  });

  it('strips front-matter from the overview too', () => {
    const run = aggregated((r) => r.writeText('overview.md', `---\ntitle: Orders\n---\n${r.readText('overview.md')}`));
    assembleOk(run);
    expect(prd(run).startsWith('# Orders\n')).toBe(true);
  });

  it('refuses to assemble before overview.md or the tables exist', () => {
    const run = aggregated();
    rmSync(join(run.out, 'overview.md'));
    const noOverview = runPrd(['assemble', run.out, '--project', run.project]);
    expect(noOverview.status).toBe(1);
    expect(noOverview.stdout).toMatch(/overview\.md/);
    const fresh = makeLaneRun();
    cleanups.push(fresh.cleanup);
    const noTables = runPrd(['assemble', fresh.out, '--project', fresh.project]);
    expect(noTables.status).toBe(1);
    expect(noTables.stdout).toMatch(/aggregate/);
    for (const table of ['terminology', 'roles', 'open-items']) expect(noTables.stdout).toContain(`index: tables/${table}.md is missing; run aggregate before assemble`);
  });
});

describe('prd.mjs assemble: the overview check (D4)', () => {
  const refused = (overview, pattern) => {
    const run = aggregated((r) => r.writeText('overview.md', overview));
    const out = runPrd(['assemble', run.out, '--project', run.project]);
    expect(out.status, out.stdout).toBe(1);
    expect(out.stdout.trim().split('\n').every((line) => line.startsWith('index: overview.md '))).toBe(true);
    expect(out.stdout).toMatch(pattern);
    expect(existsSync(join(run.out, 'PRD.md'))).toBe(false);
  };

  it('refuses an overview that does not start with a # heading', () => {
    refused('An overview with no title.\n\n```mermaid\nflowchart LR\n  A --> B\n```\n', /must start with one # heading/);
    refused('## A second-level title\n\n```mermaid\nflowchart LR\n  A --> B\n```\n', /must start with one # heading/);
  });

  it('refuses an overview with no mermaid block', () => {
    refused('# Orders\n\nAn overview with no capability map.\n', /has no mermaid block/);
  });

  it('says both problems when both hold, and accepts an overview with front-matter before the heading', () => {
    refused('No title and no map.\n', /must start with one # heading[\s\S]*has no mermaid block/);
    const run = aggregated((r) => r.writeText('overview.md', `---\ntitle: x\n---\n${r.readText('overview.md')}`));
    assembleOk(run);
  });
});

describe('prd.mjs assemble: the skeleton of the O3 run (reference, flows, open items, a failed feature)', () => {
  /** The headings of the PRD with the anchors GitHub gives them, written by hand from its rules for this run. */
  const HEADINGS = [
    ['# Orders', 'orders'],
    ['## Terminology', 'terminology'],
    ['## Flow index', 'flow-index'],
    ['## Roles', 'roles'],
    ['### Actors by feature', 'actors-by-feature'],
    ['### Permission roles', 'permission-roles'],
    ['## Roles and permissions', 'roles-and-permissions'],
    ['### Order placement', 'order-placement'],
    ['## Order placement', 'order-placement-1'],
    ['### Flow 1: Place an order', 'flow-1-place-an-order'],
    ['## Order cancellation', 'order-cancellation'],
    ['### Cancel an order', 'cancel-an-order'],
    ['### Cancel an order', 'cancel-an-order-1'],
    ['## Open items', 'open-items'],
    ['### F1 Order placement', 'f1-order-placement'],
    ['## Appendix', 'appendix'],
    ['### Coverage', 'coverage'],
    ['### Verification', 'verification'],
    ['### Failed features', 'failed-features'],
  ];
  const ROWS = [
    '| F3 | [Roles and permissions](#roles-and-permissions) | F3 Roles and permissions | reference |',
    '| F1.1 | [Flow 1: Place an order](#flow-1-place-an-order) | F1 Order placement | flow |',
    '| F2.1 | [Cancel an order](#cancel-an-order) | F2 Order cancellation | flow |',
    '| F2.2 | [Cancel an order](#cancel-an-order-1) | F2 Order cancellation | flow |',
  ];
  const skeleton = () => {
    const run = aggregated(() => {}, makeSkeletonRun);
    assembleOk(run);
    return { run, text: prd(run) };
  };
  const headingLines = (text) => {
    const found = [];
    let fenced = false;
    for (const line of text.split('\n')) {
      if (line.startsWith('```')) fenced = !fenced;
      else if (!fenced && /^#{1,6} /.test(line)) found.push(line);
    }
    return found;
  };

  it('has the sections in exactly the order of D4, the reference chapter first and the failed feature in no chapter', () => {
    const { text } = skeleton();
    expect(sectionsOf(text)).toEqual(['Terminology', 'Flow index', 'Roles', 'Roles and permissions', 'Order placement', 'Order cancellation', 'Open items', 'Appendix']);
    expect(text.indexOf('# Orders\n')).toBe(0);
    expect(text).not.toContain('Order reopening\n\nA ');
    const appendix = text.slice(text.indexOf('## Appendix'));
    expect(appendix).toContain('| F4 | Order reopening | lane | the lane wrote nothing |');
  });

  it('writes the glossary under Terminology and the two role tables under Roles, as aggregate wrote them', () => {
    const { run, text } = skeleton();
    const part = (from, to) => text.slice(text.indexOf(from), text.indexOf(to));
    expect(part('## Terminology', '## Flow index')).toBe(`## Terminology\n\n${run.readText('tables/terminology.md')}\n`);
    expect(part('## Roles\n', '## Roles and permissions')).toBe(`## Roles\n\n${run.readText('tables/roles.md')}\n`);
  });

  it('has a flow index row for each reference feature and each flow, each linking to the anchor GitHub gives its heading', () => {
    const { text } = skeleton();
    const index = text.slice(text.indexOf('## Flow index'), text.indexOf('## Roles\n')).trimEnd().split('\n');
    expect(index.slice(0, 4)).toEqual(['## Flow index', '', '| # | Flow | Feature | Kind |', '|---|---|---|---|']);
    expect(index.slice(4)).toEqual(ROWS);
    // As many rows as reference features (1) plus all flows (1 + 2).
    expect(index.slice(4)).toHaveLength(1 + 1 + 2);
    // The anchors of the whole document, by hand: a repeated heading gets -1, -2 in document order across chapters.
    expect(headingLines(text).map((line, at) => [line, HEADINGS[at]?.[0]])).toEqual(HEADINGS.map(([line]) => [line, line]));
    const anchorOf = (heading, nth) => HEADINGS.filter(([line]) => line === heading)[nth][1];
    expect(ROWS.map((row) => /\(#([^)]*)\)/.exec(row)[1])).toEqual([
      anchorOf('## Roles and permissions', 0), anchorOf('### Flow 1: Place an order', 0), anchorOf('### Cancel an order', 0), anchorOf('### Cancel an order', 1),
    ]);
  });

  it('keeps each open items section out of its chapter and gives it verbatim under Open items', () => {
    const { run, text } = skeleton();
    const chapter = text.slice(text.indexOf('## Order placement'), text.indexOf('## Order cancellation'));
    expect(chapter).not.toContain('### Open items');
    expect(chapter).not.toContain('Whether open orders expire');
    const written = run.readText('features/F1.md');
    const section = written.slice(written.indexOf('### Open items\n') + '### Open items\n'.length).trim();
    const open = text.slice(text.indexOf('## Open items'), text.indexOf('## Appendix'));
    expect(open).toBe(`## Open items\n\n### F1 Order placement\n\n${section}\n\n`);
    expect(text.split('Whether open orders expire')).toHaveLength(2);
  });

  it('says None. under Open items when no chapter has an open items section', () => {
    const run = aggregated((r) => {
      r.writeText('features/F1.md', r.readText('features/F1.md').replace('openItems: Open items\n', '').replace(/\n### Open items[\s\S]*$/, '\n'));
    }, makeSkeletonRun);
    assembleOk(run);
    const text = prd(run);
    expect(text.slice(text.indexOf('## Open items'), text.indexOf('## Appendix'))).toBe('## Open items\n\nNone.\n\n');
  });

  it('gives the same bytes on a second run and from a second copy of the same run', () => {
    const { run, text } = skeleton();
    assembleOk(run);
    expect(prd(run)).toBe(text);
    const other = skeleton();
    expect(other.text.replaceAll(other.run.project, '<p>')).toBe(text.replaceAll(run.project, '<p>'));
  });

  it('links to the heading of a flow whose title is written with a bracket or a pipe, and escapes them in the label', () => {
    const run = aggregated((r) => {
      r.writeText('features/F1.md', r.readText('features/F1.md')
        .replace('- "Flow 1: Place an order"', '- "Flow 1: Place [an] order | now"')
        .replace('### Flow 1: Place an order', '### Flow 1: Place [an] order | now'));
    }, makeSkeletonRun);
    assembleOk(run);
    expect(prd(run)).toContain('| F1.1 | [Flow 1: Place \\[an\\] order \\| now](#flow-1-place-an-order--now) | F1 Order placement | flow |');
  });

  it('refuses, naming the flow, a chapter edited after aggregate so that a declared flow has no heading', () => {
    const run = aggregated(() => {}, makeSkeletonRun);
    run.writeText('features/F1.md', run.readText('features/F1.md').replace('### Flow 1: Place an order', '### Flow 1: Place the order'));
    rmSync(join(run.out, 'PRD.md'), { force: true });
    const out = runPrd(['assemble', run.out, '--project', run.project]);
    expect(out.status).toBe(1);
    expect(out.stdout).toBe('F1: flow "Flow 1: Place an order" is not a ### heading of the assembled chapter; run aggregate before assemble\n');
    expect(existsSync(join(run.out, 'PRD.md'))).toBe(false);
  });
});
