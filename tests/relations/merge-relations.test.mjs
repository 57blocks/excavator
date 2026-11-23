/**
 * merge-relations.mjs — nothing an analyzer writes is taken on trust, every
 * end lands in exactly one visible bucket, and the counts are conserved.
 *
 * The end-to-end case plants one end per rejection reason (the instrument
 * check: each reason must be seen once), one end per caller and receiver
 * bucket, a duplicate, a later kind, a declared skip and a silent file.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REJECTIONS, THRESHOLDS, containsToken, mergeRelations, runMerge,
} from '../../skills/excavator-relations/merge-relations.mjs';
import { isRelationsGraphUsable } from '../../skills/excavator-relations/relations-freshness.mjs';
import { makeProject, removeProject, run, writeGraph } from './fixture.mjs';

let root;
let manifest;
const dataDir = () => join(root, '.excavator');
const graphPath = () => join(dataDir(), 'relations-graph.json');
const coveragePath = () => join(dataDir(), 'reports', 'relations-coverage.json');

const end = (file, line, quote, extra = {}) => ({ file, line, quote, ...extra });
const httpAddr = (method, path) => ({ method, path });

function outputs() {
  const web = [
    // linked: /api/users/{} prefers the parameter route /api/users/:id over /api/users/me.
    { kind: 'http', address: httpAddr('GET', '/api/users/${id}'), caller: end('web/src/users.js', 3, 'return api.get(`/api/users/${id}`);'), receiver: null, reason: 'loads one user' },
    // linked, and its duplicate.
    { kind: 'http', address: httpAddr('POST', '/api/orders'), caller: end('web/src/users.js', 6, "return api.post('/api/orders', order);"), receiver: null },
    { kind: 'http', address: httpAddr('POST', '/api/orders'), caller: end('web/src/users.js', 6, "api.post('/api/orders', order)"), receiver: null },
    // ambiguous: two units each register a parameter route for /api/items/{}.
    { kind: 'http', address: httpAddr('GET', '/api/items/${id}'), caller: end('web/src/users.js', 12, 'return api.get(`/api/items/${id}`);'), receiver: null },
    // caller-only: no server route.
    { kind: 'http', address: httpAddr('GET', '/api/ping'), caller: end('web/src/users.js', 9, "return api.get('/api/ping');"), receiver: null },
    // address-unresolved.
    { kind: 'http', address: { unresolved: 'the path is built elsewhere' }, caller: end('web/src/users.js', 1, "import { api } from './http';"), receiver: null },
    // realtime receiver in the browser.
    { kind: 'realtime', address: { event: 'order:created' }, caller: null, receiver: end('web/src/live.js', 3, "socket.on('order:created', (o) => console.log(o));") },
    // One planted end per rejection reason.
    { kind: 'http', address: httpAddr('GET', '/api/ping'), caller: { file: 'web/src/users.js', line: 9 }, receiver: null },
    { kind: 'http', address: httpAddr('GET', '/api/ping'), caller: end('../outside.js', 1, 'whatever text'), receiver: null },
    { kind: 'http', address: httpAddr('GET', '/api/users/:id'), caller: end('server/app.js', 5, "app.get('/api/users/:id'"), receiver: null },
    { kind: 'http', address: httpAddr('GET', '/api/ping'), caller: end('web/src/users.js', 999, 'return api.get'), receiver: null },
    // quote-mismatch, the only end of web/src/admin.js: that file is ends-rejected, not silent.
    { kind: 'http', address: httpAddr('GET', '/api/admin/stats'), caller: end('web/src/admin.js', 2, 'return api.delete(everything)'), receiver: null },
    { kind: 'http', address: httpAddr('GET', '/api/ping'), caller: end('web/src/users.js', 9, "api.get('/api/ping')", { evidence: [end('web/.env', 1, 'nothing like this line')] }), receiver: null },
    { kind: 'http', address: httpAddr('POST', '/api/carts'), caller: end('web/src/users.js', 6, "return api.post('/api/orders', order);"), receiver: null },
    // A later kind: counted, never linked.
    { kind: 'shared-database', address: { table: 'orders' }, caller: end('web/src/users.js', 6, 'return api.post') },
  ];
  const server = [
    { kind: 'http', address: httpAddr('GET', '/api/users/:id'), caller: null, receiver: end('server/app.js', 5, "app.get('/api/users/:id', (req, res) => res.json({}));", { nodeId: 'function:server/app.js:getUser' }) },
    { kind: 'http', address: httpAddr('GET', '/api/users/me'), caller: null, receiver: end('server/app.js', 12, "app.get('/api/users/me'", { nodeId: 'function:elsewhere' }) },
    { kind: 'http', address: httpAddr('POST', '/api/orders'), caller: null, receiver: end('server/app.js', 6, "app.post('/api/orders', (req, res) => {") },
    { kind: 'http', address: httpAddr('GET', '/api/items/:id'), caller: null, receiver: end('server/app.js', 13, "app.get('/api/items/:id'") },
    { kind: 'message', address: { channel: 'orders.created', broker: 'redis' }, caller: end('server/app.js', 7, "pub.publish('orders.created', JSON.stringify(req.body));"), receiver: null },
    { kind: 'realtime', address: { event: 'order:created' }, caller: end('server/app.js', 8, "io.emit('order:created', req.body);"), receiver: null },
    {
      kind: 'external', address: { name: 'nodemailer' }, receiver: null,
      caller: end('server/app.js', 9, "mailer.sendMail({ to: 'a@b.c' });", { evidence: [end('server/app.js', 3, "const nodemailer = require('nodemailer');")] }),
    },
  ];
  const worker = [
    { kind: 'message', address: { channel: 'orders.created' }, caller: null, receiver: end('worker/main.go', 6, 'sub := rdb.Subscribe(ctx, "orders.created")') },
    { kind: 'http', address: httpAddr('GET', '/api/items/{key}'), caller: null, receiver: end('worker/main.go', 8, 'http.HandleFunc("/api/items/{key}", h)') },
  ];
  return {
    'unit:web': { relations: web, outOfScope: [{ kind: 'auth-trust', note: 'token passed through' }] },
    'unit:server': { relations: server, skippedFiles: [{ file: 'server/public/widget.js', reason: 'a static asset served to browsers, read with the web unit' }] },
    'unit:worker': { relations: worker },
  };
}

function writeOutputs(byUnit = outputs(), { token = manifest.token, skip = [] } = {}) {
  for (const area of manifest.areas) {
    if (skip.includes(area.unit)) continue;
    writeFileSync(area.outputFile, JSON.stringify({ areaRun: { areaId: area.areaId, token }, ...byUnit[area.unit] }));
  }
}

const quiet = { stdout: () => {}, stderr: () => {} };

beforeEach(() => {
  root = makeProject();
  const kg = join(root, '.excavator', 'knowledge-graph.jsonl');
  writeGraph(kg, {
    nodes: [
      { id: 'file:server/app.js', type: 'file', filePath: 'server/app.js', lineRange: [1, 12] },
      { id: 'function:server/app.js:getUser', type: 'function', filePath: 'server/app.js', lineRange: [5, 5] },
      { id: 'function:server/app.js:orders', type: 'function', filePath: 'server/app.js', lineRange: [6, 11] },
    ],
    entryPoints: [{ kind: 'entry', routeKind: 'http', method: 'GET', path: '/api/users/:id', file: 'server/app.js', line: 5 }],
  });
  expect(run('plan-units.mjs', [root, '--graph', kg]).status).toBe(0);
  const split = run('split-relation-areas.mjs', [root, '--graph', kg]);
  expect(split.status, split.stderr).toBe(0);
  manifest = JSON.parse(readFileSync(join(dataDir(), 'intermediate', 'relations-areas', 'manifest.json'), 'utf-8'));
  expect(manifest.areas.map((a) => a.unit)).toEqual(['unit:server', 'unit:web', 'unit:worker']);
});
afterEach(() => removeProject(root));

describe('merge-relations end to end', () => {
  it('buckets every end, rejects each planted fake once and conserves the count', () => {
    writeOutputs();
    const result = run('merge-relations.mjs', [root]);
    expect(result.status, result.stderr).toBe(0);
    const graph = JSON.parse(readFileSync(graphPath(), 'utf-8'));
    const coverage = JSON.parse(readFileSync(coveragePath(), 'utf-8'));

    expect(coverage.rejections).toEqual(Object.fromEntries(REJECTIONS.map((r) => [r, 1])));
    expect(coverage.buckets).toEqual({
      caller: { linked: 5, ambiguous: 1, 'caller-only': 1, 'address-unresolved': 1, 'quote-failed': 7 },
      receiver: { linked: 4, 'receiver-only': 3, 'address-unresolved': 0, 'quote-failed': 0 },
    });
    expect(coverage.conservation).toEqual({ endsIn: 23, inBuckets: 22, duplicates: 1, ok: true });
    expect(coverage.outOfScope).toEqual({ 'shared-database': 1, 'auth-trust': 1 });
    expect(graph.status).toBe('complete');
    expect(graph.factDigest).toBe('facts-1');
    expect(graph.inputDigest).toBe(manifest.inputDigest);

    const linked = graph.relations.filter((r) => r.bucket === 'linked').map((r) => r.key).sort();
    expect(linked).toEqual([
      'external|server/app.js|external:nodemailer|external:nodemailer',
      'http|web/src/users.js|GET /api/users/{}|server/app.js',
      'http|web/src/users.js|POST /api/orders|server/app.js',
      'message|server/app.js|orders.created|worker/main.go',
      'realtime|server/app.js|order:created|web/src/live.js',
    ]);
    expect(graph.externals).toEqual([{ id: 'external:nodemailer' }]);
    const ambiguous = graph.relations.find((r) => r.bucket === 'ambiguous');
    expect(ambiguous.candidates.map((c) => c.file).sort()).toEqual(['server/app.js', 'worker/main.go']);

    // Node ids: kept, replaced when not on the end's file, derived from the range, else the file.
    const recv = (line) => graph.relations.find((r) => r.receiver?.file === 'server/app.js' && r.receiver.line === line).receiver;
    expect(recv(5)).toMatchObject({ nodeId: 'function:server/app.js:getUser', nodeIdBy: 'analyzer' });
    expect(recv(12)).toMatchObject({ nodeId: 'file:server/app.js', nodeIdBy: 'derived-file' });
    expect(recv(6)).toMatchObject({ nodeId: 'function:server/app.js:orders', nodeIdBy: 'derived-range' });
    expect(coverage.anchors).toMatchObject({ nodeIdGiven: 2, nodeIdRejected: 1, addressByEntryPoint: 1 });

    const files = Object.fromEntries(coverage.files.rows.map((r) => [r.file, r.status]));
    expect(files).toEqual({
      'server/app.js': 'cited', 'server/public/widget.js': 'declared-skip', 'web/src/admin.js': 'ends-rejected', 'web/src/http.js': 'silent-zero',
      'web/src/live.js': 'cited', 'web/src/users.js': 'cited', 'worker/main.go': 'cited',
    });
    expect(result.stdout).toContain('silent-zero web/src/http.js unit=unit:web');
    expect(result.stdout).not.toContain('silent-zero web/src/admin.js');
    expect(result.stdout).toMatch(/files cited=\d+ declared-skip=1 ends-rejected=1 silent-zero=1 /);
    expect(coverage.units.find((u) => u.id === 'unit:lib').status).toBe('no-candidates');

    // http: 17 ends after the duplicate, 7 rejected -> over the quote-failure threshold.
    expect(coverage.measurements.http).toMatchObject({ ends: 17, quoteFailed: 7, escalation: { candidate: true, reasons: ['quote-failure'] } });
    expect(coverage.escalationCandidates).toEqual([{ kind: 'http', reasons: ['quote-failure'] }]);
    expect(coverage.measurements.message.agreement.status).toBe('no-previous-run');
    expect(result.stdout).toMatch(/^conservation ok ends=23 duplicates=1$/m);
  });

  it('compares a second run on the same input with the first', () => {
    writeOutputs();
    expect(run('merge-relations.mjs', [root]).status).toBe(0);
    run('split-relation-areas.mjs', [root, '--graph', join(root, '.excavator', 'knowledge-graph.jsonl')]);
    manifest = JSON.parse(readFileSync(join(dataDir(), 'intermediate', 'relations-areas', 'manifest.json'), 'utf-8'));
    writeOutputs();
    expect(run('merge-relations.mjs', [root]).status).toBe(0);
    const coverage = JSON.parse(readFileSync(coveragePath(), 'utf-8'));
    expect(coverage.measurements.message.agreement).toMatchObject({ status: 'insufficient', jaccard: 1, intersection: 1, union: 1 });
  });

  it('rejects a stale or missing area output and exits 3', () => {
    writeOutputs(outputs(), { skip: ['unit:worker'] });
    const area = manifest.areas.find((a) => a.unit === 'unit:server');
    writeFileSync(area.outputFile, JSON.stringify({ areaRun: { areaId: area.areaId, token: 'old' }, ...outputs()['unit:server'] }));
    const result = run('merge-relations.mjs', [root]);
    expect(result.status).toBe(3);
    expect(result.stdout).toMatch(/area-001 rejected-stale/);
    expect(result.stdout).toMatch(/area-003 missing/);
    expect(JSON.parse(readFileSync(graphPath(), 'utf-8')).status).toBe('incomplete');
  });

  it('writes no graph and exits 4 when the buckets do not add up', async () => {
    writeOutputs();
    const lossy = (args) => {
      const merged = mergeRelations(args);
      return { ...merged, conservation: { ...merged.conservation, inBuckets: merged.conservation.inBuckets - 1, ok: false } };
    };
    const { exitCode } = await runMerge({ projectRoot: root, mergeFn: lossy, ...quiet });
    expect(exitCode).toBe(4);
    expect(existsSync(graphPath())).toBe(false);
    expect(JSON.parse(readFileSync(coveragePath(), 'utf-8')).conservation.ok).toBe(false);
  });
});

describe('mergeRelations sides and targets', () => {
  const files = {
    'src/main/java/Api.java': '@GetMapping("/api/items")\npublic List<Item> items() {}',
    'src/main/webapp/app/items.service.ts': "return this.http.get('/api/items');",
    'src/main/webapp/app/other.service.ts': "return this.http.get('/api/items');",
    'other/Api.java': '@GetMapping("/api/items")\npublic List<Item> items() {}',
    'other/Client.java': 'rest.getForObject("/api/items", Item[].class);',
  };
  const readLines = (f) => (files[f] === undefined ? null : files[f].split('\n'));
  const areas = [
    { areaId: 'area-001', unit: 'unit:.', files: Object.keys(files).filter((f) => !f.startsWith('other/')) },
    { areaId: 'area-002', unit: 'unit:other', files: ['other/Api.java', 'other/Client.java'] },
  ];
  const units = [{ id: 'unit:.', name: 'app' }, { id: 'unit:other', name: 'other' }];
  const recvEnd = (file) => ({ kind: 'http', address: { method: 'GET', path: '/api/items' }, caller: null, receiver: { file, line: 1, quote: '@GetMapping("/api/items")' } });
  const callEnd = (file, targetUnit) => ({
    kind: 'http', address: { method: 'GET', path: '/api/items' }, targetUnit, receiver: null,
    caller: { file, line: 1, quote: files[file].split('(')[0] },
  });
  const merge = (first, second) => mergeRelations({
    accepted: [{ areaId: 'area-001', output: { relations: first } }, { areaId: 'area-002', output: { relations: second } }],
    manifest: { areas, candidates: [], inputDigest: 'd' }, units, readLines,
  });

  it('pairs a browser file with the server in its own unit, and targets a named unit', () => {
    const merged = merge(
      [recvEnd('src/main/java/Api.java'), callEnd('src/main/webapp/app/items.service.ts', 'unit:.'), callEnd('src/main/webapp/app/other.service.ts', 'unit:other')],
      [recvEnd('other/Api.java')],
    );
    const linked = merged.relations.filter((r) => r.bucket === 'linked').map((r) => `${r.caller.file}->${r.receiver.file}`).sort();
    expect(linked).toEqual([
      'src/main/webapp/app/items.service.ts->src/main/java/Api.java',
      'src/main/webapp/app/other.service.ts->other/Api.java',
    ]);
    expect(merged.conservation.ok).toBe(true);
  });

  it('never pairs two ends of one side', () => {
    const merged = merge([recvEnd('src/main/java/Api.java')], [recvEnd('other/Api.java'), callEnd('other/Client.java')]);
    const own = merged.relations.find((r) => r.caller?.file === 'other/Client.java');
    expect(own).toMatchObject({ bucket: 'linked', receiver: { file: 'src/main/java/Api.java' } });
    const alone = merge([], [recvEnd('other/Api.java'), callEnd('other/Client.java')]);
    expect(alone.relations.find((r) => r.caller).bucket).toBe('caller-only');
  });

  it('reports a caller two other sides can serve as ambiguous', () => {
    const merged = merge([recvEnd('src/main/java/Api.java'), callEnd('src/main/webapp/app/items.service.ts')], [recvEnd('other/Api.java')]);
    const caller = merged.relations.find((r) => r.caller);
    expect(caller.bucket).toBe('ambiguous');
    expect(caller.candidates.map((c) => c.file).sort()).toEqual(['other/Api.java', 'src/main/java/Api.java']);
  });
});

describe('agreement and escalation', () => {
  it('marks a kind whose two runs disagree as an escalation candidate', () => {
    const files = { 'a/x.js': "pub.publish('t1', x)", 'b/y.go': 'Subscribe(ctx, "t1")' };
    const readLines = (f) => files[f].split('\n');
    const previous = {
      inputDigest: 'd',
      relations: ['t1', 't2', 't3', 't4', 't5'].map((t) => ({ kind: 'message', bucket: 'linked', key: `message|a/x.js|${t}|b/y.go` })),
    };
    const merged = mergeRelations({
      accepted: [
        { areaId: 'area-001', output: { relations: [{ kind: 'message', address: { channel: 't1' }, caller: { file: 'a/x.js', line: 1, quote: "pub.publish('t1', x)" } }] } },
        { areaId: 'area-002', output: { relations: [{ kind: 'message', address: { channel: 't1' }, receiver: { file: 'b/y.go', line: 1, quote: 'Subscribe(ctx, "t1")' } }] } },
      ],
      manifest: { areas: [{ areaId: 'area-001', unit: 'unit:a', files: ['a/x.js'] }, { areaId: 'area-002', unit: 'unit:b', files: ['b/y.go'] }], candidates: [], inputDigest: 'd' },
      units: [{ id: 'unit:a' }, { id: 'unit:b' }], readLines, previous,
    });
    expect(merged.measurements.message.agreement).toMatchObject({ status: 'measured', jaccard: 0.2, union: 5 });
    expect(merged.measurements.message.escalation).toEqual({ candidate: true, reasons: ['agreement'] });
    expect(THRESHOLDS.agreement).toBe(0.8);
    const changed = mergeRelations({
      accepted: [], manifest: { areas: [], candidates: [], inputDigest: 'other' }, units: [], readLines, previous,
    });
    expect(changed.measurements.message.agreement.status).toBe('input-changed');
  });
});

describe('containsToken', () => {
  it('finds a path segment only as a whole token', () => {
    expect(containsToken('oauthGp.GET("/authorize"', 'oauth')).toBe(false);
    expect(containsToken('r.Group("/oauth")', 'oauth')).toBe(true);
    expect(containsToken('`${base}/v2/items`', 'v2')).toBe(true);
    expect(containsToken('getUsers()', 'Users')).toBe(false);
    expect(containsToken("'orders.created'", 'orders.')).toBe(true);
  });
});

describe('relations freshness', () => {
  const graph = { format: 'excavator-relations/1', sourceRevision: 'r1', factDigest: 'f1' };
  it('is fresh only when the source revision and the fact digest match', () => {
    expect(isRelationsGraphUsable({ graph, currentSourceRevision: 'r1', currentFactDigest: 'f1' }).status).toBe('fresh');
    expect(isRelationsGraphUsable({ graph, currentSourceRevision: 'r2', currentFactDigest: 'f1' }).status).toBe('stale');
    expect(isRelationsGraphUsable({ graph, currentSourceRevision: 'r1', currentFactDigest: 'f2' }).status).toBe('stale');
    expect(isRelationsGraphUsable({ graph: { ...graph, factDigest: null }, currentSourceRevision: 'r1', currentFactDigest: null }).usable).toBe(true);
    expect(isRelationsGraphUsable({ graph: null }).status).toBe('missing');
    expect(isRelationsGraphUsable({ graph: { ...graph, format: 'x' } }).status).toBe('unknown-format');
  });
});
