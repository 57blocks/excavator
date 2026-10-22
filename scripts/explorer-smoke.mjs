#!/usr/bin/env node
/**
 * explorer-smoke.mjs
 *
 * The offline smoke of the dashboard copy (openspec: changes/viewer-explorer,
 * design O3): builds a small synthetic data object (a hand-written knowledge
 * graph in the dashboard's format, a domain graph, a tour and two sources),
 * puts it and the content security policy into the built template
 * `packages/explorer/dist/explorer.html` the way the packing step will, opens
 * the result from file:// in headless Chrome with view-smoke.mjs and asserts:
 *   - network: no request, no failed load and no policy violation;
 *   - console: no console error, exception or log error;
 *   - cards: the graph's cards render (one per layer at the top level);
 *   - content: the page title and the onboarding header say Excavator, no visible
 *     text names the upstream product, a layer drills in, and a file's code opens
 *     from the inlined sources.
 * It then opens the same data with the graph's layers removed and asserts the
 * structural view still draws, now from the groups the copy derives, which the
 * legend calls groups (the page with layers must call them layers).
 *
 *   node scripts/explorer-smoke.mjs [--screenshot <png>] [--self-check]
 *
 * `--self-check` is the instrument check: it also runs three pages with a
 * planted fault (an external stylesheet, a thrown error, a graph the page cannot
 * read) and requires that each assertion it was written to catch goes red.
 *
 * Needs `pnpm -r build` (the template) and a local Chrome. Prints one line per
 * check and exits 1 when any fails.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTENT_SECURITY_POLICY } from '../skills/excavator-view/page-assembly.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(here, '..', 'packages', 'explorer', 'dist', 'explorer.html');
const CSP_MARKER = '<!-- xv:csp -->';
const DATA_MARKER = '<!-- xv:data -->';
const DATA_GLOBAL = '__EXCAVATOR_EXPLORER_DATA__';

/** The sources the code viewer shows, by the file path of a node. */
const SOURCES = {
  'src/main.js': 'import { helper } from "./util.js";\n\nexport function main() {\n  return helper(1);\n}\n',
  'src/util.js': 'export function helper(n) {\n  return n + 1;\n}\n',
};

function sourceFile(path) {
  const content = SOURCES[path];
  return { path, language: 'javascript', content, sizeBytes: Buffer.byteLength(content), lineCount: content.split('\n').length - 1 };
}

/** A small graph in the dashboard's format: two layers, two files, four functions. */
export function fixtureData() {
  const node = (id, type, name, extra = {}) => ({ id, type, name, summary: `${name} summary`, tags: ['fixture'], complexity: 'simple', ...extra });
  const edge = (source, target, type) => ({ source, target, type, direction: 'forward', weight: 0.5 });
  const nodes = [
    node('file:src/main.js', 'file', 'main.js', { filePath: 'src/main.js' }),
    node('file:src/util.js', 'file', 'util.js', { filePath: 'src/util.js' }),
    node('function:src/main.js:main', 'function', 'main', { filePath: 'src/main.js', lineRange: [3, 5] }),
    node('function:src/util.js:helper', 'function', 'helper', { filePath: 'src/util.js', lineRange: [1, 3] }),
    node('function:src/util.js:leaf', 'function', 'leaf', { filePath: 'src/util.js', lineRange: [1, 3] }),
  ];
  const edges = [
    edge('file:src/main.js', 'function:src/main.js:main', 'contains'),
    edge('file:src/util.js', 'function:src/util.js:helper', 'contains'),
    edge('file:src/util.js', 'function:src/util.js:leaf', 'contains'),
    edge('file:src/main.js', 'file:src/util.js', 'imports'),
    edge('function:src/main.js:main', 'function:src/util.js:helper', 'calls'),
  ];
  const graph = {
    version: '1.0.0',
    project: { name: 'fixture', languages: ['javascript'], frameworks: [], description: 'A synthetic project.', analyzedAt: '2026-01-01T00:00:00.000Z', gitCommitHash: 'abc123' },
    nodes,
    edges,
    layers: [
      { id: 'layer:app', name: 'App', description: 'Entry points.', nodeIds: ['file:src/main.js', 'function:src/main.js:main'] },
      { id: 'layer:lib', name: 'Library', description: 'Helpers.', nodeIds: ['file:src/util.js', 'function:src/util.js:helper', 'function:src/util.js:leaf'] },
    ],
    tour: [{ order: 1, title: 'Start at main', description: 'main calls the helper.', nodeIds: ['file:src/main.js', 'function:src/util.js:helper'] }],
  };
  const domain = {
    version: '1.0.0',
    project: graph.project,
    nodes: [
      node('domain:run', 'domain', 'Running', { domainMeta: { entities: [], businessRules: [], crossDomainInteractions: [] } }),
      node('flow:run', 'flow', 'Run once', { domainMeta: { entryPoint: 'src/main.js', entryType: 'cli' } }),
      node('step:run:1', 'step', 'Call helper', { filePath: 'src/main.js', lineRange: [3, 5] }),
    ],
    edges: [edge('domain:run', 'flow:run', 'contains_flow'), edge('flow:run', 'step:run:1', 'flow_step')],
    layers: [],
    tour: [],
  };
  return {
    'knowledge-graph.json': graph,
    'domain-graph.json': domain,
    'meta.json': { lastAnalyzedAt: '2026-01-01T00:00:00.000Z', gitCommitHash: 'abc123', version: '1.0.0', analyzedFiles: 2 },
    sources: Object.fromEntries(Object.keys(SOURCES).map((path) => [path, sourceFile(path)])),
  };
}

/** The wait signal view-smoke.mjs needs: the dashboard has no ready attribute of its own, so the page's own markup says when it has drawn. */
const READY_SCRIPT = `(function(){var r=document.documentElement;var t=setInterval(function(){if(document.querySelector('.react-flow__node')||/Failed to load|Invalid knowledge graph/.test(document.body.innerText)){clearInterval(t);r.setAttribute('data-xv-ready','1');}},50);})();`;

const BACKSLASH = String.fromCharCode(92);
const jsonForScript = (value) => JSON.stringify(value).replace(/</g, `${BACKSLASH}u003c`);

/**
 * The template filled the way the packing step will: the policy at its marker
 * and the data at its marker; `fault` plants one defect the smoke must catch.
 */
export function assemble(template, data, fault = null) {
  for (const marker of [CSP_MARKER, DATA_MARKER]) {
    if (template.split(marker).length !== 2) throw new Error(`the template must contain ${marker} exactly once`);
  }
  let payload = data;
  let extraHead = '';
  let extraBody = '';
  if (fault === 'external-url') extraHead = '<link rel="stylesheet" href="https://example.invalid/planted.css">';
  else if (fault === 'thrown-error') extraBody = '<script>setTimeout(function(){throw new Error("planted fault");},200);</script>';
  else if (fault === 'no-graph') payload = { ...data, 'knowledge-graph.json': undefined };
  const csp = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">${extraHead}`;
  const dataScript = `<script>window.${DATA_GLOBAL}=${jsonForScript(payload)};${READY_SCRIPT}</script>${extraBody}`;
  return template.replace(CSP_MARKER, () => csp).replace(DATA_MARKER, () => dataScript);
}

/** Runs in the page once it has drawn: what the checks read. */
const PROBE = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test) => { for (let i = 0; i < 60; i++) { if (test()) return true; await sleep(50); } return false; };
  const cards = () => [...document.body.querySelectorAll('.react-flow__node')];
  const out = { title: document.title, cards: cards().length, drilled: false, codeShown: false };
  const header = [...document.body.querySelectorAll('div,span,p,h1,h2,h3')].find((e) => e.children.length === 0 && /GET STARTED/.test(e.textContent));
  out.onboardingHeader = header ? header.textContent : null;
  // The visible text names no upstream product (a slash command in an empty state is not the product name).
  out.upstreamName = /understand/i.test(document.body.innerText.replace(/[/]understand[-a-z]*/g, ''));
  // The legend counts what the top level draws: "<n> layers", or "<n> groups" when the graph had no layers.
  const legend = [...document.querySelectorAll('header span')].map((e) => /^\\d+ (layers|groups)$/.exec(e.textContent.trim())).find(Boolean);
  out.legend = legend ? legend[1] : null;
  if (out.cards === 0) return out;
  const skip = [...document.querySelectorAll('button')].find((b) => /Don't show again/.test(b.textContent));
  if (skip) skip.click();
  await sleep(300);
  // A layer card drills into the layer: the level's own cards replace the layers. A page without the fixture's layers has no such card.
  const app = cards().find((n) => /App/.test(n.textContent));
  if (!app) return out;
  app.click();
  out.drilled = await until(() => cards().some((n) => /Cluster/.test(n.textContent)));
  // A file's code opens from the file list by double-click and is read from the inlined sources.
  const tab = [...document.querySelectorAll('button')].filter((b) => /^files$/i.test(b.textContent.trim())).pop();
  tab.click();
  await sleep(200);
  const leaf = (text) => [...document.body.querySelectorAll('div,span,button')].find((e) => e.children.length === 0 && e.textContent.trim() === text);
  leaf('src').click();
  await sleep(200);
  leaf('main.js').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  out.codeShown = await until(() => /return helper[(]1[)]/.test(document.body.innerText));
  return out;
})()`;

function runChrome(html, { screenshot = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'explorer-smoke-'));
  try {
    const page = join(dir, 'explorer.html');
    writeFileSync(page, html);
    const args = [join(here, 'view-smoke.mjs'), page, '--width', '1440', '--height', '900', '--eval', PROBE];
    if (screenshot) args.push('--screenshot', resolve(screenshot));
    const run = spawnSync(process.execPath, args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    if (run.stdout.trim() === '') throw new Error(`view-smoke gave no result: ${run.stderr.trim()}`);
    return JSON.parse(run.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The three assertions, as `{ name, ok, detail }`, over one view-smoke result. */
export function judge(result) {
  const probe = result.evalResult && !result.evalResult.error ? result.evalResult : { cards: 0, title: null };
  const network = [...result.extraRequests, ...result.loadFailures, ...result.cspViolations.map((v) => `${v.directive} ${v.blocked}`)];
  const consoleProblems = [...result.consoleErrors, ...result.exceptions, ...result.logErrors];
  return [
    { name: 'network', ok: network.length === 0, detail: network.length === 0 ? 'no request, no failed load, no policy violation' : network.join('; ') },
    { name: 'console', ok: consoleProblems.length === 0, detail: consoleProblems.length === 0 ? 'no console error or exception' : consoleProblems.join('; ').slice(0, 300) },
    { name: 'cards', ok: probe.cards >= 2 && result.ready === '1', detail: `${probe.cards} cards at the top level (the fixture has 2 layers), ready=${result.ready}` },
    {
      name: 'content',
      ok: probe.title === 'Excavator' && /^EXCAVATOR/.test(probe.onboardingHeader ?? '') && probe.upstreamName === false && probe.drilled === true && probe.codeShown === true && probe.legend === 'layers',
      detail: `title=${probe.title} onboarding=${probe.onboardingHeader} upstreamName=${probe.upstreamName} layer drilled=${probe.drilled} code from inlined sources=${probe.codeShown} legend=${probe.legend}`,
    },
  ];
}

/** The fixture with no layers in its graph, as an analysis that writes none gives it. */
export function withoutLayers(data) {
  return { ...data, 'knowledge-graph.json': { ...data['knowledge-graph.json'], layers: [] } };
}

/** The assertions for the page whose graph has no layers: it is still clean, draws cards, and calls them groups. */
export function judgeNoLayers(result) {
  const probe = result.evalResult && !result.evalResult.error ? result.evalResult : { cards: 0, legend: null };
  const [network, consoleCheck] = judge(result);
  return [
    network,
    consoleCheck,
    { name: 'cards', ok: probe.cards >= 1 && result.ready === '1', detail: `${probe.cards} cards at the top level, ready=${result.ready}` },
    { name: 'groups', ok: probe.legend === 'groups', detail: `legend=${probe.legend}` },
  ];
}

function report(label, checks) {
  for (const check of checks) process.stdout.write(`${check.ok ? 'ok  ' : 'FAIL'} ${label} ${check.name}: ${check.detail}\n`);
  return checks.every((check) => check.ok);
}

function main(argv) {
  if (!existsSync(TEMPLATE)) throw new Error(`${TEMPLATE} does not exist: run \`pnpm -r build\` first`);
  const template = readFileSync(TEMPLATE, 'utf-8');
  const data = fixtureData();
  const shot = argv.includes('--screenshot') ? argv[argv.indexOf('--screenshot') + 1] : null;

  const clean = runChrome(assemble(template, data), { screenshot: shot });
  let ok = report('clean', judge(clean));
  ok = report('no-layers', judgeNoLayers(runChrome(assemble(template, withoutLayers(data))))) && ok;
  if (argv.includes('--self-check')) {
    // Each planted fault must turn the assertion it targets red, and the clean page's other assertions stay green.
    const planted = [
      { fault: 'external-url', red: 'network' },
      { fault: 'thrown-error', red: 'console' },
      { fault: 'no-graph', red: 'cards' },
    ];
    for (const { fault, red } of planted) {
      const checks = judge(runChrome(assemble(template, data, fault)));
      const target = checks.find((check) => check.name === red);
      const seen = !target.ok;
      process.stdout.write(`${seen ? 'ok  ' : 'FAIL'} planted ${fault}: ${red} is ${target.ok ? 'green (not caught)' : 'red'} (${target.detail.slice(0, 120)})\n`);
      ok = ok && seen;
    }
  }
  return ok;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)) ? 0 : 1);
  } catch (error) {
    process.stderr.write(`explorer-smoke failed: ${error.message}\n`);
    process.exit(1);
  }
}
