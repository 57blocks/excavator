/**
 * validate-graph.mjs — a declaration head or a call expression written over several lines.
 *
 * An extractor cites the first line of a construct, and the name the validator looks for is a few lines
 * below: the callee of a call expression, or the name of a declaration whose modifiers wrap onto a line of
 * their own. Each rule exists only in the languages that have the syntax, so each case is written per
 * language: the shapes that must be read, the statements that must not be taken for them, and the languages
 * that do not have them.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as validator from '../../../skills/excavator/validate-graph.mjs';

const { validateAgainstSource, createSourceReader } = validator;
// Absent on a validator that has no leading-line bound yet, so this file still loads and its cases go red one by one.
const CONSTRUCT_SCAN_LINES = validator.CONSTRUCT_SCAN_LINES ?? 400;

const VALIDATE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../skills/excavator/validate-graph.mjs');

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function project(sources) {
  const root = mkdtempSync(join(tmpdir(), 'excavator-constructs-'));
  tempDirs.push(root);
  for (const [rel, lines] of Object.entries(sources)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `${lines.join('\n')}\n`);
  }
  return root;
}

const fileNode = (path) => ({
  id: `file:${path}`, type: 'file', name: path.split('/').pop(), filePath: path, summary: '', tags: [], complexity: 'simple',
});
const declNode = (type, path, name, lineRange) => ({
  id: `${type}:${path}:${name}`, type, name, filePath: path, lineRange, summary: '', tags: [], complexity: 'simple',
});
const edge = (type, source, target, file, line, from = 'tree-sitter') => ({
  source: source.id, target: target.id, type, direction: 'forward', weight: 1,
  provenance: 'extracted', evidence: [{ file, line, source: from }],
});

function run(root, nodes, edges = []) {
  const graph = {
    version: '1.0.0',
    project: { name: 'fixture', languages: [], frameworks: [], description: '', analyzedAt: '2026-10-27T00:00:00.000Z', gitCommitHash: null },
    nodes, edges, layers: [{ id: 'l', name: 'L', description: 'L', nodeIds: nodes.filter((n) => n.type === 'file').map((n) => n.id) }], tour: [],
  };
  return validateAgainstSource({ graph, reader: createSourceReader(root), sampleLimit: 5 });
}

/** A declaration block of `count` lines of nested annotations whose string literals hold brackets, `@` and `\n`. */
function bigAnnotationBlock(count) {
  const lines = ['@Outer(', '    values = {'];
  while (lines.length < count - 3) {
    lines.push(`      @Inner(text = "dn: ) ( @x\\n", n = ${lines.length}),`);
  }
  lines.push('    })', '@Marker', '@Last("a)b")');
  return lines;
}

describe('validate-graph — a declaration head that wraps its modifiers onto a line before the name', () => {
  it('confirms the anchor and the edges of a method whose modifiers and return type are on their own line', () => {
    const lines = [
      'class W {', //                                    1
      '  @Test', //                                       2
      '  public void', //                                 3
      '  testWrapped() throws Exception {}', //            4
      '', //                                               5
      '  public static', //                                6
      '  void bare() {}', //                               7
      '}', //                                                8
    ];
    const root = project({ 'src/W.java': lines });
    const file = fileNode('src/W.java');
    const wrapped = declNode('function', 'src/W.java', 'testWrapped', [2, 4]);
    const bare = declNode('function', 'src/W.java', 'bare', [6, 7]);
    const { report } = run(root, [file, wrapped, bare], [
      edge('contains', file, wrapped, 'src/W.java', 2),
      edge('exports', file, wrapped, 'src/W.java', 2),
      edge('contains', file, bare, 'src/W.java', 6),
    ]);
    expect(report.counts.anchorMismatch).toBe(0);
    expect(report.counts.edgeContradicted).toBe(0);
    expect(report.counts.edgeConfirmed).toBe(3);
  });

  it('follows a head that wraps over several lines while each line holds only words and types', () => {
    const lines = ['class K {', '  public static final', '  int', '  LIMIT = 4;', '}'];
    const root = project({ 'src/K.java': lines });
    const file = fileNode('src/K.java');
    const limit = declNode('function', 'src/K.java', 'LIMIT', [2, 4]);
    const { report } = run(root, [file, limit], [edge('contains', file, limit, 'src/K.java', 2)]);
    expect(report.counts.anchorMismatch).toBe(0);
    expect(report.counts.edgeConfirmed).toBe(1);
  });

  it('does not look past a declaration line that is already complete', () => {
    const lines = ['class D {', '  void first() {}', '  void second() {}', '}'];
    const root = project({ 'src/D.java': lines });
    const file = fileNode('src/D.java');
    const second = declNode('function', 'src/D.java', 'second', [3, 3]);
    const { report } = run(root, [file, second], [
      edge('contains', file, second, 'src/D.java', 2),
      edge('exports', file, second, 'src/D.java', 2),
    ]);
    expect(report.counts.edgeContradicted).toBe(2);
  });

  it('does not read a head past a line that starts with a modifier but is already complete', () => {
    const lines = ['class D {', '  public void first() {}', '  void second() {}', '}'];
    const root = project({ 'src/D.java': lines });
    const file = fileNode('src/D.java');
    const second = declNode('function', 'src/D.java', 'second', [2, 3]);
    const { report } = run(root, [file, second], [edge('contains', file, second, 'src/D.java', 2)]);
    expect(report.counts.anchorMismatch).toBe(0);
    expect(report.counts.edgeContradicted).toBe(1);
  });

  // A line that is a statement, or that starts with a word that also starts a statement. None may be taken
  // for the start of a wrapped head, so none may let an edge that cites it reach the name on the next line.
  const NOT_A_HEAD = [
    ['java', 'return x'], ['java', 'break'], ['java', 'else'], ['java', 'import foo.Bar'], ['java', 'package app'],
    ['ts', 'export default router'], ['ts', 'export const router'], ['ts', 'const router'], ['ts', 'static x'], ['ts', 'async'],
    ['kt', 'val x'], ['kt', 'object Registry'], ['cs', 'using System'], ['cs', 'return value'], ['php', 'namespace App'], ['php', 'return $x'],
    ['java', 'export default router'], ['java', 'const router'], ['java', 'static x'], ['cs', 'async'], ['cs', 'static x'], ['cs', 'export x'],
  ];
  it.each(NOT_A_HEAD)('%s: does not read %j as the start of a wrapped head', (ext, statement) => {
    const path = `src/s.${ext}`;
    const root = project({ [path]: [statement, 'helper() {}', ''] });
    const file = fileNode(path);
    const helper = declNode('function', path, 'helper', [1, 2]);
    const { report } = run(root, [file, helper], [edge('contains', file, helper, path, 1)]);
    expect(report.counts.edgeContradicted).toBe(1);
  });

  // Declaration heads wrap only in the languages that have these modifiers.
  it.each([['py', 'public'], ['rb', 'public'], ['go', 'public'], ['txt', 'public'], ['js', 'public'], ['rs', 'public'],
    ['kt', 'override'], ['scala', 'final'], ['ts', 'public'], ['php', 'public'], ['swift', 'public'], ['dart', 'final'], ['groovy', 'public']])(
    '%s: does not read %j as the start of a wrapped head', (ext, line) => {
      const path = `src/s.${ext}`;
      const root = project({ [path]: [line, 'helper() {}', ''] });
      const file = fileNode(path);
      const helper = declNode('function', path, 'helper', [1, 2]);
      const { report } = run(root, [file, helper], [edge('contains', file, helper, path, 1)]);
      expect(report.counts.edgeContradicted).toBe(1);
    },
  );

  it.each([['java', 'public'], ['java', 'protected'], ['java', 'final'], ['cs', 'private'], ['cs', 'internal'], ['cs', 'override']])(
    '%s: reads %j as the start of a wrapped head', (ext, modifier) => {
      const path = `src/s.${ext}`;
      const root = project({ [path]: [modifier, 'helper() {}', ''] });
      const file = fileNode(path);
      const helper = declNode('function', path, 'helper', [1, 2]);
      const { report } = run(root, [file, helper], [edge('contains', file, helper, path, 1)]);
      expect(report.counts.edgeConfirmed).toBe(1);
    },
  );

  it('marks a head that never ends within the scan bound as unverified, not as contradicted', () => {
    const lines = ['public', ...Array.from({ length: CONSTRUCT_SCAN_LINES + 20 }, (_, i) => `word${i}`)];
    const root = project({ 'src/Long.java': lines });
    const { validated, report } = run(root, [declNode('function', 'src/Long.java', 'helper', [1, lines.length])]);
    expect(report.counts.anchorMismatch).toBe(0);
    expect(report.counts.constructTooLong).toBe(1);
    expect(validated.nodes[0].verification).toBe('unverified');
  });
});

describe('validate-graph — a call expression written over several lines', () => {
  const caller = (path) => declNode('function', path, 'm', [1, 1]);
  const calls = (path, lines, calleeName, line, from = 'tree-sitter') => {
    const root = project({ [path]: lines });
    const m = caller(path);
    const target = declNode('function', 'src/T.x', calleeName, [1, 1]);
    return run(root, [m, target], [edge('calls', m, target, path, line, from)]).report;
  };

  it('confirms a callee on a later line of a chain written with leading dots', () => {
    const lines = ['class C {', '  void m() {', '    String s = builder', '        .alpha()', '        .beta(1,', '            2)', '        .gamma();', '    other();', '  }', '}'];
    expect(calls('src/C.java', lines, 'gamma', 3).counts.edgeContradicted).toBe(0);
  });

  it('confirms a callee on a later line of a chain written with trailing dots', () => {
    const lines = ['func m() {', '\tclient.', '\t\tPost(url).', '\t\tSend()', '\tnext()', '}'];
    expect(calls('src/m.go', lines, 'Send', 2).counts.edgeContradicted).toBe(0);
  });

  it.each([['kt', 'val s = builder'], ['cs', 'var s = builder'], ['rs', 'let s = builder'], ['js', 'const s = builder'], ['scala', 'val s = builder']])(
    '%s: confirms a callee on a later line of a chain written with leading dots', (ext, head) => {
      const lines = [head, '    .alpha()', '    .gamma()', 'other()', ''];
      expect(calls(`src/c.${ext}`, lines, 'gamma', 1).counts.edgeContradicted).toBe(0);
    },
  );

  it('confirms the callee at the end of a ten-line builder chain', () => {
    const lines = ['class Z {', '  void m() {', '    Client.configure()'];
    for (let i = 0; i < 10; i++) lines.push(`        .with${i}(v${i})`);
    lines.push('        .create();', '  }', '}');
    expect(calls('src/Z.java', lines, 'create', 3).counts.edgeContradicted).toBe(0);
  });

  it('confirms a callee that follows a lambda block in the middle of the chain', () => {
    const lines = ['class L {', '  void m() {', '    items.stream()', '        .map(x -> {', '          return x + 1;', '        })', '        .collect(toList());', '  }', '}'];
    expect(calls('src/L.java', lines, 'collect', 3).counts.edgeContradicted).toBe(0);
  });

  it('confirms a callee on the line that opens a block, the same line as the brace', () => {
    const lines = ['class N {', '  void m() {', '    if (check(target())) {', '    }', '  }', '}'];
    expect(calls('src/N.java', lines, 'target', 3).counts.edgeContradicted).toBe(0);
  });

  it('still reports a callee that appears only in the next statement', () => {
    const lines = ['class N {', '  void m() {', '    first();', '    target();', '  }', '}'];
    expect(calls('src/N.java', lines, 'target', 3).counts.edgeContradicted).toBe(1);
  });

  it('still reports a callee that is not in the expression at all', () => {
    const lines = ['class N {', '  void m() {', '    builder', '        .alpha()', '        .beta();', '  }', '}'];
    expect(calls('src/N.java', lines, 'gone', 3).counts.edgeContradicted).toBe(1);
  });

  it('does not read into the body of a declaration or a branch the cited line opens', () => {
    const lines = ['class N {', '  void m() {', '    if (ready) {', '      target();', '    }', '  }', '}'];
    const root = project({ 'src/N.java': lines });
    const m = caller('src/N.java');
    const target = declNode('function', 'src/T.java', 'target', [1, 1]);
    const { report } = run(root, [m, target], [
      edge('calls', m, target, 'src/N.java', 2),
      edge('calls', m, target, 'src/N.java', 3),
    ]);
    expect(report.counts.edgeContradicted).toBe(2);
  });

  it('ends the expression at a semicolon even when the next line starts like a continuation', () => {
    const lines = ['class N {', '  void m() {', '    first();', '        .target();', '  }', '}'];
    expect(calls('src/N.java', lines, 'target', 3).counts.edgeContradicted).toBe(1);
  });

  it('reads a trailing dot that is followed by a comment as a continuation', () => {
    const lines = ['func m() {', '\tclient. // note', '\tSend()', '}'];
    expect(calls('src/m.go', lines, 'Send', 2).counts.edgeContradicted).toBe(0);
  });

  it('gives a model-cited line no benefit of the following lines', () => {
    const lines = ['class N {', '  void m() {', '    builder', '        .target();', '  }', '}'];
    expect(calls('src/N.java', lines, 'target', 3, 'model').counts.edgeContradicted).toBe(1);
  });

  it('gives an evidence entry that names its own token no benefit of the following lines', () => {
    const root = project({ 'src/N.java': ['class N {', '  void m() {', '    builder', '        .target();', '  }', '}'] });
    const m = caller('src/N.java');
    const target = declNode('function', 'src/T.java', 'target', [1, 1]);
    const e = edge('calls', m, target, 'src/N.java', 3);
    e.evidence[0].token = 'target';
    expect(run(root, [m, target], [e]).report.counts.edgeContradicted).toBe(1);
  });

  it('marks an expression that runs past the scan bound as unverified, not as contradicted', () => {
    const lines = ['class Q {', '  void m() {', '    call(', ...Array.from({ length: CONSTRUCT_SCAN_LINES + 20 }, (_, i) => `        arg${i},`)];
    const root = project({ 'src/Q.java': lines });
    const m = caller('src/Q.java');
    const target = declNode('function', 'src/T.java', 'elsewhere', [1, 1]);
    const { validated, report } = run(root, [m, target], [edge('calls', m, target, 'src/Q.java', 3)]);
    expect(report.counts.edgeContradicted).toBe(0);
    expect(report.counts.constructTooLong).toBe(1);
    expect(validated.edges[0].verification).toBe('unverified');
    expect(validated.gaps.find((g) => g.kind === 'construct-too-long').count).toBe(1);
  });
});

describe('validate-graph — what a call expression does not continue on', () => {
  // The cited line ends in something that ends a statement in a language without semicolons, or that is not a
  // continuation at all, and the next line names the callee. The expression is over, so the edge is contradicted.
  const NOT_A_CONTINUATION = [
    ['go', 'count++'], ['go', 'count--'], ['go', 'x := a *'], ['go', 'var p *string'], ['go', 'a, b := 1,'], ['go', 'total := x -'],
    ['go', 'v := a &'], ['go', 'v := a |'], ['go', 'ok := a <'], ['go', '/* done */'],
    ['kt', 'val x: String?'], ['kt', 'count++'], ['kt', 'x = a %'], ['js', 'i++'], ['js', 'const a = 1,'], ['js', 'x = a /'], ['js', 'y = z >'],
    ['scala', 'val n = 1,'], ['swift', 'var v: Int?'], ['dart', 'var v = a ?'], ['ts', 'let v: string | undefined'],
  ];
  it.each(NOT_A_CONTINUATION)('%s: does not continue the expression after %j', (ext, line) => {
    const path = `src/s.${ext}`;
    const root = project({ [path]: [line, 'helper()', ''] });
    const m = declNode('function', path, 'm', [1, 2]);
    const helper = declNode('function', 'src/T.x', 'helper', [1, 1]);
    const { report } = run(root, [m, helper], [edge('calls', m, helper, path, 1)]);
    expect(report.counts.edgeContradicted).toBe(1);
  });

  // Whatever the cited line holds, a callee on the line after it is not in the expression when nothing carries
  // the expression on.
  it.each([['go', 'Send()'], ['kt', 'send()'], ['js', 'send()'], ['java', 'send();']])('%s: ends the expression at a line that carries nothing on (%j)', (ext, line) => {
    const path = `src/s.${ext}`;
    const root = project({ [path]: [line, 'helper()', ''] });
    const m = declNode('function', path, 'm', [1, 2]);
    const helper = declNode('function', 'src/T.x', 'helper', [1, 1]);
    const { report } = run(root, [m, helper], [edge('calls', m, helper, path, 1)]);
    expect(report.counts.edgeContradicted).toBe(1);
  });

  // The expression scan exists only in the languages that have the syntax.
  it.each([['py', ['x = (a,', '    helper())']], ['rb', ['foo.', '  helper']], ['txt', ['foo.', 'helper']], ['sh', ['foo \\', '  helper']], ['lua', ['foo.', 'helper()']]])(
    '%s: reads a call on the cited line alone', (ext, lines) => {
      const path = `src/s.${ext}`;
      const root = project({ [path]: [...lines, ''] });
      const m = declNode('function', path, 'm', [1, 2]);
      const helper = declNode('function', 'src/T.x', 'helper', [1, 1]);
      const { report } = run(root, [m, helper], [edge('calls', m, helper, path, 1)]);
      expect(report.counts.edgeContradicted).toBe(1);
    },
  );
});

describe('validate-graph — reading an expression in the language it is written in', () => {
  it('does not take a Rust lifetime for the start of a string, which would hide the brace that opens the body', () => {
    const lines = ["fn m<'a>(x: &'a str) -> &'a str {", '    .helper()', '}', ''];
    const root = project({ 'src/m.rs': lines });
    const m = declNode('function', 'src/m.rs', 'm', [1, 3]);
    const helper = declNode('function', 'src/h.rs', 'helper', [1, 1]);
    const { report } = run(root, [m, helper], [edge('calls', m, helper, 'src/m.rs', 1)]);
    expect(report.counts.edgeContradicted).toBe(1);
  });

  it('reads an apostrophe as a quote in a language that has character literals', () => {
    const lines = ["val c = '{'", '    .helper()', ''];
    const root = project({ 'src/c.kt': lines });
    const m = declNode('function', 'src/c.kt', 'm', [1, 2]);
    const helper = declNode('function', 'src/h.kt', 'helper', [1, 1]);
    const { report } = run(root, [m, helper], [edge('calls', m, helper, 'src/c.kt', 1)]);
    expect(report.counts.edgeContradicted).toBe(0);
  });
});

describe('validate-graph — a string or a comment the scan cannot read to its end', () => {
  // The cited line opens a call, and a string or a comment that is still open at its end hides the rest: the
  // brackets after it cannot be told from the ones inside it. The scan stops there, so the callee named in a
  // later statement is not in the expression and the edge is contradicted.
  const OPEN_AT_END_OF_LINE = [
    ['java', ['    run("""', '      select 1', '      """);', '    helper();']],
    ['ts', ['  call(`select', '    from t`, a);', '  helper();']],
    ['go', ['\tcall(`select', 'from t`, a)', '\thelper()']],
    ['cpp', ['  call(R"(select', ')", a);', '  helper();']],
    ['cs', ['  Call(@"select', 'from t", a);', '  helper();']],
    ['kt', ['  call("""select', '  from t""", a)', '  helper()']],
    ['rs', ['  call(r#"select', '  from t"#, a);', '  helper();']],
    ['php', ['  call(<<<EOT', '  helper() text', 'EOT, a);']],
    ['java', ['    call(a /* start', '       helper() */', '    );']],
    ['c', ['  call(a, /* start', '       helper() */ b);']],
  ];
  it.each(OPEN_AT_END_OF_LINE)('%s: stops at a string or a comment left open (%j)', (ext, body) => {
    const path = `src/s.${ext}`;
    const root = project({ [path]: [...body, ''] });
    const m = declNode('function', path, 'm', [1, body.length]);
    const helper = declNode('function', 'src/T.x', 'helper', [1, 1]);
    const { report } = run(root, [m, helper], [edge('calls', m, helper, path, 1)]);
    expect(report.counts.edgeContradicted).toBe(1);
  });

  // The same text with the string closed on its own line is read as code, so a callee after it is found.
  it.each([
    ['java', ['    run("a(b")', '        .helper();']],
    ['ts', ['  call(`a(b`)', '    .helper()']],
    ['go', ['\tcall(`a(b`)', '\t\t.helper()']],
    ['c', ['  call(a /* ( */)', '    .helper()']],
  ])('%s: reads a string or a comment that closes on its line (%j)', (ext, body) => {
    const path = `src/s.${ext}`;
    const root = project({ [path]: [...body, ''] });
    const m = declNode('function', path, 'm', [1, body.length]);
    const helper = declNode('function', 'src/T.x', 'helper', [1, 1]);
    const { report } = run(root, [m, helper], [edge('calls', m, helper, path, 1)]);
    expect(report.counts.edgeContradicted).toBe(0);
  });

  it('reads a Rust character literal that holds a bracket, so the semicolon after it ends the expression', () => {
    const lines = ['fn m() {', "    let i = s.find('(');", '    helper();', '}'];
    const root = project({ 'src/m.rs': lines });
    const m = declNode('function', 'src/m.rs', 'm', [1, 4]);
    const helper = declNode('function', 'src/h.rs', 'helper', [1, 1]);
    const { report } = run(root, [m, helper], [edge('calls', m, helper, 'src/m.rs', 2)]);
    expect(report.counts.edgeContradicted).toBe(1);
  });

  it('reads a Rust lifetime as a lifetime, not as the start of a string, so the expression goes on', () => {
    const lines = ["let r: &'a str = foo(x)", '    .helper()', ''];
    const root = project({ 'src/r.rs': lines });
    const m = declNode('function', 'src/r.rs', 'm', [1, 2]);
    const helper = declNode('function', 'src/h.rs', 'helper', [1, 1]);
    const { report } = run(root, [m, helper], [edge('calls', m, helper, 'src/r.rs', 1)]);
    expect(report.counts.edgeContradicted).toBe(0);
  });

  it('reads a Rust character literal that holds a quote or an escape', () => {
    const lines = ["let c = f('\"', '\\n', '\\u{41}')", '    .helper()', ''];
    const root = project({ 'src/c.rs': lines });
    const m = declNode('function', 'src/c.rs', 'm', [1, 2]);
    const helper = declNode('function', 'src/h.rs', 'helper', [1, 1]);
    const { report } = run(root, [m, helper], [edge('calls', m, helper, 'src/c.rs', 1)]);
    expect(report.counts.edgeContradicted).toBe(0);
  });

  it('does not read an annotation whose argument opens a text block on a later line as leading syntax', () => {
    const lines = ['@Query(', '  """', '  select 1)', 'void helper() {}', ''];
    const root = project({ 'src/Q.java': lines });
    const file = fileNode('src/Q.java');
    const helper = declNode('function', 'src/Q.java', 'helper', [1, 4]);
    const { report } = run(root, [file, helper], [edge('contains', file, helper, 'src/Q.java', 1)]);
    expect(report.counts.edgeContradicted).toBe(1);
  });

  it('does not read an annotation argument that opens a block comment it does not close as leading syntax', () => {
    const lines = ['@A(a /* note', 'void helper() {} ) */', ''];
    const root = project({ 'src/C.java': lines });
    const file = fileNode('src/C.java');
    const helper = declNode('function', 'src/C.java', 'helper', [1, 2]);
    const { report } = run(root, [file, helper], [edge('contains', file, helper, 'src/C.java', 1)]);
    expect(report.counts.edgeContradicted).toBe(1);
  });

  it('does not read an annotation whose argument opens a text block as leading syntax', () => {
    const lines = ['@Query("""', '  select 1)', 'void helper() {}', ''];
    const root = project({ 'src/Q.java': lines });
    const file = fileNode('src/Q.java');
    const helper = declNode('function', 'src/Q.java', 'helper', [1, 3]);
    const { report } = run(root, [file, helper], [edge('contains', file, helper, 'src/Q.java', 1)]);
    expect(report.counts.edgeContradicted).toBe(1);
  });
});

describe('validate-graph — a line that is already a complete declaration does not start a head', () => {
  // A line with a declaration keyword already has its name, and the next line is another member.
  it.each([
    ['java', 'private class Marker'], ['java', 'public interface Shape'], ['java', 'public enum Color'],
    ['java', 'public abstract class Base'], ['java', 'protected record Point'], ['java', 'public static final class Holder'],
    ['cs', 'public sealed class Shape'], ['cs', 'internal struct Pair'], ['cs', 'public delegate'], ['cs', 'public event'], ['cs', 'public interface IShape'],
  ])('%s: does not read %j as the start of a head', (ext, line) => {
    const path = `src/s.${ext}`;
    const root = project({ [path]: [line, 'void helper() {}', ''] });
    const file = fileNode(path);
    const helper = declNode('function', path, 'helper', [1, 2]);
    const { report } = run(root, [file, helper], [edge('contains', file, helper, path, 1)]);
    expect(report.counts.edgeContradicted).toBe(1);
  });

  // A line that starts with a modifier or an annotation is a declaration of its own, not the rest of a head.
  it.each([
    ['java', 'public Foo', 'public void helper() {}'], ['java', 'public Foo', '@Override void helper() {}'],
    ['cs', 'public int Count', 'public void helper() {}'], ['cs', 'private Foo', 'internal void helper() {}'],
  ])('%s: does not read %j and then %j as one head', (ext, first, second) => {
    const path = `src/s.${ext}`;
    const root = project({ [path]: [first, second, ''] });
    const file = fileNode(path);
    const helper = declNode('function', path, 'helper', [1, 2]);
    const { report } = run(root, [file, helper], [edge('contains', file, helper, path, 1)]);
    expect(report.counts.edgeContradicted).toBe(1);
  });

  it('still reads a head whose second line starts with the return type', () => {
    const root = project({ 'src/B.java': ['class B {', '  public static', '  void bare() {}', '}', ''] });
    const file = fileNode('src/B.java');
    const bare = declNode('function', 'src/B.java', 'bare', [2, 3]);
    const { report } = run(root, [file, bare], [edge('contains', file, bare, 'src/B.java', 2)]);
    expect(report.counts.edgeConfirmed).toBe(1);
  });
});

describe('validate-graph — the report names the expressions it could not decide', () => {
  it('prints and writes the construct-too-long count for a call expression', () => {
    const lines = ['class Q {', '  void m() {', '    call(', ...Array.from({ length: CONSTRUCT_SCAN_LINES + 20 }, (_, i) => `        arg${i},`)];
    const root = project({ 'src/Q.java': lines });
    const inter = join(root, '.excavator', 'intermediate');
    mkdirSync(inter, { recursive: true });
    const m = declNode('function', 'src/Q.java', 'm', [1, 1]);
    const target = declNode('function', 'src/T.java', 'elsewhere', [1, 1]);
    const graph = {
      version: '1.0.0',
      project: { name: 'fixture', languages: [], frameworks: [], description: '', analyzedAt: '2026-10-27T00:00:00.000Z', gitCommitHash: null },
      nodes: [m, target], edges: [edge('calls', m, target, 'src/Q.java', 3)], layers: [], tour: [],
    };
    writeFileSync(join(inter, 'annotated-graph.json'), JSON.stringify(graph));
    const out = spawnSync('node', [VALIDATE, root], { encoding: 'utf-8' });
    expect(out.status, out.stderr).toBe(0);
    expect(out.stderr).toMatch(/construct-too-long=1/);
    expect(out.stderr).toMatch(/edge-contradicted=0/);
  });
});
