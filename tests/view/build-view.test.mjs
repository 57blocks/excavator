// artifact-view tasks 3.1-3.6: the streaming view bake. Every scenario runs
// against a purpose-built synthetic project (tests/view/fixtures/sample-
// project, copied to a temp dir) whose `.excavator/` products are produced by
// really running `lazy-analyze.mjs` on it. The bake itself runs through its
// CLI where the behavior is CLI-visible; the hard size limit is injected
// through the programmatic entry point.
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import {
  appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

import { decodeBundle, encodeBundle, table } from '../../skills/excavator-view/bundle-codec.mjs';
import { buildView, selfCheck } from '../../skills/excavator-view/build-view.mjs';
import { extractBundleText, pageProblems } from '../../skills/excavator-view/bake/html-output.mjs';
import { ViewSelfCheckError, ViewTooLargeError } from '../../skills/excavator-view/bake/errors.mjs';
import { commitSemanticCacheEntry } from '../../skills/excavator/semantic-cache.mjs';
import { isDomainGraphUsable } from '../../skills/excavator-domain/domain-freshness.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureProject = join(repoRoot, 'tests/view/fixtures/sample-project');
const lazyScript = join(repoRoot, 'skills/excavator/lazy-analyze.mjs');
const bakeScript = join(repoRoot, 'skills/excavator-view/build-view.mjs');
const MARKER = 'VIEW_FIXTURE_MARKER_d41c7e';

/** A minimal template that passes the same guards as the real one; keeps
 *  these tests independent of a concurrent `vite build` of the real dist. */
const TEMPLATE_HTML = [
  '<!doctype html><html><head>',
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; '
    + 'style-src \'unsafe-inline\'; img-src data:; worker-src blob:; connect-src \'none\'">',
  '<title>view test template</title></head><body><div id="root"></div>',
  '<script type="text/plain" id="excavator-view-data"></script>',
  '<script type="module">document.getElementById("root").dataset.ok = "1";</script>',
  '</body></html>',
].join('\n');

const scratch = mkdtempSync(join(tmpdir(), 'excavator-view-bake-'));
const templatePath = join(scratch, 'template.html');
let analyzed; // a project copy with Lazy products, never mutated

function copyProject(from = analyzed) {
  const dir = mkdtempSync(join(scratch, 'project-'));
  cpSync(from, dir, { recursive: true });
  return dir;
}

function bake(project, ...flags) {
  const result = spawnSync(process.execPath, [bakeScript, project, '--template', templatePath, ...flags], { encoding: 'utf-8' });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    report: result.status === 0 ? JSON.parse(result.stdout) : null,
  };
}

async function decodePage(path) {
  return (await decodeBundle(extractBundleText(readFileSync(path, 'utf-8')))).segments;
}

/** Every string any decoded segment carries (to search for the marker). */
function decodedText(segments) {
  return JSON.stringify(segments, (_key, value) => (value instanceof Int32Array ? Array.from(value) : value));
}

/** Only the embedded source text (evidence lines and excerpts). */
function sourceText(segments) {
  return JSON.stringify([segments['evidenceText.strings'] ?? [], segments['excerpts.strings'] ?? []]);
}

function lazyAnalyze(project) {
  execFileSync(process.execPath, [lazyScript, project], { stdio: 'pipe' });
}

function viewPath(project) {
  return join(project, '.excavator', 'view.html');
}

function leftoverTemps(project) {
  return readdirSync(join(project, '.excavator')).filter((name) => name.includes('.tmp-'));
}

beforeAll(() => {
  writeFileSync(templatePath, TEMPLATE_HTML);
  analyzed = join(scratch, 'analyzed');
  cpSync(fixtureProject, analyzed, { recursive: true });
  lazyAnalyze(analyzed);
}, 120_000);

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('inventory (3.1)', () => {
  it('fails with MissingArtifactError and writes nothing when the graph is missing', () => {
    const project = copyProject();
    rmSync(join(project, '.excavator', 'knowledge-graph.jsonl'));
    const result = bake(project);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/MissingArtifactError: knowledge-graph\.jsonl/);
    expect(result.stderr).toMatch(/run \/excavator first/);
    expect(existsSync(viewPath(project))).toBe(false);
  });

  it('fails with MissingArtifactError when the source manifest is missing', () => {
    const project = copyProject();
    rmSync(join(project, '.excavator', 'source-manifest.json'));
    const result = bake(project);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/MissingArtifactError: source-manifest\.json/);
    expect(existsSync(viewPath(project))).toBe(false);
  });

  it('leaves an existing view byte-identical when the source manifest is missing', () => {
    const project = copyProject();
    expect(bake(project).status).toBe(0);
    const before = readFileSync(viewPath(project));
    rmSync(join(project, '.excavator', 'source-manifest.json'));
    const result = bake(project);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/MissingArtifactError: source-manifest\.json/);
    expect(readFileSync(viewPath(project)).equals(before)).toBe(true);
    expect(leftoverTemps(project)).toEqual([]);
  });

  it('bakes with every optional artifact missing and marks each one missing with its hint', async () => {
    const project = copyProject();
    rmSync(join(project, '.excavator', 'fingerprints.json'));
    rmSync(join(project, '.excavator', 'source-index.jsonl'));
    const { status, report, stderr } = bake(project);
    expect(status, stderr).toBe(0);
    const byName = Object.fromEntries(report.inventory.map((i) => [i.name, i]));
    for (const name of ['fingerprints.json', 'source-index.jsonl', 'semantic-cache.json', 'semantic-graph.json', 'domain-graph.json']) {
      expect(byName[name].status, name).toBe('missing');
      expect(byName[name].missing, name).toBeTruthy();
    }
    expect(byName['semantic-cache.json'].missing).toMatch(/\/excavator --mode=full/);
    expect(byName['domain-graph.json'].missing).toMatch(/\/excavator-domain/);
    const segments = await decodePage(viewPath(project));
    expect(Object.keys(segments).filter((name) => name.startsWith('index.'))).toEqual([]);
    expect(Array.from(segments.files.columns.totalLines).every((n) => n === -1)).toBe(true);
    expect(segments.meta.inventory.find((i) => i.name === 'fingerprints.json').status).toBe('missing');
  });

  it('takes each file\'s totalLines from fingerprints, and marks malformed fingerprints invalid', async () => {
    const project = copyProject();
    const fpPath = join(project, '.excavator', 'fingerprints.json');
    const fingerprints = JSON.parse(readFileSync(fpPath, 'utf-8'));
    const good = bake(project);
    expect(good.status, good.stderr).toBe(0);
    const segments = await decodePage(viewPath(project));
    const { path, totalLines } = segments.files.columns;
    const baked = Object.fromEntries(Array.from(path, (cell, row) => [segments.strings[cell], totalLines[row]]));
    const expected = Object.fromEntries(Object.entries(fingerprints.files).map(([p, fp]) => [p, fp.totalLines]));
    expect(Object.keys(baked).length).toBeGreaterThan(0);
    expect(baked).toEqual(expected);
    writeFileSync(fpPath, readFileSync(fpPath, 'utf-8').replace(/"totalLines": ?(\d+)/, '"totalLines": 0$1'));
    const bad = bake(project);
    expect(bad.status, bad.stderr).toBe(0);
    const item = bad.report.inventory.find((i) => i.name === 'fingerprints.json');
    expect(item.status).toBe('invalid');
    expect(item.reason).toMatch(/not valid JSON/);
    const after = await decodePage(viewPath(project));
    expect(Array.from(after.files.columns.totalLines).every((n) => n === -1)).toBe(true);
  });

  it('marks an unreadable optional artifact invalid instead of passing off an empty section', async () => {
    const project = copyProject();
    writeFileSync(join(project, '.excavator', 'source-index.jsonl'), '{"record":"header","format":"something-else"}\n');
    const { status, report } = bake(project);
    expect(status).toBe(0);
    const index = report.inventory.find((i) => i.name === 'source-index.jsonl');
    expect(index.status).toBe('invalid');
    expect(index.reason).toMatch(/header/);
    const segments = await decodePage(viewPath(project));
    expect(Object.keys(segments).some((name) => name.startsWith('index.'))).toBe(false);
  });
});

describe('streaming graph read (3.2)', () => {
  it('embeds every node, edge, evidence item and gap with the header counts', async () => {
    const project = copyProject();
    const { status, report } = bake(project);
    expect(status).toBe(0);
    const header = JSON.parse(readFileSync(join(project, '.excavator', 'knowledge-graph.jsonl'), 'utf-8').split('\n')[0]);
    expect(report.counts.header).toEqual(header.counts);
    expect(report.counts.decoded.nodes).toBe(header.counts.nodes);
    expect(report.counts.decoded.edges).toBe(header.counts.edges);
    expect(report.counts.decoded.gaps).toBe(header.counts.gaps);
    const segments = await decodePage(viewPath(project));
    expect(segments.nodes.rows).toBe(header.counts.nodes);
    expect(segments.edges.rows).toBe(header.counts.edges);
    expect(segments.gaps).toHaveLength(header.counts.gaps);
    expect(segments.coverage).toBeTruthy();
    const ids = Array.from(segments.nodes.columns.id, (cell) => segments.strings[cell]);
    expect(ids).toContain('function:src/main.ts:run(name)');
    expect(segments.meta.unembedded).toEqual({ node: {}, edge: {}, evidence: {} });
  });

  it('fails a truncated graph with KnowledgeGraphFormatError and leaves an existing view byte-identical', () => {
    const project = copyProject();
    const graphPath = join(project, '.excavator', 'knowledge-graph.jsonl');
    expect(bake(project).status).toBe(0);
    const before = readFileSync(viewPath(project));
    const lines = readFileSync(graphPath, 'utf-8').trimEnd().split('\n');
    const lastNode = lines.findLastIndex((line) => line.startsWith('{"record":"node"'));
    writeFileSync(graphPath, `${lines.filter((_, i) => i !== lastNode).join('\n')}\n`);
    const result = bake(project);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/KnowledgeGraphFormatError/);
    expect(result.stderr).toMatch(/nodes count mismatch: header declares \d+, found \d+/);
    expect(readFileSync(viewPath(project)).equals(before)).toBe(true);
    expect(leftoverTemps(project)).toEqual([]);
  });

  it('decodes --raw and compressed output to the same data', async () => {
    const project = copyProject();
    // Outputs go outside the project: a new file inside a directory target
    // would change its sourceRevision between the two bakes.
    const out = mkdtempSync(join(scratch, 'out-'));
    const gz = bake(project, '--out', join(out, 'gz.html'));
    const raw = bake(project, '--out', join(out, 'raw.html'), '--raw');
    expect(gz.status).toBe(0);
    expect(raw.status).toBe(0);
    expect(gz.report.compressed).toBe(true);
    expect(raw.report.compressed).toBe(false);
    const a = await decodePage(join(out, 'gz.html'));
    const b = await decodePage(join(out, 'raw.html'));
    delete a.meta.bakedAt;
    delete b.meta.bakedAt;
    expect(b).toEqual(a);
    expect(statSync(join(out, 'raw.html')).size).toBeGreaterThan(statSync(join(out, 'gz.html')).size);
  });

  it('records the members of a multi-repo target by first path segment', async () => {
    const root = mkdtempSync(join(scratch, 'multi-'));
    for (const member of ['alpha', 'beta']) {
      const dir = join(root, member);
      cpSync(join(fixtureProject, 'src'), join(dir, 'src'), { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['add', '-A'], { cwd: dir });
      execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir });
    }
    lazyAnalyze(root);
    const { status, report, stderr } = bake(root);
    expect(status, stderr).toBe(0);
    expect(report.source.sourceRevision).toMatch(/^multi-repo:/);
    const { meta } = await decodePage(viewPath(root));
    expect(meta.members).toEqual([{ name: 'alpha', files: 3, selected: 3 }, { name: 'beta', files: 3, selected: 3 }]);
  }, 60_000);

  it('judges semantic products per item with their owners\' rules', async () => {
    const project = copyProject();
    const dataDir = join(project, '.excavator');
    const manifest = JSON.parse(readFileSync(join(dataDir, 'source-manifest.json'), 'utf-8'));
    const hashOf = (path) => manifest.entries.find((e) => e.path === path).contentHash;
    const fields = (path, summary) => ({ summary, tags: ['t'], semanticSourceHash: hashOf(path), model: 'test', generatedAt: '2024-01-01T00:00:00.000Z' });
    expect((await commitSemanticCacheEntry({ projectRoot: project, nodeId: 'function:src/main.ts:run(name)', filePath: 'src/main.ts', fields: fields('src/main.ts', 'Runs the greeting.') })).ok).toBe(true);
    expect((await commitSemanticCacheEntry({ projectRoot: project, nodeId: 'class:src/counter.ts:Counter', filePath: 'src/counter.ts', fields: fields('src/counter.ts', 'Counts calls.') })).ok).toBe(true);
    // Age one entry: its hash no longer matches the manifest.
    const cachePath = join(dataDir, 'semantic-cache.json');
    const cache = JSON.parse(readFileSync(cachePath, 'utf-8'));
    cache.entries['class:src/counter.ts:Counter'].semanticSourceHash = '0'.repeat(64);
    writeFileSync(cachePath, JSON.stringify(cache));
    writeFileSync(join(dataDir, 'semantic-graph.json'), JSON.stringify({ factDigest: 'not-the-current-digest', layers: [{ id: 'l1', name: 'Core', nodeIds: [] }], relations: [] }));
    const domainGraph = { version: '1', kind: 'domain', nodes: [], edges: [], sourceRevision: manifest.sourceRevision, factDigest: 'x' };
    writeFileSync(join(dataDir, 'domain-graph.json'), JSON.stringify(domainGraph));

    const { status, report, stderr } = bake(project);
    expect(status, stderr).toBe(0);
    expect(report.freshness.semanticCache).toMatchObject({ entries: 2, fresh: 1, stale: 1 });
    expect(report.freshness.semanticGraph).toEqual({ freshness: 'stale', layers: 1 });
    const header = JSON.parse(readFileSync(join(dataDir, 'knowledge-graph.jsonl'), 'utf-8').split('\n')[0]);
    const expectedDomain = isDomainGraphUsable({
      domainGraph, currentSourceRevision: manifest.sourceRevision, currentFactDigest: header.fields.project.factsDigest,
    });
    expect(report.freshness.domainGraph).toEqual({ freshness: expectedDomain.status, reason: expectedDomain.reason });
    const segments = await decodePage(viewPath(project));
    const byNode = Object.fromEntries(segments.semantic.entries.map((e) => [e.nodeId, e.freshness]));
    expect(byNode).toEqual({ 'function:src/main.ts:run(name)': 'fresh', 'class:src/counter.ts:Counter': 'stale' });
    expect(segments.layers.freshness).toBe('stale');
    expect(segments.domain.freshness).toBe(expectedDomain.status);

    writeFileSync(join(dataDir, 'semantic-graph.json'), JSON.stringify({ factDigest: header.fields.project.factsDigest, layers: [], relations: [] }));
    expect(bake(project).report.freshness.semanticGraph.freshness).toBe('fresh');
  });
});

describe('source text (3.3)', () => {
  it('embeds evidence lines and node excerpts by default, including the marker line', async () => {
    const project = copyProject();
    const { report } = bake(project);
    expect(report.embeds).toEqual([
      { segment: 'evidenceText', status: 'embedded' },
      { segment: 'excerpts', status: 'embedded' },
      { segment: 'indexLiterals', status: 'embedded' },
    ]);
    expect(report.source.embedding).toMatchObject({ filesHashMismatch: 0, filesNotInManifest: 0, filesUnreadable: 0 });
    const segments = await decodePage(viewPath(project));
    const strings = segments.strings;
    const row = Array.from(segments.nodes.columns.id).findIndex((cell) => strings[cell] === 'function:src/util/format.ts:formatGreeting(name,times)');
    const excerpt = segments['excerpts.strings'][segments.excerpts.columns.text[row]];
    expect(excerpt.split('\n')[0]).toBe('export function formatGreeting(name: string, times: number): string {');
    expect(excerpt).toContain(MARKER);
    const callEdge = Array.from(segments.edges.columns.type).findIndex((cell) => strings[cell] === 'calls');
    const evRow = segments.edges.columns.evOffset[callEdge];
    expect(segments['evidenceText.strings'][segments.evidenceText.columns.text[evRow]]).toBe('  return formatGreeting(name, counter.value());');
  });

  it('embeds index literals in their own segment, round-tripping every chunk\'s comments and strings, and no postings', async () => {
    const project = copyProject();
    const { status, report, stderr } = bake(project);
    expect(status, stderr).toBe(0);
    const segments = await decodePage(viewPath(project));
    expect(Object.keys(segments).filter((name) => name.startsWith('index'))).toEqual([
      'index.chunks', 'index.tokens', 'indexLiterals.strings', 'indexLiterals',
    ]);
    expect(segments.meta.index.literals).toBe('embedded');
    // The literal text is not in the global string table.
    expect(segments.strings).not.toContain(MARKER);
    const chunks = readFileSync(join(project, '.excavator', 'source-index.jsonl'), 'utf-8').trimEnd().split('\n')
      .map((line) => JSON.parse(line)).filter((r) => r.record === 'chunk').map((r) => r.chunk);
    const t = segments['index.chunks'].columns;
    const texts = segments['indexLiterals.strings'];
    const cells = segments.indexLiterals.columns.text;
    const list = (offset, count) => Array.from(cells.subarray(offset, offset + count), (cell) => texts[cell]);
    expect(segments['index.chunks'].rows).toBe(chunks.length);
    chunks.forEach((chunk, row) => {
      expect(segments.strings[t.node[row]]).toBe(chunk.nodeId);
      expect(list(t.commentOffset[row], t.commentCount[row])).toEqual(chunk.comments);
      expect(list(t.stringOffset[row], t.stringCount[row])).toEqual(chunk.strings);
    });
    expect(texts).toContain(MARKER);
  });

  it('--no-source embeds no source text at all', async () => {
    const project = copyProject();
    const { status, report } = bake(project, '--no-source');
    expect(status).toBe(0);
    expect(report.dropped).toEqual([
      { segment: 'excerpts', reason: 'no-source', bytes: 0 },
      { segment: 'indexLiterals', reason: 'no-source', bytes: 0 },
      { segment: 'evidenceText', reason: 'no-source', bytes: 0 },
    ]);
    const segments = await decodePage(viewPath(project));
    expect(decodedText(segments)).not.toContain(MARKER);
    expect(decodedText(segments)).not.toContain('counter.value()');
    expect(Object.keys(segments).filter((name) => /^(evidenceText|excerpts|indexLiterals)/.test(name))).toEqual([]);
    expect(segments.evidence.rows).toBeGreaterThan(0);
    expect(readFileSync(viewPath(project), 'utf-8')).not.toContain(MARKER);
    // Comment and string-literal text from the source index is source text too.
    expect(segments.meta.index.literals).toBe('omitted');
    const { commentCount, stringCount } = segments['index.chunks'].columns;
    expect([...commentCount, ...stringCount].every((n) => n === -1)).toBe(true);
  });

  it('does not embed a file whose content no longer matches the manifest, and counts it', async () => {
    const project = copyProject();
    appendFileSync(join(project, 'src/util/format.ts'), '\n// edited after analysis\n');
    const { status, report } = bake(project);
    expect(status).toBe(0);
    expect(report.source.embedding.filesHashMismatch).toBe(1);
    expect(report.source.embedding.hashMismatchSamples).toEqual(['src/util/format.ts']);
    expect(report.source.embedding.filesEmbedded).toBe(report.source.embedding.filesCited - 1);
    const segments = await decodePage(viewPath(project));
    expect(sourceText(segments)).not.toContain(MARKER);
    expect(sourceText(segments)).toContain('counter.increment();');
  });
});

describe('source text: untrusted paths', () => {
  it('never reads a cited path that escapes the snapshot, even when the manifest lists it', async () => {
    const project = copyProject();
    const secretText = 'SECRET_OUTSIDE_PROJECT_5e1f';
    // The snapshot is materialized into a fresh directory under the system
    // temp dir, so '../<name>' from there lands in the temp dir itself: plant
    // the file exactly where an unguarded read would find it.
    const secretName = `excavator-view-secret-${process.pid}-${Date.now()}.txt`;
    const secretPath = join(tmpdir(), secretName);
    writeFileSync(secretPath, `${secretText}\n`);
    onTestFinished(() => rmSync(secretPath, { force: true }));
    const dataDir = join(project, '.excavator');
    const graphPath = join(dataDir, 'knowledge-graph.jsonl');
    const lines = readFileSync(graphPath, 'utf-8').trimEnd().split('\n');
    const edgeLine = lines.findIndex((line) => line.startsWith('{"record":"edge"'));
    const edge = JSON.parse(lines[edgeLine]);
    edge.edge.evidence[0].file = `../${secretName}`;
    edge.edge.evidence[0].line = 1;
    lines[edgeLine] = JSON.stringify(edge);
    writeFileSync(graphPath, `${lines.join('\n')}\n`);
    const manifestPath = join(dataDir, 'source-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const { createHash } = await import('node:crypto');
    manifest.entries.push({ path: `../${secretName}`, contentHash: createHash('sha256').update(`${secretText}\n`).digest('hex') });
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const { status, report, stderr } = bake(project);
    expect(status, stderr).toBe(0);
    expect(report.source.embedding.filesUnreadable).toBe(1);
    const segments = await decodePage(viewPath(project));
    expect(sourceText(segments)).not.toContain(secretText);
  });
});

describe('budget and hard limit (3.4)', () => {
  it('--source-budget 0 drops excerpts, then index literals, then evidenceText and keeps the graph complete', async () => {
    const project = copyProject();
    const { status, report } = bake(project, '--source-budget', '0');
    expect(status).toBe(0);
    expect(report.dropped.map((d) => [d.segment, d.reason])).toEqual([
      ['excerpts', 'budget'], ['indexLiterals', 'budget'], ['evidenceText', 'budget'],
    ]);
    expect(report.dropped.every((d) => d.bytes > 0)).toBe(true);
    expect(report.counts.decoded).toMatchObject({
      nodes: report.counts.header.nodes, edges: report.counts.header.edges, gaps: report.counts.header.gaps,
    });
    const segments = await decodePage(viewPath(project));
    expect(segments.meta.embeds).toEqual([
      { segment: 'evidenceText', status: 'dropped', reason: 'budget' },
      { segment: 'excerpts', status: 'dropped', reason: 'budget' },
      { segment: 'indexLiterals', status: 'dropped', reason: 'budget' },
    ]);
    expect(Object.keys(segments).filter((name) => /^(evidenceText|excerpts|indexLiterals)/.test(name))).toEqual([]);
    // Literal text is source text: nothing of it survives in the global string table.
    expect(decodedText(segments)).not.toContain(MARKER);
    expect(segments.meta.index.literals).toBe('trimmed');
    const { commentOffset, commentCount, stringOffset, stringCount } = segments['index.chunks'].columns;
    expect([...commentOffset, ...commentCount, ...stringOffset, ...stringCount].every((n) => n === -1)).toBe(true);
  });

  it('--source-budget 0 output carries no more than --no-source plus the graph segments', async () => {
    const project = copyProject();
    const out = mkdtempSync(join(scratch, 'out-'));
    const zero = bake(project, '--out', join(out, 'zero.html'), '--source-budget', '0');
    const none = bake(project, '--out', join(out, 'none.html'), '--no-source');
    expect(zero.status, zero.stderr).toBe(0);
    expect(none.status, none.stderr).toBe(0);
    const sizes = (report) => Object.fromEntries(report.segments.map((s) => [s.name, s]));
    const a = sizes(zero.report);
    const b = sizes(none.report);
    expect(Object.keys(a)).toEqual(Object.keys(b));
    // Every segment but meta (which records why each was dropped) is the same size.
    for (const name of Object.keys(a).filter((n) => n !== 'meta')) expect(a[name].rawBytes, name).toBe(b[name].rawBytes);
    const metaDelta = Math.abs(a.meta.storedBytes - b.meta.storedBytes) * 2 + 16;
    expect(zero.report.bytes).toBeLessThanOrEqual(none.report.bytes + metaDelta);
    const decodedZero = await decodePage(join(out, 'zero.html'));
    const decodedNone = await decodePage(join(out, 'none.html'));
    expect(decodedZero.strings).toEqual(decodedNone.strings);
  });

  it('trims at exact segment sizes: excerpts, then index literals, then evidenceText', async () => {
    const project = copyProject();
    const probe = join(mkdtempSync(join(scratch, 'out-')), 'probe.html');
    const full = bake(project, '--out', probe).report;
    expect(full.dropped).toEqual([]);
    const segments = await decodePage(probe);
    const bytesOf = (list) => list.reduce((sum, s) => sum + Buffer.byteLength(s), 0);
    const evidence = bytesOf(segments['evidenceText.strings']);
    const literals = bytesOf(segments['indexLiterals.strings']);
    expect(evidence).toBeGreaterThan(0);
    expect(literals).toBeGreaterThan(0);
    const dropsAt = async (budget) => (await buildView({ projectRoot: project, templatePath, sourceBudgetBytes: budget, out: probe }))
      .dropped.map((d) => d.segment);
    expect(await dropsAt(evidence + literals)).toEqual(['excerpts']);
    expect(await dropsAt(evidence + literals - 1)).toEqual(['excerpts', 'indexLiterals']);
    expect(await dropsAt(evidence)).toEqual(['excerpts', 'indexLiterals']);
    expect(await dropsAt(evidence - 1)).toEqual(['excerpts', 'indexLiterals', 'evidenceText']);
  });

  it('fails above the hard limit with ViewTooLargeError and leaves an existing view byte-identical', async () => {
    const project = copyProject();
    expect(bake(project).status).toBe(0);
    const before = readFileSync(viewPath(project));
    const error = await buildView({ projectRoot: project, templatePath, hardLimitBytes: 1000 }).catch((e) => e);
    expect(error).toBeInstanceOf(ViewTooLargeError);
    expect(error.name).toBe('ViewTooLargeError');
    expect(error.product).toBe('view.html');
    expect(error.limitBytes).toBe(1000);
    expect(error.requiredBytes).toBeGreaterThan(1000);
    expect(error.message).toMatch(/needs \d+ bytes .* hard limit of 1000 bytes/);
    expect(readFileSync(viewPath(project)).equals(before)).toBe(true);
    expect(leftoverTemps(project)).toEqual([]);
  });

  it('fails above the hard limit without creating a view when none existed', async () => {
    const project = copyProject();
    await expect(buildView({ projectRoot: project, templatePath, hardLimitBytes: 10 })).rejects.toThrow(ViewTooLargeError);
    expect(existsSync(viewPath(project))).toBe(false);
  });
});

describe('self-check and atomic write (3.5)', () => {
  it('prints one JSON report line with path, bytes, inventory, dropped, freshness and counts', () => {
    const project = copyProject();
    const { status, stdout, report } = bake(project);
    expect(status).toBe(0);
    expect(stdout.trimEnd().split('\n')).toHaveLength(1);
    expect(Object.keys(report)).toEqual(expect.arrayContaining(['path', 'bytes', 'inventory', 'dropped', 'freshness', 'counts']));
    expect(report.path).toBe(viewPath(project));
    expect(report.bytes).toBe(statSync(viewPath(project)).size);
    expect(report.inventory.map((i) => i.name)).toEqual([
      'knowledge-graph.jsonl', 'source-manifest.json', 'fingerprints.json', 'source-index.jsonl',
      'semantic-cache.json', 'semantic-graph.json', 'domain-graph.json',
    ]);
    expect(report.freshness.factLayer.status).toBe('fresh');
    expect(leftoverTemps(project)).toEqual([]);
  });

  it('writes a page with exactly one data element and nothing outside the bundle alphabet in it', () => {
    const project = copyProject();
    bake(project);
    const html = readFileSync(viewPath(project), 'utf-8');
    expect(html.split('id="excavator-view-data"').length - 1).toBe(1);
    const payload = extractBundleText(html);
    expect(payload.split('\n')[0]).toBe('excavator-view-bundle/1');
    expect(payload).not.toContain('<');
    expect(readdirSync(join(project, '.excavator')).sort()).toEqual([
      'fingerprints.json', 'intermediate', 'knowledge-graph.jsonl', 'meta.json', 'source-index.jsonl', 'source-manifest.json', 'view.html',
    ]);
  });

  it('refuses a template with an external reference or without the CSP', () => {
    const project = copyProject();
    const linked = join(scratch, 'linked.html');
    writeFileSync(linked, TEMPLATE_HTML.replace('</head>', '<link rel="stylesheet" href="https://example.invalid/a.css"></head>'));
    const a = spawnSync(process.execPath, [bakeScript, project, '--template', linked], { encoding: 'utf-8' });
    expect(a.status).toBe(1);
    expect(a.stderr).toMatch(/ViewTemplateError: .*external reference/);
    const noCsp = join(scratch, 'no-csp.html');
    writeFileSync(noCsp, TEMPLATE_HTML.replace(/<meta http-equiv[^>]*>/, ''));
    const b = spawnSync(process.execPath, [bakeScript, project, '--template', noCsp], { encoding: 'utf-8' });
    expect(b.status).toBe(1);
    expect(b.stderr).toMatch(/ViewTemplateError: .*Content-Security-Policy/);
    const missing = spawnSync(process.execPath, [bakeScript, project, '--template', join(scratch, 'nope.html')], { encoding: 'utf-8' });
    expect(missing.stderr).toMatch(/ViewTemplateError: .*pnpm --filter @excavator\/view build/);
    expect(existsSync(viewPath(project))).toBe(false);
  });

  it('the decode self-check fails when decoded counts disagree with the header', async () => {
    const one = Int32Array.of(0);
    const { lines } = await encodeBundle({
      nodes: table(1, { id: one }), edges: table(1, { src: one }), evidence: table(1, { file: one }), gaps: [],
    });
    const graph = (nodes) => ({ header: { counts: { nodes, edges: 1, gaps: 0 } }, counts: { evidence: 1 } });
    await expect(selfCheck(lines, graph(1))).resolves.toEqual({ nodes: 1, edges: 1, evidence: 1, gaps: 0 });
    await expect(selfCheck(lines, graph(2))).rejects.toThrow(ViewSelfCheckError);
    await expect(selfCheck(lines.slice(0, 3), graph(1))).rejects.toThrow(/decoded edges -1 != header 1/);
    await expect(selfCheck(['excavator-view-bundle/9'], graph(1))).rejects.toThrow(/does not decode/);
  });

  it('the page check flags a bundle line that could break out of the data element (instrument check)', () => {
    const template = { prefix: TEMPLATE_HTML.split('<script type="text/plain"')[0], suffix: '</body></html>' };
    expect(pageProblems(template, ['excavator-view-bundle/1', '@meta json 2 2 raw', 'e30='])).toEqual([]);
    expect(pageProblems(template, ['excavator-view-bundle/1', '</script><script src="https://x.invalid/a.js">'])).toHaveLength(1);
  });
});

describe('fact-layer freshness (3.6)', () => {
  it('reports stale after HEAD moves, still writes the view, and reads source at the analyzed commit', async () => {
    const project = mkdtempSync(join(scratch, 'git-'));
    cpSync(fixtureProject, project, { recursive: true });
    const git = (...args) => execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', ...args], { cwd: project, stdio: 'pipe' });
    git('init', '-q');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');
    lazyAnalyze(project);
    const fresh = bake(project);
    expect(fresh.report.freshness.factLayer.status).toBe('fresh');

    writeFileSync(join(project, 'src/util/format.ts'), 'export const replaced = 1;\n');
    git('commit', '-q', '-am', 'move HEAD');
    const stale = bake(project);
    expect(stale.status, stale.stderr).toBe(0);
    expect(stale.report.freshness.factLayer.status).toBe('stale');
    expect(stale.report.freshness.factLayer.manifestSourceRevision).not.toBe(stale.report.freshness.factLayer.currentSourceRevision);
    expect(existsSync(viewPath(project))).toBe(true);
    expect(stale.report.source.embedding).toMatchObject({ snapshotPinned: true, filesHashMismatch: 0 });
    const segments = await decodePage(viewPath(project));
    expect(segments.meta.freshness.factLayer.status).toBe('stale');
    expect(sourceText(segments)).toContain(MARKER);
  }, 60_000);
});

describe('meta carries no absolute local paths', () => {
  it('keeps the project root and output path out of the embedded data', async () => {
    const project = copyProject();
    bake(project);
    const segments = await decodePage(viewPath(project));
    const text = decodedText(segments);
    expect(text).not.toContain(project);
    expect(text).not.toContain(scratch);
  });
});
