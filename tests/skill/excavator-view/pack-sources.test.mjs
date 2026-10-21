/** Embedded source and its five classes (design D4), through the real pack on synthetic repositories. */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { packProject as packWithTemplate } from '../../../skills/excavator-view/pack.mjs';
import { referencedPaths } from '../../../skills/excavator-view/sources.mjs';
import {
  docMapProduct, hotspotsProduct, makeGitProject, makeMultiRepoProject, unusedProduct, writeProduct,
} from './fixture.mjs';
import { manifestOf, payloadIds, payloadText } from './page.mjs';
import { makePluginRoot, writeTemplate } from './plugin-fixture.mjs';

// The pack runs on a small template, so these tests need no build of packages/report-view.
const { dir: templateDir, path: template } = writeTemplate();
const pluginRoot = makePluginRoot(readFileSync(template, 'utf-8'));
const packScript = join(pluginRoot, 'skills/excavator-view/pack.mjs');
const packProject = (root, options) => packWithTemplate(root, { template, ...options });

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

function packUnused(paths, options) {
  writeProduct(project.root, 'unused-code.json', unusedProduct(project.revision, { unused: paths.map((p) => row(p)) }));
  const result = packProject(project.root, options);
  const html = readFileSync(result.out, 'utf-8');
  return { result, html, source: manifestOf(html).source };
}

describe('the five classes', () => {
  it('puts every referenced file in exactly one class, with sizes where the file was read', () => {
    const { result, html, source } = packUnused(['src/a.js', 'bin/blob.dat', 'src/big.js', 'gone/deleted.js', 'src/exact.js', 'src/late-nul.js', 'src/empty.js']);
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

    const texts = JSON.parse(payloadText(html, 'sources'));
    expect(Object.keys(texts)).toEqual(['src/a.js', 'src/empty.js', 'src/exact.js', 'src/late-nul.js']);
    expect(texts['src/a.js']).toBe(files['src/a.js']);
    expect(texts['src/exact.js']).toHaveLength(LIMIT);
    expect(payloadIds(html).at(-1)).toBe('sources');
  });

  it('does not embed a file over the limit or a binary file, though both stay listed', () => {
    const { html, source } = packUnused(['src/big.js', 'bin/blob.dat']);
    expect(source.embedded).toBe(false);
    expect(source.counts.embedded).toBe(0);
    expect(Object.keys(source.files)).toEqual(['bin/blob.dat', 'src/big.js']);
    expect(payloadIds(html)).toEqual(['unused-code']);
  });

  it('lists two files of the same text at different paths as two files', () => {
    const { source, html } = packUnused(['one/dup.js', 'two/dup.js']);
    expect(source.counts.embedded).toBe(2);
    expect(Object.keys(JSON.parse(payloadText(html, 'sources')))).toEqual(['one/dup.js', 'two/dup.js']);
  });

  it('records no source section content when no product names a file', () => {
    const result = packProject(project.root);
    expect(result.source).toEqual({ embedded: false, requested: true, limitBytes: LIMIT, counts: { embedded: 0, binary: 0, tooLarge: 0, notInSnapshot: 0, notEmbeddedOnRequest: 0 } });
  });

  it('reads HEAD, not the working tree', () => {
    writeFileSync(join(project.root, 'src/a.js'), '// edited after the commit: NOT_IN_HEAD\n');
    try {
      const { html } = packUnused(['src/a.js']);
      const text = JSON.parse(payloadText(html, 'sources'))['src/a.js'];
      expect(text).toBe(files['src/a.js']);
      expect(text).not.toContain('NOT_IN_HEAD');
    } finally {
      writeFileSync(join(project.root, 'src/a.js'), files['src/a.js']);
    }
  });

  it('is byte-identical when packed twice', () => {
    packUnused(['src/a.js', 'bin/blob.dat']);
    const first = readFileSync(join(project.root, '.excavator/view.html'));
    packProject(project.root);
    expect(readFileSync(join(project.root, '.excavator/view.html')).equals(first)).toBe(true);
  });

  it('shows a path of another revision as not in snapshot, and a file that moved as not in snapshot at the old path', () => {
    writeProduct(project.root, 'hotspots.json', hotspotsProduct('git:old', { files: [{ path: 'src/a.js', commits: 1 }, { path: 'src/renamed-away.js', commits: 1 }], pairs: [] }));
    const result = packProject(project.root);
    const source = manifestOf(readFileSync(result.out, 'utf-8')).source;
    expect(source.files['src/a.js'].bucket).toBe('embedded');
    expect(source.files['src/renamed-away.js'].bucket).toBe('notInSnapshot');
  });

  it('keeps a directory named like an object property', () => {
    const odd = makeGitProject({ '__proto__/x.js': 'proto text\n', 'constructor/x.js': 'x\n' });
    try {
      writeProduct(odd.root, 'unused-code.json', unusedProduct(odd.revision, { unused: [row('__proto__/x.js'), row('constructor/x.js')] }));
      const result = packProject(odd.root);
      const html = readFileSync(result.out, 'utf-8');
      expect(manifestOf(html).source.counts.embedded).toBe(2);
      expect(Object.keys(JSON.parse(payloadText(html, 'sources'))).sort()).toEqual(['__proto__/x.js', 'constructor/x.js']);
    } finally {
      odd.cleanup();
    }
  });
});

describe('--no-source', () => {
  it('leaves no source text anywhere in the file and puts every path in not embedded on request', () => {
    const { html, source } = packUnused(['src/a.js', 'bin/blob.dat', 'gone/deleted.js', 'src/big.js'], { noSource: true });
    expect(source).toMatchObject({ embedded: false, requested: false });
    expect(source.counts).toEqual({ embedded: 0, binary: 0, tooLarge: 0, notInSnapshot: 0, notEmbeddedOnRequest: 4 });
    expect(Object.values(source.files).every((f) => f.bucket === 'notEmbeddedOnRequest' && f.bytes === undefined)).toBe(true);
    expect(payloadIds(html)).toEqual(['unused-code']);
    expect(html).not.toContain(MARKER);
    for (const id of payloadIds(html)) expect(payloadText(html, id)).not.toContain(MARKER);
  });

  it('is the same on the command line, and embeds the marker only without the flag', () => {
    writeProduct(project.root, 'unused-code.json', unusedProduct(project.revision, { unused: [row('src/a.js')] }));
    const withFlag = JSON.parse(spawnSync(process.execPath, [packScript, project.root, '--no-source'], { encoding: 'utf-8' }).stdout);
    expect(withFlag.source.counts.notEmbeddedOnRequest).toBe(1);
    const noMarker = readFileSync(withFlag.out, 'utf-8');
    expect(payloadIds(noMarker)).toEqual(['unused-code']);
    const without = JSON.parse(spawnSync(process.execPath, [packScript, project.root], { encoding: 'utf-8' }).stdout);
    expect(payloadText(readFileSync(without.out, 'utf-8'), 'sources')).toContain(MARKER);
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
    const source = manifestOf(readFileSync(packProject(project.root).out, 'utf-8')).source;
    expect(Object.keys(source.files)).toEqual(['one/dup.js', 'src/a.js', 'src/empty.js', 'src/exact.js', 'src/late-nul.js', 'two/dup.js']);
    expect(source.counts.embedded).toBe(6);
  });

  it('does not take paths from a product that is unreadable', () => {
    writeProduct(project.root, 'unused-code.json', '{ "unused": [');
    expect(packProject(project.root).source.counts.embedded).toBe(0);
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
      const result = packProject(multi.root);
      const html = readFileSync(result.out, 'utf-8');
      const source = manifestOf(html).source;
      expect(source.counts).toEqual({ embedded: 3, binary: 0, tooLarge: 0, notInSnapshot: 0, notEmbeddedOnRequest: 0 });
      expect(Object.keys(source.files)).toEqual(['alpha/README.txt', 'alpha/src/x.js', 'beta/lib/y.js']);
      expect(JSON.parse(payloadText(html, 'sources'))['alpha/src/x.js']).toContain(MARKER);
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
      const html = readFileSync(packProject(dir).out, 'utf-8');
      expect(JSON.parse(payloadText(html, 'sources'))['a.js']).toContain(MARKER);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
