// SourceSnapshot / snapshot-resolve-performance — blob-batch.mjs
// (openspec: changes/snapshot-resolve-performance, capability `source-snapshot`).
//
// Purpose-built synthetic git fixtures only (AGENTS.md: no real-project
// source). Verifies the batched `git cat-file --batch` reader against the
// SAME per-file `git show` semantics GitCommitSnapshot used before this
// change, so a bug in the new streaming parser shows up as a byte-level
// mismatch rather than as a green run.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync as realSpawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  BLOB_BATCH_SIZE,
  BlobBatchError,
  hashBlobs,
  readBlobPrefixes,
  searchBlobs,
  writeBlobs,
} from '../../skills/excavator/source-snapshot/blob-batch.mjs';
import { listTrackedEntries, showFileAt, headSha } from '../../skills/excavator/source-snapshot/git-utils.mjs';

function git(root, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root, encoding: 'utf-8' });
}

// A deterministic (not all-zero) pattern so any byte-offset corruption in
// the streaming parser is virtually certain to change the sha256, unlike an
// all-zero or all-repeating-byte buffer which can mask an off-by-one.
function patternBytes(size) {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) buf[i] = (i * 2654435761) % 256;
  return buf;
}

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'excavator-blob-batch-fixture-'));
  git(root, ['init', '-q']);
  writeFileSync(join(root, 'empty.txt'), Buffer.alloc(0));
  writeFileSync(join(root, 'binary.bin'), Buffer.from([0, 1, 2, 0, 255, 0, 10, 13, 0]));
  writeFileSync(join(root, 'unicode.txt'), '中文字符串 emoji 🚀🎉 更多内容\n', 'utf-8');
  writeFileSync(join(root, 'large.txt'), patternBytes(1_200_000)); // > default pipe read chunk (64KB)
  writeFileSync(join(root, 'dup1.txt'), 'duplicate content\n');
  writeFileSync(join(root, 'dup2.txt'), 'duplicate content\n'); // same oid as dup1.txt
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'blob-batch fixture']);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function trackedItems() {
  const sha = headSha(root);
  return listTrackedEntries(root, sha).map((e) => ({ oid: e.oid, path: e.path }));
}

function expectedBytes(path) {
  const sha = headSha(root);
  return showFileAt(root, sha, path);
}

describe('blob-batch — parity with per-file git show', () => {
  it('readBlobPrefixes returns a byte-identical prefix to git show for every fixture file (prefix bytes above every file except large.txt, which is truncated)', () => {
    const items = trackedItems();
    const prefixBytes = 8192;
    const prefixes = readBlobPrefixes(root, items, prefixBytes);
    expect(prefixes).toHaveLength(items.length);
    items.forEach((item, i) => {
      expect(prefixes[i]).toEqual(expectedBytes(item.path).subarray(0, prefixBytes));
    });
    // Sanity: large.txt is actually bigger than the prefix, so this test
    // genuinely exercises truncation rather than trivially matching a
    // smaller-than-prefix file.
    const largeIndex = items.findIndex((i) => i.path === 'large.txt');
    expect(expectedBytes('large.txt').length).toBeGreaterThan(prefixBytes);
    expect(prefixes[largeIndex].length).toBe(prefixBytes);
  });

  it('readBlobPrefixes keeps duplicate-oid paths independently correct', () => {
    const items = trackedItems();
    const prefixes = readBlobPrefixes(root, items, 8192);
    const dup1 = prefixes[items.findIndex((i) => i.path === 'dup1.txt')];
    const dup2 = prefixes[items.findIndex((i) => i.path === 'dup2.txt')];
    expect(dup1.toString('utf-8')).toBe('duplicate content\n');
    expect(dup2.toString('utf-8')).toBe('duplicate content\n');
  });

  it('hashBlobs matches sha256 of git show output for every fixture file', () => {
    const items = trackedItems();
    const hashes = hashBlobs(root, items);
    items.forEach((item, i) => {
      const expected = createHash('sha256').update(expectedBytes(item.path)).digest('hex');
      expect(hashes[i]).toBe(expected);
    });
  });

  it('writeBlobs writes byte-identical content to git show output for every fixture file', () => {
    const items = trackedItems();
    const dest = mkdtempSync(join(tmpdir(), 'excavator-blob-batch-write-'));
    try {
      writeBlobs(root, items, dest);
      for (const item of items) {
        expect(readFileSync(join(dest, item.path))).toEqual(expectedBytes(item.path));
      }
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });

  it('searchBlobs matches the existing per-file search semantics (skip NUL files, per-line per-term order)', () => {
    const items = trackedItems();
    const terms = ['content', '🚀', 'BEGIN'];
    const expected = [];
    for (const item of items) {
      const bytes = expectedBytes(item.path);
      if (bytes.includes(0)) continue;
      const lines = bytes.toString('utf-8').split('\n');
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        for (const term of terms) {
          if (lines[lineIndex].includes(term)) {
            expected.push({ path: item.path, line: lineIndex + 1, text: lines[lineIndex], term });
          }
        }
      }
    }
    expect(expected.length).toBeGreaterThan(0); // sanity: fixture actually exercises hits
    const actual = searchBlobs(root, items, terms);
    expect(actual).toEqual(expected);
  });
});

describe('blob-batch — missing objects', () => {
  const FAKE_OID = '0123456789abcdef0123456789abcdef01234567';

  it('readBlobPrefixes returns null (not a throw) for a missing object, keeping other items aligned', () => {
    const items = [...trackedItems(), { oid: FAKE_OID, path: 'missing.txt' }];
    const prefixes = readBlobPrefixes(root, items, 8192);
    expect(prefixes[prefixes.length - 1]).toBeNull();
    expect(prefixes[0]).toEqual(expectedBytes(items[0].path));
  });

  it('hashBlobs throws a named BlobBatchError for a missing object', () => {
    const items = [...trackedItems(), { oid: FAKE_OID, path: 'missing.txt' }];
    expect(() => hashBlobs(root, items)).toThrow(BlobBatchError);
    try {
      hashBlobs(root, items);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BlobBatchError);
      expect(err.paths).toContain('missing.txt');
    }
  });

  it('writeBlobs throws a named BlobBatchError for a missing object', () => {
    const items = [...trackedItems(), { oid: FAKE_OID, path: 'missing.txt' }];
    const dest = mkdtempSync(join(tmpdir(), 'excavator-blob-batch-write-missing-'));
    try {
      expect(() => writeBlobs(root, items, dest)).toThrow(BlobBatchError);
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  });

  it('searchBlobs throws a named BlobBatchError for a missing object', () => {
    const items = [...trackedItems(), { oid: FAKE_OID, path: 'missing.txt' }];
    expect(() => searchBlobs(root, items, ['content'])).toThrow(BlobBatchError);
  });
});

describe('blob-batch — isolation and batching (design D1/D2)', () => {
  it('readBlobPrefixes never returns more than prefixBytes even for a file with content beyond it', () => {
    const secretAfterPrefix = Buffer.concat([
      patternBytes(5000),
      Buffer.from('\n-----BEGIN PRIVATE KEY-----\nFAKE_BLOB_BATCH_CANARY\n'),
    ]);
    writeFileSync(join(root, 'header-secret.bin'), secretAfterPrefix);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'add header-after-prefix fixture']);

    const items = trackedItems();
    const target = items.find((i) => i.path === 'header-secret.bin');
    const [prefix] = readBlobPrefixes(root, [target], 4096);

    expect(prefix.length).toBeLessThanOrEqual(4096);
    expect(prefix.toString('latin1')).not.toContain('BEGIN PRIVATE KEY');
    expect(prefix.toString('latin1')).not.toContain('FAKE_BLOB_BATCH_CANARY');
  });

  it('splits more than BLOB_BATCH_SIZE items into multiple worker invocations with identical results to one batch', () => {
    // Duplicate the same handful of real oids many times under distinct
    // paths so the fixture does not need to actually create thousands of
    // files, while still exercising real `git cat-file --batch` batching.
    const base = trackedItems();
    const items = [];
    for (let i = 0; i < 10; i++) {
      for (const b of base) items.push({ oid: b.oid, path: `${b.path}#${i}` });
    }
    expect(items.length).toBeGreaterThan(base.length); // sanity

    let smallBatchSpawns = 0;
    const countingSpawnSync = (...args) => {
      smallBatchSpawns++;
      return realSpawnSync(...args);
    };
    const smallBatchResult = hashBlobs(root, items, { spawnSync: countingSpawnSync, batchSize: Math.ceil(items.length / 4) });
    expect(smallBatchSpawns).toBeGreaterThan(1);

    let singleBatchSpawns = 0;
    const countingSpawnSync2 = (...args) => {
      singleBatchSpawns++;
      return realSpawnSync(...args);
    };
    const singleBatchResult = hashBlobs(root, items, { spawnSync: countingSpawnSync2, batchSize: items.length });
    expect(singleBatchSpawns).toBe(1);

    expect(smallBatchResult).toEqual(singleBatchResult);
  });

  it('BLOB_BATCH_SIZE is the documented default (4096)', () => {
    expect(BLOB_BATCH_SIZE).toBe(4096);
  });
});

describe('blob-batch-worker — strict framing (design D1 risk mitigation)', () => {
  const WORKER_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../skills/excavator/source-snapshot/blob-batch-worker.mjs');

  it('rejects with a clear, non-zero-exit framing error — and emits no output for that object — when the trailing byte after object content is not a newline', () => {
    // A fake `git` on PATH that deliberately desyncs `cat-file --batch`'s
    // framing: a correct `<oid> blob <size>\n` header and exactly `size`
    // bytes of content, but the byte immediately after is 'X' instead of
    // the '\n' git always appends. This is the exact "帧格式严格" risk
    // design.md calls out — the worker must fail loudly here rather than
    // silently swallowing the last content byte as if it were framing.
    const fakeGitDir = mkdtempSync(join(tmpdir(), 'excavator-fake-git-'));
    const fakeGitPath = join(fakeGitDir, 'git');
    writeFileSync(fakeGitPath, [
      '#!/usr/bin/env node',
      "const oid = '0'.repeat(40);",
      "const content = Buffer.from('abcde');",
      "process.stdout.write(`${oid} blob ${content.length}\\n`);",
      'process.stdout.write(content);',
      "process.stdout.write('X'); // desync: should be '\\n'",
      '',
    ].join('\n'));
    chmodSync(fakeGitPath, 0o755);

    try {
      const job = JSON.stringify({ cwd: fakeGitDir, mode: 'hash', items: [{ oid: '0'.repeat(40), path: 'x.txt' }] });
      const result = realSpawnSync(process.execPath, [WORKER_PATH], {
        input: job,
        env: { ...process.env, PATH: `${fakeGitDir}:${process.env.PATH}` },
        encoding: 'utf-8',
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('expected trailing newline');
      expect(result.stdout).toBe(''); // no hash line was emitted for the desynced object
    } finally {
      rmSync(fakeGitDir, { recursive: true, force: true });
    }
  });

  it('keeps valid streams working exactly as before (sanity: the fake-git harness itself is not what makes this pass)', () => {
    // Same fake-git harness, but with a CORRECT trailing newline — proves
    // the strict check above only rejects the actually-broken case, not
    // every custom `git` on PATH.
    const fakeGitDir = mkdtempSync(join(tmpdir(), 'excavator-fake-git-valid-'));
    const fakeGitPath = join(fakeGitDir, 'git');
    writeFileSync(fakeGitPath, [
      '#!/usr/bin/env node',
      "const oid = '0'.repeat(40);",
      "const content = Buffer.from('abcde');",
      "process.stdout.write(`${oid} blob ${content.length}\\n`);",
      'process.stdout.write(content);',
      "process.stdout.write('\\n'); // correct framing byte",
      '',
    ].join('\n'));
    chmodSync(fakeGitPath, 0o755);

    try {
      const job = JSON.stringify({ cwd: fakeGitDir, mode: 'hash', items: [{ oid: '0'.repeat(40), path: 'x.txt' }] });
      const result = realSpawnSync(process.execPath, [WORKER_PATH], {
        input: job,
        env: { ...process.env, PATH: `${fakeGitDir}:${process.env.PATH}` },
        encoding: 'utf-8',
      });

      expect(result.status).toBe(0);
      const [index, digest] = JSON.parse(result.stdout.trim());
      expect(index).toBe(0);
      expect(digest).toBe(createHash('sha256').update('abcde').digest('hex'));
    } finally {
      rmSync(fakeGitDir, { recursive: true, force: true });
    }
  });
});
