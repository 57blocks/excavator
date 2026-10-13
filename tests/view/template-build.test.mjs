// artifact-view task 1.2: the page template builds into ONE self-contained
// HTML file. The view is opened from file://, where a page cannot fetch
// sibling files or load external module scripts, so any external reference in
// dist/index.html is a broken page, not a style issue.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const templatePath = join(repoRoot, 'packages/view/dist/index.html');
const PLACEHOLDER = '<script type="text/plain" id="excavator-view-data"></script>';

// The reference scanner below is the same rule set the bake applies before
// writing a page. Inline script bodies are blanked before markup is scanned:
// minified JavaScript is full of `x.src=` assignments and `href==`
// comparisons that are not references. Script bodies are scanned only for a
// literal dynamic import(), the one way bundled code could load another file.
const DOCUMENTATION_IMPORT_TEXTS = new Set(["import('./MyComponent')"]); // React lazy() error-message prose

function isInlineTarget(target) {
  const value = target.trim();
  return value === '' || value.startsWith('#') || /^(data|blob|about):/i.test(value);
}

function externalReferences(html) {
  const scripts = [];
  const markup = html.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (_m, open, body, close) => {
    scripts.push(body);
    return `${open}${close}`;
  });
  const found = [];
  const markupPatterns = [
    /\b(?:src|href)\s*=\s*"([^"]*)"/gi,
    /\b(?:src|href)\s*=\s*'([^']*)'/gi,
    /\b(?:src|href)\s*=\s*([^\s"'>]+)/gi,
    /url\(\s*["']?([^"')]*)["']?\s*\)/gi,
    /@import\s+["']([^"']*)["']/gi,
  ];
  for (const pattern of markupPatterns) {
    for (const match of markup.matchAll(pattern)) {
      if (!isInlineTarget(match[1])) found.push(match[0]);
    }
  }
  for (const body of scripts) {
    for (const match of body.matchAll(/\bimport\s*\(\s*(["'`])([^"'`]*)\1\s*\)/g)) {
      if (DOCUMENTATION_IMPORT_TEXTS.has(match[0]) || isInlineTarget(match[2])) continue;
      found.push(match[0]);
    }
    for (const match of body.matchAll(/\bimportScripts\s*\(/g)) found.push(match[0]);
  }
  return found;
}

describe('view template build', () => {
  let html;

  beforeAll(() => {
    const result = spawnSync('pnpm', ['--filter', '@excavator/view', 'build'], {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    if (result.status !== 0) {
      throw new Error(`vite build failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
    }
    html = readFileSync(templatePath, 'utf-8');
  }, 120_000);

  it('references no external resource', () => {
    expect(externalReferences(html)).toEqual([]);
  });

  it('carries exactly one empty data placeholder', () => {
    expect(html.split(PLACEHOLDER).length - 1).toBe(1);
  });

  it('declares a content security policy that allows no network source', () => {
    const csp = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i);
    expect(csp, 'CSP meta tag').not.toBeNull();
    const directives = new Map(
      csp[1].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
        const [name, ...values] = d.split(/\s+/);
        return [name, values];
      }),
    );
    expect(directives.get('default-src')).toEqual(["'none'"]);
    expect(directives.get('script-src')).toEqual(["'unsafe-inline'"]);
    expect(directives.get('style-src')).toEqual(["'unsafe-inline'"]);
    expect(directives.get('img-src')).toEqual(['data:']);
    expect(directives.get('worker-src')).toEqual(['blob:']);
    expect(directives.get('connect-src')).toEqual(["'none'"]);
    for (const values of directives.values()) {
      for (const value of values) expect(value).not.toMatch(/^(https?:|\*|'self'|\/\/)/i);
    }
  });

  it('ships the production React build even when built under vitest (NODE_ENV=test)', () => {
    expect(html).toContain('react-dom.production.min.js');
    expect(html).not.toMatch(/\.development\.js/);
  });

  it('inlines its module script instead of loading it', () => {
    expect(html).not.toMatch(/<script[^>]*type="module"[^>]*\bsrc=/i);
    expect(html).not.toMatch(/<link\b/i);
  });

  it('the reference scanner sees a planted external link (instrument check)', () => {
    const planted = html.replace('</head>', '<link rel="stylesheet" href="https://example.invalid/x.css"></head>');
    expect(externalReferences(planted)).toEqual(['href="https://example.invalid/x.css"']);
    expect(externalReferences('<script type="module" src="./main.js"></script>')).toHaveLength(1);
    expect(externalReferences('<img src="//cdn.invalid/a.png">')).toHaveLength(1);
    expect(externalReferences('<div style="background:url(img/a.png)"></div>')).toHaveLength(1);
    expect(externalReferences('<script>const m = import("./chunk.js")</script>')).toHaveLength(1);
    expect(externalReferences('<style>@import "https://example.invalid/a.css";</style>')).toHaveLength(1);
  });
});
