/**
 * Embedded source and its five classes (design D4), through the real pack on synthetic repositories.
 * The page's manifest keeps the counts of the classes; the class of each file is what `collectSources` computes
 * for the same products and snapshot, which these tests read next to the page and tie to it.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { resolveSourceSnapshot } from '../../../skills/excavator/source-snapshot.mjs';
import { packProject as packWithTemplate } from '../../../skills/excavator-view/pack.mjs';
import { collectProducts } from '../../../skills/excavator-view/products.mjs';
import { collectSources, referencedPaths } from '../../../skills/excavator-view/sources.mjs';
import {
  docMapProduct, GRAPH_FORMAT, hotspotsProduct, makeGitProject, makeMultiRepoProject, unusedProduct, writeProduct,
} from './fixture.mjs';
import { explorerPage } from './page.mjs';
import { makePluginRoot, writeTemplate } from './plugin-fixture.mjs';

// The pack runs on a small template, so these tests need no build of packages/explorer.
const { dir: templateDir, path: template } = writeTemplate();
const pluginRoot = makePluginRoot(readFileSync(template, 'utf-8'));
const packScript = join(pluginRoot, 'skills/excavator-view/pack.mjs');
const packProject = (root, options) => packWithTemplate(root, { explorerTemplate: template, ...options });

const MARKER = 'UNIQUE_SOURCE_MARKER_8f3a1c';
const LIMIT = 1024 * 1024;
const nul = (length) => Buffer.concat([Buffer.from('head'), Buffer.from([0]), Buffer.alloc(length, 0x61)]);

const files = {
  'src/a.js': `// ${MARKER}\nexport function a() {}\n`,
  'bin/blob.dat': nul(100),
  'src/big.js': Buffer.alloc(LIMIT + 1, 0x78),
  'src/exact.js': Buffer.alloc(LIMIT, 0x79),
  'src/late-nul.js': Buffer.concat([Buffer.alloc(9000, 0x7a), Buffer.from([0]), Buffer.from('tail')]),
  'one/dup.js': 'same text\n',
  'two/dup.js': 'same text\n',
  'src/empty.js': '',
};

let project;
beforeAll(() => { project = makeGitProject(files); });
afterAll(() => {
  project.cleanup();
  rmSync(templateDir, { recursive: true, force: true });
  rmSync(pluginRoot, { recursive: true, force: true });
});
beforeEach(() => rmSync(join(project.root, '.excavator'), { recursive: true, force: true }));

const row = (file, over = {}) => ({ id: file, name: file, language: 'javascript', file, lineRange: [1, 1], reason: 'unreferenced', confidence: 'high', ...over });

/** The class of every referenced file and the texts of the embedded ones, as the packer computes them from the products on disk. */
function classesOf(root, { noSource = false } = {}) {
  const snapshot = resolveSourceSnapshot(root);
  const products = collectProducts(join(root, '.excavator'), snapshot.revision);
  const { manifest, payloads } = collectSources({ noSource, snapshot, payloads: products.payloads });
  const table = payloads.find((p) => p.id === 'sources');
  return { ...manifest, texts: JSON.parse(table ? table.bytes.toString('utf-8') : '{}') };
}

/** Pack, then read the page and the classes; the page must say what the classes say. */
function pack(root, options) {
  const result = packProject(root, options);
  const html = readFileSync(result.out, 'utf-8');
  const page = explorerPage(html);
  const source = classesOf(root, options);
  expect(page.manifest.source).toEqual({ embedded: source.embedded, counts: source.counts });
  expect(page.data.sources ?? {}).toEqual(Object.fromEntries(Object.entries(source.texts).map(([path, text]) => [path, expect.objectContaining({ path, content: text })])));
  return { result, html, page, source };
}

function packUnused(paths, options) {
  writeProduct(project.root, 'unused-code.json', unusedProduct(project.revision, { unused: paths.map((p) => row(p)) }));
  return pack(project.root, options);
}

describe('the five classes', () => {
  it('puts every referenced file in exactly one class, with sizes where the file was read', () => {
    const { result, page, source } = packUnused(['src/a.js', 'bin/blob.dat', 'src/big.js', 'gone/deleted.js', 'src/exact.js', 'src/late-nul.js', 'src/empty.js']);
    expect(source.counts).toEqual({ embedded: 4, binary: 1, tooLarge: 1, notInSnapshot: 1, notEmbeddedOnRequest: 0 });
    expect(source.embedded).toBe(true);
    expect(source.requested).toBe(true);
    expect(source.limitBytes).toBe(LIMIT);
    expect(source.files).toEqual({
      'bin/blob.dat': { bucket: 'binary', bytes: 105 },
      'gone/deleted.js': { bucket: 'notInSnapshot' },
      'src/a.js': { bucket: 'embedded', bytes: Buffer.byteLength(files['src/a.js']) },
      'src/big.js': { bucket: 'tooLarge', bytes: LIMIT + 1 },
      'src/empty.js': { bucket: 'embedded', bytes: 0 },
      'src/exact.js': { bucket: 'embedded', bytes: LIMIT },
      'src/late-nul.js': { bucket: 'embedded', bytes: 9005 },
    });
    expect(Object.values(source.counts).reduce((a, b) => a + b, 0)).toBe(Object.keys(source.files).length);
    expect(result.source).toEqual({ embedded: true, requested: true, limitBytes: LIMIT, counts: source.counts });

    const { texts } = source;
    expect(Object.keys(texts)).toEqual(['src/a.js', 'src/empty.js', 'src/exact.js', 'src/late-nul.js']);
    expect(texts['src/a.js']).toBe(files['src/a.js']);
    expect(texts['src/exact.js']).toHaveLength(LIMIT);
    expect(Object.keys(page.data).at(-1)).toBe('sources');
    expect(page.data.sources['src/a.js'].content).toBe(files['src/a.js']);
  });

  it('does not embed a file over the limit or a binary file, though both stay listed', () => {
    const { page, source } = packUnused(['src/big.js', 'bin/blob.dat']);
    expect(source.embedded).toBe(false);
    expect(source.counts.embedded).toBe(0);
    expect(Object.keys(source.files)).toEqual(['bin/blob.dat', 'src/big.js']);
    expect(page.data).not.toHaveProperty('sources');
  });

  it('lists two files of the same text at different paths as two files', () => {
    const { source } = packUnused(['one/dup.js', 'two/dup.js']);
    expect(source.counts.embedded).toBe(2);
    expect(Object.keys(source.texts)).toEqual(['one/dup.js', 'two/dup.js']);
  });

  it('records no source section content when no product names a file', () => {
    const result = packProject(project.root);
    expect(result.source).toEqual({ embedded: false, requested: true, limitBytes: LIMIT, counts: { embedded: 0, binary: 0, tooLarge: 0, notInSnapshot: 0, notEmbeddedOnRequest: 0 } });
  });

  it('reads HEAD, not the working tree', () => {
    writeFileSync(join(project.root, 'src/a.js'), '// edited after the commit: NOT_IN_HEAD\n');
    try {
      const { page } = packUnused(['src/a.js']);
      const text = page.data.sources['src/a.js'].content;
      expect(text).toBe(files['src/a.js']);
      expect(text).not.toContain('NOT_IN_HEAD');
    } finally {
      writeFileSync(join(project.root, 'src/a.js'), files['src/a.js']);
    }
  });

  it('is byte-identical when packed twice', () => {
    packUnused(['src/a.js', 'bin/blob.dat']);
    const first = readFileSync(join(project.root, '.excavator/explorer.html'));
    packProject(project.root);
    expect(readFileSync(join(project.root, '.excavator/explorer.html')).equals(first)).toBe(true);
  });

  it('shows a path of another revision as not in snapshot, and a file that moved as not in snapshot at the old path', () => {
    writeProduct(project.root, 'hotspots.json', hotspotsProduct('git:old', { files: [{ path: 'src/a.js', commits: 1 }, { path: 'src/renamed-away.js', commits: 1 }], pairs: [] }));
    const { source } = pack(project.root);
    expect(source.files['src/a.js'].bucket).toBe('embedded');
    expect(source.files['src/renamed-away.js'].bucket).toBe('notInSnapshot');
  });

  it('keeps a directory named like an object property', () => {
    const odd = makeGitProject({ '__proto__/x.js': 'proto text\n', 'constructor/x.js': 'x\n' });
    try {
      writeProduct(odd.root, 'unused-code.json', unusedProduct(odd.revision, { unused: [row('__proto__/x.js'), row('constructor/x.js')] }));
      const { page, source } = pack(odd.root);
      expect(page.manifest.source.counts.embedded).toBe(2);
      expect(Object.keys(source.texts).sort()).toEqual(['__proto__/x.js', 'constructor/x.js']);
    } finally {
      odd.cleanup();
    }
  });
});

describe('--no-source', () => {
  it('leaves no source text anywhere in the file and puts every path in not embedded on request', () => {
    const { html, page, source } = packUnused(['src/a.js', 'bin/blob.dat', 'gone/deleted.js', 'src/big.js'], { noSource: true });
    expect(source).toMatchObject({ embedded: false, requested: false });
    expect(source.counts).toEqual({ embedded: 0, binary: 0, tooLarge: 0, notInSnapshot: 0, notEmbeddedOnRequest: 4 });
    expect(Object.values(source.files).every((f) => f.bucket === 'notEmbeddedOnRequest' && f.bytes === undefined)).toBe(true);
    expect(page.data).not.toHaveProperty('sources');
    expect(html).not.toContain(MARKER);
  });

  it('is the same on the command line, and embeds the marker only without the flag', () => {
    writeProduct(project.root, 'unused-code.json', unusedProduct(project.revision, { unused: [row('src/a.js')] }));
    const withFlag = JSON.parse(spawnSync(process.execPath, [packScript, project.root, '--no-source'], { encoding: 'utf-8' }).stdout);
    expect(withFlag.source.counts.notEmbeddedOnRequest).toBe(1);
    const noMarker = readFileSync(withFlag.out, 'utf-8');
    expect(explorerPage(noMarker).data).not.toHaveProperty('sources');
    expect(noMarker).not.toContain(MARKER);
    const without = JSON.parse(spawnSync(process.execPath, [packScript, project.root], { encoding: 'utf-8' }).stdout);
    expect(explorerPage(readFileSync(without.out, 'utf-8')).data.sources['src/a.js'].content).toContain(MARKER);
  });
});

describe('the paths the products name', () => {
  const buf = (value) => Buffer.from(JSON.stringify(value));
  it('takes them from unused, testOnly, doc-map evidence and coverage, and hotspots files and pairs', () => {
    const paths = referencedPaths([
      { id: 'unused-code', bytes: buf({ unused: [{ file: 'u1.js' }, { file: 'u1.js' }, { file: null }, {}], testOnly: [{ file: 't1.js' }] }) },
      {
        id: 'doc-map',
        bytes: buf({
          units: [{ code: { evidence: [{ file: 'e1.js', line: 3 }, { file: 'e2.js' }] } }, { code: null }, {}],
          coverage: { files: [{ path: 'c1.js', units: [] }, { path: 'e1.js', units: [1] }], outside: [{ unit: 1, file: 'o1.js', line: 1 }] },
        }),
      },
      { id: 'hotspots', bytes: buf({ files: [{ path: 'h1.js' }], pairs: [{ a: 'h1.js', b: 'h2.js' }, { a: 'p1.js', b: 'p2.js' }] }) },
      { id: 'knowledge-graph', bytes: Buffer.from('not json at all') },
    ]);
    expect(paths).toEqual(['c1.js', 'e1.js', 'e2.js', 'h1.js', 'h2.js', 'o1.js', 'p1.js', 'p2.js', 't1.js', 'u1.js']);
  });

  it('copes with a doc map that has no coverage yet and a product that names nothing', () => {
    expect(referencedPaths([{ id: 'doc-map', bytes: buf(docMapProduct('git:x')) }])).toEqual([]);
    expect(referencedPaths([])).toEqual([]);
  });

  it('embeds the files of every product through the pack, and counts a file once', () => {
    writeProduct(project.root, 'unused-code.json', unusedProduct(project.revision, { unused: [row('src/a.js')], testOnly: [{ id: 't', name: 't', file: 'one/dup.js' }] }));
    writeProduct(project.root, 'hotspots.json', hotspotsProduct(project.revision, { files: [{ path: 'src/a.js' }, { path: 'two/dup.js' }], pairs: [{ a: 'src/a.js', b: 'src/empty.js' }] }));
    const doc = docMapProduct(project.revision, {
      units: [{ document: 'a.md', id: 'u', title: 't', quote: 'q', line: 1, page: null, code: { status: 'found', evidence: [{ file: 'src/exact.js', code: 'c' }], searched: [] } }],
      coverage: { files: [{ path: 'src/late-nul.js', units: [] }], outside: [] },
    });
    writeProduct(project.root, 'doc-map.json', doc);
    const { source } = pack(project.root);
    expect(Object.keys(source.files)).toEqual(['one/dup.js', 'src/a.js', 'src/empty.js', 'src/exact.js', 'src/late-nul.js', 'two/dup.js']);
    expect(source.counts.embedded).toBe(6);
  });

  it('does not take paths from a product that is unreadable', () => {
    writeProduct(project.root, 'unused-code.json', '{ "unused": [');
    expect(packProject(project.root).source.counts.embedded).toBe(0);
  });
});

describe('the files of the graph', () => {
  const fileNode = (path) => ({ record: 'node', node: { id: `file:${path}`, type: 'file', name: path.slice(path.lastIndexOf('/') + 1), filePath: path } });
  const nodes = [
    fileNode('src/a.js'),
    fileNode('bin/blob.dat'),
    fileNode('gone/deleted.js'),
    fileNode('src/big.js'),
    // Not a file node, and a file node without a path: neither names a file.
    { record: 'node', node: { id: 'function:src/exact.js:f', type: 'function', name: 'f', filePath: 'src/exact.js' } },
    { record: 'node', node: { id: 'file:no-path', type: 'file', name: 'no-path' } },
    { record: 'edge', edge: { source: 'file:src/a.js', target: 'file:src/big.js', type: 'imports' } },
  ];
  const header = { record: 'header', format: GRAPH_FORMAT, keys: ['project', 'nodes'], fields: { project: { name: 'fixture' }, kind: 'knowledge' }, counts: { nodes: 6 } };
  // A line that is not JSON is ignored here: the page reports it, the packer only looks for paths.
  const text = `${[header, ...nodes].map((l) => JSON.stringify(l)).join('\n')}\nnot json at all\n`;
  const writeGraph = () => writeProduct(project.root, 'knowledge-graph.jsonl', text);

  it('takes the path of every file node, and of no other node', () => {
    expect(referencedPaths([{ id: 'knowledge-graph', bytes: Buffer.from(text) }])).toEqual(['bin/blob.dat', 'gone/deleted.js', 'src/a.js', 'src/big.js']);
  });

  it('embeds a file that only the graph names, under the same classes as any other', () => {
    writeGraph();
    const { source } = pack(project.root);
    expect(source.files['src/a.js']).toEqual({ bucket: 'embedded', bytes: Buffer.byteLength(files['src/a.js']) });
    expect(source.files['bin/blob.dat'].bucket).toBe('binary');
    expect(source.files['src/big.js'].bucket).toBe('tooLarge');
    expect(source.files['gone/deleted.js']).toEqual({ bucket: 'notInSnapshot' });
    expect(Object.keys(source.files)).toEqual(['bin/blob.dat', 'gone/deleted.js', 'src/a.js', 'src/big.js']);
    expect(Object.keys(source.texts)).toEqual(['src/a.js']);
  });

  it('counts a file that a product and the graph both name once', () => {
    writeGraph();
    writeProduct(project.root, 'unused-code.json', unusedProduct(project.revision, { unused: [row('src/a.js'), row('src/empty.js')] }));
    const { source } = pack(project.root);
    expect(Object.keys(source.files)).toEqual(['bin/blob.dat', 'gone/deleted.js', 'src/a.js', 'src/big.js', 'src/empty.js']);
    expect(Object.values(source.counts).reduce((a, b) => a + b, 0)).toBe(5);
  });

  it('puts every graph file in not embedded on request under --no-source', () => {
    writeGraph();
    const { html, page } = pack(project.root, { noSource: true });
    expect(page.manifest.source.counts).toEqual({ embedded: 0, binary: 0, tooLarge: 0, notInSnapshot: 0, notEmbeddedOnRequest: 4 });
    expect(page.data).not.toHaveProperty('sources');
    expect(html).not.toContain(MARKER);
  });
});

describe('a multi-repo project', () => {
  it('gives member-prefixed paths that resolve, with none missing from the snapshot', () => {
    const multi = makeMultiRepoProject({
      alpha: { 'src/x.js': `// ${MARKER}\n`, 'README.txt': 'alpha\n' },
      beta: { 'lib/y.js': 'beta\n' },
    });
    try {
      writeProduct(multi.root, 'unused-code.json', unusedProduct('multi-repo:x', { unused: [row('alpha/src/x.js'), row('beta/lib/y.js')] }));
      writeProduct(multi.root, 'hotspots.json', hotspotsProduct('multi-repo:x', { files: [{ path: 'alpha/README.txt' }], pairs: [{ a: 'alpha/src/x.js', b: 'beta/lib/y.js' }] }));
      const { source } = pack(multi.root);
      expect(source.counts).toEqual({ embedded: 3, binary: 0, tooLarge: 0, notInSnapshot: 0, notEmbeddedOnRequest: 0 });
      expect(Object.keys(source.files)).toEqual(['alpha/README.txt', 'alpha/src/x.js', 'beta/lib/y.js']);
      expect(source.texts['alpha/src/x.js']).toContain(MARKER);
    } finally {
      multi.cleanup();
    }
  });

  it('puts a path without its member prefix in not in snapshot', () => {
    const multi = makeMultiRepoProject({ alpha: { 'src/x.js': 'x\n' } });
    try {
      writeProduct(multi.root, 'unused-code.json', unusedProduct('multi-repo:x', { unused: [row('src/x.js')] }));
      expect(packProject(multi.root).source.counts.notInSnapshot).toBe(1);
    } finally {
      multi.cleanup();
    }
  });
});

describe('a directory that is not a repository', () => {
  it('embeds its files from the snapshot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xv-dir-'));
    try {
      writeFileSync(join(dir, 'a.js'), `// ${MARKER}\n`);
      writeProduct(dir, 'unused-code.json', unusedProduct('dir:x', { unused: [row('a.js')] }));
      const { page } = pack(dir);
      expect(page.data.sources['a.js'].content).toContain(MARKER);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
