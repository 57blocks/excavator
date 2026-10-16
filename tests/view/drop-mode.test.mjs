// artifact-view task 9.1: a dropped `.excavator/` directory is read with the
// same rules as the bake. One function (`parseDataDirectory`) reads the
// directory through two readers: the bake's Node file-system reader and the
// page's File API reader (`File.stream()` + `TextDecoderStream`, present in
// Node >= 22, so the browser code runs here as is). The project is the
// synthetic sample with all three semantic products written by their real
// writers (tests/view/fixtures/make-semantic-project.mjs).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, createReadStream, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { decodeBundle } from '../../skills/excavator-view/bundle-codec.mjs';
import { buildView } from '../../skills/excavator-view/build-view.mjs';
import { extractBundleText } from '../../skills/excavator-view/bake/html-output.mjs';
import { readDroppedDirectory } from '../../skills/excavator-view/shared/drop-mode.mjs';
import { locateDataDirectory, splitLines } from '../../skills/excavator-view/shared/file-reader.mjs';
import { KNOWLEDGE_GRAPH_FORMAT, SOURCE_INDEX_FORMAT } from '../../skills/excavator-view/shared/formats.mjs';
import { utf8Length } from '../../skills/excavator-view/shared/text-table.mjs';
import { KNOWLEDGE_GRAPH_FORMAT as STORE_GRAPH_FORMAT } from '../../skills/excavator/knowledge-graph-store.mjs';
import { SOURCE_INDEX_FORMAT as STORE_INDEX_FORMAT } from '../../skills/excavator/source-index-store.mjs';
import { createHash as stubCreateHash } from '../../packages/view/src/crypto-stub.ts';
import { makeSemanticProject } from './fixtures/make-semantic-project.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEMPLATE_HTML = [
  '<!doctype html><html><head>',
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; '
    + 'style-src \'unsafe-inline\'; img-src data:; worker-src blob:; connect-src \'none\'">',
  '<title>view test template</title></head><body><div id="root"></div>',
  '<script type="text/plain" id="excavator-view-data"></script>',
  '</body></html>',
].join('\n');

const scratch = mkdtempSync(join(tmpdir(), 'excavator-view-drop-'));
const templatePath = join(scratch, 'template.html');
let made;

/** The files of a directory tree as a picked directory delivers them. */
function pickDirectory(dir, prefix) {
  const out = [];
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push({ path: `${prefix}/${relative(dir, path).split('\\').join('/')}`, file: new File([readFileSync(path)], entry.name) });
    }
  };
  walk(dir);
  return out;
}

async function bakedSegments(project, flags = {}) {
  const out = join(scratch, `view-${Math.random().toString(36).slice(2)}.html`);
  await buildView({ projectRoot: project, out, templatePath, ...flags });
  return (await decodeBundle(extractBundleText(readFileSync(out, 'utf-8')))).segments;
}

beforeAll(async () => {
  writeFileSync(templatePath, TEMPLATE_HTML);
  made = await makeSemanticProject(join(scratch, 'project'));
}, 120_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SHARED_SEGMENTS = [
  'strings', 'values', 'nodes', 'nodeTags', 'edges', 'evidence', 'coverage', 'gaps', 'files',
  'index.chunks', 'index.tokens', 'semantic', 'layers', 'domain', 'indexLiterals', 'indexLiterals.strings',
];

describe('dropped directory parsed like the bake (9.1)', () => {
  it('gives the same inventory, counts and segments as the bake, with source text not embedded', async () => {
    const baked = await bakedSegments(made.project);
    // A picked project directory: the reader finds .excavator/ and ignores the rest.
    const dropped = await readDroppedDirectory(pickDirectory(made.project, 'picked'), { now: () => '2026-01-02T00:00:00.000Z' });

    expect(dropped.meta.inventory).toEqual(baked.meta.inventory);
    expect(dropped.meta.inventory.map((i) => i.status)).toEqual(Array(7).fill('present'));
    expect(dropped.meta.counts).toEqual(baked.meta.counts);
    expect(dropped.meta.graph).toEqual(baked.meta.graph);
    for (const key of ['semanticCache', 'semanticGraph', 'domainGraph']) expect(dropped.meta.freshness[key]).toEqual(baked.meta.freshness[key]);
    expect(dropped.meta.freshness.semanticCache).toMatchObject({ fresh: 1, stale: 1 });
    expect(dropped.meta.freshness.semanticGraph.freshness).toBe('stale');
    expect(dropped.meta.freshness.domainGraph.freshness).toBe('fresh');
    expect(dropped.meta.index).toEqual(baked.meta.index);
    expect(dropped.meta.members).toEqual(baked.meta.members);
    expect(dropped.meta.selection).toEqual(baked.meta.selection);
    expect(dropped.meta.unembedded).toEqual(baked.meta.unembedded);
    expect(dropped.meta.anomalies).toEqual(baked.meta.anomalies);
    const { embedding, budgetBytes, ...source } = baked.meta.source;
    expect(dropped.meta.source).toEqual({ ...source, embedding: null, budgetBytes: null });
    for (const name of SHARED_SEGMENTS) expect(dropped[name], name).toEqual(baked[name]);

    // What only a drop says.
    expect(dropped.meta.origin).toEqual({ mode: 'drop', directory: 'picked/.excavator', loadedAt: '2026-01-02T00:00:00.000Z' });
    expect(dropped.meta.embeds).toEqual([
      { segment: 'evidenceText', status: 'dropped', reason: 'drop-mode' },
      { segment: 'excerpts', status: 'dropped', reason: 'drop-mode' },
      { segment: 'indexLiterals', status: 'embedded' },
    ]);
    expect(dropped.evidenceText).toBeUndefined();
    expect(dropped.excerpts).toBeUndefined();
    expect(baked.evidenceText).toBeDefined();
    expect(dropped.meta.freshness.factLayer).toMatchObject({ status: 'not-checked', manifestSourceRevision: baked.meta.source.sourceRevision });
  });

  it('marks the same unreadable optional artifact invalid on both paths', async () => {
    const project = mkdtempSync(join(scratch, 'corrupt-'));
    cpSync(made.project, project, { recursive: true });
    writeFileSync(join(project, '.excavator', 'semantic-graph.json'), '{"layers": [');
    const baked = await bakedSegments(project);
    const dropped = await readDroppedDirectory(pickDirectory(join(project, '.excavator'), '.excavator'));
    const invalid = (meta) => meta.inventory.filter((i) => i.status === 'invalid').map((i) => [i.name, i.reason]);
    expect(invalid(dropped.meta)).toEqual(invalid(baked.meta));
    expect(invalid(dropped.meta)).toHaveLength(1);
    expect(dropped.layers).toBeUndefined();
  });

  it('fails a truncated knowledge graph with a visible error, never an empty result', async () => {
    const files = pickDirectory(made.dataDir, '.excavator');
    const graph = files.find((f) => f.path.endsWith('knowledge-graph.jsonl'));
    const text = await graph.file.text();
    graph.file = new File([text.slice(0, Math.floor(text.length * 0.6))], 'knowledge-graph.jsonl');
    await expect(readDroppedDirectory(files)).rejects.toMatchObject({
      name: 'KnowledgeGraphFormatError',
      message: expect.stringMatching(/^\.excavator\/knowledge-graph\.jsonl: (invalid JSON|.*count mismatch)/),
    });
  });

  it('names the missing required artifact', async () => {
    const files = pickDirectory(made.dataDir, 'x/.excavator').filter((f) => !f.path.endsWith('source-manifest.json'));
    await expect(readDroppedDirectory(files)).rejects.toMatchObject({
      name: 'MissingArtifactError',
      message: expect.stringContaining('source-manifest.json: not found in x/.excavator'),
    });
  });

  it('reads only the top-level artifacts of the shallowest directory holding the graph', () => {
    const f = (path) => ({ path, file: new File(['x'], path.split('/').at(-1)) });
    const located = locateDataDirectory([
      f('p/.excavator/knowledge-graph.jsonl'), f('p/.excavator/source-manifest.json'),
      f('p/.excavator/intermediate/knowledge-graph.jsonl'), f('p/.excavator/notes.txt'), f('p/src/a.ts'),
    ]);
    expect(located.directory).toBe('p/.excavator');
    expect([...located.files.keys()]).toEqual(['knowledge-graph.jsonl', 'source-manifest.json']);
    expect(located.ignored).toBe(3);
  });
});

describe('the File API reader splits lines exactly as the bake (9.1)', () => {
  const text = 'a\r\nb\nc\rd\r\n\r\ne\n\nf';
  const readline = async (input) => {
    const out = [];
    for await (const line of createInterface({ input: Readable.from([input]), crlfDelay: Infinity })) out.push(line);
    return out;
  };
  async function* chunked(s, size) {
    for (let i = 0; i < s.length; i += size) yield s.slice(i, i + size);
  }
  it('for every chunk size, including a CR LF split across chunks', async () => {
    const expected = await readline(text);
    expect(expected).toEqual(['a', 'b', 'c', 'd', '', 'e', '', 'f']);
    for (let size = 1; size <= text.length; size += 1) {
      const lines = [];
      for await (const line of splitLines(chunked(text, size))) lines.push(line);
      expect(lines, `chunk size ${size}`).toEqual(expected);
    }
    for (const tail of ['x\n', 'x\r', 'x\r\n', '']) {
      const lines = [];
      for await (const line of splitLines(chunked(tail, 1))) lines.push(line);
      expect(lines, JSON.stringify(tail)).toEqual(await readline(tail));
    }
  });

  it('on the real graph file', async () => {
    const path = join(made.dataDir, 'knowledge-graph.jsonl');
    const viaNode = [];
    for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) viaNode.push(line);
    const viaFile = [];
    const file = new File([readFileSync(path)], 'knowledge-graph.jsonl');
    for await (const line of splitLines(file.stream().pipeThrough(new TextDecoderStream()))) viaFile.push(line);
    expect(viaFile).toEqual(viaNode);
  });
});

describe('pure stand-ins for node: imports (9.1)', () => {
  it('pins the copied line formats to their owners', () => {
    expect(KNOWLEDGE_GRAPH_FORMAT).toBe(STORE_GRAPH_FORMAT);
    expect(SOURCE_INDEX_FORMAT).toBe(STORE_INDEX_FORMAT);
  });

  it('counts UTF-8 bytes as Buffer does', () => {
    for (const s of ['', 'ascii', 'é', '中文', '😀', 'a\ud800b', '\udc00', 'x😀y中é']) {
      expect(utf8Length(s), JSON.stringify(s)).toBe(Buffer.byteLength(s, 'utf-8'));
    }
  });

  it('hashes like node:crypto sha256 (the page alias for the language audit)', () => {
    const inputs = ['', 'abc', 'é中😀', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(1000), 'a\ud800b'];
    for (const s of inputs) {
      expect(stubCreateHash('sha256').update(s, 'utf-8').digest('hex'), JSON.stringify(s).slice(0, 20)).toBe(createHash('sha256').update(s, 'utf-8').digest('hex'));
    }
  });

  it('keeps node: imports out of every module the page loads for a drop', () => {
    const pageModules = [
      ...readdirSync(join(repoRoot, 'skills/excavator-view/shared')).map((n) => `skills/excavator-view/shared/${n}`),
      'skills/excavator-view/bundle-codec.mjs',
      'skills/excavator-view/bake/errors.mjs',
      'skills/excavator/semantic-cache-freshness.mjs',
      'skills/excavator-domain/domain-usability.mjs',
      'skills/excavator-domain/domain-contract.mjs',
    ];
    for (const path of pageModules) {
      const source = readFileSync(join(repoRoot, path), 'utf-8');
      const staticImports = [...source.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
      expect(staticImports.filter((s) => s.startsWith('node:')), path).toEqual([]);
      // The codec's encoder reaches Buffer through globalThis, guarded; nothing uses the global directly.
      expect(/(?<![\w.])Buffer\./.test(source), path).toBe(false);
    }
    // The one node: import on the page's path is the language audit's sha256, aliased by the page build.
    const audit = readFileSync(join(repoRoot, 'skills/excavator/semantic-language-audit.mjs'), 'utf-8');
    expect([...audit.matchAll(/from\s+'(node:[^']+)'/g)].map((m) => m[1])).toEqual(['node:crypto']);
    const vite = readFileSync(join(repoRoot, 'packages/view/vite.config.ts'), 'utf-8');
    expect(vite).toContain("'node:crypto': fileURLToPath(new URL('./src/crypto-stub.ts', import.meta.url))");
  });
});
