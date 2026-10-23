#!/usr/bin/env node
/**
 * view-smoke-graph.mjs
 *
 * The graph page's smoke (openspec: changes/viewer-app, tasks 3.2 and 4.1-4.3,
 * design O3): packs the synthetic smoke project twice (directory-grouped, and
 * Full-mode with layers), opens each page with view-smoke.mjs and drives the
 * graph through `--eval`:
 *   - levels: the default route lands on the graph, the page is clicked down
 *     two levels and the counts at each equal the fixture's, a file is selected
 *     (the sidebar shows it) and opened to its nodes, and browser back returns
 *     one step at a time;
 *   - history: select, drill, and back twice; and the spec's drill, select, back;
 *   - search: a function name is found, chosen, and the graph drills to its file,
 *     selects it and the sidebar shows it;
 *   - drawer: the code drawer's highlight equals the node's line range, it
 *     expands, and links to the Code page;
 *   - focus: the worker lays the focus out on file:// and the count equals the
 *     node's distinct neighbours;
 *   - path: a path is found and highlighted, and one that does not exist says so;
 *   - filters: the number hidden is on the button and the level follows;
 *   - keys: `/`, `?`, and Esc closing one thing at a time from the inside out;
 *   - overlays: each switch on its own at the top level and in a drilled level, the legend, the marks and their
 *     tooltips, the camera clearing the cards over the canvas, and the switch of a product that was not run;
 *   - restore: a reload from the address brings back the overlays and the filters;
 *   - locate: "Locate in graph" from the Unused, Hotspots and Doc map pages selects the record's node and turns on its
 *     overlay, and says "Not in the graph." for a path the graph has no node for;
 *   - domain (tasks D.1 and D.2): the Domain page's top level (cards, counts, the fixed note), a domain's flows, a flow's steps in
 *     flow_step weight order with the arrows between them, a step's evidence opening the code drawer, a step's graph node
 *     opening the structure graph with that node selected, and the nodes the graph lacks listed as "Not in the graph.";
 *     domain-history, domain-restore and domain-keys (back and forward, a load from the address, Esc from the inside out);
 *     domain-products, domain-notrun and domain-digest (the product's state with its counts, not run, and a different revision);
 *     domain-fit (a domain graph as wide as a real one at 1280 by 900: nine domains and a flow of seven steps fit at a zoom of 0.9 or
 *     more, and no text of a card runs out of its box);
 *   - edge-labels: on a crowded level (top and drilled) a selected node lights its edges and labels none of them; the edge under the pointer
 *     shows its label alone, on an opaque box above the cards;
 *   - topbar-768, topbar-1024, topbar-1280: the top bar's controls do not overlap, overflow or wrap, the search box is at least 160 px,
 *     the Hotspots overlay switches on and off (behind the Overlays menu below 1280 px), and the mode switch sets the mode;
 *   - longfile, longfile-restore: a function of a file expanded to a hundred and twenty rows is located, and the camera is on it at a readable
 *     zoom instead of fitting the whole file;
 *   - products-redirect (openspec: changes/viewer-learn, design D9): a bookmark of the old `#/overview` and a move to it both open the
 *     Products page with `#/products` in the address and no `#/overview` entry left in the history, the navigation names Products, and
 *     the page lists the tour as included with the facts digest it was made from;
 *   - fonts (changes/viewer-learn, design D7): the page title's computed font is DM Serif Display, the text's Inter and code's JetBrains
 *     Mono, document.fonts reports them loaded from the page itself (no request, no CSP violation), and the body carries the grain.
 *   - the detail pages (changes/viewer-learn, tasks 3.1-3.3): row-panel-unused and row-panel-hotspots (a real pointer lifts a row, a click
 *     opens its panel with the fields, the source with the line range marked, Locate in graph and Open code, the group members and
 *     referrers, or the commits per year and the files changed together, each related row opening its own; back and Esc close it);
 *     row-link and row-link-reload (`row=` opens the page and sort that hold the row, scrolls to it, flashes it and opens its panel, and a
 *     row the product lacks is said so with no panel); prefix-filter (`prefix=` keeps the rows an independent count over the product
 *     finds, and the clear button takes it off); detail-numbers (the tiles, bars, years, histogram and product cards against the
 *     product); reduced-motion (no animation runs on the detail pages or in the row panel).
 *   - the modes and the idle sidebar (changes/viewer-learn, tasks 4.1-4.3): overview-mode (at the top level and two drilled levels Overview
 *     draws no function or class and no file opens to one, while every card and count equals Deep dive's); mode-search-switch (a class or
 *     function found in Overview switches to Deep dive, is located and selected, and the sidebar says so; back returns to Overview);
 *     domain-structural and domain-structural-notrun (the Domain | Structural switch returns each side to its level and selection, and is
 *     absent without a readable domain graph); project-overview (every number of the overview against a count over the packed files, a
 *     top node, a layer, Start tour and a hotspot link with its row panel); learn-notrun and learn-digest (the tour's state in Learn);
 *     reduced-motion-idle; and the top bar scenarios check the mode switch at each width.
 *   - page-column-1440, page-column-1920, page-column-768: on Products and Unused the page column is centred in the main area (its
 *     left and right gaps differ by at most 1 px), and at 768 px nothing scrolls sideways.
 *
 *   node scripts/view-smoke-graph.mjs [levels|history|search|drawer|focus|path|filters|keys|layers|summary|overlays|clearance|notrun|restore|locate|locate-tables|domain|domain-history|domain-restore|domain-keys|domain-products|domain-notrun|domain-digest|domain-fit|edge-labels|topbar-768|topbar-1024|topbar-1280|longfile|longfile-restore|products-redirect|fonts|row-panel-unused|row-panel-hotspots|row-link|row-link-reload|prefix-filter|detail-numbers|reduced-motion|overview-mode|mode-search-switch|domain-structural|domain-structural-notrun|project-overview|learn-notrun|learn-digest|reduced-motion-idle|page-column-1440|page-column-1920|page-column-768 ...]
 *
 * Needs `pnpm build` (the template) and a local Chrome. Prints one line per
 * check and exits 1 when any fails.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { packProject } from '../skills/excavator-view/pack.mjs';
import { CONTRADICTED_SUMMARY, makeSmokeProject } from './view-smoke-fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** The page-side driver: clicks down the levels named in `levels` and returns what it saw at each step. */
const DRIVER = (levels) => `(async () => {
  const levels = ${JSON.stringify(levels)};
  const root = document.documentElement;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test) => { for (let i = 0; i < 200; i++) { if (test()) return true; await sleep(25); } return false; };
  const attr = (name) => root.getAttribute(name);
  const snap = () => ({
    level: attr('data-xv-graph-level'),
    nodes: attr('data-xv-count-graph-level-nodes'),
    files: attr('data-xv-count-graph-level-files'),
    folded: attr('data-xv-count-graph-folded'),
    elkMs: attr('data-xv-elk-ms'),
    labels: [...document.querySelectorAll('[data-xv-entry]')].filter((el) => el.getAttribute('data-xv-entry') !== 'child').map((el) => el.getAttribute('data-xv-label')),
    hash: location.hash,
  });
  const at = (path) => until(() => attr('data-xv-graph-level') === path + '#');
  const out = { steps: [] };
  out.bare = { hash: location.hash, page: document.querySelector('nav[aria-label="Pages"] [aria-current="page"]')?.getAttribute('data-xv-nav') };
  out.canvas = { nodes: document.querySelectorAll('.react-flow__node').length, minimap: !!document.querySelector('.react-flow__minimap'), controls: !!document.querySelector('.react-flow__controls'), background: !!document.querySelector('.react-flow__background'), notes: document.querySelector('[aria-label="Breadcrumb"]')?.parentElement?.textContent ?? '' };
  out.steps.push({ ...snap(), reached: await at(levels[0].path) });
  for (let i = 0; i < levels.length - 1; i++) {
    const target = [...document.querySelectorAll('[data-xv-label]')].find((el) => el.getAttribute('data-xv-label') === levels[i].open);
    if (!target) { out.steps.push({ missing: levels[i].open }); return out; }
    target.click();
    const reached = await at(levels[i + 1].path);
    out.steps.push({ ...snap(), reached });
  }
  const deepest = levels.length - 1;
  // Select the first file of the deepest level, then open it.
  const fileEl = document.querySelector('[data-xv-entry="file"]');
  fileEl.click();
  await until(() => location.hash.includes('node='));
  await until(() => document.querySelector('aside[data-xv-panel="sidebar"] [data-xv-details]'));
  out.selected = { id: fileEl.getAttribute('data-xv-node'), hash: location.hash, marked: document.querySelectorAll('.xv-selected').length, sidebar: document.querySelector('aside[data-xv-panel="sidebar"] [data-xv-details]')?.getAttribute('data-xv-details') ?? null };
  const toggle = fileEl.querySelector('button[aria-expanded]');
  if (toggle) { toggle.click(); await until(() => document.querySelector('[data-xv-entry="child"]')); out.opened = { children: document.querySelectorAll('[data-xv-entry="child"]').length, level: attr('data-xv-graph-level') }; }
  history.back();
  await until(() => !location.hash.includes('node='));
  out.afterSelectBack = { ...snap(), selectedMarks: document.querySelectorAll('.xv-selected').length };
  for (let i = deepest - 1; i >= 0; i--) {
    history.back();
    out.afterBack = out.afterBack || [];
    out.afterBack.push({ reached: await at(levels[i].path), ...snap() });
  }
  return out;
})()`;

function run(label, options) {
  const dir = mkdtempSync(join(tmpdir(), 'xv-graph-smoke-'));
  try {
    const { root, expected } = makeSmokeProject(dir, options);
    const out = join(dir, 'page.html');
    packProject(root, { out });
    const levels = expected.graph.levels;
    const result = spawnSync('node', [join(here, 'view-smoke.mjs'), out, '--eval', DRIVER(levels)], { encoding: 'utf-8', maxBuffer: 1 << 26 });
    let smoke;
    try {
      smoke = JSON.parse(result.stdout);
    } catch {
      return [[`${label}: the smoke printed no result`, false, result.stderr.trim()]];
    }
    return check(label, smoke, expected.graph);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The checks of one page: [name, passed, detail]. */
function check(label, smoke, graph) {
  const checks = [];
  const add = (name, passed, detail = '') => checks.push([`${label}: ${name}`, Boolean(passed), passed ? '' : JSON.stringify(detail)]);
  const out = smoke.evalResult ?? {};
  const levels = graph.levels;
  add('ready, with no console error, CSP violation or extra request', smoke.ok && smoke.ready === '1', { ok: smoke.ok, ready: smoke.ready, errors: [smoke.consoleErrors, smoke.exceptions, smoke.cspViolations, smoke.extraRequests] });
  add('the default route is the graph', out.bare?.page === 'graph' && out.bare.hash === '', out.bare);
  add('the canvas has nodes, a minimap, controls and a dotted background', out.canvas?.nodes >= levels[0].nodes && out.canvas.minimap && out.canvas.controls && out.canvas.background, out.canvas);
  add('the page says how it groups', graph.mode === 'layers' ? /Grouped by layer/.test(out.canvas?.notes) : /Grouped by directory/.test(out.canvas?.notes), out.canvas?.notes);
  levels.forEach((level, i) => {
    const step = out.steps?.[i] ?? {};
    add(`level ${i} (${level.path || 'top'}): ${level.nodes} nodes, ${level.files} files`, step.reached && step.nodes === String(level.nodes) && step.files === String(level.files) && step.folded === '0', step);
    add(`level ${i} draws the entries ${level.labels.join(', ')}`, [...(step.labels ?? [])].sort().join('|') === [...level.labels].sort().join('|'), step.labels);
  });
  add('the drill-down is in the address and in the history', levels.every((level, i) => i === 0 || out.steps?.[i]?.hash === `#/graph?path=${encodeURIComponent(level.path)}`), out.steps?.map((s) => s.hash));
  add('ELK reports its time', out.steps?.every((s) => Number(s.elkMs) >= 0 && s.elkMs !== null), out.steps?.map((s) => s.elkMs));
  add('a click on a file selects it: it is in the address, marked, and the sidebar shows it', out.selected?.hash.includes('node=') && out.selected.marked === 1 && out.selected.sidebar === out.selected.id, out.selected);
  add('a file opens to the nodes it owns', !out.opened || out.opened.children >= 1, out.opened);
  const last = levels[levels.length - 1];
  add('back from the selection keeps the level and clears the selection', out.afterSelectBack?.level === `${last.path}#` && out.afterSelectBack.selectedMarks === 0, out.afterSelectBack);
  add('back goes up one level at a time', levels.slice(0, -1).reverse().every((level, i) => out.afterBack?.[i]?.level === `${level.path}#` && out.afterBack[i].nodes === String(level.nodes)), out.afterBack);
  return checks;
}

/** Helpers every scenario's driver starts with. */
const PRELUDE = `
  const root = document.documentElement;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, tries = 240) => { for (let i = 0; i < tries; i++) { const v = test(); if (v) return v; await sleep(25); } return false; };
  const attr = (name) => root.getAttribute(name);
  const q = (selector) => document.querySelector(selector);
  const all = (selector) => [...document.querySelectorAll(selector)];
  const route = () => { const h = location.hash.replace(/^#\\/?/, ''); const [page, query = ''] = h.split('?'); return { page: page.split('/')[0] || 'graph', params: Object.fromEntries(new URLSearchParams(query)) }; };
  const level = () => attr('data-xv-graph-level');
  const settle = async () => { await sleep(120); await until(() => attr('data-xv-ready') === '1'); };
  const setValue = (el, value) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); };
  const key = (k, target) => (target || document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const sidebar = () => q('aside[data-xv-panel="sidebar"] [data-xv-details]')?.getAttribute('data-xv-details') ?? null;
  const go = async (hash) => { location.hash = hash; await sleep(60); await settle(); };
  const dialog = (name) => q('[role="dialog"][aria-label="' + name + '"]');
`;

const driver = (body) => `(async () => { ${PRELUDE} const out = {}; ${body}; return out; })()`;

/** Helpers of the detail-page scenarios: the open row panel, and what it shows. */
const ROW_HELPERS = `
  const rowPanel = (key) => q('aside[data-xv-panel="sidebar"] [data-xv-row-panel="' + key + '"]');
  const openPanel = () => q('aside[data-xv-panel="sidebar"] [data-xv-row-panel]')?.getAttribute('data-xv-row-panel') || null;
  const ids = (panel, selector) => [...panel.querySelectorAll(selector)].map((el) => el.getAttribute('data-xv-related'));
  const panelState = (panel) => (!panel ? { key: null, text: '' } : {
    key: panel.getAttribute('data-xv-row-panel'),
    text: panel.textContent.replace(/\\s+/g, ' '),
    locate: panel.querySelector('[data-xv-locate]')?.getAttribute('data-xv-locate') ?? null,
    openCode: panel.querySelector('[data-xv-open-code]')?.getAttribute('href') ?? null,
    preview: panel.querySelector('[data-xv-preview]')?.getAttribute('data-xv-preview') ?? null,
    highlight: panel.querySelector('[data-xv-preview] [data-xv-highlight]')?.getAttribute('data-xv-highlight') ?? null,
    marked: panel.querySelectorAll('[data-xv-preview] .xv-line-hl').length,
    others: ids(panel, '[data-xv-group] [data-xv-related]'),
    referrers: ids(panel, '[data-xv-referrers] [data-xv-related]'),
  });
`;

/** Scenarios: [name, mode, driver, check(out, expected) => [name, passed, detail][]]. */
const SCENARIOS = [
  ['history', 'directories', (graph) => driver(`
    const [l0, l1, l2] = ${JSON.stringify(graph.levels)};
    const at = (path) => until(() => level() === path + '#');
    await at(l0.path);
    // The spec scenario: drill two levels, select a node, back.
    q('[data-xv-label="' + l0.open + '"]').click(); await at(l1.path);
    q('[data-xv-label="' + l1.open + '"]').click(); await at(l2.path);
    const file = q('[data-xv-entry="file"]'); const fileId = file.getAttribute('data-xv-node');
    file.click(); await until(() => location.hash.includes('node='));
    out.selected = { node: route().params.node === fileId, sidebar: sidebar() === fileId, level: level() };
    // The address drops the node at once, but the sidebar leaves with its exit animation: wait for both.
    history.back(); await until(() => !location.hash.includes('node=') && sidebar() === null);
    out.back1 = { level: level(), selection: route().params.node ?? null, marks: all('.xv-selected').length, sidebar: sidebar() };
    history.back(); await at(l1.path);
    out.back2 = { level: level() };
    // Select, drill, then back twice: the selection comes back, then goes.
    const sibling = q('[data-xv-entry="file"]'); const siblingId = sibling.getAttribute('data-xv-node');
    sibling.click(); await until(() => location.hash.includes('node='));
    q('[data-xv-label="' + l1.open + '"]').click(); await at(l2.path);
    out.drilled = { node: route().params.node ?? null };
    history.back(); await at(l1.path);
    out.drillBack1 = { level: level(), node: route().params.node === siblingId, sidebar: sidebar() === siblingId };
    history.back(); await until(() => !location.hash.includes('node='));
    out.drillBack2 = { level: level(), node: route().params.node ?? null };
    history.forward(); await until(() => location.hash.includes('node='));
    out.forward = { node: route().params.node === siblingId, sidebar: sidebar() === siblingId };
    // A reload from the address restores the same place.
    const before = location.hash;
    out.reloaded = { hash: before };
  `), (out, graph) => {
    const [, l1, l2] = graph.levels;
    return [
      ['history: the selected file is in the address and the sidebar', out.selected?.node && out.selected.sidebar && out.selected.level === `${l2.path}#`, out.selected],
      ['history: back after drill-drill-select cancels the selection and stays on the level', out.back1?.level === `${l2.path}#` && out.back1.selection === null && out.back1.marks === 0 && out.back1.sidebar === null, out.back1],
      ['history: back again goes up one level', out.back2?.level === `${l1.path}#`, out.back2],
      ['history: drilling drops the selection', out.drilled?.node === null, out.drilled],
      ['history: select, drill, back brings the selection back on the same level', out.drillBack1?.level === `${l1.path}#` && out.drillBack1.node && out.drillBack1.sidebar, out.drillBack1],
      ['history: back once more cancels it', out.drillBack2?.level === `${l1.path}#` && out.drillBack2.node === null, out.drillBack2],
      ['history: forward selects it again', out.forward?.node && out.forward.sidebar, out.forward],
    ];
  }],

  // Edge labels, with the real pointer (CDP mouse events, so only what a pointer can reach is hovered). A selection lights edges and
  // labels none; the edge under the pointer shows its label alone, on an opaque box above the cards, and it goes with the pointer.
  ['edge-labels', 'edge-crowd', () => driver(`${LABEL_PROBE}
    const SEL = '.react-flow__edge-textwrapper';
    const visit = async (hash, ready) => {
      await go(hash);
      await until(ready);
      await sleep(900);
      await away();
      const rest = report(SEL);
      const edge = all('.react-flow__edge').find((e) => edgePoint(e));
      const at = edge ? edgePoint(edge) : null;
      if (!at) return { rest, error: 'no edge could be reached by the pointer', edges: all('.react-flow__edge').length };
      await __xvPointer(at.x, at.y);
      await sleep(300);
      const hovered = report(SEL);
      await away();
      await sleep(300);
      return { rest, hovered, left: report(SEL), edges: all('.react-flow__edge').length };
    };
    out.top = await visit('#/graph?node=' + encodeURIComponent('file:c0/a.js'), () => sidebar() === 'file:c0/a.js');
    out.drilled = await visit('#/graph?path=n&node=' + encodeURIComponent('file:n/d0/a.js'), () => sidebar() === 'file:n/d0/a.js');
    const focus = 'file:c0/a.js';
    const inFocus = () => attr('data-xv-focus-center') === focus && all('.react-flow__edge').length > 0;
    out.focus = await visit('#/graph?node=' + encodeURIComponent(focus) + '&focus=1', inFocus);
    const centre = q('[data-xv-entry="focus-center"]').getBoundingClientRect();
    await __xvPointer(centre.left + centre.width / 2, centre.top + centre.height / 2);
    await sleep(400);
    out.focus.centre = report(SEL);
    await away();
  `), (out) => {
    const labelled = (name, v) => [
      [`${name}: a selected node lights its edges and none of them carries a label, and the labels visible do not overlap or sit under a card`, v?.rest?.n === 0 && v.rest.apart && v.rest.above && v.edges >= 5, v],
      [`${name}: a real pointer on an edge shows exactly one label, opaque and above the cards, and it goes when the pointer leaves`, v?.hovered?.n === 1 && v.hovered.opaque && v.hovered.above && v.hovered.inside && /imports|calls/.test(v.hovered.texts[0]) && v.left?.n === 0, v],
    ];
    return [
      ...labelled('the top level', out.top),
      ...labelled('a drilled level', out.drilled),
      ...labelled('the focus view', out.focus),
      ['the focus view: with the centre node hovered no label overlaps another or sits under a card', out.focus?.centre?.n === 0 && out.focus.centre.apart && out.focus.centre.above, out.focus?.centre],
    ];
  }],

  // The domain view's top level, with a domain selected: its cross-domain edges are lit with no description box, and the sidebar lists them.
  ['domain-edge-labels', 'domain-fit', () => driver(`${LABEL_PROBE}
    const SEL = '[data-xv-link-label]';
    const id = 'domain:app';
    await go('#/domain?node=' + encodeURIComponent(id));
    await until(() => sidebar() === id && attr('data-xv-domain-level') === 'top');
    await sleep(1500);
    await away();
    out.rest = report(SEL);
    out.edges = all('.react-flow__edge').length;
    out.sidebarRows = all('aside[data-xv-panel="sidebar"] [data-xv-cross]').map((el) => el.textContent.replace(/\\s+/g, ' ').trim());
    const edge = all('.react-flow__edge').find((e) => edgePoint(e));
    const at = edge ? edgePoint(edge) : null;
    if (!at) { out.unreachable = 'no edge could be reached by the pointer'; return out; }
    await __xvPointer(at.x, at.y);
    await sleep(300);
    out.hovered = report(SEL);
    await away();
    await sleep(300);
    out.left = report(SEL);
  `), (out) => [
    ['domain top: a selected domain lights its cross-domain edges and none carries a description box, and the labels visible do not overlap or sit under a card', out.rest?.n === 0 && out.rest.apart && out.rest.above && out.edges >= 9, out],
    ['domain top: the sidebar lists the selected domain\'s cross-domain edges with their descriptions', out.sidebarRows?.length >= 2 && out.sidebarRows.every((row) => row.length > 12), out.sidebarRows],
    ['domain top: a real pointer on a cross-domain edge shows exactly one description box, opaque and above the cards, and it goes when the pointer leaves', out.hovered?.n === 1 && out.hovered.opaque && out.hovered.above && out.hovered.inside && out.left?.n === 0, out],
  ], { height: 900 }],

  // A flow's steps must not sit under the minimap, with a step selected (the sidebar narrows the canvas).
  ['domain-flow-minimap', 'domain-fit', (graph, expected) => driver(`
    const flow = ${JSON.stringify(expected.domain.long.flow)};
    const step = ${JSON.stringify(expected.domain.long.steps[0])};
    await go('#/domain?d=' + encodeURIComponent('domain:app') + '&f=' + encodeURIComponent(flow) + '&node=' + encodeURIComponent(step));
    await until(() => attr('data-xv-domain-level') === 'flow:domain:app:' + flow && sidebar() === step);
    await sleep(1500);
    const mini = q('.react-flow__minimap')?.getBoundingClientRect() ?? null;
    const steps = all('[data-xv-domain-entry="step"]').map((el) => el.getBoundingClientRect());
    const hits = (r) => mini !== null && r.left < mini.right && mini.left < r.right && r.top < mini.bottom && mini.top < r.bottom;
    out.flow = { steps: steps.length, minimap: mini !== null, under: steps.filter(hits).length };
  `), (out) => [
    ['domain flow: no step card is under the minimap', out.flow?.steps >= 7 && out.flow.under === 0, out.flow],
  ], { height: 900 }],

  ['search', 'directories', (graph) => driver(`
    out.hits = [];
    const input = q('[data-xv-search]');
    for (const item of ${JSON.stringify(graph.interaction.search)}) {
      await go('#/graph');
      key('/', document.body);
      await until(() => document.activeElement === input);
      out.slashFocus = document.activeElement === input;
      setValue(input, item.query);
      const hit = await until(() => q('[data-xv-hit="' + item.id + '"]'));
      const text = hit ? hit.textContent : null;
      hit && hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await until(() => route().params.node === item.id);
      await until(() => level() === (route().params.path || '') + '#' && sidebar() === item.id);
      out.hits.push({ query: item.query, found: !!hit, text, hash: location.hash, level: level(), marks: all('.xv-selected').length, sidebar: sidebar(), name: q('aside[data-xv-panel="sidebar"]')?.getAttribute('aria-label'), results: !!q('[data-xv-hit]') });
    }
  `), (out, graph) => [
    ['search: / focuses the search box', out.slashFocus === true, out.slashFocus],
    ...graph.interaction.search.flatMap((item, i) => {
      const hit = out.hits?.[i] ?? {};
      return [
        [`search "${item.query}": the result lists the type and the path`, hit.found && hit.text.includes('function') && hit.text.includes(item.file), hit],
        [`search "${item.query}": the graph drills to ${item.level}, selects the function and the sidebar shows it`, hit.hash?.includes(`path=${encodeURIComponent(item.level)}`) && hit.level === `${item.level}#` && hit.marks === 1 && hit.sidebar === item.id && hit.name === item.name && hit.results === false, hit],
      ];
    }),
  ]],

  // helper's file is one that the unused-code and hotspots products point at; run.js is named by the graph only, and the page embeds its text all the same; docs/guide.md is named by no product and has no file node.
  ['drawer', 'directories', (graph) => driver(`
    const item = ${JSON.stringify(graph.interaction.search[1])};
    await go('#/graph?path=' + encodeURIComponent(item.level) + '&node=' + encodeURIComponent(item.id));
    await until(() => sidebar() === item.id);
    out.noDrawerYet = !q('aside[data-xv-panel="drawer"]');
    q('[data-xv-action="code"]').click();
    const code = await until(() => q('aside[data-xv-panel="drawer"] .xv-code[aria-label="Source of ' + item.file + '"]'));
    await until(() => code && code.getAttribute('data-xv-highlight'));
    const drawer = q('aside[data-xv-panel="drawer"]');
    out.open = { highlight: code?.getAttribute('data-xv-highlight'), marked: all('aside[data-xv-panel="drawer"] .xv-line-hl').map((el) => el.getAttribute('data-n')), height: Math.round(drawer.getBoundingClientRect().height), viewport: innerHeight, title: drawer.getAttribute('aria-label'), link: q('[data-xv-action="code-page"]')?.getAttribute('href') };
    q('[data-xv-action="expand"]').click();
    await until(() => q('aside[data-xv-panel="drawer"]').getBoundingClientRect().height > innerHeight * 0.8);
    out.full = { height: Math.round(q('aside[data-xv-panel="drawer"]').getBoundingClientRect().height), pressed: q('[data-xv-action="expand"]').getAttribute('aria-pressed') };
    q('[data-xv-action="expand"]').click();
    await sleep(500);
    out.shrunk = { height: Math.round(q('aside[data-xv-panel="drawer"]').getBoundingClientRect().height) };
    // A file node has no line range to mark; a file the page holds no text for says so, as the Code page does.
    await go('#/graph?path=' + encodeURIComponent(item.level) + '&node=' + encodeURIComponent('file:' + item.file));
    await until(() => q('aside[data-xv-panel="drawer"] .xv-code'));
    out.fileNode = { highlight: q('aside[data-xv-panel="drawer"] .xv-code')?.getAttribute('data-xv-highlight') ?? null };
    await go('#/graph?path=' + encodeURIComponent('src/core/engine') + '&node=' + encodeURIComponent('function:src/core/engine/run.js:run'));
    await until(() => sidebar() === 'function:src/core/engine/run.js:run');
    const graphOnly = await until(() => q('aside[data-xv-panel="drawer"] .xv-code[aria-label="Source of src/core/engine/run.js"]'));
    await until(() => graphOnly && graphOnly.getAttribute('data-xv-highlight'));
    out.graphOnly = { highlight: graphOnly?.getAttribute('data-xv-highlight') ?? null, text: graphOnly?.textContent ?? null };
    await go('#/graph?node=' + encodeURIComponent('document:docs/guide.md'));
    await until(() => sidebar() === 'document:docs/guide.md');
    await until(() => q('aside[data-xv-panel="drawer"] .xv-drawer'));
    out.unpointed = { text: q('aside[data-xv-panel="drawer"] .xv-drawer')?.textContent ?? null, code: !!q('aside[data-xv-panel="drawer"] .xv-code') };
  `), (out, graph) => {
    const item = graph.interaction.search[1];
    const lines = item.lines.split('-').map(Number);
    const expected = Array.from({ length: lines[1] - lines[0] + 1 }, (_, i) => String(lines[0] + i));
    return [
      ['drawer: closed until it is opened', out.noDrawerYet === true, out.noDrawerYet],
      [`drawer: opens on the source of ${item.file} with data-xv-highlight equal to the line range ${item.lines}`, out.open?.highlight === item.lines && JSON.stringify(out.open.marked) === JSON.stringify(expected), out.open],
      ['drawer: is 40vh high', Math.abs(out.open?.height - out.open?.viewport * 0.4) <= 2, out.open],
      ['drawer: links to the Code page at the same lines', out.open?.link === `#/code?path=${encodeURIComponent(item.file)}&lines=${item.lines}`, out.open?.link],
      ['drawer: expands to the whole main area and shrinks back', out.full?.pressed === 'true' && out.full.height > out.open.viewport * 0.8 && Math.abs(out.shrunk?.height - out.open.height) <= 2, [out.full, out.shrunk]],
      ['drawer: a file node has no line range to mark', out.fileNode?.highlight === null, out.fileNode],
      ['drawer: a node of a file that only the graph names opens its code, with the line range marked', out.graphOnly?.highlight === '3-5' && /return helper\(2\)/.test(out.graphOnly.text), out.graphOnly],
      ['drawer: a node whose file the graph has no file node for and no product points at says the page holds nothing for it, as the Code page does', /holds nothing for it/.test(out.unpointed?.text ?? '') && out.unpointed.code === false, out.unpointed],
    ];
  }],

  ['focus', 'directories', (graph) => driver(`
    const f = ${JSON.stringify(graph.interaction.focus)};
    await go('#/graph?path=' + encodeURIComponent(f.level) + '&node=' + encodeURIComponent(f.id));
    await until(() => sidebar() === f.id);
    out.edgesInSidebar = { out: all('section[aria-label="Outgoing edges"] [data-xv-edge-to]').length, in: all('section[aria-label="Incoming edges"] [data-xv-edge-to]').length, groups: all('section[aria-label="Incoming edges"] h4').map((h) => h.textContent) };
    q('[data-xv-action="focus"]').click();
    await until(() => attr('data-xv-count-focus-nodes') !== null);
    await sleep(200);
    out.focus = { hash: location.hash, nodes: attr('data-xv-count-focus-nodes'), drawn: attr('data-xv-count-focus-drawn'), edges: attr('data-xv-count-focus-edges'), ms: attr('data-xv-focus-ms'), center: attr('data-xv-focus-center'), flowNodes: all('.react-flow__node').length, view: q('[data-xv-view]')?.getAttribute('data-xv-view'), exit: !!all('button').find((b) => b.textContent === 'Exit focus') };
    // A neighbour is chosen: the focus moves to it.
    const neighbour = q('[data-xv-entry="focus-neighbour"]');
    const neighbourId = neighbour.getAttribute('data-xv-node');
    neighbour.click();
    await until(() => route().params.node === neighbourId);
    await until(() => attr('data-xv-focus-center') === neighbourId);
    out.moved = { focus: route().params.focus, center: attr('data-xv-focus-center') === neighbourId, sidebar: sidebar() === neighbourId };
    all('button').find((b) => b.textContent === 'Exit focus').click();
    await until(() => !route().params.focus && q('[data-xv-view="level"]'));
    out.exited = { hash: location.hash, view: q('[data-xv-view]')?.getAttribute('data-xv-view'), node: route().params.node === neighbourId, counts: attr('data-xv-count-focus-nodes') };
  `), (out, graph) => {
    const f = graph.interaction.focus;
    return [
      ['focus: the sidebar lists the node\'s edges by type, each leading to the other end', out.edgesInSidebar?.out === 0 && out.edgesInSidebar.in === f.neighbours && out.edgesInSidebar.groups.length === 2, out.edgesInSidebar],
      [`focus: the worker finished on file:// and the count is the ${f.neighbours} distinct neighbours`, out.focus?.nodes === String(f.neighbours) && out.focus.drawn === String(f.neighbours) && out.focus.edges === String(f.edges) && Number(out.focus.ms) >= 0 && out.focus.center === f.id, out.focus],
      ['focus: the page draws the node and its neighbours, and says how to leave', out.focus?.flowNodes === f.neighbours + 1 && out.focus.view === 'focus' && out.focus.exit && out.focus.hash.includes('focus=1'), out.focus],
      ['focus: choosing a neighbour moves the focus to it', out.moved?.focus === '1' && out.moved.center && out.moved.sidebar, out.moved],
      ['focus: leaving it returns to the level, with the node still selected and no focus count left', out.exited?.view === 'level' && out.exited.node && out.exited.counts === null, out.exited],
    ];
  }],

  ['path', 'directories', (graph) => driver(`
    const p = ${JSON.stringify(graph.interaction.path)};
    // From the dialog: choose the two ends by search.
    await go('#/graph');
    q('[data-xv-action="path-dialog"]').click();
    const dlg = await until(() => dialog('Find a path'));
    const pick = async (label, query, id) => {
      const input = dlg.querySelector('[data-xv-picker="' + label + '"] input[type="search"]');
      setValue(input, query);
      const button = await until(() => dlg.querySelector('[data-xv-pick="' + id + '"]'));
      button.click();
      await until(() => !dlg.querySelector('[data-xv-picker="' + label + '"] input[type="search"]'));
    };
    await pick('From', 'start', p.from);
    await pick('To', 'helper', p.to);
    out.way = dlg.textContent.includes('either direction');
    [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Find path').click();
    await until(() => attr('data-xv-path') !== null);
    await until(() => !dialog('Find a path'));
    out.found = { hash: location.hash, state: attr('data-xv-path'), card: q('[data-xv-path-card]')?.getAttribute('data-xv-path-card'), steps: all('[data-xv-path-step]').map((el) => el.getAttribute('data-xv-path-step')), onPath: all('.xv-on-path').length, text: q('[data-xv-path-card]')?.textContent };
    // Drilling keeps the path.
    const label = all('[data-xv-label]').find((el) => el.getAttribute('data-xv-entry') !== 'file');
    label.click();
    await until(() => !level().endsWith('#') || level() !== '#');
    await sleep(300);
    out.drilled = { hash: location.hash, state: attr('data-xv-path') };
    // No path.
    await go('#/graph?from=' + encodeURIComponent(p.none.from) + '&to=' + encodeURIComponent(p.to));
    await until(() => attr('data-xv-path') === 'none');
    out.none = { state: attr('data-xv-path'), text: q('[data-xv-path-card]')?.textContent ?? null, steps: all('[data-xv-path-step]').length };
    // Directed: the path against the edges is gone.
    await go('#/graph?from=' + encodeURIComponent(p.to) + '&to=' + encodeURIComponent(p.from) + '&dir=1');
    await until(() => attr('data-xv-path') !== null);
    out.directed = { state: attr('data-xv-path'), text: q('[data-xv-path-card]')?.textContent ?? null };
    await go('#/graph?from=' + encodeURIComponent(p.to) + '&to=' + encodeURIComponent(p.from));
    await until(() => attr('data-xv-path') !== null);
    out.undirected = { state: attr('data-xv-path') };
  `), (out, graph) => {
    const p = graph.interaction.path;
    return [
      ['path: the dialog states the way edges are followed', out.way === true, out.way],
      [`path: choosing the two ends finds the ${p.steps}-step path and the address holds it`, out.found?.state === `found:${p.steps}` && out.found.card === 'found' && out.found.hash.includes('from=') && out.found.hash.includes('to=') && JSON.stringify(out.found.steps) === JSON.stringify([p.from, 'function:src/core/engine/run.js:run', p.to]), out.found],
      ['path: the card says which way edges are followed', /either direction/.test(out.found?.text ?? ''), out.found?.text],
      ['path: the nodes the path runs through are highlighted', out.found?.onPath >= 1, out.found?.onPath],
      ['path: drilling into a level keeps the path', out.drilled?.hash.includes('from=') && out.drilled.state === `found:${p.steps}`, out.drilled],
      ['path: two nodes that no edge joins say there is no path between them', out.none?.state === 'none' && /No path between these two nodes\./.test(out.none.text ?? '') && out.none.steps === 0, out.none],
      ['path: a directed path against the edges says so, the undirected one finds it', out.directed?.state === 'none' && /only from source to target/.test(out.directed.text ?? '') && out.undirected?.state === `found:${p.steps}`, [out.directed, out.undirected]],
    ];
  }],

  ['filters', 'directories', (graph) => driver(`
    await go('#/graph?path=' + encodeURIComponent(${JSON.stringify(graph.levels[1].path)}));
    await until(() => attr('data-xv-count-graph-level-nodes') !== null);
    const button = () => q('[data-xv-filter-hidden]');
    out.initial = { hidden: button().getAttribute('data-xv-filter-hidden'), nodes: attr('data-xv-count-graph-level-nodes'), edges: attr('data-xv-count-graph-level-edges') };
    button().click();
    const menu = await until(() => dialog('Filters'));
    const chip = (name) => [...menu.querySelectorAll('button[aria-pressed]')].find((b) => b.textContent === name);
    out.chips = [...menu.querySelectorAll('button[aria-pressed]')].map((b) => b.textContent + ':' + b.getAttribute('aria-pressed'));
    chip('imports').click();
    await until(() => button().getAttribute('data-xv-filter-hidden') === '1');
    await sleep(300);
    out.noImports = { hidden: button().getAttribute('data-xv-filter-hidden'), edges: attr('data-xv-count-graph-level-edges') };
    chip('calls').click();
    await until(() => attr('data-xv-count-graph-level-edges') === '0');
    out.noEdgeTypes = { hidden: button().getAttribute('data-xv-filter-hidden'), edges: attr('data-xv-count-graph-level-edges'), nodes: attr('data-xv-count-graph-level-nodes') };
    chip('imports').click(); chip('calls').click();
    await until(() => attr('data-xv-count-graph-level-edges') === out.initial.edges && button().getAttribute('data-xv-filter-hidden') === '0');
    chip('file').click();
    await until(() => attr('data-xv-count-graph-level-nodes') === '0');
    out.noFiles = { hidden: button().getAttribute('data-xv-filter-hidden'), nodes: attr('data-xv-count-graph-level-nodes') };
    chip('file').click();
    await until(() => attr('data-xv-count-graph-level-nodes') === out.initial.nodes);
    out.restored = { hidden: button().getAttribute('data-xv-filter-hidden'), nodes: attr('data-xv-count-graph-level-nodes'), edges: attr('data-xv-count-graph-level-edges') };
    menu.querySelector('button[aria-pressed]');
    [...menu.querySelectorAll('button')].find((b) => b.textContent === 'Reset to the defaults').click();
    key('Escape');
    await sleep(150);
    out.closed = !dialog('Filters');
  `), (out, graph) => {
    const level = graph.levels[1];
    return [
      ['filters: nothing is hidden by default at a level of the fixture, and the button says 0', out.initial?.hidden === '0' && out.initial.nodes === String(level.nodes), out.initial],
      ['filters: the menu lists node types, edge types (without contains) as pressed chips', out.chips?.includes('imports:true') && out.chips.includes('file:true') && !out.chips.some((c) => c.startsWith('contains')), out.chips],
      ['filters: turning an edge type off counts it on the button, and the edge between two entries that two types made stays while one is left', out.noImports?.hidden === '1' && out.noImports.edges === out.initial.edges && out.initial.edges === '1', [out.initial, out.noImports]],
      ['filters: turning both off counts 2, draws no edge and leaves the entries', out.noEdgeTypes?.hidden === '2' && out.noEdgeTypes.edges === '0' && out.noEdgeTypes.nodes === out.initial.nodes, out.noEdgeTypes],
      ['filters: hiding the file node type leaves no entry, and says 1 hidden', out.noFiles?.hidden === '1' && out.noFiles.nodes === '0', out.noFiles],
      ['filters: turning it back restores the level', out.restored?.hidden === '0' && out.restored.nodes === out.initial.nodes && out.restored.edges === out.initial.edges, out.restored],
      ['filters: Esc closes the menu', out.closed === true, out.closed],
    ];
  }],

  ['keys', 'directories', (graph) => driver(`
    const f = ${JSON.stringify(graph.interaction.focus)};
    const p = ${JSON.stringify(graph.interaction.path)};
    const seen = [];
    const snap = (label) => seen.push({ label, shortcuts: !!dialog('Keyboard shortcuts'), drawer: !!q('aside[data-xv-panel="drawer"]'), focus: route().params.focus ?? null, from: route().params.from ?? null, node: route().params.node ?? null, path: route().params.path ?? '' });
    await go('#/graph?path=' + encodeURIComponent(f.level) + '&node=' + encodeURIComponent(f.id) + '&focus=1&from=' + encodeURIComponent(p.from) + '&to=' + encodeURIComponent(p.to));
    await until(() => attr('data-xv-count-focus-nodes') !== null);
    q('[data-xv-action="code"]').click();
    await until(() => q('aside[data-xv-panel="drawer"] .xv-code'));
    key('?', document.body);
    await until(() => dialog('Keyboard shortcuts'));
    out.listed = [...dialog('Keyboard shortcuts').querySelectorAll('kbd')].map((k) => k.textContent);
    snap('start');
    for (let i = 0; i < 6; i++) { key('Escape'); await sleep(450); await until(() => attr('data-xv-ready') === '1' || true); snap('esc' + (i + 1)); }
    // At the top level Esc has nothing left to close.
    key('Escape'); await sleep(200); snap('esc7');
    out.history = history.length;
    // ? toggles the list, and Esc inside the search box closes its results.
    key('?', document.body); await until(() => dialog('Keyboard shortcuts')); key('?', document.body); await sleep(400);
    out.toggled = !dialog('Keyboard shortcuts');
    const input = q('[data-xv-search]'); input.focus(); setValue(input, 'run'); await until(() => q('[data-xv-hit]'));
    key('Escape'); await sleep(150);
    out.searchEsc = { results: !!q('[data-xv-hit]'), focused: document.activeElement === input };
    out.seen = seen;
  `), (out, graph) => {
    const f = graph.interaction.focus;
    const s = out.seen ?? [];
    const at = (i) => s[i] ?? {};
    return [
      ['keys: ? lists the shortcuts', ['/', '?', 'Esc'].every((k) => out.listed?.includes(k)), out.listed],
      ['keys: Esc closes the dialog first, leaving the drawer, focus and selection', at(1).shortcuts === false && at(1).drawer === true && at(1).focus === '1' && at(1).node === f.id, at(1)],
      ['keys: then the code drawer', at(2).drawer === false && at(2).focus === '1' && at(2).from !== null, at(2)],
      ['keys: then the focus', at(3).focus === null && at(3).node === f.id && at(3).from !== null, at(3)],
      ['keys: then the path', at(4).from === null && at(4).node === f.id, at(4)],
      ['keys: then the selection', at(5).node === null && at(5).path === f.level, at(5)],
      ['keys: then one level of the graph', at(6).path !== f.level && at(6).node === null, at(6)],
      ['keys: Esc at the top level changes nothing', at(7).path === at(6).path && at(7).label === 'esc7', [at(6), at(7)]],
      ['keys: ? opens and closes the list', out.toggled === true, out.toggled],
      ['keys: Esc in the search box closes its results first', out.searchEsc?.results === false, out.searchEsc],
    ];
  }],

  ['overlays', 'directories', (graph) => driver(`
    const names = ['hotspots', 'unused', 'doc-map'];
    const toggle = (name) => q('[data-xv-overlay="' + name + '"]');
    const labelOf = (el) => el.closest('[data-xv-label]')?.getAttribute('data-xv-label') ?? el.parentElement?.parentElement?.querySelector('[data-xv-label]')?.getAttribute('data-xv-label');
    const marks = () => ({
      hot: all('[data-xv-entry][data-xv-hot]').map((el) => el.getAttribute('data-xv-label') + ':' + el.getAttribute('data-xv-hot')).sort(),
      chips: all('[data-xv-chip]').map((el) => labelOf(el) + ':' + el.textContent + ':' + el.getAttribute('data-xv-chip')).sort(),
      legends: all('[data-xv-legend]').map((el) => el.getAttribute('data-xv-legend')),
    });
    await go('#/graph');
    await until(() => attr('data-xv-count-graph-level-nodes') !== null);
    out.initial = { pressed: names.map((n) => toggle(n).getAttribute('aria-pressed')), disabled: names.map((n) => toggle(n).disabled), marks: marks(), overlayAttr: q('[data-xv-graph]').getAttribute('data-xv-overlays') };
    // Top level, one overlay at a time.
    toggle('hotspots').click();
    await until(() => q('[data-xv-legend="hotspots"]') && all('[data-xv-hot]').length > 0);
    out.hot = { hash: location.hash, pressed: toggle('hotspots').getAttribute('aria-pressed'), marks: marks(), legend: q('[data-xv-legend="hotspots"]').textContent, rows: all('[data-xv-legend="hotspots"] [data-xv-legend-row]').map((el) => el.textContent), titles: all('[data-xv-entry][data-xv-hot]').map((el) => el.parentElement.getAttribute('title')), history: history.length };
    toggle('unused').click();
    await until(() => all('[data-xv-chip]').length > 0);
    out.unused = { hash: location.hash, marks: marks(), legend: q('[data-xv-legend="unused"]')?.textContent, titles: all('[data-xv-chip]').map((el) => el.closest('[title]')?.getAttribute('title')) };
    toggle('doc-map').click();
    await until(() => all('[data-xv-chip="evidence"]').length > 0);
    out.docMap = { hash: location.hash, marks: marks(), legend: q('[data-xv-legend="doc-map"]')?.textContent };
    out.sameHistory = history.length === out.hot.history;
    const core = q('[data-xv-label="src/core"]');
    out.core = { title: core.parentElement.getAttribute('title'), hot: core.getAttribute('data-xv-hot'), chips: core.parentElement.querySelectorAll('[data-xv-chip]').length };
    toggle('hotspots').click();
    await until(() => all('[data-xv-hot]').length === 0);
    out.hotOff = { hash: location.hash, marks: marks() };
    toggle('unused').click(); toggle('doc-map').click();
    await until(() => all('[data-xv-chip]').length === 0);
    out.allOff = { hash: location.hash, marks: marks() };
    // A drilled level, with all three on; the cards over the canvas must clear the nodes once the camera has fitted.
    await go('#/graph?path=src&overlay=hotspots,unused,doc-map');
    await until(() => level() === 'src#' && all('[data-xv-chip]').length > 0);
    await sleep(1100);
    const boxes = (selector) => all(selector).map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0);
    const cards = [...boxes('[data-xv-chrome="top"]'), ...boxes('[data-xv-chrome="bottom"]'), ...boxes('.react-flow__minimap'), ...boxes('.react-flow__controls')];
    const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const nodes = boxes('.react-flow__node');
    out.drilled = {
      level: level(),
      files: all('[data-xv-entry="file"]').map((el) => ({ label: el.getAttribute('data-xv-label'), hot: el.getAttribute('data-xv-hot'), chips: [...el.parentElement.querySelectorAll('[data-xv-chip]')].map((c) => c.textContent + ':' + c.getAttribute('data-xv-chip')), title: el.parentElement.getAttribute('title') })),
      nodes: nodes.length, cards: cards.length, overlapping: nodes.filter((n) => cards.some((c) => hit(n, c))).length,
      topCard: boxes('[data-xv-chrome="top"]').map((r) => Math.round(r.bottom)), firstNodeTop: Math.round(Math.min(...nodes.map((n) => n.top))),
      legendHeight: Math.round(boxes('[data-xv-chrome="bottom"]')[0]?.height ?? 0),
    };
    // A file opens to its functions: an unused one is marked with its confidence.
    const main = all('[data-xv-entry="file"]').find((el) => el.getAttribute('data-xv-label') === 'main.js');
    main.querySelector('button[aria-expanded]').click();
    await until(() => q('[data-xv-entry="child"][data-xv-unused]'));
    out.rows = all('[data-xv-entry="child"]').map((el) => ({ node: el.getAttribute('data-xv-node'), unused: el.getAttribute('data-xv-unused'), title: el.getAttribute('title'), text: el.textContent }));
  `), (out) => {
    const lib = (o) => o.marks.hot.find((h) => h.startsWith('lib:'));
    return [
      ['overlays: all three switches are enabled and off to begin with, and nothing is marked', JSON.stringify(out.initial?.pressed) === '["false","false","false"]' && out.initial.disabled.every((d) => d === false) && out.initial.marks.hot.length === 0 && out.initial.marks.chips.length === 0 && out.initial.marks.legends.length === 0 && out.initial.overlayAttr === null, out.initial],
      ['overlays: hotspots colours the directories by band; the address holds it; the legend lists the bands and how they were made', out.hot?.hash.includes('overlay=hotspots') && out.hot.pressed === 'true' && JSON.stringify(out.hot.marks.hot) === JSON.stringify(['lib:1', 'src:3']) && out.hot.rows.length === 3 && /^Directories/.test(out.hot.rows[0]) && /quartiles of its 2 directory scores \(cut points 130\)/.test(out.hot.legend) && /banded by the sum of its files' scores/.test(out.hot.legend) && !/highest band/.test(out.hot.legend), out.hot],
      ['overlays: a directory says in its tooltip which rule gave its band: the product\'s score for it, or the sum of its files\' scores', out.hot?.titles.length === 2 && out.hot.titles.some((t) => /the product lists this directory with score 5, band 1 of 2 \(5 to 5\), among the 2 directory scores it lists/.test(t ?? '')) && out.hot.titles.some((t) => /add up to 130; band 1 of 1 \(130 to 130\) among the 1 entry of this level that has no directory score/.test(t ?? '')), out.hot?.titles],
      ['overlays: unused marks the directories with the number of listed functions, coloured by the highest confidence, on top of the hotspots; its legend lists the confidences', out.unused?.hash.includes('overlay=hotspots%2Cunused') && JSON.stringify(out.unused.marks.chips) === JSON.stringify(['lib:1 unused:low', 'src:2 unused:high']) && JSON.stringify(out.unused.marks.hot) === JSON.stringify(['lib:1', 'src:3']) && /high confidence/.test(out.unused.legend) && /low confidence/.test(out.unused.legend), out.unused],
      ['overlays: the tooltip of a marked directory says it counts the functions of its files', out.unused?.titles.every((t) => /Unused: \d+ functions? listed as unused in \d+ of its \d+ files?/.test(t ?? '')), out.unused?.titles],
      ['overlays: doc-map marks the directories with how many of their counted files have evidence', JSON.stringify(out.docMap?.marks.chips.filter((c) => c.endsWith(':evidence'))) === JSON.stringify(['lib:1/1 evidence:evidence', 'src:2/2 evidence:evidence']) && out.docMap.marks.legends.join() === 'hotspots,unused,doc-map' && /with evidence/.test(out.docMap.legend), out.docMap],
      ['overlays: each overlay is switched on its own: turning hotspots off leaves the other two, and the others off leaves a plain graph', out.hotOff?.marks.hot.length === 0 && out.hotOff.marks.legends.join() === 'unused,doc-map' && out.hotOff.hash.includes('overlay=unused%2Cdoc-map') && out.allOff?.marks.chips.length === 0 && out.allOff.marks.legends.length === 0 && !out.allOff.hash.includes('overlay'), [out.hotOff, out.allOff]],
      ['overlays: a switch is a setting of the view, not a place in the history', out.sameHistory === true, out.sameHistory],
      ['overlays: in a drilled level a file is marked by its own score, functions and evidence', out.drilled?.level === 'src#' && JSON.stringify(out.drilled.files.map((f) => [f.label, f.hot, f.chips])) === JSON.stringify([['main.js', '4', ['1 unused:high', 'evidence:evidence']], ['util.js', '3', ['1 unused:medium', 'evidence:evidence']]]) && /Hotspots: score 90, band 4 of 4/.test(out.drilled.files[0].title), out.drilled?.files],
      ['overlays: a directory none of whose files has a score is not coloured, and its tooltip says so', out.core?.hot === null && out.core.title.includes('Hotspots: none of its 2 files has a score') && out.core.title.includes('Unused: none of the functions of its 2 files is listed as unused') && out.core.chips === 0, out.core],
      ['overlays: in the drilled level the nodes clear the cards over the canvas', out.drilled?.nodes >= 2 && out.drilled.cards >= 4 && out.drilled.overlapping === 0 && out.drilled.firstNodeTop >= Math.max(...out.drilled.topCard), out.drilled],
      ['overlays: a function of an open file that the product lists is marked with its confidence', out.rows?.some((r) => r.node === 'function:src/main.js:orphan' && r.unused === 'high' && /unused high/.test(r.text) && /Unused: listed as unused, confidence high/.test(r.title)) && out.rows.some((r) => r.node === 'function:src/main.js:main' && r.unused === null), out.rows],
    ];
  }],

  // A short window with every legend open leaves the least room: the first row of nodes must still be clear of the cards after the camera has fitted.
  ['clearance', 'directories', (graph) => driver(`
    const boxes = (selector) => all(selector).map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0);
    const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    out.views = [];
    for (const hash of ['#/graph', '#/graph?overlay=hotspots,unused,doc-map', '#/graph?path=src%2Fcore&overlay=hotspots,unused,doc-map', '#/graph?path=src&overlay=hotspots,unused,doc-map']) {
      await go(hash);
      await until(() => attr('data-xv-count-graph-level-nodes') !== null);
      await sleep(1300);
      const nodes = boxes('.react-flow__node');
      const cards = [...boxes('[data-xv-chrome="top"]'), ...boxes('[data-xv-chrome="bottom"]'), ...boxes('.react-flow__minimap'), ...boxes('.react-flow__controls')];
      out.views.push({ hash, nodes: nodes.length, cards: cards.length, overlapping: nodes.filter((n) => cards.some((c) => hit(n, c))).length, innerHeight, legend: Math.round(boxes('[data-xv-chrome="bottom"]')[0]?.height ?? 0), top: Math.round(Math.max(...boxes('[data-xv-chrome="top"]').map((r) => r.bottom))), firstNode: Math.round(Math.min(...nodes.map((n) => n.top))) });
    }
  `), (out) => (out.views ?? []).map((view) => [
    'clearance: ' + view.hash + ' at ' + view.innerHeight + ' px high: no node is under the breadcrumbs, the legend, the minimap or the controls',
    view.nodes >= 2 && view.cards >= 3 && view.overlapping === 0 && view.firstNode >= view.top,
    view,
  ]), { height: 640 }],

  ['notrun', 'notrun', (graph) => driver(`
    const toggle = (name) => q('[data-xv-overlay="' + name + '"]');
    await go('#/graph');
    await until(() => attr('data-xv-count-graph-level-nodes') !== null);
    const state = (name) => ({ disabled: toggle(name).disabled, pressed: toggle(name).getAttribute('aria-pressed'), text: toggle(name).textContent, title: toggle(name).getAttribute('title') });
    out.switches = { hotspots: state('hotspots'), unused: state('unused'), docMap: state('doc-map') };
    toggle('doc-map').click();
    await sleep(200);
    out.afterClick = { hash: location.hash, pressed: toggle('doc-map').getAttribute('aria-pressed') };
    // An address that asks for it anyway: nothing is marked, and the legend says why.
    await go('#/graph?overlay=doc-map,unused');
    await until(() => q('[data-xv-legend="doc-map"]'));
    await sleep(200);
    out.asked = { legend: q('[data-xv-legend="doc-map"]').textContent, chips: all('[data-xv-chip]').map((c) => c.getAttribute('data-xv-chip')), pressed: [toggle('doc-map').getAttribute('aria-pressed'), toggle('unused').getAttribute('aria-pressed')] };
  `), (out) => [
    ['notrun: the switch of a product that was not run is disabled and says not run; the others are on offer', out.switches?.docMap.disabled === true && /not run/.test(out.switches.docMap.text) && /not run/.test(out.switches.docMap.title) && out.switches.hotspots.disabled === false && out.switches.unused.disabled === false, out.switches],
    ['notrun: a click on it changes nothing', out.afterClick?.hash === '#/graph' && out.afterClick.pressed === 'false', out.afterClick],
    ['notrun: an address that turns it on marks nothing and the legend says the product was not run, while the other overlay works', /doc map product is not run: nothing is marked/.test(out.asked?.legend ?? '') && out.asked.chips.every((c) => c !== 'evidence' && c !== 'no-evidence') && out.asked.chips.length >= 1 && out.asked.pressed.join() === 'false,true', out.asked],
  ]],

  ['restore', 'directories', (graph) => driver(`
    const toggle = (name) => q('[data-xv-overlay="' + name + '"]');
    await until(() => level() === '#' && all('[data-xv-chip]').length > 0);
    await sleep(300);
    const button = q('[data-xv-filter-hidden]');
    out.restored = { hash: location.hash, level: level(), pressed: ['hotspots', 'unused', 'doc-map'].map((n) => toggle(n).getAttribute('aria-pressed')), hidden: button.getAttribute('data-xv-filter-hidden'), chips: all('[data-xv-chip]').map((c) => c.getAttribute('data-xv-chip')).sort(), hot: all('[data-xv-hot]').length };
    button.click();
    const menu = await until(() => dialog('Filters'));
    const chip = (name) => [...menu.querySelectorAll('button[aria-pressed]')].find((b) => b.textContent === name);
    out.menu = { imports: chip('imports').getAttribute('aria-pressed'), calls: chip('calls').getAttribute('aria-pressed'), fn: chip('function').getAttribute('aria-pressed'), file: chip('file').getAttribute('aria-pressed') };
    // The filters and overlays go with the view through a drill-down and a selection.
    key('Escape'); await sleep(100);
    q('[data-xv-label="src/core"]').click();
    await until(() => level() === 'src/core#');
    out.drilled = { hash: decodeURIComponent(location.hash) };
    q('[data-xv-entry="file"]').click();
    await until(() => route().params.node);
    out.selected = { hash: decodeURIComponent(location.hash) };
    // Changing a filter writes it to the address too, and does not add a history entry.
    const before = history.length;
    q('[data-xv-filter-hidden]').click();
    const menu2 = await until(() => dialog('Filters'));
    [...menu2.querySelectorAll('button[aria-pressed]')].find((b) => b.textContent === 'document').click();
    await until(() => location.hash.includes('hideTypes'));
    out.changed = { hash: decodeURIComponent(location.hash), sameHistory: history.length === before };
    [...menu2.querySelectorAll('button')].find((b) => b.textContent === 'Reset to the defaults').click();
    await until(() => !location.hash.includes('hideTypes') && !location.hash.includes('edgeTypes'));
    out.reset = { hash: decodeURIComponent(location.hash) };
  `), (out) => [
    ['restore: a load from the address brings back the level, the overlays that were on, and the filters', out.restored?.level === '#' && JSON.stringify(out.restored.pressed) === '["false","true","true"]' && out.restored.hidden === '2' && out.restored.hot === 0 && out.restored.chips.includes('high') && out.restored.chips.includes('evidence'), out.restored],
    ['restore: the filter menu shows the restored choices', out.menu?.imports === 'false' && out.menu.calls === 'true' && out.menu.fn === 'false' && out.menu.file === 'true', out.menu],
    ['restore: a drill-down and a selection keep the overlays and the filters in the address', /overlay=unused,doc-map/.test(out.drilled?.hash ?? '') && /edgeTypes=calls/.test(out.drilled.hash) && /hideTypes=function/.test(out.drilled.hash) && /overlay=unused,doc-map/.test(out.selected?.hash ?? '') && /hideTypes=function/.test(out.selected.hash), [out.drilled, out.selected]],
    ['restore: changing a filter writes it to the address without a new history entry, and reset takes them off', /hideTypes=document,function/.test(out.changed?.hash ?? '') && out.changed.sameHistory === true && !/hideTypes|edgeTypes/.test(out.reset?.hash ?? '') && /overlay=unused,doc-map/.test(out.reset.hash), [out.changed, out.reset]],
  ], { hash: '/graph?overlay=unused,doc-map&edgeTypes=calls&hideTypes=function' }],

  ['locate', 'directories', (graph) => driver(`
    const toggle = (name) => q('[data-xv-overlay="' + name + '"]');
    const arrived = async (test) => { await until(() => route().page === 'graph' && test(route().params)); await until(() => q('[data-xv-overlay="unused"]') && q('[data-xv-graph]')); await until(() => attr('data-xv-ready') === '1'); await sleep(150); };
    const there = () => ({ hash: decodeURIComponent(location.hash), params: route().params, level: level(), sidebar: sidebar(), selected: all('.xv-selected').length, pressed: ['hotspots', 'unused', 'doc-map'].map((n) => toggle(n).getAttribute('aria-pressed')).join() });
    // Unused rows: each locates its function, and the unused overlay comes on.
    out.unused = [];
    for (const id of ['function:src/main.js:orphan', 'function:src/util.js:leaf', 'function:lib/data.py:unused_loader']) {
      await go('#/unused');
      const button = await until(() => q('[data-xv-locate="node:' + id + '"]'));
      button.click();
      await arrived((p) => p.node === id);
      await until(() => sidebar() === id);
      const row = await until(() => q('[data-xv-entry="child"][data-xv-node="' + id + '"]'));
      out.unused.push({ id, ...there(), row: row?.getAttribute('data-xv-unused') ?? null });
    }
  `), (out) => {
    const expected = { 'function:src/main.js:orphan': ['src#', 'high'], 'function:src/util.js:leaf': ['src#', 'medium'], 'function:lib/data.py:unused_loader': ['lib#', 'low'] };
    const unusedOk = (r) => r.params.node === r.id && r.sidebar === r.id && r.params.overlay === 'unused' && r.pressed === 'false,true,false' && r.level === expected[r.id][0] && r.row === expected[r.id][1] && r.selected === 1;
    return [
      ['locate: each Unused row selects the function of the record, drilled to its file, with the unused overlay on and the function marked by its confidence', out.unused?.length === 3 && out.unused.every(unusedOk), out.unused],
    ];
  }],

  ['locate-tables', 'directories', (graph) => driver(`
    const toggle = (name) => q('[data-xv-overlay="' + name + '"]');
    const arrived = async (test) => { await until(() => route().page === 'graph' && test(route().params)); await until(() => q('[data-xv-overlay="unused"]') && q('[data-xv-graph]')); await until(() => attr('data-xv-ready') === '1'); await sleep(150); };
    const there = () => ({ hash: decodeURIComponent(location.hash), params: route().params, level: level(), sidebar: sidebar(), selected: all('.xv-selected').length, pressed: ['hotspots', 'unused', 'doc-map'].map((n) => toggle(n).getAttribute('aria-pressed')).join() });
    // Hotspots: a file the graph has, a directory it has a container for, and a file it has no node for.
    await go('#/hotspots');
    (await until(() => q('[data-xv-locate="file:src/util.js"]'))).click();
    await arrived((p) => p.node === 'file:src/util.js');
    await until(() => sidebar() === 'file:src/util.js');
    out.file = there();
    await go('#/hotspots?view=directories');
    (await until(() => q('[data-xv-locate="directory:lib"]'))).click();
    await arrived((p) => p.entry === 'group:lib');
    await until(() => q('aside[data-xv-panel="sidebar"]'));
    out.directory = { ...there(), title: q('aside[data-xv-panel="sidebar"]')?.getAttribute('aria-label') };
    // src is split by the graph into src/core and the files directly in src: no one container stands for it.
    await go('#/hotspots?view=directories');
    (await until(() => q('[data-xv-locate="directory:src"]'))).click();
    const split = await until(() => q('[data-xv-locate-message]'));
    await sleep(200);
    out.split = { text: split.textContent, page: route().page };
    await go('#/hotspots');
    const before = location.hash;
    const history0 = history.length;
    const missing = await until(() => q('[data-xv-locate="file:scripts/build.sh"]'));
    missing.click();
    const message = await until(() => missing.parentElement.querySelector('[data-xv-locate-message]'));
    await sleep(300);
    out.missing = { text: message.textContent, hash: location.hash === before, history: history.length === history0, page: route().page, messages: missing.parentElement.querySelectorAll('[data-xv-locate-message]').length };
    // Doc map: a file of the coverage.
    await go('#/doc-map');
    (await until(() => q('[data-xv-locate="file:lib/data.py"]'))).click();
    await arrived((p) => p.node === 'file:lib/data.py');
    await until(() => sidebar() === 'file:lib/data.py');
    out.docMap = there();
  `), (out) => [
      ['locate: a Hotspots file row selects the file node, with the hotspots overlay on', out.file?.params.node === 'file:src/util.js' && out.file.sidebar === 'file:src/util.js' && out.file.level === 'src#' && out.file.pressed === 'true,false,false' && out.file.params.overlay === 'hotspots', out.file],
      ['locate: a Hotspots directory row selects the directory container, with the hotspots overlay on', out.directory?.params.entry === 'group:lib' && !out.directory.params.node && out.directory.title === 'lib' && out.directory.selected === 1 && out.directory.pressed === 'true,false,false', out.directory],
      ['locate: a directory that the graph splits into several containers says no single node stands for it, and stays on the page', out.split?.text === 'No single node of the graph stands for this directory.' && out.split.page === 'hotspots', out.split],
      ['locate: a Hotspots path with no node in the graph says so beside the row and does nothing else', out.missing?.text === 'Not in the graph.' && out.missing.hash && out.missing.history && out.missing.page === 'hotspots' && out.missing.messages === 1, out.missing],
      ['locate: a Doc map file row selects the file node, with the doc-map overlay on', out.docMap?.params.node === 'file:lib/data.py' && out.docMap.sidebar === 'file:lib/data.py' && out.docMap.level === 'lib#' && out.docMap.pressed === 'false,false,true', out.docMap],
  ]],

  ['layers', 'layers', (graph) => driver(`
    await go('#/graph');
    await until(() => attr('data-xv-count-graph-level-nodes') === '3');
    const button = () => q('[data-xv-filter-hidden]');
    button().click();
    const menu = await until(() => dialog('Filters'));
    const chip = (name) => [...menu.querySelectorAll('button[aria-pressed]')].find((b) => b.textContent === name);
    out.layers = [...menu.querySelectorAll('section')].map((s) => s.querySelector('h3').textContent);
    chip('Data').click();
    await until(() => attr('data-xv-count-graph-level-nodes') === '2');
    out.hidden = { hidden: button().getAttribute('data-xv-filter-hidden'), nodes: attr('data-xv-count-graph-level-nodes'), files: attr('data-xv-count-graph-level-files'), labels: all('[data-xv-label]').map((el) => el.getAttribute('data-xv-label')).sort() };
    chip('Data').click();
    await until(() => attr('data-xv-count-graph-level-nodes') === '3');
    out.shown = { hidden: button().getAttribute('data-xv-filter-hidden') };
  `), (out) => [
    ['layers: the filter lists the layers', out.layers?.includes('Layers'), out.layers],
    ['layers: hiding a layer takes its cluster off the level and counts 1 hidden, the level keeps its own file count', out.hidden?.hidden === '1' && out.hidden.nodes === '2' && out.hidden.files === '5' && !out.hidden.labels.includes('Data'), out.hidden],
    ['layers: showing it again brings the cluster back', out.shown?.hidden === '0', out.shown],
  ]],

  ['entry', 'layers', (graph) => driver(`
    await go('#/graph');
    await until(() => attr('data-xv-count-graph-level-nodes') === '3');
    q('button[aria-label="Details of Application"]').click();
    await until(() => sidebar() !== null);
    const side = q('aside[data-xv-panel="sidebar"]');
    out.entry = { hash: decodeURIComponent(location.hash), level: level(), id: sidebar(), title: side.getAttribute('aria-label'), rows: all('[data-xv-entry-edge]').map((el) => el.getAttribute('data-xv-entry-edge') + ' ' + el.textContent.replace(/\\s+/g, ' ').trim()), marks: all('.xv-selected').length, text: side.textContent.replace(/\\s+/g, ' ') };
    // The selected cluster's edges are lit, not labelled: stacked labels sit on each other (the sidebar has the counts).
    out.labelled = all('.react-flow__edge-textwrapper, .react-flow__edge-text').length;
    key('Escape');
    await until(() => sidebar() === null);
    out.cleared = { hash: location.hash, sidebar: sidebar(), marks: all('.xv-selected').length };
    q('[data-xv-label="Application"]').click();
    await until(() => level() !== '#' && level() !== '#');
    await sleep(300);
    out.drilled = { level: level() };
  `), (out) => [
    ['entry: the info button selects a cluster, the address holds it and the sidebar shows it', out.entry?.hash.includes('entry=') && out.entry.marks === 1 && out.entry.title === 'Application' && out.entry.text.includes('Layer') && out.entry.text.includes('Files2'), out.entry],
    ['entry: the sidebar sums the edges between this cluster and each other one, by type, in each direction', out.entry?.rows.length >= 2 && out.entry.rows.some((r) => r.startsWith('to ') && /imports/.test(r)) && out.entry.rows.some((r) => r.startsWith('from ') && /imports/.test(r)), out.entry?.rows],
    ['entry: the edges of the selected cluster put no count labels on the canvas', out.labelled === 0, out.labelled],
    ['entry: Esc clears it', out.cleared?.sidebar === null && out.cleared.marks === 0 && !out.cleared.hash.includes('entry='), out.cleared],
    ['entry: a click on the card itself still opens the level', out.drilled?.level !== '#' && out.drilled.level.startsWith('layer:app'), out.drilled],
  ]],

  ['domain', 'layers', (graph, expected) => driver(`
    const d = ${JSON.stringify(expected.domain)};
    const dlevel = () => attr('data-xv-domain-level');
    await go('#/domain');
    await until(() => dlevel() === 'top');
    await sleep(200);
    out.top = {
      nav: all('nav[aria-label="Pages"] a').map((a) => a.textContent), current: q('nav[aria-label="Pages"] [aria-current="page"]')?.getAttribute('data-xv-nav'),
      note: q('[data-xv-domain-note]')?.textContent, nodes: attr('data-xv-count-domain-level-nodes'), domains: attr('data-xv-count-domain-domains'), flows: attr('data-xv-count-domain-flows'),
      steps: attr('data-xv-count-domain-steps'), links: attr('data-xv-count-domain-level-links'),
      cards: all('[data-xv-domain-entry="domain"]').map((el) => el.getAttribute('data-xv-label')), text: q('[data-xv-domain-entry="domain"][data-xv-node="domain:app"]')?.textContent, labelsBefore: all('[data-xv-link-label]').length,
    };
    q('[data-xv-domain-entry="domain"][data-xv-node="domain:app"] [data-xv-action="details"]').click();
    await until(() => sidebar() === 'domain:app');
    await sleep(500);
    out.select = { hash: location.hash, labels: all('[data-xv-link-label]').length, side: q('aside[data-xv-panel="sidebar"]').textContent, marked: all('.xv-selected').length };
    q('[data-xv-domain-entry="domain"][data-xv-node="domain:app"]').click();
    await until(() => dlevel() === d.domain.level);
    await sleep(200);
    out.domain = { hash: location.hash, flows: all('[data-xv-domain-entry="flow"]').map((el) => el.getAttribute('data-xv-node')), crumbs: q('nav[aria-label="Breadcrumb"]')?.textContent, selection: route().params.node ?? null };
    q('[data-xv-domain-entry="flow"][data-xv-node="' + d.flow.id + '"]').click();
    await until(() => dlevel() === d.flow.level);
    await sleep(300);
    const steps = all('[data-xv-domain-entry="step"]');
    out.flow = {
      hash: location.hash, steps: steps.map((el) => [el.getAttribute('data-xv-position'), el.getAttribute('data-xv-node'), el.getAttribute('data-xv-label')]),
      tops: steps.map((el) => Math.round(el.getBoundingClientRect().top)), lefts: [...new Set(steps.map((el) => Math.round(el.getBoundingClientRect().left)))].length,
      arrows: all('.react-flow__edge').length, note: q('[data-xv-chrome="top"]')?.textContent,
    };
    q('[data-xv-domain-entry="step"][data-xv-node="' + d.step.id + '"]').click();
    await until(() => sidebar() === d.step.id);
    const side = q('aside[data-xv-panel="sidebar"]');
    out.step = {
      hash: location.hash, marked: all('.xv-selected').length,
      anchors: all('aside[data-xv-panel="sidebar"] [data-xv-anchor]').map((el) => el.getAttribute('data-xv-anchor')),
      missing: all('aside[data-xv-panel="sidebar"] [data-xv-anchor-missing]').map((el) => [el.getAttribute('data-xv-anchor-missing'), el.textContent]),
      evidence: all('aside[data-xv-panel="sidebar"] [data-xv-evidence]').map((el) => el.textContent), text: side.textContent,
    };
    q('aside[data-xv-panel="sidebar"] [data-xv-evidence]').click();
    const code = await until(() => q('aside[data-xv-panel="drawer"] .xv-code[aria-label="Source of ' + d.step.evidence.file + '"]'));
    await until(() => code && code.getAttribute('data-xv-highlight'));
    out.evidence = { highlight: code?.getAttribute('data-xv-highlight') ?? null, marked: all('aside[data-xv-panel="drawer"] .xv-line-hl').map((el) => el.getAttribute('data-n')), title: q('aside[data-xv-panel="drawer"]')?.getAttribute('aria-label') ?? null, selection: route().params.node };
    q('aside[data-xv-panel="sidebar"] [data-xv-anchor]').click();
    await until(() => route().page === 'graph' && route().params.node);
    await until(() => sidebar() === d.step.anchors[0]);
    out.jump = { page: route().page, node: route().params.node, sidebar: sidebar(), marked: all('.xv-selected').length, current: q('nav[aria-label="Pages"] [aria-current="page"]')?.getAttribute('data-xv-nav') };
  `), (out, graph, expected) => {
    const d = expected.domain;
    const sameOrder = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    return [
      ['domain: the Domain page is in the navigation after Graph, and is the page shown', sameOrder(out.top?.nav?.slice(0, 2), ['Graph', 'Domain']) && out.top.current === 'domain', [out.top?.nav, out.top?.current]],
      ['domain: the fixed note is at the top', out.top?.note === d.note, out.top?.note],
      [`domain: the top level has a card for each of the ${d.counts.domains} domains, and the flows and steps they hold add up to ${d.counts.flows} and ${d.counts.steps}`, out.top?.nodes === String(d.counts.domains) && out.top.domains === String(d.counts.domains) && out.top.flows === String(d.counts.flows) && out.top.steps === String(d.counts.steps) && out.top.links === String(d.counts.links) && sameOrder([...out.top.cards].sort(), [...d.cards].sort()), out.top],
      ['domain: a card shows the name, the summary, the flow count and the step count', /Application/.test(out.top?.text ?? '') && /Runs the program/.test(out.top.text) && /2 flows/.test(out.top.text) && /4 steps/.test(out.top.text), out.top?.text],
      ['domain: selecting a domain draws no description box on the canvas and the sidebar lists its cross-domain edge with the description', out.top?.labelsBefore === 0 && out.select?.labels === 0 && out.select.side.includes(d.link) && out.select.marked === 1 && out.select.hash === '#/domain?node=domain%3Aapp', out.select],
      ['domain: the sidebar of a domain shows its summary, domainMeta, flows and cross-domain edges', /Runs the program/.test(out.select?.side ?? '') && /Start-up runs once per process/.test(out.select.side) && /Session/.test(out.select.side) && /Start up/.test(out.select.side) && new RegExp(d.link.replace('.', '\\.')).test(out.select.side), out.select?.side],
      ['domain: a click on a card goes into the domain, which shows its flows, and the address says so', out.domain?.hash === '#/domain?d=domain%3Aapp' && sameOrder([...out.domain.flows].sort(), [...d.domain.flows].sort()) && out.domain.selection === null && /Domains/.test(out.domain.crumbs), out.domain],
      ['domain: a flow shows its steps as a column in flow_step weight order, numbered by place', sameOrder(out.flow?.steps?.map((s) => s[1]), d.flow.steps) && sameOrder(out.flow.steps.map((s) => s[2]), d.flow.names) && sameOrder(out.flow.steps.map((s) => s[0]), ['1', '2', '3']) && out.flow.lefts === 1 && out.flow.tops.every((t, i) => i === 0 || t > out.flow.tops[i - 1]), out.flow],
      ['domain: there is an arrow between each step and the next, and the panel says they are the order and not edges', out.flow?.arrows === d.flow.steps.length - 1 && /not edges of the domain graph/.test(out.flow.note), [out.flow?.arrows, out.flow?.note]],
      ['domain: a click on a step selects it, in the address, and the sidebar shows it with its provenance', out.step?.hash.includes('node=') && out.step.marked === 1 && /inferred/.test(out.step.text), out.step],
      ['domain: the step lists the graph nodes it names, each to be opened in the structure graph, and the one the graph lacks as "Not in the graph."', sameOrder(out.step?.anchors, d.step.anchors) && sameOrder(out.step.missing.map((m) => m[0]), d.step.missing) && out.step.missing.every((m) => /Not in the graph\./.test(m[1])), out.step],
      ['domain: the evidence line is on the sidebar, and opens the code drawer with that line marked', sameOrder(out.step?.evidence, [d.step.evidence.label]) && out.evidence?.highlight === d.step.evidence.highlight && sameOrder(out.evidence.marked, d.step.evidence.marked) && out.evidence.title === d.step.evidence.label && out.evidence.selection === d.step.id, [out.step?.evidence, out.evidence]],
      ['domain: a graph node of the step opens the structure graph with that node selected and shown in its sidebar', out.jump?.page === 'graph' && out.jump.current === 'graph' && out.jump.node === d.step.anchors[0] && out.jump.sidebar === d.step.anchors[0] && out.jump.marked === 1, out.jump],
    ];
  }],

  ['domain-history', 'layers', (graph, expected) => driver(`
    const d = ${JSON.stringify(expected.domain)};
    const dlevel = () => attr('data-xv-domain-level');
    await go('#/domain');
    await until(() => dlevel() === 'top');
    q('[data-xv-domain-entry="domain"][data-xv-node="domain:app"]').click(); await until(() => dlevel() === d.domain.level);
    q('[data-xv-domain-entry="flow"][data-xv-node="' + d.flow.id + '"]').click(); await until(() => dlevel() === d.flow.level);
    await sleep(200);
    q('[data-xv-domain-entry="step"][data-xv-node="' + d.step.id + '"]').click(); await until(() => route().params.node === d.step.id);
    await until(() => sidebar() === d.step.id);
    const snap = () => ({ level: dlevel(), node: route().params.node ?? null, marks: all('.xv-selected').length, sidebar: sidebar() });
    out.selected = snap();
    history.back(); await until(() => !location.hash.includes('node='));
    // The sidebar slides out; it is gone once the animation is over.
    await until(() => sidebar() === null);
    out.back1 = snap();
    history.back(); await until(() => dlevel() === d.domain.level);
    out.back2 = snap();
    history.back(); await until(() => dlevel() === 'top');
    out.back3 = snap();
    history.forward(); await until(() => dlevel() === d.domain.level);
    out.fwd1 = snap();
    history.forward(); await until(() => dlevel() === d.flow.level);
    out.fwd2 = snap();
    history.forward(); await until(() => route().params.node === d.step.id);
    await until(() => sidebar() === d.step.id);
    out.fwd3 = snap();
  `), (out, graph, expected) => {
    const d = expected.domain;
    return [
      ['domain-history: the selected step is in the address and the sidebar', out.selected?.level === d.flow.level && out.selected.node === d.step.id && out.selected.sidebar === d.step.id && out.selected.marks === 1, out.selected],
      ['domain-history: back from the selection cancels it and stays in the flow', out.back1?.level === d.flow.level && out.back1.node === null && out.back1.marks === 0 && out.back1.sidebar === null, out.back1],
      ['domain-history: back again goes up to the domain, and once more to the top', out.back2?.level === d.domain.level && out.back3?.level === 'top', [out.back2, out.back3]],
      ['domain-history: forward goes down to the domain, the flow, and selects the step again', out.fwd1?.level === d.domain.level && out.fwd2?.level === d.flow.level && out.fwd3?.node === d.step.id && out.fwd3.sidebar === d.step.id && out.fwd3.marks === 1, [out.fwd1, out.fwd2, out.fwd3]],
    ];
  }],

  ['domain-restore', 'layers', (graph, expected) => driver(`
    const d = ${JSON.stringify(expected.domain)};
    await until(() => attr('data-xv-domain-level') === d.flow.level);
    await until(() => sidebar() === d.flow.steps[1]);
    await sleep(300);
    out.restored = {
      hash: location.hash, level: attr('data-xv-domain-level'), steps: all('[data-xv-domain-entry="step"]').map((el) => el.getAttribute('data-xv-node')), marked: all('.xv-selected').length, sidebar: sidebar(),
      onlyStepVisible: all('[data-xv-domain-entry="step"]').every((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }),
    };
  `), (out, graph, expected) => {
    const d = expected.domain;
    return [
      ['domain-restore: a load from the address brings back the flow, its steps in order, and the selected step with its sidebar', out.restored?.level === d.flow.level && JSON.stringify(out.restored.steps) === JSON.stringify(d.flow.steps) && out.restored.marked === 1 && out.restored.sidebar === d.flow.steps[1] && out.restored.onlyStepVisible, out.restored],
    ];
  }, { hash: '/domain?d=domain%3Aapp&f=flow%3Astart-up&node=step%3Astart-up%3Arun' }],

  ['domain-keys', 'layers', (graph, expected) => driver(`
    const d = ${JSON.stringify(expected.domain)};
    const seen = [];
    const snap = (label) => seen.push({ label, dialog: !!dialog('Keyboard shortcuts'), drawer: !!q('aside[data-xv-panel="drawer"]'), node: route().params.node ?? null, level: attr('data-xv-domain-level'), d: route().params.d ?? null, f: route().params.f ?? null });
    await until(() => attr('data-xv-domain-level') === d.flow.level);
    await until(() => sidebar() === d.step.id);
    q('aside[data-xv-panel="sidebar"] [data-xv-evidence]').click();
    await until(() => q('aside[data-xv-panel="drawer"] .xv-code'));
    key('?', document.body);
    await until(() => dialog('Keyboard shortcuts'));
    snap('start');
    for (let i = 0; i < 6; i++) { key('Escape'); await sleep(450); snap('esc' + (i + 1)); }
    out.seen = seen;
  `), (out, graph, expected) => {
    const d = expected.domain;
    const at = (i) => (out.seen ?? [])[i] ?? {};
    return [
      ['domain-keys: Esc closes the dialog first, leaving the drawer, the selection and the flow', at(1).dialog === false && at(1).drawer === true && at(1).node === d.step.id && at(1).level === d.flow.level, at(1)],
      ['domain-keys: then the code drawer', at(2).drawer === false && at(2).node === d.step.id, at(2)],
      ['domain-keys: then the selection', at(3).node === null && at(3).level === d.flow.level, at(3)],
      ['domain-keys: then up from the flow to its domain', at(4).level === d.domain.level && at(4).f === null && at(4).d === d.domain.id, at(4)],
      ['domain-keys: then up to the top level', at(5).level === 'top' && at(5).d === null, at(5)],
      ['domain-keys: at the top level Esc changes nothing', at(6).level === 'top' && at(6).label === 'esc6', at(6)],
    ];
  }, { hash: '/domain?d=domain%3Aapp&f=flow%3Astart-up&node=step%3Astart-up%3Abegin' }],

  ['domain-products', 'layers', (graph, expected) => driver(`
    await go('#/products');
    await until(() => attr('data-xv-count-domain-domains') !== null);
    const row = await until(() => q('[data-xv-product-card="domain-graph"]'));
    out.products = { counts: ['domains', 'flows', 'steps', 'cross'].map((n) => attr('data-xv-count-domain-' + n)), row: row?.textContent ?? null, counted: q('[data-xv-domain-counts]')?.textContent ?? null };
  `), (out, graph, expected) => [
    ['domain-products: the Products page lists the domain graph as included with its counts', JSON.stringify(out.products?.counts) === JSON.stringify(['2', '3', '5', '1']) && /Included/.test(out.products.row ?? '') && out.products.counted === '2 domains, 3 flows, 5 steps and 1 cross-domain edge.', out.products],
  ]],

  ['domain-notrun', 'domain-notrun', (graph, expected) => driver(`
    await go('#/domain');
    out.page = { text: q('main')?.textContent ?? '', canvas: !!q('.react-flow'), note: !!q('[data-xv-domain-note]') };
    await go('#/products');
    const row = await until(() => q('[data-xv-product-card="domain-graph"]'));
    out.products = row?.textContent ?? null;
  `), (out) => [
    ['domain-notrun: the Domain page says not run and gives the command, and draws no graph', /Domain graph: not run/.test(out.page?.text ?? '') && /\/excavator-domain/.test(out.page.text) && out.page.canvas === false && out.page.note === false, out.page],
    ['domain-notrun: the Products page lists it as not run with the command', /Not run/.test(out.products ?? '') && /\/excavator-domain/.test(out.products), out.products],
  ]],

  ['domain-digest', 'domain-digest', (graph, expected) => driver(`
    const d = ${JSON.stringify(expected.domain)};
    await go('#/domain');
    await until(() => attr('data-xv-domain-level') === 'top');
    out.page = { revision: q('[data-xv-domain-revision]')?.textContent ?? null, cards: all('[data-xv-domain-entry="domain"]').length };
    await go('#/products');
    const row = await until(() => q('[data-xv-product-card="domain-graph"]'));
    out.products = row?.textContent ?? null;
  `), (out, graph, expected) => {
    const { domain, graph: other } = expected.domain.digests;
    return [
      ['domain-digest: a domain graph made from other facts is a different revision: the page writes both digests and still draws the graph', out.page?.revision?.includes(domain) && out.page.revision.includes(other) && out.page.cards === expected.domain.counts.domains, out.page],
      ['domain-digest: the Products page lists it as a different revision with both digests', /Different revision/.test(out.products ?? '') && out.products.includes(domain) && out.products.includes(other), out.products],
    ];
  }],

  ['products-redirect', 'layers', (graph, expected) => driver(`
    const navItem = (id) => q('nav[aria-label="Pages"] [data-xv-nav="' + id + '"]');
    const snap = () => ({ hash: location.hash, nav: q('nav[aria-label="Pages"] [aria-current="page"]')?.getAttribute('data-xv-nav') ?? null, heading: q('main h1')?.textContent ?? null });
    // Short waits: on a page without the redirect each one runs out (the evaluation has 15 s in all), and the checks still say which step failed.
    const ready = () => until(() => attr('data-xv-ready') === '1', 40);
    await until(() => q('main h1')?.textContent === 'Products', 40);
    await ready();
    out.bookmark = snap();
    out.navItem = { href: navItem('products')?.getAttribute('href') ?? null, label: navItem('products')?.textContent ?? null, old: !!navItem('overview') };
    const row = await until(() => q('[data-xv-product-card="tour"]'));
    out.tour = row?.textContent ?? null;
    await go('#/graph');
    const before = history.length;
    location.hash = '#/overview';
    await until(() => location.hash === '#/products' && q('main h1')?.textContent === 'Products', 40);
    await ready();
    out.moved = { ...snap(), added: history.length - before };
    history.back();
    await until(() => location.hash === '#/graph', 40);
    await ready();
    out.back = snap();
    history.forward();
    await until(() => location.hash === '#/products', 40);
    await ready();
    out.forward = snap();
    location.hash = '#/overview?x=1';
    await until(() => location.hash.startsWith('#/products'), 40);
    out.params = location.hash;
  `), (out, graph, expected) => {
    const products = (s) => s?.hash === '#/products' && s.nav === 'products' && s.heading === 'Products';
    return [
      ['products-redirect: a bookmark of #/overview opens the Products page with #/products in the address', products(out.bookmark), out.bookmark],
      ['products-redirect: the navigation names Products and links to #/products, and has no Overview item', out.navItem?.href === '#/products' && /Products/.test(out.navItem.label ?? '') && out.navItem.old === false, out.navItem],
      ['products-redirect: a move to #/overview opens the Products page and adds one history entry, not two', products(out.moved) && out.moved.added === 1, out.moved],
      ['products-redirect: back returns to the graph, not to #/overview, and forward to the Products page', out.back?.hash === '#/graph' && out.back.nav === 'graph' && products(out.forward), [out.back, out.forward]],
      ['products-redirect: the parameters after the page name are kept', out.params === '#/products?x=1', out.params],
      ['products-redirect: the Products page lists the tour as included, made from the graph\'s facts', /Included/.test(out.tour ?? '') && out.tour.includes(expected.tour.factDigest), out.tour],
    ];
  }, { hash: '/overview' }],

  // The inlined fonts (openspec: changes/viewer-learn, design D7): the page title is set in DM Serif Display, the text in Inter and code in
  // JetBrains Mono, each face loaded from the page itself; the run's own checks fail on any request, CSP violation or console error, so a
  // font fetched from anywhere or blocked by the policy fails this scenario too. The body carries the grain as a data URL.
  ['fonts', 'layers', () => driver(`
    await until(() => q('main h1')?.textContent === 'Products', 80);
    await document.fonts.ready;
    const family = (el) => (el ? getComputedStyle(el).fontFamily : null);
    // The Products page may show no code: a probe element reads what the stylesheet gives code.
    const code = document.body.appendChild(document.createElement('code'));
    const faces = [...document.fonts].map((f) => f.family.replace(/"/g, '') + ' ' + f.weight + ' ' + f.status);
    out.fonts = {
      title: family(q('main h1')),
      text: family(document.body),
      code: family(code),
      faces,
      checked: ['26px "DM Serif Display"', '14px "Inter"', '12px "JetBrains Mono"'].map((font) => document.fonts.check(font)),
      grain: getComputedStyle(document.body).backgroundImage.slice(0, 40),
    };
    code.remove();
  `), (out) => [
    ['fonts: the page title\'s computed font starts with DM Serif Display, the text\'s with Inter and code\'s with JetBrains Mono', /^"?DM Serif Display"?,/.test(out.fonts?.title ?? '') && /^"?Inter"?,/.test(out.fonts.text ?? '') && /^"?JetBrains Mono"?,/.test(out.fonts.code ?? ''), out.fonts],
    ['fonts: document.fonts reports DM Serif Display, Inter 400 and JetBrains Mono 400 loaded, and every face is available', ['DM Serif Display 400 loaded', 'Inter 400 loaded', 'JetBrains Mono 400 loaded'].every((f) => out.fonts?.faces.includes(f)) && out.fonts.checked.every(Boolean), out.fonts],
    ['fonts: the page holds the six faces it uses and no other', out.fonts?.faces.length === 6, out.fonts?.faces],
    ['fonts: the body draws its grain from a data URL', /^url\("data:image\/svg\+xml;base64,/.test(out.fonts?.grain ?? ''), out.fonts?.grain],
  ], { hash: '/products' }],

  // A domain graph as wide as a real one (nine domains, a flow of seven steps, long names, summaries and paths), at the smoke's 1280 by
  // 900 window: the cards are read at about full size (the camera fits at a zoom of 0.9 or more) and none of their text runs out of its box.
  ['domain-fit', 'domain-fit', (graph, expected) => driver(`
    const zoom = () => new DOMMatrix(getComputedStyle(q('.react-flow__viewport')).transform).a;
    // A summary is clamped to two lines on purpose; what must not happen is a line cut in half, or a block (the summary, the
    // path and counts) running past the bottom of its card. A card's own scroll height is not read: its hidden handles stick out.
    const clipped = () => all('[data-xv-domain-entry]').flatMap((card) => [...card.querySelectorAll('[data-xv-card-text]')].flatMap((block) => {
      const kind = block.getAttribute('data-xv-card-text');
      const bad = [];
      if (block.offsetTop + block.offsetHeight > card.clientHeight) bad.push(card.getAttribute('data-xv-node') + ':' + kind + ' past the bottom');
      if (kind === 'summary' && block.clientHeight + 0.5 < Math.min(2 * parseFloat(getComputedStyle(block).lineHeight), block.scrollHeight)) bad.push(card.getAttribute('data-xv-node') + ':summary cut mid-line');
      return bad;
    }));
    const apart = () => { const rows = all('[data-xv-domain-entry="step"]').map((card) => ({ summary: card.querySelector('[data-xv-card-text="summary"]')?.getBoundingClientRect(), meta: card.querySelector('[data-xv-card-text="meta"]')?.getBoundingClientRect() })); return rows.length > 0 && rows.every((r) => r.summary && r.meta && r.summary.bottom <= r.meta.top + 0.5); };
    const pane = () => q('.react-flow').getBoundingClientRect();
    const seen = (cards) => cards.every((card) => { const r = card.getBoundingClientRect(); const p = pane(); return r.width > 0 && r.left >= p.left - 1 && r.right <= p.right + 1; });
    const d = ${JSON.stringify(expected.domain)};
    const dlevel = () => attr('data-xv-domain-level');
    await go('#/domain');
    await until(() => dlevel() === 'top');
    await sleep(1500);
    out.top = { zoom: zoom(), cards: all('[data-xv-domain-entry="domain"]').length, clipped: clipped(), inside: seen(all('[data-xv-domain-entry="domain"]')), size: (() => { const r = q('[data-xv-domain-entry="domain"]').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })() };
    q('[data-xv-domain-entry="domain"][data-xv-node="domain:app"]').click();
    await until(() => dlevel() === 'domain:domain:app');
    await sleep(1500);
    out.flows = { zoom: zoom(), cards: all('[data-xv-domain-entry="flow"]').length, clipped: clipped(), inside: seen(all('[data-xv-domain-entry="flow"]')) };
    q('[data-xv-domain-entry="flow"][data-xv-node="' + d.long.flow + '"]').click();
    await until(() => dlevel() === 'flow:domain:app:' + d.long.flow);
    await sleep(1500);
    const steps = all('[data-xv-domain-entry="step"]');
    out.flow = { zoom: zoom(), steps: steps.length, clipped: clipped(), apart: apart(), firstInside: seen(steps.slice(0, 1)), top: Math.round(steps[0].getBoundingClientRect().top - pane().top) };
    steps[2].click();
    await until(() => route().params.node === d.long.steps[2]);
    await sleep(1500);
    out.selected = { zoom: zoom(), clipped: clipped(), sidebar: sidebar() === d.long.steps[2] };
  `), (out, graph, expected) => {
    const d = expected.domain;
    return [
      [`domain-fit: the top level draws ${d.long.domains} cards, each as large as a structure-graph cluster card is drawn, fitted at a zoom of 0.9 or more at 1280 by 900`, out.top?.cards === d.long.domains && out.top.zoom >= 0.9 && out.top.inside === true, out.top],
      ['domain-fit: no text of a domain card runs out of its box', out.top?.clipped?.length === 0, out.top?.clipped],
      ['domain-fit: the flows of a domain are fitted at a zoom of 0.9 or more, with no text out of its box', out.flows?.zoom >= 0.9 && out.flows.cards >= 2 && out.flows.inside === true && out.flows.clipped.length === 0, out.flows],
      [`domain-fit: a flow of ${d.long.steps.length} steps is fitted at a zoom of 0.9 or more, its first step on screen and its steps as one column`, out.flow?.steps === d.long.steps.length && out.flow.zoom >= 0.9 && out.flow.firstInside === true, out.flow],
      ['domain-fit: in a step card the summary ends above the file path, and no text of a step card runs out of its box', out.flow?.apart === true && out.flow.clipped?.length === 0, [out.flow?.apart, out.flow?.clipped]],
      ['domain-fit: selecting a step keeps the zoom readable and the text in its boxes', out.selected?.zoom >= 0.9 && out.selected.clipped.length === 0 && out.selected.sidebar === true, out.selected],
    ];
  }],

  // A file of a hundred and twenty functions, opened on one of them: the camera centres on that row at a readable size rather than fitting the whole file.
  ['longfile', 'longfile', () => driver(`
    const id = 'function:src/long.js:fn119';
    await go('#/graph');
    await until(() => attr('data-xv-count-graph-level-nodes') !== null);
    const input = q('[data-xv-search]');
    input.focus();
    setValue(input, 'fn119');
    const hit = await until(() => q('[data-xv-hit="' + id + '"]'));
    hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await until(() => route().params.node === id);
    await until(() => sidebar() === id && q('[data-xv-node="' + id + '"]'));
    await sleep(1600);
    const vp = q('.react-flow__viewport');
    const pane = q('.react-flow').getBoundingClientRect();
    const node = q('[data-xv-node="' + id + '"]').getBoundingClientRect();
    out.camera = {
      transform: getComputedStyle(vp).transform, zoom: new DOMMatrix(getComputedStyle(vp).transform).a, nodeHeight: Math.round(node.height), rows: all('[data-xv-entry="child"]').length,
      inside: node.top >= pane.top && node.bottom <= pane.bottom && node.left >= pane.left && node.right <= pane.right,
      offCentre: [Math.round(Math.abs(node.left + node.width / 2 - pane.left - pane.width / 2)), Math.round(Math.abs(node.top + node.height / 2 - pane.top - pane.height / 2))], pane: [Math.round(pane.width), Math.round(pane.height)],
    };
    // A reload from the address lands the same way.
    out.hash = location.hash;
  `), (out) => [
    ['longfile: the file is open to all its functions', out.camera?.rows >= 120, out.camera],
    ['longfile: the camera shows the located function at a readable zoom, not the whole file', out.camera?.zoom >= 0.8 && out.camera.nodeHeight >= 17, out.camera],
    ['longfile: the located function is on screen, near the middle of the canvas', out.camera?.inside === true && out.camera.offCentre[0] <= out.camera.pane[0] * 0.2 && out.camera.offCentre[1] <= out.camera.pane[1] * 0.2, out.camera],
  ]],

  // The same address, loaded fresh: the camera does the same.
  ['longfile-restore', 'longfile', () => driver(`
    const id = 'function:src/long.js:fn119';
    await until(() => q('[data-xv-node="' + id + '"]'));
    await sleep(1600);
    const vp = q('.react-flow__viewport');
    const pane = q('.react-flow').getBoundingClientRect();
    const node = q('[data-xv-node="' + id + '"]').getBoundingClientRect();
    out.camera = { zoom: new DOMMatrix(getComputedStyle(vp).transform).a, nodeHeight: Math.round(node.height), inside: node.top >= pane.top && node.bottom <= pane.bottom, sidebar: sidebar() === id };
  `), (out) => [
    ['longfile-restore: loaded from the address, the camera is on the function at a readable zoom', out.camera?.zoom >= 0.8 && out.camera.inside === true && out.camera.sidebar === true, out.camera],
  ], { hash: '/graph?path=src&node=function%3Asrc%2Flong.js%3Afn119' }],

  ['summary', 'layers', (graph) => driver(`
    await go('#/graph?path=' + encodeURIComponent('layer:app/src') + '&node=' + encodeURIComponent('function:src/main.js:orphan'));
    await until(() => sidebar() === 'function:src/main.js:orphan');
    const side = q('aside[data-xv-panel="sidebar"]');
    out.contradicted = { text: side.textContent, verdict: side.querySelector('[data-xv-summary]')?.getAttribute('data-xv-summary'), layer: side.textContent.includes('Application') };
    await go('#/graph?path=' + encodeURIComponent('layer:app/src') + '&node=' + encodeURIComponent('function:src/main.js:orphan'));
    out.facts = [...side.querySelectorAll('[data-xv-product-fact]')].map((el) => el.getAttribute('data-xv-product-fact') + ':' + el.getAttribute('data-xv-fact-state') + ':' + el.textContent.replace(/\\s+/g, ' ').trim());
    await go('#/graph?path=' + encodeURIComponent('layer:app/src') + '&node=' + encodeURIComponent('file:src/main.js'));
    await until(() => sidebar() === 'file:src/main.js');
    out.file = [...q('aside[data-xv-panel="sidebar"]').querySelectorAll('[data-xv-product-fact]')].map((el) => el.getAttribute('data-xv-product-fact') + ':' + el.textContent.replace(/\\s+/g, ' ').trim());
  `), (out, graph) => [
    ['details: a contradicted summary is not shown and the sidebar says so, with the layer and the other fields', out.contradicted?.verdict === 'contradicted' && /disagrees with the source and is not shown/.test(out.contradicted.text) && !out.contradicted.text.includes(CONTRADICTED_SUMMARY) && out.contradicted.layer, out.contradicted],
    ['details: a function shows its unused state, reason and confidence from the product', out.facts?.some((f) => f.startsWith('unused-code:facts:') && f.includes('Listed as unused') && f.includes('unreferenced') && f.includes('high')), out.facts],
    ['details: a file shows its hotspots counts and score and its doc-map evidence', out.file?.some((f) => f.startsWith('hotspots:') && f.includes('Commits9') && f.includes('Score90')) && out.file.some((f) => f.startsWith('doc-map:') && f.includes('passage')), out.file],
  ]],

  // The detail pages (openspec: changes/viewer-learn, tasks 3.1-3.3): the row panels, links to a row, the path filter, and the numbers
  // of the tiles and charts against the product.
  ['row-panel-unused', 'layers', () => driver(`${ROW_HELPERS}
    await go('#/unused');
    const leaf = 'function:src/util.js:leaf';
    const tr = await until(() => q('tr[data-xv-row="' + leaf + '"]'));
    await sleep(500);
    tr.scrollIntoView({ block: 'center' });
    await sleep(100);
    const box = tr.getBoundingClientRect();
    const restTransform = getComputedStyle(tr).transform;
    await __xvPointer(box.left + 12, box.top + box.height / 2);
    await sleep(350);
    out.hover = { rest: restTransform, hovered: getComputedStyle(tr).transform };
    await __xvPointer(2, 2);
    const before = history.length;
    tr.click();
    const panel = await until(() => rowPanel(leaf));
    await until(() => panel.querySelector('[data-xv-highlight]'));
    out.open = { ...panelState(panel), row: route().params.row ?? null, added: history.length - before, selected: q('tr[data-xv-row-selected]')?.getAttribute('data-xv-row') ?? null, flash: q('tr[data-xv-row-flash]')?.getAttribute('data-xv-row') ?? null };
    // A referrer that is on the list opens its own row; back returns to the first, and back again closes the panel.
    panel.querySelector('[data-xv-referrers] [data-xv-related="function:src/main.js:orphan"]')?.click();
    const orphan = await until(() => rowPanel('function:src/main.js:orphan'));
    out.related = { row: route().params.row ?? null, text: orphan ? orphan.textContent.replace(/\\s+/g, ' ') : null };
    history.back();
    out.back1 = { panel: !!(await until(() => rowPanel(leaf))), row: route().params.row ?? null };
    history.back();
    await until(() => !route().params.row && !rowPanel(leaf));
    await sleep(400);
    out.back2 = { row: route().params.row ?? null, panel: openPanel(), selected: all('tr[data-xv-row-selected]').length };
    // A function whose record has no referrers field: the panel says the product does not provide them.
    await go('#/unused?row=' + encodeURIComponent('function:lib/data.py:unused_loader'));
    const loader = await until(() => rowPanel('function:lib/data.py:unused_loader'));
    out.loader = { text: loader ? loader.querySelector('section[aria-label="Referrers"]')?.textContent ?? null : null, group: loader ? loader.querySelector('[data-xv-group]')?.getAttribute('data-xv-group-others') ?? null : null };
    // Esc closes the panel and takes the row off the address.
    key('Escape', document.body);
    await until(() => !route().params.row);
    await sleep(400);
    out.esc = { row: route().params.row ?? null, panel: openPanel() };
  `), (out, graph, expected) => {
    const leaf = expected.data.unused.unused.find((r) => r.id === 'function:src/util.js:leaf');
    const group = expected.data.unused.groups.find((g) => g.group === leaf.group);
    const others = group.members.filter((id) => id !== leaf.id);
    return [
      ['row-panel-unused: a real pointer over a row lifts it', out.hover?.rest === 'none' && /matrix\(1, 0, 0, 1, 0, -1\)/.test(out.hover.hovered ?? ''), out.hover],
      ['row-panel-unused: a click opens the panel of that row, puts it in the address as one history entry, and marks the row without flashing it', out.open?.key === leaf.id && out.open.row === leaf.id && out.open.added === 1 && out.open.selected === leaf.id && out.open.flash === null, out.open],
      ['row-panel-unused: the panel has the row fields, Locate in graph and Open code', (out.open?.text ?? '').includes(leaf.name) && out.open.text.includes(leaf.reason) && out.open.text.includes(leaf.confidence) && out.open.locate === 'node:' + leaf.id && decodeURIComponent(out.open.openCode ?? '') === '#/code?path=' + leaf.file + '&lines=' + leaf.lineRange.join('-'), out.open],
      ['row-panel-unused: the source preview marks the line range of the row', out.open?.preview === leaf.file && out.open.highlight === leaf.lineRange.join('-') && out.open.marked === leaf.lineRange[1] - leaf.lineRange[0] + 1, out.open],
      ['row-panel-unused: the panel lists the other members of the group and the referrers, as the product records them', JSON.stringify(out.open?.others) === JSON.stringify(others) && JSON.stringify(out.open.referrers) === JSON.stringify(leaf.referrers.map((r) => r.id)), out.open],
      ['row-panel-unused: a referrer opens its own row, which records no referrer', out.related?.row === 'function:src/main.js:orphan' && (out.related.text ?? '').includes('The product records no referrer.'), out.related],
      ['row-panel-unused: back returns to the first row, and back again closes the panel', out.back1?.panel && out.back1.row === leaf.id && out.back2?.row === null && out.back2.panel === null && out.back2.selected === 0, [out.back1, out.back2]],
      ['row-panel-unused: a record without referrers says they are not provided, never an empty list', /not provided by the product/.test(out.loader?.text ?? '') && out.loader.group === '0', out.loader],
      ['row-panel-unused: Esc closes the panel and takes the row off the address', out.esc?.row === null && out.esc.panel === null, out.esc],
    ];
  }],

  ['row-panel-hotspots', 'layers', () => driver(`${ROW_HELPERS}
    await go('#/hotspots');
    out.years = q('[data-xv-years-state]')?.getAttribute('data-xv-years-state') ?? null;
    out.yearsText = q('[data-xv-years-state]')?.textContent ?? null;
    out.yearsChart = all('[data-xv-years] [data-xv-area]').length;
    const tr = await until(() => q('tr[data-xv-row="src/main.js"]'));
    await sleep(500);
    tr.click();
    const panel = await until(() => rowPanel('src/main.js'));
    await until(() => panel.querySelector('[data-xv-preview] .xv-code, [data-xv-preview] p'));
    out.main = { ...panelState(panel), params: route().params, years: panel.querySelector('[data-xv-file-years]')?.getAttribute('data-xv-file-years') ?? null, coChange: panel.querySelector('[data-xv-co-change]')?.getAttribute('data-xv-co-change') ?? null, partners: [...panel.querySelectorAll('[data-xv-co-change] li')].map((li) => li.textContent.replace(/\\s+/g, ' ').trim()) };
    panel.querySelector('[data-xv-co-change] [data-xv-related="src/util.js"]')?.click();
    const util = await until(() => rowPanel('src/util.js'));
    out.util = util ? { params: route().params, years: util.querySelector('[data-xv-file-years]')?.getAttribute('data-xv-file-years') ?? null, yearsText: util.querySelector('[data-xv-file-years]')?.textContent ?? null, coChange: util.querySelector('[data-xv-co-change]')?.getAttribute('data-xv-co-change') ?? null } : null;
    history.back();
    await until(() => rowPanel('src/main.js'));
    history.back();
    await until(() => !route().params.row);
    await sleep(400);
    out.back = { row: route().params.row ?? null, panel: openPanel() };
  `), (out, graph, expected) => {
    const product = expected.data.hotspots;
    const main = product.files.find((f) => f.path === 'src/main.js');
    // The partners of src/main.js, recounted from the pairs: most together first, ties by path.
    const partners = product.pairs.filter((p) => p.a === main.path || p.b === main.path).map((p) => ({ path: p.a === main.path ? p.b : p.a, together: p.together }))
      .sort((x, y) => y.together - x.together || (x.path < y.path ? -1 : 1)).map((p) => p.path + ':' + p.together).join(',');
    const years = Object.keys(main.commitsByYear).sort().map((y) => y + ':' + main.commitsByYear[y]).join(',');
    return [
      ['row-panel-hotspots: with no project-root row the commits per year are said to be not provided, and no chart is drawn', out.years === 'not-provided' && /not provided by the product/.test(out.yearsText ?? '') && out.yearsChart === 0, [out.years, out.yearsText]],
      ['row-panel-hotspots: a file row opens its panel, with view=files and the path in the address', out.main?.key === 'src/main.js' && out.main.params.view === 'files' && out.main.params.row === 'src/main.js', out.main],
      ['row-panel-hotspots: the panel has the numbers, Locate in graph, Open code and the source', out.main?.text.includes('Score' + main.score) && out.main.text.includes('Commits' + main.commits) && out.main.locate === 'file:src/main.js' && decodeURIComponent(out.main.openCode ?? '') === '#/code?path=src/main.js' && out.main.preview === 'src/main.js', out.main],
      ['row-panel-hotspots: the commits per year of the file are its own', out.main?.years === years, [out.main?.years, years]],
      ['row-panel-hotspots: the files changed together with it are the pairs, most together first and ties by path', out.main?.coChange === partners && out.main.partners.length === 3, [out.main?.coChange, partners]],
      ['row-panel-hotspots: a partner opens its own row; a file without commitsByYear says not provided, never 0', out.util?.params.row === 'src/util.js' && out.util.years === 'not-provided' && /not provided by the product/.test(out.util.yearsText ?? '') && out.util.coChange === 'src/main.js:4', out.util],
      ['row-panel-hotspots: back twice closes the panel', out.back?.row === null && out.back.panel === null, out.back],
    ];
  }],

  ['row-link', 'rows', () => driver(`${ROW_HELPERS}
    const last = 'function:gen/u${EXTRA_ROWS - 1}.js:fn';
    const visit = async (hash, key) => {
      await go(hash);
      const panel = await until(() => rowPanel(key));
      const flash = q('tr[data-xv-row-flash]');
      const rect = flash?.getBoundingClientRect();
      return { panel: !!panel, flash: flash?.getAttribute('data-xv-row') ?? null, selected: q('tr[data-xv-row-selected]')?.getAttribute('data-xv-row') ?? null, page: [...document.querySelectorAll('main span')].map((s) => s.textContent).find((t) => /^Page \\d+ of \\d+$/.test(t)) ?? null, inView: !!rect && rect.top >= 0 && rect.bottom <= innerHeight, missing: q('[data-xv-row-missing]')?.textContent ?? null };
    };
    out.unused = await visit('#/unused?row=' + encodeURIComponent(last), last);
    out.hotspots = await visit('#/hotspots?view=files&row=' + encodeURIComponent('lib/data.py'), 'lib/data.py');
    out.docMap = await visit('#/doc-map?row=2', '2');
    const missing = async (hash) => { await go(hash); const note = await until(() => q('[data-xv-row-missing]')); await sleep(300); return { text: note?.textContent ?? null, panel: openPanel() }; };
    out.missingUnused = await missing('#/unused?row=' + encodeURIComponent('function:nowhere.js:none'));
    out.missingHotspots = await missing('#/hotspots?view=files&row=' + encodeURIComponent('nowhere.js'));
    out.missingDocMap = await missing('#/doc-map?row=99');
  `), (out) => {
    const at = (v, key, page) => v?.panel && v.flash === key && v.selected === key && v.page === page && v.inView && v.missing === null;
    return [
      ['row-link: #/unused?row= opens the second page, scrolls to the row, flashes it and opens its panel', at(out.unused, `function:gen/u${EXTRA_ROWS - 1}.js:fn`, 'Page 2 of 2'), out.unused],
      ['row-link: #/hotspots?view=files&row= finds the row on the page it has under the score sort and opens its panel', at(out.hotspots, 'lib/data.py', 'Page 2 of 2'), out.hotspots],
      ['row-link: #/doc-map?row= opens the unit of that number', at(out.docMap, '2', 'Page 1 of 1'), out.docMap],
      ['row-link: a row the page does not have is said so and opens no panel', /has the id "function:nowhere.js:none"/.test(out.missingUnused?.text ?? '') && out.missingUnused.panel === null && /has the path "nowhere.js"/.test(out.missingHotspots?.text ?? '') && out.missingHotspots.panel === null && /number "99"/.test(out.missingDocMap?.text ?? '') && out.missingDocMap.panel === null, [out.missingUnused, out.missingHotspots, out.missingDocMap]],
    ];
  }],

  // The same page loaded from an address that names a row: the panel opens on load.
  ['row-link-reload', 'layers', () => driver(`${ROW_HELPERS}
    const panel = await until(() => rowPanel('src/util.js'));
    out.loaded = { panel: !!panel, view: q('[data-xv-view][aria-pressed="true"]')?.getAttribute('data-xv-view') ?? null, selected: q('tr[data-xv-row-selected]')?.getAttribute('data-xv-row') ?? null };
  `), (out) => [
    ['row-link: a page loaded from #/hotspots?view=files&row= opens on that row with its panel', out.loaded?.panel && out.loaded.view === 'files' && out.loaded.selected === 'src/util.js', out.loaded],
  ], { hash: '/hotspots?view=files&row=src%2Futil.js' }],

  ['prefix-filter', 'rows', () => driver(`${ROW_HELPERS}
    const state = () => ({ prefix: q('[data-xv-prefix]')?.getAttribute('data-xv-prefix') ?? null, count: q('[data-xv-prefix-count]')?.getAttribute('data-xv-prefix-count') ?? null, text: q('[data-xv-prefix]')?.textContent ?? null });
    await go('#/unused?prefix=src');
    await until(() => q('[data-xv-prefix]'));
    out.unused = { ...state(), rows: all('tr[data-xv-row]').map((tr) => tr.getAttribute('data-xv-row')), counted: attr('data-xv-count-unused-prefixed') };
    await go('#/hotspots?view=files&prefix=gen');
    await until(() => q('[data-xv-prefix]'));
    out.hotspots = { ...state(), counted: attr('data-xv-count-files-prefixed') };
    await go('#/hotspots?view=pairs&prefix=lib');
    await until(() => q('[data-xv-prefix]'));
    out.pairs = { ...state(), counted: attr('data-xv-count-pairs-prefixed') };
    await go('#/doc-map?prefix=src');
    await until(() => q('[data-xv-prefix]'));
    out.docMap = { ...state(), counted: attr('data-xv-count-units-prefixed') };
    // The clear button takes the filter off: every row is back.
    await go('#/unused?prefix=src');
    (await until(() => q('[data-xv-prefix-clear]'))).click();
    await until(() => !route().params.prefix);
    await sleep(200);
    out.cleared = { prefix: route().params.prefix ?? null, bar: !!q('[data-xv-prefix]'), counted: attr('data-xv-count-unused-prefixed') };
  `), (out, graph, expected) => {
    const under = (path, dir) => typeof path === 'string' && (path === dir || path.startsWith(dir + '/'));
    const { unused, hotspots, docMap } = expected.data;
    const unusedSrc = unused.unused.filter((r) => under(r.file, 'src'));
    const filesGen = hotspots.files.filter((f) => under(f.path, 'gen')).length;
    const pairsLib = hotspots.pairs.filter((p) => under(p.a, 'lib') || under(p.b, 'lib')).length;
    const unitsSrc = docMap.units.filter((u) => (u.code?.evidence ?? []).some((e) => under(e.file, 'src'))).length;
    return [
      ['prefix-filter: #/unused?prefix=src keeps the rows under src, as an independent count over the product finds them', out.unused?.prefix === 'src' && out.unused.count === String(unusedSrc.length) && out.unused.counted === String(unusedSrc.length) && JSON.stringify([...out.unused.rows].sort()) === JSON.stringify(unusedSrc.map((r) => r.id).sort()) && out.unused.text.includes(`${unusedSrc.length} of ${unused.unused.length}`), [out.unused, unusedSrc.length]],
      ['prefix-filter: the hotspots files under gen', out.hotspots?.count === String(filesGen) && out.hotspots.counted === String(filesGen), [out.hotspots, filesGen]],
      ['prefix-filter: the hotspots pairs with a file under lib', out.pairs?.count === String(pairsLib) && out.pairs.counted === String(pairsLib), [out.pairs, pairsLib]],
      ['prefix-filter: the doc-map units with evidence under src', out.docMap?.count === String(unitsSrc) && out.docMap.counted === String(unitsSrc), [out.docMap, unitsSrc]],
      ['prefix-filter: clear filter takes the prefix off the address and shows every row', out.cleared?.prefix === null && out.cleared.bar === false && out.cleared.counted === String(unused.unused.length), out.cleared],
    ];
  }],

  ['detail-numbers', 'years', () => driver(`${ROW_HELPERS}
    const tiles = () => Object.fromEntries(all('[data-xv-stat]').map((el) => [el.getAttribute('data-xv-stat'), el.querySelector('[data-xv-stat-value]')?.getAttribute('data-xv-stat-value') ?? null]));
    const bars = (label) => { const list = q('ul[aria-label="' + label + '"]'); return list ? [...list.querySelectorAll('[data-xv-bar-row]')].map((li) => li.getAttribute('data-xv-bar-row') + ':' + li.querySelector('.font-mono').textContent) : null; };
    await go('#/unused');
    await until(() => q('[data-xv-stat]'));
    out.unused = { tiles: tiles(), confidence: bars('Unused functions by confidence'), language: bars('Unused functions by language') };
    await go('#/hotspots');
    await until(() => q('[data-xv-years]'));
    out.hotspots = { tiles: tiles(), years: q('[data-xv-years]').getAttribute('data-xv-years'), area: q('[data-xv-years] [data-xv-area]')?.getAttribute('data-xv-area') ?? null, bins: all('[data-xv-bin]').map((el) => el.getAttribute('data-xv-bin-count')), top: bars('Files with the highest scores') };
    await go('#/doc-map');
    await until(() => q('[data-xv-stat]'));
    out.docMap = { tiles: tiles(), lookup: bars('Units by lookup status'), verdict: bars('Pieces of evidence by the verdict of their check') };
    await go('#/products');
    await until(() => q('[data-xv-product-card="hotspots"] [data-xv-product-number]'));
    out.products = Object.fromEntries(all('[data-xv-product-card]').map((card) => [card.getAttribute('data-xv-product-card'), [...card.querySelectorAll('[data-xv-product-number]')].map((n) => n.getAttribute('data-xv-product-number') + ':' + n.getAttribute('data-xv-product-value'))]));
  `), (out, graph, expected) => {
    const { unused, hotspots, docMap, checks } = expected.data;
    const c = unused.counts;
    const root = hotspots.directories.find((d) => d.path === '.');
    const years = Object.keys(root.commitsByYear).sort().map((y) => y + ':' + root.commitsByYear[y]).join(',');
    // Ten even bins from 0 to the highest score, recounted here; the last bin holds the highest.
    const scores = hotspots.files.map((f) => f.score).filter((v) => typeof v === 'number');
    const max = Math.max(...scores);
    const bins = Array.from({ length: 10 }, () => 0);
    for (const v of scores) bins[Math.min(9, Math.floor((v / max) * 10))] += 1;
    const top = [...hotspots.files].sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1)).slice(0, 10).map((f) => f.path + ':' + f.score);
    const verdicts = { does: 0, not: 0, none: 0 };
    for (const check of checks.checks) verdicts[check.verdict] += 1;
    const evidence = docMap.units.reduce((n, u) => n + (u.code?.evidence?.length ?? 0), 0);
    const d = docMap.counts;
    const h = hotspots.counts;
    return [
      ['detail-numbers: the Unused tiles are the product counts', out.unused?.tiles.Unused === String(c.unused) && out.unused.tiles.Unreferenced === String(c.unreferenced) && out.unused.tiles['Only reachable from unused'] === String(c.onlyReachableFromUnused) && out.unused.tiles['Test only'] === String(c.testOnly), out.unused?.tiles],
      ['detail-numbers: the Unused bars are counts.byConfidence and counts.byLanguage', JSON.stringify(out.unused?.confidence) === JSON.stringify(['high', 'medium', 'low'].map((k) => k + ':' + c.byConfidence[k])) && JSON.stringify(out.unused.language) === JSON.stringify(Object.keys(c.byLanguage).sort().map((k) => k + ':' + c.byLanguage[k].unused)), out.unused],
      ['detail-numbers: the Hotspots tiles are the product counts', out.hotspots?.tiles['Files with history'] === String(h.filesWithHistory) && out.hotspots.tiles['Files without history'] === String(h.filesWithoutHistory) && out.hotspots.tiles['Binary files'] === String(h.binaryFiles) && out.hotspots.tiles['Lineage conflicts'] === String(h.filesWithLineageConflicts), out.hotspots?.tiles],
      ["detail-numbers: the commits per year are the project-root row's", out.hotspots?.years === years && out.hotspots.area === String(Object.keys(root.commitsByYear).length), [out.hotspots?.years, years]],
      ['detail-numbers: the score histogram is the files binned by score', JSON.stringify(out.hotspots?.bins) === JSON.stringify(bins.map(String)), [out.hotspots?.bins, bins]],
      ['detail-numbers: the top 10 bars are the ten highest scores', JSON.stringify(out.hotspots?.top) === JSON.stringify(top), [out.hotspots?.top, top]],
      ['detail-numbers: the Doc map tiles are the product counts', out.docMap?.tiles.Documents === String(d.files) && out.docMap.tiles.Units === String(d.units) && out.docMap.tiles['Code found'] === String(d.found) && out.docMap.tiles['No code found'] === String(d.notFound), out.docMap?.tiles],
      ['detail-numbers: the lookup bars are counts.found, notFound and notChecked; the verdict bars count the checks', JSON.stringify(out.docMap?.lookup) === JSON.stringify([`found:${d.found}`, `not-found:${d.notFound}`, `not-checked:${d.notChecked}`]) && JSON.stringify(out.docMap.verdict) === JSON.stringify([`does:${verdicts.does}`, `not:${verdicts.not}`, `none:${verdicts.none}`, `not checked:${evidence - checks.checks.length}`]), out.docMap],
      ['detail-numbers: the product cards show the product numbers', JSON.stringify(out.products?.['unused-code']) === JSON.stringify([`Unused:${c.unused}`, `Test only:${c.testOnly}`]) && JSON.stringify(out.products['doc-map']) === JSON.stringify([`Units:${d.units}`, `Code found:${d.found}`]) && JSON.stringify(out.products.hotspots) === JSON.stringify([`Files:${hotspots.files.length}`, `Pairs:${hotspots.pairs.length}`]), out.products],
    ];
  }],

  ['reduced-motion', 'layers', () => driver(`${ROW_HELPERS}
    const running = () => document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName || a.constructor.name);
    out.pages = {};
    for (const hash of ['#/unused', '#/hotspots', '#/doc-map', '#/products', '#/reports']) {
      await go(hash);
      await sleep(80);
      out.pages[hash] = { running: running(), rows: all('tr[data-xv-row]').filter((tr) => getComputedStyle(tr).animationName !== 'none').length };
    }
    await go('#/unused');
    q('tr[data-xv-row="function:src/main.js:orphan"]').click();
    await until(() => rowPanel('function:src/main.js:orphan'));
    await sleep(40);
    out.panel = running();
  `), (out) => [
    ['reduced-motion: no animation runs on the detail pages, the rows do not stagger, and the row panel opens at once', out.pages && Object.values(out.pages).every((p) => p.running.length === 0 && p.rows === 0) && out.panel?.length === 0, out],
  ], { reducedMotion: true }],
  // The modes (openspec: changes/viewer-learn, task 4.1). The same places in Deep dive and in Overview: Overview draws no function or
  // class (every file that can be opened is opened, so a row that leaked would be drawn), and every card and count is Deep dive's.
  ['overview-mode', 'classes', (graph, expected) => driver(`
    const [l0, l1, l2] = ${JSON.stringify(graph.levels)};
    const at = (path) => until(() => level() === path + '#');
    const cards = () => all('[data-xv-entry]').filter((el) => !['child', 'more'].includes(el.getAttribute('data-xv-entry'))).map((el) => el.getAttribute('aria-label')).sort();
    const place = async () => {
      await sleep(150);
      const toggles = all('[data-xv-entry="file"] button[aria-expanded="false"]');
      for (const t of toggles) t.click();
      if (toggles.length > 0) { await until(() => q('[data-xv-entry="child"]'), 80); await sleep(250); }
      const rows = all('[data-xv-entry="child"]').map((el) => el.getAttribute('data-xv-type'));
      return {
        level: level(), mode: route().params.mode ?? null, cards: cards(), toggles: toggles.length, rows,
        hidden: rows.filter((t) => t === 'function' || t === 'class').length,
        drawnHidden: all('.react-flow__node [data-xv-type="function"], .react-flow__node [data-xv-type="class"]').length,
        counts: [attr('data-xv-count-graph-level-nodes'), attr('data-xv-count-graph-level-files'), attr('data-xv-count-graph-folded')],
        note: q('[data-xv-mode-note]')?.textContent ?? null,
      };
    };
    for (const mode of ['deep', 'overview']) {
      const seen = [];
      await go('#/graph?mode=' + mode); await at(l0.path);
      seen.push(await place());
      q('[data-xv-label="' + l0.open + '"]').click(); await at(l1.path);
      seen.push(await place());
      q('[data-xv-label="' + l1.open + '"]').click(); await at(l2.path);
      seen.push(await place());
      await go('#/graph?path=' + encodeURIComponent(${JSON.stringify(graph.interaction.search[1].level)}) + '&mode=' + mode);
      seen.push(await place());
      out[mode] = seen;
      // The focus of a file: the same neighbour count in either mode, and in Overview the functions and classes among them are not drawn.
      await go('#/graph?path=' + encodeURIComponent(${JSON.stringify(graph.interaction.search[1].level)}) + '&node=' + encodeURIComponent('file:src/main.js') + '&focus=1&mode=' + mode);
      await until(() => attr('data-xv-count-focus-nodes') !== null); await sleep(150);
      out[mode + 'Focus'] = { nodes: attr('data-xv-count-focus-nodes'), drawn: all('[data-xv-entry="focus-neighbour"]').map((el) => el.getAttribute('aria-label').split(' ')[0]), undrawn: q('[data-xv-mode-note]')?.getAttribute('data-xv-undrawn') ?? null };
    }
  `), (out, graph, expected) => {
    const places = ['top', 'drilled once', 'drilled twice', expected.classes.level];
    const deep = out.deep ?? [];
    const overview = out.overview ?? [];
    return [
      ['overview-mode: Deep dive draws functions or classes in the files it opens (the control)', deep.slice(1).every((p) => p.hidden > 0) && deep.every((p) => p.note === null), deep],
      ...places.map((name, i) => [`overview-mode: at ${name}, Overview draws no function or class and says so on the graph`, overview[i]?.hidden === 0 && overview[i].drawnHidden === 0 && /function and class nodes are hidden/.test(overview[i].note ?? '') && overview[i].mode === 'overview', overview[i]]),
      ...places.map((name, i) => [`overview-mode: at ${name}, every card and count is Deep dive's`, overview[i] && JSON.stringify(overview[i].cards) === JSON.stringify(deep[i]?.cards) && JSON.stringify(overview[i].counts) === JSON.stringify(deep[i]?.counts) && overview[i].level === deep[i].level, [overview[i], deep[i]]]),
      ['overview-mode: a file that owns only functions cannot be opened in Overview, and one that also owns a variable opens to the variable only', overview[1]?.toggles === 0 && overview[2]?.toggles === 0 && JSON.stringify(overview[3]?.rows) === JSON.stringify(['variable']) && deep[3]?.rows.length > 1, overview],
      ['overview-mode: a focus counts the same neighbours in Overview, draws none that is a function or class, and says how many it leaves undrawn', out.overviewFocus?.nodes === out.deepFocus?.nodes && Number(out.deepFocus.nodes) > 0 && out.overviewFocus.drawn.every((t) => t !== 'function' && t !== 'class') && Number(out.overviewFocus.undrawn) === out.deepFocus.drawn.filter((t) => t === 'function' || t === 'class').length && Number(out.overviewFocus.undrawn) > 0, [out.overviewFocus, out.deepFocus]],
      ['overview-mode: the mode stays in the address through the drill-down', overview.every((p) => p.mode === 'overview') && deep.every((p) => p.mode === 'deep'), [overview.map((p) => p.mode), deep.map((p) => p.mode)]],
    ];
  }],

  // A search in Overview that finds a class or a function switches to Deep dive, locates and selects it, and the sidebar says so; a file
  // found in Overview, and anything found in Deep dive, changes no mode.
  ['mode-search-switch', 'classes', (graph, expected) => driver(`
    const c = ${JSON.stringify(expected.classes)};
    const input = q('[data-xv-search]');
    const find = async (query, id) => {
      input.focus(); setValue(input, query);
      const hit = await until(() => q('[data-xv-hit="' + id + '"]'));
      hit && hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await until(() => route().params.node === id && sidebar() === id);
      await sleep(250);
      return {
        found: !!hit, mode: route().params.mode ?? null, level: level(), marks: all('.xv-selected').length, drawn: !!q('.react-flow__node [data-xv-node="' + id + '"]'),
        note: q('aside[data-xv-panel="sidebar"] [data-xv-mode-switched]')?.getAttribute('data-xv-mode-switched') ?? null,
        noteText: q('aside[data-xv-panel="sidebar"] [data-xv-mode-switched]')?.textContent ?? null,
        pressed: q('[data-xv-modes] [aria-pressed="true"]')?.getAttribute('data-xv-mode') ?? null,
        graphNote: !!q('[data-xv-mode-note]'),
      };
    };
    await go('#/graph?mode=overview');
    out.cls = await find(c.className, c.classId);
    // The sidebar leaves with its exit animation: wait for it to go (the idle sidebar starts closed at 1280 px).
    history.back(); await until(() => !route().params.node && !q('aside[data-xv-panel="sidebar"]')); await sleep(100);
    out.back = { mode: route().params.mode ?? null, note: !!q('[data-xv-mode-switched]'), pressed: q('[data-xv-modes] [aria-pressed="true"]')?.getAttribute('data-xv-mode') ?? null };
    out.fn = await find('helper', 'function:src/util.js:helper');
    await go('#/graph?mode=overview');
    out.file = await find('util.js', 'file:src/util.js');
    await go('#/graph?mode=deep');
    out.deep = await find('helper', 'function:src/util.js:helper');
  `), (out, graph, expected) => [
    ['mode-search-switch: a class found in Overview switches to Deep dive, is drawn, selected and in the sidebar', out.cls?.found && out.cls.mode === 'deep' && out.cls.pressed === 'deep' && out.cls.drawn && out.cls.marks === 1 && out.cls.level === `${expected.classes.level}#` && !out.cls.graphNote, out.cls],
    ['mode-search-switch: the sidebar says the mode was switched, from which and why', out.cls?.note === 'overview>deep' && /Mode switched from Overview to Deep dive/.test(out.cls.noteText ?? '') && /class/.test(out.cls.noteText), out.cls],
    ['mode-search-switch: back returns to Overview, with no note', out.back?.mode === 'overview' && out.back.pressed === 'overview' && out.back.note === false, out.back],
    ['mode-search-switch: a function found in Overview switches too', out.fn?.mode === 'deep' && out.fn.note === 'overview>deep' && out.fn.drawn, out.fn],
    ['mode-search-switch: a file found in Overview, and a function found in Deep dive, change no mode and carry no note', out.file?.mode === 'overview' && out.file.note === null && out.file.marks === 1 && out.deep?.mode === 'deep' && out.deep.note === null, [out.file, out.deep]],
  ]],

  // Domain | Structural (task 4.2): each side keeps its level and its selection, and the switch carries the mode.
  ['domain-structural', 'layers', (graph, expected) => driver(`
    const [l0, l1] = ${JSON.stringify(graph.levels)};
    const d = ${JSON.stringify(expected.domain)};
    const at = (path) => until(() => level() === path + '#');
    const dlevel = () => attr('data-xv-domain-level');
    const sw = (view) => q('[data-xv-switch="' + view + '"]');
    await go('#/graph?mode=deep'); await at(l0.path);
    q('[data-xv-label="' + l0.open + '"]').click(); await at(l1.path);
    const file = q('[data-xv-entry="file"]'); const fileId = file.getAttribute('data-xv-node');
    file.click(); await until(() => sidebar() === fileId);
    out.graph = { hash: location.hash, pressed: [sw('graph')?.getAttribute('aria-pressed'), sw('domain')?.getAttribute('aria-pressed')], nav: all('nav[aria-label="Pages"] [data-xv-nav]').map((a) => a.getAttribute('data-xv-nav')) };
    sw('domain').click();
    await until(() => route().page === 'domain' && dlevel() === 'top'); await sleep(200);
    out.domainTop = { hash: location.hash, pressed: sw('domain')?.getAttribute('aria-pressed') };
    q('[data-xv-domain-entry="domain"][data-xv-node="domain:app"]').click();
    await until(() => dlevel() === d.domain.level); await sleep(200);
    q('[data-xv-domain-entry="flow"][data-xv-node="' + d.flow.id + '"]').click();
    await until(() => dlevel() === d.flow.level); await sleep(200);
    q('[data-xv-domain-entry="step"][data-xv-node="' + d.step.id + '"]').click();
    await until(() => sidebar() === d.step.id);
    out.domain = { hash: location.hash, level: dlevel() };
    // Short waits from here: on a page that loses the place each runs out, and the checks still say which step failed.
    sw('graph').click();
    await until(() => route().page === 'graph', 80); await until(() => level() === l1.path + '#', 80); await until(() => sidebar() === fileId, 80);
    out.back = { hash: location.hash, level: level(), node: route().params.node ?? null, sidebar: sidebar(), marks: all('.xv-selected').length };
    sw('domain').click();
    await until(() => route().page === 'domain' && dlevel() === d.flow.level, 80); await until(() => sidebar() === d.step.id, 80);
    out.again = { hash: location.hash, level: dlevel(), sidebar: sidebar() };
    history.back(); await until(() => route().page === 'graph', 80); await until(() => level() === l1.path + '#', 80);
    out.history = { hash: location.hash };
  `), (out, graph, expected) => {
    const [, l1] = graph.levels;
    const d = expected.domain;
    return [
      ['domain-structural: the switch is above the graph with Structural pressed, and the navigation keeps Graph and Domain', JSON.stringify(out.graph?.pressed) === '["true","false"]' && out.graph.nav.includes('graph') && out.graph.nav.includes('domain'), out.graph],
      ['domain-structural: Domain opens the domain graph at its top level the first time, in the same mode', out.domainTop?.pressed === 'true' && /^#\/domain/.test(out.domainTop.hash) && /mode=deep/.test(out.domainTop.hash), out.domainTop],
      ['domain-structural: Structural returns to the same level with the same selection', out.back?.hash === out.graph?.hash && out.back.level === `${l1.path}#` && out.back.sidebar === out.back.node && out.back.marks === 1, [out.graph, out.back]],
      ['domain-structural: Domain returns to the same flow with the same step selected', out.again?.hash === out.domain?.hash && out.again.level === d.flow.level && out.again.sidebar === d.step.id, [out.domain, out.again]],
      ['domain-structural: each switch is a step in the history', out.history?.hash === out.graph?.hash, out.history],
    ];
  }],
  ['domain-structural-notrun', 'domain-notrun', () => driver(`
    await go('#/graph');
    await sleep(300);
    out.switches = all('[data-xv-switch]').length;
  `), (out) => [
    ['domain-structural: a page without a readable domain graph shows no Domain | Structural switch', out.switches === 0, out.switches],
  ]],

  // The project overview (task 4.3): every number equals the fixture's, counted here from the packed files on their own.
  ['project-overview', 'classes', (graph, expected) => driver(`
    const side = () => q('aside[data-xv-panel="sidebar"]');
    // At 1440 px the idle sidebar is open from the start.
    out.atStart = { idle: side()?.querySelector('[data-xv-idle]')?.getAttribute('data-xv-idle') ?? null, button: !!q('[data-xv-action="show-idle"]') };
    await go('#/graph?mode=deep');
    await until(() => side()?.querySelector('[data-xv-project-overview]'));
    await until(() => q('[data-xv-highlight="unused-total"]') && q('[data-xv-highlight="hot-file"]'));
    await sleep(150);
    const section = (name) => q('[data-xv-overview="' + name + '"]');
    const bars = (name) => Object.fromEntries([...section(name).querySelectorAll('[data-xv-bar-row]')].map((li) => [li.getAttribute('data-xv-bar-row'), Number(li.lastElementChild.lastElementChild.textContent.replace(/,/g, ''))]).sort(([a], [b]) => (a < b ? -1 : 1)));
    out.view = {
      idle: side().querySelector('[data-xv-idle]')?.getAttribute('data-xv-idle'), title: side().getAttribute('aria-label'),
      name: q('[data-xv-overview-name]')?.textContent ?? null, description: q('[data-xv-overview-description]')?.textContent ?? null,
      nameFont: getComputedStyle(q('[data-xv-overview-name]')).fontFamily,
      tiles: Object.fromEntries(all('[data-xv-overview="tiles"] [data-xv-stat]').map((el) => [el.getAttribute('data-xv-stat'), Number(el.querySelector('[data-xv-stat-value]').getAttribute('data-xv-stat-value'))])),
      stack: section('stack').textContent,
      types: bars('types'), complexity: bars('complexity'), complexityNote: section('complexity').textContent,
      connected: all('[data-xv-top-node]').map((el) => [el.getAttribute('data-xv-top-node'), Number(el.getAttribute('data-xv-degree'))]),
      layers: all('[data-xv-layer]').map((el) => [el.textContent.replace(/\\d+ files?$/, '').trim(), Number(el.getAttribute('data-xv-files'))]).sort(),
      unused: Number(q('[data-xv-highlight="unused-total"]').getAttribute('data-xv-value')), unusedHref: q('[data-xv-highlight="unused-total"]').getAttribute('href'), byConfidence: bars('unused'),
      hot: all('[data-xv-highlight="hot-file"]').map((a) => [a.getAttribute('data-xv-path'), a.getAttribute('href')]),
      tour: !!q('[data-xv-action="start-tour"]'),
    };
    // A top node selects it; Esc gives the overview back; a layer opens its level.
    const top = q('[data-xv-top-node]'); const topId = top.getAttribute('data-xv-top-node');
    top.click(); await until(() => sidebar() === topId);
    out.selected = { node: route().params.node ?? null, sidebar: sidebar() };
    history.back(); await until(() => side()?.querySelector('[data-xv-project-overview]'));
    const layer = q('[data-xv-layer]'); const files = layer.getAttribute('data-xv-files');
    layer.click(); await until(() => level() !== '#'); await settle();
    out.layer = { level: level(), files: attr('data-xv-count-graph-level-files'), expected: files };
    // Start tour switches to Learn: the sidebar lists the tour's steps.
    await go('#/graph?mode=overview');
    await until(() => q('[data-xv-action="start-tour"]'));
    q('[data-xv-action="start-tour"]').click();
    await until(() => q('[data-xv-tour-state]'));
    await until(() => q('[data-xv-tour-step]'));
    out.learn = { mode: route().params.mode ?? null, state: q('[data-xv-tour-state]').getAttribute('data-xv-tour-state'), steps: q('[data-xv-tour-steps]')?.getAttribute('data-xv-tour-steps'), titles: all('[data-xv-tour-step]').map((el) => el.lastElementChild.textContent), pressed: q('[data-xv-modes] [aria-pressed="true"]')?.getAttribute('data-xv-mode') ?? null };
    // A hotspot opens the Files view with its row's panel.
    await go('#/graph?mode=deep');
    const hot = await until(() => q('[data-xv-highlight="hot-file"]'));
    const path = hot.getAttribute('data-xv-path');
    hot.click();
    const panel = await until(() => q('aside[data-xv-panel="sidebar"] [data-xv-row-panel="' + path + '"]'));
    out.hotLink = { path, hash: location.hash, panel: !!panel, selected: q('tr[data-xv-row-selected]')?.getAttribute('data-xv-row') ?? null };
  `), (out, graph, expected) => {
    const e = expected.overview;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const v = out.view ?? {};
    return [
      ['project-overview: at 1440 px the idle sidebar is open from the start, in Learn', out.atStart?.idle === 'learn' && out.atStart.button === false, out.atStart],
      ['project-overview: with nothing selected in Deep dive the sidebar is the project overview, with the name in the heading font and the domain graph\'s description', v.idle === 'deep' && v.name === e.name && v.description === e.description && /^"?DM Serif Display"?,/.test(v.nameFont ?? ''), v],
      ['project-overview: the tiles are the node and edge records, the layers and the file nodes', same(v.tiles, e.tiles), [v.tiles, e.tiles]],
      ['project-overview: the languages and frameworks are the graph header\'s', e.languages.every((l) => v.stack?.includes(l)) && /No framework recorded/.test(v.stack ?? ''), v.stack],
      ['project-overview: the node types and the complexity counts are the fixture\'s, with "not recorded" for nodes without complexity, and say which field', same(v.types, e.types) && same(v.complexity, e.complexity) && /complexity field/.test(v.complexityNote ?? ''), [v.types, e.types, v.complexity, e.complexity]],
      ['project-overview: the five most connected nodes, by edge records in and out, ties by name then id', same(v.connected, e.connected), [v.connected, e.connected]],
      ['project-overview: the layers with their file counts', same(v.layers, e.layers), [v.layers, e.layers]],
      ['project-overview: the unused total and its counts by confidence, linking to the Unused page', v.unused === e.unused.total && same(v.byConfidence, e.unused.byConfidence) && v.unusedHref === '#/unused', [v.unused, v.byConfidence, e.unused]],
      ['project-overview: the three hottest files, each linking to its row', same(v.hot, e.hot), [v.hot, e.hot]],
      ['project-overview: a top node selects it, and back gives the overview back', out.selected?.node === e.connected[0][0] && out.selected.sidebar === e.connected[0][0], out.selected],
      ['project-overview: a layer opens its level, with the file count it showed', out.layer?.files === out.layer?.expected && out.layer.level !== '#', out.layer],
      ['project-overview: Start tour switches to Learn and the sidebar lists the tour\'s steps', v.tour && out.learn?.mode === null && out.learn.pressed === 'learn' && out.learn.state === 'included' && out.learn.steps === String(e.tour.length) && same(out.learn.titles, e.tour), out.learn],
      ['project-overview: a hotspot link opens the Files view with that row\'s panel', out.hotLink?.path === e.hot[0][0] && out.hotLink.panel && out.hotLink.selected === out.hotLink.path && out.hotLink.hash === e.hot[0][1], out.hotLink],
    ];
  }, { width: 1440 }],

  // Learn with nothing selected: the tour product's state, for a tour never made and one made from other facts.
  ['learn-notrun', 'directories', () => driver(`
    await go('#/graph');
    // At 1280 px the idle sidebar starts closed; the button on the graph opens it.
    await sleep(200);
    const show = q('[data-xv-action="show-idle"]');
    out.atStart = { sidebar: !!q('aside[data-xv-panel="sidebar"]'), button: show?.textContent ?? null };
    show?.click();
    const state = await until(() => q('aside[data-xv-panel="sidebar"] [data-xv-tour-state]'));
    out.learn = { idle: q('[data-xv-idle]')?.getAttribute('data-xv-idle'), state: state?.getAttribute('data-xv-tour-state'), command: q('[data-xv-tour-command]')?.textContent ?? null, text: state?.textContent ?? '' };
    await go('#/graph?mode=overview');
    await until(() => q('[data-xv-project-overview]'));
    out.overview = { tour: !!q('[data-xv-action="start-tour"]'), description: !!q('[data-xv-overview-description]'), highlights: all('[data-xv-highlight-state]').map((el) => el.getAttribute('data-xv-highlight-state')) };
  `), (out) => [
    ['learn-notrun: at 1280 px the idle sidebar starts closed, and the graph has a button that opens it', out.atStart?.sidebar === false && out.atStart.button === 'Tour', out.atStart],
    ['learn-notrun: Learn is the default and its idle sidebar says the tour was not run, with the command', out.learn?.idle === 'learn' && out.learn.state === 'not-run' && out.learn.command === '/excavator-tour' && /Not run/.test(out.learn.text) && !/not built/i.test(out.learn.text), out.learn],
    ['learn-notrun: the overview has no Start tour button and no description when there is no tour or domain graph', out.overview?.tour === false && out.overview.description === false, out.overview],
  ]],
  ['learn-digest', 'tour-digest', (graph, expected) => driver(`
    await go('#/graph');
    (await until(() => q('[data-xv-action="show-idle"]')))?.click();
    const state = await until(() => q('aside[data-xv-panel="sidebar"] [data-xv-tour-state="different-revision"]'));
    out.learn = { tour: q('[data-xv-tour-digest="tour"]')?.textContent ?? null, graph: q('[data-xv-tour-digest="graph"]')?.textContent ?? null, steps: all('[data-xv-tour-step]').length, found: !!state };
  `), (out, graph, expected) => [
    ['learn-digest: a tour made from other facts says so, with both digests and no steps', out.learn?.found && out.learn.tour === expected.tourDigest && out.learn.graph === expected.tour.factDigest && out.learn.steps === 0, out.learn],
  ]],
  // Reduced motion on the graph page's idle sidebar: the overview's tiles and bars and the tour's state are drawn at once.
  ['reduced-motion-idle', 'classes', () => driver(`
    const running = () => document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName || a.constructor.name);
    out.views = {};
    for (const hash of ['#/graph?mode=deep', '#/graph?mode=overview', '#/graph', '#/domain?mode=deep']) {
      await go(hash);
      await until(() => q('[data-xv-project-overview] [data-xv-highlight="hot-file"]') || q('[data-xv-tour-step]'));
      await sleep(80);
      out.views[hash] = { running: running(), idle: q('[data-xv-idle]')?.getAttribute('data-xv-idle') ?? null };
    }
  `), (out) => [
    ['reduced-motion-idle: no animation runs in the idle sidebar of either graph page, in any mode', out.views && Object.values(out.views).every((v) => v.running.length === 0 && v.idle !== null) && Object.keys(out.views).length === 4, out.views],
  ], { reducedMotion: true, width: 1440 }],
  ...[768, 1024, 1280].map(topBarScenario),
  ...[1440, 1920, 768].map(pageColumnScenario),
];

/**
 * The page column at `width`, on Products and Unused: from 1440 px its gaps to the main area's content box, left and right, differ
 * by at most 1 px (the column is centred); at 768 px nothing scrolls sideways, neither the page nor the main area.
 */
function pageColumnScenario(width) {
  return [`page-column-${width}`, 'layers', () => driver(`
    out.pages = {};
    for (const hash of ['#/products', '#/unused']) {
      await go(hash);
      const column = await until(() => q('[data-xv-page-column]'));
      await sleep(150);
      const main = q('#xv-main');
      const box = main.getBoundingClientRect();
      const cs = getComputedStyle(main);
      const inner = { left: box.left + main.clientLeft + parseFloat(cs.paddingLeft), right: box.left + main.clientLeft + main.clientWidth - parseFloat(cs.paddingRight) };
      const col = column.getBoundingClientRect();
      out.pages[hash] = { left: col.left - inner.left, right: inner.right - col.right, width: col.width, pageScroll: document.documentElement.scrollWidth > innerWidth, mainScroll: main.scrollWidth > main.clientWidth };
    }
  `), (out) => Object.entries(out.pages ?? { none: null }).map(([hash, p]) => (width >= 1440
    ? [`${width}: on ${hash} the page column's left and right gaps to the main area differ by at most 1 px`, p && Math.abs(p.left - p.right) <= 1 && p.left >= 0 && p.right >= 0, p]
    : [`${width}: on ${hash} neither the page nor the main area scrolls sideways`, p && p.pageScroll === false && p.mainScroll === false, p])), { width }];
}

/**
 * The top bar at `width`: every control keeps its size (nothing overflows its box and no text wraps inside it), no two of them overlap, the
 * search box is at least 160 px wide, and the overlay switches still work (behind the "Overlays" menu below 1280 px).
 */
function topBarScenario(width) {
  return [`topbar-${width}`, 'directories', () => driver(`
    await go('#/graph');
    await until(() => q('header [data-xv-search]') && q('header [data-xv-filter-hidden]'));
    await sleep(200);
    const header = q('header');
    const boxes = [...header.children].map((el) => ({ what: (el.getAttribute('data-xv-search') !== null || el.querySelector('[data-xv-search]')) ? 'search' : el.textContent.trim().slice(0, 24) || el.getAttribute('aria-label'), rect: el.getBoundingClientRect() })).filter((b) => b.rect.width > 0);
    const apart = (a, b) => a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5;
    const overlaps = [];
    boxes.forEach((a, i) => boxes.forEach((b, j) => { if (j > i && !apart(a.rect, b.rect)) overlaps.push([a.what, b.what]); }));
    // The project name is text that ends in an ellipsis when it is long, with the whole name in its title: it is boxed, not measured for overflow.
    const controls = [...header.querySelectorAll('button, input, [data-xv-revision], header > span:not([data-xv-project])')].filter((el) => el.getBoundingClientRect().width > 0);
    const oneLine = (el) => { const range = document.createRange(); range.selectNodeContents(el); const rects = [...range.getClientRects()].filter((r) => r.width > 0); if (rects.length === 0) return true; const tops = rects.map((r) => r.top); return Math.max(...tops) - Math.min(...tops) < Math.min(...rects.map((r) => r.height)) * 0.7; };
    out.bar = {
      width: innerWidth, overlaps, search: Math.round(q('[data-xv-search]').getBoundingClientRect().width),
      overflowing: controls.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent.trim().slice(0, 24) || el.tagName),
      wrapped: controls.filter((el) => !oneLine(el)).map((el) => el.textContent.trim().slice(0, 24) || el.tagName),
      pageScroll: document.documentElement.scrollWidth > innerWidth,
      compact: !!q('[data-xv-overlay-menu]'),
      names: boxes.map((b) => b.what),
    };
    // The placeholder must fit the box whole (an input does not report a clipped placeholder in scrollWidth), with and without the Overlays badge.
    const fits = () => { const input = q('[data-xv-search]'); const cs = getComputedStyle(input); const ctx = document.createElement('canvas').getContext('2d'); ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily; return Math.ceil(ctx.measureText(input.placeholder).width) <= input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); };
    out.fit = { plain: fits(), placeholder: q('[data-xv-search]').placeholder };
    const menu = q('[data-xv-overlay-menu]');
    if (menu) { menu.click(); await until(() => q('[data-xv-overlay="hotspots"]')); }
    const toggle = () => q('[data-xv-overlay="hotspots"]');
    toggle().click();
    await until(() => toggle().getAttribute('aria-pressed') === 'true');
    out.fit.badged = fits();
    out.on = { pressed: toggle().getAttribute('aria-pressed'), marks: attr('data-xv-overlays') ?? q('[data-xv-graph]')?.getAttribute('data-xv-overlays'), hash: location.hash };
    toggle().click();
    await until(() => toggle().getAttribute('aria-pressed') === 'false');
    out.off = { pressed: toggle().getAttribute('aria-pressed'), hash: location.hash };
    if (menu) { key('Escape'); await until(() => !q('[data-xv-overlay="hotspots"]')); out.closed = !q('[data-xv-overlay="hotspots"]'); }
    // The mode switch: three modes, Learn pressed by default; a change is kept in the address and adds no history entry.
    const modes = all('[data-xv-modes] [data-xv-mode]');
    out.modes = { names: modes.map((b) => b.getAttribute('aria-label')), pressed: q('[data-xv-modes] [aria-pressed="true"]')?.getAttribute('data-xv-mode') ?? null };
    const entries = history.length;
    q('[data-xv-mode="overview"]').click();
    await until(() => route().params.mode === 'overview' && q('[data-xv-mode-note]'));
    out.modes.after = { mode: route().params.mode ?? null, pressed: q('[data-xv-modes] [aria-pressed="true"]')?.getAttribute('data-xv-mode') ?? null, added: history.length - entries, note: !!q('[data-xv-mode-note]') };
  `), (out) => [
    [`${width}: no two controls of the top bar overlap`, out.bar?.overlaps.length === 0, out.bar],
    [`${width}: no control overflows its box or wraps its text, and the page does not scroll sideways`, out.bar?.overflowing.length === 0 && out.bar.wrapped.length === 0 && out.bar.pageScroll === false, out.bar],
    [`${width}: the search box is at least 160 px wide`, out.bar?.search >= 160, out.bar],
    [`${width}: the overlays are ${width < 1280 ? 'behind one menu' : 'switches in the bar'}`, out.bar?.compact === (width < 1280) && (width >= 1280 || out.closed === true), [out.bar?.compact, out.closed]],
    [`${width}: the search placeholder fits the box whole, with and without the Overlays badge`, out.fit?.plain === true && out.fit.badged === true, out.fit],
    [`${width}: the Hotspots overlay switches on and off`, out.on?.pressed === 'true' && /overlay=hotspots/.test(out.on.hash) && out.off?.pressed === 'false' && !/overlay=/.test(out.off.hash), [out.on, out.off]],
    [`${width}: the mode switch has Overview, Learn and Deep dive with Learn pressed, and a click sets the mode in the address without a history entry`, JSON.stringify(out.modes?.names) === '["Overview","Learn","Deep dive"]' && out.modes.pressed === 'learn' && out.modes.after?.mode === 'overview' && out.modes.after.pressed === 'overview' && out.modes.after.added === 0 && out.modes.after.note, out.modes],
  ], { width }];
}

/** Page-side helpers of the edge-label scenarios: the real pointer's whereabouts and a report of the labels visible. `SEL` names the labels. */
const LABEL_PROBE = `
  const vis = (r) => r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
  const apart = (a, b) => a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5;
  const away = async () => { await __xvPointer(innerWidth / 2, 20); await sleep(150); };
  // A point on an edge's line that the pointer reaches: the topmost element there is that edge.
  const edgePoint = (edge) => {
    const path = edge.querySelector('.react-flow__edge-path');
    if (!path) return null;
    const length = path.getTotalLength();
    const m = path.getScreenCTM();
    for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
      const p = path.getPointAtLength(length * t);
      const x = m.a * p.x + m.c * p.y + m.e;
      const y = m.b * p.x + m.d * p.y + m.f;
      if (x < 5 || y < 70 || x > innerWidth - 5 || y > innerHeight - 5) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && hit.closest('.react-flow__edge') === edge) return { x, y };
    }
    return null;
  };
  // Is the label clear of the cards: at its middle and near its four corners no card is the topmost element? (A label that lets the pointer through
  // is probed with it on; the sidebar or the legend over a label is a different matter, not a card on it.)
  const onTop = (el) => {
    const r = el.getBoundingClientRect();
    const through = getComputedStyle(el).pointerEvents === 'none';
    if (through) el.style.pointerEvents = 'auto';
    const points = [[0.5, 0.5], [0.1, 0.25], [0.9, 0.25], [0.1, 0.75], [0.9, 0.75]].map(([fx, fy]) => [r.left + r.width * fx, r.top + r.height * fy]).filter(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight);
    const ok = points.length > 0 && points.every(([x, y]) => { const hit = document.elementFromPoint(x, y); return !!hit && (hit === el || el.contains(hit) || !hit.closest('.react-flow__node')); });
    if (through) el.style.pointerEvents = '';
    return ok;
  };
  const opaque = (el) => {
    const rect = el.querySelector('rect');
    if (rect) { const cs = getComputedStyle(rect); return cs.fill !== 'none' && Number(cs.fillOpacity) === 1; }
    const colour = getComputedStyle(el).backgroundColor;
    const alpha = /^rgba\\(.*,\\s*([0-9.]+)\\)$/.exec(colour);
    return colour !== 'transparent' && (alpha === null || Number(alpha[1]) === 1);
  };
  const report = (selector) => {
    const labels = all(selector).filter((el) => vis(el.getBoundingClientRect()));
    const rects = labels.map((el) => el.getBoundingClientRect());
    return {
      n: labels.length,
      texts: labels.map((el) => el.textContent.replace(/\\s+/g, ' ').trim().slice(0, 60)),
      apart: rects.every((a, i) => rects.every((b, j) => j <= i || apart(a, b))),
      above: labels.every(onTop),
      opaque: labels.every(opaque),
      inside: rects.every((r) => r.left >= 0 && r.right <= innerWidth),
    };
  };
`;

/** The modes that write the Full-mode files: the layers, the summaries and the domain graph. */
const FULL_MODES = new Set(['layers', 'domain-notrun', 'domain-digest', 'domain-fit', 'rows', 'years', 'classes', 'tour-digest']);

/** The number of rows `rows` adds to the unused list and the hotspots files: more than one page of a table (200 rows). */
const EXTRA_ROWS = 250;

const readProduct = (root, name) => JSON.parse(readFileSync(join(root, '.excavator', name), 'utf-8'));
const writeProduct = (root, name, data) => writeFileSync(join(root, '.excavator', name), JSON.stringify(data));

/**
 * `rows`: EXTRA_ROWS more unused functions after the fixture's (so the last one is on the second page in the product's order), and
 * EXTRA_ROWS more hotspots files under gen/ that all score above the fixture's (so lib/data.py is on the second page by score, the
 * files table's first sort, while it is on the first in the product's order).
 */
function addRows(root) {
  const unused = readProduct(root, 'unused-code.json');
  for (let i = 0; i < EXTRA_ROWS; i++) {
    unused.unused.push({ id: `function:gen/u${i}.js:fn`, name: `fn${i}`, language: 'javascript', file: `gen/u${i}.js`, lineRange: [1, 2], owner: null, visibility: 'private', reason: 'unreferenced', confidence: 'low', group: null, signals: [] });
  }
  writeProduct(root, 'unused-code.json', unused);
  const hotspots = readProduct(root, 'hotspots.json');
  for (let i = 0; i < EXTRA_ROWS; i++) {
    hotspots.files.push({ path: `gen/h${i}.js`, commits: 1, authors: 1, added: 1, removed: 0, lastChanged: null, lines: 1, score: 100 + i, lineageConflicts: 0 });
  }
  writeProduct(root, 'hotspots.json', hotspots);
}

/** `years`: the hotspots directories gain the project-root row, with its commits by year. */
function addRootYears(root) {
  const hotspots = readProduct(root, 'hotspots.json');
  hotspots.directories.push({ path: '.', files: 4, commits: 15, authors: 1, added: 23, removed: 4, lines: 26, score: 150, lastChanged: '2026-01-02T03:04:05+00:00', commitsByYear: { 2024: 2, 2025: 6, 2026: 7 } });
  writeProduct(root, 'hotspots.json', hotspots);
}

/** `longfile`: add src/long.js to the graph with `functions` functions, each contained by the file node. */
function addLongFile(root, functions = 120) {
  const path = join(root, '.excavator', 'knowledge-graph.jsonl');
  const lines = readFileSync(path, 'utf-8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
  const records = [{ record: 'node', node: { id: 'file:src/long.js', type: 'file', name: 'long.js', filePath: 'src/long.js' } }];
  for (let i = 0; i < functions; i++) {
    records.push({ record: 'node', node: { id: `function:src/long.js:fn${i}`, type: 'function', name: `fn${i}`, filePath: 'src/long.js', lineRange: [i * 3 + 1, i * 3 + 2] } });
    records.push({ record: 'edge', edge: { source: 'file:src/long.js', target: `function:src/long.js:fn${i}`, type: 'contains' } });
  }
  const [header, ...rest] = lines;
  header.counts.nodes += functions + 1;
  header.counts.edges += functions;
  writeFileSync(path, `${[header, ...rest, ...records].map((record) => JSON.stringify(record)).join('\n')}\n`);
}

/**
 * `edge-crowd`: six top-level directories (c0..c5) and six under one (n/d0..n/d5), each with one file, every file importing the files
 * of the later ones, and a file importing one before it so that some edges run both ways: a node on either level has five aggregated
 * edges, as many as would have stacked their labels.
 */
function addCrowd(root, count = 6) {
  const path = join(root, '.excavator', 'knowledge-graph.jsonl');
  const lines = readFileSync(path, 'utf-8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
  const records = [];
  let nodes = 0;
  let edges = 0;
  for (const prefix of ['c', 'n/d']) {
    for (let i = 0; i < count; i++) {
      records.push({ record: 'node', node: { id: `file:${prefix}${i}/a.js`, type: 'file', name: 'a.js', filePath: `${prefix}${i}/a.js` } });
      nodes += 1;
    }
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        records.push({ record: 'edge', edge: { source: `file:${prefix}${i}/a.js`, target: `file:${prefix}${j}/a.js`, type: 'imports' } });
        edges += 1;
      }
    }
    records.push({ record: 'edge', edge: { source: `file:${prefix}${count - 1}/a.js`, target: `file:${prefix}0/a.js`, type: 'calls' } });
    edges += 1;
  }
  const [header, ...rest] = lines;
  header.counts.nodes += nodes;
  header.counts.edges += edges;
  writeFileSync(path, `${[header, ...rest, ...records].map((record) => JSON.stringify(record)).join('\n')}\n`);
}

/**
 * `domain-fit`: widen the domain graph to the size of a real one. Seven more domains (nine in all, each with a flow of its own and
 * joined by cross-domain edges, so the top level is dense), and a flow of seven steps in the first domain. Names, summaries and
 * paths are long on purpose: the cards have to clamp them. Returns what the scenario's checks read.
 */
function widenDomainGraph(root) {
  const path = join(root, '.excavator', 'domain-graph.json');
  const graph = JSON.parse(readFileSync(path, 'utf-8'));
  const long = 'Checks the request against the rules of the area, records what was decided and who decided it, and hands the result to the next stage without changing what the caller sent in the first place.';
  const node = (id, type, name, summary, extra = {}) => ({ id, type, name, summary, tags: [], complexity: 'simple', ...extra });
  const edge = (source, target, type, weight, extra = {}) => ({ source, target, type, direction: 'forward', weight, ...extra });
  const nodes = [];
  const edges = [];
  const domains = ['domain:app', 'domain:data'];
  for (let i = 1; i <= 7; i++) {
    const id = `domain:extra-${i}`;
    domains.push(id);
    nodes.push(node(id, 'domain', `Extra area ${i} with a name that runs long for one card`, `${long} Area ${i}.`, { domainMeta: { entities: [`Entity ${i}`] } }));
    nodes.push(node(`flow:extra-${i}`, 'flow', `Extra flow ${i} that also has a long name`, long, { domainMeta: { entryPoint: `POST /extra/${i}/with/a/long/path`, entryType: 'http' } }));
    nodes.push(node(`step:extra-${i}:only`, 'step', `Only step ${i}`, long, { filePath: `src/extra/area${i}/handlers/a/long/path/to/handler.js`, nodeIds: [], evidence: [] }));
    edges.push(edge(id, `flow:extra-${i}`, 'contains_flow', 1), edge(`flow:extra-${i}`, `step:extra-${i}:only`, 'flow_step', 1));
  }
  // Each domain is joined to the next two, around a ring: more edges than domains.
  domains.forEach((id, i) => {
    for (const step of [1, 2]) {
      const other = domains[(i + step) % domains.length];
      if (!(id === 'domain:app' && other === 'domain:data')) edges.push(edge(id, other, 'cross_domain', 0.5, { description: `${id} depends on ${other} for what it needs.` }));
    }
  });
  const steps = [];
  nodes.push(node('flow:long', 'flow', 'A flow of seven steps with a long name', long, { domainMeta: { entryPoint: 'POST /long', entryType: 'http' } }));
  edges.push(edge('domain:app', 'flow:long', 'contains_flow', 1));
  for (let i = 1; i <= 7; i++) {
    const id = `step:long:${i}`;
    steps.push(id);
    nodes.push(node(id, 'step', `Step ${i} with a name long enough to be cut`, long, { filePath: `src/long/flow/handlers/internal/deep/path/step${i}_handler.js`, lineRange: [3, 9], nodeIds: [], evidence: [] }));
    edges.push(edge('flow:long', id, 'flow_step', i / 10));
  }
  writeFileSync(path, JSON.stringify({ ...graph, nodes: [...graph.nodes, ...nodes], edges: [...graph.edges, ...edges] }));
  return { domains: domains.length, flow: 'flow:long', steps };
}

/** The graph's records as packed: [header, nodes, edges]. */
function graphRecords(root) {
  const lines = readFileSync(join(root, '.excavator', 'knowledge-graph.jsonl'), 'utf-8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
  return { header: lines[0], nodes: lines.filter((r) => r.record === 'node').map((r) => r.node), edges: lines.filter((r) => r.record === 'edge').map((r) => r.edge) };
}

/**
 * `classes`: two classes and a variable join the graph (src/main.js owns a class and a variable beside its functions, lib/data.py a
 * class), some nodes record a complexity, and the domain graph has a project description. Returns what the overview should show,
 * counted here from the files as packed, apart from the page's own code: the tiles, the type and complexity counts, the five nodes
 * with the most edge records in and out (ties by name, then id), the groups' file counts, and the product highlights.
 */
function addClasses(root) {
  const path = join(root, '.excavator', 'knowledge-graph.jsonl');
  const lines = readFileSync(path, 'utf-8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
  const complexity = { 'function:src/main.js:main': 'simple', 'function:src/core/engine/run.js:run': 'complex', 'function:src/util.js:helper': 'moderate' };
  for (const line of lines) if (line.record === 'node' && complexity[line.node.id]) line.node.complexity = complexity[line.node.id];
  const added = [
    { id: 'class:src/main.js:Session', type: 'class', name: 'Session', filePath: 'src/main.js', lineRange: [7, 9], complexity: 'moderate' },
    { id: 'class:lib/data.py:Store', type: 'class', name: 'Store', filePath: 'lib/data.py', lineRange: [5, 6] },
    { id: 'variable:src/main.js:VERSION', type: 'variable', name: 'VERSION', filePath: 'src/main.js', lineRange: [1, 1] },
  ];
  const records = [
    ...added.map((node) => ({ record: 'node', node })),
    ...added.map((node) => ({ record: 'edge', edge: { source: `file:${node.filePath}`, target: node.id, type: 'contains' } })),
  ];
  const [header, ...rest] = lines;
  header.counts.nodes += added.length;
  header.counts.edges += added.length;
  writeFileSync(path, `${[header, ...rest, ...records].map((record) => JSON.stringify(record)).join('\n')}\n`);
  const domain = readProduct(root, 'domain-graph.json');
  const description = 'A small program that starts an engine and loads its data.';
  writeProduct(root, 'domain-graph.json', { ...domain, project: { name: 'smoke-fixture', description } });

  const { nodes, edges } = graphRecords(root);
  const countBy = (rows, key) => rows.reduce((acc, row) => ({ ...acc, [key(row)]: (acc[key(row)] ?? 0) + 1 }), {});
  const sorted = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => (a < b ? -1 : 1)));
  const ids = new Set(nodes.map((n) => n.id));
  const degree = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) for (const end of [e.source, e.target]) if (ids.has(end)) degree.set(end, degree.get(end) + 1);
  const byName = new Map(nodes.map((n) => [n.id, n.name]));
  const connected = [...degree].filter(([, d]) => d > 0).sort(([a, x], [b, y]) => y - x || (byName.get(a) < byName.get(b) ? -1 : byName.get(a) > byName.get(b) ? 1 : a < b ? -1 : 1)).slice(0, 5);
  const files = nodes.filter((n) => n.type === 'file').map((n) => n.id);
  const layers = readProduct(root, 'semantic-graph.json').layers;
  const layered = new Set(layers.flatMap((l) => l.nodeIds));
  const unused = readProduct(root, 'unused-code.json').unused;
  const hotspots = readProduct(root, 'hotspots.json').files;
  const hot = [...hotspots].sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1)).slice(0, 3).map((f) => [f.path, `#/hotspots?view=files&row=${encodeURIComponent(f.path)}`]);
  return {
    classes: { level: 'layer:app/src', className: 'Session', classId: 'class:src/main.js:Session' },
    overview: {
      name: basename(root),
      description,
      tiles: { Nodes: nodes.length, Edges: edges.length, Layers: layers.length, Files: files.length },
      languages: graphRecords(root).header.fields.project.languages,
      types: sorted(countBy(nodes, (n) => n.type)),
      complexity: sorted({ simple: 0, moderate: 0, complex: 0, ...countBy(nodes, (n) => n.complexity ?? '~none') }),
      connected,
      layers: [...layers.map((l) => [l.name, files.filter((f) => layered.has(f) && l.nodeIds.includes(f)).length]), ['Not in any layer', files.filter((f) => !layered.has(f)).length]].sort(),
      unused: { total: unused.length, byConfidence: sorted({ high: 0, medium: 0, low: 0, ...countBy(unused, (u) => u.confidence) }) },
      hot,
      tour: readProduct(root, 'tour.json').steps.map((s) => s.title),
    },
  };
}

/** `tour-digest`: the tour was made from other facts than the graph's. */
function tourFromOtherFacts(root) {
  const digest = 'd'.repeat(64);
  writeProduct(root, 'tour.json', { ...readProduct(root, 'tour.json'), factDigest: digest });
  return digest;
}

/** Run one scenario on a freshly packed page. */
function runScenario([name, mode, makeDriver, scenarioCheck, extra = {}]) {
  const dir = mkdtempSync(join(tmpdir(), 'xv-graph-smoke-'));
  try {
    const { root, expected } = makeSmokeProject(dir, { full: FULL_MODES.has(mode) });
    // `notrun`: the project's doc map was never made.
    if (mode === 'notrun') for (const file of ['doc-map.json', 'doc-map-report.md', 'doc-map']) rmSync(join(root, '.excavator', file), { recursive: true, force: true });
    // `domain-notrun`: the domain graph was never made. `domain-digest`: it was made from other facts than the graph's.
    if (mode === 'longfile') addLongFile(root);
    if (mode === 'rows') addRows(root);
    if (mode === 'years') addRootYears(root);
    if (mode === 'edge-crowd') addCrowd(root);
    if (mode === 'classes') Object.assign(expected, addClasses(root));
    if (mode === 'tour-digest') expected.tourDigest = tourFromOtherFacts(root);
    if (mode === 'domain-fit') expected.domain = { ...expected.domain, long: widenDomainGraph(root) };
    if (mode === 'domain-notrun') rmSync(join(root, '.excavator', 'domain-graph.json'));
    if (mode === 'domain-digest') {
      const path = join(root, '.excavator', 'domain-graph.json');
      writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf-8')), factDigest: expected.domain.digests.graph }));
    }
    // The products as packed, for the checks that recount what a page shows.
    // (A product a mode removed is null.)
    const packed = (name) => (existsSync(join(root, '.excavator', name)) ? readProduct(root, name) : null);
    expected.data = { unused: packed('unused-code.json'), hotspots: packed('hotspots.json'), docMap: packed('doc-map.json'), checks: packed('doc-map/checks.json') };
    const out = join(dir, 'page.html');
    packProject(root, { out });
    const args = [join(here, 'view-smoke.mjs'), out, ...(extra.reducedMotion ? ['--reduced-motion'] : []), ...(extra.hash ? ['--hash', extra.hash] : []), ...(extra.height ? ['--height', String(extra.height)] : []), ...(extra.width ? ['--width', String(extra.width)] : []), '--eval', makeDriver(expected.graph, expected), ...(extra.screenshot ? ['--screenshot', extra.screenshot] : [])];
    const result = spawnSync('node', args, { encoding: 'utf-8', maxBuffer: 1 << 26 });
    let smoke;
    try {
      smoke = JSON.parse(result.stdout);
    } catch {
      return [[`${name}: the smoke printed no result`, false, result.stderr.trim()]];
    }
    const label = `${mode}/${name}`;
    const checks = [[`${label}: no console error, CSP violation or extra request`, smoke.ok, smoke.ok ? '' : JSON.stringify({ ready: smoke.ready, errors: [smoke.consoleErrors, smoke.exceptions, smoke.cspViolations, smoke.extraRequests, smoke.loadFailures] })]];
    if (smoke.evalResult?.error) return [...checks, [`${label}: the driver ran`, false, smoke.evalResult.error]];
    let results;
    try {
      results = scenarioCheck(smoke.evalResult ?? {}, expected.graph, expected);
    } catch (error) {
      // A driver that stopped early leaves what its checks read missing: that is a failure, with what it did leave.
      return [...checks, [`${label}: the checks could read what the driver saw`, false, `${error.message}; saw ${JSON.stringify(smoke.evalResult)}`]];
    }
    for (const [checkName, passed, detail] of results) {
      checks.push([`${label}: ${checkName.replace(/^[a-z]+: /, '')}`, Boolean(passed), passed ? '' : JSON.stringify(detail)]);
    }
    return checks;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const only = process.argv.slice(2);
const results = [
  ...(only.length === 0 || only.includes('levels') ? [...run('directories', {}), ...run('layers', { full: true })] : []),
  ...SCENARIOS.filter(([name]) => only.length === 0 || only.includes(name)).flatMap(runScenario),
];
let failed = 0;
for (const [name, passed, detail] of results) {
  process.stdout.write(`${passed ? 'ok  ' : 'FAIL'} ${name}${detail ? `\n       ${detail}` : ''}\n`);
  if (!passed) failed += 1;
}
process.stdout.write(`${results.length - failed}/${results.length} checks passed\n`);
process.exit(failed === 0 ? 0 : 1);
