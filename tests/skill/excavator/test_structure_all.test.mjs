/**
 * structure-all.mjs — full-project structural extraction as an added phase.
 *
 * What is under test: it covers EVERY scanned file (including the ones no
 * reader supports), it does not fork extraction (the rows are exactly what
 * `extract-structure.mjs` produces), and it is byte-deterministic.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chunk, mergeChunkOutput, isWithinRoot, DEFAULT_CHUNK_SIZE } from '../../../skills/excavator/structure-all.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, '../../../skills/excavator');
const SCAN = join(SKILL_DIR, 'scan-project.mjs');
const STRUCTURE_ALL = join(SKILL_DIR, 'structure-all.mjs');

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function setupProject(files) {
  const root = mkdtempSync(join(tmpdir(), 'excavator-structure-all-'));
  tempDirs.push(root);
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  }
  spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf-8' });
  return root;
}

function runScan(projectRoot) {
  const out = join(projectRoot, '.excavator', 'intermediate', 'scan-result.json');
  mkdirSync(dirname(out), { recursive: true });
  const r = spawnSync('node', [SCAN, projectRoot, out, '--exclude-analysis-data'], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`scan failed: ${r.stderr}`);
  return JSON.parse(readFileSync(out, 'utf-8'));
}

function runStructureAll(projectRoot, extraArgs = []) {
  const r = spawnSync('node', [STRUCTURE_ALL, projectRoot, ...extraArgs], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`structure-all failed: ${r.stderr}`);
  const outPath = join(projectRoot, '.excavator', 'intermediate', 'structure-all.json');
  return {
    output: JSON.parse(readFileSync(outPath, 'utf-8')),
    bytes: readFileSync(outPath),
    stderr: r.stderr,
    outPath,
  };
}

const PROJECT = {
  'src/app.ts': "import { helper } from './helper';\nexport function run() {\n  return helper();\n}\n",
  'src/helper.ts': 'export function helper() {\n  return 1;\n}\n',
  'src/widget.tsx': 'export class Widget {\n  render() {\n    return null;\n  }\n}\n',
  'web/index.html': '<html><body><h1>hi</h1></body></html>\n',
  'docs/readme.md': '# Title\n\n## Section\n',
  'config/app.json': '{"name":"x"}\n',
  'src/empty.ts': '\n',
};

describe('structure-all.mjs', () => {
  it('produces exactly one row per scanned file, including files with no reader', () => {
    const root = setupProject(PROJECT);
    const scan = runScan(root);
    const { output } = runStructureAll(root);

    expect(output.scriptCompleted).toBe(true);
    expect(output.filesRequested).toBe(scan.files.length);
    expect(output.filesAnalyzed).toBe(scan.files.length);
    expect(output.results.map((r) => r.path)).toEqual(
      scan.files.map((f) => f.path).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );

    const status = (path) => output.results.find((r) => r.path === path)?.status;
    expect(status('src/app.ts')).toBe('parsed');
    expect(status('src/helper.ts')).toBe('parsed');
    expect(status('src/widget.tsx')).toBe('parsed');
    expect(status('docs/readme.md')).toBe('parsed');
    // No HTML reader is registered: the row exists and says so.
    expect(status('web/index.html')).toBe('no-extractor');
    expect(['parsed', 'zero-symbol']).toContain(status('src/empty.ts'));

    // Status counters cover every row — no fourth state.
    const total = Object.values(output.byStatus).reduce((a, b) => a + b, 0);
    expect(total).toBe(output.results.length);
  });

  it('carries the line-numbered facts an audit needs', () => {
    const root = setupProject(PROJECT);
    runScan(root);
    const { output } = runStructureAll(root);
    const app = output.results.find((r) => r.path === 'src/app.ts');

    expect(app.imports).toEqual([
      { source: './helper', specifiers: ['helper'], line: 1 },
    ]);
    expect(app.functions.map((f) => [f.name, f.startLine])).toEqual([['run', 2]]);
    expect(app.exports.map((e) => [e.name, e.line])).toEqual([['run', 2]]);
    expect(app.callGraph).toEqual([{ caller: 'run', callee: 'helper', lineNumber: 3 }]);

    const widget = output.results.find((r) => r.path === 'src/widget.tsx');
    expect(widget.classes.map((c) => [c.name, c.startLine, c.endLine])).toEqual([
      ['Widget', 1, 5],
    ]);
  });

  it('is byte-identical across runs, and across chunk boundaries', () => {
    const root = setupProject(PROJECT);
    runScan(root);

    const first = runStructureAll(root);
    const second = runStructureAll(root);
    const sha = (buf) => createHash('sha256').update(buf).digest('hex');
    expect(sha(second.bytes)).toBe(sha(first.bytes));

    // Chunking is an execution detail, not part of the facts: only the
    // declared chunkSize may differ between the two outputs.
    const chunked = runStructureAll(root, ['--chunk-size', '2']);
    expect(chunked.output.chunkSize).toBe(2);
    expect({ ...chunked.output, chunkSize: 0 }).toEqual({ ...first.output, chunkSize: 0 });
  }, 15_000);

  it('cleans up its chunk scratch files', () => {
    const root = setupProject(PROJECT);
    runScan(root);
    runStructureAll(root, ['--chunk-size', '2']);
    const tmp = join(root, '.excavator', 'tmp');
    // The directory may exist; no chunk file may remain in it.
    const leftovers = existsSync(tmp)
      ? readdirSync(tmp).filter((f) => f.startsWith('structure-all-chunk-'))
      : [];
    expect(leftovers).toEqual([]);
  });

  it('fails loudly when the scan result is missing', () => {
    const root = setupProject({ 'src/a.ts': 'export const a = 1;\n' });
    const r = spawnSync('node', [STRUCTURE_ALL, root], { encoding: 'utf-8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/scan result not found/);
  });

  it('rejects a non-positive chunk size instead of silently defaulting', () => {
    const root = setupProject({ 'src/a.ts': 'export const a = 1;\n' });
    runScan(root);
    const r = spawnSync('node', [STRUCTURE_ALL, root, '--chunk-size', '0'], { encoding: 'utf-8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/positive integer/);
  });
});

describe('structure-all.mjs — pure helpers', () => {
  it('chunks in order without losing or duplicating an item', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(DEFAULT_CHUNK_SIZE).toBeGreaterThan(0);
  });

  it('sums every counter group, including ones it has never seen', () => {
    const acc = { results: [], filesSkipped: [], analysisOutcomes: {}, byStatus: {} };
    mergeChunkOutput(acc, {
      results: [{ path: 'a' }],
      filesSkipped: ['b'],
      analysisOutcomes: { structure: { succeeded: 1, future: 2 } },
      byStatus: { parsed: 1 },
    });
    mergeChunkOutput(acc, {
      results: [{ path: 'c' }],
      filesSkipped: [],
      analysisOutcomes: { structure: { succeeded: 2 }, newGroup: { x: 1 } },
      byStatus: { parsed: 1, 'no-extractor': 3 },
    });

    expect(acc.results.map((r) => r.path)).toEqual(['a', 'c']);
    expect(acc.filesSkipped).toEqual(['b']);
    expect(acc.analysisOutcomes).toEqual({
      structure: { succeeded: 3, future: 2 },
      newGroup: { x: 1 },
    });
    expect(acc.byStatus).toEqual({ parsed: 2, 'no-extractor': 3 });
  });

  it('refuses a chunk output that is not shaped like extraction output', () => {
    const acc = { results: [], filesSkipped: [], analysisOutcomes: {}, byStatus: {} };
    expect(() => mergeChunkOutput(acc, null)).toThrow(/not an object/);
    expect(() => mergeChunkOutput(acc, { results: 'nope' })).toThrow(/no results array/);
  });
});

describe('structure-all.mjs — scan paths are confined to the project root', () => {
  it('refuses a parent-relative and an absolute path, and still processes the rest', () => {
    const root = setupProject({ 'src/app.ts': 'export function run() { return 1; }\n' });
    writeFileSync(join(dirname(root), 'outside-secret.ts'), 'export const secret = 1;\n');

    // A crafted scan result: the scan file is an input, so its paths are
    // untrusted with respect to the read they cause.
    const scanPath = join(root, '.excavator', 'intermediate', 'scan-result.json');
    mkdirSync(dirname(scanPath), { recursive: true });
    writeFileSync(scanPath, JSON.stringify({
      contentDigest: 'a'.repeat(64),
      files: [
        { path: 'src/app.ts', language: 'typescript', sizeLines: 1, fileCategory: 'code' },
        { path: '../outside-secret.ts', language: 'typescript', sizeLines: 1, fileCategory: 'code' },
        { path: '/etc/hosts', language: 'unknown', sizeLines: 1, fileCategory: 'config' },
      ],
      skipped: [],
    }));

    const { output, stderr } = runStructureAll(root);
    expect(output.filesOutOfScope).toEqual(['../outside-secret.ts', '/etc/hosts']);
    expect(output.results.map((r) => r.path)).toEqual(['src/app.ts']);
    expect(output.filesRequested).toBe(1);
    expect(output.filesAnalyzed).toBe(1);
    expect(stderr).toMatch(/outside the project root — refused, not read/);
  });

  it('isWithinRoot answers each shape directly', () => {
    expect(isWithinRoot('/project', 'src/a.ts')).toBe(true);
    expect(isWithinRoot('/project', '../escape.ts')).toBe(false);
    expect(isWithinRoot('/project', 'src/../../escape.ts')).toBe(false);
    expect(isWithinRoot('/project', '/etc/hosts')).toBe(false);
    expect(isWithinRoot('/project', '')).toBe(false);
  });
});
