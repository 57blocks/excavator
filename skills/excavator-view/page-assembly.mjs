/**
 * page-assembly.mjs
 *
 * Builds the self-contained page from the `viewer/` template (openspec:
 * changes/report-viewer, design D2): inline the stylesheet and each script in
 * the order index.html lists them, insert the Content-Security-Policy, the
 * manifest and the data payloads. It only replaces and inlines; the code the
 * browser runs is the code in `viewer/`, byte for byte.
 *
 * Deterministic: gzip with a zero mtime and a fixed level, payloads in the
 * order given, manifest keys in the order the caller built them, no pack time.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/** No connection of any kind, scripts and styles only inline, images only data: URLs. */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  "connect-src 'none'",
  "font-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const BACKSLASH = String.fromCharCode(92);
const CSP_MARKER = '<!-- xv:csp -->';
const DATA_MARKER = '<!-- xv:data -->';
const STYLE_TAG = '<link rel="stylesheet" href="styles.css">';
const SCRIPT_TAG = /<script src="src\/([A-Za-z0-9._-]+\.js)"><\/script>/g;
const NOTE = /<!-- xv:note[\s\S]*?-->\n/;

function read(path) {
  return readFileSync(path, 'utf-8');
}

/** A viewer file that could end its own inline element early (or open a comment) would break the page. */
function assertInlinable(name, text, closer) {
  if (text.toLowerCase().includes(closer) || text.includes('<!--')) {
    throw new Error(`viewer/${name} contains ${closer} or a comment opener and cannot be inlined`);
  }
}

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

/**
 * @param {{ viewerDir: string, manifest: object, payloads: {id: string, bytes: Buffer}[] }} input
 * @returns {Buffer} the HTML file
 */
export function assemblePage({ viewerDir, manifest, payloads }) {
  let html = read(join(viewerDir, 'index.html'));
  for (const marker of [CSP_MARKER, DATA_MARKER, STYLE_TAG]) {
    if (html.split(marker).length !== 2) throw new Error(`viewer/index.html must contain ${marker} exactly once`);
  }

  const css = read(join(viewerDir, 'styles.css'));
  assertInlinable('styles.css', css, '</style');

  const referenced = [];
  html = html.replace(SCRIPT_TAG, (_tag, name) => {
    const path = join(viewerDir, 'src', name);
    if (!existsSync(path)) throw new Error(`viewer/index.html references src/${name}, which does not exist`);
    const code = read(path);
    assertInlinable(`src/${name}`, code, '</script');
    referenced.push(name);
    return `<script>\n${code}</script>`;
  });
  const onDisk = readdirSync(join(viewerDir, 'src')).filter((name) => statSync(join(viewerDir, 'src', name)).isFile()).sort();
  const unreferenced = onDisk.filter((name) => !referenced.includes(name));
  if (unreferenced.length > 0) throw new Error(`viewer/src has file(s) index.html does not load: ${unreferenced.join(', ')}`);

  const csp = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">`;
  html = html
    .replace(NOTE, () => '')
    .replace(CSP_MARKER, () => csp)
    .replace(STYLE_TAG, () => `<style>\n${css}</style>`)
    .replace(DATA_MARKER, () => dataBlocks(manifest, payloads));
  return Buffer.from(html, 'utf-8');
}
