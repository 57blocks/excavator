/**
 * Shared helpers for the excavator-prd-report script tests: run `prd.mjs` as a CLI
 * and copy the committed synthetic fixtures into temporary directories. Every
 * project here is purpose-built; nothing is derived from a real project.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '../../..');
export const PRD_SCRIPT = join(repoRoot, 'skills/excavator-prd-report/prd.mjs');
export const CATALOG_PATH = join(repoRoot, 'skills/excavator-prd-report/entrypoint-catalog.json');
export const FIXTURES = join(repoRoot, 'tests/fixtures/prd-report-pipeline');

/** Run `node prd.mjs <args>`; returns { status, stdout, stderr, json } (json is null when stdout is not JSON). */
export function runPrd(args, options = {}) {
  const result = spawnSync(process.execPath, [PRD_SCRIPT, ...args], { encoding: 'utf-8', ...options });
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = null;
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

/** A fresh temp directory (realpath'd so path comparisons hold on macOS); returns { root, cleanup }. */
export function makeTempDir(prefix = 'xprd-') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Copy a committed fixture project into `dest` (created when missing). */
export function copyFixture(name, dest) {
  mkdirSync(dest, { recursive: true });
  cpSync(join(FIXTURES, name), dest, { recursive: true });
  return dest;
}

/** Write `files` ({ relPath: text }) under `root`, creating directories. */
export function writeFiles(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
}

/** A knowledge-graph header line naming `frameworks`, in the line-store layout. */
export function graphHeaderLine(frameworks) {
  return `${JSON.stringify({
    record: 'header',
    format: 'excavator-knowledge-graph-lines/1',
    keys: ['version', 'project', 'nodes', 'edges'],
    fields: { version: '1', project: { name: 'synthetic', languages: [], frameworks } },
    counts: { nodes: 0, edges: 0 },
  })}\n`;
}

/** Each candidate as `file:line kind framework`, the form the tests compare. */
export function itemKeys(items) {
  return items.map((item) => `${item.file}:${item.line} ${item.kind} ${item.framework}`);
}

/**
 * Copy the lane fixture (a synthetic project and a run's out directory) into
 * a temp directory and point index.json at the copied project. Returns
 * { root, project, out, cleanup, readIndex, writeIndex, readJson, writeJson }.
 */
export function makeLaneRun() {
  const { root, cleanup } = makeTempDir('xprd-lane-');
  const project = join(root, 'project');
  const out = join(root, 'out');
  cpSync(join(FIXTURES, 'lanes/project'), project, { recursive: true });
  cpSync(join(FIXTURES, 'lanes/out'), out, { recursive: true });
  const indexPath = join(out, 'index.json');
  writeFileSync(indexPath, readFileSync(indexPath, 'utf-8').replace('__PROJECT_ROOT__', project));
  const readJson = (rel) => JSON.parse(readFileSync(join(out, rel), 'utf-8'));
  const writeJson = (rel, value) => writeFileSync(join(out, rel), `${JSON.stringify(value, null, 2)}\n`);
  return {
    root,
    project,
    out,
    cleanup,
    readJson,
    writeJson,
    readIndex: () => readJson('index.json'),
    writeIndex: (value) => writeJson('index.json', value),
    readText: (rel) => readFileSync(join(out, rel), 'utf-8'),
    writeText: (rel, text) => writeFileSync(join(out, rel), text),
  };
}

/**
 * Replace feature `id`'s findings file with `count` findings, ids `<id>-1` to
 * `<id>-<count>`, each quoting its own marker line, which this appends to the
 * run's src/orders/service.js (so every passage occurs exactly once). Call it
 * once per feature. `descending` writes the file in the reverse order.
 */
export function writeLaneFindings(run, id, count, { descending = false } = {}) {
  const service = join(run.project, 'src/orders/service.js');
  const findings = [];
  for (let k = 1; k <= count; k += 1) {
    const passage = `// marker ${id}-${k} end`;
    appendFileSync(service, `${passage}\n`);
    findings.push({
      id: `${id}-${k}`, class: k % 2 === 0 ? 'product' : 'technical', statement: `Defect ${k} of ${id}.`, flows: [id],
      evidence: [{ file: 'src/orders/service.js', passage }],
    });
  }
  run.writeJson(`findings/${id}.json`, { findings: descending ? findings.reverse() : findings });
}

/** Write `priorities/<id>.json` from `entries` ({ id, priority, reason }). */
export function writeRanks(run, id, entries) {
  mkdirSync(join(run.out, 'priorities'), { recursive: true });
  run.writeJson(`priorities/${id}.json`, { priorities: entries });
}

/** One entry of a priorities file; the reason is a plain sentence with no advice word. */
export const rankEntry = (id, priority, reason = 'Meets the criterion; every user of the flow is affected.') => ({ id, priority, reason });

/**
 * Add feature `id` (F3, F4, ...) to the run as a written lane: a chapter
 * copied from F2's with its own id, `count` findings, and no verification
 * reply, so its status is `checked`. Writes index.json and the lane files.
 */
export function addWrittenFeature(run, id, count) {
  const index = run.readIndex();
  const n = Number(id.slice(1));
  index.candidates.items.push({ id: `c${n}`, kind: 'job', file: 'src/orders/service.js', line: 15, text: 'function reopenOrder(order) {', framework: 'custom', provenance: 'inferred' });
  index.features.push({ id, name: `Feature ${id}`, kind: 'flow', chapter: n, entrypoints: [`c${n}`], seedFiles: ['src/orders/service.js'], tiers: ['backend'] });
  run.writeIndex(index);
  run.writeText(`features/${id}.md`, run.readText('features/F2.md').replace('id: F2', `id: ${id}`).replace('chapter: 2', `chapter: ${n}`).replace('name: Order cancellation', `name: Feature ${id}`));
  writeLaneFindings(run, id, count);
}

/**
 * The run of oracle O3 (change prd-report-prd-shape): the lane fixture with its
 * two flow chapters moved to chapters 2 and 3, a `reference` feature F3 at
 * chapter 1, and a failed feature F4 at chapter 4.
 *   F3 reference   chapter 1; a `### Order placement` heading that repeats F1's `##` one
 *   F1 flow        chapter 2; an open items section, `### Open items`, last
 *   F2 flow        chapter 3; two flows with the same heading, `### Cancel an order`
 *   F4 flow        failed, no files, two attempts
 * Writes the index and the lane files; the index is not checked or aggregated.
 */
export function makeSkeletonRun() {
  const run = makeLaneRun();
  const index = run.readIndex();
  index.candidates.items.push({ id: 'c3', kind: 'job', file: 'src/orders/service.js', line: 15, text: 'function reopenOrder(order) {', framework: 'custom', provenance: 'inferred' });
  index.features[0].chapter = 2;
  index.features[1].chapter = 3;
  index.features.push(
    { id: 'F3', name: 'Roles and permissions', kind: 'reference', chapter: 1, entrypoints: [], seedFiles: ['src/orders/service.js'], tiers: ['backend'] },
    {
      id: 'F4', name: 'Order reopening', kind: 'automated', chapter: 4, entrypoints: ['c3'], seedFiles: ['src/orders/service.js'], tiers: ['backend'],
      attempts: 2, failure: { step: 'lane', reasons: ['the lane wrote nothing'] },
    },
  );
  index.glossary = [
    { term: 'Order', meaning: 'A customer\'s request for goods, with a status of open or cancelled.' },
    { term: 'Cancelled | void', meaning: 'An order a support agent ended.' },
  ];
  run.writeIndex(index);

  run.writeText('features/F1.md', run.readText('features/F1.md')
    .replace('chapter: 1', 'openItems: Open items\nchapter: 2')
    .concat('\n### Open items\n\n| Item | What is known | What was searched |\n|---|---|---|\n| Whether open orders expire | The status never changes on its own | `src/orders/service.js`, the whole project |\n'));
  run.writeText('features/F2.md', run.readText('features/F2.md')
    .replace('chapter: 2', 'chapter: 3')
    .replace('flows: [Flow 1: Cancel an order]', 'flows: [Cancel an order, Cancel an order]')
    .replace('### Flow 1: Cancel an order', '### Cancel an order\n\nA support agent cancels an open order.\n\n### Cancel an order\n\nA customer asks support to cancel; the agent cancels it the same way.'));
  run.writeText('features/F3.md', `---
id: F3
name: Roles and permissions
kind: reference
actors: []
permissionRoles: [admin, normal]
triggers: []
flows: []
chapter: 1
---
## Roles and permissions

Who may do what to an order.

### Order placement

| Role | Place | Cancel |
|---|---|---|
| normal | yes | no |
| admin | yes | yes |

\`\`\`mermaid
flowchart LR
  normal --> place
  admin --> cancel
\`\`\`

<details><summary>Evidence</summary>

- Status change — \`src/orders/service.js:10-13\`

</details>
`);
  run.writeJson('findings/F3.json', { findings: [] });
  return run;
}
