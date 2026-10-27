/**
 * validate-graph.mjs — a declaration whose range starts at its leading annotations.
 *
 * An extractor reports a declaration's range from its first annotation, so the
 * name the validator looks for is a few lines below the line it is given. Each
 * fixture writes one such shape out line by line. The guard cases prove the
 * validator still sees a shifted anchor or an unrelated line, and the table of
 * statement-shaped lines proves no statement of another language is taken for
 * the start of a construct, so a zero on the real shapes means something.
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

describe('validate-graph — a declaration preceded by annotations, decorators or attributes', () => {
  const JAVA = 'src/A.java';
  const javaLines = [
    'package p;', //                                  1
    '', //                                            2
    'public class A {', //                            3
    '  @Override', //                                 4
    '  public void one() {}', //                      5
    '', //                                            6
    '  @Override', //                                 7
    '  // a comment between the annotation and it', // 8
    '  public void two() {}', //                      9
    '', //                                            10
    '  @Foo(', //                                     11
    '      value = "x)(@y\\n",', //                   12
    '      nested = { @Bar(a = 1), @Bar(a = 2) })', // 13
    '  @Other', //                                    14
    '  public void three() {}', //                     15
    '}', //                                            16
  ];

  it('confirms the anchor of a method whose range starts at its annotations', () => {
    const root = project({ [JAVA]: javaLines });
    const { report } = run(root, [
      fileNode(JAVA),
      declNode('function', JAVA, 'one', [4, 5]),
      declNode('function', JAVA, 'two', [7, 9]),
      declNode('function', JAVA, 'three', [11, 15]),
    ]);
    expect(report.counts.anchorMismatch).toBe(0);
    expect(report.counts.anchorConfirmed).toBe(3);
  });

  it('confirms the anchor behind an annotation block longer than twenty lines', () => {
    const block = bigAnnotationBlock(24);
    const lines = ['package p;', '', ...block, 'public class Big extends Base {', '}'];
    const root = project({ 'src/Big.java': lines });
    const { report } = run(root, [
      fileNode('src/Big.java'),
      declNode('class', 'src/Big.java', 'Big', [3, lines.length]),
    ]);
    expect(report.counts.anchorMismatch).toBe(0);
    expect(report.counts.anchorConfirmed).toBe(1);
  });

  it('confirms TypeScript and Python decorators, C# attributes and Rust attributes', () => {
    const root = project({
      'src/c.ts': ['@Component({', "  selector: 'x',", '})', 'export class Foo {}'],
      'src/h.py': ['@app.route("/x",', '           methods=["GET"])', 'def handler():', '    pass'],
      'src/C.cs': ['[HttpGet]', '[Route("x")]', 'public IActionResult Get() { return null; }'],
      'src/s.rs': ['#[derive(Debug)]', '#[cfg(test)]', 'pub struct Shape {}'],
      'src/doc.java': ['/**', ' * Javadoc.', ' */', '@Deprecated', 'public class Doc {}'],
    });
    const { report } = run(root, [
      declNode('class', 'src/c.ts', 'Foo', [1, 4]),
      declNode('function', 'src/h.py', 'handler', [1, 4]),
      declNode('function', 'src/C.cs', 'Get', [1, 3]),
      declNode('class', 'src/s.rs', 'Shape', [1, 3]),
      declNode('class', 'src/doc.java', 'Doc', [1, 5]),
    ]);
    expect(report.counts.anchorMismatch).toBe(0);
    expect(report.counts.anchorConfirmed).toBe(5);
  });

  it('confirms contains, exports, implements and overrides edges whose evidence line is the annotation', () => {
    const root = project({ [JAVA]: javaLines });
    const file = fileNode(JAVA);
    const one = declNode('function', JAVA, 'one', [4, 5]);
    const two = declNode('function', JAVA, 'two', [7, 9]);
    const three = declNode('function', JAVA, 'three', [11, 15]);
    const { report } = run(root, [file, one, two, three], [
      edge('contains', file, one, JAVA, 4),
      edge('exports', file, two, JAVA, 7),
      edge('implements', three, three, JAVA, 11),
      edge('overrides', two, two, JAVA, 7),
    ]);
    expect(report.counts.edgeContradicted).toBe(0);
    expect(report.counts.edgeConfirmed).toBe(4);
  });

  it('does not look past a declaration line that is already complete', () => {
    const lines = ['class D {', '  void first() {}', '  void second() {}', '}'];
    const root = project({ 'src/D.java': lines });
    const file = fileNode('src/D.java');
    const second = declNode('function', 'src/D.java', 'second', [3, 3]);
    // line 2 is a finished declaration (`first`); `second` is on the line after it
    const { report } = run(root, [file, second], [
      edge('contains', file, second, 'src/D.java', 2),
      edge('exports', file, second, 'src/D.java', 2),
    ]);
    expect(report.counts.edgeContradicted).toBe(2);
  });

  it('still reports a name that belongs to a different declaration', () => {
    const root = project({ [JAVA]: javaLines });
    const file = fileNode(JAVA);
    const wrong = declNode('function', JAVA, 'alpha', [4, 5]);
    const { report } = run(root, [file, wrong], [edge('contains', file, wrong, JAVA, 4)]);
    expect(report.counts.anchorMismatch).toBe(1);
    expect(report.counts.edgeContradicted).toBe(1);
  });

  it('still reports an anchor shifted into the body of the declaration above', () => {
    const lines = [
      'public class B {', //                       1
      '  @Override', //                            2
      '  public void first() {', //                3
      '    int a = 1;', //                          4
      '    int b = 2;', //                          5
      '    int c = 3;', //                          6
      '    int d = 4;', //                          7
      '    int e = 5;', //                          8
      '  }', //                                     9
      '  @Override', //                            10
      '  @Other', //                               11
      '  public void second() {}', //              12
      '}', //                                      13
    ];
    const root = project({ 'src/B.java': lines });
    const { report } = run(root, [declNode('function', 'src/B.java', 'second', [6, 12])]);
    expect(report.counts.anchorMismatch).toBe(1);
  });

  it('does not skip past a line that is code, so an anchor on a statement is reported', () => {
    const lines = ['class C {', '  void m() {', '    @Deprecated', '    int x = 1;', '    other();', '  }', '  void target() {}', '}'];
    const root = project({ 'src/C.java': lines });
    const { report } = run(root, [declNode('function', 'src/C.java', 'target', [3, 7])]);
    expect(report.counts.anchorMismatch).toBe(1);
  });

  it('marks an annotation that never closes as unverified, not as contradicted', () => {
    const lines = ['@Unclosed(', ...Array.from({ length: CONSTRUCT_SCAN_LINES + 20 }, (_, i) => `    part${i},`)];
    const root = project({ 'src/Broken.java': lines });
    const { validated, report } = run(root, [declNode('class', 'src/Broken.java', 'Broken', [1, lines.length])]);
    expect(report.counts.anchorMismatch).toBe(0);
    expect(report.counts.constructTooLong).toBe(1);
    expect(validated.nodes[0].verification).toBe('unverified');
    expect(validated.gaps.find((g) => g.kind === 'construct-too-long').count).toBe(1);
  });
});

describe('validate-graph — a bracket on a leading line is an attribute only when it closes like one', () => {
  it('does not take rows of an array literal for attributes', () => {
    const lines = ['[alpha, 1],', '[beta, 2],', '[gamma, 3],', 'function target() {}'];
    const root = project({ 'src/rows.js': lines });
    const { report } = run(root, [declNode('function', 'src/rows.js', 'target', [1, 4])]);
    expect(report.counts.anchorMismatch).toBe(1);
  });

  it('still takes a C# attribute list as an attribute', () => {
    const lines = ['[Serializable, Obsolete]', '[Other]', '// comment', 'public class Multi {}'];
    const root = project({ 'src/Multi.cs': lines });
    const { report } = run(root, [declNode('class', 'src/Multi.cs', 'Multi', [1, 4])]);
    expect(report.counts.anchorMismatch).toBe(0);
  });
});

describe('validate-graph — the class: a statement-shaped line is never read as the start of a construct', () => {
  // Lines of other languages that are statements, not declarations. None may be
  // taken for a leading line, so none may let an anchor or an edge reach the
  // declaration written below it.
  const STATEMENT_LINES = [
    'import os', 'from util import *', 'package main', 'use std::io;', 'require "json"', 'local x',
    'export default router', 'export const router', 'const router', 'static x', 'async',
    'return x', 'pass', 'break', 'continue', 'else', 'end', 'try:', 'finally:', '} else {',
    ' *', '* ', 'count--', 'i++', 'val x: String?', 'let y: Int?', '@count = 0', '@@total += 1', '*p = 1;',
    '[make(1), 2],', '[alpha, 1],', 'x = a &', 'y = b |', 'ref: &', 'a <', 'b >', 'q /',
  ];

  // A comment line IS a leading line, so the two comment-shaped rows are left out here. The statement
  // is written twice: a rule that wrongly takes it for a leading line then skips both and reaches the
  // declaration, and confirms an anchor that starts two lines above it.
  const NOT_COMMENTS = STATEMENT_LINES.filter((line) => line.trim() !== '*');
  it.each(NOT_COMMENTS)('does not confirm an anchor that starts at %j with the declaration two lines below', (statement) => {
    const root = project({ 'src/s.txt': [statement, statement, 'function helper() {}', ''] });
    const { report } = run(root, [declNode('function', 'src/s.txt', 'helper', [1, 3])]);
    expect(report.counts.anchorMismatch).toBe(1);
  });

  it('does not take rows of an array literal that span several lines for attributes', () => {
    const lines = ['[make(', '  1), 2],', '[make(', '  1), 2],', 'function helper() {}', ''];
    const root = project({ 'src/rows.js': lines });
    const { report } = run(root, [declNode('function', 'src/rows.js', 'helper', [1, 5])]);
    expect(report.counts.anchorMismatch).toBe(1);
  });

  it.each(STATEMENT_LINES)('does not confirm contains and exports edges cited at %j when the member starts on the next line', (statement) => {
    const root = project({ 'src/s.txt': [statement, 'function helper() {}', ''] });
    const file = fileNode('src/s.txt');
    const helper = declNode('function', 'src/s.txt', 'helper', [2, 2]);
    const { report } = run(root, [file, helper], [
      edge('contains', file, helper, 'src/s.txt', 1),
      edge('exports', file, helper, 'src/s.txt', 1),
    ]);
    expect(report.counts.edgeContradicted).toBe(2);
  });

  it('confirms an edge only when it cites the first line of the range of an endpoint whose anchor holds', () => {
    const lines = [
      'class C {', //                  1
      '  @Override', //                2
      '  public void run() {', //      3
      '    int x = 1;', //             4
      '  }', //                        5
      '  public void other() {}', //  6
      '}', //                          7
    ];
    const root = project({ 'src/C.java': lines });
    const file = fileNode('src/C.java');
    const runNode = declNode('function', 'src/C.java', 'run', [2, 5]);
    const other = declNode('function', 'src/C.java', 'other', [6, 6]);
    const { report } = run(root, [file, runNode, other], [
      edge('contains', file, runNode, 'src/C.java', 2), //   its own start: confirmed
      edge('contains', file, runNode, 'src/C.java', 4), //   inside its range, not its start, no name: contradicted
      edge('contains', file, other, 'src/C.java', 2), //     another member's start: contradicted
    ]);
    expect(report.counts.edgeConfirmed).toBe(1);
    expect(report.counts.edgeContradicted).toBe(2);
  });

  it('does not confirm an edge to a member whose own anchor does not hold, even at its first line', () => {
    const lines = ['class C {', '  @Override', '  public void run() {}', '}'];
    const root = project({ 'src/C.java': lines });
    const file = fileNode('src/C.java');
    const wrong = declNode('function', 'src/C.java', 'gone', [2, 3]);
    const { report } = run(root, [file, wrong], [edge('contains', file, wrong, 'src/C.java', 2)]);
    expect(report.counts.anchorMismatch).toBe(1);
    expect(report.counts.edgeContradicted).toBe(1);
  });

  it('does not take the statement before a declaration for its start', () => {
    const lines = ['export default router', 'export function helper() {}', ''];
    const root = project({ 'src/r.js': lines });
    const file = fileNode('src/r.js');
    const helper = declNode('function', 'src/r.js', 'helper', [2, 2]);
    const { report } = run(root, [file, helper], [
      edge('contains', file, helper, 'src/r.js', 1),
      edge('exports', file, helper, 'src/r.js', 1),
    ]);
    expect(report.counts.edgeContradicted).toBe(2);
  });

  it('does not confirm a model-cited edge at the first line of a range, however the name is placed after it', () => {
    const lines = ['class C {', '  @Override', '  public void run() {}', '}'];
    const root = project({ 'src/C.java': lines });
    const file = fileNode('src/C.java');
    const runNode = declNode('function', 'src/C.java', 'run', [2, 3]);
    const { report } = run(root, [file, runNode], [edge('contains', file, runNode, 'src/C.java', 2, 'model')]);
    expect(report.counts.edgeContradicted).toBe(1);
  });
});

describe('validate-graph — what the graph reading is not applied to', () => {
  const lines = ['class C {', '  @Override', '  public void run() {}', '}'];
  const setup = () => {
    const root = project({ 'src/C.java': lines });
    const file = fileNode('src/C.java');
    const runNode = declNode('function', 'src/C.java', 'run', [2, 3]);
    return { root, file, runNode };
  };

  it('does not confirm a calls edge at the first line of the callee range, which is its annotation', () => {
    const { root, file, runNode } = setup();
    const caller = declNode('function', 'src/C.java', 'm', [1, 4]);
    const { report } = run(root, [file, caller, runNode], [edge('calls', caller, runNode, 'src/C.java', 2)]);
    expect(report.counts.edgeContradicted).toBe(1);
  });

  it('does not confirm an edge whose evidence entry names a token of its own that is not on its line', () => {
    const { root, file, runNode } = setup();
    const e = edge('implements', runNode, runNode, 'src/C.java', 2);
    e.evidence[0].token = 'Zzz';
    const { report } = run(root, [file, runNode], [e]);
    expect(report.counts.edgeContradicted).toBe(1);
  });
});

describe('validate-graph — a range that starts in the middle of a block comment', () => {
  it('reads the star-prefixed comment lines as leading lines', () => {
    const lines = ['/**', ' * Describes the thing.', ' */', 'public class Gadget {}', ''];
    const root = project({ 'src/Gadget.java': lines });
    const { report } = run(root, [declNode('class', 'src/Gadget.java', 'Gadget', [2, 4])]);
    expect(report.counts.anchorMismatch).toBe(0);
    expect(report.counts.anchorConfirmed).toBe(1);
  });
});

describe('validate-graph — an anchor that passes only within one line does not vouch for an edge', () => {
  const twoEdges = (file, helper, path, line) => [edge('contains', file, helper, path, line), edge('exports', file, helper, path, line)];

  it.each([
    ['one line above its declaration', ['x = compute()', 'def helper():', '    return 1'], [1, 3]],
    ['one line below its declaration', ['def helper():', '    return 1', '    return 2'], [2, 3]],
  ])('a range that starts %s: the anchor is confirmed as before, the edges are contradicted', (_label, lines, range) => {
    const root = project({ 'src/p.py': lines });
    const file = fileNode('src/p.py');
    const helper = declNode('function', 'src/p.py', 'helper', range);
    const { report } = run(root, [file, helper], twoEdges(file, helper, 'src/p.py', range[0]));
    expect(report.counts.anchorMismatch).toBe(0);
    expect(report.counts.anchorConfirmed).toBe(1);
    expect(report.counts.edgeContradicted).toBe(2);
    expect(report.counts.edgeConfirmed).toBe(0);
  });

  it('a range that starts exactly on the declaration confirms the same edges', () => {
    const lines = ['x = compute()', 'def helper():', '    return 1'];
    const root = project({ 'src/p.py': lines });
    const file = fileNode('src/p.py');
    const helper = declNode('function', 'src/p.py', 'helper', [2, 3]);
    const { report } = run(root, [file, helper], twoEdges(file, helper, 'src/p.py', 2));
    expect(report.counts.edgeContradicted).toBe(0);
    expect(report.counts.edgeConfirmed).toBe(2);
  });

  it('a range that starts at the annotation vouches for its edges although the name is also within one line', () => {
    const lines = ['class C {', '  @Override', '  public void run() {}', '}'];
    const root = project({ 'src/C.java': lines });
    const file = fileNode('src/C.java');
    const runNode = declNode('function', 'src/C.java', 'run', [2, 3]);
    const { report } = run(root, [file, runNode], twoEdges(file, runNode, 'src/C.java', 2));
    expect(report.counts.edgeContradicted).toBe(0);
    expect(report.counts.edgeConfirmed).toBe(2);
  });
});

describe('validate-graph — the report names what it could not decide', () => {
  it('prints and writes the construct-too-long count and leaves the verdict counts alone', () => {
    const lines = ['@Unclosed(', ...Array.from({ length: CONSTRUCT_SCAN_LINES + 20 }, (_, i) => `    part${i},`)];
    const root = project({ 'src/Broken.java': lines });
    const inter = join(root, '.excavator', 'intermediate');
    mkdirSync(inter, { recursive: true });
    const graph = {
      version: '1.0.0',
      project: { name: 'fixture', languages: [], frameworks: [], description: '', analyzedAt: '2026-10-27T00:00:00.000Z', gitCommitHash: null },
      nodes: [declNode('class', 'src/Broken.java', 'Broken', [1, lines.length])], edges: [], layers: [], tour: [],
    };
    writeFileSync(join(inter, 'annotated-graph.json'), JSON.stringify(graph));

    const run1 = spawnSync('node', [VALIDATE, root], { encoding: 'utf-8' });
    expect(run1.status, run1.stderr).toBe(0);
    expect(run1.stderr).toMatch(/construct-too-long=1/);
    expect(run1.stderr).toMatch(/anchor-mismatch=0/);

    const report = JSON.parse(readFileSync(join(inter, 'validation.json'), 'utf-8'));
    expect(report.counts.constructTooLong).toBe(1);
    const validated = JSON.parse(readFileSync(join(inter, 'validated-graph.json'), 'utf-8'));
    expect(validated.gaps.find((g) => g.kind === 'construct-too-long').count).toBe(1);
    expect(validated.nodes[0].verification).toBe('unverified');
  });
});
