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

/** Where the built template is, relative to the plugin root. */
export const TEMPLATE_PATH = 'packages/report-view/dist/view.html';

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
function readTemplate(templatePath) {
  try {
    return readFileSync(templatePath, 'utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`the view template ${templatePath} does not exist: run \`pnpm build\` at the plugin root to build it`);
    }
    throw error;
  }
}

/**
 * @param {{ templatePath: string, manifest: object, payloads: {id: string, bytes: Buffer}[] }} input
 * @returns {Buffer} the HTML file
 */
export function assemblePage({ templatePath, manifest, payloads }) {
  const html = readTemplate(templatePath);
  for (const marker of [CSP_MARKER, DATA_MARKER]) {
    if (html.split(marker).length !== 2) throw new Error(`the view template ${templatePath} must contain ${marker} exactly once; run \`pnpm build\` to rebuild it`);
  }
  const csp = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">`;
  return Buffer.from(html.replace(CSP_MARKER, () => csp).replace(DATA_MARKER, () => dataBlocks(manifest, payloads)), 'utf-8');
}
