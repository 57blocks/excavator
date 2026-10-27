/**
 * skills/skopo-create/checker/ is a copy of Skopo's checker, and Skopo's repository is its source
 * (openspec change skopo-extension, design D3). SOURCE.json records the commit it came from and a
 * hash of every file; this test recomputes them, so a local edit, a missing file or an extra file
 * fails here instead of drifting silently. The rule is checked against broken copies first: a
 * checker that cannot go red is not a checker.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const checkerDir = resolve(__dirname, '../../../skills/skopo-create/checker');

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** The hash SOURCE.json records for one file: of its bytes, or of its parsed and reserialized JSON. */
function hashOf(path, kind) {
  const bytes = readFileSync(path);
  return kind === 'parsed' ? sha256(JSON.stringify(JSON.parse(bytes.toString('utf8')))) : sha256(bytes);
}

/** Every way the copy in `dir` departs from its SOURCE.json, one line each. */
export function sourceViolations(dir) {
  const source = JSON.parse(readFileSync(join(dir, 'SOURCE.json'), 'utf8'));
  const violations = [];
  if (!/^[0-9a-f]{40}$/.test(source.commit ?? '')) violations.push(`SOURCE.json: commit is not a full sha: ${source.commit}`);
  const listed = Object.keys(source.files ?? {});
  const present = readdirSync(dir).filter((f) => f !== 'SOURCE.json');
  for (const f of present.filter((p) => !listed.includes(p))) violations.push(`${f}: not listed in SOURCE.json`);
  for (const [f, entry] of Object.entries(source.files ?? {})) {
    if (!present.includes(f)) {
      violations.push(`${f}: listed in SOURCE.json but missing`);
      continue;
    }
    let actual;
    try {
      actual = hashOf(join(dir, f), entry.hashOf);
    } catch (error) {
      violations.push(`${f}: cannot be read as ${entry.hashOf}: ${error.message}`);
      continue;
    }
    if (actual !== entry.sha256) violations.push(`${f}: sha256 ${actual} differs from SOURCE.json ${entry.sha256}`);
  }
  return violations;
}

const NON_ASCII = /[^\x00-\x7f]/;

describe('vendored Skopo checker', () => {
  const temps = [];
  const copy = () => {
    const dir = mkdtempSync(join(tmpdir(), 'skopo-checker-'));
    temps.push(dir);
    cpSync(checkerDir, dir, { recursive: true });
    return dir;
  };
  afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('sees a changed byte, a missing file and an extra file', () => {
    const edited = copy();
    appendFileSync(join(edited, 'lint.mjs'), ' ');
    expect(sourceViolations(edited)).toEqual([expect.stringMatching(/^lint\.mjs: sha256 /)]);

    const missing = copy();
    rmSync(join(missing, 'guide.md'));
    expect(sourceViolations(missing)).toEqual(['guide.md: listed in SOURCE.json but missing']);

    const extra = copy();
    writeFileSync(join(extra, 'notes.md'), 'x');
    expect(sourceViolations(extra)).toEqual(['notes.md: not listed in SOURCE.json']);
  });

  it('sees a keyword dictionary whose meaning changed, not one only re-escaped', () => {
    const changed = copy();
    const keywords = JSON.parse(readFileSync(join(changed, 'keywords.json'), 'utf8'));
    writeFileSync(join(changed, 'keywords.json'), JSON.stringify({ ...keywords, en: { ...keywords.en, requirement: ['shall'] } }));
    expect(sourceViolations(changed)).toEqual([expect.stringMatching(/^keywords\.json: sha256 /)]);

    const reformatted = copy();
    writeFileSync(join(reformatted, 'keywords.json'), JSON.stringify(keywords));
    expect(sourceViolations(reformatted)).toEqual([]);
  });

  it('matches its SOURCE.json', () => {
    expect(sourceViolations(checkerDir)).toEqual([]);
  });

  it('keeps the keyword dictionary in ASCII, with every other character escaped', () => {
    const text = readFileSync(join(checkerDir, 'keywords.json'), 'utf8');
    expect(NON_ASCII.test(text)).toBe(false);
    expect(JSON.stringify(JSON.parse(text))).toMatch(/[^\x00-\x7f]/);
  });
});
