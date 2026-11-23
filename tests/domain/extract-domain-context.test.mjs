/**
 * extract-domain-context.py must not drop input before any model sees it.
 *
 * The extractor used to keep at most 50 files per directory, sign only the 40
 * files whose path ranked highest by keyword, and cut entry points to 100 when
 * the whole context passed 512 KB. A large handler directory lost its tail and
 * low-ranked modules lost their signatures, silently. Each cap that remains is
 * now counted under `truncated`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXTRACT = resolve(repoRoot, 'skills/excavator-domain/extract-domain-context.py');

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'domain-extract-'));
  roots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

function extract(root) {
  const result = spawnSync('python3', [EXTRACT, root], { encoding: 'utf-8' });
  if (result.error) throw result.error; // python3 missing is a failure, never a skip
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(readFileSync(join(root, '.excavator/intermediate/domain-context.json'), 'utf-8'));
}

describe('extract-domain-context.py caps', () => {
  it('keeps every file of a directory with 60 source files', () => {
    const files = {};
    for (let i = 0; i < 60; i++) {
      files[`src/handlers/h${String(i).padStart(2, '0')}.js`] = `export function handleThing${i}() {}\n`;
    }
    const context = extract(project(files));
    expect(context.fileTree).toHaveLength(60);
    expect(context.truncated).toEqual({ fileTree: 0, entryPoints: 0, depthSkippedDirs: 0 });
    expect(context.entryPoints).toHaveLength(60);
  });

  it('keeps 1,200 entry points and signs every file when the context passes 512 KB', () => {
    const files = {};
    for (let m = 0; m < 120; m++) {
      const routes = [];
      for (let r = 0; r < 10; r++) routes.push(`router.post('/module-${m}/route-${r}', createHandler${r});\n`);
      files[`svc/mod${String(m).padStart(3, '0')}/routes.js`] = routes.join('');
    }
    const root = project(files);
    const context = extract(root);
    const written = readFileSync(join(root, '.excavator/intermediate/domain-context.json'));
    expect(written.length).toBeGreaterThan(512 * 1024);
    expect(context.entryPoints).toHaveLength(1200);
    expect(context.fileSignatures).toHaveLength(120);
    expect(new Set(context.fileSignatures.map((s) => s.file))).toEqual(new Set(context.fileTree));
    expect(context.truncated.entryPoints).toBe(0);
  });
});
