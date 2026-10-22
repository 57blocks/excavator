/**
 * Checks on the files that ship the page (openspec: changes/viewer-app, task
 * 2.4, design D2, D9): the template packages/report-view builds, the page the
 * packer makes from it, and the sources around them. They read what the browser
 * would run, not the sources that produced it: the page loads nothing, has no
 * Chinese character, states facts without advice, and packs byte for byte the
 * same twice. They need `pnpm build` to have run, as `pnpm test` does after it.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { checkLicenseNotice, NOTICE_HEADING } from '../../../packages/report-view/scripts/licenses.mjs';
import { checkTemplate } from '../../../packages/report-view/scripts/single-file.mjs';
import { packProject } from '../../../skills/excavator-view/pack.mjs';
import { CONTRADICTED_SUMMARY, makeSmokeProject } from '../../../scripts/view-smoke-fixture.mjs';
import { manifestOf, payloadIds, payloadText } from './page.mjs';
import { repoRoot } from './plugin-fixture.mjs';

const TEMPLATE = join(repoRoot, 'packages/report-view/dist/view.html');
const code = (...points) => String.fromCharCode(...points);
// CJK ideographs and extensions, kana, Hangul, CJK punctuation and full-width forms.
const CJK = new RegExp(`[${code(0x2e80)}-${code(0x2fdf)}${code(0x3000)}-${code(0x30ff)}${code(0x3400)}-${code(0x4dbf)}${code(0x4e00)}-${code(0x9fff)}${code(0xac00)}-${code(0xd7af)}${code(0xf900)}-${code(0xfaff)}${code(0xff00)}-${code(0xffef)}]`);
const ADVICE = /safe to (delete|remove)|can be (deleted|removed)|should be (removed|deleted)|recommend|you should|consider (removing|deleting)/i;

/** Every file under `dir` (skipping what a build or an install leaves), as repo-relative paths. */
function walk(dir) {
  return readdirSync(join(repoRoot, dir)).flatMap((name) => {
    if (name === 'node_modules' || name === 'dist') return [];
    const path = join(dir, name);
    return statSync(join(repoRoot, path)).isDirectory() ? walk(path) : [path];
  });
}

const read = (path) => readFileSync(join(repoRoot, path), 'utf-8');

describe('the built template', () => {
  let html;
  beforeAll(() => {
    if (!existsSync(TEMPLATE)) throw new Error('packages/report-view/dist/view.html does not exist: run `pnpm build` first');
    html = readFileSync(TEMPLATE, 'utf-8');
  });

  it('keeps the template contract: one file, one marker of each kind, nothing linked or loaded', () => {
    expect(readdirSync(join(repoRoot, 'packages/report-view/dist'))).toEqual(['view.html']);
    expect(checkTemplate(['view.html'], html)).toEqual([]);
  });

  it('starts with the licence notice, which lists the bundled packages with the version and licence of the installed ones', () => {
    expect(html.startsWith(`<!--\n${NOTICE_HEADING}\n`)).toBe(true);
    // react: the page; @xyflow/react: the canvas; d3-force: only the focus layout's worker bundles it.
    expect(checkLicenseNotice(html, ['elkjs', 'react', '@xyflow/react', 'motion', 'd3-force'])).toBeNull();
    for (const name of ['elkjs', 'd3-force', 'react']) {
      const installed = JSON.parse(readFileSync(join(repoRoot, 'packages/report-view/node_modules', name, 'package.json'), 'utf-8'));
      expect(html.slice(0, html.indexOf('-->')), name).toContain(`\n${name} ${installed.version} ${installed.license}\n`);
    }
    expect(/^elkjs \S+ .*EPL-2\.0/m.test(html.slice(0, html.indexOf('-->')))).toBe(true);
  });

  it('draws no image, frame or media element and loads no stylesheet', () => {
    const markup = html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
    expect(markup).not.toMatch(/<(link|img|iframe|object|embed|video|audio|source|script)\b/i);
  });

  const css = (text) => [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');

  it('has a stylesheet that names no font and no address of its own', () => {
    expect(css(html).length).toBeGreaterThan(1000);
    expect(css(html)).not.toMatch(/@font-face|@import/i);
    expect(css(html)).not.toMatch(/url\(\s*['"]?(?!data:)/i);
  });

  it('defines the colour of every node kind, which the code reads through var() and no class names', () => {
    for (const kind of ['file', 'callable', 'type', 'config', 'docs', 'data', 'service', 'domain']) expect(css(html), kind).toContain(`--color-node-${kind}:`);
  });

  it('declares one light colour scheme and has no dark branch', () => {
    expect(html).toContain('<meta name="color-scheme" content="light">');
    // The graph library's script names the media query for its own colour-mode switch, which the page never uses (it passes colorMode="light"):
    // the gate reads the stylesheet and the page's own sources.
    expect(css(html)).not.toMatch(/prefers-color-scheme/);
    for (const path of walk('packages/report-view/src')) expect(read(path), path).not.toMatch(/prefers-color-scheme|colorMode="(system|dark)"/);
    expect(css(html)).not.toMatch(/color-scheme:\s*(dark|light dark)/);
  });

  it('has no Chinese character', () => {
    expect(CJK.test(html)).toBe(false);
  });

  it('states facts and gives no advice', () => {
    const hit = ADVICE.exec(html);
    expect(hit ? html.slice(Math.max(0, hit.index - 60), hit.index + 80) : null).toBeNull();
  });
});

describe('the page packed from the real template', () => {
  let smoke;
  let template;
  beforeAll(() => {
    if (!existsSync(TEMPLATE)) throw new Error('packages/report-view/dist/view.html does not exist: run `pnpm build` first');
    template = readFileSync(TEMPLATE, 'utf-8');
    const dir = mkdtempSync(join(tmpdir(), 'xv-smoke-fixture-'));
    smoke = { dir, ...makeSmokeProject(dir) };
  });
  afterAll(() => smoke && rmSync(smoke.dir, { recursive: true, force: true }));

  it('is byte-identical when the fixture project is packed twice', () => {
    const first = readFileSync(packProject(smoke.root).out);
    const second = readFileSync(packProject(smoke.root).out);
    expect(second.equals(first)).toBe(true);
    expect(first.length).toBeGreaterThan(template.length);
  });

  it('is the template with its two markers filled and the policy ahead of every script', () => {
    const page = readFileSync(packProject(smoke.root).out, 'utf-8');
    const policies = page.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/g);
    expect(policies).toHaveLength(1);
    expect(policies[0]).toContain("script-src 'unsafe-inline'");
    expect(policies[0]).toContain('worker-src blob:');
    expect(page.indexOf(policies[0])).toBeLessThan(page.indexOf('<script'));
    expect(page).not.toContain('xv:csp');
    expect(page).not.toContain('xv:data');
    expect(payloadIds(page)).toEqual(['knowledge-graph', 'unused-code', 'doc-map', 'doc-map-checks', 'hotspots', 'report-hotspots', 'report-doc-map', 'sources']);
    expect(page).not.toMatch(/<link\b/i);
    expect(page).not.toMatch(/<script[^>]*\ssrc=/i);
  });

  it('keeps hostile report text out of the markup of the page', () => {
    const page = readFileSync(packProject(smoke.root).out, 'utf-8');
    expect(page).not.toContain('<script>alert');
    expect(page).not.toContain('onerror=alert(1)>');
  });
});

describe('the page packed from the Full-mode smoke fixture', () => {
  let smoke;
  let html;
  beforeAll(() => {
    if (!existsSync(TEMPLATE)) throw new Error('packages/report-view/dist/view.html does not exist: run `pnpm build` first');
    const dir = mkdtempSync(join(tmpdir(), 'xv-smoke-full-'));
    smoke = { dir, ...makeSmokeProject(dir, { full: true }) };
    html = readFileSync(packProject(smoke.root).out, 'utf-8');
  });
  afterAll(() => smoke && rmSync(smoke.dir, { recursive: true, force: true }));

  it('holds the semantic payload and counts what the Products page should show', () => {
    expect(payloadIds(html)).toContain('semantics');
    const product = manifestOf(html).products.find((p) => p.name === 'semantics');
    const { products } = smoke.expected;
    expect(product.status).toBe('included');
    expect(product.counts).toEqual({
      entries: products['semantic-entries'],
      stale: products['semantic-stale'],
      byVerdict: { verified: products['semantic-verified'], unverified: products['semantic-unverified'], contradicted: products['semantic-contradicted'], unchecked: products['semantic-unchecked'] },
      layers: products['semantic-layers'],
    });
  });

  it('holds the tour, included, since it was made from the graph\'s facts', () => {
    const product = manifestOf(html).products.find((p) => p.name === 'tour');
    const { tour } = smoke.expected;
    expect(product).toMatchObject({ status: 'included', payloads: ['tour'], factDigests: { tour: tour.factDigest, graph: tour.factDigest } });
    expect(product.counts).toMatchObject({ steps: tour.steps, sentences: tour.sentences, removedSentences: tour.removedSentences });
    expect(payloadIds(html)).toContain('tour');
  });

  it('has the contradicted summary neither in the page nor in any decoded payload, and no audit or hash', () => {
    expect(html).not.toContain(CONTRADICTED_SUMMARY);
    for (const id of payloadIds(html)) expect(payloadText(html, id), id).not.toContain(CONTRADICTED_SUMMARY);
    expect(payloadText(html, 'semantics')).not.toMatch(/languageAudit|semanticSourceHash/);
    expect(payloadText(html, 'semantics')).not.toContain('Computed from older source.');
  });
});

describe('the files of this change are English only and give no advice', () => {
  const files = [
    ...walk('packages/report-view/src'),
    ...walk('packages/report-view/test'),
    ...walk('packages/report-view/scripts'),
    'packages/report-view/vite.config.ts',
    'packages/report-view/view.html',
    ...walk('skills/excavator-view'),
    ...walk('tests/skill/excavator-view'),
    'scripts/view-smoke.mjs',
    'scripts/view-smoke-fixture.mjs',
  ];

  it('lists the files it checks', () => {
    expect(files).toContain('packages/report-view/src/App.tsx');
    expect(files).toContain('packages/report-view/src/index.css');
    expect(files).toContain('skills/excavator-view/pack.mjs');
    expect(files).toContain('tests/skill/excavator-view/view-template.test.mjs');
    expect(files).toContain('scripts/view-smoke.mjs');
  });

  it.each(files.map((path) => [path]))('%s has no CJK character', (path) => {
    expect(CJK.test(read(path))).toBe(false);
  });

  it('sees a CJK character when there is one', () => {
    expect(CJK.test(`a${code(0x4e2d)}b`)).toBe(true);
    expect(CJK.test(`a${code(0x3042)}b`)).toBe(true);
    expect(CJK.test(`a${code(0xff0c)}b`)).toBe(true);
    expect(CJK.test('plain text, with punctuation: (ok)')).toBe(false);
  });

  it('sees advice when there is some', () => {
    for (const text of ['it is safe to delete this', 'this can be removed', 'we recommend a fix', 'you should look', 'consider removing it']) {
      expect(ADVICE.test(text), text).toBe(true);
    }
    expect(ADVICE.test('Functions no route reaches, as the product lists them.')).toBe(false);
  });

  it('keeps the skill and the page sources free of advice wording', () => {
    for (const path of ['skills/excavator-view/SKILL.md', ...files.filter((f) => f.startsWith('packages/report-view/src/'))]) {
      expect(ADVICE.test(read(path)), relative(repoRoot, join(repoRoot, path))).toBe(false);
    }
  });
});
