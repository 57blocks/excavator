// unused-code, task 2.3: the name census. For every candidate, how often its
// name occurs in the selected files outside the places the facts explain (its
// own declaration line and the line ranges of its direct referrers). Pure-function
// tests call `computeCensus` on in-memory files; CLI tests run the script on temp
// project directories, including a git repository whose working tree has drifted
// from HEAD.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { writeKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';
import { writeStructureAll } from '../../skills/excavator/structure-all-store.mjs';
import { computeCensus } from '../../skills/excavator/unused-code.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../../skills/excavator/unused-code.mjs');

// ---------------------------------------------------------------------------
// Pure census
// ---------------------------------------------------------------------------

/** A candidate as the product carries it: only what the census reads. */
const candidate = (name, file, lineRange, referrers = []) => ({
  id: `function:${file}:${name}()`, name, file, lineRange, referrers: referrers.map((id) => ({ id })),
});
const idOf = (c) => c.id;
const source = (path, ...lines) => ({ path, text: lines.join('\n') });
const census = (candidates, files, nodes = []) => computeCensus({ candidates, nodes, files });
const elsewhereOf = (result, i = 0) => result.byCandidate[i];

describe('reflection and plain occurrences', () => {
  const calc = ['class Calc {', '  private void recalc() {', '  }', '}'];
  const recalc = candidate('recalc', 'src/Calc.java', [2, 3]);

  // O1 instrument check: the reflective string is the only difference between
  // the two runs, and it flips the count from 0 to 1. A census that cannot see
  // string contents would report 0 for both and this pair would not tell.
  it('counts a name inside a reflection string in another file, with its line', () => {
    const files = [
      source('src/Calc.java', ...calc),
      source('src/Reflect.java', 'class Reflect {', '  void go() {', '    m = c.getDeclaredMethod("recalc");', '  }', '}'),
    ];
    expect(elsewhereOf(census([recalc], files))).toEqual({
      elsewhere: 1, samples: [{ file: 'src/Reflect.java', line: 3 }], sameNameDeclarationsOnly: false,
    });
  });

  it('counts 0 for the same fixture with the reflective line removed', () => {
    const files = [
      source('src/Calc.java', ...calc),
      source('src/Reflect.java', 'class Reflect {', '  void go() {', '    m = c.getDeclaredMethod("other");', '  }', '}'),
    ];
    expect(elsewhereOf(census([recalc], files))).toEqual({ elsewhere: 0, samples: [], sameNameDeclarationsOnly: false });
  });

  it('counts an occurrence in a comment, in its own file or another', () => {
    const old = candidate('old', 'src/A.java', [2, 2]);
    const files = [
      source('src/A.java', '// TODO: remove old', 'void old() {}'),
      source('notes.md', 'we still call old sometimes'),
    ];
    expect(elsewhereOf(census([old], files))).toMatchObject({
      elsewhere: 2, samples: [{ file: 'notes.md', line: 1 }, { file: 'src/A.java', line: 1 }],
    });
  });

  it('counts a call from a file of another language that has no edge into the method', () => {
    const toDto = candidate('toDto', 'src/Mapper.java', [2, 2]);
    const files = [
      source('src/Mapper.java', 'class Mapper {', '  Dto toDto(Row r) { return null; }', '}'),
      source('src/Caller.kt', 'class Caller {', '  fun f(r: Row) {', '    val d = mapper.toDto(r)', '  }', '}'),
    ];
    expect(elsewhereOf(census([toDto], files))).toEqual({
      elsewhere: 1, samples: [{ file: 'src/Caller.kt', line: 3 }], sameNameDeclarationsOnly: false,
    });
  });

  it('numbers lines from 1 on `\\n` and ignores a `\\r` before it', () => {
    const run = candidate('run', 'src/A.java', [1, 1]);
    const result = census([run], [{ path: 'src/A.java', text: 'void run() {}\r\n\r\nrun();\r\n' }]);
    expect(elsewhereOf(result)).toMatchObject({ elsewhere: 1, samples: [{ file: 'src/A.java', line: 3 }] });
  });
});

describe('what the facts explain', () => {
  it('a caller in the cluster: two calls from the referrer body, one calls edge, nothing elsewhere', () => {
    const file = ['class C {', '  private void a() {}', '  void b() {', '    a();', '    a();', '  }', '}'];
    const a = candidate('a', 'src/C.java', [2, 2], ['function:src/C.java:b()']);
    const b = candidate('b', 'src/C.java', [3, 6]);
    const result = census([a, b], [source('src/C.java', ...file)]);
    expect(result.byCandidate).toEqual([
      { elsewhere: 0, samples: [], sameNameDeclarationsOnly: false },
      { elsewhere: 0, samples: [], sameNameDeclarationsOnly: false },
    ]);
  });

  it('a referrer in another file explains the occurrences inside its range, not the ones outside it', () => {
    const helper = candidate('helper', 'src/A.java', [2, 2], ['function:src/B.java:caller()']);
    const caller = candidate('caller', 'src/B.java', [2, 5]);
    const files = [
      source('src/A.java', 'class A {', '  static void helper() {}', '}'),
      source('src/B.java', 'class B {', '  void caller() {', '    A.helper();', '    A.helper();', '  }', '  void other() {', '    A.helper();', '  }', '}'),
    ];
    expect(elsewhereOf(census([helper, caller], files))).toEqual({
      elsewhere: 1, samples: [{ file: 'src/B.java', line: 7 }], sameNameDeclarationsOnly: false,
    });
  });

  it('merges overlapping referrer ranges and counts a line between disjoint ones as elsewhere', () => {
    const target = candidate('t', 'src/T.java', [1, 1], ['function:src/R.java:r1()', 'function:src/R.java:r2()', 'function:src/R.java:r3()']);
    const referrers = [
      candidate('r1', 'src/R.java', [2, 4]), candidate('r2', 'src/R.java', [3, 6]), candidate('r3', 'src/R.java', [9, 10]),
    ];
    const lines = ['', '', 't', 't', 't', 't', 't', 't', 't', 't', 't'];
    const result = census([target, ...referrers], [source('src/T.java', 'void t() {}'), source('src/R.java', ...lines)]);
    // Lines 3-6 and 9-10 hold `t` inside referrer ranges; line 7, 8 and 11 are outside (line 11 beyond the range).
    expect(elsewhereOf(result)).toMatchObject({ elsewhere: 3, samples: [{ file: 'src/R.java', line: 7 }, { file: 'src/R.java', line: 8 }, { file: 'src/R.java', line: 11 }] });
  });

  it('a self-call explains its whole range; without the edge a second occurrence on the declaration line is elsewhere', () => {
    const body = source('src/A.java', 'class A {', '  void dup() { dup(); }', '}');
    const withEdge = candidate('dup', 'src/A.java', [2, 2], ['function:src/A.java:dup()']);
    expect(elsewhereOf(census([withEdge], [body])).elsewhere).toBe(0);
    const withoutEdge = candidate('dup', 'src/A.java', [2, 2]);
    expect(elsewhereOf(census([withoutEdge], [body]))).toEqual({
      elsewhere: 1, samples: [{ file: 'src/A.java', line: 2 }], sameNameDeclarationsOnly: false,
    });
  });

  it('takes the first line within the range where the name occurs as the declaration, so an annotation line above it does not hide one', () => {
    const run = candidate('run', 'src/A.java', [2, 3]);
    const result = census([run], [source('src/A.java', 'class A {', '  @Override', '  void run() {}', '}')]);
    expect(elsewhereOf(result).elsewhere).toBe(0);
  });

  it('an occurrence on an annotation line inside the referrer range is explained, and elsewhere once the range excludes it', () => {
    const file = source('src/T.java', 'class T {', '  private void a() {}', '  @MethodSource("a")', '  void b() { a(); }', '}');
    const inside = [candidate('a', 'src/T.java', [2, 2], ['function:src/T.java:b()']), candidate('b', 'src/T.java', [3, 4])];
    expect(elsewhereOf(census(inside, [file])).elsewhere).toBe(0);
    const outside = [candidate('a', 'src/T.java', [2, 2], ['function:src/T.java:b()']), candidate('b', 'src/T.java', [4, 4])];
    expect(elsewhereOf(census(outside, [file]))).toMatchObject({ elsewhere: 1, samples: [{ file: 'src/T.java', line: 3 }] });
  });
});

describe('same-name declarations', () => {
  const a = candidate('formatDate', 'src/A.java', [2, 2]);
  const b = candidate('formatDate', 'src/B.java', [2, 2]);
  const declarations = [
    source('src/A.java', 'class A {', '  String formatDate() { return ""; }', '}'),
    source('src/B.java', 'class B {', '  String formatDate() { return ""; }', '}'),
  ];

  it('two classes each declaring formatDate: each candidate sees the other as its only elsewhere occurrence', () => {
    const result = census([a, b], declarations);
    expect(result.byCandidate).toEqual([
      { elsewhere: 1, samples: [{ file: 'src/B.java', line: 2 }], sameNameDeclarationsOnly: true },
      { elsewhere: 1, samples: [{ file: 'src/A.java', line: 2 }], sameNameDeclarationsOnly: true },
    ]);
    expect(result.header).toMatchObject({ candidatesWithElsewhere: 2, sameNameDeclarationsOnly: 2 });
  });

  it('a real call elsewhere flips the flag', () => {
    const result = census([a, b], [...declarations, source('src/C.java', 'class C {', '  void go() { x.formatDate(); }', '}')]);
    expect(result.byCandidate.map((r) => [r.elsewhere, r.sameNameDeclarationsOnly])).toEqual([[2, false], [2, false]]);
    expect(result.header).toMatchObject({ candidatesWithElsewhere: 2, sameNameDeclarationsOnly: 0 });
  });

  it('a declaration by a node that is not a candidate counts, when the graph nodes say so', () => {
    const files = [declarations[0], source('src/D.java', 'class D {', '  String formatDate() { return ""; }', '}')];
    const node = { id: 'function:src/D.java:formatDate()', type: 'function', name: 'formatDate', filePath: 'src/D.java', lineRange: [2, 2] };
    expect(elsewhereOf(census([a], files, [node])).sameNameDeclarationsOnly).toBe(true);
    // The same occurrence with no node declared there is an unexplained one.
    expect(elsewhereOf(census([a], files, [])).sameNameDeclarationsOnly).toBe(false);
    // A class node with that name works the same way.
    const classNode = { id: 'class:src/D.java:formatDate', type: 'class', name: 'formatDate', filePath: 'src/D.java', lineRange: [2, 2] };
    expect(elsewhereOf(census([a], files, [classNode])).sameNameDeclarationsOnly).toBe(true);
  });

  it('a file node or another node type does not make an occurrence a declaration', () => {
    const files = [declarations[0], source('src/D.java', 'class D {', '  String formatDate() { return ""; }', '}')];
    const table = { id: 'table:src/D.java:formatDate', type: 'table', name: 'formatDate', filePath: 'src/D.java', lineRange: [2, 2] };
    expect(elsewhereOf(census([a], files, [table])).sameNameDeclarationsOnly).toBe(false);
  });

  it('an own-line second occurrence is not another node\'s declaration', () => {
    const dup = candidate('dup', 'src/A.java', [2, 2]);
    const result = census([dup], [source('src/A.java', 'class A {', '  void dup() { dup(); }', '}')]);
    expect(elsewhereOf(result)).toMatchObject({ elsewhere: 1, sameNameDeclarationsOnly: false });
  });
});

describe('tokens', () => {
  const foo = candidate('foo', 'src/A.java', [1, 1]);
  const own = source('src/A.java', 'void foo() {}');

  it('does not count $foo, foo$bar, foo2 or _foo as an occurrence of foo', () => {
    const noise = source('b.js', '$foo(); foo$bar(); foo2(); _foo(); xfoo();');
    expect(elsewhereOf(census([foo], [own, noise])).elsewhere).toBe(0);
  });

  it('counts foo next to punctuation and in a path, case-sensitively', () => {
    const uses = source('b.js', 'a.foo(); (foo); "foo"; /x/foo/y; Foo(); FOO();');
    expect(elsewhereOf(census([foo], [own, uses]))).toMatchObject({ elsewhere: 4, samples: [{ file: 'b.js', line: 1 }] });
  });

  it('counts a candidate named $foo as the token $foo', () => {
    const dollar = candidate('$foo', 'src/A.js', [1, 1]);
    const result = census([dollar], [source('src/A.js', 'function $foo() {}'), source('b.js', '$foo(); foo();')]);
    expect(elsewhereOf(result)).toMatchObject({ elsewhere: 1, samples: [{ file: 'b.js', line: 1 }] });
  });

  it('gives a candidate whose name is not a plain identifier census null, never zero, and counts it', () => {
    const umlaut = candidate('überprüfen', 'src/A.java', [1, 1]);
    const result = census([umlaut, foo], [own, source('b.js', 'foo();')]);
    expect(result.byCandidate[0]).toBeNull();
    expect(result.byCandidate[1]).toMatchObject({ elsewhere: 1 });
    expect(result.header).toMatchObject({ namesNotIdentifiers: 1, candidatesWithElsewhere: 1 });
  });
});

describe('totals and samples', () => {
  it('keeps the total exact when samples are truncated: 12 occurrences, 5 samples in (file, line) order', () => {
    const run = candidate('run', 'src/A.java', [1, 1]);
    const lines = Array.from({ length: 12 }, () => 'run();');
    // Files arrive out of order on purpose: the samples are still the first five by (file, line).
    const files = [
      source('src/z.java', ...lines.slice(0, 6)),
      source('src/A.java', 'void run() {}'),
      source('src/b.java', ...lines.slice(0, 6)),
    ];
    const result = elsewhereOf(census([run], files));
    expect(result.elsewhere).toBe(12);
    expect(result.samples).toEqual([1, 2, 3, 4, 5].map((line) => ({ file: 'src/b.java', line })));
  });

  it('counts every occurrence on a line but samples the line once', () => {
    const run = candidate('run', 'src/A.java', [1, 1]);
    const result = elsewhereOf(census([run], [source('src/A.java', 'void run() {}'), source('b.js', 'run(); run(); run();')]));
    expect(result).toMatchObject({ elsewhere: 3, samples: [{ file: 'b.js', line: 1 }] });
  });

  it('shares a hot name across candidates without cross-talk', () => {
    const one = candidate('get', 'src/A.java', [2, 2]);
    const two = candidate('get', 'src/B.java', [2, 2], ['function:src/B.java:use()']);
    const use = candidate('use', 'src/B.java', [3, 5]);
    const files = [
      source('src/A.java', 'class A {', '  Object get() { return 1; }', '}'),
      source('src/B.java', 'class B {', '  Object get() { return 2; }', '  void use() {', '    get();', '  }', '}'),
    ];
    const result = census([one, two, use], files);
    expect(result.byCandidate[0]).toMatchObject({ elsewhere: 2, samples: [{ file: 'src/B.java', line: 2 }, { file: 'src/B.java', line: 4 }] });
    expect(result.byCandidate[1]).toMatchObject({ elsewhere: 1, samples: [{ file: 'src/A.java', line: 2 }] });
  });

  it('counts the files, the skipped binary files and the files read from the snapshot', () => {
    const run = candidate('run', 'src/A.java', [1, 1]);
    const files = [
      { path: 'src/A.java', text: 'void run() {}' },
      { path: 'blob.bin', text: null },
      { path: 'b.js', text: 'run();', fromSnapshot: true },
    ];
    expect(census([run], files).header).toEqual({
      files: 3, filesSkippedBinary: 1, filesReadFromSnapshot: 1, namesNotIdentifiers: 0, candidatesWithElsewhere: 1, sameNameDeclarationsOnly: 0,
    });
  });

  it('streams the files: a generator is consumed once, and an error it throws propagates', () => {
    const run = candidate('run', 'src/A.java', [1, 1]);
    function* files() {
      yield source('src/A.java', 'void run() {}');
      yield source('b.js', 'run();');
    }
    expect(elsewhereOf(census([run], files())).elsewhere).toBe(1);
    function* broken() {
      yield source('src/A.java', 'void run() {}');
      throw new Error('source differs from the facts (b.js); run Lazy again');
    }
    expect(() => census([run], broken())).toThrow(/source differs/);
  });

  it('is empty and consistent with no candidates or no files', () => {
    expect(census([], [source('a', 'x')])).toEqual({
      byCandidate: [],
      header: { files: 1, filesSkippedBinary: 0, filesReadFromSnapshot: 0, namesNotIdentifiers: 0, candidatesWithElsewhere: 0, sameNameDeclarationsOnly: 0 },
    });
    expect(elsewhereOf(census([candidate('run', 'src/A.java', [1, 1])], []))).toEqual({ elsewhere: 0, samples: [], sameNameDeclarationsOnly: false });
  });

  it('gives the same result whatever the order of the files', () => {
    const cs = [candidate('a', 'src/A.java', [1, 1]), candidate('b', 'src/B.java', [1, 1], ['function:src/A.java:a()'])];
    const files = [
      source('src/A.java', 'void a() { b(); }'), source('src/B.java', 'void b() { a(); }'), source('c.js', 'a(); b(); a();'), source('d.js', '// a b'),
    ];
    expect(census(cs, [...files].reverse())).toEqual(census(cs, files));
  });
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fnNode = (file, owner, name, lineRange) => ({
  id: `function:${file}:${owner}#${name}()`, type: 'function', name, filePath: file, lineRange, owner,
});
const CALC = ['class Calc {', '  private void recalc() {}', '  private void dead() {}', '}'].join('\n');
const REFLECT = ['class Reflect {', '  Object m = c.getDeclaredMethod("recalc");', '}'].join('\n');
const CALC_NODES = [fnNode('src/Calc.java', 'Calc', 'recalc', [2, 2]), fnNode('src/Calc.java', 'Calc', 'dead', [3, 3])];

describe('candidates CLI census', () => {
  const dirs = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  /** A project dir with `.excavator/` inputs; `files` are written to the working tree, `manifestEntries` default to hashing them. */
  function project({ files, manifestEntries, nodes = CALC_NODES, parent = null } = {}) {
    const base = mkdtempSync(join(tmpdir(), 'unused-code-census-'));
    dirs.push(base);
    const root = parent ? join(base, parent) : base;
    mkdirSync(root, { recursive: true });
    for (const [path, content] of Object.entries(files ?? {})) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    const data = join(root, '.excavator');
    mkdirSync(join(data, 'intermediate'), { recursive: true });
    writeKnowledgeGraph(join(data, 'intermediate', 'fact-graph.jsonl'), {
      nodes, edges: [], coverage: [], gaps: [], factsDigest: 'census-digest',
    });
    writeStructureAll(join(data, 'intermediate', 'structure-all.jsonl'), { scriptCompleted: true, results: [] });
    const entries = manifestEntries ?? Object.entries(files ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([path, content]) => ({ path, contentHash: sha256(content) }));
    writeFileSync(join(data, 'source-manifest.json'), JSON.stringify({ sourceRevision: 'git:census', entries }));
    return { base, root, product: join(data, 'unused-candidates.json') };
  }
  const run = (root) => spawnSync(process.execPath, [SCRIPT, 'candidates', root], { encoding: 'utf-8' });
  const read = (path) => JSON.parse(readFileSync(path, 'utf-8'));

  it('adds census to every candidate and the census block to the header', () => {
    const { root, product } = project({ files: { 'src/Calc.java': CALC, 'src/Reflect.java': REFLECT } });
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
    const written = read(product);
    expect(Object.keys(written)).toEqual(['format', 'factsDigest', 'sourceRevision', 'counts', 'conservation', 'census', 'types', 'candidates']);
    expect(written.census).toEqual({
      files: 2, filesSkippedBinary: 0, filesReadFromSnapshot: 0, namesNotIdentifiers: 0, candidatesWithElsewhere: 1, sameNameDeclarationsOnly: 0,
    });
    expect(written.candidates.map((c) => [c.name, c.census])).toEqual([
      ['dead', { elsewhere: 0, samples: [], sameNameDeclarationsOnly: false }],
      ['recalc', { elsewhere: 1, samples: [{ file: 'src/Reflect.java', line: 2 }], sameNameDeclarationsOnly: false }],
    ]);
    expect(JSON.parse(result.stdout).census).toEqual(written.census);
  });

  it('removing the reflective line zeroes the count (instrument check at the CLI)', () => {
    const { root, product } = project({ files: { 'src/Calc.java': CALC, 'src/Reflect.java': REFLECT.replace('recalc', 'other') } });
    expect(run(root).status).toBe(0);
    expect(read(product).candidates.map((c) => c.census.elsewhere)).toEqual([0, 0]);
  });

  it('skips a selected file with a NUL byte and counts it, without counting its content', () => {
    const { root, product } = project({
      files: { 'src/Calc.java': CALC, 'lib/data.bin': Buffer.from('recalc\0\0recalc') },
    });
    expect(run(root).status).toBe(0);
    const written = read(product);
    expect(written.census).toMatchObject({ files: 2, filesSkippedBinary: 1 });
    expect(written.candidates.map((c) => c.census.elsewhere)).toEqual([0, 0]);
  });

  it('keeps census null for a candidate whose name is not an identifier, and counts it', () => {
    const umlaut = fnNode('src/Calc.java', 'Calc', 'überprüfen', [4, 4]);
    const { root, product } = project({ files: { 'src/Calc.java': CALC }, nodes: [...CALC_NODES, umlaut] });
    expect(run(root).status).toBe(0);
    const written = read(product);
    expect(written.census.namesNotIdentifiers).toBe(1);
    expect(written.candidates.find((c) => c.name === 'überprüfen').census).toBeNull();
  });

  it('exits non-zero, writes nothing and says to run Lazy again when a selected file changed since the facts', () => {
    const { root, product } = project({
      files: { 'src/Calc.java': `${CALC}\n// edited`, 'src/Reflect.java': REFLECT },
      manifestEntries: [
        { path: 'src/Calc.java', contentHash: sha256(CALC) },
        { path: 'src/Reflect.java', contentHash: sha256(REFLECT) },
      ],
    });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/source differs from the facts \(src\/Calc\.java\); run Lazy again/);
    expect(existsSync(product)).toBe(false);
  });

  it('fails the same way for a selected file that no longer exists', () => {
    const { root, product } = project({
      files: { 'src/Calc.java': CALC },
      manifestEntries: [{ path: 'src/Calc.java', contentHash: sha256(CALC) }, { path: 'src/Gone.java', contentHash: sha256('gone') }],
    });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/source differs from the facts \(src\/Gone\.java\)/);
    expect(existsSync(product)).toBe(false);
  });

  it('never reads a manifest path that leaves the project, even when its hash matches', () => {
    const outside = 'recalc outside the project';
    const { base, root, product } = project({ files: { 'src/Calc.java': CALC }, parent: 'proj' });
    writeFileSync(join(base, 'outside.txt'), outside);
    writeFileSync(join(root, '.excavator', 'source-manifest.json'), JSON.stringify({
      sourceRevision: 'git:census',
      entries: [{ path: 'src/Calc.java', contentHash: sha256(CALC) }, { path: '../outside.txt', contentHash: sha256(outside) }],
    }));
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/source differs from the facts \(\.\.\/outside\.txt\)/);
    expect(existsSync(product)).toBe(false);
  });

  it('never reads a symlinked manifest path, even when the target content matches', () => {
    const target = 'recalc through a link';
    const { base, root, product } = project({ files: { 'src/Calc.java': CALC }, parent: 'proj' });
    writeFileSync(join(base, 'target.txt'), target);
    symlinkSync(join(base, 'target.txt'), join(root, 'src', 'link.txt'));
    writeFileSync(join(root, '.excavator', 'source-manifest.json'), JSON.stringify({
      sourceRevision: 'git:census',
      entries: [{ path: 'src/Calc.java', contentHash: sha256(CALC) }, { path: 'src/link.txt', contentHash: sha256(target) }],
    }));
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/source differs from the facts \(src\/link\.txt\)/);
    expect(existsSync(product)).toBe(false);
  });

  it('rejects a manifest whose entries are not { path, contentHash }', () => {
    const { root, product } = project({ files: { 'src/Calc.java': CALC } });
    writeFileSync(join(root, '.excavator', 'source-manifest.json'), JSON.stringify({ sourceRevision: 'git:census', entries: [{ path: 'src/Calc.java' }] }));
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/entries/);
    expect(existsSync(product)).toBe(false);
  });

  describe('in a git repository', () => {
    const git = (dir, ...args) => {
      const result = spawnSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf-8' });
      expect(result.status, result.stderr).toBe(0);
    };

    function committed() {
      const made = project({ files: { 'src/Calc.java': CALC, 'src/Reflect.java': REFLECT } });
      git(made.root, 'init', '-q');
      git(made.root, 'add', 'src');
      git(made.root, 'commit', '-q', '-m', 'sources');
      return made;
    }

    it('reads HEAD through the snapshot when the working tree has uncommitted changes', () => {
      const { root, product } = committed();
      // The manifest hashes are HEAD's. An uncommitted edit removes the reflective line from the working tree.
      writeFileSync(join(root, 'src', 'Reflect.java'), REFLECT.replace('recalc', 'other'));
      const result = run(root);
      expect(result.status, result.stderr).toBe(0);
      const written = read(product);
      expect(written.census).toMatchObject({ files: 2, filesReadFromSnapshot: 1 });
      expect(written.candidates.find((c) => c.name === 'recalc').census)
        .toEqual({ elsewhere: 1, samples: [{ file: 'src/Reflect.java', line: 2 }], sameNameDeclarationsOnly: false });
    });

    it('reads the working tree, not the snapshot, while it matches the manifest', () => {
      const { root, product } = committed();
      const result = run(root);
      expect(result.status, result.stderr).toBe(0);
      expect(read(product).census.filesReadFromSnapshot).toBe(0);
    });

    it('still fails when neither the working tree nor HEAD matches the manifest', () => {
      const { root, product } = committed();
      writeFileSync(join(root, '.excavator', 'source-manifest.json'), JSON.stringify({
        sourceRevision: 'git:census',
        entries: [{ path: 'src/Calc.java', contentHash: sha256('something else') }],
      }));
      const result = run(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/source differs from the facts \(src\/Calc\.java\); run Lazy again/);
      expect(existsSync(product)).toBe(false);
    });
  });
});
