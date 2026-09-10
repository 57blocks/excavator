/**
 * The identity fixtures, run through the real extraction pass.
 *
 * These assertions are the extraction half of design D2: a declaration's
 * identity is (path, owner, name), so the extractors have to REPORT the owner.
 * Where they do not, two declarations in one file collapse onto one node — the
 * failure mode this fixture set exists to keep visible.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const FIXTURE_ROOT = join(REPO_ROOT, 'tests/fixtures/identity');
const STRUCTURE = join(REPO_ROOT, 'skills/excavator/extract-structure.mjs');

const FILES = [
  { path: 'a/util.ts', language: 'typescript', fileCategory: 'code' },
  { path: 'b/util.ts', language: 'typescript', fileCategory: 'code' },
  { path: 'go/receivers.go', language: 'go', fileCategory: 'code' },
  { path: 'cs/Overloads.cs', language: 'csharp', fileCategory: 'code' },
  { path: 'php/mixed.php', language: 'php', fileCategory: 'code' },
  { path: 'ts/api.ts', language: 'typescript', fileCategory: 'code' },
];

let results;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'excavator-identity-'));
  try {
    const inputPath = join(dir, 'in.json');
    const outputPath = join(dir, 'out.json');
    writeFileSync(
      inputPath,
      JSON.stringify({ projectRoot: FIXTURE_ROOT, batchFiles: FILES, batchImportData: {} }),
    );
    const r = spawnSync('node', [STRUCTURE, inputPath, outputPath], { encoding: 'utf-8' });
    if (r.status !== 0) throw new Error(`extract-structure failed: ${r.stderr}`);
    const output = JSON.parse(readFileSync(outputPath, 'utf-8'));
    results = new Map(output.results.map((res) => [res.path, res]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);

/** Every declaration the extractors reported for one fixture file. */
function declarations(path) {
  const res = results.get(path);
  expect(res, `no result row for ${path}`).toBeDefined();
  expect(res.status).toBe('parsed');
  return {
    functions: res.functions ?? [],
    classes: res.classes ?? [],
  };
}

describe('identity fixtures — extraction reports an owner for every declaration', () => {
  it('parses every fixture file', () => {
    for (const file of FILES) {
      expect(results.get(file.path)?.status, file.path).toBe('parsed');
    }
  });

  it('two byte-identical files at different paths each report their own f', () => {
    const a = declarations('a/util.ts');
    const b = declarations('b/util.ts');
    expect(a.functions.map((f) => f.name)).toEqual(['f']);
    expect(b.functions.map((f) => f.name)).toEqual(['f']);
    // Identical content: only the path can tell the two declarations apart.
    expect(readFileSync(join(FIXTURE_ROOT, 'a/util.ts'), 'utf-8')).toBe(
      readFileSync(join(FIXTURE_ROOT, 'b/util.ts'), 'utf-8'),
    );
  });

  it('Go reports the receiver type as owner, pointer stripped, and "" for a free function', () => {
    const { functions } = declarations('go/receivers.go');
    const saves = functions.filter((f) => f.name === 'Save');
    expect(saves).toHaveLength(3);
    expect(saves.map((f) => f.owner).sort()).toEqual(['', 'A', 'B']);
    // startLine differs for all three, so even a collapsed id can be split
    expect(new Set(saves.map((f) => f.startLine)).size).toBe(3);
  });

  it('C# reports the declaring type as owner, so same-named methods stay in one group', () => {
    const { functions } = declarations('cs/Overloads.cs');
    const gets = functions.filter((f) => f.name === 'Get');
    expect(gets).toHaveLength(3);
    expect(gets.filter((f) => f.owner === 'Overloads')).toHaveLength(2);
    expect(gets.filter((f) => f.owner === 'Other')).toHaveLength(1);
    // The two Overloads.Get entries are a real collision group: same path,
    // same owner, same name — only their line numbers differ.
    const group = gets.filter((f) => f.owner === 'Overloads');
    expect(group[0].startLine).not.toBe(group[1].startLine);
  });

  it('PHP reports trait, enum and anonymous-class methods with their owner', () => {
    const { functions, classes } = declarations('php/mixed.php');
    const byName = new Map(functions.map((f) => [f.name, f]));

    expect(byName.get('hello')?.owner).toBe('Greets');
    expect(byName.get('label')?.owner).toBe('Status');
    expect(byName.get('make')?.owner).toBe('Holder');

    const run = byName.get('run');
    expect(run).toBeDefined();
    // An anonymous class is named by where it is declared.
    expect(run.owner).toMatch(/^anon@\d+$/);

    const classNames = classes.map((c) => c.name);
    expect(classNames).toContain('Greets');
    expect(classNames).toContain('Status');
    expect(classNames).toContain('Holder');
    expect(classNames.some((n) => /^anon@\d+$/.test(n))).toBe(true);
  });

  it('TypeScript reports object-literal members and class methods with their owner', () => {
    const { functions, classes } = declarations('ts/api.ts');
    const owned = functions.map((f) => `${f.owner}.${f.name}`);

    // object literal: owner is the binding, nested literals extend the path
    expect(owned).toContain('api.list');
    expect(owned).toContain('api.get');
    expect(owned).toContain('api.nested.deep');
    // class methods: owner is the class
    expect(owned).toContain('Api.list');
    expect(owned).toContain('Api.get');

    // `list` and `get` each appear twice in this file and are only
    // distinguishable by owner — the collapse this fixture guards against.
    expect(functions.filter((f) => f.name === 'list')).toHaveLength(2);
    expect(functions.filter((f) => f.name === 'get')).toHaveLength(2);
    expect(classes.map((c) => c.name)).toEqual(['Api']);
  });

  it('every reported declaration carries an anchor', () => {
    for (const file of FILES) {
      const { functions, classes } = declarations(file.path);
      for (const decl of [...functions, ...classes]) {
        expect(Number.isInteger(decl.startLine), `${file.path} ${decl.name}`).toBe(true);
        expect(Number.isInteger(decl.endLine), `${file.path} ${decl.name}`).toBe(true);
        expect(decl.endLine).toBeGreaterThanOrEqual(decl.startLine);
      }
    }
  });
});
