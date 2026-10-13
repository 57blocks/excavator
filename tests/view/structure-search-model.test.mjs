// artifact-view tasks 5.1-5.3: the structure tree, the name / path / id
// matcher, the query engine (lazy identifier term index) and the #/dir route,
// tested in Node against the committed dev fixture and hand-built segments.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeBundle } from '../../skills/excavator-view/bundle-codec.mjs';
import { dirHash, parseHash, routeSection } from '../../packages/view/src/routes.ts';
import { breadcrumbs, buildStructure, entryWeight, locate } from '../../packages/view/src/model/tree.ts';
import { buildNameIndex, searchNames, subsequenceScore } from '../../packages/view/src/model/search.ts';
import { QueryEngine, retainForQueries } from '../../packages/view/src/model/engine.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sample = readFileSync(join(repoRoot, 'packages/view/fixtures/sample.bundle.txt'), 'utf-8');

async function sampleSegments() {
  return (await decodeBundle(sample)).segments;
}

const idOf = (segments, row) => segments.strings[segments.nodes.columns.id[row]];

/** A copy of the segments with the named tables / arrays removed. */
function without(segments, ...names) {
  const copy = { ...segments };
  for (const name of names) delete copy[name];
  return copy;
}

/** A copy whose files table has `totalLines` -1 for the given paths. */
function withoutLineCounts(segments, paths) {
  const files = segments.files;
  const totalLines = new Int32Array(files.columns.totalLines);
  for (let row = 0; row < files.rows; row += 1) {
    if (paths.includes(segments.strings[files.columns.path[row]])) totalLines[row] = -1;
  }
  return { ...segments, files: { rows: files.rows, columns: { ...files.columns, totalLines } } };
}

describe('#/dir route (5.3)', () => {
  it('parses directory and file paths, the root, and encoded segments', () => {
    expect(parseHash('#/dir/src/util')).toEqual({ kind: 'dir', path: 'src/util' });
    expect(parseHash('#/dir/src/util/format.ts')).toEqual({ kind: 'dir', path: 'src/util/format.ts' });
    expect(parseHash('#/dir/')).toEqual({ kind: 'dir', path: '' });
    expect(parseHash('#/dir')).toEqual({ kind: 'dir', path: '' });
    const odd = 'a dir/b#c/%d.ts';
    expect(parseHash(dirHash(odd))).toEqual({ kind: 'dir', path: odd });
    expect(dirHash('')).toBe('#/structure');
    expect(parseHash('#/dir/%E0%A4%A')).toMatchObject({ kind: 'unknown' });
    expect(routeSection(parseHash('#/dir/src'))).toBe('structure');
    expect(routeSection(parseHash('#/node/x'))).toBe(null);
    expect(parseHash('#/search?q=format%20greeting').params.get('q')).toBe('format greeting');
  });
});

describe('structure tree (5.1)', () => {
  it('builds the directory tree from the files table, sized by line counts, with languages and symbols', async () => {
    const segments = await sampleSegments();
    const model = buildStructure(segments, segments.strings, segments.meta);
    expect(model.sizing).toBe('lines');
    expect(model.totalFiles).toBe(5);
    expect(model.filesWithoutLines).toBe(0);
    expect(model.unknownLanguageFiles).toBe(0);
    expect(model.hasIndex).toBe(true);
    expect(model.symbolsOutsideFiles).toBe(0);
    // Children sorted by weight: src (12 + 9 + 9 lines), package.json (5), docs (4).
    expect(model.root.children.map((c) => [c.path, c.kind])).toEqual([['src', 'dir'], ['package.json', 'file'], ['docs', 'dir']]);
    expect(model.root.files).toBe(5);
    expect(model.root.lines).toBe(39);
    const src = model.byPath.get('src');
    expect(src).toMatchObject({ kind: 'dir', files: 3, lines: 30, language: 'typescript', member: false });
    expect(model.byPath.get('docs')).toMatchObject({ language: 'markdown', lines: 4 });
    const format = model.byPath.get('src/util/format.ts');
    expect(format).toMatchObject({ kind: 'file', name: 'format.ts', lines: 9, language: 'typescript' });
    expect(idOf(segments, format.fileNode)).toBe('file:src/util/format.ts');
    expect(format.symbols.map((row) => idOf(segments, row))).toEqual([
      'function:src/util/format.ts:formatGreeting(name,times)',
      'function:src/util/format.ts:shout(text)',
    ]);
    expect(model.byPath.get('src/counter.ts').symbols.map((row) => idOf(segments, row))).toEqual(['class:src/counter.ts:Counter']);
    expect(entryWeight(src, 'lines')).toBe(30);
    expect(entryWeight(src, 'files')).toBe(3);
  });

  it('keeps line sizing and counts the files without a line count when only some lack one', async () => {
    const segments = withoutLineCounts(await sampleSegments(), ['src/main.ts']);
    const model = buildStructure(segments, segments.strings, segments.meta);
    expect(model.sizing).toBe('lines');
    expect(model.filesWithoutLines).toBe(1);
    expect(model.byPath.get('src/main.ts').lines).toBe(-1);
    expect(entryWeight(model.byPath.get('src/main.ts'), model.sizing)).toBe(0);
    // Still in the tree (and its directory's file count), only without area.
    expect(model.byPath.get('src')).toMatchObject({ files: 3, lines: 21 });
    expect(model.byPath.get('src').children.map((c) => c.path)).toContain('src/main.ts');
  });

  it('sizes the whole tree by file count when no file has a line count (no fingerprints)', async () => {
    const all = withoutLineCounts(await sampleSegments(), ['docs/notes.md', 'package.json', 'src/main.ts', 'src/counter.ts', 'src/util/format.ts']);
    const model = buildStructure(all, all.strings, all.meta);
    expect(model).toMatchObject({ sizing: 'files', filesWithoutLines: 5 });
    expect(entryWeight(model.byPath.get('src/main.ts'), model.sizing)).toBe(1);
    expect(model.root.children.map((c) => [c.path, entryWeight(c, 'files')])).toEqual([['src', 3], ['docs', 1], ['package.json', 1]]);
  });

  it('puts every file in the unknown language bucket when the bundle has no source index', async () => {
    const segments = without(await sampleSegments(), 'index.chunks', 'index.tokens');
    const model = buildStructure(segments, segments.strings, segments.meta);
    expect(model.hasIndex).toBe(false);
    expect(model.unknownLanguageFiles).toBe(5);
    expect(model.byPath.get('src/main.ts').language).toBe(null);
    expect(model.byPath.get('src').language).toBe(null);
  });

  it('marks multi-repo members at the top level only', async () => {
    const segments = await sampleSegments();
    const meta = { ...segments.meta, members: [{ name: 'src', files: 3, selected: 3 }, { name: 'util', files: 0 }] };
    const model = buildStructure(segments, segments.strings, meta);
    expect(model.byPath.get('src').member).toBe(true);
    expect(model.byPath.get('docs').member).toBe(false);
    expect(model.byPath.get('src/util').member).toBe(false);
  });

  it('locates a directory, a file in its directory, or nothing; breadcrumbs run from the root', async () => {
    const segments = await sampleSegments();
    const model = buildStructure(segments, segments.strings, segments.meta);
    expect(locate(model, 'src/util')).toMatchObject({ dir: { path: 'src/util' }, file: null });
    expect(locate(model, 'src/util/format.ts')).toMatchObject({ dir: { path: 'src/util' }, file: { path: 'src/util/format.ts' } });
    expect(locate(model, 'package.json')).toMatchObject({ dir: { path: '' }, file: { path: 'package.json' } });
    expect(locate(model, '')).toMatchObject({ dir: { path: '' }, file: null });
    expect(locate(model, 'src/nope')).toBe(null);
    expect(breadcrumbs('src/util/format.ts')).toEqual(['', 'src', 'src/util', 'src/util/format.ts']);
    expect(breadcrumbs('')).toEqual(['']);
  });
});

describe('name / path / id search (5.2)', () => {
  it('scores subsequences and rejects non-subsequences', () => {
    expect(subsequenceScore('frmt', 'format')).toBeGreaterThan(0);
    expect(subsequenceScore('tmrf', 'format')).toBe(-1);
    expect(subsequenceScore('', 'format')).toBe(-1);
    expect(subsequenceScore('format', 'format')).toBeGreaterThan(subsequenceScore('format', 'fxoxrxmxaxt'));
    expect(subsequenceScore('fg', 'format_greeting')).toBeGreaterThan(subsequenceScore('fg', 'xfxxxxgx'));
  });

  it('finds nodes by name, path or id, ranks name matches first and reports the total before the limit', async () => {
    const segments = await sampleSegments();
    const index = buildNameIndex(segments, segments.strings);
    const hits = searchNames(index, 'frmtgrt', 10);
    expect(hits.total).toBe(1);
    expect(idOf(segments, hits.hits[0].row)).toBe('function:src/util/format.ts:formatGreeting(name,times)');
    expect(hits.hits[0].field).toBe('name');
    // "Counter" by name: the class first; nodes in src/counter.ts match by path or id after it.
    const counter = searchNames(index, 'COUNTER', 10);
    expect(idOf(segments, counter.hits[0].row)).toBe('class:src/counter.ts:Counter');
    expect(counter.hits.slice(1).every((h) => h.field !== 'name' || idOf(segments, h.row).startsWith('file:'))).toBe(true);
    // A path-only match: "docs/" is in the path and id of the notes file, not its name.
    const docs = searchNames(index, 'docs/', 10);
    expect(docs.hits.map((h) => [idOf(segments, h.row), h.field])).toEqual([['file:docs/notes.md', 'id']]);
    const limited = searchNames(index, 's', 2);
    expect(limited.total).toBeGreaterThan(2);
    expect(limited.hits).toHaveLength(2);
    expect(searchNames(index, '   ', 5)).toMatchObject({ total: 0, hits: [] });
  });
});

describe('query engine (5.2)', () => {
  it('builds the identifier term index on the first identifier search only, with progress', async () => {
    const segments = await sampleSegments();
    const engine = new QueryEngine(segments);
    expect(engine.postingsState).toBe('idle');
    engine.run({ op: 'names', text: 'run', limit: 5 });
    expect(engine.postingsState).toBe('idle');
    const progress = [];
    let clock = 0;
    const first = engine.run({ op: 'identifiers', text: 'increment', limit: 10 }, (done, total) => progress.push([done, total]), () => (clock += 7));
    expect(engine.postingsState).toBe('ready');
    expect(progress.at(-1)).toEqual([9, 9]);
    expect(first).toMatchObject({ available: true, terms: ['increment'], missingTerms: [], scope: 'identifiers+literals', total: 1, buildMs: 7 });
    // "increment" is a method with no node of its own: it is in no node name,
    // path or id, only in the class chunk's identifiers.
    expect(first.rows.map((row) => idOf(segments, row))).toEqual(['class:src/counter.ts:Counter']);
    expect(searchNames(buildNameIndex(segments, segments.strings), 'increment', 10).total).toBe(0);
    // "banner" comes from a template literal: found through the embedded literal text.
    expect(engine.run({ op: 'identifiers', text: 'banner', limit: 10 }).rows.map((row) => idOf(segments, row)))
      .toEqual(['file:src/util/format.ts', 'function:src/util/format.ts:formatGreeting(name,times)']);
    const second = engine.run({ op: 'identifiers', text: 'formatGreeting', limit: 10 }, () => progress.push('again'));
    expect(second).toMatchObject({ terms: ['format', 'greeting'], total: 1, buildMs: 0 });
    expect(progress).not.toContain('again');
    expect(engine.run({ op: 'identifiers', text: 'nosuchterm increment', limit: 10 })).toMatchObject({ missingTerms: ['nosuchterm'], total: 0, rows: [] });
    expect(engine.run({ op: 'identifiers', text: '++', limit: 10 })).toMatchObject({ terms: [], total: 0 });
  });

  it('covers identifiers only when the literal text is not embedded', async () => {
    const full = new QueryEngine(await sampleSegments());
    expect(full.run({ op: 'identifiers', text: 'hello', limit: 10 })).toMatchObject({ total: 2, scope: 'identifiers+literals' });
    const segments = without(await sampleSegments(), 'indexLiterals', 'indexLiterals.strings');
    const engine = new QueryEngine(segments);
    expect(engine.run({ op: 'identifiers', text: 'hello', limit: 10 })).toMatchObject({ total: 0, missingTerms: ['hello'], scope: 'identifiers' });
    expect(engine.run({ op: 'identifiers', text: 'banner', limit: 10 })).toMatchObject({ total: 0, scope: 'identifiers' });
    expect(engine.run({ op: 'identifiers', text: 'increment', limit: 10 })).toMatchObject({ total: 1, scope: 'identifiers' });
  });

  it('says identifier search is unavailable without a source index, and still answers name searches', async () => {
    const segments = without(await sampleSegments(), 'index.chunks', 'index.tokens');
    const engine = new QueryEngine(segments);
    expect(engine.postingsState).toBe('unavailable');
    expect(engine.run({ op: 'identifiers', text: 'increment', limit: 10 })).toEqual({ available: false, query: 'increment' });
    expect(engine.run({ op: 'names', text: 'shout', limit: 10 }).total).toBe(1);
  });

  it('counts matching chunks whose node is not in the graph instead of dropping them', async () => {
    const segments = await sampleSegments();
    const chunks = segments['index.chunks'];
    const node = new Int32Array(chunks.columns.node);
    const strings = [...segments.strings, 'function:not/in/graph.ts:ghost()'];
    for (let row = 0; row < chunks.rows; row += 1) {
      if (strings[node[row]] === 'function:src/util/format.ts:formatGreeting(name,times)') node[row] = strings.length - 1;
    }
    const engine = new QueryEngine({ ...segments, strings, 'index.chunks': { rows: chunks.rows, columns: { ...chunks.columns, node } } });
    const result = engine.run({ op: 'identifiers', text: 'banner', limit: 10 });
    expect(result).toMatchObject({ total: 1, chunksOutsideGraph: 1 });
  });

  it('keeps its own copy of the columns it reads (the Worker transfers the originals away)', async () => {
    const segments = await sampleSegments();
    const kept = retainForQueries(segments);
    expect(Object.keys(kept).sort()).toEqual(['index.chunks', 'index.tokens', 'indexLiterals', 'indexLiterals.strings', 'nodes', 'strings']);
    expect(Object.keys(kept.nodes.columns).sort()).toEqual(['id', 'name', 'path', 'type']);
    expect(kept.nodes.columns.name.buffer).not.toBe(segments.nodes.columns.name.buffer);
    const before = new QueryEngine(kept).run({ op: 'names', text: 'shout', limit: 5 });
    segments.nodes.columns.name.fill(-1);
    segments.nodes.columns.id.fill(-1);
    segments.nodes.columns.path.fill(-1);
    expect(new QueryEngine(kept).run({ op: 'names', text: 'shout', limit: 5 })).toEqual(before);
    expect(before.total).toBe(1);
  });
});
