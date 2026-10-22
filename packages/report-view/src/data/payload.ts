/**
 * Data payloads (openspec: changes/viewer-app, design D3): an octet-stream
 * element with the id `xv-<name>` holding base64(gzip(bytes)). Each payload is
 * decoded on first use and cached; decoding uses the browser's
 * DecompressionStream, so the page needs no library and no request.
 */

import type { ElementSource } from './manifest';

/** base64 text to bytes; whitespace is ignored. */
export function decodeBase64(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** gzip bytes to UTF-8 text. */
export async function gunzipText(bytes: Uint8Array): Promise<string> {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('this browser has no DecompressionStream; the data cannot be unpacked');
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** Reads the payloads of one page, each decoded once. */
export class PayloadReader {
  private readonly texts = new Map<string, Promise<string>>();
  private readonly json = new Map<string, Promise<unknown>>();

  constructor(private readonly doc: ElementSource) {}

  /** The text of payload `name`. */
  text(name: string): Promise<string> {
    let pending = this.texts.get(name);
    if (!pending) {
      pending = this.decode(name);
      this.texts.set(name, pending);
    }
    return pending;
  }

  /** The parsed JSON of payload `name`. */
  parsed<T = unknown>(name: string): Promise<T> {
    let pending = this.json.get(name);
    if (!pending) {
      pending = this.text(name).then((text) => {
        try {
          return JSON.parse(text) as unknown;
        } catch (error) {
          throw new Error(`data payload "${name}" is not valid JSON: ${(error as Error).message}`);
        }
      });
      this.json.set(name, pending);
    }
    return pending as Promise<T>;
  }

  private async decode(name: string): Promise<string> {
    const element = this.doc.getElementById(`xv-${name}`);
    if (!element) throw new Error(`the page has no data payload "${name}"`);
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(element.textContent ?? '');
    } catch {
      throw new Error(`data payload "${name}" could not be unpacked: it is not valid base64`);
    }
    try {
      return await gunzipText(bytes);
    } catch (error) {
      if (/DecompressionStream/.test((error as Error).message)) throw error;
      throw new Error(`data payload "${name}" could not be unpacked: it is not valid gzip data`);
    }
  }
}
