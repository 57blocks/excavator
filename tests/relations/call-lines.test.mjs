/**
 * Call lines: the lines of a candidate file where a call or a registration is
 * written, listed by fixed shapes (relations-signals.mjs scanSource). The
 * analyzer accounts for each one (an end, an evidence line, or a skip with a
 * reason) and an output that leaves some out is caught by the self-check and
 * counted by the merge, so a run that writes only the calls it found with a
 * one-line search cannot pass silently.
 *
 * The fixture is a large API file whose calls take four shapes: a path
 * argument on the call's line, a path argument on the next line, a method with
 * nested type arguments, and a request object with a `url` key; between them
 * are look-alikes that are no call line (a map lookup, a commented-out call, a
 * query parameter read).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { scanSource } from '../../skills/excavator-relations/relations-signals.mjs';
import { CALL_LINE_BUCKETS, accountCallLines } from '../../skills/excavator-relations/merge-relations.mjs';
import { MAX_HITS_PER_FILE } from '../../skills/excavator-relations/split-relation-areas.mjs';
import { makeProject, removeProject, run } from './fixture.mjs';

const API_FILE = 'web/src/api/reports.ts';
const CALLS = 60;

/** The large API file and its calls: { line, to, shape, method, path, quote }. */
function largeApiFile() {
  const lines = [
    "import { apiClient } from '../http';",
    "const base = '/api/v2';",
    'const cache = new Map();',
  ];
  const calls = [];
  const push = (...more) => { lines.push(...more); return lines.length - more.length + 1; };
  for (let i = 0; i < CALLS; i++) {
    push(`export function op${i}(id: string, data: unknown, params: URLSearchParams) {`);
    // Look-alikes: none is a call line.
    push('  const hit = cache.get(id);', `  // apiClient.get('/api/old/${i}');`, "  const page = params.get('page');");
    switch (i % 4) {
      case 0: {
        const line = push(`  return apiClient.get(\`/api/reports/${i}/\${id}\`);`);
        calls.push({ line, to: line, shape: 'one-line', method: 'GET', path: `/api/reports/${i}/\${id}`, quote: `return apiClient.get(\`/api/reports/${i}/\${id}\`);` });
        break;
      }
      case 1: {
        const line = push('  return apiClient.post(', `    \`\${base}/reports/${i}/\${id}\`,`, '    data,', '  );');
        calls.push({ line, to: line + 1, shape: 'next-line', method: 'POST', path: `/reports/${i}/\${id}`, quote: 'return apiClient.post(' });
        break;
      }
      case 2: {
        const line = push(`  return apiClient.put<Res<Page<Item>>>(\`\${base}/reports/${i}\`, data);`);
        calls.push({ line, to: line, shape: 'type-arguments', method: 'PUT', path: `/reports/${i}`, quote: 'return apiClient.put<Res<Page<Item>>>(' });
        break;
      }
      default: {
        const line = push('  return apiClient.request({', "    method: 'delete',", `    url: \`\${base}/reports/${i}/\${id}\`,`, '  });');
        calls.push({ line, to: line + 2, shape: 'url-object', method: 'DELETE', path: `/reports/${i}/\${id}`, quote: 'return apiClient.request({' });
      }
    }
    push('}');
  }
  return { text: `${lines.join('\n')}\n`, lines, calls };
}

const big = largeApiFile();
const FILES = {
  'package.json': JSON.stringify({ name: 'suite', private: true, workspaces: ['web'] }, null, 2),
  'web/package.json': JSON.stringify({ name: 'web', scripts: { dev: 'vite' } }, null, 2),
  'web/src/http.ts': "import axios from 'axios';\nexport const apiClient = axios.create({ baseURL: '/api' });\n",
  [API_FILE]: big.text,
};

const httpCall = (call, extra = {}) => ({
  kind: 'http', address: { method: call.method, path: call.path }, receiver: null,
  caller: { file: API_FILE, line: call.line, quote: call.quote, ...extra },
});
/** An end whose path is read on the call's lines: the next line, the url key or the base constant. */
const endOf = (call) => {
  if (call.shape === 'one-line') return httpCall(call);
  return httpCall(call, { evidence: [{ file: API_FILE, line: 2, quote: "const base = '/api/v2';" }] });
};
const oneLine = big.calls.filter((c) => c.shape === 'one-line');
const others = big.calls.filter((c) => c.shape !== 'one-line');

describe('scanSource call lines', () => {
  it('lists every call of the large file at the line it starts, and none of the look-alikes', () => {
    const { callLines } = scanSource(big.lines);
    expect(callLines.map((c) => [c.line, c.to])).toEqual(big.calls.map((c) => [c.line, c.to]));
    expect(new Set(callLines.map((c) => c.signal))).toEqual(new Set(['path-call', 'url-config-call']));
  });

  it('keeps imports and client types out of the call lines, and a commented-out call too', () => {
    const { hits, callLines } = scanSource([
      "import axios from 'axios';",
      'const t: RestTemplate = null;',
      "// fetch('/api/old');",
      "fetch('/api/new');",
      "router.get('/api/x', h);",
    ]);
    expect(hits.map((h) => h.signal)).toEqual(['js-http-client', 'jvm-http-client', 'fetch-call', 'fetch-call', 'js-route', 'path-call']);
    expect(callLines.map((c) => [c.line, c.signal])).toEqual([[4, 'fetch-call'], [5, 'js-route']]);
  });

  it('takes every upper-case verb route of a Go router, and a group or any-route only with a path, never a query builder group or a logger field', () => {
    const { callLines } = scanSource([
      'v1 := r.Group("/api/v1")',
      'v1.GET("/users/:id", getUser)',
      'mux.HandleFunc("GET /items/{id}", getItem)',
      'v1.POST("", createUser)',
      'v1.PUT("comment/:id", updateComment)',
      'db.Model(&x).Group("user_id").Find(&rows)',
      'log.Debug("body", zap.Any("payload", u))',
    ]);
    expect(callLines.map((c) => [c.line, c.signal])).toEqual([[1, 'go-route'], [2, 'go-route'], [3, 'go-route'], [4, 'go-route'], [5, 'go-route']]);
  });
});

describe('call lines through split, self-check and merge', () => {
  let root;
  let manifest;
  let area;
  const areasDir = () => join(root, '.excavator', 'intermediate', 'relations-areas');
  const write = (output) => writeFileSync(area.outputFile, JSON.stringify({ areaRun: { areaId: area.areaId, token: manifest.token }, ...output }));
  const check = () => {
    const context = JSON.parse(readFileSync(area.contextFile, 'utf-8'));
    const result = spawnSync('/bin/sh', ['-c', context.check], { encoding: 'utf-8' });
    return { status: result.status, lines: result.stdout.trim().split('\n') };
  };
  const merge = () => {
    const result = run('merge-relations.mjs', [root]);
    return {
      ...result,
      graph: JSON.parse(readFileSync(join(root, '.excavator', 'relations-graph.json'), 'utf-8')),
      coverage: JSON.parse(readFileSync(join(root, '.excavator', 'reports', 'relations-coverage.json'), 'utf-8')),
    };
  };

  beforeEach(() => {
    root = makeProject(FILES);
    expect(run('plan-units.mjs', [root]).status).toBe(0);
    const split = run('split-relation-areas.mjs', [root]);
    expect(split.status, split.stderr).toBe(0);
    expect(split.stdout).toMatch(new RegExp(`callLines=${CALLS} `));
    manifest = JSON.parse(readFileSync(join(areasDir(), 'manifest.json'), 'utf-8'));
    area = manifest.areas.find((a) => a.files.includes(API_FILE));
  });
  afterEach(() => removeProject(root));

  it('gives the analyzer every call line, beyond the cap on hints, and the merge the same list', () => {
    const context = JSON.parse(readFileSync(area.contextFile, 'utf-8'));
    const file = context.files.find((f) => f.file === API_FILE);
    expect(CALLS).toBeGreaterThan(MAX_HITS_PER_FILE);
    expect(file.callLines.map((c) => [c.line, c.to ?? c.line])).toEqual(big.calls.map((c) => [c.line, c.to]));
    expect(file.hits.every((h) => !['path-call', 'url-config-call'].includes(h.signal))).toBe(true);
    const candidate = manifest.candidates.find((c) => c.file === API_FILE);
    expect(candidate.callLines.map(([line, to]) => [line, to])).toEqual(big.calls.map((c) => [c.line, c.to]));
  });

  it('catches an output that writes only the one-line calls: the self-check lists each omitted call and fails', () => {
    write({ relations: oneLine.map(endOf), skippedFiles: [{ file: 'web/src/http.ts', reason: 'only creates the client' }] });
    const { status, lines } = check();
    expect(status).toBe(1);
    expect(lines[0]).toBe(`check ${area.areaId}: ends=${oneLine.length} accepted=${oneLine.length} rejected=0 call-lines=${CALLS} unaccounted=${others.length}`);
    expect(lines.slice(1).map((l) => l.split(' ').slice(0, 2).join(' '))).toEqual(others.map((c) => `unaccounted ${API_FILE}:${c.line}`));
  });

  it('counts the omitted calls in the merge, lists them, and keeps the count conserved', () => {
    write({ relations: oneLine.map(endOf), skippedFiles: [{ file: 'web/src/http.ts', reason: 'only creates the client' }] });
    const { status, stdout, graph, coverage } = merge();
    expect(status).toBe(0);
    expect(stdout).toMatch(new RegExp(`^call lines total=${CALLS} ended=${oneLine.length} evidence=0 ends-rejected=0 declared-skip=0 file-skipped=0 unaccounted=${others.length} area-missing=0$`, 'm'));
    expect(stdout).toContain(`unaccounted ${API_FILE}:${others[0].line} path-call`);
    expect(stdout).toMatch(/^unaccounted \.\.\. \d+ more in the coverage report$/m);
    expect(stdout).toMatch(new RegExp(`^conservation ok ends=${oneLine.length} duplicates=0 call-lines=${CALLS}$`, 'm'));
    expect(graph.callLines.unaccounted.map((r) => r.line)).toEqual(others.map((c) => c.line));
    expect(coverage.callLines.rows).toHaveLength(CALLS);
    expect(coverage.conservation).toMatchObject({ ok: true, callLines: CALLS, callLinesInBuckets: CALLS });
    // The call lines are never relations: only the ends the analyzer wrote are.
    expect(graph.relations).toHaveLength(oneLine.length);
  });

  it('accepts every call as an end, a skip with a reason, or an end at the path line, and then passes', () => {
    const [skipped, ...rest] = others;
    const atPathLine = rest.find((c) => c.shape === 'next-line');
    const ends = [...oneLine, ...rest.filter((c) => c !== atPathLine)].map(endOf);
    // An end cited where the path argument is, one line below the call, is on the call line.
    ends.push(httpCall({ ...atPathLine, line: atPathLine.line + 1, quote: `\`\${base}/reports/` }, { evidence: [{ file: API_FILE, line: atPathLine.line, quote: 'return apiClient.post(' }] }));
    write({
      relations: ends,
      skippedFiles: [{ file: 'web/src/http.ts', reason: 'only creates the client' }],
      skippedLines: [{ file: API_FILE, line: skipped.line, reason: 'a test stub left in the module, never called' }],
    });
    expect(check()).toEqual({ status: 0, lines: [`check ${area.areaId}: ends=${CALLS - 1} accepted=${CALLS - 1} rejected=0 call-lines=${CALLS} unaccounted=0`] });
    const { stdout, coverage } = merge();
    expect(stdout).toMatch(new RegExp(`^call lines total=${CALLS} ended=${CALLS - 1} evidence=0 ends-rejected=0 declared-skip=1 file-skipped=0 unaccounted=0 area-missing=0$`, 'm'));
    expect(coverage.callLines.rows.find((r) => r.line === skipped.line)).toMatchObject({ status: 'declared-skip', reason: 'a test stub left in the module, never called' });
  });

  it('counts the call lines of a skipped file and of a missing area apart from the unaccounted ones', () => {
    write({ relations: [], skippedFiles: [{ file: API_FILE, reason: 'generated client, not used' }, { file: 'web/src/http.ts', reason: 'only creates the client' }] });
    expect(merge().stdout).toMatch(new RegExp(`^call lines total=${CALLS} .* file-skipped=${CALLS} unaccounted=0 area-missing=0$`, 'm'));
    rmSync(area.outputFile);
    const missing = run('merge-relations.mjs', [root]);
    expect(missing.status).toBe(3);
    expect(missing.stdout).toMatch(new RegExp(`^call lines total=${CALLS} .* unaccounted=0 area-missing=${CALLS}$`, 'm'));
  });
});

describe('accountCallLines', () => {
  const calls = [{ file: 'a.ts', line: 10, to: 12, signal: 'path-call' }, { file: 'a.ts', line: 20, to: 20, signal: 'path-call' }];

  it('takes any line from where the call starts to where its match ends, and no other', () => {
    expect(accountCallLines({ callLines: calls, ended: new Map([['a.ts', [12, 21]]]) }).rows.map((r) => r.status)).toEqual(['ended', 'unaccounted']);
    expect(accountCallLines({ callLines: calls, ended: new Map([['a.ts', [9, 13, 19]]]) }).rows.map((r) => r.status)).toEqual(['unaccounted', 'unaccounted']);
    expect(accountCallLines({ callLines: calls, ended: new Map([['b.ts', [10, 20]]]) }).buckets.unaccounted).toBe(2);
  });

  it('gives each call line exactly one bucket, in a fixed order, and conserves the count', () => {
    const all = new Map([['a.ts', [10, 20]]]);
    const skip = new Map([['a.ts', [{ line: 10, reason: 'r' }, { line: 20, reason: 'r' }]]]);
    const cases = [
      [{ missingFiles: new Set(['a.ts']), ended: all }, 'area-missing'],
      [{ ended: all, evidence: all, rejected: all }, 'ended'],
      [{ evidence: all, rejected: all, skippedLines: skip }, 'evidence'],
      [{ rejected: all, skippedLines: skip }, 'ends-rejected'],
      [{ skippedLines: skip, skippedFiles: new Set(['a.ts']) }, 'declared-skip'],
      [{ skippedFiles: new Set(['a.ts']) }, 'file-skipped'],
      [{}, 'unaccounted'],
    ];
    for (const [given, bucket] of cases) {
      const result = accountCallLines({ callLines: calls, ...given });
      expect(result.rows.map((r) => r.status)).toEqual([bucket, bucket]);
      expect(result).toMatchObject({ total: 2, ok: true });
      expect(Object.keys(result.buckets)).toEqual([...CALL_LINE_BUCKETS]);
    }
  });
});
