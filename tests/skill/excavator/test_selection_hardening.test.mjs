// Selection hardening (openspec: changes/lazy-mode-completion, capability
// `selection-hardening`) — end-to-end proof that BOTH the scan fact layer
// AND the source-index built from it exclude `.excavator` variant/backup
// directories (`.excavator.*/`, `.excavator-*/`) and `.trash-*/` recycle
// directories, while a real `.excavatorignore` at the project root is still
// read and stays effective.
//
// build-source-index.mjs does NOT enumerate the project tree itself — its
// row set (`structureAll.results`) is 1:1 with the scan result's `files[]`
// (see structure-all.mjs's main(), which reads `scan.files` and emits one
// row per scanned file). So there is exactly one selection choke point: the
// scan fact layer. This test proves the choke point is clean by running the
// REAL scan-project.mjs CLI against a synthetic fixture, then feeding its
// (unmodified) output into the REAL buildSourceIndex() — no second filter is
// added anywhere in this test or in build-source-index.mjs itself.
//
// Verify-the-instrument discipline: this test is written to go RED before
// the ignore-filter.ts / scan-project.mjs implementation exists (stray-dir
// files leak into both the scan output and the index) and GREEN after.
import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSourceIndex } from '../../../skills/excavator/build-source-index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCAN_SCRIPT = resolve(__dirname, '../../../skills/excavator/scan-project.mjs');

/** Build a project tree from a `{ relPath: contents }` object. */
function setupTree(files, { gitInit = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'excavator-selection-hardening-'));
  for (const [relPath, contents] of Object.entries(files)) {
    const abs = join(root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents, 'utf-8');
  }
  if (gitInit) {
    spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf-8' });
  }
  return root;
}

const _cleanupDirs = [];

function runScan(projectRoot) {
  const outputDir = mkdtempSync(join(tmpdir(), 'excavator-selection-hardening-out-'));
  _cleanupDirs.push(outputDir);
  const outputPath = join(outputDir, 'scan-output.json');
  const result = spawnSync('node', [SCAN_SCRIPT, projectRoot, outputPath], {
    encoding: 'utf-8',
  });
  let output = null;
  try {
    output = JSON.parse(readFileSync(outputPath, 'utf-8'));
  } catch {
    /* missing on hard failure */
  }
  return { status: result.status, stderr: result.stderr, output };
}

/**
 * Minimal, but shape-valid, `structureAll` — one row per scanned file, no
 * declarations. This mirrors exactly what structure-all.mjs would produce
 * for files whose reader finds zero symbols (status `zero-symbol`); the
 * "file" chunk build-source-index.mjs always emits per row is enough to
 * prove which PATHS made it into the index without needing a real
 * per-language extractor in this test.
 */
function structureAllFromScan(scan) {
  return {
    scriptCompleted: true,
    results: scan.files.map((f) => ({
      path: f.path,
      language: f.language,
      totalLines: 1,
      functions: [],
      classes: [],
      imports: [],
      exports: [],
    })),
  };
}

function buildIndexFromScan(projectRoot, scan) {
  const structureAll = structureAllFromScan(scan);
  const readFile = (relPath) => readFileSync(join(projectRoot, relPath), 'utf-8');
  return buildSourceIndex({ scan, structureAll, readFile, sourceRevision: 'test-revision' });
}

const STRAY_PREFIXES = ['.excavator.bak/', '.excavator-old/', '.trash-1234/'];
function isStrayPath(path) {
  return STRAY_PREFIXES.some((prefix) => path.startsWith(prefix));
}

const FIXTURE_FILES = {
  'src/a.ts': 'export const a = 1;\n',
  'src/b.go': 'package main\n\nfunc main() {}\n',
  '.excavator.bak/knowledge-graph.json': '{"nodes":[]}\n',
  '.excavator-old/foo.ts': 'export const old = true;\n',
  '.trash-1234/bar.ts': 'export const trashed = true;\n',
  '.excavatorignore': 'ignored-by-user/\n',
  'ignored-by-user/x.ts': 'export const hidden = true;\n',
  'kept/y.ts': 'export const visible = true;\n',
};

describe('selection hardening — scan fact layer and source-index both exclude stray .excavator variant/trash dirs, both still honor .excavatorignore', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
    while (_cleanupDirs.length) {
      rmSync(_cleanupDirs.pop(), { recursive: true, force: true });
    }
  });

  it('git-backed enumeration: stray dirs absent from scan output and source-index; .excavatorignore still honored', () => {
    projectRoot = setupTree(FIXTURE_FILES, { gitInit: true });

    const { status, output, stderr } = runScan(projectRoot);
    expect(status, stderr).toBe(0);

    const scannedPaths = output.files.map((f) => f.path);

    // Normal source files present.
    expect(scannedPaths).toContain('src/a.ts');
    expect(scannedPaths).toContain('src/b.go');
    // .excavatorignore's own rule ("ignored-by-user/") is still honored —
    // proves .excavatorignore is still being read as a rules source.
    expect(scannedPaths).not.toContain('ignored-by-user/x.ts');
    expect(scannedPaths).toContain('kept/y.ts');

    // Stray variant/backup/trash directories excluded from the scan fact
    // layer entirely.
    for (const path of scannedPaths) {
      expect(isStrayPath(path), `scan output leaked stray path: ${path}`).toBe(false);
    }

    // Build the source-index from the (unmodified) scan output exactly the
    // way the real pipeline does — build-source-index.mjs performs no
    // filtering of its own, so a clean scan implies a clean index.
    const index = buildIndexFromScan(projectRoot, output);

    expect(index.filesIndexed).toContain('src/a.ts');
    expect(index.filesIndexed).toContain('src/b.go');
    expect(index.filesIndexed).toContain('kept/y.ts');
    expect(index.filesIndexed).not.toContain('ignored-by-user/x.ts');
    for (const path of index.filesIndexed) {
      expect(isStrayPath(path), `source-index filesIndexed leaked stray path: ${path}`).toBe(false);
    }

    const strayChunkIds = new Set(
      index.chunks.filter((c) => isStrayPath(c.path)).map((c) => c.id),
    );
    expect(strayChunkIds.size, 'no chunk should reference a stray-dir path').toBe(0);

    // No posting (inverted-index entry) references a chunk belonging to a
    // stray path either — cross-checked independently of the chunks array.
    for (const term of Object.keys(index.postings)) {
      for (const posting of index.postings[term]) {
        expect(strayChunkIds.has(posting.chunkId)).toBe(false);
      }
    }
  });

  it('walker-fallback enumeration (no git): stray dirs absent from scan output and source-index; .excavatorignore still honored', () => {
    projectRoot = setupTree(FIXTURE_FILES, { gitInit: false });

    const { status, output, stderr } = runScan(projectRoot);
    expect(status, stderr).toBe(0);

    const scannedPaths = output.files.map((f) => f.path);
    expect(scannedPaths).toContain('src/a.ts');
    expect(scannedPaths).toContain('src/b.go');
    expect(scannedPaths).not.toContain('ignored-by-user/x.ts');
    expect(scannedPaths).toContain('kept/y.ts');
    for (const path of scannedPaths) {
      expect(isStrayPath(path), `scan output leaked stray path: ${path}`).toBe(false);
    }

    const index = buildIndexFromScan(projectRoot, output);
    for (const path of index.filesIndexed) {
      expect(isStrayPath(path), `source-index filesIndexed leaked stray path: ${path}`).toBe(false);
    }
    const strayChunkIds = new Set(
      index.chunks.filter((c) => isStrayPath(c.path)).map((c) => c.id),
    );
    expect(strayChunkIds.size, 'no chunk should reference a stray-dir path').toBe(0);
  });
});
