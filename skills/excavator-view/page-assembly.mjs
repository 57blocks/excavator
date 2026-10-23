/**
 * page-assembly.mjs
 *
 * Builds the self-contained page from the template `packages/report-view`
 * builds (openspec: changes/viewer-app, design D9): insert the
 * Content-Security-Policy where the template has its `<!-- xv:csp -->` marker
 * and the manifest and data payloads where it has `<!-- xv:data -->`. It only
 * replaces those two markers; every other byte is the template's. A template
 * that was not built is an error that says to build it.
 *
 * `assembleExplorerPage` does the same for the explorer copy's template, with the same
 * policy and the same two markers, and puts the data object where the copy reads it
 * (openspec: changes/viewer-explorer, design D4).
 *
 * Deterministic: gzip with a zero mtime and a fixed level, payloads in the
 * order given, manifest keys in the order the caller built them, no pack time.
 */

import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

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

/** Where the built templates are, relative to the plugin root. */
export const TEMPLATE_PATH = 'packages/report-view/dist/view.html';
export const EXPLORER_TEMPLATE_PATH = 'packages/explorer/dist/explorer.html';

/** The global the explorer copy reads its data from. */
export const EXPLORER_DATA_GLOBAL = '__EXCAVATOR_EXPLORER_DATA__';

/** JSON for a `<script type="application/json">`: every `<` is written as a unicode escape, so no content can close the element. */
export function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, `${BACKSLASH}u003c`);
}

/** base64(gzip(bytes)) with a zero header mtime and a fixed OS byte, so equal bytes give equal text. */
export function encodePayload(bytes) {
  const zipped = gzipSync(bytes, { level: 9 });
  zipped.writeUInt32LE(0, 4);
  zipped[9] = 3;
  return zipped.toString('base64');
}

function dataBlocks(manifest, payloads) {
  const blocks = [`<script type="application/json" id="xv-manifest">${jsonForScript(manifest)}</script>`];
  for (const { id, bytes } of payloads) {
    blocks.push(`<script type="application/octet-stream" id="xv-${id}">${encodePayload(bytes)}</script>`);
  }
  return blocks.join('\n');
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

/** The template with the policy and `dataHtml` at its two markers; every other byte is the template's. */
function fillTemplate(templatePath, label, dataHtml) {
  const html = readTemplate(templatePath, label);
  for (const marker of [CSP_MARKER, DATA_MARKER]) {
    if (html.split(marker).length !== 2) throw new Error(`the ${label} template ${templatePath} must contain ${marker} exactly once; run \`pnpm build\` to rebuild it`);
  }
  const csp = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">`;
  return Buffer.from(html.replace(CSP_MARKER, () => csp).replace(DATA_MARKER, () => dataHtml), 'utf-8');
}

/**
 * @param {{ templatePath: string, manifest: object, payloads: {id: string, bytes: Buffer}[] }} input
 * @returns {Buffer} the HTML file
 */
export function assemblePage({ templatePath, manifest, payloads }) {
  return fillTemplate(templatePath, 'view', dataBlocks(manifest, payloads));
}

/**
 * The explorer page: the data object as one JSON block (parsed by a one-line script, so a key such as
 * `__proto__` stays a key and no content can close the element), then the pack's manifest block
 * `xv-explorer-manifest`, which the reply reads.
 * @param {{ templatePath: string, data: object, manifest: object }} input
 * @returns {Buffer} the HTML file
 */
export function assembleExplorerPage({ templatePath, data, manifest }) {
  const blocks = [
    `<script type="application/json" id="xv-explorer-data">${jsonForScript(data)}</script>`,
    `<script>window.${EXPLORER_DATA_GLOBAL}=JSON.parse(document.getElementById("xv-explorer-data").textContent);</script>`,
    `<script type="application/json" id="xv-explorer-manifest">${jsonForScript(manifest)}</script>`,
  ];
  return fillTemplate(templatePath, 'explorer', blocks.join('\n'));
}
