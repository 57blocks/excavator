#!/usr/bin/env node
/**
 * reply.mjs
 *
 * Prints the five lines `/excavator-view` replies with, read from the pages
 * `pack.mjs` wrote (openspec: changes/report-viewer, design D7;
 * changes/viewer-explorer, design D4):
 *
 *   View: <absolute path>
 *   Size: <size in MB, one decimal> MB
 *   Explorer: <absolute path>; <N> issues
 *   Products: knowledge graph <state>; unused code <state>; doc map <state>; hotspots <state>; tour <state>; reports <state>
 *   Source: <embedded (N files) | not embedded>
 *
 *   node reply.mjs <page.html>
 *
 * The states come from the manifest inside the page, so the reply states what
 * the page holds. The explorer page is the `explorer.html` beside `page.html`;
 * `N` is the number of issues the explorer copy's own validator found in the graph
 * (written into that page's manifest at pack time). When the page has no knowledge
 * graph there is no count, and the line says the graph's state instead:
 * `Explorer: <absolute path>; knowledge graph <state>`. One command prints all
 * five lines, which keeps the model from folding an earlier command's output into
 * the reply; every word of the lines is written here, so the language of the
 * lines never depends on the model.
 */

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST_OPEN = '<script type="application/json" id="xv-manifest">';
const EXPLORER_MANIFEST_OPEN = '<script type="application/json" id="xv-explorer-manifest">';
const EXPLORER_FILE = 'explorer.html';
const BYTES_PER_MB = 1024 * 1024;
const PRODUCT_WORDS = [
  ['knowledge-graph', 'knowledge graph'],
  ['unused-code', 'unused code'],
  ['doc-map', 'doc map'],
  ['hotspots', 'hotspots'],
  ['tour', 'tour'],
  ['reports', 'reports'],
];

function readBlock(html, open, missing) {
  const start = html.lastIndexOf(open);
  const end = start === -1 ? -1 : html.indexOf('</script>', start);
  if (end === -1) throw new Error(missing);
  return JSON.parse(html.slice(start + open.length, end));
}

/** The manifest the packer inlined, parsed from the page text. */
export function readManifest(html) {
  const start = html.indexOf(MANIFEST_OPEN);
  const end = start === -1 ? -1 : html.indexOf('</script>', start);
  if (end === -1) throw new Error('the page has no manifest');
  return JSON.parse(html.slice(start + MANIFEST_OPEN.length, end));
}

/** The manifest of an explorer page (its data block comes first and is large; the manifest is the last block). */
export function readExplorerManifest(html) {
  return readBlock(html, EXPLORER_MANIFEST_OPEN, 'the explorer page has no manifest');
}

/** The explorer line: the issue count when the page has a graph, else the graph's own state. */
export function explorerLine(path, manifest) {
  if (manifest.issues) return `Explorer: ${path}; ${manifest.issues.total} issues`;
  const row = manifest.rows.find((item) => item.key === 'knowledge-graph.json');
  return `Explorer: ${path}; knowledge graph ${row ? row.status.replace(/-/g, ' ') : 'not run'}`;
}

/**
 * The five reply lines for a page at `path` of `bytes` bytes.
 * @param {{ path: string, manifest: object }} explorer the explorer page beside it
 */
export function replyLines(path, bytes, manifest, explorer) {
  const states = new Map(manifest.products.map((p) => [p.name, p.status.replace(/-/g, ' ')]));
  const source = manifest.source && manifest.source.embedded
    ? `embedded (${manifest.source.counts.embedded} files)`
    : 'not embedded';
  return [
    `View: ${path}`,
    `Size: ${(bytes / BYTES_PER_MB).toFixed(1)} MB`,
    explorerLine(explorer.path, explorer.manifest),
    `Products: ${PRODUCT_WORDS.map(([name, word]) => `${word} ${states.get(name) ?? 'not run'}`).join('; ')}`,
    `Source: ${source}`,
  ];
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    const [pageArg] = process.argv.slice(2);
    if (!pageArg) throw new Error('Usage: node reply.mjs <page.html>');
    const path = resolve(pageArg);
    const manifest = readManifest(readFileSync(path, 'utf-8'));
    const explorerPath = join(dirname(path), EXPLORER_FILE);
    const explorer = { path: explorerPath, manifest: readExplorerManifest(readFileSync(explorerPath, 'utf-8')) };
    process.stdout.write(`${replyLines(path, statSync(path).size, manifest, explorer).join('\n')}\n`);
  } catch (error) {
    process.stderr.write(`excavator-view reply failed: ${error.message}\n`);
    process.exit(1);
  }
}
