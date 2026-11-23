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
import { entryRecord, mountRecord, runLazy, writeEntryPointGraph } from './helpers/facts.mjs';

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

function extract(root, { stderr = false } = {}) {
  const result = spawnSync('python3', [EXTRACT, root], { encoding: 'utf-8' });
  if (result.error) throw result.error; // python3 missing is a failure, never a skip
  expect(result.status, result.stderr).toBe(0);
  if (stderr) return { context: read(root), stderr: result.stderr };
  return read(root);
}

function read(root) {
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

  it('keeps 1,200 script entry points and signs every file of a large context', () => {
    const files = {};
    for (let m = 0; m < 120; m++) {
      const routes = ["const express = require('express');\n", 'const router = express.Router();\n'];
      for (let r = 0; r < 10; r++) routes.push(`router.post('/module-${m}/route-${r}', createHandler${r});\n`);
      files[`svc/mod${String(m).padStart(3, '0')}/routes.js`] = routes.join('');
    }
    const root = project(files);
    runLazy(root);
    const context = extract(root);
    expect(context.entryPoints).toHaveLength(1200);
    expect(context.counts).toMatchObject({ script: 1200, pattern: 0 });
    expect(context.fileSignatures).toHaveLength(120);
    expect(new Set(context.fileSignatures.map((s) => s.file))).toEqual(new Set(context.fileTree));
    expect(context.truncated.entryPoints).toBe(0);
  });
  it('checks the routes of an ordinary file whose name merely contains a test shape', () => {
    const root = project({
      'app/latest_routes.py': "@app.route('/latest')\ndef latest():\n    return []\n",
      'app/contest_entries.py': "@app.post('/entries')\ndef enter():\n    return {}\n",
      'app/tests/test_routes.py': "@app.route('/t')\ndef t():\n    return []\n",
      'app/routes_test.py': "@app.route('/u')\ndef u():\n    return []\n",
    });
    writeEntryPointGraph(root, []);
    const context = extract(root);
    expect(context.unrecognisedFiles.map((u) => u.file)).toEqual(['app/contest_entries.py', 'app/latest_routes.py']);
  });
});

describe('extract-domain-context.py entry points from the facts', () => {
  it('turns entry records into script entry points on the handler file', () => {
    const root = project({
      'svc/handlers/handlers.go': 'package handlers\n\nfunc register(e E) {\n\te.GET("/orders", orders.List)\n}\n',
      'svc/handlers/orders/list.go': 'package orders\n\nfunc List() {}\n',
      'svc/handlers/orders/list_test.go': 'package orders\n',
    });
    writeEntryPointGraph(root, [
      entryRecord({
        file: 'svc/handlers/handlers.go', line: 4, path: '/orders', framework: 'gin',
        handler: { fate: 'node', text: 'orders.List', nodeId: 'function:svc/handlers/orders/list.go:List', file: 'svc/handlers/orders/list.go', line: 3 },
      }),
      entryRecord({ file: 'svc/handlers/orders/list_test.go', line: 1, path: '/t' }),
    ]);
    const { context, stderr } = extract(root, { stderr: true });
    expect(stderr).not.toContain('unavailable');
    expect(context.entryPointSource).toBe('facts');
    expect(context.entryPoints).toHaveLength(1);
    expect(context.entryPoints[0]).toMatchObject({
      file: 'svc/handlers/orders/list.go', type: 'http', description: 'gin route', source: 'script',
      method: 'GET', path: '/orders', bucket: 'resolved', registeredAt: { file: 'svc/handlers/handlers.go', line: 4 },
    });
    expect(context.entryPoints[0].snippet).toContain('e.GET("/orders"');
    expect(context.counts).toEqual({ script: 1, pattern: 0, scriptOnTestFiles: 1, unrecognisedFiles: 0 });
  });

  it('uses the registration file when the handler is inline, and pathText when the path is not a literal', () => {
    const root = project({ 'api/routes.js': "router.get(prefix + '/x', (req, res) => res.end());\n" });
    const record = entryRecord({ file: 'api/routes.js', line: 1 });
    delete record.path;
    record.pathText = "prefix + '/x'";
    record.bucket = 'path-unresolved';
    writeEntryPointGraph(root, [record]);
    const context = extract(root);
    expect(context.entryPoints[0]).toMatchObject({ file: 'api/routes.js', pathText: "prefix + '/x'", bucket: 'path-unresolved' });
    expect(context.entryPoints[0]).not.toHaveProperty('path');
  });

  it('runs on a Lazy graph of a tiny Express tree: the entry point is on the handler file', () => {
    const root = project({
      'package.json': JSON.stringify({ name: 'app', dependencies: { express: '^4.0.0' } }),
      'src/server.js': "const express = require('express');\nconst { list } = require('./orders');\nconst app = express();\napp.get('/orders', list);\n",
      'src/orders.js': 'exports.list = function list(req, res) { res.end(); };\n',
    });
    runLazy(root);
    const context = extract(root);
    expect(context.entryPointSource).toBe('facts');
    const route = context.entryPoints.find((e) => e.source === 'script' && e.path === '/orders');
    expect(route).toBeDefined();
    expect(route.registeredAt.file).toBe('src/server.js');
    expect(context.unrecognisedFiles).toEqual([]);
  });

  it('flags a route no record registers, and not a line a record registers', () => {
    const root = project({
      'app/views.py': "@app.route('/orders')\ndef orders():\n    return []\n",
      'api/routes.js': "router.get('/users', list);\napp.use('/api', router);\n",
    });
    writeEntryPointGraph(root, [
      entryRecord({ file: 'api/routes.js', line: 1, path: '/users' }),
      mountRecord({ file: 'api/routes.js', line: 2 }),
    ]);
    const context = extract(root);
    expect(context.unrecognisedFiles).toEqual([
      { file: 'app/views.py', lines: [1], matches: ['Decorator route (Flask/FastAPI/NestJS)'] },
    ]);
    expect(context.entryPoints.filter((e) => e.file === 'app/views.py')).toEqual([]);
    expect(context.counts.unrecognisedFiles).toBe(1);
  });

  it('matches a record by its registration line, not by the handler file', () => {
    const root = project({
      'api/routes.js': "router.get('/users', list);\n",
      'api/users.js': "router.get('/other', h);\n",
    });
    writeEntryPointGraph(root, [
      entryRecord({
        file: 'api/routes.js', line: 1, path: '/users',
        handler: { fate: 'module', text: './users', file: 'api/users.js' },
      }),
    ]);
    const context = extract(root);
    expect(context.entryPoints[0].file).toBe('api/users.js');
    expect(context.unrecognisedFiles.map((u) => u.file)).toEqual(['api/users.js']);
  });

  it('flags a Go registration on a field receiver and ignores commented-out registrations', () => {
    const root = project({
      'svc/health.go': 'package svc\n\nfunc setup() {\n\tengine := reg.Gin\n\tengine.Any("/health", func(c *gin.Context) {})\n\tzap.Any("key", v)\n}\n',
      'svc/old.go': 'package svc\n\n// rg.GET("/x", h)\n',
      'web/old.py': "# @app.route('/x')\n",
      'web/old.js': "/*\n * router.get('/x', h)\n */\n",
    });
    writeEntryPointGraph(root, []);
    const context = extract(root);
    expect(context.unrecognisedFiles).toEqual([
      { file: 'svc/health.go', lines: [5], matches: ['Go route registration'] },
    ]);
  });

  it('records unavailable and no HTTP entry points when there is no graph', () => {
    const root = project({
      'api/routes.js': "router.get('/users', list);\n",
      'app/views.py': "@app.route('/orders')\ndef orders():\n    return []\n",
      'src/handlers.js': 'export function handleThing() {}\n',
    });
    const { context, stderr } = extract(root, { stderr: true });
    expect(stderr).toContain('unavailable');
    expect(context.entryPointSource).toBe('unavailable');
    expect(context.unrecognisedFiles).toEqual([]);
    expect(context.entryPoints.map((e) => e.type)).toEqual(['manual']);
    expect(context.counts).toEqual({ script: 0, pattern: 1, scriptOnTestFiles: 0, unrecognisedFiles: 0 });
  });

  it('records unavailable for a graph that cannot be parsed', () => {
    const bad = (text) => {
      const root = project({ 'a.js': "router.get('/a', h);\n" });
      mkdirSync(join(root, '.excavator'), { recursive: true });
      writeFileSync(join(root, '.excavator/knowledge-graph.jsonl'), text);
      return extract(root);
    };
    expect(bad('not json\n').entryPointSource).toBe('unavailable');
    const header = JSON.stringify({ record: 'header', format: 'excavator-knowledge-graph-lines/1', keys: ['entryPoints'], fields: {}, counts: { entryPoints: 1 } });
    expect(bad(`${header}\n{broken\n`).entryPointSource).toBe('unavailable');
    expect(bad(`${header}\n`).entryPointSource).toBe('unavailable'); // count says 1, no record
  });

  it('keeps the non-HTTP patterns, marked as pattern entry points', () => {
    const root = project({
      'cli/main.js': "program.command('import-products').action(run);\nbus.on('orders.created', h);\n",
      'jobs/nightly.js': "cron.schedule('0 3 * * *', run);\nexport function handleExpiry() {}\n",
    });
    writeEntryPointGraph(root, []);
    const context = extract(root);
    expect(context.entryPoints.map((e) => [e.type, e.source])).toEqual(
      expect.arrayContaining([['cli', 'pattern'], ['event', 'pattern'], ['manual', 'pattern']]),
    );
    expect(context.entryPoints.every((e) => e.source === 'pattern')).toBe(true);
    expect(context.counts.script).toBe(0);
  });

  it('never caps script entry points', () => {
    const files = { 'a/routes.js': 'x\n' };
    const records = [];
    for (let i = 1; i <= 5200; i++) records.push(entryRecord({ file: 'a/routes.js', line: 1, path: `/r${i}` }));
    const root = project(files);
    writeEntryPointGraph(root, records);
    const context = extract(root);
    expect(context.entryPoints).toHaveLength(5200);
    expect(context.truncated.entryPoints).toBe(0);
  });
});
