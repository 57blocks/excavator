#!/usr/bin/env node
/**
 * reply.mjs
 *
 * Prints the five lines `/excavator-view` replies with, read from the page
 * `pack.mjs` wrote (openspec: changes/report-viewer, design D7;
 * changes/retire-view-html, design D2-D3):
 *
 *   Explorer: <absolute path>
 *   Size: <size in MB, one decimal> MB
 *   Issues: <N>
 *   Products: knowledge graph <state>; semantics <state>; domain graph <state>; unused code <state>; doc map <state>; hotspots <state>; tour <state>
 *   Source: <embedded (N files) | not embedded>
 *
 *   node reply.mjs <explorer.html>
 *
 * Everything but the size comes from the manifest the packer wrote into the page,
 * so the reply states what the page holds. `N` is the number of issues the explorer
 * copy's own validator found in the graph at pack time; when the page has no
 * knowledge graph there is no count, and the line says the graph's state instead:
 * `Issues: not counted; knowledge graph <state>`. One command prints all five
 * lines, which keeps the model from folding an earlier command's output into the
 * reply; every word of the lines is written here, so the language of the lines
 * never depends on the model.
 */

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST_OPEN = '<script type="application/json" id="xv-explorer-manifest">';
const BYTES_PER_MB = 1024 * 1024;
const PRODUCT_WORDS = [
  ['knowledge-graph', 'knowledge graph'],
  ['semantics', 'semantics'],
  ['domain-graph', 'domain graph'],
  ['unused-code', 'unused code'],
  ['doc-map', 'doc map'],
  ['hotspots', 'hotspots'],
  ['tour', 'tour'],
];

/** The manifest of a packed page (its data block comes first and is large; the manifest is the last block). */
export function readExplorerManifest(html) {
  const start = html.lastIndexOf(MANIFEST_OPEN);
  const end = start === -1 ? -1 : html.indexOf('</script>', start);
  if (end === -1) throw new Error('the page has no manifest');
  return JSON.parse(html.slice(start + MANIFEST_OPEN.length, end));
}

const stateWords = (manifest) => new Map((manifest.products ?? []).map((p) => [p.name, p.status.replace(/-/g, ' ')]));

/** The issues line: the count when the page has a graph, else the graph's own state. */
export function issuesLine(manifest) {
  if (manifest.issues) return `Issues: ${manifest.issues.total}`;
  return `Issues: not counted; knowledge graph ${stateWords(manifest).get('knowledge-graph') ?? 'not run'}`;
}

/** The five reply lines for a page at `path` of `bytes` bytes. */
export function replyLines(path, bytes, manifest) {
  const states = stateWords(manifest);
  const source = manifest.source && manifest.source.embedded
    ? `embedded (${manifest.source.counts.embedded} files)`
    : 'not embedded';
  return [
    `Explorer: ${path}`,
    `Size: ${(bytes / BYTES_PER_MB).toFixed(1)} MB`,
    issuesLine(manifest),
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
    if (!pageArg) throw new Error('Usage: node reply.mjs <explorer.html>');
    const path = resolve(pageArg);
    const manifest = readExplorerManifest(readFileSync(path, 'utf-8'));
    process.stdout.write(`${replyLines(path, statSync(path).size, manifest).join('\n')}\n`);
  } catch (error) {
    process.stderr.write(`excavator-view reply failed: ${error.message}\n`);
    process.exit(1);
  }
}
