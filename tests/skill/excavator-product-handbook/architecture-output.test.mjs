// Oracle O1 (assembly half) of openspec change handbook-architecture-chapter: when the architecture files are checked, the technical
// view of handbook.md has the chapter with its citations and the not-verified mark and a layered mermaid diagram, the product view
// has none of it, the same facts give the same bytes, and the page data carries the chapter without citations and the layers; when
// the section was not selected, failed or lost a file, the old application-to-external-system diagram stays with one fixed text.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { archRun, goodArchitecture } from './architecture-fixture.mjs';
import { runHandbook } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const ui = JSON.parse(readFileSync(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url), 'utf-8')).strings;
const STUB = '<!doctype html><html lang="und"><head><meta charset="UTF-8"><!-- xv:csp --></head><body><div id="root"></div><!-- xv:data --></body></html>';
const stubDir = mkdtempSync(join(tmpdir(), 'xhb-arch-stub-'));
const stubPath = join(stubDir, 'template.html');
writeFileSync(stubPath, STUB);
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

/** A run whose architecture files passed check-architecture and whose domains file is written. */
function checkedRun() {
  const run = archRun();
  cleanups.push(run.cleanup);
  run.writeDomains();
  const result = run.strict('check-architecture');
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  return run;
}

const read = (run, name) => readFileSync(join(run.out, name), 'utf-8');
const assembled = (run) => {
  const result = run.strict('assemble', '--views', 'product,technical');
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  return { product: read(run, 'handbook.md'), technical: read(run, 'handbook-technical.md') };
};
const pageData = (run) => {
  const result = runHandbook(['page', run.out, '--project', run.root, '--views', 'product,technical'], { env: { ...process.env, EXCAVATOR_HANDBOOK_ALLOW_V2_ENTRY: '', EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  return JSON.parse(/<script type="application\/json" id="xv-product-handbook-data">([\s\S]*?)<\/script>/.exec(read(run, 'handbook.html'))[1]);
};
// The heading of a block is replaced by the chapter's title, so the old diagram shows in its body; the fixture overview names no external call.
const OLD_HEADING = ui['md.entities.systems.diagramNone'];

describe('the technical view when the architecture is checked', () => {
  it('has the not-verified mark, the chapter with its citations and no old diagram', () => {
    const { technical } = assembled(checkedRun());
    expect(technical).toContain(ui['md.architecture.unverified']);
    expect(technical).toContain('The web application is a browser client (`apps/web/package.json:1`)');
    expect(technical).not.toContain(OLD_HEADING);
    for (const key of ['notSelected', 'failed', 'missing']) expect(technical).not.toContain(ui[`md.architecture.${key}`]);
  });

  it('draws one subgraph per layer in the order of the layers, with the components in file order and the link texts on the edges', () => {
    const { technical } = assembled(checkedRun());
    const block = /```mermaid\nflowchart LR\n  subgraph L0[\s\S]*?```/.exec(technical)[0];
    const titles = [...block.matchAll(/subgraph L(\d)\["([^"]+)"\]/g)].map((match) => [match[1], match[2]]);
    expect(titles).toEqual([['0', ui['md.architecture.layer.users']], ['1', ui['md.architecture.layer.frontend']], ['2', ui['md.architecture.layer.backend']], ['3', ui['md.architecture.layer.services']]]);
    const nodeOrder = [...block.matchAll(/^\s+C(\d+)\["([^"]+)"\]$/gm)].map((match) => match[2]);
    expect(nodeOrder).toEqual(['Clerks', 'Web client', 'Api service', 'Job runner', 'Order store', 'Mail service']);
    expect(block).toContain('  C0 -->|"uses"| C1');
    expect(block).toContain('  C2 -->|"reads and writes"| C4');
    expect(block.match(/-->/g)).toHaveLength(4);
  });

  it('draws the same bytes for the same facts', () => {
    const run = checkedRun();
    const first = assembled(run).technical;
    expect(assembled(run).technical).toBe(first);
  });

  it('leaves out the architecture chapter and the diagram in the product view', () => {
    const { product } = assembled(checkedRun());
    expect(product).not.toContain(ui['md.architecture.unverified']);
    expect(product).not.toContain('flowchart LR\n  subgraph');
    expect(product).not.toContain('The web application is a browser client');
  });

  it('keeps the applications table of the overview as it is without the section', () => {
    const withIt = assembled(checkedRun()).technical;
    const without = archRun();
    cleanups.push(without.cleanup);
    without.writeDomains();
    const plain = assembled(without).technical;
    const tableOf = (text) => /### [^\n]*\n\n\| Directory[\s\S]*?\n\n/.exec(text.slice(text.indexOf(`### ${ui['md.overview.applicationsHeading']}`)))?.[0];
    expect(tableOf(withIt)).toBeDefined();
    expect(tableOf(withIt)).toBe(tableOf(plain));
  });
});

describe('the technical view when the architecture is not there', () => {
  it('says it was not selected when no attempt is recorded, and keeps the old diagram', () => {
    const run = archRun({ write: false });
    cleanups.push(run.cleanup);
    run.writeDomains();
    const { technical } = assembled(run);
    expect(technical).toContain(OLD_HEADING);
    expect(technical).toContain(ui['md.architecture.notSelected']);
    expect(technical).not.toContain(ui['md.architecture.unverified']);
  });

  it('says it failed after a failed attempt', () => {
    const run = archRun();
    cleanups.push(run.cleanup);
    run.writeDomains();
    const doc = goodArchitecture();
    doc.links[0].to = 'c9';
    run.writeArch(doc);
    expect(run.strict('check-architecture').status).toBe(1);
    const { technical } = assembled(run);
    expect(technical).toContain(OLD_HEADING);
    expect(technical).toContain(ui['md.architecture.failed']);
  });

  it('says it failed when the files no longer pass after they were checked', () => {
    const run = checkedRun();
    const doc = goodArchitecture();
    doc.links[0].to = 'c9';
    run.writeArch(doc);
    expect(assembled(run).technical).toContain(ui['md.architecture.failed']);
  });

  it('says a file is missing when a checked file is gone', () => {
    const run = checkedRun();
    rmSync(join(run.out, 'architecture.json'));
    const { technical } = assembled(run);
    expect(technical).toContain(ui['md.architecture.missing']);
    expect(technical).toContain(OLD_HEADING);
  });
});

describe('the page data', () => {
  it('holds the chapter without citations, the components with their layers and the links, in the technical part only', () => {
    const data = pageData(checkedRun());
    const architecture = data.technical.architecture;
    expect(architecture.status).toBe('checked');
    expect(architecture.components.map((one) => [one.label, one.layer])).toEqual([['Clerks', 0], ['Web client', 1], ['Api service', 2], ['Job runner', 2], ['Order store', 3], ['Mail service', 3]]);
    expect(architecture.components[1].application).toBe('apps/web');
    expect(architecture.links[1]).toEqual({ from: 'c2', to: 'c3', text: 'calls' });
    expect(JSON.stringify(architecture.chapter)).not.toContain('package.json');
    expect(architecture.chapter.some((block) => block.kind === 'paragraph')).toBe(true);
    expect(JSON.stringify(data).includes('"architecture"')).toBe(true);
  });

  it('holds the status alone when the section is not there', () => {
    const run = archRun({ write: false });
    cleanups.push(run.cleanup);
    run.writeDomains();
    expect(pageData(run).technical.architecture).toEqual({ status: 'none' });
  });

  it('has no architecture in a product-only page', () => {
    const run = checkedRun();
    const result = runHandbook(['page', run.out, '--project', run.root, '--views', 'product'], { env: { ...process.env, EXCAVATOR_HANDBOOK_ALLOW_V2_ENTRY: '', EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
    expect(result.status, result.stderr).toBe(0);
    expect(read(run, 'handbook.html')).not.toContain('Clerks');
  });
});
