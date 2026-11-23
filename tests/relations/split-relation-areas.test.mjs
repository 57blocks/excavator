/**
 * split-relation-areas.mjs — every source file gets one visible status, the
 * candidates are cut into bounded areas within one unit, and a re-run
 * cannot leave an older output where an analyzer writes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { planRelationAreas } from '../../skills/excavator-relations/split-relation-areas.mjs';
import { decideUnits } from '../../skills/excavator-relations/plan-units.mjs';
import { FILES, makeProject, removeProject, run } from './fixture.mjs';

const roots = [];
afterEach(() => { while (roots.length) removeProject(roots.pop()); });

const readLines = (files) => (f) => (files[f] === undefined ? null : files[f].split('\n'));

function plan(files, options = {}) {
  const sorted = Object.keys(files).sort();
  const { units } = decideUnits({ files: sorted, readLines: readLines(files) });
  return planRelationAreas({ files: sorted, readLines: readLines(files), units, ...options });
}

describe('planRelationAreas', () => {
  it('gives every source file one status', () => {
    const result = plan(FILES);
    const status = Object.fromEntries(result.classified.map((c) => [c.file, c.status]));
    expect(status).toEqual({
      'lib/index.js': 'not-candidate',
      'server/app.js': 'candidate',
      'server/public/widget.js': 'candidate',
      'tools/release.js': 'container-skipped',
      'web/src/admin.js': 'candidate',
      'web/src/http.js': 'candidate',
      'web/src/live.js': 'candidate',
      'web/src/plain.js': 'not-candidate',
      'web/src/users.js': 'candidate',
      'web/src/users.test.js': 'test-excluded',
      'worker/main.go': 'candidate',
    });
    const c = result.counts;
    expect(c.sourceFiles).toBe(c.candidateFiles + c.notCandidate + c.containerSkipped + c.unreadable);
    expect(c.candidateFiles).toBe(c.bySignal + c.byClientImport + c.byEntryPoint);
  });

  it('makes a server that is handed its socket instance a candidate, and leaves plain emitters out', () => {
    const files = {
      'server/package.json': '{"name":"server","scripts":{"start":"node app.js"}}',
      'server/order-socket.js': "export const watch = (io) => {\n  io.to(room).emit('orderStatusUpdate', o);\n};",
      'server/report.js': "export const r = (req) => req.app.get('io').emit('reportReady', 1);",
      'server/stream.js': "export const s = (stream, emitter) => { stream.on('data', f); emitter.emit('done'); };",
    };
    const result = plan(files);
    const status = Object.fromEntries(result.classified.map((c) => [c.file, c.status]));
    expect(status).toEqual({ 'server/order-socket.js': 'candidate', 'server/report.js': 'candidate', 'server/stream.js': 'not-candidate' });
    const order = result.candidates.find((c) => c.file === 'server/order-socket.js');
    expect(order.reasons).toEqual(['signal:socket-event-call']);
  });

  it('makes a file that imports a client definition a candidate, without a signal of its own', () => {
    const files = {
      'web/package.json': '{"name":"web","scripts":{"dev":"x"}}',
      'web/src/http.js': "import axios from 'axios';\nexport const api = axios.create();",
      'web/src/orders.js': "import { api } from './http';\nexport const list = () => api.list(base + 'orders');",
    };
    const result = plan(files);
    const orders = result.candidates.find((c) => c.file === 'web/src/orders.js');
    expect(orders.reasons).toEqual(['imports-client:web/src/http.js']);
    expect(result.counts.byClientImport).toBe(1);
  });

  it('follows the src alias of a unit, also when a knowledge graph has no edge for it', () => {
    const files = {
      'shop/package.json': '{"name":"shop","scripts":{"dev":"vite"}}',
      'shop/src/plugins/http.js': "import axios from 'axios';\nexport default (method, path) => axios({ method, url: path });",
      'shop/src/views/Cart.vue': "<script>\nimport http from '@/plugins/http';\nhttp('get', '/api/cart');\n</script>",
      'shop/src/views/Home.vue': "<script>\nimport http from '~/plugins/http.js';\n</script>",
      'shop/src/views/Other.vue': "<script>\nimport x from '@/views/Missing';\n</script>",
    };
    for (const facts of [undefined, { nodes: new Map(), imports: [], entryPoints: [] }]) {
      const result = plan(files, facts ? { facts } : {});
      const reasons = Object.fromEntries(result.candidates.map((c) => [c.file, c.reasons]));
      expect(reasons['shop/src/views/Cart.vue']).toEqual(['imports-client:shop/src/plugins/http.js']);
      expect(reasons['shop/src/views/Home.vue']).toEqual(['imports-client:shop/src/plugins/http.js']);
      expect(reasons['shop/src/views/Other.vue']).toBeUndefined();
    }
  });

  it('makes a graph route entry point a candidate and passes its nodes', () => {
    const files = { 'api/package.json': '{"name":"api"}', 'api/routes.js': 'module.exports = (r) => r.use(h);' };
    const facts = {
      nodes: new Map([['function:api/routes.js:h', { id: 'function:api/routes.js:h', type: 'function', filePath: 'api/routes.js', lineRange: [1, 1] }]]),
      imports: [],
      entryPoints: [{ routeKind: 'http', file: 'api/routes.js', line: 1, method: 'GET', path: '/a' }],
    };
    const result = plan(files, { facts });
    expect(result.candidates[0]).toMatchObject({ reasons: ['route-entry-point'], graphNodes: [['function:api/routes.js:h', 1, 1]] });
    expect(result.candidates[0].entryPoints).toEqual([{ line: 1, method: 'GET', path: '/a', bucket: null }]);
  });

  it('keeps address lines and leaves out secret lines', () => {
    const result = plan(FILES);
    expect(result.unitConfig['unit:web']).toEqual([{ file: 'web/.env', line: 1, text: 'VITE_API_URL=http://localhost:3000' }]);
    expect(result.counts.secretLinesSkipped).toBe(1);
  });

  it('keeps at most 25 address lines of one configuration file', () => {
    const files = {
      'api/package.json': '{"name":"api","scripts":{"start":"x"}}',
      'api/deploy/values.yaml': Array.from({ length: 30 }, (_, i) => `SERVICE_${i}_URL: http://s${i}`).join('\n'),
      'api/.env': 'API_BASE=/v1',
    };
    const result = plan(files);
    expect(result.unitConfig['unit:api'].filter((r) => r.file === 'api/deploy/values.yaml')).toHaveLength(25);
    expect(result.unitConfig['unit:api'].some((r) => r.file === 'api/.env')).toBe(true);
    expect(result.counts.addressLinesOverFileCap).toBe(5);
  });

  it('packs areas within the line cap and one unit, and marks an oversized file', () => {
    const result = plan(FILES, { maxLines: 11 });
    for (const area of result.areas) {
      expect(new Set(area.files.map((f) => f.unit)).size).toBe(1);
      if (!area.overBudget) expect(area.lines).toBeLessThanOrEqual(11);
    }
    const big = result.areas.find((a) => a.overBudget);
    expect(big.files.map((f) => f.file)).toEqual(['server/app.js']);
    expect(result.areas.flatMap((a) => a.files.map((f) => f.file)).sort()).toEqual(result.candidates.map((c) => c.file).sort());
  });
});

describe('split-relation-areas CLI', () => {
  it('needs the units first', () => {
    const root = makeProject();
    roots.push(root);
    const result = run('split-relation-areas.mjs', [root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('run plan-units.mjs first');
  });

  it('writes contexts and a manifest with a fresh token, and deletes old outputs', () => {
    const root = makeProject();
    roots.push(root);
    expect(run('plan-units.mjs', [root]).status).toBe(0);
    const first = run('split-relation-areas.mjs', [root]);
    expect(first.status, first.stderr).toBe(0);
    const dir = join(root, '.excavator', 'intermediate', 'relations-areas');
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
    expect(manifest.areas.map((a) => a.unit)).toEqual(['unit:server', 'unit:web', 'unit:worker']);
    const context = JSON.parse(readFileSync(manifest.areas[0].contextFile, 'utf-8'));
    expect(context.areaRun).toEqual({ areaId: 'area-001', token: manifest.token });
    expect(context.output).toBe(manifest.areas[0].outputFile);
    writeFileSync(manifest.areas[0].outputFile, '{}');

    const second = run('split-relation-areas.mjs', [root]);
    expect(second.status).toBe(0);
    const again = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
    expect(again.token).not.toBe(manifest.token);
    expect(again.inputDigest).toBe(manifest.inputDigest);
    expect(existsSync(manifest.areas[0].outputFile)).toBe(false);

    writeFileSync(join(root, 'web', 'src', 'users.js'), `${FILES['web/src/users.js']}\n// changed`);
    run('split-relation-areas.mjs', [root]);
    expect(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8')).inputDigest).not.toBe(manifest.inputDigest);
  });
});
