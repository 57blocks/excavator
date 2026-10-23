import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const read = (path) => readFileSync(join(repoRoot, path), 'utf-8');

describe('service-only distribution contract', () => {
  it('ships no HTML dashboard, viewer, dashboard skill, tour builder, or thumbnail helper', () => {
    for (const path of [
      'packages/dashboard',
      'packages/viewer',
      'skills/excavator-dashboard',
      'agents/excavator-tour-builder.md',
      'packages/core/src/analyzer/tour-generator.ts',
      'packages/core/src/figma/thumbnails.ts',
    ]) {
      expect(existsSync(join(repoRoot, path)), path).toBe(false);
    }
  });

  it('has one runtime mode with no presentation flags or launch instructions', () => {
    const excavator = read('skills/excavator/SKILL.md');
    const hook = read('hooks/auto-update-prompt.md');
    const configTypes = read('packages/core/src/types.ts');

    for (const text of [excavator, hook, configTypes]) {
      expect(text).not.toContain('terminalOnly');
      expect(text).not.toContain('--terminal-only');
      expect(text).not.toContain('--with-dashboard');
      expect(text).not.toContain('excavator-tour-builder');
      expect(text).not.toContain('/excavator-dashboard');
    }
    expect(excavator).toContain('tour: []');
  });

  it('keeps analysis skills as JSON producers without dashboard handoffs', () => {
    for (const path of [
      'skills/excavator-chat/SKILL.md',
      'skills/excavator-diff/SKILL.md',
      'skills/excavator-domain/SKILL.md',
      'skills/excavator-figma/SKILL.md',
      'skills/excavator-knowledge/SKILL.md',
    ]) {
      const text = read(path);
      expect(text, path).not.toContain('/excavator-dashboard');
      expect(text, path).not.toMatch(/\bdashboard\b/i);
    }
  });

  it('does not include display packages in build, tests, or plugin metadata', () => {
    const buildConfig = `${read('package.json')}\n${read('vitest.config.ts')}`;
    const manifest = read('.claude-plugin/plugin.json');
    expect(buildConfig).not.toMatch(/packages\/(dashboard|viewer)/);
    expect(manifest).not.toMatch(/\bdashboard\b/i);
  });

  // The one exception: /excavator-view writes a static page and opens it (openspec: changes/report-viewer, design D8).
  describe('the /excavator-view exception stays narrow', () => {
    const walk = (dir) => readdirSync(join(repoRoot, dir), { withFileTypes: true }).flatMap((entry) => (
      entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
    ));

    // The front end is the one package packages/report-view, built into one file and never served (openspec: changes/viewer-app, design D10).
    const VIEW_PACKAGE = 'packages/report-view';

    it('gives the report-view package no script that starts a server', () => {
      const scripts = JSON.parse(read(`${VIEW_PACKAGE}/package.json`)).scripts ?? {};
      for (const name of ['dev', 'preview', 'serve', 'start']) expect(scripts, name).not.toHaveProperty(name);
      for (const [name, command] of Object.entries(scripts)) {
        // vite runs only as `vite build`; a bare `vite`, `vite dev`, `vite serve` or `vite preview` starts a server.
        expect(command, name).not.toMatch(/\bvite\b(?!\s+build\b)/);
      }
    });

    it('has no server or preview configuration in the report-view vite config', () => {
      const config = read(`${VIEW_PACKAGE}/vite.config.ts`);
      expect(config).not.toMatch(/\b(server|preview)\s*:/);
      expect(config).not.toMatch(/configureServer|configurePreviewServer/);
    });

    it('has no network or server call in the report-view source', () => {
      const files = walk(`${VIEW_PACKAGE}/src`);
      expect(files.length).toBeGreaterThan(0);
      for (const path of files) {
        const text = read(path);
        for (const call of ['createServer', 'listen(', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
          expect(text, `${path}: ${call}`).not.toContain(call);
        }
      }
    });

    // The Understand Anything dashboard copy is the second package that ships an HTML page, also built into one file and never served (openspec: changes/viewer-explorer, design D1 and D3).
    const EXPLORER_PACKAGE = 'packages/explorer';
    const HTML_PACKAGES = [VIEW_PACKAGE, EXPLORER_PACKAGE];

    it('gives the explorer package no script that starts a server', () => {
      const scripts = JSON.parse(read(`${EXPLORER_PACKAGE}/package.json`)).scripts ?? {};
      for (const name of ['dev', 'preview', 'serve', 'start']) expect(scripts, name).not.toHaveProperty(name);
      for (const [name, command] of Object.entries(scripts)) {
        expect(command, name).not.toMatch(/\bvite\b(?!\s+build\b)/);
      }
    });

    it('has no server or preview configuration in the explorer vite config', () => {
      const config = read(`${EXPLORER_PACKAGE}/vite.config.ts`);
      expect(config).not.toMatch(/\b(server|preview)\s*:/);
      expect(config).not.toMatch(/configureServer|configurePreviewServer/);
    });

    // Pure matcher: the HTML pages under every package directory of baseDir that is not in the allowed list.
    const htmlPagesOutside = (baseDir, allowed) => {
      const skipped = new Set(['node_modules', 'dist']);
      const pages = (dir) => readdirSync(join(baseDir, dir), { withFileTypes: true }).flatMap((entry) => {
        if (entry.isDirectory()) return skipped.has(entry.name) ? [] : pages(join(dir, entry.name));
        return /\.html?$/i.test(entry.name) ? [join(dir, entry.name)] : [];
      });
      const others = readdirSync(join(baseDir, 'packages'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !allowed.includes(`packages/${entry.name}`))
        .map((entry) => `packages/${entry.name}`);
      return { others, pages: others.flatMap(pages) };
    };

    it('ships no HTML page from any other package', () => {
      const { others, pages } = htmlPagesOutside(repoRoot, HTML_PACKAGES);
      expect(others.length).toBeGreaterThan(0);
      expect(pages).toEqual([]);
    });

    it('instrument: the matcher sees an HTML page in a third package and lets the two allowed packages through', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'html-pages-instrument-'));
      try {
        for (const [dir, file] of [
          ['packages/report-view', 'view.html'],
          ['packages/explorer', 'index.html'],
          ['packages/third/src', 'page.html'],
          ['packages/third/node_modules/x', 'skipped.html'],
          ['packages/third/dist', 'skipped.html'],
        ]) {
          mkdirSync(join(tmp, dir), { recursive: true });
          writeFileSync(join(tmp, dir, file), '<html></html>\n');
        }
        expect(htmlPagesOutside(tmp, HTML_PACKAGES).pages).toEqual([join('packages/third/src', 'page.html')]);
        // With the second package left off the allowed list its page is found too, so the allowance is what lets it through.
        expect(htmlPagesOutside(tmp, [VIEW_PACKAGE]).pages).toContain(join('packages/explorer', 'index.html'));
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('starts no server from the packer or the skill', () => {
      for (const path of ['skills/excavator-view/pack.mjs', 'skills/excavator-view/SKILL.md']) {
        const text = read(path);
        expect(text, path).not.toContain('createServer');
        expect(text, path).not.toContain('.listen(');
        expect(text, path).not.toContain('listen(');
      }
    });

    it('is referenced by no other skill, agent or hook', () => {
      const others = [
        ...readdirSync(join(repoRoot, 'skills')).filter((name) => name !== 'excavator-view').map((name) => `skills/${name}/SKILL.md`),
        ...readdirSync(join(repoRoot, 'agents')).map((name) => `agents/${name}`),
        ...readdirSync(join(repoRoot, 'hooks')).map((name) => `hooks/${name}`),
      ].filter((path) => existsSync(join(repoRoot, path)) && /\.(md|json)$/.test(path));
      expect(others.length).toBeGreaterThan(10);
      for (const path of others) {
        expect(read(path), path).not.toMatch(/excavator-view/);
      }
    });

    it('is the only skill that mentions a browser opener', () => {
      for (const name of readdirSync(join(repoRoot, 'skills')).filter((n) => n !== 'excavator-view')) {
        const text = read(`skills/${name}/SKILL.md`);
        expect(text, name).not.toMatch(/\bxdg-open\b|cmd\.exe \/c start|\bopen "\$/);
      }
    });
  });
});
