/**
 * page-assembly.mjs
 *
 * Builds the self-contained page from the template `packages/explorer` builds
 * (openspec: changes/viewer-app, design D9; changes/viewer-explorer, design D4):
 * insert the Content-Security-Policy where the template has its `<!-- xv:csp -->`
 * marker, and the data object and the manifest where it has `<!-- xv:data -->`.
 * It only replaces those two markers; every other byte is the template's. A
 * template that was not built is an error that says to build it.
 *
 * The data goes in as an index block and gzip+base64 parts (data-chunks.mjs;
 * openspec: changes/explorer-chunked-data, design D2-D5), and the page is joined
 * from Buffers, so no string of the page's size is ever made.
 *
 * Deterministic: keys in the order the caller built them, no pack time.
 */

import { readFileSync } from 'node:fs';

import { chunkExplorerData } from './data-chunks.mjs';

/** No connection of any kind, scripts and styles only inline, images and fonts only data: URLs (the inlined fonts), workers only blob: URLs (the graph layout's inline worker). */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  "connect-src 'none'",
  'font-src data:',
  "base-uri 'none'",
  "form-action 'none'",
  'worker-src blob:',
].join('; ');

const BACKSLASH = String.fromCharCode(92);
const CSP_MARKER = '<!-- xv:csp -->';
const DATA_MARKER = '<!-- xv:data -->';

/** Where the built template is, relative to the plugin root. */
export const EXPLORER_TEMPLATE_PATH = 'packages/explorer/dist/explorer.html';

export const INDEX_BLOCK_ID = 'xv-explorer-index';

/** JSON for a `<script type="application/json">`: every `<` is written as a unicode escape, so no content can close the element. */
export function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, `${BACKSLASH}u003c`);
}

/** The template's text; a template that is not there was never built. */
function readTemplate(templatePath, label) {
  try {
    return readFileSync(templatePath, 'utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`the ${label} template ${templatePath} does not exist: run \`pnpm build\` at the plugin root to build it`);
    }
    throw error;
  }
}

/** The template as Buffers with the policy and `dataPieces` at its two markers; every other byte is the template's. */
function fillTemplate(templatePath, label, dataPieces) {
  const html = readTemplate(templatePath, label);
  for (const marker of [CSP_MARKER, DATA_MARKER]) {
    if (html.split(marker).length !== 2) throw new Error(`the ${label} template ${templatePath} must contain ${marker} exactly once; run \`pnpm build\` to rebuild it`);
  }
  const csp = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">`;
  const [before, after] = html.replace(CSP_MARKER, () => csp).split(DATA_MARKER);
  return Buffer.concat([Buffer.from(before, 'utf-8'), ...dataPieces.map((piece) => (typeof piece === 'string' ? Buffer.from(piece, 'utf-8') : piece)), Buffer.from(after, 'utf-8')]);
}

/**
 * The explorer page: the index block `xv-explorer-index`, one `xv-part-<n>` block per
 * compressed part of the data, then the pack's manifest block `xv-explorer-manifest`, which the reply reads.
 * The parts are base64, so no content can close the element.
 * @param {{ templatePath: string, data?: object, chunks?: ReturnType<typeof chunkExplorerData>, manifest: object, partChars?: number }} input
 *   `chunks` is `chunkExplorerData(data)` when the caller already made it (the pack does, for the manifest's sizes);
 *   `partChars` replaces the part limit (the tests use a tiny one)
 * @returns {Buffer} the HTML file
 */
export function assembleExplorerPage({ templatePath, data, chunks, manifest, partChars }) {
  const { index, parts } = chunks ?? chunkExplorerData(data, { partChars });
  const pieces = [`<script type="application/json" id="${INDEX_BLOCK_ID}">${jsonForScript(index)}</script>\n`];
  for (const part of parts) {
    pieces.push(`<script type="application/octet-stream" id="${part.id}">`, part.base64, '</script>\n');
  }
  pieces.push(`<script type="application/json" id="xv-explorer-manifest">${jsonForScript(manifest)}</script>`);
  return fillTemplate(templatePath, 'explorer', pieces);
}
