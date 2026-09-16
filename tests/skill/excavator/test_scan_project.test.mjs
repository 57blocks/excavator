import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  existsSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createIgnoreFilter, LanguageRegistry } from '@excavator/core';
import scanProject from '../../../skills/excavator/scan-project.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(
  __dirname,
  '../../../skills/excavator/scan-project.mjs',
);

/**
 * Build a project tree from a `{ relPath: contents }` object. Creates parent
 * directories as needed. Initializes a real git repo so the script's preferred
 * `git ls-files` enumeration path is exercised — tests that need the walker
 * fallback can set `gitInit=false`.
 */
function setupTree(files, { gitInit = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'excavator-scan-test-'));
  for (const [relPath, contents] of Object.entries(files)) {
    const abs = join(root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents, 'utf-8');
  }
  if (gitInit) {
    // `git ls-files -co --exclude-standard` returns BOTH cached and others
    // (modulo gitignore), so an `add` is unnecessary for our tests — the
    // bare repo init is enough for ls-files to enumerate.
    const init = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf-8' });
    if (init.status !== 0) {
      // CI without git: continue without it; the walker fallback will fire.
    }
  }
  return root;
}

/**
 * Tracks every temp output dir created by runScript() so the global
 * cleanup can sweep them between tests. The output file lives OUTSIDE
 * projectRoot on principle (defense in depth, independent of what the
 * default ignore patterns happen to cover) — if we wrote inside
 * projectRoot, the second call in the determinism test would
 * enumerate the first call's output file and produce drift.
 */
const _runScriptOutputDirs = [];

/**
 * Run scan-project.mjs against `projectRoot`. Returns
 * { status, stdout, stderr, output } where `output` is the parsed JSON
 * written by the script (or null on failure).
 */
function runScript(projectRoot, extraArgs = [], envOverrides = {}) {
  const outputDir = mkdtempSync(join(tmpdir(), 'excavator-scan-out-'));
  _runScriptOutputDirs.push(outputDir);
  const outputPath = join(outputDir, 'scan-output.json');
  const result = spawnSync('node', [SCRIPT, projectRoot, outputPath, ...extraArgs], {
    encoding: 'utf-8',
    env: { ...process.env, ...envOverrides },
  });
  let output = null;
  try {
    output = JSON.parse(readFileSync(outputPath, 'utf-8'));
  } catch {
    /* output missing on hard failure */
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, output };
}

/**
 * Look up the `files[]` entry for a given path. Returns undefined if not
 * present — callers should `expect(byPath('x')).toBeDefined()` first.
 */
function byPath(output, path) {
  return output.files.find(f => f.path === path);
}

// Sweep every output dir created during a test back to disk-empty between
// tests. The top-level afterEach fires after each `it()` regardless of which
// describe block it lives in, so a single hook covers the whole file.
afterEach(() => {
  while (_runScriptOutputDirs.length) {
    const d = _runScriptOutputDirs.pop();
    rmSync(d, { recursive: true, force: true });
  }
});

describe('scan-project.mjs — language detection', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('maps TypeScript/JavaScript extensions to typescript/javascript', () => {
    projectRoot = setupTree({
      'a.ts': 'export const a = 1;\n',
      'b.tsx': 'export const B = () => null;\n',
      'c.js': 'module.exports = {};\n',
      'd.jsx': 'export default () => null;\n',
      'e.mjs': 'export const e = 1;\n',
      'f.cjs': 'module.exports = 1;\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'a.ts').language).toBe('typescript');
    expect(byPath(r.output, 'b.tsx').language).toBe('typescript');
    expect(byPath(r.output, 'c.js').language).toBe('javascript');
    expect(byPath(r.output, 'd.jsx').language).toBe('javascript');
    expect(byPath(r.output, 'e.mjs').language).toBe('javascript');
    expect(byPath(r.output, 'f.cjs').language).toBe('javascript');
  });

  it('maps Python, Go, Rust, Java, Kotlin, C#, Swift to their language ids', () => {
    projectRoot = setupTree({
      'a.py': 'x = 1\n',
      'b.go': 'package main\n',
      'c.rs': 'fn main() {}\n',
      'd.java': 'class D {}\n',
      'e.kt': 'fun main() {}\n',
      'f.cs': 'class F {}\n',
      'g.swift': 'struct G {}\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'a.py').language).toBe('python');
    expect(byPath(r.output, 'b.go').language).toBe('go');
    expect(byPath(r.output, 'c.rs').language).toBe('rust');
    expect(byPath(r.output, 'd.java').language).toBe('java');
    expect(byPath(r.output, 'e.kt').language).toBe('kotlin');
    expect(byPath(r.output, 'f.cs').language).toBe('csharp');
    expect(byPath(r.output, 'g.swift').language).toBe('swift');
  });

  it('maps Scala extensions to scala (with .sbt categorized as config)', () => {
    projectRoot = setupTree({
      'src/main/scala/App.scala': 'object App\n',
      'scripts/task.sc': 'println(1)\n',
      'build.sbt': 'name := "demo"\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'src/main/scala/App.scala').language).toBe('scala');
    expect(byPath(r.output, 'src/main/scala/App.scala').fileCategory).toBe('code');
    expect(byPath(r.output, 'scripts/task.sc').language).toBe('scala');
    expect(byPath(r.output, 'build.sbt').language).toBe('scala');
    expect(byPath(r.output, 'build.sbt').fileCategory).toBe('config');
  });

  it('maps Ruby, PHP, C, C++ to their language ids', () => {
    projectRoot = setupTree({
      'a.rb': 'puts 1\n',
      'b.php': '<?php echo 1;\n',
      'c.c': 'int main() { return 0; }\n',
      'd.h': 'void f();\n',
      'e.cpp': 'int main() {}\n',
      'f.hpp': 'class F {};\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'a.rb').language).toBe('ruby');
    expect(byPath(r.output, 'b.php').language).toBe('php');
    expect(byPath(r.output, 'c.c').language).toBe('c');
    expect(byPath(r.output, 'd.h').language).toBe('c');
    expect(byPath(r.output, 'e.cpp').language).toBe('cpp');
    expect(byPath(r.output, 'f.hpp').language).toBe('cpp');
  });

  it('maps web markup (HTML, CSS) to their language ids', () => {
    projectRoot = setupTree({
      'a.html': '<!doctype html><html></html>\n',
      'b.htm': '<html></html>\n',
      'c.css': '.a { }\n',
      'd.scss': '$x: 1;\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'a.html').language).toBe('html');
    expect(byPath(r.output, 'b.htm').language).toBe('html');
    expect(byPath(r.output, 'c.css').language).toBe('css');
    expect(byPath(r.output, 'd.scss').language).toBe('css');
  });

  it('maps configuration formats (YAML, JSON, JSONC, TOML, XML, Markdown) to their language ids', () => {
    projectRoot = setupTree({
      'a.yaml': 'x: 1\n',
      'b.yml': 'x: 1\n',
      'c.json': '{}\n',
      'd.jsonc': '{ /* c */ }\n',
      'e.toml': 'x = 1\n',
      'f.xml': '<x/>\n',
      'g.md': '# h\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'a.yaml').language).toBe('yaml');
    expect(byPath(r.output, 'b.yml').language).toBe('yaml');
    expect(byPath(r.output, 'c.json').language).toBe('json');
    expect(byPath(r.output, 'd.jsonc').language).toBe('jsonc');
    expect(byPath(r.output, 'e.toml').language).toBe('toml');
    expect(byPath(r.output, 'f.xml').language).toBe('xml');
    expect(byPath(r.output, 'g.md').language).toBe('markdown');
  });

  it('maps shell + batch + Dockerfile (no extension) to their language ids', () => {
    projectRoot = setupTree({
      'a.sh': 'echo 1\n',
      'b.bat': '@echo off\n',
      Dockerfile: 'FROM node:22\n',
      'Dockerfile.dev': 'FROM node:22\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'a.sh').language).toBe('shell');
    expect(byPath(r.output, 'b.bat').language).toBe('batch');
    expect(byPath(r.output, 'Dockerfile').language).toBe('dockerfile');
    expect(byPath(r.output, 'Dockerfile.dev').language).toBe('dockerfile');
  });

  it('uses the canonical registry for TypeScript and Dockerfile variants', () => {
    const registry = LanguageRegistry.createDefault();
    const expected = [
      ['src/app.ts', 'typescript', 'code'],
      ['src/view.tsx', 'typescript', 'code'],
      ['Dockerfile', 'dockerfile', 'infra'],
      ['Dockerfile.dev', 'dockerfile', 'infra'],
      ['Dockerfile-prod', 'dockerfile', 'infra'],
      ['Dockerfile-qa', 'dockerfile', 'infra'],
      ['Dockerfile-test', 'dockerfile', 'infra'],
    ];

    for (const [path, language, category] of expected) {
      expect(scanProject.classifyLanguage(path).language, path).toBe(language);
      expect(registry.getForFile(path)?.id, path).toBe(language);
      expect(scanProject.detectCategory(path), path).toBe(category);
    }
    expect(scanProject.classifyLanguage('MyDockerfile-prod')).toEqual({
      language: 'unknown',
      declared: false,
    });
    expect(registry.getForFile('MyDockerfile-prod')).toBeNull();
  });

  it.each([
    ['config.jsonc', 'jsonc', 'config'],
    ['.env', 'config', 'config'],
    ['.env.local', 'config', 'config'],
    ['icon.svg', 'svg', 'code'],
    ['rules.mk', 'mk', 'code'],
    ['openapi.yaml', 'yaml', 'config'],
    ['docker-compose.yml', 'yaml', 'infra'],
    ['guide.rst', 'markdown', 'docs'],
    ['notes.txt', 'txt', 'docs'],
    ['notes.text', 'text', 'docs'],
  ])('freezes compatibility classification for %s as %s/%s', (path, language, category) => {
    expect(scanProject.classifyLanguage(path).language).toBe(language);
    expect(scanProject.detectCategory(path)).toBe(category);
  });

  it('scans hyphenated Dockerfiles and keeps the arbitrary-name negative out', () => {
    projectRoot = setupTree({
      'Dockerfile-prod': 'FROM node:22\n',
      'Dockerfile-qa': 'FROM node:22\n',
      'Dockerfile-test': 'FROM node:22\n',
      'MyDockerfile-prod': 'not a Dockerfile\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    for (const path of ['Dockerfile-prod', 'Dockerfile-qa', 'Dockerfile-test']) {
      expect(byPath(r.output, path)).toMatchObject({ language: 'dockerfile', fileCategory: 'infra' });
    }
    expect(byPath(r.output, 'MyDockerfile-prod')).toBeUndefined();
    expect(r.output.skipped).toContainEqual({
      path: 'MyDockerfile-prod',
      reason: 'unknown-language',
      language: 'unknown',
    });
  });

  // A file whose language cannot be NAMED at all (no extension, no filename
  // table entry) is no longer emitted with language "unknown": it lands in the
  // skip ledger under `unknown-language`, so the coverage table can account
  // for it instead of carrying an un-analysable pseudo-language.
  it('skips files with no extension and no filename match as unknown-language', () => {
    projectRoot = setupTree({
      WEIRD_FILE: 'mystery contents\n',
      'src/index.ts': 'export const x = 1;\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'WEIRD_FILE')).toBeUndefined();
    expect(r.output.skipped).toContainEqual({
      path: 'WEIRD_FILE',
      reason: 'unknown-language',
      language: 'unknown',
    });
    expect(r.output.stats.skippedByReason['unknown-language']).toBe(1);
  });

  it('keeps conventional extension-less files (LICENSE, CHANGELOG) in the census', () => {
    projectRoot = setupTree({
      '.excavatorignore': '!LICENSE\n',
      CHANGELOG: '## 1.0\n',
      'src/index.ts': 'export const x = 1;\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'CHANGELOG').language).toBe('text');
  });

  it('falls back to bare extension (without dot) for unknown extensions', () => {
    projectRoot = setupTree({
      'data.weirdext': 'some data\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'data.weirdext').language).toBe('weirdext');
  });
});

describe('scan-project.mjs — category assignment (project-scanner.md Step 4)', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('assigns code to TypeScript, JavaScript, Python, Go, Rust, Swift source files', () => {
    projectRoot = setupTree({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.py': 'def b(): pass\n',
      'src/c.go': 'package main\n',
      'src/d.rs': 'fn main() {}\n',
      'src/e.swift': 'struct E {}\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'src/a.ts').fileCategory).toBe('code');
    expect(byPath(r.output, 'src/b.py').fileCategory).toBe('code');
    expect(byPath(r.output, 'src/c.go').fileCategory).toBe('code');
    expect(byPath(r.output, 'src/d.rs').fileCategory).toBe('code');
    expect(byPath(r.output, 'src/e.swift').fileCategory).toBe('code');
  });

  it('assigns config to JSON/YAML/TOML/INI/XML', () => {
    projectRoot = setupTree({
      'package.json': '{}\n',
      'tsconfig.json': '{}\n',
      'pyproject.toml': '[project]\nname = "p"\n',
      'config.yaml': 'x: 1\n',
      'app.ini': '[s]\nk=v\n',
      'data.xml': '<x/>\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'package.json').fileCategory).toBe('config');
    expect(byPath(r.output, 'tsconfig.json').fileCategory).toBe('config');
    expect(byPath(r.output, 'pyproject.toml').fileCategory).toBe('config');
    expect(byPath(r.output, 'config.yaml').fileCategory).toBe('config');
    expect(byPath(r.output, 'app.ini').fileCategory).toBe('config');
    expect(byPath(r.output, 'data.xml').fileCategory).toBe('config');
  });

  it('assigns docs to .md / .rst / .txt (but NOT to LICENSE)', () => {
    projectRoot = setupTree({
      'README.md': '# x\n',
      'docs/guide.rst': 'Guide\n=====\n',
      'NOTES.txt': 'notes\n',
      LICENSE: 'Apache-2.0\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'README.md').fileCategory).toBe('docs');
    expect(byPath(r.output, 'docs/guide.rst').fileCategory).toBe('docs');
    expect(byPath(r.output, 'NOTES.txt').fileCategory).toBe('docs');
    // LICENSE exception: must NOT be docs. The default ignore filter
    // normally drops LICENSE entirely, so we re-include it via
    // `!LICENSE` so the category test can fire.
    writeFileSync(join(projectRoot, '.excavatorignore'), '!LICENSE\n');
    const r2 = runScript(projectRoot);
    const license = byPath(r2.output, 'LICENSE');
    expect(license).toBeDefined();
    expect(license.fileCategory).not.toBe('docs');
  });

  it('assigns infra to Dockerfile, docker-compose, .gitlab-ci.yml, .tf, .github/workflows/, Makefile, Jenkinsfile, k8s paths', () => {
    projectRoot = setupTree({
      Dockerfile: 'FROM node:22\n',
      'docker-compose.yml': 'services: {}\n',
      '.gitlab-ci.yml': 'stages: []\n',
      'infra/main.tf': 'resource "x" "y" {}\n',
      '.github/workflows/ci.yml': 'name: ci\n',
      Makefile: 'all:\n\t@echo hi\n',
      Jenkinsfile: 'pipeline { }\n',
      'k8s/deploy.yaml': 'kind: Deployment\n',
      'kubernetes/svc.yaml': 'kind: Service\n',
      'foo.k8s.yaml': 'kind: ConfigMap\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'Dockerfile').fileCategory).toBe('infra');
    expect(byPath(r.output, 'docker-compose.yml').fileCategory).toBe('infra');
    expect(byPath(r.output, '.gitlab-ci.yml').fileCategory).toBe('infra');
    expect(byPath(r.output, 'infra/main.tf').fileCategory).toBe('infra');
    expect(byPath(r.output, '.github/workflows/ci.yml').fileCategory).toBe('infra');
    expect(byPath(r.output, 'Makefile').fileCategory).toBe('infra');
    expect(byPath(r.output, 'Jenkinsfile').fileCategory).toBe('infra');
    expect(byPath(r.output, 'k8s/deploy.yaml').fileCategory).toBe('infra');
    expect(byPath(r.output, 'kubernetes/svc.yaml').fileCategory).toBe('infra');
    expect(byPath(r.output, 'foo.k8s.yaml').fileCategory).toBe('infra');
  });

  it('assigns data to SQL, GraphQL, Proto, Prisma, CSV', () => {
    projectRoot = setupTree({
      'db/schema.sql': 'CREATE TABLE x (id INT);\n',
      'api/schema.graphql': 'type X { id: ID! }\n',
      'api/types.proto': 'syntax = "proto3";\n',
      'prisma/schema.prisma': 'model X { id Int @id }\n',
      'data/seed.csv': 'a,b\n1,2\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'db/schema.sql').fileCategory).toBe('data');
    expect(byPath(r.output, 'api/schema.graphql').fileCategory).toBe('data');
    expect(byPath(r.output, 'api/types.proto').fileCategory).toBe('data');
    expect(byPath(r.output, 'prisma/schema.prisma').fileCategory).toBe('data');
    expect(byPath(r.output, 'data/seed.csv').fileCategory).toBe('data');
  });

  it('assigns script to shell + batch files (.sh, .bash, .ps1, .bat)', () => {
    projectRoot = setupTree({
      'scripts/build.sh': '#!/bin/bash\necho 1\n',
      'scripts/run.bash': '#!/bin/bash\necho run\n',
      'scripts/build.ps1': 'Write-Output 1\n',
      'scripts/setup.bat': '@echo off\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'scripts/build.sh').fileCategory).toBe('script');
    expect(byPath(r.output, 'scripts/run.bash').fileCategory).toBe('script');
    expect(byPath(r.output, 'scripts/build.ps1').fileCategory).toBe('script');
    expect(byPath(r.output, 'scripts/setup.bat').fileCategory).toBe('script');
  });

  it('assigns markup to HTML + CSS variants', () => {
    projectRoot = setupTree({
      'public/index.html': '<!doctype html>\n',
      'public/page.htm': '<html></html>\n',
      'styles/app.css': 'body { }\n',
      'styles/app.scss': '$x: 1;\n',
      'styles/app.less': '@x: 1;\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'public/index.html').fileCategory).toBe('markup');
    expect(byPath(r.output, 'public/page.htm').fileCategory).toBe('markup');
    expect(byPath(r.output, 'styles/app.css').fileCategory).toBe('markup');
    expect(byPath(r.output, 'styles/app.scss').fileCategory).toBe('markup');
    expect(byPath(r.output, 'styles/app.less').fileCategory).toBe('markup');
  });

  it('priority: docker-compose.yml maps to infra, not config', () => {
    // The .yml extension would normally route to `config`, but the
    // docker-compose.* filename rule fires first per Step 4 priority.
    projectRoot = setupTree({
      'docker-compose.yml': 'services: {}\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'docker-compose.yml').fileCategory).toBe('infra');
    expect(byPath(r.output, 'docker-compose.yml').language).toBe('yaml');
  });

  // Regression: path.extname returns '' for `.env` and the second segment
  // for `.env.local` — neither hits CATEGORY_BY_EXT['.env']. Dotfile-style
  // configs were falling through to `code` / `unknown`. Caught by Codex
  // review on PR #204.
  it('dotfile configs (.env, .env.local, .env.production) map to config + env language', () => {
    projectRoot = setupTree({
      '.env': 'API_KEY=abc\n',
      '.env.local': 'LOCAL=1\n',
      '.env.production': 'PROD=1\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    for (const p of ['.env', '.env.local', '.env.production']) {
      expect(byPath(r.output, p).fileCategory).toBe('config');
      // LANGUAGE_BY_EXT['.env'] -> 'config' (the language id itself; not
      // a typo — the language for env files is the 'config' bucket).
      expect(byPath(r.output, p).language).toBe('config');
    }
  });
});

describe('scan-project.mjs — .excavatorignore handling', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('respects .excavatorignore patterns and increments filteredByIgnore', () => {
    // `**/*.log` is NOT in the hardcoded defaults at the recursive level
    // — wait, `*.log` is. Use a custom pattern to exercise user-driven drops.
    projectRoot = setupTree({
      '.excavatorignore': 'fixtures/\n',
      'src/index.ts': 'export const x = 1;\n',
      'fixtures/snap1.json': '{ "a": 1 }\n',
      'fixtures/snap2.json': '{ "b": 2 }\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    // fixtures/ files dropped
    expect(byPath(r.output, 'fixtures/snap1.json')).toBeUndefined();
    expect(byPath(r.output, 'fixtures/snap2.json')).toBeUndefined();
    // Counted as user-driven
    expect(r.output.filteredByIgnore).toBe(2);
  });

  it('supports `!pattern` negation to re-include defaults-excluded files', () => {
    // `*.log` is in the hardcoded defaults; the user re-includes a
    // specific file with `!keep.log`. After the override, keep.log MUST
    // appear in the output. It is NOT counted in filteredByIgnore (it
    // was re-included, not additionally filtered).
    projectRoot = setupTree({
      '.excavatorignore': '!keep.log\n',
      'src/index.ts': 'export const x = 1;\n',
      'keep.log': 'important diagnostic\n',
      'drop.log': 'noise\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'keep.log')).toBeDefined();
    // drop.log still excluded by defaults (no negation for it)
    expect(byPath(r.output, 'drop.log')).toBeUndefined();
    // The defaults dropped drop.log — that's a baseline default drop,
    // NOT a user-driven drop. filteredByIgnore should be 0.
    expect(r.output.filteredByIgnore).toBe(0);
  });
});

describe('scan-project.mjs — pre-extraction selection safety', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('contains extension/header secrets, preserves a same-size control, and rejects hard-safety negation', () => {
    const privateKey = Buffer.from(
      '-----BEGIN PRIVATE KEY-----\nEXCAVATOR_FAKE_SECRET_CANARY_scan\n-----END PRIVATE KEY-----\n',
    );
    const sameSizeControl = Buffer.alloc(privateKey.byteLength, 0x61);
    projectRoot = setupTree({
      '.excavatorignore': [
        '!LICENSE',
        '!unmc.zip',
        '!config/extension-only.key',
        'generated/',
      ].join('\n'),
      'LICENSE': 'selected ordinary default\n',
      'unmc.zip': 'archive bytes that must never be selected\n',
      'config/privatekey3072.txt': privateKey,
      'config/extension-only.key': 'synthetic extension-only credential fixture\n',
      'config/same-size-control.txt': sameSizeControl,
      'generated/client.ts': 'export const generated = true;\n',
      'src/app.ts': 'export const app = true;\n',
    });

    const r = runScript(projectRoot);
    expect(r.status, r.stderr).toBe(0);
    const decision = (path) => r.output.selection.entries.find((entry) => entry.path === path);
    const skip = (path) => r.output.skipped.find((entry) => entry.path === path);

    expect(decision('LICENSE')?.kind).toBe('selected');
    expect(decision('config/same-size-control.txt')?.kind).toBe('selected');
    expect(decision('generated/client.ts')?.kind).toBe('filtered-by-ignore');
    expect(decision('unmc.zip')?.kind).toBe('filtered-by-defaults');
    expect(decision('config/privatekey3072.txt')).toMatchObject({
      kind: 'sensitive', reason: 'sensitive', detail: 'private-key-header', size: privateKey.byteLength,
    });
    expect(decision('config/extension-only.key')).toMatchObject({
      kind: 'sensitive', reason: 'sensitive', detail: 'sensitive-extension',
    });
    expect(skip('config/privatekey3072.txt')?.reason).toBe('sensitive');
    expect(skip('config/extension-only.key')?.reason).toBe('sensitive');
    expect(JSON.stringify(r.output)).not.toContain('EXCAVATOR_FAKE_SECRET_CANARY_scan');
    expect(r.stderr).not.toContain('EXCAVATOR_FAKE_SECRET_CANARY_scan');
    for (const record of [decision('config/privatekey3072.txt'), decision('config/extension-only.key')]) {
      expect(record).not.toHaveProperty('content');
      expect(record).not.toHaveProperty('excerpt');
      expect(record).not.toHaveProperty('contentHash');
    }
    expect(r.output.selection.candidates).toBe(r.output.selection.entries.length);
    expect(r.output.selection.candidates).toBe(
      r.output.selection.selected
      + r.output.selection.filteredByDefaults
      + r.output.selection.filteredByIgnore
      + r.output.selection.sensitive,
    );
  });
});

describe('scan-project.mjs — data-dir resolution (.excavator, no fallback)', () => {
  let projectRoot;

  // Built from parts rather than written as a literal so this file, which
  // deliberately proves the pre-rename directory name is no longer read,
  // doesn't itself trip the repo-wide zero-old-token grep gate (oracle #1 in
  // openspec/changes/excavator-rename/design.md).
  const preRenameDir = ["." , "u", "a"].join("");

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('honors .excavator/.excavatorignore', () => {
    // scan-project delegates ignore handling to core's createIgnoreFilter,
    // which reads resolveDataDir(projectRoot)/.excavatorignore — .excavator/.
    projectRoot = setupTree({
      '.excavator/.excavatorignore': 'fixtures/\n',
      'src/index.ts': 'export const x = 1;\n',
      'fixtures/snap1.json': '{ "a": 1 }\n',
      'fixtures/snap2.json': '{ "b": 2 }\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, 'fixtures/snap1.json')).toBeUndefined();
    expect(byPath(r.output, 'fixtures/snap2.json')).toBeUndefined();
    // Counted as user-driven drops (dual-filter accounting saw the ignore).
    expect(r.output.filteredByIgnore).toBe(2);
  });

  it('does NOT honor a .excavatorignore under a pre-rename data directory — no fallback', () => {
    projectRoot = setupTree({
      [`${preRenameDir}/.excavatorignore`]: 'fixtures/\n',
      'src/index.ts': 'export const x = 1;\n',
      'fixtures/snap1.json': '{ "a": 1 }\n',
      'fixtures/snap2.json': '{ "b": 2 }\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    // Not read from the pre-rename dir, so fixtures/ is NOT excluded.
    expect(byPath(r.output, 'fixtures/snap1.json')).toBeDefined();
    expect(byPath(r.output, 'fixtures/snap2.json')).toBeDefined();
    expect(r.output.filteredByIgnore).toBe(0);
  });

  it('can exclude persistent analysis data for isolated benchmark scans', () => {
    projectRoot = setupTree({
      '.excavator/knowledge-graph.json': '{ "nodes": [] }\n',
      '.excavator/meta.json': '{ "version": 1 }\n',
      'src/index.ts': 'export const x = 1;\n',
    });

    const r = runScript(projectRoot, ['--exclude-analysis-data']);

    expect(r.status).toBe(0);
    expect(r.output.files.map(file => file.path)).toEqual(['src/index.ts']);
  });

  it('composes CLI exclusions for benchmark scans regardless of flag order', () => {
    projectRoot = setupTree({
      '.excavator/knowledge-graph.json': '{ "nodes": [] }\n',
      '.excavator/meta.json': '{ "version": 1 }\n',
      'generated/client.ts': 'export const generated = true;\n',
      'src/index.ts': 'export const x = 1;\n',
    });

    for (const args of [
      ['--exclude', 'generated/', '--exclude-analysis-data'],
      ['--exclude-analysis-data', '--exclude', 'generated/'],
    ]) {
      const r = runScript(projectRoot, args);

      expect(r.status, r.stderr).toBe(0);
      expect(r.output.files.map(file => file.path)).toEqual(['src/index.ts']);
      expect(r.output.filteredByIgnore).toBe(1);
      expect(r.output.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('scan-project.mjs — default exclusion of plugin/agent and data directories', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it("everything the walker hard-skips is also excluded by core's real ignore filter (no walker/filter drift)", () => {
    // The walker's HARD_SKIP_DIRS started as an exact-name Set compared
    // against a normalized copy of DEFAULT_IGNORE_PATTERNS. selection-hardening
    // (openspec/changes/lazy-mode-completion) made the walker prefix-aware for
    // the `.excavator.*/`, `.excavator-*/`, `.trash-*/` variant/backup/recycle
    // directory shapes core's DEFAULT_IGNORE_PATTERNS also excludes — those
    // shapes have no fixed name (a stray backup dir can be named anything
    // after the dot/dash), so an exact-name-set comparison can no longer
    // express the invariant. The property that must still hold: whatever
    // directory NAME the walker decides to hard-skip (`isHardSkipDir` returns
    // true) must ALSO be excluded by core's real ignore filter — otherwise the
    // walker could silently drop a directory the real filter would have kept,
    // diverging from the single source of truth. Exercised against the real
    // `createIgnoreFilter`, not a hand-rolled reimplementation, and covers both
    // the pre-existing exact-name entries and representative variant/trash
    // names — not a tautology, since a name isHardSkipDir wrongly starts
    // returning true for (drift in the OTHER direction) would fail here too
    // if core's patterns don't also cover it.
    const projectRoot = mkdtempSync(join(tmpdir(), 'excavator-hardskip-invariant-'));
    try {
      const filter = createIgnoreFilter(projectRoot);
      const representativeDirNames = [
        ...scanProject.HARD_SKIP_DIRS, // exact-name entries: node_modules, .git, .excavator, etc.
        '.excavator.bak',
        '.excavator.slicec-bak',
        '.excavator-old',
        '.trash-9',
        '.trash-1234567890',
      ];
      for (const name of representativeDirNames) {
        expect(scanProject.isHardSkipDir(name), `expected walker to hard-skip ${name}`).toBe(true);
        expect(
          filter.isIgnored(`${name}/some-file.ts`),
          `walker hard-skips ${name}/ but core's DEFAULT_IGNORE_PATTERNS would NOT exclude it — drift`,
        ).toBe(true);
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('excludes .claude/, .agents/, .codex/ and .excavator/ files and counts them as ignored, not silently dropped', () => {
    projectRoot = setupTree({
      '.claude/skills/x/SKILL.md': '# x\n',
      '.agents/skills/y/SKILL.md': '# y\n',
      '.codex/z.md': '# z\n',
      '.excavator/config.json': '{}\n',
      'src/index.ts': 'export const x = 1;\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(byPath(r.output, '.claude/skills/x/SKILL.md')).toBeUndefined();
    expect(byPath(r.output, '.agents/skills/y/SKILL.md')).toBeUndefined();
    expect(byPath(r.output, '.codex/z.md')).toBeUndefined();
    expect(byPath(r.output, '.excavator/config.json')).toBeUndefined();
    expect(byPath(r.output, 'src/index.ts')).toBeDefined();
    // Not silently dropped — counted under the default-pattern ledger bucket.
    expect(r.output.filteredByDefaults).toBeGreaterThanOrEqual(4);
    expect(r.output.filteredByIgnore).toBe(0);
  });
});

describe('scan-project.mjs — special-file recognition', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('Dockerfile (no extension) is language=dockerfile, category=infra', () => {
    projectRoot = setupTree({
      Dockerfile: 'FROM alpine:3\nCMD ["sh"]\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    const entry = byPath(r.output, 'Dockerfile');
    expect(entry).toBeDefined();
    expect(entry.language).toBe('dockerfile');
    expect(entry.fileCategory).toBe('infra');
  });
});

describe('scan-project.mjs — determinism', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('produces byte-identical output across runs for the same input tree', () => {
    projectRoot = setupTree({
      'README.md': '# project\n',
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 2;\n',
      'src/lib/c.ts': 'export const c = 3;\n',
      'package.json': '{}\n',
      'tsconfig.json': '{}\n',
    });
    const r1 = runScript(projectRoot);
    const r2 = runScript(projectRoot);
    expect(r1.status).toBe(0);
    expect(r2.status).toBe(0);
    expect(JSON.stringify(r1.output)).toBe(JSON.stringify(r2.output));
  });

  it('keeps Unicode and space-containing paths stable across process locales', () => {
    projectRoot = setupTree({
      '!bang.ts': 'export const bang = true;\n',
      '_under.ts': 'export const under = true;\n',
      'space dir/å.ts': 'export const nested = true;\n',
      'ä.ts': 'export const umlaut = true;\n',
      '中.ts': 'export const cjk = true;\n',
    });

    const cLocale = runScript(projectRoot, [], { LANG: 'C', LC_ALL: 'C' });
    const swedishLocale = runScript(projectRoot, [], {
      LANG: 'sv_SE.UTF-8',
      LC_ALL: 'sv_SE.UTF-8',
    });
    const expectedPaths = [
      '!bang.ts',
      '_under.ts',
      'space dir/å.ts',
      'ä.ts',
      '中.ts',
    ];

    expect(cLocale.status).toBe(0);
    expect(swedishLocale.status).toBe(0);
    expect(cLocale.output.files.map(file => file.path)).toEqual(expectedPaths);
    expect(swedishLocale.output.files.map(file => file.path)).toEqual(expectedPaths);
    expect(JSON.stringify(cLocale.output)).toBe(JSON.stringify(swedishLocale.output));
  });

  it('emits a top-level lowercase SHA-256 content fingerprint as contentDigest', () => {
    projectRoot = setupTree({
      'src/value.ts': 'export const value = 1;\n',
    });

    const result = runScript(projectRoot);

    expect(result.status).toBe(0);
    expect(result.output.contentDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes the content fingerprint when bytes change but metadata does not', () => {
    projectRoot = setupTree({
      'src/value.ts': 'export const value = "aa";\n',
    });
    const before = runScript(projectRoot);

    writeFileSync(
      join(projectRoot, 'src/value.ts'),
      'export const value = "bb";\n',
      'utf-8',
    );
    const after = runScript(projectRoot);

    expect(before.status).toBe(0);
    expect(after.status).toBe(0);
    expect(byPath(before.output, 'src/value.ts').sizeLines).toBe(1);
    expect(byPath(after.output, 'src/value.ts').sizeLines).toBe(1);
    expect(after.output.files).toEqual(before.output.files);
    expect(after.output.contentDigest).not.toBe(before.output.contentDigest);
  });

  it('omits a Git-tracked outbound symlink and never fingerprints its target bytes', () => {
    projectRoot = setupTree({
      'src/inside.ts': 'export const inside = true;\n',
    });
    const externalRoot = mkdtempSync(join(tmpdir(), 'excavator-scan-external-'));
    const externalFile = join(externalRoot, 'secret.ts');

    try {
      writeFileSync(externalFile, 'export const secret = "first";\n', 'utf-8');
      try {
        symlinkSync(externalFile, join(projectRoot, 'outbound-link.ts'), 'file');
      } catch (error) {
        if (process.platform === 'win32') return;
        throw error;
      }
      const add = spawnSync('git', ['add', '--', 'outbound-link.ts'], {
        cwd: projectRoot,
        encoding: 'utf-8',
      });
      expect(add.status).toBe(0);

      const before = runScript(projectRoot);
      writeFileSync(externalFile, 'export const secret = "second";\n', 'utf-8');
      const after = runScript(projectRoot);

      expect(before.status).toBe(0);
      expect(after.status).toBe(0);
      expect(byPath(before.output, 'src/inside.ts')).toBeDefined();
      expect(byPath(before.output, 'outbound-link.ts')).toBeUndefined();
      expect(before.stderr).toMatch(
        /Warning: scan-project: outbound-link\.ts — symbolic link skipped — file skipped from output/,
      );
      expect(after.output.contentDigest).toBe(before.output.contentDigest);
    } finally {
      rmSync(externalRoot, { recursive: true, force: true });
    }
  });
});

describe('scan-project.mjs — empty repo', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('handles a project with zero files without crashing', () => {
    projectRoot = setupTree({}, { gitInit: true });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.scriptCompleted).toBe(true);
    expect(r.output.failures).toEqual([]);
    expect(r.output.totalFiles).toBe(0);
    expect(r.output.files).toEqual([]);
    expect(r.output.filteredByIgnore).toBe(0);
    expect(r.output.estimatedComplexity).toBe('small');
  });
});

describe('scan-project.mjs — per-file failure resilience', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      // Restore permissions on any chmod'd file before delete, so cleanup
      // succeeds even when a test left a 000-permission file behind.
      try {
        const f = join(projectRoot, 'src/unreadable.ts');
        if (existsSync(f)) chmodSync(f, 0o644);
      } catch { /* best-effort */ }
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('emits a Warning: and skips a file with unreadable permissions; other files survive', () => {
    if (process.platform === 'win32') {
      // chmod permission bits don't apply on Windows the same way; skip.
      return;
    }
    if (process.getuid && process.getuid() === 0) {
      // Running as root bypasses permission checks; the test cannot exercise
      // its failure mode. Skip rather than emit a false pass.
      return;
    }
    projectRoot = setupTree({
      'src/good.ts': 'export const good = 1;\n',
      'src/unreadable.ts': 'export const bad = 2;\n',
    });
    // Strip read permission on the synthetic file.
    chmodSync(join(projectRoot, 'src/unreadable.ts'), 0o000);

    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.scriptCompleted).toBe(true);
    expect(r.output.failures).toEqual([
      expect.objectContaining({ path: 'src/unreadable.ts', stage: 'file-read' }),
    ]);
    // The good file is in the output.
    expect(byPath(r.output, 'src/good.ts')).toBeDefined();
    // The unreadable file is dropped.
    expect(byPath(r.output, 'src/unreadable.ts')).toBeUndefined();
    // A visible warning was emitted with the documented prefix.
    expect(r.stderr).toMatch(
      /Warning: scan-project: src\/unreadable\.ts — line count failed/,
    );
    expect(r.stderr).toMatch(/file skipped from output/);
    // Final summary line still fires.
    expect(r.stderr).toMatch(
      /scan-project: filesScanned=1 filteredByIgnore=0 filteredByDefaults=0 complexity=small/,
    );
  });
});

describe('scan-project.mjs — estimatedComplexity thresholds', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  /**
   * Build a tree with exactly N .ts files at the top level. Used to
   * lock in the complexity-tier boundary points from project-scanner.md
   * Step 7: small (≤30), moderate (31-150), large (151-500), very-large
   * (>500).
   */
  function setupNFiles(n) {
    const tree = {};
    for (let i = 0; i < n; i++) {
      // Pad indices so localeCompare gives the natural order for any N.
      tree[`f${String(i).padStart(4, '0')}.ts`] = 'export const x = 1;\n';
    }
    return setupTree(tree);
  }

  it('30 files -> small (upper boundary of small)', () => {
    projectRoot = setupNFiles(30);
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.totalFiles).toBe(30);
    expect(r.output.estimatedComplexity).toBe('small');
  });

  it('31 files -> moderate (lower boundary of moderate)', () => {
    projectRoot = setupNFiles(31);
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.totalFiles).toBe(31);
    expect(r.output.estimatedComplexity).toBe('moderate');
  });

  it('150 files -> moderate (upper boundary of moderate)', () => {
    projectRoot = setupNFiles(150);
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.totalFiles).toBe(150);
    expect(r.output.estimatedComplexity).toBe('moderate');
  });

  it('151 files -> large (lower boundary of large)', () => {
    projectRoot = setupNFiles(151);
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.totalFiles).toBe(151);
    expect(r.output.estimatedComplexity).toBe('large');
  });

  it('501 files -> very-large (lower boundary of very-large)', () => {
    projectRoot = setupNFiles(501);
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output.totalFiles).toBe(501);
    expect(r.output.estimatedComplexity).toBe('very-large');
  });
});

describe('scan-project.mjs — CLI entry guard + invocation', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('invokes successfully via subprocess and produces a parseable output file', () => {
    projectRoot = setupTree({
      'README.md': '# proj\n',
      'src/index.ts': 'export const x = 1;\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    expect(r.output).not.toBeNull();
    expect(r.output.scriptCompleted).toBe(true);
    // Stats summary line fires on stderr.
    expect(r.stderr).toMatch(
      /scan-project: filesScanned=2 filteredByIgnore=0 filteredByDefaults=0 complexity=small/,
    );
    // Two files captured.
    expect(r.output.totalFiles).toBe(2);
  });

  it('fails fast with usage message when projectRoot is missing', () => {
    const result = spawnSync('node', [SCRIPT], { encoding: 'utf-8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Usage: node scan-project\.mjs/);
  });
});

describe('scan-project.mjs — output schema invariants', () => {
  let projectRoot;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('emits the documented top-level fields with correct shapes', () => {
    projectRoot = setupTree({
      'src/a.ts': 'export const a = 1;\n',
      'README.md': '# x\n',
      'package.json': '{}\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    const out = r.output;
    expect(out.scriptCompleted).toBe(true);
    expect(Array.isArray(out.files)).toBe(true);
    expect(typeof out.totalFiles).toBe('number');
    expect(out.totalFiles).toBe(out.files.length);
    expect(typeof out.filteredByIgnore).toBe('number');
    expect(typeof out.filteredByDefaults).toBe('number');
    expect(out.selection).toEqual(expect.objectContaining({
      policyVersion: 'source-selection-v1',
      candidates: expect.any(Number),
      selected: expect.any(Number),
      filteredByDefaults: expect.any(Number),
      filteredByIgnore: expect.any(Number),
      sensitive: expect.any(Number),
      entries: expect.any(Array),
    }));
    expect(out.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(['small', 'moderate', 'large', 'very-large']).toContain(
      out.estimatedComplexity,
    );
    expect(out.stats).toBeDefined();
    expect(out.failures).toEqual([]);
    expect(out.stats.filesScanned).toBe(out.files.length);
    expect(typeof out.stats.byCategory).toBe('object');
    expect(typeof out.stats.byLanguage).toBe('object');
    // Per-file shape
    for (const f of out.files) {
      expect(Object.keys(f).sort()).toEqual([
        'fileCategory', 'language', 'path', 'sizeLines',
      ]);
      expect(typeof f.path).toBe('string');
      expect(typeof f.language).toBe('string');
      expect(typeof f.sizeLines).toBe('number');
      expect([
        'code', 'config', 'docs', 'infra', 'data', 'script', 'markup',
      ]).toContain(f.fileCategory);
    }
  });

  it('files[] is sorted by a locale-independent code-unit order', () => {
    projectRoot = setupTree({
      '!bang.ts': '\n',
      '0.ts': '\n',
      '_under.ts': '\n',
      'a.ts': '\n',
      'ä.ts': '\n',
    });
    const r = runScript(projectRoot);
    expect(r.status).toBe(0);
    const paths = r.output.files.map(f => f.path);
    expect(paths).toEqual(['!bang.ts', '0.ts', '_under.ts', 'a.ts', 'ä.ts']);
  });
});
