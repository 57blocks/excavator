/**
 * check-relations-area.mjs — the analyzer's self-check reports exactly the
 * ends the merge would reject, from the command the split writes into each
 * area's context.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeProject, removeProject, run } from './fixture.mjs';

let root;
let manifest;

beforeEach(() => {
  root = makeProject();
  expect(run('plan-units.mjs', [root]).status).toBe(0);
  const split = run('split-relation-areas.mjs', [root]);
  expect(split.status, split.stderr).toBe(0);
  manifest = JSON.parse(readFileSync(join(root, '.excavator', 'intermediate', 'relations-areas', 'manifest.json'), 'utf-8'));
});
afterEach(() => removeProject(root));

const area = (unit) => manifest.areas.find((a) => a.unit === unit);
const contextOf = (unit) => JSON.parse(readFileSync(area(unit).contextFile, 'utf-8'));

/** Run the context's own `check` command through a shell, as an analyzer would. */
function check(unit) {
  const result = spawnSync('/bin/sh', ['-c', contextOf(unit).check], { encoding: 'utf-8' });
  return { status: result.status, lines: result.stdout.trim().split('\n') };
}

function write(unit, relations, token = manifest.token) {
  const a = area(unit);
  writeFileSync(a.outputFile, JSON.stringify({ areaRun: { areaId: a.areaId, token }, relations }));
}

const usersCall = (quote, evidence) => ({
  kind: 'http', address: { method: 'GET', path: '/api/users/${id}' }, receiver: null,
  caller: { file: 'web/src/users.js', line: 3, quote, ...(evidence ? { evidence } : {}) },
});

describe('check-relations-area', () => {
  it('writes a runnable check command into every area context', () => {
    for (const a of manifest.areas) {
      const context = JSON.parse(readFileSync(a.contextFile, 'utf-8'));
      expect(context.check).toContain('check-relations-area.mjs');
      expect(context.check).toContain(a.contextFile);
    }
  });

  it('passes an output the merge would accept and exits 0', () => {
    write('unit:web', [usersCall('return api.get(`/api/users/${id}`);')]);
    expect(check('unit:web')).toEqual({ status: 0, lines: [`check ${area('unit:web').areaId}: ends=1 accepted=1 rejected=0`] });
  });

  it('lists each end the merge would reject, with its reason, and exits 1', () => {
    write('unit:web', [
      usersCall('return api.get(`/api/users/${id}`);'),
      // The address names a word no cited line holds.
      { kind: 'http', address: { method: 'GET', path: '/api/v2/users/${id}' }, receiver: null, caller: { file: 'web/src/users.js', line: 3, quote: 'return api.get' } },
      usersCall('return api.delete(everything)'),
      { kind: 'http', address: { method: 'POST', path: '/api/orders' }, receiver: null, caller: { file: 'server/app.js', line: 6, quote: "app.post('/api/orders'" } },
    ]);
    const { status, lines } = check('unit:web');
    expect(status).toBe(1);
    expect(lines[0]).toBe(`check ${area('unit:web').areaId}: ends=4 accepted=1 rejected=3`);
    expect(lines.slice(1)).toEqual([
      'rejected relations[1].caller web/src/users.js:3 address-not-quoted: v2',
      'rejected relations[2].caller web/src/users.js:3 quote-mismatch: web/src/users.js:3',
      'rejected relations[3].caller server/app.js:6 outside-area: server/app.js',
    ]);
  });

  it('passes once the address names only words of the cited lines', () => {
    const call = { kind: 'http', address: { method: 'GET', path: '/api/ping' }, receiver: null, caller: { file: 'web/src/users.js', line: 9, quote: "return api.get('/api/ping');" } };
    write('unit:web', [{ ...call, address: { method: 'GET', path: '/base/api/ping' } }]);
    expect(check('unit:web').lines[1]).toBe('rejected relations[0].caller web/src/users.js:9 address-not-quoted: base');
    write('unit:web', [call]);
    expect(check('unit:web').status).toBe(0);
  });

  it('exits 2 for a missing output or another run\'s token', () => {
    expect(check('unit:web')).toEqual({ status: 2, lines: [`check ${area('unit:web').areaId}: missing`] });
    write('unit:web', [], 'another-token');
    const stale = check('unit:web');
    expect(stale.status).toBe(2);
    expect(stale.lines[0]).toMatch(/rejected-stale/);
  });
});
