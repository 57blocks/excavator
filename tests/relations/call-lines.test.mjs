/**
 * Call lines: the lines of a candidate file where a call or a registration is
 * written, listed by fixed shapes (relations-signals.mjs scanSource) and given
 * to the analyzer in full.
 *
 * The fixture is a large API file whose calls take four shapes: a path
 * argument on the call's line, a path argument on the next line, a method with
 * nested type arguments, and a request object with a `url` key; between them
 * are look-alikes that are no call line (a map lookup, a commented-out call, a
 * query parameter read).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanSource } from '../../skills/excavator-relations/relations-signals.mjs';
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

describe('call lines through the split', () => {
  let root;
  let manifest;
  let area;
  const areasDir = () => join(root, '.excavator', 'intermediate', 'relations-areas');

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
});
