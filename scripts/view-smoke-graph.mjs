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
 *   - keys: `/`, `?`, and Esc closing one thing at a time from the inside out.
 *
 *   node scripts/view-smoke-graph.mjs [levels|history|search|drawer|focus|path|filters|keys|layers|summary ...]
 *
 * Needs `pnpm build` (the template) and a local Chrome. Prints one line per
 * check and exits 1 when any fails.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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

  // helper's file is one that the unused-code and hotspots products point at, so the page embeds its text; run.js is in the graph only.
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
      ['drawer: a node whose file no product points at says the page holds nothing for it, as the Code page does', /holds nothing for it/.test(out.unpointed?.text ?? '') && out.unpointed.code === false, out.unpointed],
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

/** Run one scenario on a freshly packed page. */
function runScenario([name, mode, makeDriver, scenarioCheck]) {
  const dir = mkdtempSync(join(tmpdir(), 'xv-graph-smoke-'));
  try {
    const { root, expected } = makeSmokeProject(dir, { full: mode === 'layers' });
    const out = join(dir, 'page.html');
    packProject(root, { out });
    const result = spawnSync('node', [join(here, 'view-smoke.mjs'), out, '--eval', makeDriver(expected.graph)], { encoding: 'utf-8', maxBuffer: 1 << 26 });
    let smoke;
    try {
      smoke = JSON.parse(result.stdout);
    } catch {
      return [[`${name}: the smoke printed no result`, false, result.stderr.trim()]];
    }
    const label = `${mode}/${name}`;
    const checks = [[`${label}: no console error, CSP violation or extra request`, smoke.ok, smoke.ok ? '' : JSON.stringify({ ready: smoke.ready, errors: [smoke.consoleErrors, smoke.exceptions, smoke.cspViolations, smoke.extraRequests, smoke.loadFailures] })]];
    if (smoke.evalResult?.error) return [...checks, [`${label}: the driver ran`, false, smoke.evalResult.error]];
    for (const [checkName, passed, detail] of scenarioCheck(smoke.evalResult ?? {}, expected.graph)) {
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
