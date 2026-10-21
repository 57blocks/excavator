#!/usr/bin/env node
/**
 * view-smoke-graph.mjs
 *
 * The graph page's smoke (openspec: changes/viewer-app, tasks 3.2, design O3):
 * packs the synthetic smoke project twice (directory-grouped, and Full-mode with
 * layers), opens each page with view-smoke.mjs and drives the graph through
 * `--eval`: the default route lands on the graph, the page is clicked down two
 * levels and the counts at each equal the fixture's, a file is selected and
 * opened to its nodes, and browser back returns one step at a time.
 *
 *   node scripts/view-smoke-graph.mjs
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
import { makeSmokeProject } from './view-smoke-fixture.mjs';

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
  out.selected = { hash: location.hash, marked: document.querySelectorAll('.xv-selected').length, card: !!document.querySelector('.react-flow__panel .font-semibold') };
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
  add('a click on a file selects it: it is in the address and marked', out.selected?.hash.includes('node=') && out.selected.marked === 1 && out.selected.card, out.selected);
  add('a file opens to the nodes it owns', !out.opened || out.opened.children >= 1, out.opened);
  const last = levels[levels.length - 1];
  add('back from the selection keeps the level and clears the selection', out.afterSelectBack?.level === `${last.path}#` && out.afterSelectBack.selectedMarks === 0, out.afterSelectBack);
  add('back goes up one level at a time', levels.slice(0, -1).reverse().every((level, i) => out.afterBack?.[i]?.level === `${level.path}#` && out.afterBack[i].nodes === String(level.nodes)), out.afterBack);
  return checks;
}

const results = [...run('directories', {}), ...run('layers', { full: true })];
let failed = 0;
for (const [name, passed, detail] of results) {
  process.stdout.write(`${passed ? 'ok  ' : 'FAIL'} ${name}${detail ? `\n       ${detail}` : ''}\n`);
  if (!passed) failed += 1;
}
process.stdout.write(`${results.length - failed}/${results.length} checks passed\n`);
process.exit(failed === 0 ? 0 : 1);
