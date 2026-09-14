// SourceSnapshot / Task 1 — DirectorySnapshot + the D7 consistency guard
// (openspec: changes/source-snapshot, capability `source-snapshot`).
//
// Purpose-built synthetic fixtures only (AGENTS.md: no real-project source).
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveSourceSnapshot, DirectorySnapshot } from '../../skills/excavator/source-snapshot.mjs';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'excavator-dirsnap-fixture-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.ts'), "export function a() { return 1; }\n");
  writeFileSync(join(root, 'README.md'), '# fixture\n');
  return root;
}

describe('DirectorySnapshot — revision shape and file listing', () => {
  let root;
  beforeEach(() => { root = makeFixture(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('resolves a plain non-git directory to a DirectorySnapshot with a directory:<sha256> revision', () => {
    const snapshot = resolveSourceSnapshot(root);
    expect(snapshot).toBeInstanceOf(DirectorySnapshot);
    expect(snapshot.kind).toBe('directory');
    expect(snapshot.revision).toMatch(/^directory:[0-9a-f]{64}$/);
  });

  it('listFiles/readFile agree: every listed path is readable and content matches disk', () => {
    const snapshot = resolveSourceSnapshot(root);
    const files = snapshot.listFiles();
    expect(files).toEqual(['README.md', 'src/a.ts']);
    for (const path of files) {
      const fromSnapshot = snapshot.readFile(path).toString('utf-8');
      const fromDisk = readFileSync(join(root, path), 'utf-8');
      expect(fromSnapshot).toBe(fromDisk);
    }
  });

  it('excludes .excavator/ from listFiles and from the revision digest', () => {
    const before = resolveSourceSnapshot(root);
    mkdirSync(join(root, '.excavator'));
    writeFileSync(join(root, '.excavator', 'knowledge-graph.json'), '{}');
    const after = resolveSourceSnapshot(root);

    expect(after.listFiles().some((p) => p.startsWith('.excavator'))).toBe(false);
    expect(after.revision).toBe(before.revision);
  });

  it('a new revision follows an added, a modified, and a deleted file', () => {
    const initial = resolveSourceSnapshot(root).revision;

    writeFileSync(join(root, 'src', 'b.ts'), "export function b() { return 2; }\n");
    const afterAdd = resolveSourceSnapshot(root).revision;
    expect(afterAdd).not.toBe(initial);

    writeFileSync(join(root, 'src', 'b.ts'), "export function b() { return 3; }\n");
    const afterModify = resolveSourceSnapshot(root).revision;
    expect(afterModify).not.toBe(afterAdd);

    rmSync(join(root, 'src', 'b.ts'));
    const afterDelete = resolveSourceSnapshot(root).revision;
    expect(afterDelete).toBe(initial);
  });
});

describe('DirectorySnapshot — readFile read-time hash check', () => {
  let root;
  beforeEach(() => { root = makeFixture(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('throws when disk content no longer matches the hash captured at construction', () => {
    const snapshot = resolveSourceSnapshot(root);
    writeFileSync(join(root, 'src', 'a.ts'), 'export function a() { return 999; }\n');
    expect(() => snapshot.readFile('src/a.ts')).toThrow(/content hash mismatch/);
  });

  it('materialize() records drift instead of throwing, and copies unaffected files normally', () => {
    const snapshot = resolveSourceSnapshot(root);
    writeFileSync(join(root, 'src', 'a.ts'), 'export function a() { return 999; }\n');

    const materialized = snapshot.materialize();
    try {
      expect(materialized.drifted).toBe(true);
      expect(materialized.driftedPaths).toEqual(['src/a.ts']);
      // README.md was untouched — still copied.
      expect(readFileSync(join(materialized.dir, 'README.md'), 'utf-8')).toBe('# fixture\n');
    } finally {
      materialized.cleanup();
    }
  });
});

describe('DirectorySnapshot — runGuarded (D7 consistency guard)', () => {
  let root;
  beforeEach(() => { root = makeFixture(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('publishes on the first attempt when nothing changes during the run', async () => {
    const snapshot = resolveSourceSnapshot(root);
    const published = [];
    const result = await snapshot.runGuarded(
      async (dir) => `product-from-${dir}`,
      async (product) => { published.push(product); },
    );
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(published).toHaveLength(1);
  });

  it('verify-the-instrument: a producer that mutates the source is DETECTED as inconsistent (not silently accepted)', async () => {
    const snapshot = resolveSourceSnapshot(root);
    const published = [];
    const result = await snapshot.runGuarded(
      async () => {
        // Simulate "source keeps changing during analysis" on every attempt.
        writeFileSync(join(root, 'src', 'a.ts'), `export function a() { return ${Math.random()}; }\n`);
        return 'product';
      },
      async (product) => { published.push(product); },
    );
    expect(result.ok).toBe(false);
    expect(published).toHaveLength(0); // never published an inconsistent result.
  });

  it('recovers after exactly one drift: mutates only on the first attempt, then succeeds on retry', async () => {
    const snapshot = resolveSourceSnapshot(root);
    let calls = 0;
    const published = [];
    const result = await snapshot.runGuarded(
      async () => {
        calls++;
        if (calls === 1) {
          writeFileSync(join(root, 'src', 'a.ts'), 'export function a() { return 2; }\n');
        }
        return `product-${calls}`;
      },
      async (product) => { published.push(product); },
    );
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(calls).toBe(2);
    expect(published).toEqual(['product-2']);
  });

  it('retries once then fails visibly when the source keeps changing before every publish', async () => {
    const snapshot = resolveSourceSnapshot(root);
    let calls = 0;
    const published = [];
    const result = await snapshot.runGuarded(
      async () => {
        calls++;
        // Content is guaranteed to differ from the fixture's initial content
        // (which also says "return 1") on every call, including the first.
        writeFileSync(join(root, 'src', 'a.ts'), `export function a() { return ${100 + calls}; }\n`);
        return `product-${calls}`;
      },
      async (product) => { published.push(product); },
    );
    expect(calls).toBe(2); // one retry, then give up.
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(2);
    expect(typeof result.reason).toBe('string');
    expect(published).toHaveLength(0); // publish is NEVER called on the failing path.
  });
});

describe('DirectorySnapshot — diff()', () => {
  let root;
  beforeEach(() => { root = makeFixture(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('classifies added/modified/removed against a previous manifest', () => {
    const before = resolveSourceSnapshot(root);
    const previousManifest = { entries: before.entries() };

    writeFileSync(join(root, 'src', 'a.ts'), 'export function a() { return 2; }\n'); // modified
    writeFileSync(join(root, 'src', 'c.ts'), 'export function c() {}\n'); // added
    rmSync(join(root, 'README.md')); // removed

    const after = resolveSourceSnapshot(root);
    const diff = after.diff(previousManifest);
    expect(diff.added).toEqual(['src/c.ts']);
    expect(diff.modified).toEqual(['src/a.ts']);
    expect(diff.removed).toEqual(['README.md']);
  });
});
