/**
 * Static gate over the viewer project and the files that ship it (openspec:
 * changes/report-viewer, task 1.1; design D1, D5, O1). The viewer has no
 * dependencies and builds nothing, it only turns product strings into text,
 * and it says what the products hold without telling anyone what to do.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const viewerFiles = walk(join(repoRoot, 'viewer')).map((path) => ({ path: relative(repoRoot, path), text: readFileSync(path, 'utf-8') }));
const scripts = viewerFiles.filter((f) => f.path.endsWith('.js'));
const everyFileOfThisChange = [
  ...walk(join(repoRoot, 'viewer')),
  ...walk(join(repoRoot, 'skills/excavator-view')),
  ...walk(join(repoRoot, 'tests/skill/excavator-view')),
  join(repoRoot, 'scripts/view-smoke.mjs'),
].map((path) => ({ path: relative(repoRoot, path), text: readFileSync(path, 'utf-8') }));

const code = (...points) => String.fromCharCode(...points);
// CJK ideographs and extensions, kana, Hangul, CJK punctuation and full-width forms.
const CJK = new RegExp(`[${code(0x2e80)}-${code(0x2fdf)}${code(0x3000)}-${code(0x30ff)}${code(0x3400)}-${code(0x4dbf)}${code(0x4e00)}-${code(0x9fff)}${code(0xac00)}-${code(0xd7af)}${code(0xf900)}-${code(0xfaff)}${code(0xff00)}-${code(0xffef)}]`);

describe('viewer/ is a standalone, dependency-free project', () => {
  it('lists the files this change defines', () => {
    expect(viewerFiles.map((f) => f.path).sort()).toEqual([
      'viewer/index.html',
      'viewer/src/app.js',
      'viewer/src/code.js',
      'viewer/src/components.js',
      'viewer/src/core.js',
      'viewer/src/data.js',
      'viewer/src/docmap.js',
      'viewer/src/hotspots.js',
      'viewer/src/overview.js',
      'viewer/src/router.js',
      'viewer/src/unused.js',
      'viewer/styles.css',
    ]);
  });

  it('has no package.json, lockfile or build configuration', () => {
    for (const name of ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'tsconfig.json', 'vite.config.js', 'webpack.config.js', 'node_modules']) {
      expect(existsSync(join(repoRoot, 'viewer', name)), name).toBe(false);
    }
  });

  it('loads every script it ships from index.html, in a plain script tag', () => {
    const html = viewerFiles.find((f) => f.path === 'viewer/index.html').text;
    const listed = [...html.matchAll(/<script src="(src\/[a-z]+\.js)"><\/script>/g)].map((m) => `viewer/${m[1]}`).sort();
    expect(listed).toEqual(scripts.map((f) => f.path).sort());
    expect(html).not.toMatch(/type="module"/);
  });

  it.each(scripts.map((f) => [f.path, f.text]))('%s has no import, export or require', (_path, text) => {
    expect(text).not.toMatch(/^\s*(import|export)\b/m);
    expect(text).not.toMatch(/\bimport\s*\(/);
    expect(text).not.toMatch(/\brequire\s*\(/);
  });

  it.each(scripts.map((f) => [f.path, f.text]))('%s is one IIFE on window.XV', (_path, text) => {
    expect(text).toMatch(/\(function \(\) \{\s*'use strict';/);
    expect(text).toMatch(/window\.XV = window\.XV \|\| \{\}/);
  });

  it.each(viewerFiles.map((f) => [f.path, f.text]))('%s names no external address', (_path, text) => {
    expect(text).not.toMatch(/https?:/i);
    expect(text).not.toContain('//cdn');
    expect(text).not.toMatch(/url\(\s*['"]?(?!data:)/i);
    expect(text).not.toMatch(/@import|@font-face/i);
  });

  it('declares one light colour scheme and no dark branch', () => {
    const html = viewerFiles.find((f) => f.path === 'viewer/index.html').text;
    const css = viewerFiles.find((f) => f.path === 'viewer/styles.css').text;
    expect(html).toContain('<meta name="color-scheme" content="light">');
    expect(css).not.toMatch(/prefers-color-scheme/);
    expect(css).toContain('color-scheme: light');
    expect(css).not.toMatch(/color-scheme:\s*(dark|light dark)/);
  });

  it('defines the design tokens', () => {
    const css = viewerFiles.find((f) => f.path === 'viewer/styles.css').text;
    const tokens = {
      '--paper': '#EDEDEF', '--paper-2': '#E2E2E6', '--surface': '#FFFFFF', '--ink': '#0C0C0E', '--ink-soft': '#26262B',
      '--muted': '#6C6C73', '--line': 'rgba(12, 12, 18, .07)', '--line-2': 'rgba(12, 12, 18, .22)', '--accent': '#6A4DFF',
      '--violet': '#7C5CFF', '--cyan': '#46C7FF', '--success': 'rgb(46, 160, 105)', '--warning': '#ffc107', '--danger': '#dc3545',
    };
    const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)[1];
    for (const [name, value] of Object.entries(tokens)) {
      expect(root, name).toContain(`${name}: ${value};`);
    }
  });
});

describe('the viewer only inserts text', () => {
  const forbidden = [
    ['innerHTML', /innerHTML/],
    ['outerHTML', /outerHTML/],
    ['insertAdjacentHTML', /insertAdjacentHTML/],
    ['document.write', /document\s*\.\s*write/],
    ['eval(', /\beval\s*\(/],
    ['new Function', /new\s+Function\b/],
    ['setTimeout or setInterval with a string', /\bset(Timeout|Interval)\s*\(\s*['"`]/],
    ['an inline event attribute', /\son[a-z]+\s*=/i],
    ['a javascript: address', /javascript:/i],
    ['DOMParser or createContextualFragment', /DOMParser|createContextualFragment/],
    ['importScripts or a Worker from a URL', /importScripts|new\s+Worker\s*\(\s*['"]/],
    ['fetch, XMLHttpRequest, WebSocket or EventSource', /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/],
    ['localStorage or cookies', /localStorage|sessionStorage|document\.cookie/],
  ];
  it.each(forbidden)('has no %s', (_name, pattern) => {
    for (const file of viewerFiles) expect(file.text, file.path).not.toMatch(pattern);
  });

  it('keeps every closing script or style tag out of the files that are inlined', () => {
    for (const file of viewerFiles.filter((f) => f.path !== 'viewer/index.html')) {
      expect(file.text.toLowerCase(), file.path).not.toMatch(/<\/(script|style)/);
      expect(file.text, file.path).not.toContain('<!--');
    }
  });
});

describe('the viewer states facts and gives no advice', () => {
  const advice = /safe to (delete|remove)|can be (deleted|removed)|should be (removed|deleted)|recommend|you should|consider (removing|deleting)/i;
  it.each([...viewerFiles, { path: 'skills/excavator-view/SKILL.md', text: readFileSync(join(repoRoot, 'skills/excavator-view/SKILL.md'), 'utf-8') }].map((f) => [f.path, f.text]))(
    '%s has no advice wording',
    (_path, text) => { expect(text).not.toMatch(advice); },
  );
});

describe('the files of this change are English only', () => {
  it('lists the files it checks', () => {
    const paths = everyFileOfThisChange.map((f) => f.path);
    expect(paths).toContain('viewer/index.html');
    expect(paths).toContain('skills/excavator-view/pack.mjs');
    expect(paths).toContain('scripts/view-smoke.mjs');
    expect(paths).toContain('tests/skill/excavator-view/viewer-static-gate.test.mjs');
  });

  it.each(everyFileOfThisChange.map((f) => [f.path, f.text]))('%s has no CJK character', (_path, text) => {
    expect(CJK.test(text)).toBe(false);
  });

  it('sees a CJK character when there is one', () => {
    expect(CJK.test(`a${code(0x4e2d)}b`)).toBe(true);
    expect(CJK.test(`a${code(0x3042)}b`)).toBe(true);
    expect(CJK.test(`a${code(0xff0c)}b`)).toBe(true);
    expect(CJK.test('plain text, with punctuation: (ok)')).toBe(false);
  });
});
