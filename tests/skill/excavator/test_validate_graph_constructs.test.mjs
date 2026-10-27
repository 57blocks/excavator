/**
 * validate-graph.mjs — declarations and calls that span several lines.
 *
 * An extractor reports a declaration's range from its first annotation, and a
 * call's evidence line is where the expression starts. The name the validator
 * looks for is often a few lines below. Each fixture here writes one such shape
 * out line by line; the guard cases prove the validator still sees a shifted
 * anchor or an unrelated line, so a zero on the shapes means something.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  validateAgainstSource, createSourceReader, CONSTRUCT_SCAN_LINES,
} from '../../../skills/excavator/validate-graph.mjs';

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
    const lines = ['@Unclosed(',...Array.from({ length: CONSTRUCT_SCAN_LINES + 20 }, (_, i) => `    part${i},`)];
    const root = project({ 'src/Broken.java': lines });
    const { validated, report } = run(root, [declNode('class', 'src/Broken.java', 'Broken', [1, lines.length])]);
    expect(report.counts.anchorMismatch).toBe(0);
    expect(report.counts.constructTooLong).toBe(1);
    expect(validated.nodes[0].verification).toBe('unverified');
    expect(validated.gaps.find((g) => g.kind === 'construct-too-long').count).toBe(1);
  });
});
