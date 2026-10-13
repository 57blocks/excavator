// artifact-view task 1.2: the page template builds into ONE self-contained
// HTML file. The view is opened from file://, where a page cannot fetch
// sibling files or load external module scripts, so any external reference in
// dist/index.html is a broken page, not a style issue.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// The same guards the bake applies to every page before writing it.
import { DATA_PLACEHOLDER, contentSecurityPolicy, cspProblems, externalReferences } from '../../skills/excavator-view/html-guards.mjs';
import { loadTemplate } from '../../skills/excavator-view/bake/html-output.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const templatePath = join(repoRoot, 'packages/view/dist/index.html');

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
    expect(html.split(DATA_PLACEHOLDER).length - 1).toBe(1);
  });

  it('declares a content security policy that allows no network source', () => {
    expect(cspProblems(html)).toEqual([]);
    const csp = contentSecurityPolicy(html);
    expect(csp.get('default-src')).toEqual(["'none'"]);
    expect(csp.get('connect-src')).toEqual(["'none'"]);
    expect(csp.get('img-src')).toEqual(['data:']);
    expect(csp.get('worker-src')).toEqual(['blob:']);
  });

  it('the CSP check sees a policy that opens the network (instrument check)', () => {
    expect(cspProblems(html.replace("connect-src 'none'", 'connect-src https://example.invalid'))).not.toEqual([]);
    expect(cspProblems(html.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/, ''))).toEqual(['no Content-Security-Policy meta tag']);
  });

  it('is accepted by the bake as a view template', () => {
    const { prefix, suffix } = loadTemplate(templatePath);
    expect(prefix.endsWith('<script type="text/plain" id="excavator-view-data">\n')).toBe(true);
    expect(suffix.startsWith('\n</script>')).toBe(true);
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
