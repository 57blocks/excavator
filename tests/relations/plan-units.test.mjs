/**
 * plan-units.mjs — runtime units are decided once, by fixed rules, and
 * reused while their input is unchanged.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decideUnits, deepestDir, reconcileUnits, unitOfFile, unitsDigest } from '../../skills/excavator-relations/plan-units.mjs';
import { FILES, makeProject, removeProject, run } from './fixture.mjs';

const roots = [];
afterEach(() => { while (roots.length) removeProject(roots.pop()); });

function decide(files, entryPointsByFile) {
  const lines = (f) => (files[f] === undefined ? null : files[f].split('\n'));
  return decideUnits({ files: Object.keys(files).sort(), readLines: lines, entryPointsByFile, projectName: 'p' });
}

describe('decideUnits', () => {
  it('classifies runtime, library and container units with their evidence', () => {
    const { units } = decide(FILES);
    const kind = Object.fromEntries(units.map((u) => [u.id, u.kind]));
    expect(kind).toEqual({ 'unit:.': 'container', 'unit:lib': 'library', 'unit:server': 'runtime', 'unit:web': 'runtime', 'unit:worker': 'runtime' });
    const worker = units.find((u) => u.id === 'unit:worker');
    expect(worker.evidence.map((e) => e.rule)).toEqual(['go-main']);
    expect(worker.name).toBe('worker');
  });

  it('makes an application whose build lists modules runtime when its own source has an entry', () => {
    const { units } = decide({
      'pom.xml': '<project><artifactId>app</artifactId><modules><module>client</module></modules></project>',
      'src/main/java/App.java': '@SpringBootApplication\npublic class App {}',
      'client/pom.xml': '<project><artifactId>client</artifactId></project>',
      'client/src/Client.java': 'class Client {}',
    });
    expect(units.find((u) => u.id === 'unit:.').kind).toBe('runtime');
    expect(units.find((u) => u.id === 'unit:client').kind).toBe('library');
  });

  it('adds a synthetic unmanifested root unit when files sit outside every manifest', () => {
    const { units } = decide({ 'svc/go.mod': 'module x', 'svc/main.go': 'package main', 'scripts/deploy.js': 'x' });
    expect(units.find((u) => u.id === 'unit:.')).toMatchObject({ kind: 'unmanifested', manifests: [] });
  });

  it('uses a graph route entry point as runtime evidence', () => {
    const { units } = decide({ 'api/package.json': '{"name":"api"}', 'api/routes.js': 'x' }, new Map([['api/routes.js', [{ line: 3, method: 'GET', path: '/a' }]]]));
    expect(units[0]).toMatchObject({ kind: 'runtime' });
    expect(units[0].evidence[0]).toMatchObject({ rule: 'route-entry-point', line: 3, text: 'GET /a' });
  });

  it('maps a file to the deepest unit root', () => {
    expect(deepestDir('a/b/c.js', new Set(['.', 'a']))).toBe('a');
    expect(deepestDir('x/c.js', new Set(['a']))).toBe(null);
    const of = unitOfFile([{ id: 'unit:.', root: '.' }, { id: 'unit:web', root: 'web' }]);
    expect(of('web/src/a.js')).toBe('unit:web');
    expect(of('tools/a.js')).toBe('unit:.');
  });
});

describe('reconcileUnits', () => {
  it('reuses stored units on the same digest and reports changes otherwise', () => {
    const { units, inputs } = decide(FILES);
    const digest = unitsDigest(inputs);
    const stored = { format: 'excavator-relations-units/1', digest, units };
    expect(reconcileUnits({ stored, units: [], digest, reunit: false }).mode).toBe('reused');
    expect(reconcileUnits({ stored, units, digest, reunit: true }).mode).toBe('changed');
    const changed = reconcileUnits({ stored, units: units.filter((u) => u.id !== 'unit:lib').map((u) => (u.id === 'unit:web' ? { ...u, kind: 'library' } : u)), digest: 'other', reunit: false });
    expect(changed.changes).toEqual(['rekinded unit:web runtime->library', 'removed unit:lib']);
    expect(reconcileUnits({ stored: null, units, digest, reunit: false }).mode).toBe('new');
  });
});

describe('plan-units CLI', () => {
  it('writes the units once and reuses them byte-identically on a warm run', () => {
    const root = makeProject();
    roots.push(root);
    const first = run('plan-units.mjs', [root]);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toMatch(/^units=new .* units=5 runtime=3 library=1 container=1 unmanifested=0/);
    const path = join(root, '.excavator', 'relations-units.json');
    const before = readFileSync(path, 'utf-8');
    const second = run('plan-units.mjs', [root]);
    expect(second.stdout).toMatch(/^units=reused /);
    expect(readFileSync(path, 'utf-8')).toBe(before);

    writeFileSync(join(root, 'lib', 'package.json'), JSON.stringify({ name: 'lib', scripts: { start: 'node index.js' } }));
    const third = run('plan-units.mjs', [root]);
    expect(third.stdout).toMatch(/^units=changed /);
    expect(third.stdout).toContain('rekinded unit:lib library->runtime');
  });
});
