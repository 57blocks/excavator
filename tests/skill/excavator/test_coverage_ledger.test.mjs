/**
 * The coverage ledger, end to end over a synthetic project: scan-project +
 * extract-structure + extract-import-map, folded by coverage-ledger.mjs.
 *
 * The claim under test is "no fourth state": every enumerated input lands in
 * exactly one of parsed / zero-symbol / a skip reason, and the per-language
 * numbers add up.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildCoverageLedger,
  conservationViolations,
  SCAN_SKIP_REASONS,
} from '../../../skills/excavator/coverage-ledger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, '../../../skills/excavator');
const SCAN = join(SKILL_DIR, 'scan-project.mjs');
const STRUCTURE = join(SKILL_DIR, 'extract-structure.mjs');
const IMPORT_MAP = join(SKILL_DIR, 'extract-import-map.mjs');

const tempDirs = [];
function tempDir(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function setupTree(files) {
  const root = tempDir('excavator-ledger-');
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  }
  spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf-8' });
  return root;
}

function runScan(projectRoot, extraArgs = []) {
  const out = join(tempDir('excavator-ledger-out-'), 'scan.json');
  const r = spawnSync('node', [SCAN, projectRoot, out, ...extraArgs], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`scan-project failed: ${r.stderr}`);
  return JSON.parse(readFileSync(out, 'utf-8'));
}

function runStructure(projectRoot, scan) {
  const dir = tempDir('excavator-ledger-out-');
  const inputPath = join(dir, 'in.json');
  const outputPath = join(dir, 'structure.json');
  writeFileSync(inputPath, JSON.stringify({ projectRoot, batchFiles: scan.files, batchImportData: {} }));
  const r = spawnSync('node', [STRUCTURE, inputPath, outputPath], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`extract-structure failed: ${r.stderr}`);
  return JSON.parse(readFileSync(outputPath, 'utf-8'));
}

function runImportMap(projectRoot, scan) {
  const dir = tempDir('excavator-ledger-out-');
  const inputPath = join(dir, 'in.json');
  const outputPath = join(dir, 'import-map.json');
  writeFileSync(inputPath, JSON.stringify({ projectRoot, files: scan.files }));
  const r = spawnSync('node', [IMPORT_MAP, inputPath, outputPath], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`extract-import-map failed: ${r.stderr}`);
  return JSON.parse(readFileSync(outputPath, 'utf-8'));
}

/**
 * The fixture from the coverage-ledger spec: a symlink, an unreadable file, a
 * `.xyz` file, a `.dll`, an over-limit file, a file under `.claude/`, an
 * `.html` file, a file with a syntax error, and two parsable files.
 *
 * `native.dll` and `opaque.bin` carry a real NUL byte, so the content sniff is
 * exercised and not just the extension table.
 */
function everyBucketProject() {
  const root = setupTree({
    'src/good.ts': "import { helper } from './helper';\nexport const run = () => helper();\n",
    'src/helper.ts': 'export function helper() { return 1; }\n',
    'src/broken.ts': 'export function oops( {{{ \n',
    'src/page.html': '<html><body><h1>hi</h1></body></html>\n',
    'src/data.xyz': 'not a language this pipeline knows\n',
    'src/unreadable.ts': 'export const secret = 1;\n',
    'bin/native.dll': 'MZ\u0000\u0000binary-ish\n',
    '.claude/settings.json': '{"hooks":[]}\n',
    'src/huge.ts': `${'// filler line\n'.repeat(20050)}export const huge = 1;\n`,
    // extension says text, content says otherwise: only the NUL sniff
    // can catch this one, so it proves the sniff and not the table
    'src/sneaky.ts': 'export const blob = "' + '\u0000' + '";\n',
    'src/opaque.bin': 'header\u0000payload\n',
  });
  symlinkSync(join(root, 'src/good.ts'), join(root, 'src/link.ts'));
  chmodSync(join(root, 'src/unreadable.ts'), 0o000);
  return root;
}

describe('coverage ledger — every input lands in exactly one bucket', () => {
  it('buckets the scan fixture by reason and keeps failed files in the results', () => {
    const root = everyBucketProject();
    const scan = runScan(root);
    const structure = runStructure(root, scan);

    const skipOf = (path) => scan.skipped.find((e) => e.path === path);

    // scan-time buckets
    expect(skipOf('src/link.ts')?.reason).toBe('symlink');
    expect(skipOf('src/unreadable.ts')?.reason).toBe('read-failed');
    expect(skipOf('bin/native.dll')?.reason).toBe('binary');
    expect(skipOf('src/opaque.bin')?.reason).toBe('binary');
    // caught by the content sniff, not the extension table
    expect(skipOf('src/sneaky.ts')?.reason).toBe('binary');
    expect(skipOf('src/huge.ts')?.reason).toBe('too-large');
    expect(skipOf('.claude/settings.json')?.reason).toBe('ignored');
    // An unrecognised EXTENSION still names a language, keeps its census row,
    // and comes back from extraction as `no-extractor`.
    expect(skipOf('src/data.xyz')).toBeUndefined();

    // every skip reason is one of the six, and every entry has a language
    for (const entry of scan.skipped) {
      expect(SCAN_SKIP_REASONS).toContain(entry.reason);
      expect(typeof entry.language).toBe('string');
    }

    // extraction statuses: the broken file and the extractor-less files stay
    const statusOf = (path) => structure.results.find((r) => r.path === path)?.status;
    expect(statusOf('src/good.ts')).toBe('parsed');
    expect(statusOf('src/helper.ts')).toBe('parsed');
    expect(statusOf('src/page.html')).toBe('no-extractor');
    expect(statusOf('src/data.xyz')).toBe('no-extractor');
    expect(statusOf('src/broken.ts')).toBeDefined();
    expect(['parsed', 'parse-failed', 'zero-symbol']).toContain(statusOf('src/broken.ts'));

    // one result row per emitted file — nothing dropped
    expect(structure.results.map((r) => r.path).sort()).toEqual(scan.files.map((f) => f.path).sort());
  });

  it('conserves files = parsed + zeroSymbol + sum(skipped) for every language', () => {
    const root = everyBucketProject();
    const scan = runScan(root);
    const structure = runStructure(root, scan);
    const importMap = runImportMap(root, scan);

    const { coverage, gaps } = buildCoverageLedger({ scan, structure, importMap });

    expect(conservationViolations(coverage)).toEqual([]);
    expect(coverage.files).toBe(scan.files.length + scan.skipped.length);
    expect(coverage.limits).toEqual({ maxFileLines: 20000, maxFileBytes: 2 * 1024 * 1024 });
    expect(coverage.ignored).toBeGreaterThanOrEqual(1);

    // typescript: good + helper parsed; link/unreadable/huge skipped
    const ts = coverage.byLanguage.typescript;
    expect(ts.parsed).toBeGreaterThanOrEqual(2);
    expect(ts.skipped.symlink).toBe(1);
    expect(ts.skipped['read-failed']).toBe(1);
    expect(ts.skipped['too-large']).toBe(1);
    expect(ts.skipped.binary).toBe(1);
    expect(ts.kinds.function).toBeGreaterThanOrEqual(1);
    expect(ts.kinds.import).toBeGreaterThanOrEqual(1);

    // html has a census row, zero parsed, and a no-extractor gap
    expect(coverage.byLanguage.html.files).toBe(1);
    expect(coverage.byLanguage.html.parsed).toBe(0);
    expect(coverage.byLanguage.html.skipped['no-extractor']).toBe(1);
    expect(gaps).toContainEqual(
      expect.objectContaining({ kind: 'no-extractor', scope: 'html', count: 1 }),
    );
    expect(gaps).toContainEqual(
      expect.objectContaining({ kind: 'no-extractor', scope: 'xyz', count: 1 }),
    );
    expect(gaps).toContainEqual(
      expect.objectContaining({ kind: 'skipped-binary', scope: 'dll', count: 1 }),
    );
  });

  it('reproduces the spec scenario: 622 no-extractor html files', () => {
    // Synthesised counts rather than 622 real files: the fold is what is
    // under test, and the numbers come straight from the spec scenario.
    const scan = {
      files: Array.from({ length: 622 }, (_, i) => ({
        path: `web/page${i}.html`, language: 'html', sizeLines: 10, fileCategory: 'markup',
      })),
      skipped: [],
      coverage: { limits: { maxFileLines: 20000, maxFileBytes: 2097152 } },
    };
    const structure = {
      results: scan.files.map((f) => ({
        path: f.path, language: 'html', fileCategory: 'markup', status: 'no-extractor',
      })),
    };
    const { coverage, gaps } = buildCoverageLedger({ scan, structure });

    expect(coverage.byLanguage.html.files).toBe(622);
    expect(coverage.byLanguage.html.parsed).toBe(0);
    expect(gaps).toContainEqual(
      expect.objectContaining({ kind: 'no-extractor', scope: 'html', count: 622 }),
    );
    expect(conservationViolations(coverage)).toEqual([]);
  });

  it('fails closed on a result whose status is outside the four', () => {
    expect(() =>
      buildCoverageLedger({
        scan: { files: [{ path: 'a.ts', language: 'typescript' }], skipped: [] },
        structure: { results: [{ path: 'a.ts', language: 'typescript', status: 'fine-i-guess' }] },
      }),
    ).toThrow(/unknown status/);
  });

  it('fails closed on a scan skip reason outside the six', () => {
    expect(() =>
      buildCoverageLedger({
        scan: { files: [], skipped: [{ path: 'a.ts', reason: 'meh', language: 'typescript' }] },
        structure: { results: [] },
      }),
    ).toThrow(/unknown scan skip reason/);
  });
});

describe('import map — unresolved specifiers are recorded', () => {
  it('records an external package and a broken relative path', () => {
    const root = setupTree({
      'src/app.ts': "import React from 'react';\nimport { gone } from './nowhere';\nimport { ok } from './ok';\nexport const app = [React, gone, ok];\n",
      'src/ok.ts': 'export const ok = 1;\n',
    });
    const scan = runScan(root);
    const importMap = runImportMap(root, scan);

    expect(importMap.importMap['src/app.ts']).toEqual(['src/ok.ts']);
    expect(importMap.unresolved['src/app.ts']).toEqual(['./nowhere', 'react']);
    expect(importMap.stats.filesWithUnresolved).toBe(1);
    expect(importMap.stats.unresolvedSpecifiers).toBe(2);

    const structure = runStructure(root, scan);
    const { gaps } = buildCoverageLedger({ scan, structure, importMap });
    expect(gaps).toContainEqual(
      expect.objectContaining({ kind: 'imports-unresolved', scope: 'typescript', count: 2 }),
    );
  });
});
