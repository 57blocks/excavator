#!/usr/bin/env node
/**
 * reply.mjs
 *
 * Prints the four lines `/excavator-view` replies with, read from the page
 * `pack.mjs` wrote (openspec: changes/report-viewer, design D7):
 *
 *   View: <absolute path>
 *   Size: <size in MB, one decimal> MB
 *   Products: knowledge graph <state>; unused code <state>; doc map <state>; hotspots <state>; reports <state>
 *   Source: <embedded (N files) | not embedded>
 *
 *   node reply.mjs <page.html>
 *
 * The states come from the manifest inside the page, so the reply states what
 * the page holds. One command prints all four lines, which keeps the model from
 * folding an earlier command's output into the reply.
 */

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST_OPEN = '<script type="application/json" id="xv-manifest">';
const BYTES_PER_MB = 1024 * 1024;
const PRODUCT_WORDS = [
  ['knowledge-graph', 'knowledge graph'],
  ['unused-code', 'unused code'],
  ['doc-map', 'doc map'],
  ['hotspots', 'hotspots'],
  ['reports', 'reports'],
];

/** The manifest the packer inlined, parsed from the page text. */
export function readManifest(html) {
  const start = html.indexOf(MANIFEST_OPEN);
  const end = start === -1 ? -1 : html.indexOf('</script>', start);
  if (end === -1) throw new Error('the page has no manifest');
  return JSON.parse(html.slice(start + MANIFEST_OPEN.length, end));
}

/** The four reply lines for a page at `path` of `bytes` bytes. */
export function replyLines(path, bytes, manifest) {
  const states = new Map(manifest.products.map((p) => [p.name, p.status.replace(/-/g, ' ')]));
  const source = manifest.source && manifest.source.embedded
    ? `embedded (${manifest.source.counts.embedded} files)`
    : 'not embedded';
  return [
    `View: ${path}`,
    `Size: ${(bytes / BYTES_PER_MB).toFixed(1)} MB`,
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
    process.stdout.write(`${replyLines(path, statSync(path).size, manifest).join('\n')}\n`);
  } catch (error) {
    process.stderr.write(`excavator-view reply failed: ${error.message}\n`);
    process.exit(1);
  }
}
