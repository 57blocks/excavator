#!/usr/bin/env node
// @ts-check
/**
 * Development helper, not part of the build:
 *
 *   node scripts/dev-data.mjs --out <report.html> [--template dist/prd-report-page.html] [--plain]
 *
 * Collects the page data of a synthetic run (a copy of the committed lane
 * fixture, aggregated the way the skill does) with `collectPageData`, injects
 * it into the built template and writes the page to `--out`, so it can be
 * opened in a browser. By default the run is enriched to exercise the page: a
 * wide table, a second `<details>` block, hostile raw HTML, a mermaid block
 * that does not parse, a failed and a planned feature, an unassigned entrypoint
 * and a framework without patterns; `--plain` keeps the fixture as it is.
 * The injection is `fillPageTemplate`, the function `prd.mjs page` uses, so this
 * page is the command's page; the script writes nothing under the repository.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectPageData } from '../../../skills/excavator-prd-report/lib/page-data.mjs';
import { fillPageTemplate } from '../../../skills/excavator-prd-report/lib/page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const prd = join(repo, 'skills/excavator-prd-report/prd.mjs');
const fixtures = join(repo, 'tests/fixtures/prd-report-pipeline/lanes');

function run(args) {
  const result = spawnSync(process.execPath, [prd, ...args], { encoding: 'utf-8' });
  if (result.status !== 0) throw new Error(`prd.mjs ${args.join(' ')} exited ${result.status}\n${result.stdout}${result.stderr}`);
  return result.stdout;
}

const RICH_CHAPTER = [
  '',
  '### Business rules',
  '',
  '| Rule | Applies to | Condition | Outcome | Notes |',
  '|---|---|---|---|---|',
  '| Quantity floor | Order form | quantity below 1 | The form shows an error and does not submit | The route does not repeat this check, so a direct request with quantity 0 reaches order creation |',
  '| Customer required | Order service | customerId missing | Order creation throws "customer is required" | The error text is not translated |',
  '',
  '> The form and the service each hold part of the rules; neither holds all of them.',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[Order form] --> B{quantity >= 1}',
  '  B -- yes --> C[POST /orders]',
  '  B -- no --> D[Show error]',
  '```',
  '',
  '```mermaid',
  'sequenceDiagram',
  '  this is not a valid diagram ->>>',
  '```',
  '',
  'Raw HTML in a chapter is cleaned: <script>window.__xss = 1</script><img src="x" alt="hostile image" onerror="window.__xss = 2"><iframe src="about:blank"></iframe>the three tags above do nothing.',
  '',
  '<details open><summary>Open by default</summary>',
  '',
  'A second evidence block, open when the page loads, with `src/orders/service.js:3-8` in it.',
  '',
  '</details>',
  '',
].join('\n');

/** Build the run in a fresh temp directory and return { project, out, cleanup }. */
export function buildRun(plain) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'xprd-page-dev-')));
  const project = join(root, 'project');
  const out = join(root, 'out');
  cpSync(join(fixtures, 'project'), project, { recursive: true });
  cpSync(join(fixtures, 'out'), out, { recursive: true });
  const indexPath = join(out, 'index.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf-8').replace('__PROJECT_ROOT__', project));
  if (!plain) {
    index.candidates.items.push(
      { id: 'c3', kind: 'job', file: 'src/orders/service.js', line: 15, text: 'function reopenOrder(order) {', framework: 'custom', provenance: 'inferred' },
      { id: 'c4', kind: 'route', file: 'src/orders/routes.js', line: 8, text: 'module.exports = router;', framework: 'custom', provenance: 'inferred' },
      { id: 'c9', kind: 'route', file: 'src/orders/routes.js', line: 7, text: 'router.get("/orders", list);', framework: 'express', provenance: 'inferred' },
    );
    index.features.push(
      { id: 'F3', name: 'Order reopening', kind: 'automated', chapter: 3, entrypoints: ['c3'], seedFiles: ['src/orders/service.js'], tiers: ['backend'] },
      { id: 'F4', name: 'Order export', kind: 'flow', chapter: 4, entrypoints: ['c4'], seedFiles: ['src/orders/routes.js'], tiers: ['backend'] },
    );
    index.unassigned = ['c9'];
    index.candidates.uncovered = ['spring'];
    for (const [id, finding] of [
      ['F1', { id: 'F1-2', class: 'technical', statement: 'createOrder stores the quantity it is given without checking it, so a quantity of zero or below becomes an order.', flows: ['F1'], evidence: [{ file: 'src/orders/service.js', passage: "return { id: ++lastId, status: 'open', quantity: input.quantity };" }] }],
      ['F2', { id: 'F2-2', class: 'product', statement: 'A support agent can cancel an order that is already cancelled; the second cancel changes nothing and reports no error.', flows: ['F2'], evidence: [{ file: 'src/orders/service.js', passage: 'function cancelOrder(order) {' }] }],
    ]) {
      const path = join(out, `findings/${id}.json`);
      const lane = JSON.parse(readFileSync(path, 'utf-8'));
      lane.findings.push(finding);
      writeFileSync(path, `${JSON.stringify(lane, null, 2)}\n`);
    }
    const chapter = join(out, 'features/F1.md');
    writeFileSync(chapter, readFileSync(chapter, 'utf-8').trimEnd() + '\n' + RICH_CHAPTER);
  }
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  run(['check-index', out, '--project', project]);
  if (!plain) run(['mark', out, 'F3', 'failed', 'lane', 'the lane wrote nothing after two attempts', '--project', project]);
  run(['aggregate', out, '--project', project]);
  return { project, out, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function main(argv) {
  const options = { out: '', template: join(here, '../dist/prd-report-page.html'), plain: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') options.out = argv[++i];
    else if (argv[i] === '--template') options.template = resolve(argv[++i]);
    else if (argv[i] === '--plain') options.plain = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (options.out === '') throw new Error('--out <report.html> is required');
  const template = readFileSync(options.template, 'utf-8');
  const run = buildRun(options.plain);
  try {
    const data = collectPageData(run.out, run.project);
    const page = fillPageTemplate(template, data);
    mkdirSync(dirname(resolve(options.out)), { recursive: true });
    writeFileSync(options.out, page);
    process.stdout.write(`${resolve(options.out)} ${Buffer.byteLength(page)} bytes, ${data.features.length} features, ${data.findings.length} findings\n`);
  } finally {
    run.cleanup();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
