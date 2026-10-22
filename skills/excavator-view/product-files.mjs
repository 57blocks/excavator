/**
 * product-files.mjs
 *
 * The file reads every product shares (openspec: changes/viewer-app): a regular
 * file read as bytes, those bytes as a JSON object, and the words for a format
 * the viewer does not know. Each read ends in a state the caller turns into a
 * product's visible state; nothing here throws for a bad file.
 */

import { lstatSync, readFileSync } from 'node:fs';

const MAX_FORMAT_CHARS = 80;

/** { state: 'absent' } | { state: 'unreadable', reason } | { state: 'ok', bytes }. */
export function readRegularFile(path, file) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { state: 'absent' };
    return { state: 'unreadable', reason: `${file} could not be inspected (${error.code ?? error.message})` };
  }
  if (!stat.isFile()) return { state: 'unreadable', reason: `${file} is not a regular file` };
  try {
    return { state: 'ok', bytes: readFileSync(path) };
  } catch (error) {
    return { state: 'unreadable', reason: `${file} could not be read (${error.code ?? error.message})` };
  }
}

export function parseJsonObject(bytes, file) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { reason: `${file} is not valid UTF-8` };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { reason: `${file} is not valid JSON (${error.message})` };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { reason: `${file} is not a JSON object at the top level` };
  }
  return { value };
}

export function describeFormat(format) {
  if (typeof format !== 'string') return 'none';
  return JSON.stringify(format.length > MAX_FORMAT_CHARS ? `${format.slice(0, MAX_FORMAT_CHARS)}...` : format);
}
