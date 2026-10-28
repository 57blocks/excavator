import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const read = (path) => readFileSync(join(repoRoot, path), 'utf-8');
const skillNames = (baseDir) => readdirSync(join(baseDir, 'skills'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const browserOpenerSkills = (baseDir, allowed = ['excavator-view']) => skillNames(baseDir)
  .filter((name) => !allowed.includes(name))
  .filter((name) => /\bxdg-open\b|cmd\.exe \/c start|\bopen "\$/.test(
    readFileSync(join(baseDir, 'skills', name, 'SKILL.md'), 'utf-8'),
  ));

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
    // The front end is the one package packages/explorer, a copy of the Understand Anything dashboard built into one file
    // and never served (openspec: changes/viewer-explorer, design D1 and D3; changes/retire-view-html). Its copied sources
    // keep the upstream token gate, which nothing imports, with its fetch: the page's policy (connect-src 'none') and
    // scripts/explorer-smoke.mjs, which sees zero requests, hold the no-network rule instead of a source scan.
    const EXPLORER_PACKAGE = 'packages/explorer';
    // The second HTML package is the report page of /excavator-prd-report (openspec: changes/prd-report-page, design D2):
    // its own template, built into one file the same way and never served.
    const REPORT_PAGE_PACKAGE = 'packages/prd-report-page';
    const HTML_PACKAGES = [EXPLORER_PACKAGE, REPORT_PAGE_PACKAGE];

    it.each(HTML_PACKAGES)('gives %s no script that starts a server', (pkg) => {
      const scripts = JSON.parse(read(`${pkg}/package.json`)).scripts ?? {};
      for (const name of ['dev', 'preview', 'serve', 'start']) expect(scripts, name).not.toHaveProperty(name);
      for (const [name, command] of Object.entries(scripts)) {
        expect(command, name).not.toMatch(/\bvite\b(?!\s+build\b)/);
      }
    });

    it.each(HTML_PACKAGES)('has no server or preview configuration in the vite config of %s', (pkg) => {
      const config = read(`${pkg}/vite.config.ts`);
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

    it('instrument: the matcher sees an HTML page in another package and lets the allowed package through', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'html-pages-instrument-'));
      try {
        for (const [dir, file] of [
          ['packages/explorer', 'index.html'],
          ['packages/third/src', 'page.html'],
          ['packages/third/node_modules/x', 'skipped.html'],
          ['packages/third/dist', 'skipped.html'],
        ]) {
          mkdirSync(join(tmp, dir), { recursive: true });
          writeFileSync(join(tmp, dir, file), '<html></html>\n');
        }
        expect(htmlPagesOutside(tmp, HTML_PACKAGES).pages).toEqual([join('packages/third/src', 'page.html')]);
        // With the package left off the allowed list its page is found too, so the allowance is what lets it through.
        expect(htmlPagesOutside(tmp, []).pages).toContain(join('packages/explorer', 'index.html'));
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
        ...skillNames(repoRoot).filter((name) => name !== 'excavator-view').map((name) => `skills/${name}/SKILL.md`),
        ...[
          ...readdirSync(join(repoRoot, 'agents')).map((name) => `agents/${name}`),
          ...readdirSync(join(repoRoot, 'hooks')).map((name) => `hooks/${name}`),
        ].filter((path) => existsSync(join(repoRoot, path)) && /\.(md|json)$/.test(path)),
      ];
      expect(others.length).toBeGreaterThan(10);
      for (const path of others) {
        expect(read(path), path).not.toMatch(/excavator-view/);
      }
    });

    it('is the only skill that mentions a browser opener', () => {
      expect(browserOpenerSkills(repoRoot)).toEqual([]);
    });

    it('instrument: skips regular files while detecting a browser opener in a non-view skill', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'skill-browser-opener-instrument-'));
      try {
        for (const [name, text] of [
          ['excavator-view', 'xdg-open "$OUT"'],
          ['unexpected', 'cmd.exe /c start "" "$OUT"'],
          ['ordinary', 'Write a JSON product.'],
        ]) {
          mkdirSync(join(tmp, 'skills', name), { recursive: true });
          writeFileSync(join(tmp, 'skills', name, 'SKILL.md'), text);
        }
        for (const name of ['.DS_Store', 'README.md']) {
          writeFileSync(join(tmp, 'skills', name), 'xdg-open "$OUT"');
        }
        expect(skillNames(tmp).sort()).toEqual(['excavator-view', 'ordinary', 'unexpected']);
        expect(browserOpenerSkills(tmp)).toEqual(['unexpected']);
        expect(browserOpenerSkills(tmp, [])).toEqual(['excavator-view', 'unexpected']);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('does not hide a missing SKILL.md in a genuine skill directory', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'skill-document-instrument-'));
      try {
        mkdirSync(join(tmp, 'skills', 'missing'), { recursive: true });
        expect(() => browserOpenerSkills(tmp)).toThrow(/ENOENT/);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
});
