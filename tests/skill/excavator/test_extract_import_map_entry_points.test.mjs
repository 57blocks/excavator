// route-entry-points, task 2.1: the import map gives the entry point resolver
// two things it did not have. TS/JS require() and import() string literals
// resolve like ES imports into `resolvedSources` (import() adds no edge and no
// unresolved entry), and a Go import resolves to the one directory its files
// share in `resolvedPackages`. Nothing the map already said changes.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { commonPackageDir } from '../../../skills/excavator/extract-import-map.mjs';

afterEach(async () => {
  await new Promise((done) => setImmediate(done));
});

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../skills/excavator/extract-import-map.mjs');

function setupTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'excavator-eim-ep-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, 'utf-8');
  }
  return root;
}

function run(root, files) {
  const input = join(root, 'in.json');
  const output = join(root, 'out.json');
  writeFileSync(input, JSON.stringify({ projectRoot: root, files }), 'utf-8');
  const result = spawnSync('node', [SCRIPT, input, output], { encoding: 'utf-8' });
  expect(result.status).toBe(0);
  return JSON.parse(readFileSync(output, 'utf-8'));
}

const code = (path, language) => ({ path, language, fileCategory: 'code' });

describe('import map: TS/JS require() and import() literals', () => {
  let root;
  afterEach(() => root && rmSync(root, { recursive: true, force: true }));

  const TREE = {
    'app.js': [
      "const u = require('./routes/u');",
      "const missing = require('./routes/nope');",
      "const lib = require('left-pad');",
      'const load = () => import("./pages/later");',
      "const gone = () => import('./pages/gone');",
      "const pkg = () => import('some-package');",
      "// const hidden = import('./pages/hidden');",
      "import { helper } from './helper';",
      '',
    ].join('\n'),
    'helper.js': 'export function helper() { return 1; }\n',
    'routes/u.js': 'module.exports = () => null;\n',
    'pages/later.js': 'export default function Later() { return null; }\n',
    'pages/hidden.js': 'export default 1;\n',
  };
  const FILES = [
    code('app.js', 'javascript'),
    code('helper.js', 'javascript'),
    code('routes/u.js', 'javascript'),
    code('pages/later.js', 'javascript'),
    code('pages/hidden.js', 'javascript'),
  ];

  it('records resolved require() and import() sources, and only those', () => {
    root = setupTree(TREE);
    const out = run(root, FILES);
    expect(out.resolvedSources['app.js']).toEqual({
      './helper': 'helper.js',
      './pages/later': 'pages/later.js',
      './routes/u': 'routes/u.js',
    });
  });

  it('keeps edges and unresolved exactly as before: import() adds neither', () => {
    root = setupTree(TREE);
    const out = run(root, FILES);
    // The require edge was already there; the import() targets are not edges.
    expect(out.importMap['app.js']).toEqual(['helper.js', 'routes/u.js']);
    // The unresolved require() specifiers are there; the import() ones are not.
    expect(out.unresolved['app.js']).toEqual(['./routes/nope', 'left-pad']);
    expect(out.stats).toMatchObject({ filesScanned: 5, filesWithImports: 1, totalEdges: 2, unresolvedSpecifiers: 2 });
  });
});

describe('import map: Go resolvedPackages', () => {
  let root;
  afterEach(() => root && rmSync(root, { recursive: true, force: true }));

  it('maps each resolved Go import path to the directory of its files', () => {
    root = setupTree({
      'go.mod': 'module example.com/svc\n\ngo 1.21\n',
      'main.go': 'package main\n\nimport (\n\t"fmt"\n\t"example.com/svc/support"\n\t"example.com/svc/empty"\n)\n\nfunc main() { fmt.Println(support.F) }\n',
      'support/a.go': 'package support\n\nfunc F() {}\n',
      'support/b.go': 'package support\n\nfunc G() {}\n',
      'support/inner/c.go': 'package inner\n\nfunc H() {}\n',
    });
    const files = [
      { path: 'go.mod', language: 'config', fileCategory: 'config' },
      code('main.go', 'go'),
      code('support/a.go', 'go'),
      code('support/b.go', 'go'),
      code('support/inner/c.go', 'go'),
    ];
    const out = run(root, files);
    expect(out.resolvedPackages).toEqual({ 'main.go': { 'example.com/svc/support': 'support' } });
    // The edges are what they were: both files of the package, nothing for the stdlib or the empty import.
    expect(out.importMap['main.go']).toEqual(['support/a.go', 'support/b.go']);
    expect(out.unresolved['main.go']).toEqual(['example.com/svc/empty', 'fmt']);
  });

  it('keeps a directory only when the resolved files share exactly one', () => {
    expect(commonPackageDir(['support/a.go', 'support/b.go'])).toBe('support');
    expect(commonPackageDir(['main.go'])).toBe('');
    expect(commonPackageDir(['a/x.go', 'b/y.go'])).toBeUndefined();
    expect(commonPackageDir([])).toBeUndefined();
  });
});
