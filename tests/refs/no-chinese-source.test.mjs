// Chinese-character gate: pnpm test fails if a file under skills/ or scripts/
// carries a Chinese character outside the exceptions listed below. Code,
// skill prose and tests are English; where code or a check has to match
// Chinese text, it writes the characters as \u escapes (see the advice check
// in skills/excavator-hotspots/SKILL.md). OpenSpec documents stay Chinese and
// are outside this gate's roots.
//
// Every Chinese character in this file is itself written as a \u escape, so
// the file passes the check it defines.
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

const ROOTS = ['skills', 'scripts'];

// CJK Unified Ideographs, Extension A, Compatibility Ideographs, and the
// supplementary-plane extensions and compatibility supplement.
const CHINESE = /[\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}]/u;

// Text a file may carry as it stands: removed from a line before the line is
// checked, so any other Chinese character on that line still fails.
const EXCEPTIONS = [
  {
    file: 'skills/excavator-chat/SKILL.md',
    text: '(\u7ef4\u62a4, \u8d1f\u8d23, \u62e5\u6709, \u719f\u6089)',
    reason: 'The ban on saying who maintains, owns or knows a part lists these Chinese words for the model to read: '
      + 'in real runs an English-only ban did not stop them in Chinese answers, and listing them did. '
      + 'A model reads the characters, not their escapes.',
  },
];

/**
 * Pure matcher: scans repo-relative paths under `baseDir`. A file that is not
 * UTF-8 text is reported too, never skipped. Returns the violations and the
 * exceptions no line used, so a stale exception fails the gate as well.
 */
function findChineseCharacters(baseDir, relPaths, exceptions = EXCEPTIONS) {
  const violations = [];
  const used = new Set();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (const rel of relPaths) {
    let text;
    try {
      text = decoder.decode(readFileSync(join(baseDir, rel)));
    } catch {
      violations.push({ file: rel, line: 0, excerpt: 'not UTF-8 text' });
      continue;
    }
    const allowed = exceptions.filter((exception) => exception.file === rel);
    text.split('\n').forEach((line, idx) => {
      let rest = line;
      for (const exception of allowed) {
        if (rest.includes(exception.text)) {
          used.add(exception);
          rest = rest.replaceAll(exception.text, '');
        }
      }
      if (CHINESE.test(rest)) violations.push({ file: rel, line: idx + 1, excerpt: line.trim().slice(0, 200) });
    });
  }
  return { violations, unusedExceptions: exceptions.filter((exception) => !used.has(exception)) };
}

// Tracked files plus untracked ones that are not ignored, so a new file is
// checked before it is committed; a tracked file deleted from the working
// tree carries nothing.
function filesUnder(roots) {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...roots], { cwd: repoRoot, encoding: 'utf-8' })
    .split('\n')
    .filter((rel) => rel && existsSync(join(repoRoot, rel)));
}

describe('Chinese-character gate', () => {
  it(`no file under ${ROOTS.join('/ or ')}/ carries a Chinese character outside the listed exceptions`, () => {
    const files = filesUnder(ROOTS);
    expect(files.length).toBeGreaterThan(100);
    const { violations, unusedExceptions } = findChineseCharacters(repoRoot, files);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    expect(unusedExceptions.map((exception) => exception.file)).toEqual([]);
  });

  it('every exception names a file under the roots and gives its reason', () => {
    for (const exception of EXCEPTIONS) {
      expect(ROOTS.some((root) => exception.file.startsWith(`${root}/`)), exception.file).toBe(true);
      expect(CHINESE.test(exception.text), exception.text).toBe(true);
      expect(exception.reason.length).toBeGreaterThan(40);
    }
  });

  describe('instrument: the matcher must see a planted character', () => {
    let tmpDir;
    const plant = (name, content) => {
      tmpDir ??= mkdtempSync(join(tmpdir(), 'no-chinese-instrument-'));
      writeFileSync(join(tmpDir, name), content);
      return name;
    };

    afterEach(() => {
      if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    });

    it('flags a Chinese character in a comment, a string and a supplementary-plane character', () => {
      const name = plant('planted.mjs', [
        '// \u5904\u7406 the order',
        "const s = 'ok';",
        "const t = '\u4e2d';",
        "const u = '\u{20000}';",
      ].join('\n'));
      const { violations } = findChineseCharacters(tmpDir, [name], []);
      expect(violations.map((violation) => violation.line)).toEqual([1, 3, 4]);
    });

    it('passes \\u escapes and other non-ASCII text', () => {
      const name = plant('clean.mjs', [
        "const s = '\\u5904\\u7406';",
        "const arrow = 'a \u2192 b \u2014 \u{1f600}';",
      ].join('\n'));
      expect(findChineseCharacters(tmpDir, [name], []).violations).toEqual([]);
    });

    it('lets an exception through but still flags another character on its line', () => {
      const exception = { file: 'skill.md', text: '(\u7ef4\u62a4)', reason: 'instrument' };
      const name = plant('skill.md', ['words (\u7ef4\u62a4) only', 'words (\u7ef4\u62a4) and \u719f\u6089'].join('\n'));
      const { violations, unusedExceptions } = findChineseCharacters(tmpDir, [name], [exception]);
      expect(violations.map((violation) => violation.line)).toEqual([2]);
      expect(unusedExceptions).toEqual([]);
    });

    it('reports an exception no line uses', () => {
      const exception = { file: 'skill.md', text: '(\u7ef4\u62a4)', reason: 'instrument' };
      const name = plant('skill.md', 'nothing here\n');
      expect(findChineseCharacters(tmpDir, [name], [exception]).unusedExceptions).toEqual([exception]);
    });

    it('reports a file that is not UTF-8 text instead of skipping it', () => {
      const name = plant('blob.bin', Buffer.from([0x66, 0x98, 0x00]));
      expect(findChineseCharacters(tmpDir, [name], []).violations).toEqual([{ file: 'blob.bin', line: 0, excerpt: 'not UTF-8 text' }]);
    });
  });
});
