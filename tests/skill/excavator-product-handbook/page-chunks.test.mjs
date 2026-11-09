// O1 of openspec change handbook-page-chunked-data: `page` writes one self-contained handbook.html below
// the size threshold and handbook.html plus handbook-data/part-NNNN.js above it; every part is within
// the limit and a single call; the same input gives the same bytes; the data restored from the parts
// equals the single-file data; no step turns the whole data into one string; a failed run leaves neither
// the page nor the directory. The CLI half runs a purpose-built fixture run through `handbook.mjs page`
// with the threshold lowered by environment variables (the skill never sets them); the writer half calls
// the writer in process with synthetic units.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractData } from '../../../skills/excavator-product-handbook/lib/data-extract.mjs';
import { extractDictionaries } from '../../../skills/excavator-product-handbook/lib/dict-extract.mjs';
import { restorePageData, splitPageData } from '../../../skills/excavator-product-handbook/lib/page-units.mjs';
import { PART_FUNCTION, PARTS_DIR, writePageFiles } from '../../../skills/excavator-product-handbook/lib/page-chunks.mjs';
import { PAGE_CSP } from '../../../skills/excavator-product-handbook/lib/page.mjs';
import { repoRoot, runHandbook, verifyChecked } from './helpers.mjs';
import { checkedOverviewRun } from './overview-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
  vi.restoreAllMocks();
});

const STUB = '<!doctype html><html lang="und"><head><meta charset="UTF-8"><!-- xv:csp --></head><body><div id="root"></div><!-- xv:data --></body></html>';
const stubDir = mkdtempSync(join(tmpdir(), 'xhb-chunk-stub-'));
const stubPath = join(stubDir, 'template.html');
writeFileSync(stubPath, STUB);
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

const THRESHOLD = 'EXCAVATOR_PRODUCT_HANDBOOK_PAGE_CHUNK_THRESHOLD';
const PART_LIMIT = 'EXCAVATOR_PRODUCT_HANDBOOK_PAGE_PART_LIMIT';
const dictionaries = extractDictionaries(join(repoRoot, 'tests/fixtures/product-handbook/dict-project'));
const dataSection = extractData(join(repoRoot, 'tests/fixtures/product-handbook/data-project'));

/** A run with a verified overview, a verified F1, a data section and a status dictionary. */
function run() {
  const made = checkedOverviewRun(cleanups);
  made.writeEntry('F1', made.entry);
  expect(made.run('check-entry', 'F1').status).toBe(0);
  verifyChecked(made);
  verifyChecked(made, 'overview');
  writeFileSync(join(made.out, 'dictionaries.json'), `${JSON.stringify(dictionaries, null, 2)}\n`);
  writeFileSync(join(made.out, 'data.json'), `${JSON.stringify(dataSection, null, 2)}\n`);
  return made;
}

const page = (made, env = {}) => runHandbook(['page', made.out, '--project', made.root, '--views', 'product,technical'], {
  env: { ...process.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath, ...env },
});
const chunked = { [THRESHOLD]: '1', [PART_LIMIT]: '4000' };
const html = (made) => readFileSync(join(made.out, 'handbook.html'), 'utf-8');
const dataOf = (text) => JSON.parse(/<script type="application\/json" id="xv-product-handbook-data">([\s\S]*?)<\/script>/.exec(text)[1]);
const partNames = (made) => (existsSync(join(made.out, PARTS_DIR)) ? readdirSync(join(made.out, PARTS_DIR)).sort() : []);
const policyOf = (text) => /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(text)[1];

/** The call of a part file: its id and its parsed data; fails when the file is anything but one call. */
function readPart(made, name) {
  const text = readFileSync(join(made.out, PARTS_DIR, name), 'utf-8');
  const match = /^window\.__xvHandbookPart\("(part-\d{4})", ([\s\S]*)\);\n$/.exec(text);
  expect(match, `${name} is one ${PART_FUNCTION} call`).not.toBeNull();
  expect(match[1]).toBe(name.replace(/\.js$/, ''));
  return { id: match[1], text, data: JSON.parse(match[2]) };
}

/** The units of a written page as `restorePageData` takes them: the pieces of each unit in the order of its parts. */
function unitsFromParts(made, core) {
  const parts = new Map(partNames(made).map((name) => [name.replace(/\.js$/, ''), readPart(made, name).data]));
  return Object.entries(core.chunks.units).map(([key, ids]) => ({ key, pieces: ids.flatMap((id) => parts.get(id)[key]) }));
}

describe('page: below the threshold it is one file', () => {
  it('writes handbook.html only, with an empty chunk index, and the same bytes twice', () => {
    const made = run();
    expect(page(made).status).toBe(0);
    expect(existsSync(join(made.out, PARTS_DIR))).toBe(false);
    const before = readFileSync(join(made.out, 'handbook.html'));
    const data = dataOf(html(made));
    expect(data.format).toBe('excavator-product-handbook-page/15');
    expect(data.chunks).toEqual({ parts: [], units: {} });
    expect(data.features[0].entry).not.toBeNull();
    expect(data.technical.dictionaries.dictionaries).toHaveLength(31);
    expect(page(made).status).toBe(0);
    expect(readFileSync(join(made.out, 'handbook.html')).equals(before)).toBe(true);
    expect(policyOf(html(made))).toBe(PAGE_CSP);
    expect(policyOf(html(made))).toContain("script-src 'unsafe-inline';");
  });
});

describe('page: above the threshold it is the page plus handbook-data/', () => {
  it('writes parts of at most the limit, each one call, and a core that holds no detail', () => {
    const made = run();
    const result = page(made, chunked);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const names = partNames(made);
    expect(names.length).toBeGreaterThan(3);
    expect(names).toEqual(names.map((_, at) => `part-${String(at + 1).padStart(4, '0')}.js`));
    for (const name of names) {
      expect(statSync(join(made.out, PARTS_DIR, name)).size).toBeLessThanOrEqual(4000);
      readPart(made, name);
    }
    const core = dataOf(html(made));
    expect(core.chunks.parts).toEqual(names.map((name) => name.replace(/\.js$/, '')));
    expect(Object.keys(core.chunks.units)).toEqual(expect.arrayContaining(['feature:F1', 'dictionaries', 'data']));
    expect(core.features.every((feature) => feature.entry === null)).toBe(true);
    expect(core.technical.locations.find((unit) => unit.id === 'F1').items).toEqual([]);
    expect(core.technical.locations.find((unit) => unit.id === 'overview').items.length).toBeGreaterThan(0);
    expect(core.technical.dictionaries.dictionaries).toEqual([]);
    expect(core.technical.dictionaries.mismatches).toEqual([]);
    expect(core.technical.data.tables).toEqual([]);
    expect(core.technical.dictionaries.counts).toEqual(dictionaries.counts);
    expect(html(made)).not.toContain('TicketStatus');
    // A unit that does not fit one part spans consecutive parts.
    const spans = Object.values(core.chunks.units).filter((ids) => ids.length > 1);
    expect(spans.length).toBeGreaterThan(0);
    for (const ids of spans) {
      const at = ids.map((id) => core.chunks.parts.indexOf(id));
      expect(at).toEqual(at.map((_, i) => at[0] + i));
    }
  });

  it('gives the same bytes twice, parts included, and from a separate run of the same input', () => {
    const first = run();
    const second = run();
    expect(page(first, chunked).status).toBe(0);
    const bytes = (made) => [readFileSync(join(made.out, 'handbook.html')), ...partNames(made).map((name) => readFileSync(join(made.out, PARTS_DIR, name)))];
    const before = bytes(first);
    expect(page(first, chunked).status).toBe(0);
    expect(page(second, chunked).status).toBe(0);
    for (const other of [bytes(first), bytes(second)]) {
      expect(other).toHaveLength(before.length);
      other.forEach((buffer, at) => expect(buffer.equals(before[at]), `file ${at}`).toBe(true));
    }
  });

  it('restores to the data of the single-file page', () => {
    const made = run();
    expect(page(made).status).toBe(0);
    const single = dataOf(html(made));
    expect(page(made, chunked).status).toBe(0);
    const core = dataOf(html(made));
    const restored = restorePageData({ ...core, chunks: single.chunks }, unitsFromParts(made, core));
    expect(restored).toEqual(single);
    expect(JSON.stringify(restored)).toBe(JSON.stringify(single));
  });

  it('allows the origin of the page for scripts, and nothing else more than the single-file policy', () => {
    const made = run();
    expect(page(made, chunked).status).toBe(0);
    const policy = policyOf(html(made));
    expect(policy).toBe(PAGE_CSP.replace("script-src 'unsafe-inline'", "script-src 'self' 'unsafe-inline'"));
    expect(policy).toContain("connect-src 'none'");
  });

  it('removes the directory of an earlier chunked run when the next run is one file, and both files when a run fails', () => {
    const made = run();
    expect(page(made, chunked).status).toBe(0);
    expect(existsSync(join(made.out, PARTS_DIR))).toBe(true);
    expect(page(made).status).toBe(0);
    expect(existsSync(join(made.out, PARTS_DIR))).toBe(false);
    expect(page(made, chunked).status).toBe(0);
    const failed = page(made, { ...chunked, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: join(stubDir, 'missing.html') });
    expect(failed.status).toBe(2);
    expect(existsSync(join(made.out, PARTS_DIR))).toBe(false);
    expect(existsSync(join(made.out, 'handbook.html'))).toBe(false);
    expect(readdirSync(made.out).filter((name) => name.includes('handbook-page'))).toEqual([]);
  });
});

describe('the writer in process', () => {
  const makeCore = () => ({ format: 'f', chunks: { parts: [], units: {} } });
  const blob = (n) => 'x'.repeat(n);
  /** `count` units of `pieces` pieces of about `bytes` bytes each, made on demand so the data is never held whole. */
  const unitsOf = (count, pieces, bytes) => function* units() {
    for (let u = 0; u < count; u += 1) yield { key: `feature:U${u}`, pieces: Array.from({ length: pieces }, (_, p) => ({ unit: u, piece: p, text: blob(bytes) })) };
  };
  const outDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'xhb-chunk-out-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
  };
  const options = (extra = {}) => ({ template: STUB, core: makeCore(), restore: (core) => core, threshold: 1000, partLimit: 100_000, ...extra });

  it('packs consecutive units into parts within the limit and never stringifies more than one part', () => {
    const out = outDir();
    const spy = vi.spyOn(JSON, 'stringify');
    const result = writePageFiles(out, { ...options(), units: unitsOf(40, 3, 30_000) });
    const longest = Math.max(...spy.mock.results.map((entry) => (typeof entry.value === 'string' ? entry.value.length : 0)));
    const names = readdirSync(join(out, PARTS_DIR));
    let total = 0;
    for (const name of names) {
      const size = statSync(join(out, PARTS_DIR, name)).size;
      expect(size).toBeLessThanOrEqual(100_000);
      total += size;
    }
    expect(total).toBeGreaterThan(3_000_000);
    expect(longest).toBeLessThan(100_000);
    expect(result.parts).toBe(names.length);
    const core = dataOf(readFileSync(join(out, 'handbook.html'), 'utf-8'));
    expect(core.chunks.parts).toHaveLength(names.length);
    expect(Object.keys(core.chunks.units)).toHaveLength(40);
    // Unit U0 is three pieces of 30 KB and fills the first part; a piece is never split.
    expect(core.chunks.units['feature:U0']).toEqual(['part-0001']);
  });

  it('keeps every part within the limit when each of many small units adds its own key', () => {
    const out = outDir();
    const small = function* units() {
      for (let u = 0; u < 3000; u += 1) yield { key: `feature:F${u}`, pieces: [{ entry: { text: blob(37) } }] };
    };
    writePageFiles(out, { ...options({ partLimit: 5000 }), units: small });
    const names = readdirSync(join(out, PARTS_DIR));
    expect(names.length).toBeGreaterThan(20);
    for (const name of names) expect(statSync(join(out, PARTS_DIR, name)).size, name).toBeLessThanOrEqual(5000);
    // The parts are filled: no part is left much emptier than the limit except the last.
    const sizes = names.map((name) => statSync(join(out, PARTS_DIR, name)).size);
    for (const size of sizes.slice(0, -1)) expect(size).toBeGreaterThan(4800);
  });

  it('writes a "<" inside a piece as an escape', () => {
    const out = outDir();
    writePageFiles(out, { ...options({ threshold: 1 }), units: () => [{ key: 'feature:A', pieces: [{ text: '</script><!-- a < b' }] }] });
    const text = readFileSync(join(out, PARTS_DIR, 'part-0001.js'), 'utf-8');
    expect(text.slice(text.indexOf('{'))).not.toContain('<');
    const { data } = readPart({ out }, 'part-0001.js');
    expect(data['feature:A'][0].text).toBe('</script><!-- a < b');
  });

  it('refuses a single piece larger than the limit, and leaves neither the page nor the directory', () => {
    const out = outDir();
    writeFileSync(join(out, 'handbook.html'), 'old');
    mkdirSync(join(out, PARTS_DIR));
    expect(() => writePageFiles(out, { ...options(), units: unitsOf(1, 1, 150_000) })).toThrow(/larger than the part limit/);
    expect(readdirSync(out)).toEqual([]);
  });

  it('leaves neither the page nor the directory when a step fails after parts were written', () => {
    const out = outDir();
    expect(() => writePageFiles(out, { ...options(), units: unitsOf(10, 2, 30_000), afterPart: (at) => { if (at === 2) throw new Error('disk full'); } })).toThrow('disk full');
    expect(readdirSync(out)).toEqual([]);
  });

  it('writes one file and no directory when the data is within the threshold, restoring the pieces into the core', () => {
    const out = outDir();
    const restore = (core, units) => ({ ...core, all: [...units].flatMap((unit) => unit.pieces) });
    const result = writePageFiles(out, { ...options({ threshold: 10_000, restore }), units: unitsOf(2, 2, 100) });
    expect(readdirSync(out)).toEqual(['handbook.html']);
    expect(result.parts).toBe(0);
    expect(dataOf(readFileSync(join(out, 'handbook.html'), 'utf-8')).all).toHaveLength(4);
  });
});

describe('splitPageData and restorePageData', () => {
  const entry = { purpose: 'p', who: [], where: [], screens: [{ name: 'S1' }, { name: 'S2' }], operations: [{ name: 'O1' }], states: [], notifications: [], automatic: [], unknowns: [] };
  const data = () => ({
    format: 'f',
    chunks: { parts: [], units: {} },
    features: [{ id: 'F1', entry }, { id: 'F2', entry: null }, { id: 'F3', entry: { ...entry, screens: [] } }],
    technical: {
      locations: [{ id: 'F1', items: [{ claim: 'a' }, { claim: 'b' }] }, { id: 'overview', items: [{ claim: 'o' }] }, { id: 'F3', items: [] }],
      data: { tables: [{ name: 't' }], dropped: [], counts: 1 },
      dataState: 'ok',
      dictionaries: { dictionaries: [{ id: 'd' }], mismatches: [{ key: 'k' }], counts: 2 },
      dictionariesState: 'ok',
    },
  });

  it('moves the detail of verified features, the data section and the dictionaries into units, in a fixed order', () => {
    const { core, units } = splitPageData(data());
    const listed = [...units()];
    expect(listed.map((unit) => unit.key)).toEqual(['feature:F1', 'feature:F3', 'data', 'dictionaries']);
    expect(core.features.map((feature) => feature.entry)).toEqual([null, null, null]);
    expect(core.technical.locations).toEqual([{ id: 'F1', items: [] }, { id: 'overview', items: [{ claim: 'o' }] }, { id: 'F3', items: [] }]);
    expect(core.technical.data).toEqual({ tables: [], dropped: [], counts: 1 });
    expect(core.technical.dictionaries).toEqual({ dictionaries: [], mismatches: [], counts: 2 });
    expect(restorePageData(core, listed)).toEqual(data());
  });

  it('splits an entry at its screens, operations and location items, and restores it', () => {
    const { core, units } = splitPageData(data());
    const [first] = [...units()];
    expect(first.pieces.length).toBe(1 + 2 + 1 + 2);
    expect(restorePageData(core, [...units()])).toEqual(data());
  });

  it('leaves a page without a technical part, and one with a section that was not written, as it is', () => {
    const plain = { format: 'f', chunks: { parts: [], units: {} }, features: [{ id: 'F1', entry: null }] };
    expect([...splitPageData(plain).units()]).toEqual([]);
    const missing = data();
    missing.technical.data = null;
    missing.technical.dataState = 'missing';
    expect([...splitPageData(missing).units()].map((unit) => unit.key)).toEqual(['feature:F1', 'feature:F3', 'dictionaries']);
    expect(restorePageData(splitPageData(missing).core, [...splitPageData(missing).units()])).toEqual(missing);
  });
});
