import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LanguageRegistry } from '../../packages/core/src/languages/language-registry.ts';
import scanProject from '../../skills/excavator/scan-project.mjs';
import { runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { resolveSourceSnapshot } from '../../skills/excavator/source-snapshot.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = resolve(__dirname, '../fixtures/selection-safety');
const SECRET_PATH = 'config/privatekey3072.txt';
const EXTENSION_SECRET_PATH = 'config/extension-only.key';
const CONTROL_PATH = 'config/same-size-control.txt';
const ARCHIVE_PATH = 'unmc.zip';
const EXPECTED_SELECTED = [
  'Dockerfile-prod',
  'Dockerfile-qa',
  'Dockerfile-test',
  'Dockerfile.dev',
  'MyDockerfile-prod',
  'bin/rails',
  CONTROL_PATH,
  'package.json',
  'src/app.ts',
  'src/view.tsx',
].sort();

const tempRoots = [];

function git(root, args) {
  return execFileSync(
    'git',
    ['-c', 'user.email=oracle@example.invalid', '-c', 'user.name=Selection Oracle', ...args],
    { cwd: root, encoding: 'utf-8' },
  );
}

function makeTemp(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function copyFixture(root) {
  cpSync(FIXTURE_ROOT, root, { recursive: true });
}

function makeDirectoryFixture() {
  const root = makeTemp('excavator-selection-dir-');
  copyFixture(root);
  return root;
}

function makeGitFixture() {
  const root = makeTemp('excavator-selection-git-');
  copyFixture(root);
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'synthetic selection fixture']);
  return root;
}

function makeMultiRepoFixture() {
  const root = makeTemp('excavator-selection-multi-');
  const member = join(root, 'member');
  mkdirSync(member);
  copyFixture(member);
  git(member, ['init', '-q']);
  git(member, ['add', '-A']);
  git(member, ['commit', '-q', '-m', 'synthetic selection fixture']);
  return root;
}

function walkFiles(root) {
  const paths = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) paths.push(relative(root, absolute).split(sep).join('/'));
    }
  }
  walk(root);
  return paths.sort();
}

function artifactJson(root) {
  const dataRoot = join(root, '.excavator');
  if (!existsSync(dataRoot)) return [];
  return walkFiles(dataRoot)
    .filter((path) => path.endsWith('.json'))
    .map((path) => ({ path, value: JSON.parse(readFileSync(join(dataRoot, path), 'utf-8')) }));
}

function collectPathRecords(value, wantedPath, records = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectPathRecords(item, wantedPath, records);
  } else if (value && typeof value === 'object') {
    if (value.path === wantedPath) records.push(value);
    for (const child of Object.values(value)) collectPathRecords(child, wantedPath, records);
  }
  return records;
}

function stripMemberPrefix(paths) {
  return paths.map((path) => path.replace(/^member\//, '')).sort();
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop(), { recursive: true, force: true });
  }
});

describe('frozen selection-safety oracle — sensitive containment', () => {
  it('keeps the byte-identical-size ordinary text control selected', () => {
    const secret = readFileSync(join(FIXTURE_ROOT, SECRET_PATH));
    const control = readFileSync(join(FIXTURE_ROOT, CONTROL_PATH));
    const canary = secret.toString('utf-8').match(/EXCAVATOR_FAKE_SECRET_CANARY_[A-Za-z0-9]+/)?.[0];
    expect(canary).toBeTruthy();
    expect(secret.toString('utf-8')).toContain('BEGIN PRIVATE KEY');
    expect(secret.byteLength).toBe(control.byteLength);

    const snapshot = resolveSourceSnapshot(makeDirectoryFixture());
    expect(snapshot.listFiles()).toContain(CONTROL_PATH);
    expect(snapshot.readFile(CONTROL_PATH)).toEqual(control);
  });

  it('rejects the fake key before list/read/search consumers can recover it', () => {
    const secret = readFileSync(join(FIXTURE_ROOT, SECRET_PATH), 'utf-8');
    const canary = secret.match(/EXCAVATOR_FAKE_SECRET_CANARY_[A-Za-z0-9]+/)?.[0];
    const snapshot = resolveSourceSnapshot(makeDirectoryFixture());

    expect.soft(snapshot.listFiles()).not.toContain(SECRET_PATH);
    expect.soft(snapshot.listFiles()).not.toContain(EXTENSION_SECRET_PATH);
    expect.soft(() => snapshot.readFile(SECRET_PATH)).toThrow(/not part of this snapshot/);
    expect.soft(snapshot.search([canary])).toEqual([]);
  });

  it('never materializes the fake key path or canary bytes', () => {
    const secret = readFileSync(join(FIXTURE_ROOT, SECRET_PATH), 'utf-8');
    const canary = secret.match(/EXCAVATOR_FAKE_SECRET_CANARY_[A-Za-z0-9]+/)?.[0];
    const snapshot = resolveSourceSnapshot(makeDirectoryFixture());

    const materialized = snapshot.materialize();
    try {
      expect.soft(walkFiles(materialized.dir)).not.toContain(SECRET_PATH);
      expect.soft(walkFiles(materialized.dir)).not.toContain(EXTENSION_SECRET_PATH);
      const materializedText = walkFiles(materialized.dir)
        .map((path) => readFileSync(join(materialized.dir, path)))
        .filter((bytes) => !bytes.includes(0))
        .map((bytes) => bytes.toString('utf-8'))
        .join('\n');
      expect.soft(materializedText).not.toContain(canary);
    } finally {
      materialized.cleanup();
    }
  });

  it('persists one safe sensitive record without canary, excerpt, content, or content hash', async () => {
    const root = makeDirectoryFixture();
    const secret = readFileSync(join(root, SECRET_PATH), 'utf-8');
    const canary = secret.match(/EXCAVATOR_FAKE_SECRET_CANARY_[A-Za-z0-9]+/)?.[0];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const result = await runLazyAnalysis({
      projectRoot: root,
      now: () => '2026-09-16T00:00:00.000Z',
    });

    expect(result.saveError).toBeNull();
    expect(stderr.mock.calls.flat().join('')).not.toContain(canary);

    const artifacts = artifactJson(root);
    expect(JSON.stringify(artifacts)).not.toContain(canary);
    const records = artifacts.flatMap(({ value }) => collectPathRecords(value, SECRET_PATH));
    const extensionRecords = artifacts.flatMap(({ value }) => collectPathRecords(value, EXTENSION_SECRET_PATH));
    expect.soft(records.some((record) => record.reason === 'sensitive')).toBe(true);
    expect.soft(extensionRecords.some((record) => record.reason === 'sensitive')).toBe(true);
    for (const record of [...records, ...extensionRecords]) {
      expect.soft(record).not.toHaveProperty('content');
      expect.soft(record).not.toHaveProperty('excerpt');
      expect.soft(record).not.toHaveProperty('contentHash');
    }
  });
});

describe('frozen selection-safety oracle — universal defaults and adapters', () => {
  it('keeps non-MAUI bin/rails selected', () => {
    const snapshot = resolveSourceSnapshot(makeDirectoryFixture());
    expect(snapshot.listFiles()).toContain('bin/rails');
  });

  it('selects the same safe path set and digest through Directory, Git, and MultiRepo adapters', () => {
    const directory = resolveSourceSnapshot(makeDirectoryFixture());
    const gitSnapshot = resolveSourceSnapshot(makeGitFixture());
    const multiRepo = resolveSourceSnapshot(makeMultiRepoFixture());

    expect.soft(directory.listFiles().sort()).toEqual(EXPECTED_SELECTED);
    expect.soft(gitSnapshot.listFiles().sort()).toEqual(EXPECTED_SELECTED);
    expect.soft(stripMemberPrefix(multiRepo.listFiles())).toEqual(EXPECTED_SELECTED);
    expect.soft(new Set([directory.selectionDigest, gitSnapshot.selectionDigest, multiRepo.selectionDigest]).size).toBe(1);
  });
});

describe('frozen selection-safety oracle — canonical language matching', () => {
  it.each([
    ['src/app.ts', 'typescript', 'code'],
    ['src/view.tsx', 'typescript', 'code'],
    ['Dockerfile.dev', 'dockerfile', 'infra'],
    ['Dockerfile-prod', 'dockerfile', 'infra'],
    ['Dockerfile-qa', 'dockerfile', 'infra'],
    ['Dockerfile-test', 'dockerfile', 'infra'],
    ['MyDockerfile-prod', 'unknown', null],
  ])('keeps registry and scanner aligned for %s', (path, expectedLanguage, expectedCategory) => {
    const registryLanguage = LanguageRegistry.createDefault().getForFile(path)?.id ?? 'unknown';
    expect(registryLanguage).toBe(expectedLanguage);
    expect(scanProject.classifyLanguage(path).language).toBe(expectedLanguage);
    if (expectedCategory !== null) {
      expect(scanProject.detectCategory(path)).toBe(expectedCategory);
    }
  });
});

describe('frozen selection-safety oracle — archive invariance', () => {
  it('produces identical selected paths and factsDigest with unmc.zip present or absent', async () => {
    const withArchive = makeDirectoryFixture();
    const withoutArchive = makeDirectoryFixture();
    rmSync(join(withoutArchive, ARCHIVE_PATH));

    const withSnapshot = resolveSourceSnapshot(withArchive);
    const withoutSnapshot = resolveSourceSnapshot(withoutArchive);
    expect(withSnapshot.listFiles()).not.toContain(ARCHIVE_PATH);
    expect(withSnapshot.listFiles()).toEqual(withoutSnapshot.listFiles());

    const [withResult, withoutResult] = await Promise.all([
      runLazyAnalysis({ projectRoot: withArchive, now: () => '2026-09-16T00:00:00.000Z' }),
      runLazyAnalysis({ projectRoot: withoutArchive, now: () => '2026-09-16T00:00:00.000Z' }),
    ]);
    expect(withResult.saveError).toBeNull();
    expect(withoutResult.saveError).toBeNull();
    expect(withResult.factsDigest).toBe(withoutResult.factsDigest);
  });
});
