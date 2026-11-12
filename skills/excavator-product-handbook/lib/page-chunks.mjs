/**
 * The files of the page (design D1, D3, D7 of openspec change handbook-page-chunked-data). The
 * page data is a core plus units (page-units.mjs). Below the threshold the page is one
 * self-contained handbook.html; above it, handbook.html holds the core and the units are packed,
 * in order, into `handbook-data/part-NNNN.js`, each a single
 * `window.__xvHandbookPart("<id>", <json>)` call of at most the part limit. A unit that does not
 * fit the rest of a part continues in the next one.
 *
 * Nothing here turns the whole data into one string: each piece is serialized alone, each part
 * is assembled from the strings of its own pieces and written, and the core is serialized by
 * itself. Everything is written into a temp directory first and moved into place when all of it
 * succeeded; a failed run leaves neither handbook.html nor handbook-data/.
 */

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { UsageError } from './errors.mjs';
import { fillPageTemplate, jsonForScript } from './page-template.mjs';

export const PAGE_FILE = 'handbook.html';
export const PARTS_DIR = 'handbook-data';
/** The global function a part file calls; the page defines it before it loads any part. */
export const PART_FUNCTION = '__xvHandbookPart';
/** The data size above which the page is written with part files: 32 MB of serialized data. */
export const CHUNK_THRESHOLD = 32 * 1024 * 1024;
/** The size of a part file at most: 8 MB. */
export const PART_LIMIT = 8 * 1024 * 1024;
/** Tests lower the threshold and the part limit with these variables; the skill never sets them. */
export const THRESHOLD_VARIABLE = 'EXCAVATOR_PRODUCT_HANDBOOK_PAGE_CHUNK_THRESHOLD';
export const PART_LIMIT_VARIABLE = 'EXCAVATOR_PRODUCT_HANDBOOK_PAGE_PART_LIMIT';

const TEMP_DIR = '.handbook-page-tmp';

function numberFrom(env, name, fallback) {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw new UsageError(`${name} must be a positive integer, not ${JSON.stringify(value)}`);
  return Number(value);
}

/** `{ threshold, partLimit }` from the environment, or the defaults. */
export function chunkLimits(env = process.env) {
  return { threshold: numberFrom(env, THRESHOLD_VARIABLE, CHUNK_THRESHOLD), partLimit: numberFrom(env, PART_LIMIT_VARIABLE, PART_LIMIT) };
}

const partName = (number) => `part-${String(number).padStart(4, '0')}`;
const partPrefix = (id) => `window.${PART_FUNCTION}(${JSON.stringify(id)}, {`;
const PART_SUFFIX = '});\n';
const byteLength = (text) => Buffer.byteLength(text);

/**
 * Pack the units into part files in `dir`. Returns `{ parts, units, pieceBytes }`: the part ids in order, the
 * part ids of each unit key, and the bytes of all pieces.
 */
function packParts(units, dir, partLimit, afterPart) {
  const parts = [];
  const index = {};
  let pieceBytes = 0;
  let current = null;

  const flush = () => {
    if (current === null) return;
    const body = [...current.entries].map(([key, list]) => `${JSON.stringify(key)}:[${list.join(',')}]`).join(',');
    const text = `${partPrefix(current.id)}${body}${PART_SUFFIX}`;
    if (byteLength(text) > partLimit) throw new Error(`part ${current.id} is ${byteLength(text)} bytes, over the limit ${partLimit}`);
    writeFileSync(join(dir, `${current.id}.js`), text);
    parts.push(current.id);
    current = null;
    afterPart?.(parts.length);
  };
  const open = () => {
    const id = partName(parts.length + 1);
    current = { id, entries: new Map(), bytes: byteLength(partPrefix(id)) + byteLength(PART_SUFFIX) };
  };

  for (const { key, pieces } of units) {
    const keyCost = byteLength(JSON.stringify(key)) + 4;
    for (const piece of pieces) {
      const text = jsonForScript(piece);
      const size = byteLength(text) + 1;
      pieceBytes += size;
      const cost = (part) => size + (part.entries.has(key) ? 0 : keyCost);
      if (current === null) open();
      if (current.bytes + cost(current) > partLimit) {
        flush();
        open();
        if (current.bytes + cost(current) > partLimit) throw new UsageError(`a piece of ${key} (${size} bytes) is larger than the part limit of ${partLimit} bytes`);
      }
      current.bytes += cost(current);
      if (!current.entries.has(key)) current.entries.set(key, []);
      current.entries.get(key).push(text);
      if (index[key] === undefined) index[key] = [];
      if (index[key][index[key].length - 1] !== current.id) index[key].push(current.id);
    }
  }
  flush();
  return { parts, units: index, pieceBytes };
}

/**
 * Write `<outDir>/handbook.html`, and `<outDir>/handbook-data/` when the data is above the threshold.
 * `core` is the page data with each unit's detail emptied and an empty chunk index; `units` is a function
 * returning the units (it is called once more when the data turns out to fit one file); `restore(core, units)`
 * puts the detail back for the one-file page. `afterPart(n)` is a test seam called after the nth part file.
 * Returns `{ chunked, parts }`. On any error neither output is left, and the error is rethrown.
 */
export function writePageFiles(outDir, { template, core, units, restore, threshold = CHUNK_THRESHOLD, partLimit = PART_LIMIT, afterPart }) {
  const target = join(outDir, PAGE_FILE);
  const targetDir = join(outDir, PARTS_DIR);
  const temp = join(outDir, TEMP_DIR);
  const clean = () => {
    for (const path of [temp, target, targetDir]) rmSync(path, { recursive: true, force: true });
  };
  clean();
  try {
    mkdirSync(join(temp, PARTS_DIR), { recursive: true });
    const packed = packParts(units(), join(temp, PARTS_DIR), partLimit, afterPart);
    const chunked = byteLength(jsonForScript(core)) + packed.pieceBytes > threshold;
    let html;
    if (chunked) {
      html = fillPageTemplate(template, { ...core, chunks: { parts: packed.parts, units: packed.units } }, { chunked: true });
    } else {
      rmSync(join(temp, PARTS_DIR), { recursive: true, force: true });
      html = fillPageTemplate(template, restore(core, units()));
    }
    writeFileSync(join(temp, PAGE_FILE), html);
    if (chunked) renameSync(join(temp, PARTS_DIR), targetDir);
    renameSync(join(temp, PAGE_FILE), target);
    rmSync(temp, { recursive: true, force: true });
    return { chunked, parts: chunked ? packed.parts.length : 0 };
  } catch (error) {
    clean();
    throw error;
  }
}
