// artifact-view task 4.4 (design D11): the file:// smoke instrument. A baked
// page is opened from disk in headless Chrome and read back through what it
// reports on #root. The instrument is first shown to go red on a page whose
// data segment is truncated, then used on a page baked from the synthetic
// fixture. Without Chrome the test is a visible skip, never a pass.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

import { findChrome, smoke } from '../../scripts/view-smoke.mjs';
import { decodeBundle } from '../../skills/excavator-view/bundle-codec.mjs';
import { extractBundleText } from '../../skills/excavator-view/bake/html-output.mjs';
import { nodeHash } from '../../packages/view/src/routes.ts';

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
    const bake = (project, out, ...flags) => JSON.parse(execFileSync(process.execPath, [bakeScript, project, '--template', template, '--out', out, ...flags], { encoding: 'utf-8' }));
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

    it('shows a placeholder, not fake content, for the section still to come (4.1)', async () => {
      const result = await smoke(goodPage, { hash: '#/semantics' });
      expect(result.ok).toBe(true);
      expect(result.dom).toContain('data-section="semantics" data-placeholder="true"');
      expect(result.dom).toContain('Available in a later slice.');
    }, 90_000);

    it('opens the graph at the member level with the CSR built lazily and at most 400 nodes (6.2)', async () => {
      const structure = await smoke(goodPage, { hash: '#/structure' });
      // The CSR is not built on the ready path.
      expect(structure.view.csr).toBe(null);
      const result = await smoke(goodPage, { hash: '#/graph' });
      expect(result).toMatchObject({ ok: true, route: 'graph' });
      expect(result.view).toMatchObject({ graphLevel: 'member', graphPath: '', graphVisibleNodes: 3, csr: 'ready', motionMode: 'animated' });
      expect(result.view.csrMs).toBeGreaterThanOrEqual(0);
      expect(result.view.graphTransform).toMatch(/^\d+\.\d{3},-?\d+\.\d,-?\d+\.\d$/);
      const dom = result.dom;
      for (const key of ['d:docs', 'd:src', 'p:package.json']) expect(dom).toContain(`data-graph-item="${key}"`);
      expect(dom).toContain('data-motion="graph" data-motion-state="animated"');
      expect(dom).toContain('data-edge-legend="calls"');
      expect(dom).toContain('data-edge-legend="other"');
      expect(dom).not.toContain('data-placeholder="true"');
    }, 90_000);

    it('pans, zooms and drills down with real mouse input, and restores a level on the way back (6.2)', async () => {
      const result = await smoke(goodPage, {
        hash: '#/graph',
        actions: [
          { type: 'drag', from: [20, 20], by: [120, 60] },
          { type: 'wheel', deltaY: -400 },
          { type: 'click', node: 'd:src' },
          { type: 'click', node: 'd:src/util' },
          { type: 'click', node: 'p:src/util/format.ts' },
          { type: 'click', node: 'function:src/util/format.ts:shout(text)' },
          { type: 'hash', hash: '#/graph' },
        ],
      });
      expect(result.ok, result.problem).toBe(true);
      const [drag, wheel, toDir, toSubdir, toFile, toSymbol, back] = result.actions;
      for (const a of result.actions) expect(a.problem, JSON.stringify(a)).toBeUndefined();
      const parse = (t) => t.split(',').map(Number);
      // A drag keeps the level and the zoom; the wheel zooms in (the pan's distance is checked below).
      expect(drag.view.graphLevel).toBe('member');
      const [k0] = parse(drag.view.graphTransform);
      const [k1] = parse(wheel.view.graphTransform);
      expect(k1).toBeGreaterThan(k0);
      expect(toDir.view).toMatchObject({ graphLevel: 'directory', graphPath: 'src', graphVisibleNodes: 3, hash: '#/graph/src' });
      expect(toSubdir.view).toMatchObject({ graphLevel: 'directory', graphPath: 'src/util', graphVisibleNodes: 1 });
      expect(toFile.view).toMatchObject({ graphLevel: 'file', graphPath: 'src/util/format.ts', graphVisibleNodes: 2 });
      expect(toSymbol.view).toMatchObject({ graphLevel: 'symbol', selectedNode: 'function:src/util/format.ts:shout(text)' });
      // Back at the member level: the viewport (and so the node positions) as left.
      expect(back.view.graphLevel).toBe('member');
      expect(back.view.graphTransform).toBe(wheel.view.graphTransform);
    }, 120_000);

    it('measures the drag against the opening viewport (instrument check for the pan)', async () => {
      // The first action changes nothing and records the opening viewport at the same window size.
      const run = await smoke(goodPage, { hash: '#/graph', actions: [{ type: 'hash', hash: '#/graph' }, { type: 'drag', from: [20, 20], by: [120, 60] }] });
      const [k0, x0, y0] = run.actions[0].view.graphTransform.split(',').map(Number);
      const [k1, x1, y1] = run.actions[1].view.graphTransform.split(',').map(Number);
      expect(k1).toBe(k0);
      expect(x1 - x0).toBeCloseTo(120, 0);
      expect(y1 - y0).toBeCloseTo(60, 0);
    }, 120_000);

    it('opens a file level from its hash with the symbols in it (6.2)', async () => {
      const result = await smoke(goodPage, { hash: '#/graph/file/src/util/format.ts' });
      expect(result.view).toMatchObject({ route: 'graph-file', graphLevel: 'file', graphVisibleNodes: 2 });
      expect(result.dom).toContain('data-graph-item="function:src/util/format.ts:formatGreeting(name,times)"');
      expect(result.dom).toContain('data-graph-note="outside"');
      const missing = await smoke(goodPage, { hash: '#/graph/nope' });
      expect(missing.ok).toBe(true);
      expect(missing.dom).toContain('data-graph-missing="nope"');
    }, 90_000);

    it('lists every edge type a class node has, with the evidence file and line (6.3)', async () => {
      const result = await smoke(goodPage, { hash: `#/node/${encodeURIComponent('class:src/counter.ts:Counter')}` });
      expect(result).toMatchObject({ ok: true, route: 'node' });
      expect(result.view).toMatchObject({ graphLevel: 'symbol', selectedNode: 'class:src/counter.ts:Counter', detailEdges: 'in:contains=1,in:exports=1', neighborhoodTotal: 2 });
      const dom = result.dom;
      expect(dom).toContain('data-edge-group="in:contains" data-total="1"');
      expect(dom).toContain('data-edge-group="in:exports" data-total="1"');
      expect(dom).toContain('data-peer="file:src/counter.ts"');
      expect(dom).toContain('src/counter.ts:1-11');
      expect(dom).toContain('data-terms="chunk"');
      expect(dom).toContain('data-terms-literals="comments" data-state="empty"');
      expect(dom).toContain('data-link="graph-file"');
    }, 90_000);

    it('keeps the graph static and marks the page static under prefers-reduced-motion (7.2)', async () => {
      const result = await smoke(goodPage, { hash: '#/graph/src', reducedMotion: true });
      expect(result.ok).toBe(true);
      expect(result.view.motionMode).toBe('static');
      expect(result.dom).toContain('data-motion="graph" data-motion-state="static"');
      expect(result.dom).toContain('data-reduced-motion="true"');
    }, 90_000);

    it('draws the structure treemap of the manifest files, sized by lines and colored by language (5.1)', async () => {
      const result = await smoke(goodPage, { hash: '#/structure' });
      expect(result).toMatchObject({ ok: true, route: 'structure' });
      expect(result.view).toMatchObject({ route: 'structure', treemapPath: '', postings: null });
      const dom = result.dom;
      expect(dom).toContain('data-dir-found="true"');
      expect(dom).toContain('data-sizing="lines"');
      expect(dom).toContain('data-cells="3"');
      expect(dom).toMatch(/data-cell="src" data-kind="dir"/);
      expect(dom).toMatch(/data-cell="package\.json" data-kind="file"[^>]*data-language="json"/);
      expect(dom).toContain('data-legend-language="typescript"');
      expect(dom).toContain('data-motion-state="animated"');
      expect(dom).not.toContain('data-structure-note=');
      expect(dom).not.toContain('data-placeholder="true"');
    }, 90_000);

    it('drills two levels into the treemap and back in one page (5.1)', async () => {
      const result = await smoke(goodPage, { hash: '#/structure', steps: ['#/dir/src', '#/dir/src/util', '#/dir/src'] });
      expect(result.ok, result.problem).toBe(true);
      expect(result.steps.map((s) => [s.settled, s.view.route, s.view.treemapPath])).toEqual([
        [true, 'dir', 'src'], [true, 'dir', 'src/util'], [true, 'dir', 'src'],
      ]);
      expect(result.dom).toContain('data-treemap-path="src"');
      expect(result.dom).toMatch(/data-cell="src\/util" data-kind="dir"/);
    }, 90_000);

    it('opens #/dir/<path> on that directory, and a file path selected with its symbols linking to their nodes (5.3)', async () => {
      const dir = await smoke(goodPage, { hash: '#/dir/src/util' });
      expect(dir).toMatchObject({ ok: true, route: 'dir' });
      expect(dir.view.treemapPath).toBe('src/util');
      expect(dir.dom).toMatch(/data-cell="src\/util\/format\.ts" data-kind="file"/);
      const greeting = nodeHash('function:src/util/format.ts:formatGreeting(name,times)');
      expect(dir.dom).toContain(`class="tm-symbol" href="${greeting}"`);
      const file = await smoke(goodPage, { hash: '#/dir/src/util/format.ts' });
      expect(file.view.treemapPath).toBe('src/util');
      expect(file.dom).toContain('data-file-panel="src/util/format.ts"');
      expect(file.dom).toContain('data-symbols="2"');
      expect(file.dom).toContain(`href="${nodeHash('function:src/util/format.ts:shout(text)')}"`);
      expect(file.dom).toMatch(/data-cell="src\/util\/format\.ts" data-kind="file" data-selected="true"/);
      const missing = await smoke(goodPage, { hash: '#/dir/src/nope' });
      expect(missing).toMatchObject({ ok: true, route: 'dir' });
      expect(missing.dom).toContain('data-dir-found="false"');
    }, 90_000);

    it('sizes the treemap by file count and says so when fingerprints.json is missing (5.1)', async () => {
      const project = copyProject();
      rmSync(join(project, '.excavator', 'fingerprints.json'));
      const page = join(scratch, 'no-fingerprints.html');
      bake(project, page);
      const result = await smoke(page, { hash: '#/structure' });
      expect(result.ok).toBe(true);
      expect(result.dom).toContain('data-sizing="files"');
      expect(result.dom).toContain('data-structure-note="sizing"');
      expect(result.dom).toContain('Sized by file count: none of the 5 files has a line count');
    }, 90_000);

    it('keeps the treemap static under prefers-reduced-motion (5.1)', async () => {
      const result = await smoke(goodPage, { hash: '#/structure', reducedMotion: true });
      expect(result.ok).toBe(true);
      expect(result.dom).toContain('data-motion-state="static"');
    }, 90_000);

    it('finds nodes by name subsequence and by identifier term, with the query in the hash (5.2)', async () => {
      const idle = await smoke(goodPage, { hash: '#/search' });
      expect(idle).toMatchObject({ ok: true, route: 'search' });
      expect(idle.view).toMatchObject({ postings: 'idle', searchQuery: null });
      const names = await smoke(goodPage, { hash: '#/search?q=frmtgrt' });
      expect(names.ok).toBe(true);
      expect(names.view).toMatchObject({ searchQuery: 'frmtgrt', searchResults: 1, searchIdentifierResults: 0, postings: 'ready', busy: null });
      expect(names.dom).toContain('data-result="function:src/util/format.ts:formatGreeting(name,times)"');
      // "increment" is only in the source index identifiers (a method with no node).
      const identifier = await smoke(goodPage, { hash: '#/search?q=increment' });
      expect(identifier.view).toMatchObject({ searchResults: 0, searchIdentifierResults: 1, postings: 'ready' });
      expect(identifier.dom).toContain('data-result="class:src/counter.ts:Counter"');
      expect(identifier.dom).toContain('data-identifier-scope="identifiers+literals"');
      expect(identifier.dom).not.toContain('data-scope-note=');
      // A term from a string literal is found while the literal text is embedded.
      expect((await smoke(goodPage, { hash: '#/search?q=hello' })).view.searchIdentifierResults).toBe(2);
    }, 90_000);

    it('marks identifier search "identifiers only" on a --no-source page (5.2)', async () => {
      const page = join(scratch, 'no-source.html');
      bake(analyzed, page, '--no-source');
      const literal = await smoke(page, { hash: '#/search?q=hello' });
      expect(literal.ok).toBe(true);
      expect(literal.view).toMatchObject({ searchIdentifierResults: 0, postings: 'ready' });
      expect(literal.dom).toContain('data-identifier-scope="identifiers"');
      expect(literal.dom).toContain('data-scope-note="identifiers-only"');
      expect(literal.dom).toContain('Identifiers only: comment and string-literal terms are not in this page');
      expect((await smoke(page, { hash: '#/search?q=increment' })).view.searchIdentifierResults).toBe(1);
    }, 90_000);

    it('says identifier search is not available when the page has no source index (5.2)', async () => {
      const project = copyProject();
      rmSync(join(project, '.excavator', 'source-index.jsonl'));
      const page = join(scratch, 'no-index.html');
      bake(project, page);
      const result = await smoke(page, { hash: '#/search?q=increment' });
      expect(result.ok).toBe(true);
      expect(result.view).toMatchObject({ postings: 'unavailable', searchResults: 0, searchIdentifierResults: null });
      expect(result.dom).toContain('data-identifier-search="unavailable"');
      expect(result.dom).toContain('Identifier search not available');
    }, 90_000);

    // Task 4A.4: the smoke run closes Chrome over the DevTools protocol before
    // falling back to SIGKILL, so Chrome removes its own temporary
    // directories (a killed Chrome leaves its com.google.Chrome.* singleton
    // directory behind). The script reports which singleton directory this
    // run used (from the SingletonSocket link in the user data dir), so the
    // check looks at exactly that directory, never at the shared temp dir.
    it('closes Chrome over the protocol and leaves neither its singleton directory nor the profile (4A.4)', async () => {
      const result = await smoke(goodPage);
      expect(result.ok).toBe(true);
      expect(result.chrome.exit).toBe('closed');
      expect(result.chrome.singletonDir).toMatch(/com\.google\.Chrome\.[^/]+$/);
      expect(existsSync(result.chrome.singletonDir)).toBe(false);
      expect(result.chrome.profile).toMatch(/excavator-view-smoke-/);
      expect(existsSync(result.chrome.profile)).toBe(false);
    }, 90_000);

    it('reports prefers-reduced-motion when asked to emulate it', () => {
      const { status, result } = runSmoke(goodPage, '--reduced-motion');
      expect(status).toBe(0);
      expect(result.reducedMotion).toBe(true);
      expect(runSmoke(goodPage).result.reducedMotion).toBe(false);
    }, 90_000);
  });
}
