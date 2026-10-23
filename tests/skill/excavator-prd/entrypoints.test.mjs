// `prd.mjs entrypoints`: candidates listed from the pattern catalog, with
// every detected framework in exactly one of covered / uncovered (openspec
// change prd-feature-pipeline, design D1; requirement "complete flow
// inventory covers every flow").
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CATALOG_PATH,
  FIXTURES,
  copyFixture,
  graphHeaderLine,
  itemKeys,
  makeTempDir,
  runPrd,
  writeFiles,
} from './helpers.mjs';

const KINDS = new Set(['route', 'page', 'job', 'main']);

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
function temp() {
  const dir = makeTempDir();
  cleanups.push(dir.cleanup);
  return dir.root;
}

describe('entrypoint-catalog.json', () => {
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf-8'));

  it('covers the frameworks the change names', () => {
    for (const name of ['express', 'gin', 'react-router', 'react', 'go-cron', 'node-schedule', 'go-main', 'node-main']) {
      expect(catalog, name).toHaveProperty(name);
    }
  });

  it('gives every entry a known kind and a pattern that compiles', () => {
    let entries = 0;
    for (const [name, group] of Object.entries(catalog)) {
      expect(Array.isArray(group.entries), name).toBe(true);
      expect(group.entries.length, name).toBeGreaterThan(0);
      expect(Array.isArray(group.extensions), name).toBe(true);
      for (const entry of group.entries) {
        entries += 1;
        expect(KINDS.has(entry.kind), `${name} ${entry.kind}`).toBe(true);
        expect(() => new RegExp(entry.pattern, entry.flags ?? ''), `${name} ${entry.pattern}`).not.toThrow();
        if (entry.pathHint !== undefined) expect(typeof entry.pathHint).toBe('string');
      }
    }
    expect(entries).toBeGreaterThan(8);
  });
});

describe('prd.mjs entrypoints', () => {
  it('lists the express fixture: routes, a node-schedule job and a bin script, not the spec file', () => {
    const out = runPrd(['entrypoints', join(FIXTURES, 'express-app')]);
    expect(out.status, out.stderr).toBe(0);
    expect(out.json.frameworks).toEqual(['express', 'node-main', 'node-schedule']);
    expect(out.json.covered).toEqual(['express', 'node-main', 'node-schedule']);
    expect(out.json.uncovered).toEqual([]);
    expect(itemKeys(out.json.items)).toEqual([
      'bin/admin.js:1 main node-main',
      'src/app.js:8 route express',
      'src/jobs/reminders.js:4 job node-schedule',
      'src/routes/orders.js:5 route express',
      'src/routes/orders.js:6 route express',
      'src/routes/orders.js:7 route express',
      'src/routes/orders.js:8 route express',
      'src/routes/payments.js:5 route express',
      'src/routes/payments.js:9 route express',
    ]);
    expect(out.json.items.map((item) => item.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9']);
    expect(out.json.items[1].text).toBe("app.get('/health', (req, res) => res.json({ ok: true }));");
    expect(out.json.byFramework).toEqual({ express: 7, 'node-main': 1, 'node-schedule': 1 });
    expect(out.json.files.skipped['test-file']).toBe(1);
    // Every walked file lands in exactly one bucket.
    const { seen, scanned, otherExtension, skipped } = out.json.files;
    expect(scanned + otherExtension + Object.values(skipped).reduce((a, b) => a + b, 0)).toBe(seen);
    expect(seen).toBe(7);
  });

  it('lists an express route whose path is on the next line, at the line of the call, and not the line before a route', () => {
    const out = runPrd(['entrypoints', join(FIXTURES, 'express-app')]);
    const payments = out.json.items.filter((item) => item.file === 'src/routes/payments.js');
    expect(payments.map((item) => item.line)).toEqual([5, 9]);
    expect(payments[0].text).toBe("router.post( '/payments',");
    expect(payments[1].text).toBe("router.get('/payments/:id', (req, res) => res.json({}));");
    expect(out.json.residualAssumptions).toContain(
      'A pattern matches one line, or the line and the next one for the entries the catalog marks "lines": 2 (express routes); a registration spread over more lines is not listed.',
    );
  });

  it('marks the express route entries as two-line entries in the catalog, and no other', () => {
    const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf-8'));
    for (const [name, group] of Object.entries(catalog)) {
      for (const entry of group.entries) expect(entry.lines ?? 1, `${name} ${entry.pattern}`).toBe(name === 'express' ? 2 : 1);
    }
  });

  it('notes the router-directory restriction when only react-router is covered, and the gin client-call caveat for gin', () => {
    const root = temp();
    writeFiles(root, {
      '.excavator/knowledge-graph.jsonl': `${graphHeaderLine(['react-router'])}\n`,
      'src/router/index.tsx': "export const routes = [{ path: '/orders' }];\n",
    });
    const router = runPrd(['entrypoints', root]);
    expect(router.json.covered).toEqual(['react-router']);
    expect(router.json.residualAssumptions.join('\n')).toMatch(/only in files whose path contains "router"/);
    const gin = runPrd(['entrypoints', join(FIXTURES, 'gin-service')]);
    expect(gin.json.residualAssumptions.join('\n')).toMatch(/outbound HTTP-client calls/);
    expect(runPrd(['entrypoints', join(FIXTURES, 'express-app')]).json.residualAssumptions.join('\n')).not.toMatch(/outbound HTTP-client calls|contains "router"/);
  });

  it('lists the gin fixture: routes, a cron job and both mains, not the _test.go file', () => {
    const out = runPrd(['entrypoints', join(FIXTURES, 'gin-service')]);
    expect(out.status, out.stderr).toBe(0);
    expect(out.json.frameworks).toEqual(['gin', 'go-cron', 'go-main']);
    expect(out.json.uncovered).toEqual([]);
    expect(itemKeys(out.json.items)).toEqual([
      'cmd/worker/main.go:5 main go-main',
      'internal/jobs/jobs.go:8 job go-cron',
      'main.go:9 main go-main',
      'main.go:12 route gin',
      'main.go:13 route gin',
      'main.go:14 route gin',
      'main.go:15 route gin',
    ]);
    expect(out.json.files.skipped['test-file']).toBe(1);
  });

  it('lists the react-router fixture: <Route> anywhere, path: only in a router directory', () => {
    const out = runPrd(['entrypoints', join(FIXTURES, 'react-web')]);
    expect(out.status, out.stderr).toBe(0);
    expect(out.json.frameworks).toEqual(['react', 'react-router']);
    expect(out.json.covered).toEqual(['react', 'react-router']);
    expect(itemKeys(out.json.items)).toEqual([
      'src/App.tsx:7 page react-router',
      'src/router/index.tsx:6 page react-router',
      'src/router/index.tsx:8 page react-router',
    ]);
  });

  it('puts a framework the catalog has no patterns for in uncovered, with no candidates', () => {
    const root = temp();
    writeFiles(root, {
      '.excavator/knowledge-graph.jsonl': graphHeaderLine(['django']),
      'app/views.py': 'def index(request):\n    return None\n',
    });
    const out = runPrd(['entrypoints', root]);
    expect(out.status, out.stderr).toBe(0);
    expect(out.json.detection.source).toBe('knowledge-graph');
    expect(out.json.frameworks).toEqual(['django']);
    expect(out.json.covered).toEqual([]);
    expect(out.json.uncovered).toEqual(['django']);
    expect(out.json.items).toEqual([]);
  });

  it('reads the frameworks from the knowledge-graph header when there is one', () => {
    const root = copyFixture('express-app', join(temp(), 'p'));
    writeFiles(root, { '.excavator/knowledge-graph.jsonl': graphHeaderLine(['express', 'spring']) });
    const out = runPrd(['entrypoints', root]);
    expect(out.status, out.stderr).toBe(0);
    expect(out.json.detection.source).toBe('knowledge-graph');
    // The graph names express and spring; the catalog's own build-file rules add the libraries the graph never records.
    expect(out.json.frameworks).toEqual(['express', 'node-main', 'node-schedule', 'spring']);
    expect(out.json.uncovered).toEqual(['spring']);
    expect(out.json.items).toHaveLength(9);
  });

  it('skips dependency, build and data directories', () => {
    const root = copyFixture('express-app', join(temp(), 'p'));
    const route = "router.get('/hidden', (req, res) => res.end());\n";
    writeFiles(root, {
      'node_modules/lib/index.js': route,
      'dist/app.js': route,
      'build/app.js': route,
      'vendor/x.js': route,
      '.excavator/prd/x.js': route,
      'src/extra.test.js': route,
    });
    const out = runPrd(['entrypoints', root]);
    expect(out.status, out.stderr).toBe(0);
    expect(out.json.items).toHaveLength(9);
    expect(out.json.items.some((item) => item.text.includes('/hidden'))).toBe(false);
    expect(out.json.files.skipped['test-file']).toBe(2);
    expect(out.json.residualAssumptions.join('\n')).toMatch(/node_modules/);
  });

  it('walks every member repository of a multi-repo root, and --scope keeps one member', () => {
    const root = temp();
    copyFixture('express-app', join(root, 'api'));
    copyFixture('gin-service', join(root, 'svc'));
    copyFixture('react-web', join(root, 'web'));
    const all = runPrd(['entrypoints', root]);
    expect(all.status, all.stderr).toBe(0);
    expect(all.json.frameworks).toEqual([
      'express', 'gin', 'go-cron', 'go-main', 'node-main', 'node-schedule', 'react', 'react-router',
    ]);
    expect(all.json.items).toHaveLength(19);
    expect(all.json.items[0].file).toBe('api/bin/admin.js');

    const scoped = runPrd(['entrypoints', root, '--scope', 'svc']);
    expect(scoped.status, scoped.stderr).toBe(0);
    expect(scoped.json.scope).toBe('svc');
    expect(scoped.json.frameworks).toEqual(['gin', 'go-cron', 'go-main']);
    expect(itemKeys(scoped.json.items)).toEqual([
      'svc/cmd/worker/main.go:5 main go-main',
      'svc/internal/jobs/jobs.go:8 job go-cron',
      'svc/main.go:9 main go-main',
      'svc/main.go:12 route gin',
      'svc/main.go:13 route gin',
      'svc/main.go:14 route gin',
      'svc/main.go:15 route gin',
    ]);
    expect(scoped.json.items[0].id).toBe('c1');

    // A scope below a member still sees the member's build file in the directories above it.
    const deep = runPrd(['entrypoints', root, '--scope', 'svc/internal']);
    expect(deep.status, deep.stderr).toBe(0);
    expect(deep.json.frameworks).toEqual(['gin', 'go-cron', 'go-main']);
    expect(itemKeys(deep.json.items)).toEqual(['svc/internal/jobs/jobs.go:8 job go-cron']);
  });

  it('prints the same bytes on a second run', () => {
    const first = runPrd(['entrypoints', join(FIXTURES, 'react-web')]);
    const second = runPrd(['entrypoints', join(FIXTURES, 'react-web')]);
    expect(first.stdout).toBe(second.stdout);
  });

  it('rejects a scope outside the project and a missing project with exit 2', () => {
    const escaped = runPrd(['entrypoints', join(FIXTURES, 'gin-service'), '--scope', '../express-app']);
    expect(escaped.status).toBe(2);
    expect(escaped.stderr).toMatch(/scope/);
    const missing = runPrd(['entrypoints', join(FIXTURES, 'no-such-project')]);
    expect(missing.status).toBe(2);
    const usage = runPrd(['entrypoints']);
    expect(usage.status).toBe(2);
  });
});
