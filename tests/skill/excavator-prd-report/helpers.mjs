/**
 * Shared helpers for the excavator-prd-report script tests: run `prd.mjs` as a CLI
 * and copy the committed synthetic fixtures into temporary directories. Every
 * project here is purpose-built; nothing is derived from a real project.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
