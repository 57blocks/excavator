// O1 (application roots) of openspec change handbook-system-overview: the
// roots are the topmost directories that hold a build manifest, found with the
// walk and the skip rules of the candidate listing.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { runHandbook } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

/** A throwaway project from `{ path: text }`; returns its real path. */
function project(files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'xhb-app-')));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** The application roots the command prints, as `[dir, manifests]`. */
function roots(root) {
  const result = runHandbook(['applications', root]);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  const [header, ...rows] = result.lines;
  return { header, rows: rows.map((line) => line.split('\t')) };
}

describe('applications: the roots of a project', () => {
  it('two repositories and a nested manifest give two roots, the nested one is not a third', () => {
    const root = project({
      'repo-a/package.json': '{}\n',
      'repo-a/tools/package.json': '{}\n',
      'repo-a/src/index.js': 'x\n',
      'repo-b/go.mod': 'module b\n',
      'repo-b/main.go': 'package main\n',
    });
    const found = roots(root);
    expect(found.header).toBe('Application roots: 2');
    expect(found.rows).toEqual([['repo-a', 'package.json'], ['repo-b', 'go.mod']]);
  });

  it('a manifest in the project root makes the project root the only root', () => {
    const root = project({ 'go.mod': 'module a\n', 'cmd/tool/go.mod': 'module t\n', 'web/package.json': '{}\n' });
    const found = roots(root);
    expect(found.header).toBe('Application roots: 1');
    expect(found.rows).toEqual([['.', 'go.mod']]);
  });

  it('lists every manifest kind of a root, in name order', () => {
    const root = project({ 'svc/pom.xml': '<p/>\n', 'svc/build.gradle': '', 'svc/App.csproj': '<p/>\n', 'svc/App.sln': '' });
    expect(roots(root).rows).toEqual([['svc', 'App.csproj, App.sln, build.gradle, pom.xml']]);
  });

  it('skips the directories the candidate listing skips and does not follow links', () => {
    const root = project({
      'app/package.json': '{}\n',
      'node_modules/dep/package.json': '{}\n',
      'vendor/lib/go.mod': 'module v\n',
      'dist/package.json': '{}\n',
      'build/pom.xml': '<p/>\n',
      '.git/package.json': '{}\n',
      'other/requirements.txt': 'flask\n',
    });
    symlinkSync(join(root, 'other'), join(root, 'linked'));
    expect(roots(root).rows.map((row) => row[0])).toEqual(['app', 'other']);
  });

  it('says so with a count of zero and no row when no directory holds a manifest', () => {
    const root = project({ 'src/a.js': 'x\n' });
    expect(roots(root)).toEqual({ header: 'Application roots: 0', rows: [] });
  });

  it('prints the same bytes on a second run and never the project path', () => {
    const root = project({ 'a/package.json': '{}\n', 'b/Gemfile': '' });
    const first = runHandbook(['applications', root]);
    expect(runHandbook(['applications', root]).stdout).toBe(first.stdout);
    expect(first.stdout).not.toContain(root);
  });

  it('exits 2 for a project that does not exist', () => {
    expect(runHandbook(['applications', '/nonexistent-xhb-project']).status).toBe(2);
  });
});
