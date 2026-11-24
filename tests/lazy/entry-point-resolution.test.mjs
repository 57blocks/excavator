// route-entry-points, oracle O2 and O3: the entry point stage in the real Lazy
// driver. The purpose-built trees below run through `runLazyAnalysis`, and the
// graph's `entryPoints` stream, `coverage.entryPoints` and gaps are read back.
//   - express/: `app.js` mounts a factory router (`require('./routes/u')(passport)`)
//     and a direct export (`require('./routes/v')`), one of them under two prefixes;
//     a router no file mounts; two routers that mount each other; a route whose
//     path is not a literal; `app.use(cors())` (not a mount);
//   - react/: a root array whose `children` is an array exported from another
//     file, and a lazily imported module whose `<Routes>` is mounted through `/my/*`;
//   - go/: Gin routes in nested groups, a handler of another directory resolved
//     through the import's package directory, a name two files of that package
//     declare, and a function that takes a group as a parameter.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { PIPELINE_VERSION, runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraph, writeKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';
import { assertEntryPointConservation } from '../../skills/excavator/entry-point-resolution.mjs';
import { createProjectService } from '../../skills/excavator/project-service.mjs';

const lines = (...text) => `${text.join('\n')}\n`;
const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';

const TREE = {
  // ---- Express ------------------------------------------------------------
  'express/app.js': lines(
    "const express = require('express');",
    "const cors = require('cors');",
    'const passport = {};',
    "const u = require('./routes/u')(passport);",
    "const v = require('./routes/v');",
    "const c1 = require('./routes/c1');",
    'const app = express();',
    'function health(req, res) {}',
    'app.use(cors());',
    "app.use('/users', u);",
    "app.use('/v', v);",
    "app.use('/v', v);",
    "app.use('/v2', v);",
    "app.use('/c', c1);",
    "app.get('/health', health);",
  ),
  'express/routes/u.js': lines(
    "const express = require('express');",
    'const router = express.Router();',
    'function listUsers(req, res) {}',
    'module.exports = (passport) => {',
    "  router.get('/list', listUsers);",
    "  router.post('/', wrapAsync(async (req, res) => {}));",
    '  return router;',
    '};',
  ),
  'express/routes/v.js': lines(
    "const express = require('express');",
    'const router = express.Router();',
    'function show(req, res) {}',
    "router.get('/x', show);",
    'module.exports = router;',
  ),
  'express/routes/orphan.js': lines(
    "const express = require('express');",
    'const router = express.Router();',
    'function orphaned(req, res) {}',
    "router.get('/list', orphaned);",
    'module.exports = router;',
  ),
  'express/routes/dynamic.js': lines(
    "const express = require('express');",
    'const base = process.env.BASE;',
    'const router = express.Router();',
    "router.get(base + '/x', helper);",
    'function helper(req, res) {}',
    'module.exports = router;',
  ),
  'express/routes/c1.js': lines(
    "const express = require('express');",
    "const c2 = require('./c2');",
    'const router = express.Router();',
    "router.use('/a', c2);",
    'module.exports = router;',
  ),
  'express/routes/c2.js': lines(
    "const express = require('express');",
    "const c1 = require('./c1');",
    'const router = express.Router();',
    "router.use('/b', c1);",
    'function leaf(req, res) {}',
    "router.get('/leaf', leaf);",
    'module.exports = router;',
  ),
  // ---- React Router -------------------------------------------------------
  'react/src/router.tsx': lines(
    "import { createBrowserRouter } from 'react-router-dom';",
    "import { coreRoutes } from './core-routes';",
    'export const router = createBrowserRouter([',
    "  { path: '/', children: coreRoutes },",
    "  { path: '/my/*', lazy: () => import('./pages/AccountArea') },",
    ']);',
  ),
  'react/src/core-routes.tsx': lines(
    "import type { RouteObject } from 'react-router-dom';",
    "import { Home } from './pages/Home';",
    'export const coreRoutes: RouteObject[] = [',
    "  { path: 'home', Component: Home },",
    '  { index: true, Component: Home },',
    '];',
  ),
  'react/src/pages/Home.tsx': lines('export function Home() {', '  return null;', '}'),
  'react/src/pages/Profile.tsx': lines('export function Profile() {', '  return null;', '}'),
  'react/src/pages/AccountArea.tsx': lines(
    "import { Routes, Route } from 'react-router-dom';",
    "import { Profile } from './Profile';",
    'export default function AccountArea() {',
    '  return (',
    '    <Routes>',
    '      <Route path="profile" Component={Profile} />',
    '    </Routes>',
    '  );',
    '}',
  ),
  // ---- Gin ----------------------------------------------------------------
  'go/go.mod': lines('module example.com/svc', '', 'go 1.21'),
  'go/main.go': lines(
    'package main',
    '',
    'import (',
    '\t"github.com/gin-gonic/gin"',
    '\t"example.com/svc/support"',
    ')',
    '',
    'func Setup(engine *gin.Engine) {',
    '\tv2 := engine.Group("/v2")',
    '\ts := v2.Group("/support")',
    '\ts.GET("/offices", support.F)',
    '\ts.GET("/dup", support.Dup)',
    '\tengine.GET("/ping", ping)',
    '}',
    '',
    'func Reg(g *gin.RouterGroup) {',
    '\tg.GET("/p", ping)',
    '}',
    '',
    'func ping(c *gin.Context) {}',
  ),
  'go/support/a.go': lines('package support', '', 'func F(c any) {}', '', 'func Dup(c any) {}'),
  'go/support/b.go': lines('package support', '', 'func Dup(c any) {}'),
  'go/support/inner/c.go': lines('package inner', '', 'func F(c any) {}'),
  'go/other/d.go': lines('package other', '', 'func F(c any) {}'),
};

const entriesOf = (graph, framework) => graph.entryPoints.filter((r) => r.kind === 'entry' && r.framework === framework);
const mountsOf = (graph, framework) => graph.entryPoints.filter((r) => r.kind === 'mount' && r.framework === framework);

describe('entry points join across files', () => {
  let root;
  let graph;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'excavator-entry-points-'));
    for (const [path, text] of Object.entries(TREE)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const result = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    expect(result.saveError).toBeNull();
    graph = readKnowledgeGraph(join(root, '.excavator', KNOWLEDGE_GRAPH_FILE));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const nodeId = (file, name) => {
    const matches = graph.nodes.filter((n) => n.filePath === file && n.name === name && n.type !== 'file');
    expect(matches, `${file} ${name}`).toHaveLength(1);
    return matches[0].id;
  };
  const row = (r) => `${r.method ?? '-'} ${r.path ?? `?${r.pathText}`} ${r.bucket} ${r.file}:${r.line}`;

  it('is the version that carries the stream', () => {
    expect(PIPELINE_VERSION).toBe('lazy-fact-graph/18');
    expect(graph.project.pipelineVersion).toBe('lazy-fact-graph/18');
  });

  it('gives Express routes their full paths through a factory and a direct export', () => {
    const entries = entriesOf(graph, 'express').filter((r) => r.bucket === 'resolved').map(row);
    expect(entries).toEqual([
      'GET /health resolved express/app.js:15',
      'GET /users/list resolved express/routes/u.js:5',
      'POST /users resolved express/routes/u.js:6',
      // one route, mounted under '/v' twice and under '/v2' once: two entry points
      'GET /v/x resolved express/routes/v.js:4',
      'GET /v2/x resolved express/routes/v.js:4',
    ]);
  });

  it('resolves handlers to the declaration, an inline function, and records the wrapper', () => {
    const byPath = (path) => entriesOf(graph, 'express').find((r) => r.path === path);
    expect(byPath('/users/list').handler).toEqual({
      fate: 'node', nodeId: nodeId('express/routes/u.js', 'listUsers'), file: 'express/routes/u.js', line: 3, text: 'listUsers',
    });
    expect(byPath('/users').handler).toEqual({ fate: 'inline', line: 6, endLine: 6, wrappedBy: 'wrapAsync' });
    expect(byPath('/health').handler.nodeId).toBe(nodeId('express/app.js', 'health'));
  });

  it('puts an unmounted router, a mount cycle and a non-literal path in visible buckets', () => {
    const buckets = (file) => entriesOf(graph, 'express').filter((r) => r.file === file).map(row);
    expect(buckets('express/routes/orphan.js')).toEqual(['GET /list prefix-unresolved express/routes/orphan.js:4']);
    // the cycle's route: neither router propagates a prefix
    expect(buckets('express/routes/c2.js')).toEqual(['GET /leaf prefix-unresolved express/routes/c2.js:6']);
    expect(buckets('express/routes/dynamic.js')).toEqual(['GET ?base + \'/x\' path-unresolved express/routes/dynamic.js:4']);
    const dynamic = entriesOf(graph, 'express').find((r) => r.file === 'express/routes/dynamic.js');
    expect(dynamic.path).toBeNull();
    expect(dynamic.pathText).toBe("base + '/x'");
  });

  it('counts every mount in one fate, and a mount on a cycle as cycle', () => {
    const fates = mountsOf(graph, 'express').map((r) => `${r.file}:${r.line} ${r.path} ${r.fate}`);
    expect(fates).toEqual([
      'express/app.js:9 undefined ignored',
      'express/app.js:10 /users resolved',
      'express/app.js:11 /v resolved',
      'express/app.js:12 /v resolved',
      'express/app.js:13 /v2 resolved',
      'express/app.js:14 /c cycle',
      'express/routes/c1.js:4 /a cycle',
      'express/routes/c2.js:4 /b cycle',
    ]);
    expect(graph.coverage.entryPoints.frameworks.express.mounts).toEqual({
      total: 7, resolved: 4, 'path-unresolved': 0, 'target-unresolved': 0, 'target-external': 0, cycle: 3, ignored: 1,
    });
  });

  it('hands React routes the path of a children array from another file', () => {
    const entries = entriesOf(graph, 'react').map(row);
    // sorted by file, then line: the root object `/` has no handler of its own
    expect(entries).toEqual([
      '- /home resolved react/src/core-routes.tsx:4',
      '- / resolved react/src/core-routes.tsx:5',
      '- /my/profile resolved react/src/pages/AccountArea.tsx:6',
      '- / resolved react/src/router.tsx:4',
      '- /my/* resolved react/src/router.tsx:5',
    ]);
  });

  it('mounts a lazily imported module\'s Routes through the parent path', () => {
    const profile = entriesOf(graph, 'react').find((r) => r.path === '/my/profile');
    expect(profile.handler).toMatchObject({ fate: 'node', nodeId: nodeId('react/src/pages/Profile.tsx', 'Profile'), text: 'Profile' });
    const lazy = entriesOf(graph, 'react').find((r) => r.path === '/my/*');
    expect(lazy.handler).toMatchObject({ fate: 'module', file: 'react/src/pages/AccountArea.tsx' });
    const home = entriesOf(graph, 'react').find((r) => r.path === '/home');
    expect(home.handler.nodeId).toBe(nodeId('react/src/pages/Home.tsx', 'Home'));
  });

  it('resolves a Gin handler through the import\'s package directory only', () => {
    const entries = entriesOf(graph, 'gin');
    const byPath = (path) => entries.find((r) => r.path === path);
    expect(byPath('/v2/support/offices')).toMatchObject({
      bucket: 'resolved', method: 'GET', handler: { fate: 'node', nodeId: nodeId('go/support/a.go', 'F'), file: 'go/support/a.go', text: 'support.F' },
    });
    // F also exists in a subdirectory and in a directory this file does not import: neither is a candidate.
    expect(byPath('/v2/support/dup').handler).toEqual({ fate: 'ambiguous', text: 'support.Dup' });
    expect(byPath('/ping').handler.nodeId).toBe(nodeId('go/main.go', 'ping'));
  });

  it('records a route in a function that takes a group as prefix-unresolved', () => {
    const entry = entriesOf(graph, 'gin').find((r) => r.file === 'go/main.go' && r.line === 17);
    expect(entry).toMatchObject({ path: '/p', bucket: 'prefix-unresolved', handler: { fate: 'node' } });
  });

  it('keeps the books: buckets, handlers, records and gaps agree', () => {
    const { frameworks } = graph.coverage.entryPoints;
    expect(Object.keys(frameworks)).toEqual(['express', 'gin', 'react']);
    expect(frameworks.express).toMatchObject({
      files: 7,
      sites: 7,
      buckets: { resolved: 4, 'path-unresolved': 1, 'prefix-unresolved': 2 },
      entryPoints: 8,
      handlers: { node: 7, module: 0, inline: 1, external: 0, unresolved: 0, ambiguous: 0, none: 0 },
    });
    expect(frameworks.gin).toMatchObject({
      files: 1,
      sites: 4,
      buckets: { resolved: 3, 'path-unresolved': 0, 'prefix-unresolved': 1 },
      entryPoints: 4,
      handlers: { node: 3, module: 0, inline: 0, external: 0, unresolved: 0, ambiguous: 1, none: 0 },
      mounts: { total: 0, ignored: 0 },
    });
    expect(frameworks.react).toMatchObject({
      files: 3,
      sites: 5,
      buckets: { resolved: 5, 'path-unresolved': 0, 'prefix-unresolved': 0 },
      entryPoints: 5,
      handlers: { node: 3, module: 1, none: 1 },
      mounts: { total: 1, resolved: 1 },
    });
    expect(graph.coverage.entryPoints.status).toBe('ran');
    assertEntryPointConservation(graph.coverage.entryPoints, { records: graph.entryPoints, gaps: graph.gaps });

    const gap = (kind, scope) => graph.gaps.find((g) => g.kind === kind && g.scope === scope);
    expect(gap('entry-point-path-unresolved', 'express')).toMatchObject({ count: 1, samples: ["express/routes/dynamic.js:4 GET base + '/x'"] });
    expect(gap('entry-point-prefix-unresolved', 'express').count).toBe(2);
    expect(gap('entry-point-prefix-unresolved', 'gin').count).toBe(frameworks.gin.buckets['prefix-unresolved']);
    expect(gap('entry-point-handler-unresolved', 'gin')).toMatchObject({ count: 1, samples: ['go/main.go:12 GET /v2/support/dup'] });
    expect(gap('entry-point-handler-unresolved', 'express')?.count ?? 0).toBe(
      frameworks.express.handlers.unresolved + frameworks.express.handlers.ambiguous);
  });

  it('adds no node or edge: the stream is the only new product', () => {
    expect(graph.nodes.some((n) => n.type === 'endpoint')).toBe(false);
    expect(graph.edges.some((e) => e.type === 'routes')).toBe(false);
  });
});

describe('a project built before the stream existed', () => {
  it('is re-projected whole on the next sync, with no --full: the stream, the coverage and the version come back', async () => {
    const root = mkdtempSync(join(tmpdir(), 'excavator-entry-points-upgrade-'));
    try {
      for (const [path, text] of Object.entries(TREE)) {
        if (!path.startsWith('express/')) continue;
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
      }
      await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
      const graphPath = join(root, '.excavator', KNOWLEDGE_GRAPH_FILE);
      const manifestPath = join(root, '.excavator', 'source-manifest.json');

      // What a /16 run left: no stream, no coverage section, the old version in both places.
      const old = readKnowledgeGraph(graphPath);
      delete old.entryPoints;
      delete old.coverage.entryPoints;
      old.gaps = old.gaps.filter((g) => !g.kind.startsWith('entry-point-'));
      old.project.pipelineVersion = 'lazy-fact-graph/16';
      writeKnowledgeGraph(graphPath, old);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, pipelineVersion: 'lazy-fact-graph/16' }, null, 2));

      const service = createProjectService(root);
      const before = service.projectStatus();
      expect(before.snapshot.freshness).toBe('stale');
      expect(before.data.factCoverage.entryPoints).toBeUndefined();

      const synced = await service.syncFacts();
      expect(synced.status).toBe('ok');
      expect(synced.data.kind).toBe('synced');
      const graph = readKnowledgeGraph(graphPath);
      expect(graph.project.pipelineVersion).toBe('lazy-fact-graph/18');
      expect(graph.coverage.entryPoints.status).toBe('ran');
      expect(graph.entryPoints.length).toBeGreaterThan(0);
      assertEntryPointConservation(graph.coverage.entryPoints, { records: graph.entryPoints, gaps: graph.gaps });
      expect(service.projectStatus().snapshot.freshness).toBe('fresh');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('inline require mounts and ignored mounts are visible', () => {
  let root;
  let graph;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'excavator-inline-mounts-'));
    const tree = {
      'app.js': lines(
        "const express = require('express');",
        "const cors = require('cors');",
        'const app = express();',
        'app.use(cors());',
        "app.use('/api', require('./routes/api'));",
        "app.use('/static', express.static('p'));",
      ),
      'routes/api.js': lines(
        "const express = require('express');",
        'const router = express.Router();',
        'function list(req, res) {}',
        "router.get('/list', list);",
        "router.post('/', list);",
        'module.exports = router;',
      ),
    };
    for (const [path, text] of Object.entries(tree)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const result = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    expect(result.saveError).toBeNull();
    graph = readKnowledgeGraph(join(root, '.excavator', KNOWLEDGE_GRAPH_FILE));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('resolves the inline require mount and puts the routes under its path', () => {
    const entries = entriesOf(graph, 'express').map((r) => `${r.method} ${r.path} ${r.bucket}`);
    expect(entries).toEqual(['GET /api/list resolved', 'POST /api resolved']);
    const resolved = mountsOf(graph, 'express').filter((r) => r.fate === 'resolved');
    expect(resolved.map((r) => `${r.file}:${r.line} ${r.path}`)).toEqual(['app.js:5 /api']);
  });

  it('records every ignored mount call with its line and no path', () => {
    const ignored = mountsOf(graph, 'express').filter((r) => r.fate === 'ignored');
    expect(ignored).toEqual([
      { kind: 'mount', framework: 'express', file: 'app.js', line: 4, fate: 'ignored', text: 'cors()' },
      { kind: 'mount', framework: 'express', file: 'app.js', line: 6, fate: 'ignored', text: "express.static('p')" },
    ]);
    expect(graph.coverage.entryPoints.frameworks.express.mounts).toMatchObject({ total: 1, resolved: 1, ignored: 2 });
    assertEntryPointConservation(graph.coverage.entryPoints, { records: graph.entryPoints, gaps: graph.gaps });
  });
});

describe('entry point conservation', () => {
  const coverage = () => ({
    status: 'ran',
    frameworks: {
      gin: {
        files: 1,
        sites: 2,
        buckets: { resolved: 1, 'path-unresolved': 0, 'prefix-unresolved': 1 },
        entryPoints: 2,
        handlers: { node: 1, module: 0, inline: 0, external: 0, unresolved: 1, ambiguous: 0, none: 0 },
        mounts: { total: 1, resolved: 1, 'path-unresolved': 0, 'target-unresolved': 0, 'target-external': 0, cycle: 0, ignored: 1 },
      },
    },
  });
  const records = () => [
    { kind: 'entry', framework: 'gin' },
    { kind: 'entry', framework: 'gin' },
    { kind: 'mount', framework: 'gin', fate: 'resolved' },
    { kind: 'mount', framework: 'gin', fate: 'ignored' },
  ];
  const gaps = () => [
    { kind: 'entry-point-prefix-unresolved', scope: 'gin', count: 1 },
    { kind: 'entry-point-handler-unresolved', scope: 'gin', count: 1 },
  ];

  it('accepts books that balance', () => {
    expect(() => assertEntryPointConservation(coverage(), { records: records(), gaps: gaps() })).not.toThrow();
    expect(() => assertEntryPointConservation({ status: 'ran', frameworks: {} }, { records: [], gaps: [] })).not.toThrow();
  });

  it('names the framework and the two numbers when one equality fails', () => {
    const bad = (mutate) => {
      const c = coverage();
      mutate(c.frameworks.gin);
      return () => assertEntryPointConservation(c, { records: records(), gaps: gaps() });
    };
    expect(bad((f) => { f.sites = 3; })).toThrow(/gin.*sites vs bucket total 3 != 2/);
    expect(bad((f) => { f.handlers.node = 2; })).toThrow(/gin.*entry points vs handler total 2 != 3/);
    expect(bad((f) => { f.mounts.total = 2; f.mounts.resolved = 2; })).toThrow(/gin.*mounts plus ignored mounts vs mount records 3 != 2/);
    expect(bad((f) => { f.mounts.ignored = 0; })).toThrow(/gin.*mounts plus ignored mounts vs mount records 1 != 2/);
    expect(bad((f) => { f.mounts.ignored = 2; })).toThrow(/gin.*mounts plus ignored mounts vs mount records 3 != 2/);
    expect(bad((f) => { f.buckets['prefix-unresolved'] = 0; f.buckets['path-unresolved'] = 1; })).toThrow(/gin.*entry-point-path-unresolved gaps vs bucket 0 != 1/);
    expect(() => assertEntryPointConservation(coverage(), { records: records().slice(1), gaps: gaps() })).toThrow(/gin.*entry points vs entry records 2 != 1/);
    expect(() => assertEntryPointConservation(coverage(), { records: records(), gaps: gaps().slice(1) })).toThrow(/gin.*prefix-unresolved gaps vs bucket 0 != 1/);
  });
});
