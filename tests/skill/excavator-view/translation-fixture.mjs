/**
 * A synthetic project for the name-translation tests: a graph whose nodes carry display names (fresh, stale,
 * duplicated and contradicted ones), a domain graph, and helpers that run `translations.mjs` and read its files.
 * Nothing here is derived from a real project.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { domainGraph, factGraphJsonl, semanticCache, semanticEntry, semanticGraph, sourceManifest, writeProduct } from './fixture.mjs';
import { repoRoot } from './plugin-fixture.mjs';

export const DIGEST = 'a'.repeat(64);
const HASH = { a: '1'.repeat(64), b: '2'.repeat(64), c: '3'.repeat(64) };

export const TRANSLATIONS_SCRIPT = join(repoRoot, 'skills/excavator-view/translations.mjs');

export const sha256 = (text) => createHash('sha256').update(text, 'utf-8').digest('hex');

// What the page shows for the fixture, sorted: the fresh node display names (one of them on two nodes) and the domain graph's names.
// "Old stale name" (a stale entry) and "Secret contradicted name" (a contradicted entry) are not shown.
export const DISPLAYED = [
  'Billing',
  'Charge a customer',
  'Dispatch a parcel',
  'Handle GET request',
  'Run `make build`',
  'Shipping',
  'Start the application',
  'Validate OAuth2 token',
  'capture',
  'pick',
  'receipt',
  'validate',
];
export const NOT_SHOWN = ['Old stale name', 'Secret contradicted name'];

const NODES = [
  { id: 'file:src/a.js', filePath: 'src/a.js' },
  { id: 'function:src/a.js:run', filePath: 'src/a.js' },
  { id: 'file:src/b.js', filePath: 'src/b.js' },
  { id: 'function:src/b.js:load', filePath: 'src/b.js' },
  { id: 'function:src/c.js:x', filePath: 'src/c.js' },
];

/** The knowledge graph, the semantic product and a domain graph, written under the project's `.excavator/`. */
export function writeTranslatableProducts(project, { domain = true, domainNodes = null } = {}) {
  const { root, revision } = project;
  writeProduct(root, 'knowledge-graph.jsonl', factGraphJsonl({ factsDigest: DIGEST, structureDigest: DIGEST, nodes: NODES }));
  writeProduct(root, 'source-manifest.json', sourceManifest(revision, [
    { path: 'src/a.js', contentHash: HASH.a },
    { path: 'src/b.js', contentHash: HASH.b },
    { path: 'src/c.js', contentHash: HASH.c },
  ]));
  const entries = {
    'file:src/a.js': { summary: 'Entry point.', displayName: 'Start the application', semanticSourceHash: HASH.a },
    'function:src/a.js:run': { summary: 'Checks a token.', displayName: 'Validate OAuth2 token', semanticSourceHash: HASH.a },
    'file:src/b.js': { summary: 'Another entry point.', displayName: 'Start the application', semanticSourceHash: HASH.b },
    'function:src/b.js:load': { summary: 'Loads data.', displayName: 'Old stale name', semanticSourceHash: '9'.repeat(64) },
    'function:src/c.js:x': { summary: 'Opens a socket and retries forever.', displayName: 'Secret contradicted name', semanticSourceHash: HASH.c, verification: 'contradicted' },
  };
  writeProduct(root, 'semantic-cache.json', semanticCache(Object.fromEntries(Object.entries(entries).map(([id, fields]) => [id, semanticEntry(fields)]))));
  writeProduct(root, 'semantic-graph.json', semanticGraph({ structureDigest: DIGEST, layers: [] }));
  if (!domain) return;
  const graph = domainGraph({ sourceRevision: revision, factDigest: DIGEST });
  if (domainNodes === null) {
    graph.nodes.push(
      { id: 'step:charge:fetch', type: 'step', name: 'Handle GET request', summary: 'Reads.', filePath: 'src/a.js', nodeIds: ['file:src/a.js'] },
      { id: 'step:charge:build', type: 'step', name: 'Run `make build`', summary: 'Builds.', filePath: 'src/a.js', nodeIds: ['file:src/a.js'] },
    );
  } else {
    graph.nodes = domainNodes;
    graph.edges = [];
  }
  writeProduct(root, 'domain-graph.json', graph);
}

/** Domain steps named "Step number <i>" for i in 1..count, with one domain and one flow, for the batch-size tests. */
export function manyStepNodes(count) {
  const nodes = [
    { id: 'domain:d', type: 'domain', name: 'Only domain', summary: 'x', tags: [], complexity: 'simple' },
    { id: 'flow:f', type: 'flow', name: 'Only flow', summary: 'x', tags: [], complexity: 'simple' },
  ];
  for (let i = 1; i <= count; i++) nodes.push({ id: `step:f:${i}`, type: 'step', name: `Step number ${i}`, summary: 'x', filePath: 'src/a.js', nodeIds: ['file:src/a.js'] });
  return nodes;
}

/** Run `translations.mjs <args>`; returns { status, stdout, stderr, json }. */
export function runTranslations(...args) {
  const run = spawnSync(process.execPath, [TRANSLATIONS_SCRIPT, ...args], { encoding: 'utf-8' });
  let json = null;
  try {
    json = JSON.parse(run.stdout);
  } catch {
    json = null;
  }
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, json };
}

export const tableDir = (pageDir) => join(pageDir, 'view-translations');
export const tablePath = (pageDir, name) => join(tableDir(pageDir), `${name}.json`);
export const workDir = (pageDir, name) => join(tableDir(pageDir), `work-${name}`);

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf-8'));

/** Write a translation table by hand: entries is [{ en, text, key? , storedEn? }]; key defaults to sha256(en), the stored English to en. */
export function writeTable(pageDir, name, entries) {
  const table = { format: 'excavator-view-translations/1', language: name, entries: {} };
  for (const { en, text, key, storedEn } of entries) table.entries[key ?? sha256(en)] = { en: storedEn ?? en, text };
  mkdirSync(tableDir(pageDir), { recursive: true });
  writeFileSync(tablePath(pageDir, name), JSON.stringify(table));
  return tablePath(pageDir, name);
}

/** The batch a `plan` result names, read back. */
export const readBatch = (entry) => readJson(entry.batch);

/** Write the result file of a batch from a function of the English name (undefined leaves the key out); `extra` adds keys. */
export function answerBatch(entry, answer, extra = {}) {
  const batch = readBatch(entry);
  const result = {};
  for (const item of batch.items) {
    const text = answer(item.en);
    if (text !== undefined) result[item.key] = text;
  }
  writeFileSync(entry.result, JSON.stringify({ ...result, ...extra }));
}

/** Every file under a directory, relative and sorted; [] when it does not exist. */
export function listTree(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTree(path, base));
    else out.push(path.slice(base.length + 1));
  }
  return out.sort();
}

export const pageDirOf = (project) => join(project.root, '.excavator');
export const outsideOf = (path) => dirname(path);
