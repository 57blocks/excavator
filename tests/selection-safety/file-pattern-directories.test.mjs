// source-selection-safety: default file patterns do not exclude directories.
//
// A default pattern without a trailing `/` (`LICENSE`, `*.log`, ...) names
// files. Under gitignore semantics it would also match a directory of the
// same name, case-insensitively, and drop a whole source package. This suite
// presents one synthetic project through the Directory, Git and MultiRepo
// adapters and checks they select the same paths with the same digest, and
// that the selected sources reach the fact graph.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { resolveSourceSnapshot } from '../../skills/excavator/source-snapshot.mjs';
import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';

const JAVA_SOURCE = 'src/main/java/org/example/license/LicenseService.java';
const PHP_SOURCE = 'app/Services/License/LicenseService.php';
const CSHARP_SOURCE = 'src/Services/License/ILicenseProvider.cs';

const FIXTURE = {
  LICENSE: 'Synthetic license text.\n',
  'docs/legal/license': 'Synthetic license text without an extension.\n',
  [JAVA_SOURCE]: [
    'package org.example.license;',
    '',
    'public class LicenseService {',
    '    public boolean isValid(String key) {',
    '        return key != null && !key.isEmpty();',
    '    }',
    '}',
    '',
  ].join('\n'),
  'src/main/java/org/example/license/LICENSE': 'Synthetic license text inside a source package.\n',
  [PHP_SOURCE]: [
    '<?php',
    '',
    'namespace App\\Services\\License;',
    '',
    'class LicenseService',
    '{',
    '    public function isValid(string $key): bool',
    '    {',
    "        return $key !== '';",
    '    }',
    '}',
    '',
  ].join('\n'),
  [CSHARP_SOURCE]: [
    'namespace Example.Services.License',
    '{',
    '    public interface ILicenseProvider',
    '    {',
    '        bool IsValid(string key);',
    '    }',
    '}',
    '',
  ].join('\n'),
  'build/license/Gen.java': 'class Gen {}\n',
  'logs/app.log': 'synthetic log line\n',
};
const EXPECTED_SELECTED = [CSHARP_SOURCE, PHP_SOURCE, JAVA_SOURCE].sort();
const EXPECTED_DEFAULT_FILTERED = [
  'LICENSE',
  'build/license/Gen.java',
  'docs/legal/license',
  'logs/app.log',
  'src/main/java/org/example/license/LICENSE',
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

function writeFixture(root) {
  for (const [path, content] of Object.entries(FIXTURE)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function commitFixture(root) {
  writeFixture(root);
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'synthetic file-pattern directory fixture']);
}

function makeDirectoryFixture() {
  const root = makeTemp('excavator-file-pattern-dir-');
  writeFixture(root);
  return root;
}

function makeGitFixture() {
  const root = makeTemp('excavator-file-pattern-git-');
  commitFixture(root);
  return root;
}

function makeMultiRepoFixture() {
  const root = makeTemp('excavator-file-pattern-multi-');
  const member = join(root, 'member');
  mkdirSync(member);
  commitFixture(member);
  return root;
}

function stripMemberPrefix(paths) {
  return paths.map((path) => path.replace(/^member\//, '')).sort();
}

function defaultFiltered(snapshot) {
  return stripMemberPrefix(snapshot.selection.entries
    .filter((entry) => entry.kind === 'filtered-by-defaults')
    .map((entry) => entry.path));
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop(), { recursive: true, force: true });
  }
});

describe('default file patterns do not exclude directories — adapters', () => {
  it('selects the same license-directory sources and digest through Directory, Git, and MultiRepo adapters', () => {
    const directory = resolveSourceSnapshot(makeDirectoryFixture());
    const gitSnapshot = resolveSourceSnapshot(makeGitFixture());
    const multiRepo = resolveSourceSnapshot(makeMultiRepoFixture());

    expect.soft(directory.listFiles().sort()).toEqual(EXPECTED_SELECTED);
    expect.soft(gitSnapshot.listFiles().sort()).toEqual(EXPECTED_SELECTED);
    expect.soft(stripMemberPrefix(multiRepo.listFiles())).toEqual(EXPECTED_SELECTED);
    expect.soft(new Set([directory.selectionDigest, gitSnapshot.selectionDigest, multiRepo.selectionDigest]).size).toBe(1);

    // The license files themselves, and sources under a directory-pattern
    // ancestor, stay in the visible default-filtered bucket in every adapter.
    expect.soft(defaultFiltered(directory)).toEqual(EXPECTED_DEFAULT_FILTERED);
    expect.soft(defaultFiltered(gitSnapshot)).toEqual(EXPECTED_DEFAULT_FILTERED);
    expect.soft(defaultFiltered(multiRepo)).toEqual(EXPECTED_DEFAULT_FILTERED);
  });

  it('carries the selected license-directory sources into the fact graph', async () => {
    const root = makeDirectoryFixture();
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const result = await runLazyAnalysis({ projectRoot: root, now: () => '2026-10-15T00:00:00.000Z' });
    expect(result.saveError).toBeNull();

    const graph = readKnowledgeGraph(join(root, '.excavator', KNOWLEDGE_GRAPH_FILE));
    const filePaths = [...new Set(graph.nodes.map((node) => node.filePath).filter(Boolean))];
    for (const path of EXPECTED_SELECTED) expect.soft(filePaths, path).toContain(path);
    for (const path of EXPECTED_DEFAULT_FILTERED) expect.soft(filePaths, path).not.toContain(path);
    expect.soft(graph.nodes.some((node) => node.filePath === JAVA_SOURCE && node.name === 'LicenseService')).toBe(true);
  });
});
