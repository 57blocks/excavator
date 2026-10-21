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
 *     domain-overview, domain-notrun and domain-digest (the product's state with its counts, not run, and a different revision);
 *   - longfile, longfile-restore: a function of a file expanded to a hundred and twenty rows is located, and the camera is on it at a readable
 *     zoom instead of fitting the whole file.
 *
 *   node scripts/view-smoke-graph.mjs [levels|history|search|drawer|focus|path|filters|keys|layers|summary|overlays|clearance|notrun|restore|locate|locate-tables|domain|domain-history|domain-restore|domain-keys|domain-overview|domain-notrun|domain-digest|longfile|longfile-restore ...]
 *
 * Needs `pnpm build` (the template) and a local Chrome. Prints one line per
 * check and exits 1 when any fails.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
    history.back(); await until(() => !location.hash.includes('node='));
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
    await go('#/hotspots');
    (await until(() => q('[data-xv-locate="directory:lib"]'))).click();
    await arrived((p) => p.entry === 'group:lib');
    await until(() => q('aside[data-xv-panel="sidebar"]'));
    out.directory = { ...there(), title: q('aside[data-xv-panel="sidebar"]')?.getAttribute('aria-label') };
    // src is split by the graph into src/core and the files directly in src: no one container stands for it.
    await go('#/hotspots');
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
    // The edge counts show on the canvas for the selected cluster, and only for it.
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
    ['entry: the edges of the selected cluster carry their counts on the canvas', out.labelled >= 1, out.labelled],
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
    await until(() => q('[data-xv-link-label]'));
    out.select = { hash: location.hash, label: q('[data-xv-link-label]')?.textContent, side: q('aside[data-xv-panel="sidebar"]').textContent, marked: all('.xv-selected').length };
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
      ['domain: a cross-domain edge is labelled only while its domain is selected, with its description', out.top?.labelsBefore === 0 && out.select?.label === d.link && out.select.marked === 1 && out.select.hash === '#/domain?node=domain%3Aapp', out.select],
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

  ['domain-overview', 'layers', (graph, expected) => driver(`
    await go('#/overview');
    await until(() => attr('data-xv-count-domain-domains') !== null);
    const row = all('tr').find((tr) => tr.querySelector('td')?.textContent === 'Domain graph');
    out.overview = { counts: ['domains', 'flows', 'steps', 'cross'].map((n) => attr('data-xv-count-domain-' + n)), row: row?.textContent ?? null, counted: q('[data-xv-domain-counts]')?.textContent ?? null };
  `), (out, graph, expected) => [
    ['domain-overview: the Overview lists the domain graph as included with its counts', JSON.stringify(out.overview?.counts) === JSON.stringify(['2', '3', '5', '1']) && /Included/.test(out.overview.row ?? '') && out.overview.counted === '2 domains, 3 flows, 5 steps and 1 cross-domain edge.', out.overview],
  ]],

  ['domain-notrun', 'domain-notrun', (graph, expected) => driver(`
    await go('#/domain');
    out.page = { text: q('main')?.textContent ?? '', canvas: !!q('.react-flow'), note: !!q('[data-xv-domain-note]') };
    await go('#/overview');
    const row = all('tr').find((tr) => tr.querySelector('td')?.textContent === 'Domain graph');
    out.overview = row?.textContent ?? null;
  `), (out) => [
    ['domain-notrun: the Domain page says not run and gives the command, and draws no graph', /Domain graph: not run/.test(out.page?.text ?? '') && /\/excavator-domain/.test(out.page.text) && out.page.canvas === false && out.page.note === false, out.page],
    ['domain-notrun: the Overview lists it as not run with the command', /Not run/.test(out.overview ?? '') && /\/excavator-domain/.test(out.overview), out.overview],
  ]],

  ['domain-digest', 'domain-digest', (graph, expected) => driver(`
    const d = ${JSON.stringify(expected.domain)};
    await go('#/domain');
    await until(() => attr('data-xv-domain-level') === 'top');
    out.page = { revision: q('[data-xv-domain-revision]')?.textContent ?? null, cards: all('[data-xv-domain-entry="domain"]').length };
    await go('#/overview');
    const row = all('tr').find((tr) => tr.querySelector('td')?.textContent === 'Domain graph');
    out.overview = row?.textContent ?? null;
  `), (out, graph, expected) => {
    const { domain, graph: other } = expected.domain.digests;
    return [
      ['domain-digest: a domain graph made from other facts is a different revision: the page writes both digests and still draws the graph', out.page?.revision?.includes(domain) && out.page.revision.includes(other) && out.page.cards === expected.domain.counts.domains, out.page],
      ['domain-digest: the Overview lists it as a different revision with both digests', /Different revision/.test(out.overview ?? '') && out.overview.includes(domain) && out.overview.includes(other), out.overview],
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
];

/** The modes that write the Full-mode files: the layers, the summaries and the domain graph. */
const FULL_MODES = new Set(['layers', 'domain-notrun', 'domain-digest']);

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

/** Run one scenario on a freshly packed page. */
function runScenario([name, mode, makeDriver, scenarioCheck, extra = {}]) {
  const dir = mkdtempSync(join(tmpdir(), 'xv-graph-smoke-'));
  try {
    const { root, expected } = makeSmokeProject(dir, { full: FULL_MODES.has(mode) });
    // `notrun`: the project's doc map was never made.
    if (mode === 'notrun') for (const file of ['doc-map.json', 'doc-map-report.md', 'doc-map']) rmSync(join(root, '.excavator', file), { recursive: true, force: true });
    // `domain-notrun`: the domain graph was never made. `domain-digest`: it was made from other facts than the graph's.
    if (mode === 'longfile') addLongFile(root);
    if (mode === 'domain-notrun') rmSync(join(root, '.excavator', 'domain-graph.json'));
    if (mode === 'domain-digest') {
      const path = join(root, '.excavator', 'domain-graph.json');
      writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf-8')), factDigest: expected.domain.digests.graph }));
    }
    const out = join(dir, 'page.html');
    packProject(root, { out });
    const args = [join(here, 'view-smoke.mjs'), out, ...(extra.hash ? ['--hash', extra.hash] : []), ...(extra.height ? ['--height', String(extra.height)] : []), '--eval', makeDriver(expected.graph, expected), ...(extra.screenshot ? ['--screenshot', extra.screenshot] : [])];
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
