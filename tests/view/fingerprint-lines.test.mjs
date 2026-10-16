// artifact-view task 4A.6: `fingerprints.json` is read by a streaming scanner
// that keeps only each file's `totalLines`, instead of JSON.parse of the
// whole file (on a 300k-file target that parse was the bake's largest
// transient allocation). The scanner must agree with JSON.parse semantics on
// every input, at every chunk boundary, and reject what JSON.parse rejects.
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readFingerprintLineCounts } from '../../skills/excavator-view/bake/fingerprint-lines.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'excavator-view-fp-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;

function write(text) {
  const path = join(scratch, `fp-${n++}.json`);
  writeFileSync(path, text);
  return path;
}

/** The reference: the bake's former JSON.parse reading, except that an array
 *  `files` (or top level) is now rejected instead of read as an empty map. */
function reference(text) {
  const parsed = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
    || parsed.files === null || typeof parsed.files !== 'object' || Array.isArray(parsed.files)) {
    throw new Error('has no "files" object');
  }
  const out = new Map();
  for (const [path, fp] of Object.entries(parsed.files)) {
    if (fp && Number.isInteger(fp.totalLines) && fp.totalLines >= 0) out.set(path, fp.totalLines);
  }
  return out;
}

const VALID = [
  JSON.stringify({ version: '1', files: { 'a.ts': { totalLines: 3, functions: [{ name: 'x', lines: [1, 2] }] }, 'b/c.java': { totalLines: 0 } } }, null, 2),
  JSON.stringify({ files: { 'ü/ß €.ts': { totalLines: 7 }, 'q"uote\\back\nslash': { totalLines: 1 }, 'tab\t': { totalLines: 2 } } }),
  '{"files":{"x":{"totalLines":1.5},"y":{"totalLines":-1},"z":{"totalLines":"3"},"w":{"totalLines":null},"v":{"totalLines":1e2},"u":{}}}',
  '{"files":{"dup":{"totalLines":1},"dup":{"other":true}}}',
  '{"files":{"dup":{"totalLines":1,"totalLines":"x"}},"files2":1}',
  '{"files":{"a":{"totalLines":1}},"files":{"b":{"totalLines":2}}}',
  '{"fil\\u0065s":{"\\u0061":{"total\\u004cines":5}}}',
  '{"files":{"a":{"nested":{"totalLines":9}},"b":[{"totalLines":4}],"c":5,"d":{"totalLines":{"x":1}}}}',
  '  {"files" : { "a" : { "totalLines" : 12 } } , "trailing": [true, false, null, -0.5e-3, "s"] }  \n',
  '{"files":{"__proto__":{"totalLines":3},"constructor":{"totalLines":4}}}',
];

const INVALID_JSON = [
  '', '{', '{"files":{}', '{"files":{"a":{"totalLines":01}}}', '{"files":{"a":{"totalLines":1,}}}', "{'files':{}}",
  '{"files":{"a":{"totalLines":tru}}}', '{"files":{"a\u0001":{}}}', '{"files":{"a":{"totalLines":1}}} x', '{"files":{"\\x":{}}}',
  '{"files":{"a":{"totalLines":1.}}}', '{"files":{"a":{"totalLines":-}}}', '{"files":{"\\u12g4":{}}}', '{"files":[1,]}',
];

const NO_FILES = ['{}', '{"files":null}', '{"files":[]}', '[]', '{"files":3}', '{"files":{},"files":"x"}', 'null', '"files"'];

describe('readFingerprintLineCounts', () => {
  it('agrees with JSON.parse on valid inputs at every chunk size', async () => {
    for (const text of VALID) {
      const expected = reference(text);
      const path = write(text);
      for (const highWaterMark of [1, 2, 3, 7, 64, 1 << 16]) {
        expect(await readFingerprintLineCounts(path, { highWaterMark }), `${text} @${highWaterMark}`).toEqual(expected);
      }
    }
  });

  it('rejects malformed JSON as "not valid JSON"', async () => {
    for (const text of INVALID_JSON) {
      expect(() => JSON.parse(text), text).toThrow();
      for (const highWaterMark of [1, 5, 1 << 16]) {
        await expect(readFingerprintLineCounts(write(text), { highWaterMark }), `${JSON.stringify(text)} @${highWaterMark}`).rejects.toThrow(/not valid JSON/);
      }
    }
  });

  it('rejects valid JSON without a "files" object', async () => {
    for (const text of NO_FILES) {
      expect(() => reference(text), text).toThrow();
      await expect(readFingerprintLineCounts(write(text), { highWaterMark: 3 }), text).rejects.toThrow(/has no "files" object/);
    }
  });

  it('sees a changed line count (instrument check)', async () => {
    const counts = await readFingerprintLineCounts(write('{"files":{"a":{"totalLines":4}}}'));
    expect(counts).not.toEqual(new Map([['a', 5]]));
  });
});
