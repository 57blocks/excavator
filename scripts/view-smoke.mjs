#!/usr/bin/env node
/**
 * view-smoke.mjs — file:// smoke check for a baked Excavator view page
 * (openspec change `artifact-view`, design D11).
 *
 * Opens the page in headless Chrome straight from disk (no server) over the
 * DevTools pipe, waits in real time (up to --budget ms) until the page
 * settles, takes the DOM and reads what the page reports about itself on the
 * `#root` element:
 * `data-excavator-view` (ready / error / empty / loading), the decoded
 * counts, the graph header counts, `data-errors` (window errors and
 * unhandled rejections, plus decode/render failures the page caught),
 * `data-csp-violations`, `data-decode-ms` and `data-ready-ms`. A page that
 * has asynchronous work pending (a search running in its Worker) marks
 * `data-busy`; the page counts as settled only once that is gone. Views report
 * what they show (`data-route`, `data-hash`, `data-treemap-path`,
 * `data-search-*`, `data-postings`, the graph level's edge ledger
 * `data-graph-edges-*`, the live data Workers `data-workers`), collected
 * under `view` in the result.
 *
 * `actions` (programmatic only; see `smoke`) drive the graph canvas with
 * real input events (CDP `Input.dispatchMouseEvent`): a drag, a wheel turn,
 * a click or a double-click, at a canvas-relative point or on a drawn node
 * (located through the page's `window.__excavatorViewGraph` probe); each
 * action's view report is listed under `actions`.
 *
 * `--then '#/...'` (repeatable) changes the hash in the same page after it
 * settles, the way a click on a link would, and waits until the page has
 * rendered that hash (`data-hash`) and settled again; each step's view report
 * is listed under `steps`, and the DOM and screenshot are taken after the last.
 *
 * Chrome is closed with the DevTools `Browser.close` command so it removes
 * its own temporary directories; SIGKILL only after a 5 s grace period
 * (`chrome.exit` in the result says which happened). Before closing, the
 * `SingletonSocket` symlink Chrome puts in our --user-data-dir is read: it
 * points into this run's process-singleton directory
 * (`<user temp dir>/com.google.Chrome.XXXXXX/`), reported as
 * `chrome.singletonDir` (null when Chrome made none) so a caller can check
 * that exactly this run's directory is gone.
 *
 * Chrome runs with TMPDIR=<profile>/tmp (task 7A.5), so whatever it puts in
 * TMPDIR is removed with the profile; `chrome.tmpLeft` lists what was in that
 * directory when Chrome had closed. Chrome on macOS does not take its
 * singleton directory or its `com.google.Chrome.chrome_chrome_url_fetcher_.*`
 * directory from TMPDIR (measured: one empty url_fetcher directory per run
 * stays in the user temp dir); `chrome.userTmpLeft` lists the
 * `com.google.Chrome.*` entries that appeared in the user temp dir during
 * the run and are still there (another Chrome running at the same time can
 * add to it; nothing is deleted there).
 *
 * Prints one JSON line. Exit code: 0 when the page is ready, reports no
 * errors and no CSP violations, and its decoded counts equal the header
 * counts; 1 otherwise; 2 when no Chrome was found (a visible skip, never a
 * pass); 64 on a usage error.
 *
 * Chrome discovery, first match wins: $EXCAVATOR_CHROME; on macOS
 * /Applications/Google Chrome.app/Contents/MacOS/Google Chrome;
 * `google-chrome` then `chromium` on PATH.
 *
 * Usage:
 *   node scripts/view-smoke.mjs <page.html> [--hash '#/node/<id>'] [--then '#/...']... [--reduced-motion]
 *     [--budget <ms>] [--dom <path>] [--screenshot <path.png>] [--color-scheme light|dark]
 *   --budget  real-time wait for the page to settle (default 15000 ms)
 *   --dom     also write the page DOM to <path> (for content checks)
 *   --screenshot  also save a 1440x1000 viewport PNG
 *   --color-scheme  emulate prefers-color-scheme
 *
 * Design D11 named --virtual-time-budget + --dump-dom; that pair cannot see a
 * page that decodes in a Worker (virtual time does not wait for Worker
 * threads, so the dump shows "loading"), hence the DevTools pipe.
 */

import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const DEFAULT_BUDGET_MS = 15000;

function isExecutable(path) {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function onPath(name, env) {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (dir && isExecutable(join(dir, name))) return join(dir, name);
  }
  return null;
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, platform?: string }} [options]
 * @returns {{ path: string, source: string } | { path: null, reason: string }}
 */
export function findChrome({ env = process.env, platform = process.platform } = {}) {
  if (env.EXCAVATOR_CHROME) {
    return isExecutable(env.EXCAVATOR_CHROME)
      ? { path: env.EXCAVATOR_CHROME, source: 'EXCAVATOR_CHROME' }
      : { path: null, reason: `EXCAVATOR_CHROME=${env.EXCAVATOR_CHROME} is not an executable file` };
  }
  if (platform === 'darwin' && isExecutable(MAC_CHROME)) return { path: MAC_CHROME, source: 'macOS application' };
  for (const name of ['google-chrome', 'chromium']) {
    const found = onPath(name, env);
    if (found) return { path: found, source: `${name} on PATH` };
  }
  return { path: null, reason: 'no Chrome found (set EXCAVATOR_CHROME, or install Google Chrome / chromium)' };
}

/** Attributes of the `<div id="root" ...>` opening tag in a dumped DOM, or null. */
export function rootAttributes(dom) {
  const match = /<div\b[^>]*\bid="root"[^>]*>/.exec(dom);
  if (!match) return null;
  /** @type {Record<string, string>} */
  const attrs = {};
  for (const [, name, value] of match[0].matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attrs[name] = value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  return attrs;
}

function intOrNull(value) {
  if (value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/** What the current view reports about itself on #root (null for an attribute it did not write). */
export function viewReport(attrs) {
  const a = attrs ?? {};
  return {
    route: a['data-route'] ?? null,
    hash: a['data-hash'] ?? null,
    treemapPath: a['data-treemap-path'] ?? null,
    searchQuery: a['data-search-query'] ?? null,
    searchResults: intOrNull(a['data-search-results']),
    searchIdentifierResults: intOrNull(a['data-search-identifier-results']),
    postings: a['data-postings'] ?? null,
    busy: a['data-busy'] ?? null,
    graphLevel: a['data-graph-level'] ?? null,
    graphPath: a['data-graph-path'] ?? null,
    graphVisibleNodes: intOrNull(a['data-graph-visible-nodes']),
    graphItemsTotal: intOrNull(a['data-graph-items-total']),
    graphLinks: intOrNull(a['data-graph-links']),
    graphTransform: a['data-graph-transform'] ?? null,
    csr: a['data-csr'] ?? null,
    csrMs: intOrNull(a['data-csr-ms']),
    selectedNode: a['data-selected-node'] ?? null,
    detailEdges: a['data-detail-edges'] ?? null,
    neighborhoodTotal: intOrNull(a['data-neighborhood-total']),
    motionMode: a['data-motion-mode'] ?? null,
    neighborhoodHop1: a['data-neighborhood-hop1'] ?? null,
    neighborhoodHop2: a['data-neighborhood-hop2'] ?? null,
    neighborhoodFolded: intOrNull(a['data-neighborhood-folded']),
    graphEdges: graphEdgesReport(a),
    workers: intOrNull(a['data-workers']),
    origin: a['data-origin'] ?? null,
    dropState: a['data-drop-state'] ?? null,
    semantics: semanticsReport(a),
  };
}

/**
 * The graph level's edge ledger (`data-graph-edges-*`, task 7A.1) as numbers,
 * `balanced` as a boolean; null when the level reports none.
 */
function graphEdgesReport(attrs) {
  /** @type {Record<string, number | boolean | null>} */
  const out = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (!name.startsWith('data-graph-edges-')) continue;
    const key = name.slice('data-graph-edges-'.length).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = key === 'balanced' ? value === 'true' : intOrNull(value);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Every `data-semantics-*` attribute, camelCased (`data-semantics-layers-freshness` -> `layersFreshness`). */
function semanticsReport(attrs) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (!name.startsWith('data-semantics-')) continue;
    out[name.slice('data-semantics-'.length).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  return out;
}

/** The smoke verdict from the root element's attributes (null when there is no root). */
export function verdict(attrs) {
  const a = attrs ?? {};
  const counts = { nodes: intOrNull(a['data-nodes']), edges: intOrNull(a['data-edges']), evidence: intOrNull(a['data-evidence']), gaps: intOrNull(a['data-gaps']) };
  const headerCounts = { nodes: intOrNull(a['data-header-nodes']), edges: intOrNull(a['data-header-edges']), gaps: intOrNull(a['data-header-gaps']) };
  const countsMatchHeader = counts.nodes !== null
    && counts.nodes === headerCounts.nodes && counts.edges === headerCounts.edges && counts.gaps === headerCounts.gaps;
  const errors = intOrNull(a['data-errors']);
  const cspViolations = intOrNull(a['data-csp-violations']);
  const ready = a['data-excavator-view'] === 'ready';
  return {
    ready,
    state: a['data-excavator-view'] ?? null,
    counts,
    headerCounts,
    countsMatchHeader,
    // An attribute the page never wrote is not "zero errors".
    errors,
    cspViolations,
    decodeMs: intOrNull(a['data-decode-ms']),
    readyMs: intOrNull(a['data-ready-ms']),
    decodeMode: a['data-decode-mode'] ?? null,
    route: a['data-route'] ?? null,
    reducedMotion: a['data-reduced-motion'] === undefined ? null : a['data-reduced-motion'] === 'true',
    view: viewReport(a),
    error: a['data-error'] ?? null,
    ok: ready && errors === 0 && cspViolations === 0 && countsMatchHeader,
  };
}

/**
 * Minimal Chrome DevTools Protocol client over --remote-debugging-pipe
 * (fd 3 = commands to Chrome, fd 4 = replies; messages end with NUL).
 * @param {import('node:child_process').ChildProcess} child
 */
function pipeClient(child) {
  const input = /** @type {import('node:stream').Writable} */ (child.stdio[3]);
  const output = /** @type {import('node:stream').Readable} */ (child.stdio[4]);
  let nextId = 1;
  /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void }>} */
  const pending = new Map();
  let buffer = '';
  output.setEncoding('utf-8');
  output.on('data', (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const waiter = message.id !== undefined ? pending.get(message.id) : undefined;
      if (!waiter) continue;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.message} (${message.error.code})`));
      else waiter.resolve(message.result);
    }
  });
  const failAll = (/** @type {Error} */ error) => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  child.on('exit', () => failAll(new Error('Chrome exited')));
  child.on('error', failAll);
  return {
    /** @param {string} method @param {object} [params] @param {string} [sessionId] */
    send(method, params = {}, sessionId) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        input.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
      });
    },
  };
}

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

// Browser.close can be slow when the machine is loaded (parallel test runs).
export const CLOSE_GRACE_MS = 5000;

/**
 * This run's Chrome process-singleton directory: the directory of the target
 * of the `SingletonSocket` symlink in the user data dir, or null when there is
 * no such link (Chrome never got that far, or a platform without one).
 * @param {string} profile
 * @returns {string | null}
 */
export function singletonDir(profile) {
  try {
    return dirname(resolve(profile, readlinkSync(join(profile, 'SingletonSocket'))));
  } catch {
    return null;
  }
}

/**
 * Every entry under `dir` (relative paths, sorted), [] when it is missing.
 * @param {string} dir
 * @returns {string[]}
 */
export function listTree(dir) {
  try {
    return readdirSync(dir, { recursive: true }).map(String).sort();
  } catch {
    return [];
  }
}

/**
 * Close Chrome through the DevTools protocol so it removes its own temporary
 * directories (a SIGKILLed Chrome leaves a com.google.Chrome.* directory in
 * the temp dir per run); SIGKILL only when it has not exited within
 * CLOSE_GRACE_MS.
 * @param {import('node:child_process').ChildProcess} child
 * @param {{ send(method: string, params?: object): Promise<any> }} cdp
 * @returns {Promise<'closed'|'killed'|'already-exited'>}
 */
async function closeChrome(child, cdp) {
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  if (exited()) return 'already-exited';
  const exit = new Promise((r) => child.once('exit', r));
  // The reply may never arrive (Chrome exits first); the exit is what counts.
  cdp.send('Browser.close').catch(() => {});
  /** @type {NodeJS.Timeout | undefined} */
  let handle;
  const timer = new Promise((r) => { handle = setTimeout(r, CLOSE_GRACE_MS, 'timeout'); });
  const outcome = await Promise.race([exit, timer]);
  clearTimeout(handle);
  if (outcome === 'timeout' && !exited()) {
    child.kill('SIGKILL');
    await exit;
    return 'killed';
  }
  return 'closed';
}

/**
 * True once #root reports a terminal state, has no pending work and has
 * rendered the current hash. An error state settles at once. (A boolean, not
 * the DOM: a baked page carries its whole data segment in the DOM.)
 */
const SETTLED = `(() => {
  const root = document.getElementById('root');
  const state = root && root.getAttribute('data-excavator-view');
  if (state === 'error') return true;
  // An unbaked template is settled unless it is reading a directory it was given.
  if (state === 'empty') return !root.hasAttribute('data-busy');
  if (state !== 'ready' || root.hasAttribute('data-busy')) return false;
  return root.getAttribute('data-hash') === window.location.hash;
})()`;

/** The #root opening tag, rebuilt from its attributes (what rootAttributes parses). */
const ROOT_TAG = `(() => {
  const root = document.getElementById('root');
  if (!root) return '';
  const esc = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return '<div ' + [...root.attributes].map((a) => a.name + '="' + esc(a.value) + '"').join(' ') + '>';
})()`;

/**
 * @typedef {{ type: 'drag', from?: [number, number], node?: string, by: [number, number] }
 *   | { type: 'wheel', at?: [number, number], deltaY: number }
 *   | { type: 'click', at?: [number, number], node?: string, selector?: string }
 *   | { type: 'dblclick', at?: [number, number] }
 *   | { type: 'hash', hash: string }
 *   | { type: 'files', selector: string, paths: string[] }} GraphAction
 * Points are canvas-relative CSS pixels (default: the canvas centre); `node`
 * targets a drawn node by key; `by` is the drag distance; `hash` sets the
 * location hash (a breadcrumb or back navigation) between inputs; a click
 * with `selector` clicks the centre of that page element instead (a button
 * outside the canvas); `files` sets local files on a file input (the drop
 * zone's directory picker) as a user's choice would.
 */

const CANVAS_RECT = `(() => {
  const c = document.querySelector('.graph-canvas canvas');
  if (!c) return null;
  c.scrollIntoView({ block: 'center' });
  const r = c.getBoundingClientRect();
  return [r.left, r.top, r.width, r.height];
})()`;

function elementRect(selector) {
  return `(() => {
    const e = document.querySelector(${JSON.stringify(selector)});
    if (!e) return null;
    e.scrollIntoView({ block: 'center' });
    const r = e.getBoundingClientRect();
    return [r.left, r.top, r.width, r.height];
  })()`;
}

/**
 * Dispatch one GraphAction as real mouse input.
 * @param {GraphAction} action
 * @param {(expression: string) => Promise<any>} evaluate
 * @param {(method: string, params: object) => Promise<any>} send
 * @returns {Promise<{ point: [number, number] | null, problem?: string }>}
 */
async function performAction(action, evaluate, send) {
  if (action.type === 'hash') {
    await evaluate(`window.location.hash = ${JSON.stringify(action.hash)}`);
    return { point: null };
  }
  if (action.type === 'files') {
    const { root } = await send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: action.selector });
    if (!nodeId) return { point: null, problem: `no element matches ${action.selector}` };
    await send('DOM.setFileInputFiles', { nodeId, files: action.paths });
    return { point: null };
  }
  const selector = /** @type {any} */ (action).selector;
  const rect = await evaluate(selector === undefined ? CANVAS_RECT : elementRect(selector));
  if (!rect) return { point: null, problem: selector === undefined ? 'no graph canvas on the page' : `no element matches ${selector}` };
  const [left, top, width, height] = rect;
  /** @type {[number, number]} */
  let point = [left + width / 2, top + height / 2];
  const at = /** @type {any} */ (action).at ?? /** @type {any} */ (action).from;
  if (at) point = [left + at[0], top + at[1]];
  const node = /** @type {any} */ (action).node;
  if (node !== undefined) {
    const p = await evaluate(`(() => { const g = window.__excavatorViewGraph; return g ? g.position(${JSON.stringify(node)}) : null; })()`);
    if (!p) return { point: null, problem: `node ${node} is not drawn` };
    point = [p.x, p.y];
  }
  const [x, y] = point;
  const mouse = (type, px, py, extra = {}) => send('Input.dispatchMouseEvent', { type, x: px, y: py, ...extra });
  if (action.type === 'wheel') {
    await mouse('mouseMoved', x, y);
    await mouse('mouseWheel', x, y, { deltaX: 0, deltaY: action.deltaY });
  } else if (action.type === 'click' || action.type === 'dblclick') {
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 });
    await mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 });
    if (action.type === 'dblclick') {
      await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 2 });
      await mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 2 });
    }
  } else {
    const [dx, dy] = action.by;
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 8; i += 1) await mouse('mouseMoved', x + (dx * i) / 8, y + (dy * i) / 8, { button: 'left', buttons: 1 });
    await mouse('mouseReleased', x + dx, y + dy, { button: 'left', buttons: 0, clickCount: 1 });
  }
  return { point: [Math.round(x), Math.round(y)] };
}

/**
 * Open the page from file:// in headless Chrome and wait, in real time, for
 * the page to settle. Real time rather than --virtual-time-budget: virtual
 * time races ahead of Worker threads, so a page that decodes in a Worker is
 * dumped while still "loading".
 *
 * @param {string} page
 * @param {{ hash?: string, steps?: string[], actions?: GraphAction[], reducedMotion?: boolean, budgetMs?: number, chrome?: string, screenshot?: string|null, colorScheme?: 'light'|'dark'|null }} [options]
 *   `steps`: hashes set one after another once the page settles (see --then)
 *   `actions`: input on the graph canvas after the steps (see GraphAction)
 *   `screenshot`: also save a 1440x1000 viewport PNG to this path once settled
 */
export async function smoke(page, { hash = '', steps = [], actions = [], reducedMotion = false, budgetMs = DEFAULT_BUDGET_MS, chrome, screenshot = null, colorScheme = null } = {}) {
  const found = chrome ? { path: chrome, source: 'argument' } : findChrome();
  if (!found.path) return { skipped: true, reason: /** @type {any} */ (found).reason, dom: null };
  const url = `${pathToFileURL(resolve(page)).href}${hash}`;
  const profile = mkdtempSync(join(tmpdir(), 'excavator-view-smoke-'));
  // Chrome's own temporary files (its process-singleton directory, the URL
  // fetcher's directories) go under the profile, removed with it (task 7A.5).
  const chromeTmp = join(profile, 'tmp');
  mkdirSync(chromeTmp);
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-pipe',
    ...(reducedMotion ? ['--force-prefers-reduced-motion'] : []),
    'about:blank',
  ];
  // Chrome on macOS ignores TMPDIR for some directories (measured: its
  // process-singleton directory and one empty
  // com.google.Chrome.chrome_chrome_url_fetcher_.* per run land in the user
  // temp dir regardless). Record what appears there while this run's Chrome
  // is up and is still there after it closed; another Chrome running at the
  // same time can add to this list, so it is a report, never cleaned up.
  const userTmp = tmpdir();
  /** @type {Set<string>} */
  const appeared = new Set();
  /** @type {import('node:fs').FSWatcher | null} */
  let watcher = null;
  try {
    watcher = watch(userTmp, (_event, name) => {
      if (name && String(name).startsWith('com.google.Chrome.')) appeared.add(String(name));
    });
  } catch {
    watcher = null;
  }
  const child = spawn(found.path, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], env: { ...process.env, TMPDIR: `${chromeTmp}/` } });
  const cdp = pipeClient(child);
  let dom = '';
  let problem = null;
  let settled = false;
  /** @type {Array<{ hash: string, settled: boolean, view: ReturnType<typeof viewReport> }>} */
  const stepReports = [];
  /** @type {Array<Record<string, unknown>>} */
  const actionReports = [];
  /** @type {'closed'|'killed'|'already-exited'} */
  let chromeExit = 'already-exited';
  /** @type {string | null} */
  let chromeSingletonDir = null;
  /** @type {string[]} */
  let chromeTmpLeft = [];
  try {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const target = targetInfos.find((t) => t.type === 'page');
    if (!target) throw new Error('Chrome opened no page target');
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const features = [
      ...(reducedMotion ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : []),
      ...(colorScheme ? [{ name: 'prefers-color-scheme', value: colorScheme }] : []),
    ];
    if (features.length > 0) await cdp.send('Emulation.setEmulatedMedia', { features }, sessionId);
    if (screenshot || actions.length > 0) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
    }
    await cdp.send('Page.navigate', { url }, sessionId);
    const deadline = Date.now() + budgetMs;
    const evaluate = async (/** @type {string} */ expression) => {
      const { result } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
      return result?.value ?? null;
    };
    const waitSettled = async () => {
      while (Date.now() < deadline) {
        if ((await evaluate(SETTLED)) === true) return true;
        await sleep(100);
      }
      return false;
    };
    settled = await waitSettled();
    // A short settle period so errors right after the first view are counted.
    if (settled) await sleep(300);
    for (const step of steps) {
      if (!settled) break;
      await evaluate(`window.location.hash = ${JSON.stringify(step)}`);
      settled = await waitSettled();
      if (settled) await sleep(300);
      stepReports.push({ hash: step, settled, view: viewReport(rootAttributes((await evaluate(ROOT_TAG)) ?? '')) });
    }
    for (const action of actions) {
      if (!settled) break;
      const done = await performAction(action, evaluate, (method, params) => cdp.send(method, params, sessionId));
      await sleep(200);
      settled = await waitSettled();
      // Let a level transition (450 ms) and any zoom-to-fit (320 ms) finish.
      if (settled) await sleep(600);
      actionReports.push({ action, ...done, settled, view: viewReport(rootAttributes((await evaluate(ROOT_TAG)) ?? '')) });
    }
    dom = (await evaluate('document.documentElement.outerHTML')) ?? '';
    if (screenshot) {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
      writeFileSync(screenshot, Buffer.from(data, 'base64'));
    }
    if (!settled) problem = `the page did not settle within ${budgetMs} ms`;
  } catch (error) {
    problem = `Chrome session failed: ${/** @type {Error} */ (error).message}`;
  } finally {
    chromeSingletonDir = singletonDir(profile);
    chromeExit = await closeChrome(child, cdp);
    chromeTmpLeft = listTree(chromeTmp);
    rmSync(profile, { recursive: true, force: true });
    await sleep(300);
    watcher?.close();
  }
  const attrs = rootAttributes(dom);
  const result = verdict(attrs);
  if (!problem && !attrs) problem = 'no #root element in the page';
  return {
    skipped: false,
    ...result,
    ok: result.ok && problem === null,
    chrome: { path: found.path, source: /** @type {any} */ (found).source, exit: chromeExit, singletonDir: chromeSingletonDir, profile, tmpDir: chromeTmp, tmpLeft: chromeTmpLeft, userTmpLeft: watcher === null ? null : [...appeared].filter((name) => existsSync(join(userTmp, name))).sort() },
    ...(steps.length > 0 ? { steps: stepReports } : {}),
    ...(actions.length > 0 ? { actions: actionReports } : {}),
    ...(problem ? { problem } : {}),
    dom,
  };
}

const USAGE = "Usage: node scripts/view-smoke.mjs <page.html> [--hash '#/...'] [--then '#/...']... [--reduced-motion] [--budget <ms>] [--dom <path>] [--screenshot <path.png>] [--color-scheme light|dark]";

function parseArgs(argv) {
  const options = { page: '', hash: '', steps: /** @type {string[]} */ ([]), reducedMotion: false, budgetMs: DEFAULT_BUDGET_MS, dom: null, screenshot: null, colorScheme: null };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      if (argv[i + 1] === undefined) throw new Error(`${arg} needs a value`);
      return argv[++i];
    };
    if (arg === '--hash') options.hash = value();
    else if (arg === '--then') {
      const step = value();
      if (!step.startsWith('#')) throw new Error('--then must start with #');
      options.steps.push(step);
    }
    else if (arg === '--reduced-motion') options.reducedMotion = true;
    else if (arg === '--budget') options.budgetMs = Number(value());
    else if (arg === '--dom') options.dom = value();
    else if (arg === '--screenshot') options.screenshot = value();
    else if (arg === '--color-scheme') {
      options.colorScheme = value();
      if (options.colorScheme !== 'light' && options.colorScheme !== 'dark') throw new Error('--color-scheme must be light or dark');
    }
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) throw new Error('expected exactly one page');
  if (options.hash && !options.hash.startsWith('#')) throw new Error('--hash must start with #');
  if (!Number.isInteger(options.budgetMs) || options.budgetMs <= 0) throw new Error('--budget must be a positive integer');
  options.page = positional[0];
  if (!existsSync(options.page)) throw new Error(`page ${options.page} does not exist`);
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`view-smoke: ${error.message}\n${USAGE}\n`);
    process.exit(64);
  }
  const { dom, ...result } = await smoke(options.page, options);
  if (options.dom && dom !== null) writeFileSync(options.dom, dom);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.skipped ? 2 : result.ok ? 0 : 1);
}
