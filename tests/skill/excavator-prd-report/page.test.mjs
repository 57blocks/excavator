// `prd.mjs page <out>`: writes <out>/report.html from the run's data and the
// built template, replacing only the template's two markers (openspec change
// prd-report-page, design D7). A run whose files disagree writes nothing.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { collectPageData } from '../../../skills/excavator-prd-report/lib/page-data.mjs';
import { PAGE_CSP, PAGE_TEMPLATE_PATH, TEMPLATE_VARIABLE, fillPageTemplate } from '../../../skills/excavator-prd-report/lib/page.mjs';
import { makeLaneRun, repoRoot, runPrd } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const CSP_MARKER = '<!-- xv:csp -->';
const DATA_MARKER = '<!-- xv:data -->';
const TEMPLATE = `<!--\nnotice\n-->\n<!doctype html><html><head>${CSP_MARKER}<title>t</title></head><body><div id="root"></div>${DATA_MARKER}<script>1</script></body></html>\n`;

/** The lane fixture after aggregate, with a synthetic template next to it; returns the run and a runner for `page`. */
function pageRun(template = TEMPLATE) {
  const run = makeLaneRun();
  cleanups.push(run.cleanup);
  expect(runPrd(['aggregate', run.out, '--project', run.project]).status).toBe(0);
  const templatePath = join(run.root, 'template.html');
  writeFileSync(templatePath, template);
  const page = (path = templatePath) => runPrd(['page', run.out, '--project', run.project], { env: { ...process.env, [TEMPLATE_VARIABLE]: path } });
  return { run, templatePath, page, report: join(run.out, 'report.html') };
}

const dataBlock = /<script type="application\/json" id="xv-prd-report-data">([^]*?)<\/script>/;

describe('prd.mjs page', () => {
  it('writes report.html next to the run and prints its path', () => {
    const { run, page, report } = pageRun();
    const out = page();
    expect(out.status, out.stdout + out.stderr).toBe(0);
    expect(out.stdout).toBe(`${report}\n`);
    expect(existsSync(report)).toBe(true);
    expect(readdirSync(run.out).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('puts the policy at the first marker and one data element at the second, and nothing else changes', () => {
    const { run, page, report, templatePath } = pageRun();
    expect(page().status).toBe(0);
    const html = readFileSync(report, 'utf-8');
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">`);
    expect(PAGE_CSP).toContain("connect-src 'none'");
    expect(PAGE_CSP).toBe("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'");
    expect(html.split('id="xv-prd-report-data"')).toHaveLength(2);
    expect(html).not.toContain(CSP_MARKER);
    expect(html).not.toContain(DATA_MARKER);
    // Putting the markers back gives the template, byte for byte.
    const restored = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, CSP_MARKER).replace(dataBlock, DATA_MARKER);
    expect(restored).toBe(readFileSync(templatePath, 'utf-8'));
    expect(run.root).toBeTruthy();
  });

  it('embeds exactly the data collectPageData gives, with no < left in the block', () => {
    const { run, page, report } = pageRun();
    expect(page().status).toBe(0);
    const block = dataBlock.exec(readFileSync(report, 'utf-8'))[1];
    expect(block).not.toContain('<');
    expect(JSON.parse(block)).toEqual(collectPageData(run.out, run.project));
    // The chapter's <details> block is in the data, so the escape was exercised.
    expect(JSON.parse(block).features[0].body).toContain('<details>');
  });

  it('holds no path of the project root in report.html, even when a verification report quotes it', () => {
    const { run, page, report } = pageRun();
    run.writeText('verification/F1.md', `# Verification of features/F1.md\n\nProject source: \`${run.project}\`\n`);
    expect(page().status).toBe(0);
    const html = readFileSync(report, 'utf-8');
    expect(html).not.toContain(run.project);
    expect(html).not.toContain(run.root);
    expect(html).toContain('Project source: `project`');
  });

  it('gives the same bytes on two runs', () => {
    const { page, report } = pageRun();
    expect(page().status).toBe(0);
    const first = readFileSync(report);
    expect(page().status).toBe(0);
    expect(readFileSync(report).equals(first)).toBe(true);
  });

  it('refuses a run that is not up to date: exit 2, names aggregate, writes nothing', () => {
    const { run, page, report } = pageRun();
    run.writeText('features/F1.md', run.readText('features/F1.md').replace(/```mermaid[\s\S]*?```\n/, ''));
    const out = page();
    expect(out.status).toBe(2);
    expect(out.stderr).toMatch(/prd\.mjs aggregate/);
    expect(existsSync(report)).toBe(false);
    expect(readdirSync(run.out).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('removes the page an earlier run left when it fails, so no stale report.html survives', () => {
    const { run, page, report } = pageRun();
    expect(page().status).toBe(0);
    expect(existsSync(report)).toBe(true);
    const index = run.readText('index.json');
    run.writeText('features/F1.md', run.readText('features/F1.md').replace(/```mermaid[\s\S]*?```\n/, ''));
    const stale = page();
    expect(stale.status).toBe(2);
    expect(stale.stderr).toMatch(/prd\.mjs aggregate/);
    expect(existsSync(report)).toBe(false);
    // The page is the only file page owns: everything else is as it was.
    expect(run.readText('index.json')).toBe(index);
  });

  it('refuses a run whose failed feature now gives other reasons under the same status, and writes nothing', () => {
    const { run, page, report } = pageRun();
    run.writeText('features/F2.md', run.readText('features/F2.md').replace(/```mermaid[\s\S]*?```\n/, ''));
    expect(runPrd(['aggregate', run.out, '--project', run.project]).status).toBe(0);
    expect(page().status).toBe(0);
    run.writeText('features/F2.md', run.readText('features/F2.md').replace(/<details>[\s\S]*?<\/details>\n?/, ''));
    const out = page();
    expect(out.status).toBe(2);
    expect(out.stderr).toMatch(/F2's failure reasons in index\.json differ.*prd\.mjs aggregate/);
    expect(existsSync(report)).toBe(false);
  });

  it('removes the page an earlier run left when the template is missing', () => {
    const { run, page, report } = pageRun();
    expect(page().status).toBe(0);
    expect(existsSync(report)).toBe(true);
    const out = page(join(run.root, 'nowhere', 'prd-report-page.html'));
    expect(out.status).toBe(2);
    expect(out.stderr).toMatch(/does not exist: run `pnpm -r build`/);
    expect(existsSync(report)).toBe(false);
  });

  it('refuses a run whose findings.json is missing', () => {
    const { run, page, report } = pageRun();
    writeFileSync(join(run.out, 'findings.json'), '{}');
    const out = page();
    expect(out.status).toBe(2);
    expect(out.stderr).toMatch(/findings\.json.*prd\.mjs aggregate/);
    expect(existsSync(report)).toBe(false);
  });

  it('says to build when the template does not exist, and writes nothing', () => {
    const { run, page, report } = pageRun();
    const out = page(join(run.root, 'nowhere', 'prd-report-page.html'));
    expect(out.status).toBe(2);
    expect(out.stderr).toMatch(/report page template .* does not exist: run `pnpm -r build`/);
    expect(existsSync(report)).toBe(false);
  });

  it('refuses a template with a marker repeated or missing', () => {
    for (const [name, broken] of [
      ['repeated data marker', TEMPLATE.replace('</body>', `${DATA_MARKER}</body>`)],
      ['repeated csp marker', TEMPLATE.replace('<title>', `${CSP_MARKER}<title>`)],
      ['missing data marker', TEMPLATE.replace(DATA_MARKER, '')],
      ['missing csp marker', TEMPLATE.replace(CSP_MARKER, '')],
    ]) {
      const { page, report } = pageRun(broken);
      const out = page();
      expect(out.status, name).toBe(2);
      expect(out.stderr, name).toMatch(/must contain <!-- xv:(csp|data) --> exactly once/);
      expect(existsSync(report), name).toBe(false);
    }
  });

  it('takes exactly one <out> and needs --project', () => {
    const { run } = pageRun();
    expect(runPrd(['page', '--project', run.project]).status).toBe(2);
    expect(runPrd(['page', run.out]).stderr).toMatch(/--project <root> is required/);
  });

  it('is listed in the help', () => {
    expect(runPrd(['--help']).stdout).toMatch(/\n {2}page <out> --project <root>\n/);
  });
});

describe('fillPageTemplate', () => {
  it('puts a replacement text with $ patterns in the data as it is', () => {
    const html = fillPageTemplate(TEMPLATE, { text: '$& $1 $$' });
    expect(html).toContain('{"text":"$& $1 $$"}');
  });

  it('writes < in the data as a unicode escape so no content closes the element', () => {
    const html = fillPageTemplate(TEMPLATE, { text: '</script><!--' });
    expect(dataBlock.exec(html)[1]).toBe(`{"text":"${String.fromCharCode(92)}u003c/script>${String.fromCharCode(92)}u003c!--"}`);
  });
});

describe('the built template', () => {
  // `pnpm -r build` runs before `pnpm test` in the gate; a missing build is a failure, not a skip.
  it('gives a page with the real template: its notice first, the policy and the data in', () => {
    const real = join(repoRoot, PAGE_TEMPLATE_PATH);
    expect(existsSync(real), `${real} is missing: run pnpm -r build`).toBe(true);
    const { run, page, report } = pageRun();
    const out = page(real);
    expect(out.status, out.stderr).toBe(0);
    const html = readFileSync(report, 'utf-8');
    expect(html.startsWith('<!--\nThird-party software bundled in this file')).toBe(true);
    expect(html).toContain("connect-src 'none'");
    expect(JSON.parse(dataBlock.exec(html)[1])).toEqual(collectPageData(run.out, run.project));
  });
});
