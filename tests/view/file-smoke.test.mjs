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
import { makeSemanticProject, SEMANTIC_IDS } from './fixtures/make-semantic-project.mjs';

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
    let semanticPage;
    let semanticNodes;
    let semanticDataDir;

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

    // Tasks 8.1-8.3: a page baked from the sample project with all three
    // semantic products written by their real writers.
    beforeAll(async () => {
      const made = await makeSemanticProject(join(scratch, 'semantic-project'));
      semanticPage = join(scratch, 'semantic.html');
      semanticNodes = bake(made.project, semanticPage).counts.header.nodes;
      semanticDataDir = made.dataDir;
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

    it('says "Not generated" for every semantic product on a Lazy-only page, never a placeholder (8.1-8.3)', async () => {
      const result = await smoke(goodPage, { hash: '#/semantics' });
      expect(result).toMatchObject({ ok: true, route: 'semantics' });
      expect(result.view.semantics).toEqual({ summaries: 'not-generated', layers: 'not-generated', domain: 'not-generated' });
      expect(result.dom.match(/data-product-state="not-generated"/g)).toHaveLength(3);
      expect(result.dom).not.toContain('data-placeholder="true"');
    }, 90_000);

    it('shows summaries, stale layers and a fresh two-step flow with one unanchored id (8.1-8.3)', async () => {
      const result = await smoke(semanticPage, { hash: '#/semantics' });
      expect(result).toMatchObject({ ok: true, route: 'semantics' });
      expect(result.view.semantics).toEqual({
        summaries: `2/${semanticNodes}`, summariesFresh: '1', summariesStale: '1',
        layers: '2', layersFreshness: 'stale', relations: '1',
        domain: 'fresh', flows: '1', steps: '2', unanchored: '1',
      });
      const dom = result.dom;
      expect(dom).toContain(`data-summary-entry="${SEMANTIC_IDS.fresh}" data-freshness="fresh"`);
      expect(dom).toContain(`data-summary-entry="${SEMANTIC_IDS.stale}" data-freshness="stale"`);
      expect(dom).toContain('data-semantics-block="layers" data-stale="true"');
      expect(dom).toContain('data-hint="layers-stale"');
      expect(dom).toContain('data-layer="layer:entry" data-layer-nodes="2"');
      expect(dom).toContain('data-layer="layer:support" data-layer-nodes="4"');
      expect(dom).toContain('data-domain-freshness="fresh"');
      // Steps in flow_step order, and the id the graph lacks labelled, not guessed.
      expect(dom.indexOf('data-step-id="step:greet-user:count-visit"')).toBeLessThan(dom.indexOf('data-step-id="step:greet-user:format-greeting"'));
      expect(dom.match(/data-anchor="unanchored"/g)).toHaveLength(1);
      expect(dom).toContain(SEMANTIC_IDS.missingAnchor);
    }, 90_000);

    it('plays the flow steps in order, then jumps from a step to its anchored node (8.3)', async () => {
      const result = await smoke(semanticPage, {
        hash: '#/semantics',
        actions: [
          { type: 'click', selector: '[data-flow-play="flow:greet-user"]' },
          { type: 'click', selector: '[data-step-locate="step:greet-user:format-greeting"]' },
        ],
      });
      expect(result.ok, result.problem).toBe(true);
      const [play, locate] = result.actions;
      for (const a of result.actions) expect(a.problem, JSON.stringify(a)).toBeUndefined();
      // Playback ran to the last step and stopped.
      expect(play.view.semantics).toMatchObject({ flow: 'flow:greet-user', step: '2' });
      expect(play.view.semantics.playing).toBeUndefined();
      expect(play.view.hash).toBe('#/semantics?flow=flow%3Agreet-user&step=2');
      expect(locate.view).toMatchObject({ route: 'node', selectedNode: SEMANTIC_IDS.stale });
      expect(locate.view.semantics).toMatchObject({ nodeSummary: 'stale', nodeLayers: 'Support' });
    }, 120_000);

    it('only highlights the current step under prefers-reduced-motion (8.3)', async () => {
      const result = await smoke(semanticPage, {
        hash: '#/semantics',
        reducedMotion: true,
        actions: [{ type: 'click', selector: '[data-flow-play="flow:greet-user"]' }],
      });
      expect(result.ok, result.problem).toBe(true);
      expect(result.actions[0].view.semantics).toMatchObject({ flow: 'flow:greet-user', step: '1' });
      expect(result.dom).toContain('data-motion="flow" data-motion-state="static"');
      expect(result.dom).toContain('data-step-id="step:greet-user:count-visit" data-step-order="1" data-current="true"');
      expect(result.dom).toContain('data-step-id="step:greet-user:format-greeting" data-step-order="2" data-current="false"');
    }, 90_000);

    it('shows a node\'s summary with its freshness and its layer, and colors the neighborhood by layer (8.1, 8.2)', async () => {
      const result = await smoke(semanticPage, {
        hash: nodeHash(SEMANTIC_IDS.fresh),
        actions: [{ type: 'click', selector: '[data-layer-toggle]' }],
      });
      expect(result.ok, result.problem).toBe(true);
      expect(result.view.semantics).toEqual({ nodeSummary: 'fresh', nodeLayers: 'Entry' });
      const dom = result.dom;
      expect(dom).toContain('data-node-summary="fresh"');
      expect(dom).toContain('Builds a counter, increments it once and formats the greeting for the given name.');
      expect(dom).toContain('data-layer-legend="on" data-layer-stale="true"');
      expect(Number(/data-canvas-colored="(\d+)"/.exec(dom)[1])).toBeGreaterThan(0);
      const plain = await smoke(semanticPage, { hash: nodeHash(SEMANTIC_IDS.unsummarized) });
      expect(plain.view.semantics).toEqual({ nodeSummary: 'none', nodeLayers: 'Support' });
      expect(plain.dom).toContain('data-layer-legend="off"');
      expect(plain.dom).toContain('data-canvas-colored="0"');
    }, 120_000);

    it('colors the file level by layer with unlayered symbols counted in the legend (8.2)', async () => {
      const result = await smoke(semanticPage, {
        hash: '#/graph/file/src/util/format.ts',
        actions: [{ type: 'click', selector: '[data-layer-toggle]' }],
      });
      expect(result.ok, result.problem).toBe(true);
      const dom = result.dom;
      expect(result.actions[0].view.graphVisibleNodes).toBe(3);
      expect(dom).toContain('data-canvas-colored="3"');
      expect(dom).toContain('data-layer-swatch="layer:support" data-layer-drawn="2"');
      expect(dom).toContain('data-layer-swatch="unlayered" data-layer-drawn="1"');
    }, 90_000);

    // Task 9.2: opening a local .excavator directory. The directory picker is
    // given the directory (DOM.setFileInputFiles), as a user's choice would.

    it('offers a directory picker on the unbaked template, and at #/open on a baked page (9.2)', async () => {
      const empty = await smoke(template);
      expect(empty.state).toBe('empty');
      expect(empty.dom).toMatch(/<input type="file" data-drop-input="" webkitdirectory="" directory="" multiple="">/);
      expect(empty.dom).toContain('data-drop-note="local"');
      expect(empty.dom).toContain('never leave it');
      const open = await smoke(goodPage, { hash: '#/open' });
      expect(open).toMatchObject({ ok: true, route: 'open' });
      expect(open.dom).toContain('data-drop-input=""');
      expect(open.dom).toContain('data-nav="open"');
      // Opening a directory from there replaces the embedded data and lands on its overview.
      const replaced = await smoke(goodPage, { hash: '#/open', actions: [{ type: 'files', selector: '[data-drop-input]', paths: [semanticDataDir] }] });
      expect(replaced.actions[0].view).toMatchObject({ origin: 'drop', dropState: 'loaded', route: 'overview', hash: '#/overview' });
      expect(replaced.counts.nodes).toBe(semanticNodes);
      expect(replaced.dom).toContain('data-origin="drop"');
      expect(replaced.dom).toContain('evidenceText</span>: dropped (loaded from a dropped directory)');
    }, 120_000);

    it('reads a picked directory in the page with source text not embedded (9.1, 9.2)', async () => {
      const result = await smoke(template, {
        actions: [
          { type: 'files', selector: '[data-drop-input]', paths: [semanticDataDir] },
          { type: 'hash', hash: '#/semantics' },
          { type: 'hash', hash: nodeHash(SEMANTIC_IDS.fresh) },
        ],
      });
      expect(result.problem).toBeUndefined();
      const [loaded, semantics, node] = result.actions;
      expect(loaded.view).toMatchObject({ origin: 'drop', dropState: 'loaded', route: 'overview' });
      expect(result).toMatchObject({ ready: true, errors: 0, cspViolations: 0, countsMatchHeader: true, decodeMode: 'worker' });
      expect(result.counts.nodes).toBe(semanticNodes);
      expect(semantics.view.semantics).toMatchObject({ summaries: `2/${semanticNodes}`, layersFreshness: 'stale', domain: 'fresh', unanchored: '1' });
      expect(node.view.semantics).toMatchObject({ nodeSummary: 'fresh', nodeLayers: 'Entry' });
      expect(result.dom).toContain('data-source="not-embedded" data-source-reason="drop-mode"');
    }, 120_000);

    it('shows a visible error for a picked directory with a truncated graph (9.1)', async () => {
      const dir = join(mkdtempSync(join(scratch, 'truncated-drop-')), '.excavator');
      cpSync(semanticDataDir, dir, { recursive: true });
      const graph = join(dir, 'knowledge-graph.jsonl');
      const text = readFileSync(graph, 'utf-8');
      writeFileSync(graph, text.slice(0, Math.floor(text.length * 0.6)));
      const result = await smoke(template, { actions: [{ type: 'files', selector: '[data-drop-input]', paths: [dir] }] });
      expect(result.state).toBe('empty');
      expect(result.actions[0].view.dropState).toBe('error');
      expect(result.errors).toBeGreaterThan(0);
      expect(result.dom).toMatch(/data-drop-error="">Could not read this directory\. KnowledgeGraphFormatError: \.excavator\/knowledge-graph\.jsonl: /);
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

    it('lists every edge type a class node has, with evidence lines highlighted (6.3, 7.1)', async () => {
      const result = await smoke(goodPage, { hash: `#/node/${encodeURIComponent('class:src/counter.ts:Counter')}` });
      expect(result).toMatchObject({ ok: true, route: 'node' });
      expect(result.view).toMatchObject({ graphLevel: 'symbol', selectedNode: 'class:src/counter.ts:Counter', detailEdges: 'in:contains=1,in:exports=1', neighborhoodTotal: 2 });
      const dom = result.dom;
      expect(dom).toContain('data-edge-group="in:contains" data-total="1"');
      expect(dom).toContain('data-edge-group="in:exports" data-total="1"');
      expect(dom).toContain('data-peer="file:src/counter.ts"');
      expect(dom).toContain('src/counter.ts:1-11');
      // The evidence line, monospaced with its number, highlighted.
      expect(dom).toMatch(/<span class="code-line" data-line="1" data-highlight="true"><span class="ln">1<\/span><span class="lt">export class Counter \{<\/span>/);
      // The excerpt: the class's 11 lines.
      expect(dom).toMatch(/data-source="embedded" data-source-lines="11"/);
      expect(dom).toContain('data-terms="chunk"');
      expect(dom).toContain('data-terms-literals="comments" data-state="empty"');
      expect(dom).toContain('data-link="graph-file"');
    }, 90_000);

    it('highlights a function\'s own call evidence inside its excerpt (7.1)', async () => {
      const result = await smoke(goodPage, { hash: `#/node/${encodeURIComponent('function:src/main.ts:run(name)')}` });
      expect(result.view.detailEdges).toBe('out:calls=1,in:contains=1,in:exports=1');
      expect(result.dom).toMatch(/data-source="embedded" data-source-lines="5" data-highlighted="1"/);
      expect(result.dom).toContain('<span class="code-line" data-line="7" data-highlight="true"><span class="ln">7</span><span class="lt">  return formatGreeting(name, counter.value());</span>');
    }, 90_000);

    it('says "Source not embedded" with the --no-source reason, and literals not embedded (7.1)', async () => {
      const page = join(scratch, 'no-source-detail.html');
      bake(analyzed, page, '--no-source');
      const result = await smoke(page, { hash: `#/node/${encodeURIComponent('function:src/main.ts:run(name)')}` });
      expect(result.ok).toBe(true);
      const dom = result.dom;
      expect(dom).toContain('data-source="not-embedded" data-source-reason="no-source"');
      expect(dom).toContain('Source not embedded: this page was baked with --no-source.');
      expect(dom).not.toContain('data-source="embedded"');
      expect(dom).toContain('src/main.ts:7');
      expect(dom).toContain('data-terms-literals="comments" data-state="not-embedded"');
    }, 90_000);

    it('names the source budget when the excerpts were dropped to fit it (7.1)', async () => {
      const page = join(scratch, 'budget-0.html');
      bake(analyzed, page, '--source-budget', '0');
      const result = await smoke(page, { hash: `#/node/${encodeURIComponent('function:src/main.ts:run(name)')}` });
      expect(result.ok).toBe(true);
      expect(result.dom).toContain('data-source="not-embedded" data-source-reason="budget"');
      expect(result.dom).toContain('were dropped to fit the source budget');
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
