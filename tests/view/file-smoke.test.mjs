// artifact-view task 4.4 (design D11): the file:// smoke instrument. A baked
// page is opened from disk in headless Chrome and read back through what it
// reports on #root. The instrument is first shown to go red on a page whose
// data segment is truncated, then used on a page baked from the synthetic
// fixture. Without Chrome the test is a visible skip, never a pass.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

import { findChrome, smoke } from '../../scripts/view-smoke.mjs';
import { decodeBundle } from '../../skills/excavator-view/bundle-codec.mjs';
import { extractBundleText } from '../../skills/excavator-view/bake/html-output.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const smokeScript = join(repoRoot, 'scripts/view-smoke.mjs');
const bakeScript = join(repoRoot, 'skills/excavator-view/build-view.mjs');
const lazyScript = join(repoRoot, 'skills/excavator/lazy-analyze.mjs');
const fixtureProject = join(repoRoot, 'tests/view/fixtures/sample-project');

const chrome = findChrome();

if (!chrome.path) {
  describe('view file:// smoke', () => {
    it.skip(`skipped: ${chrome.reason}`, () => {});
  });
} else {
  describe('view file:// smoke', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'excavator-view-smoke-test-'));
    const template = join(scratch, 'dist', 'index.html');
    let analyzed;
    let goodPage;
    let report;

    const runSmoke = (page, ...flags) => {
      const run = spawnSync(process.execPath, [smokeScript, page, ...flags], { encoding: 'utf-8', timeout: 90_000 });
      return { status: run.status, result: JSON.parse(run.stdout.trim().split('\n').at(-1)), stderr: run.stderr };
    };
    const bake = (project, out) => JSON.parse(execFileSync(process.execPath, [bakeScript, project, '--template', template, '--out', out], { encoding: 'utf-8' }));
    const copyProject = () => {
      const dir = mkdtempSync(join(scratch, 'project-'));
      cpSync(analyzed, dir, { recursive: true });
      return dir;
    };

    beforeAll(() => {
      // Build the real template into a private outDir (never races another
      // test's build of packages/view/dist).
      const build = spawnSync('pnpm', ['--filter', '@excavator/view', 'exec', 'vite', 'build', '--outDir', join(scratch, 'dist'), '--emptyOutDir'], {
        cwd: repoRoot, encoding: 'utf-8',
      });
      if (build.status !== 0) throw new Error(`vite build failed:\n${build.stdout}\n${build.stderr}`);
      analyzed = join(scratch, 'analyzed');
      cpSync(fixtureProject, analyzed, { recursive: true });
      execFileSync(process.execPath, [lazyScript, analyzed], { stdio: 'pipe' });
      goodPage = join(scratch, 'good.html');
      report = bake(analyzed, goodPage);
    }, 180_000);

    afterAll(() => {
      rmSync(scratch, { recursive: true, force: true });
    });

    it('reports red on a page whose data segment is truncated (instrument check)', () => {
      const html = readFileSync(goodPage, 'utf-8');
      const lines = html.split('\n');
      const header = lines.findIndex((line) => line.startsWith('@nodes '));
      expect(header).toBeGreaterThan(0);
      lines[header + 1] = lines[header + 1].slice(0, Math.floor(lines[header + 1].length / 2));
      const broken = join(scratch, 'truncated.html');
      writeFileSync(broken, lines.join('\n'));
      const { status, result } = runSmoke(broken);
      expect(status).toBe(1);
      expect(result.ok).toBe(false);
      expect(result.ready === false || result.errors > 0).toBe(true);
      expect(result.ready).toBe(false);
      expect(result.errors).toBeGreaterThan(0);
      expect(result.error).toMatch(/BundleFormatError/);
    }, 90_000);

    it('reports green on the fixture page, with decoded counts equal to the header', () => {
      const { status, result } = runSmoke(goodPage);
      expect(result).toMatchObject({ ready: true, errors: 0, cspViolations: 0, countsMatchHeader: true, ok: true, decodeMode: 'worker' });
      expect(status).toBe(0);
      const header = report.counts.header;
      expect(result.counts).toMatchObject({ nodes: header.nodes, edges: header.edges, gaps: header.gaps });
      expect(result.counts.evidence).toBe(report.counts.streamed.evidence);
      expect(result.decodeMs).toBeGreaterThanOrEqual(0);
      expect(result.readyMs).toBeGreaterThan(0);
    }, 90_000);

    it('renders the overview of a Lazy-only bundle with all three "Not generated" commands (4.2)', async () => {
      const result = await smoke(goodPage);
      expect(result.ok).toBe(true);
      const dom = result.dom;
      expect(dom).toContain('data-field="project-name">view-sample-project<');
      expect(dom).toContain('data-counts-match="true"');
      expect(dom).toContain('data-freshness="fresh"');
      for (const artifact of ['semantic-cache.json', 'semantic-graph.json', 'domain-graph.json']) {
        expect(dom).toMatch(new RegExp(`data-semantic="${artifact.replace('.', '\\.')}" data-state="not-generated"`));
      }
      expect(dom.match(/>Not generated</g)).toHaveLength(3);
      expect(dom).toContain('not generated: run /excavator --mode=full, or generate on demand in /excavator-chat');
      expect(dom).toContain('not generated: run /excavator --mode=full<');
      expect(dom).toContain('not generated: run /excavator-domain');
      expect(dom).toContain('data-artifact="domain-graph.json" data-state="missing"');
    }, 90_000);

    it('shows the stale banner with the /excavator hint when the source changed after analysis (4.2)', async () => {
      const project = copyProject();
      appendFileSync(join(project, 'src', 'main.ts'), '\nexport const changed = 1;\n');
      const page = join(scratch, 'stale.html');
      bake(project, page);
      const result = await smoke(page);
      expect(result.ok).toBe(true);
      expect(result.dom).toContain('data-freshness="stale"');
      expect(result.dom).toContain('Hint: run /excavator to refresh');
    }, 90_000);

    it('renders coverage with every language balanced on the fixture (4.3)', async () => {
      const result = await smoke(goodPage, { hash: '#/coverage' });
      expect(result).toMatchObject({ ok: true, route: 'coverage' });
      expect(result.dom).toContain('data-conservation="ok"');
      expect(result.dom).toContain('data-language="typescript" data-balanced="true"');
      expect(result.dom).toContain('data-funnel="candidates"');
      expect(result.dom).toContain('data-gap-kind="calls-unresolved"');
      expect(result.dom).toContain('src/main.ts:6 -&gt; counter.increment');
    }, 90_000);

    it('shows a red inequality for coverage that does not balance (instrument check, 4.3)', async () => {
      const project = copyProject();
      const graphPath = join(project, '.excavator', 'knowledge-graph.jsonl');
      const lines = readFileSync(graphPath, 'utf-8').split('\n');
      const at = lines.findIndex((line) => line.startsWith('{"record":"coverage"'));
      expect(at).toBeGreaterThan(0);
      const record = JSON.parse(lines[at]);
      record.coverage.byLanguage.typescript.files += 1;
      lines[at] = JSON.stringify(record);
      writeFileSync(graphPath, lines.join('\n'));
      const page = join(scratch, 'unbalanced.html');
      bake(project, page);
      const result = await smoke(page, { hash: '#/coverage' });
      expect(result.ok).toBe(true);
      expect(result.dom).toContain('data-conservation="fail"');
      expect(result.dom).toContain('data-language="typescript" data-balanced="false"');
      expect(result.dom).toMatch(/class="equation bad-text">4 ≠ 3 \+ 0</);
    }, 90_000);

    it('filters gaps by scope from the hash (4.3)', async () => {
      const result = await smoke(goodPage, { hash: '#/coverage?scope=nothing-here' });
      expect(result.ok).toBe(true);
      expect(result.dom).toContain('No gap has scope nothing-here.');
      expect(result.dom).not.toContain('data-gap-kind="calls-unresolved"');
    }, 90_000);

    it('opens a deep link to a node and says so when the id is unknown (4.1)', async () => {
      const segments = (await decodeBundle(extractBundleText(readFileSync(goodPage, 'utf-8')))).segments;
      const id = segments.strings[segments.nodes.columns.id[0]];
      const found = await smoke(goodPage, { hash: `#/node/${encodeURIComponent(id)}` });
      expect(found).toMatchObject({ ok: true, route: 'node' });
      expect(found.dom).toContain('data-node-found="true"');
      const missing = await smoke(goodPage, { hash: '#/node/no-such-node' });
      expect(missing).toMatchObject({ ok: true, route: 'node' });
      expect(missing.dom).toContain('data-node-found="false"');
    }, 90_000);

    it('shows a placeholder, not fake content, for the later sections (4.1)', async () => {
      for (const section of ['structure', 'graph', 'search', 'semantics']) {
        const result = await smoke(goodPage, { hash: `#/${section}` });
        expect(result.ok, section).toBe(true);
        expect(result.dom).toContain(`data-section="${section}" data-placeholder="true"`);
        expect(result.dom).toContain('Available in a later slice.');
      }
    }, 120_000);

    // Task 4A.4: the smoke run closes Chrome over the DevTools protocol before
    // falling back to SIGKILL, so Chrome removes its own temporary
    // directories; a killed Chrome leaves com.google.Chrome.* directories in
    // the user temp dir on every run. This file runs its Chrome sessions one
    // at a time, but other processes may add such directories concurrently,
    // so only directories still present a second later count, and one of
    // three attempts must add none (a leaking script adds some every time).
    it('closes Chrome over the protocol and adds no com.google.Chrome.* or profile directory (4A.4)', async () => {
      const chromeTemps = () => new Set(readdirSync(tmpdir()).filter((n) => n.startsWith('com.google.Chrome.') || n.startsWith('excavator-view-smoke-')));
      const attempts = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const before = chromeTemps();
        const result = await smoke(goodPage);
        expect(result.ok).toBe(true);
        expect(result.chrome.exit).toBe('closed');
        await new Promise((r) => setTimeout(r, 1000));
        const added = [...chromeTemps()].filter((n) => !before.has(n));
        attempts.push(added);
        if (added.length === 0) break;
      }
      expect(attempts.at(-1), JSON.stringify(attempts)).toEqual([]);
    }, 90_000);

    it('reports prefers-reduced-motion when asked to emulate it', () => {
      const { status, result } = runSmoke(goodPage, '--reduced-motion');
      expect(status).toBe(0);
      expect(result.reducedMotion).toBe(true);
      expect(runSmoke(goodPage).result.reducedMotion).toBe(false);
    }, 90_000);
  });
}
