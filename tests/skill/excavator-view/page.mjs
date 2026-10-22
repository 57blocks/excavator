/** Helpers that read a packed page back: the manifest and the decoded data payloads. */

import { gunzipSync } from 'node:zlib';

const MANIFEST = /<script type="application\/json" id="xv-manifest">([\s\S]*?)<\/script>/;

export function manifestOf(html) {
  const match = MANIFEST.exec(html);
  if (!match) throw new Error('no manifest in the page');
  return JSON.parse(match[1]);
}

export function payloadIds(html) {
  return [...html.matchAll(/<script type="application\/octet-stream" id="xv-([^"]+)">/g)].map((m) => m[1]);
}

/** The raw gzip bytes of a payload, or null when the page has none by that id. */
export function payloadGzip(html, id) {
  const match = new RegExp(`<script type="application/octet-stream" id="xv-${id}">([A-Za-z0-9+/=]*)</script>`).exec(html);
  return match ? Buffer.from(match[1], 'base64') : null;
}

export function payloadText(html, id) {
  const zipped = payloadGzip(html, id);
  return zipped === null ? null : gunzipSync(zipped).toString('utf-8');
}
