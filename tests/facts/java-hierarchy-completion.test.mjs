// dead-code-detection, tasks 3.1-3.2: the Java type hierarchy is completed.
// Concrete methods get `overrides` edges to the concrete methods they
// override (an inherited class method to the interface `default` method it
// wins over included), inherited implementations and interface `default`
// methods get `implements` edges, and a same-name, same-arity pair whose erased
// signatures cannot be compared is an `override-uncertain` gap instead of
// being dropped. Static and private methods never pair. Real tree-sitter
// extraction end to end.
import { beforeAll, describe, expect, it } from 'vitest';
import { PluginRegistry, TreeSitterPlugin, builtinLanguageConfigs, registerAllParsers } from '@excavator/core';
import { analyzeFileWithOutcomes, buildResult } from '../../skills/excavator/extract-structure-result.mjs';
import { buildFactGraph } from '../../skills/excavator/build-fact-graph.mjs';
import { createJavaCallResolver } from '../../skills/excavator/java-call-resolution.mjs';
import { boundedShortestPath } from '../../skills/excavator/retrieve.mjs';

let registry;
beforeAll(async () => {
  const tsPlugin = new TreeSitterPlugin(builtinLanguageConfigs.filter((c) => c.treeSitter));
  await tsPlugin.init();
  registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);
});

function extract(files) {
  return Object.entries(files).map(([path, lines]) => {
    const source = [...lines, ''].join('\n');
    const file = { path, language: 'java', fileCategory: 'code' };
    const extracted = analyzeFileWithOutcomes(registry, file, source);
    expect(extracted.structureOutcome).toBe('succeeded');
    return buildResult(file, lines.length, lines.length, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome);
  });
}

function graphOfRows(rows) {
  const scan = {
    files: rows.map((r) => ({ path: r.path, language: 'java', fileCategory: 'code', sizeLines: r.totalLines })),
    skipped: [],
    coverage: { limits: { maxFileLines: 20000, maxFileBytes: 2097152 } },
  };
  const importMap = { importMap: Object.fromEntries(rows.map((r) => [r.path, []])), unresolved: {} };
  return buildFactGraph({ scan, structureAll: { results: rows }, importMap });
}

const graphOf = (files) => graphOfRows(extract(files));

const nameOf = (graph) => new Map(graph.nodes.map((n) => [n.id, n.owner ? `${n.owner}#${n.name}` : n.name]));

/** Method-level hierarchy edges as `Source -type-> Target @file:line`. */
function methodEdges(graph) {
  const name = nameOf(graph);
  return graph.edges
    .filter((e) => (e.type === 'implements' || e.type === 'overrides') && name.get(e.source).includes('#'))
    .map((e) => {
      expect(e).toMatchObject({ direction: 'forward', weight: 0.9, provenance: 'extracted' });
      expect(e.evidence).toHaveLength(1);
      expect(e.evidence[0].source).toBe('tree-sitter');
      return `${name.get(e.source)} -${e.type}-> ${name.get(e.target)} @${e.evidence[0].file.split('/').pop()}:${e.evidence[0].line}`;
    })
    .sort();
}

/** The `override-uncertain` gap, or undefined. */
const uncertainGap = (graph) => graph.gaps.find((g) => g.kind === 'override-uncertain');

/** The resolver's hierarchy result, with node ids as `Owner#name(types)` stand-ins. */
function hierarchyOf(files) {
  const rows = extract(files);
  const label = (fn) => `${fn.owner}#${fn.name}(${(fn.paramTypes ?? []).join(',')})`;
  const functionIds = new Map(rows.map((row) => [row.path, (row.functions ?? []).map(label)]));
  const classIds = new Map(rows.map((row) => [row.path, (row.classes ?? []).map((c) => c.name)]));
  return createJavaCallResolver({ rows, functionIds, classIds }).hierarchyEdges();
}

/** Uncertain pairs from the resolver. */
function uncertainPairs(files) {
  return hierarchyOf(files).uncertainPairs
    .map((p) => `${p.source} ~${p.relation}~ ${p.target} @${p.file.split('/').pop()}:${p.line}`);
}

/**
 * Method-level edges straight from the resolver, before the fact graph
 * collapses repeated pairs: a pair stated twice shows up here twice.
 */
function resolverMethodEdges(files) {
  const { methodEdges: impl, overrideEdges } = hierarchyOf(files);
  const show = (type) => (e) => `${e.source} -${type}-> ${e.target} @${e.file.split('/').pop()}:${e.line}`;
  return [...impl.map(show('implements')), ...overrideEdges.map(show('overrides'))].sort();
}

const P = 'src/main/java/p';

const fn = (graph, owner, name) => {
  const hits = graph.nodes.filter((n) => n.owner === owner && n.name === name);
  expect(hits).toHaveLength(1);
  return hits[0].id;
};

describe('Java inherited implementations', () => {
  const INHERITED = {
    [`${P}/I.java`]: ['package p;', 'public interface I { void m(); }'],
    [`${P}/Base.java`]: ['package p;', 'public class Base { public void m() {} }'],
    [`${P}/C.java`]: [
      'package p;', //        1
      'public class C', //    2
      '    extends Base', //  3
      '    implements I {', //4
      '}', //                 5
    ],
  };

  it('binds the method a class inherits to the abstract method it does not declare, at its implements line', () => {
    expect(methodEdges(graphOf(INHERITED))).toEqual(['Base#m -implements-> I#m @C.java:4']);
  });

  it('an abstract class with no concrete repository subclass binds it too', () => {
    const graph = graphOf({
      [`${P}/I.java`]: INHERITED[`${P}/I.java`],
      [`${P}/Base.java`]: INHERITED[`${P}/Base.java`],
      [`${P}/Skeleton.java`]: [
        'package p;',
        'public abstract class Skeleton extends Base',
        '    implements I {}',
      ],
    });
    expect(methodEdges(graph)).toEqual(['Base#m -implements-> I#m @Skeleton.java:3']);
  });

  it('emits one edge for a pair several types bind, with the smallest evidence', () => {
    const graph = graphOf({
      ...INHERITED,
      [`${P}/A.java`]: ['package p;', '', 'public class A extends Base implements I {}'],
      [`${P}/D.java`]: ['package p;', 'public class D extends Base implements I {}'],
    });
    expect(methodEdges(graph)).toEqual(['Base#m -implements-> I#m @A.java:3']);
  });

  it('takes the nearest superclass implementation, and none when one is declared abstract again', () => {
    const graph = graphOf({
      [`${P}/I.java`]: ['package p;', 'public interface I { void m(); void n(); }'],
      [`${P}/Root.java`]: ['package p;', 'public class Root { public void m() {} public void n() {} }'],
      [`${P}/Mid.java`]: ['package p;', 'public abstract class Mid extends Root { public void m() {} public abstract void n(); }'],
      [`${P}/C.java`]: ['package p;', 'public abstract class C extends Mid implements I {}'],
    });
    expect(methodEdges(graph)).toEqual([
      'Mid#m -implements-> I#m @C.java:2',
      'Mid#m -overrides-> Root#m @Mid.java:2',
    ]);
  });

  it('never repeats a pair the implementing method\'s own type already states', () => {
    const files = {
      [`${P}/I.java`]: ['package p;', 'public interface I { void m(); }'],
      [`${P}/Base.java`]: ['package p;', 'public class Base implements I { public void m() {} }'],
      [`${P}/C.java`]: ['package p;', 'public class C extends Base implements I {}'],
    };
    expect(methodEdges(graphOf(files))).toEqual(['Base#m -implements-> I#m @Base.java:2']);
    expect(resolverMethodEdges(files)).toEqual(['Base#m() -implements-> I#m() @Base.java:2']);
  });

  it('prefers a superclass method over an interface default, which it then overrides, and uses a default only when no class provides one', () => {
    const graph = graphOf({
      [`${P}/I.java`]: ['package p;', 'public interface I { void m(); void n(); }'],
      [`${P}/J.java`]: ['package p;', 'public interface J extends I {', '  default void m() {}', '  default void n() {}', '}'],
      [`${P}/Base.java`]: ['package p;', 'public class Base { public void m() {} }'],
      [`${P}/C.java`]: ['package p;', 'public class C extends Base implements J {}'],
    });
    expect(methodEdges(graph)).toEqual([
      'Base#m -implements-> I#m @C.java:2',
      'Base#m -overrides-> J#m @C.java:2',
      'J#m -implements-> I#m @J.java:3',
      'J#n -implements-> I#n @J.java:4',
    ]);
  });

  it('a default method of an interface above the abstract method\'s own interface is never its implementation', () => {
    // I re-declares J#m abstract, so C inherits the abstract I#m, not J's default.
    const graph = graphOf({
      [`${P}/J.java`]: ['package p;', 'public interface J { default void m() {} }'],
      [`${P}/I.java`]: ['package p;', 'public interface I extends J { void m(); }'],
      [`${P}/C.java`]: ['package p;', 'public abstract class C implements I {}'],
    });
    expect(methodEdges(graph)).toEqual([]);
    expect(uncertainGap(graph)).toBeUndefined();
  });

  it('never pairs a method with another method of its own declaring type', () => {
    // Same-arity overloads next to the abstract method; their parameter
    // types cannot be erased, but a type never overrides its own methods.
    const files = {
      [`${P}/Visitor.java`]: [
        'package p;',
        'public abstract class Visitor<T> {',
        '  public enum Element { A }',
        '  public abstract void visit(Element e, T value);',
        '  public void visit(Element e, Element other) {}',
        '}',
      ],
      [`${P}/TextVisitor.java`]: ['package p;', 'public abstract class TextVisitor extends Visitor<String> {}'],
      [`${P}/Shape.java`]: [
        'package p;',
        'public interface Shape {',
        '  enum Kind { A }',
        '  void draw(Kind kind);',
        '  default void draw(Object any) {}',
        '}',
      ],
      [`${P}/Canvas.java`]: ['package p;', 'public abstract class Canvas implements Shape {}'],
    };
    const graph = graphOf(files);
    expect(methodEdges(graph)).toEqual([]);
    expect(uncertainGap(graph)).toBeUndefined();
    expect(uncertainPairs(files)).toEqual([]);
  });

  it('binds nothing through a superclass the repository does not declare', () => {
    const graph = graphOf({
      [`${P}/I.java`]: ['package p;', 'public interface I { void m(); }'],
      [`${P}/K.java`]: ['package p;', 'public interface K { default void m() {} }'],
      [`${P}/C.java`]: [
        'package p;',
        'import org.acme.ExternalBase;',
        'public class C extends ExternalBase implements I, K {}',
      ],
    });
    expect(methodEdges(graph)).toEqual([]);
  });
});

describe('Java interface default methods', () => {
  it('a default method implements the abstract method of a super-interface', () => {
    const graph = graphOf({
      [`${P}/I.java`]: ['package p;', 'public interface I { void m(); }'],
      [`${P}/J.java`]: ['package p;', 'public interface J extends I {', '  default void m() {}', '}'],
    });
    expect(methodEdges(graph)).toEqual(['J#m -implements-> I#m @J.java:3']);
  });

  it('a default method overrides the default method of a super-interface', () => {
    const graph = graphOf({
      [`${P}/K.java`]: ['package p;', 'public interface K { default void hello() {} }'],
      [`${P}/L.java`]: ['package p;', 'public interface L extends K {', '  default void hello() {}', '}'],
    });
    expect(methodEdges(graph)).toEqual(['L#hello -overrides-> K#hello @L.java:3']);
  });

  it('a class method overrides an interface default method', () => {
    const graph = graphOf({
      [`${P}/I.java`]: ['package p;', 'public interface I { default void m() {} }'],
      [`${P}/C.java`]: ['package p;', 'public class C implements I {', '  public void m() {}', '}'],
    });
    expect(methodEdges(graph)).toEqual(['C#m -overrides-> I#m @C.java:3']);
  });
});

describe('Java class-wins inherited overrides', () => {
  const J = { [`${P}/J.java`]: ['package p;', 'public interface J { default void m() {} }'] };
  const B = { [`${P}/B.java`]: ['package p;', 'public class B { public void m() {} }'] };

  it('binds the superclass method a class inherits to the default method it wins over, at the implements line', () => {
    const graph = graphOf({
      ...J,
      ...B,
      [`${P}/C.java`]: [
        'package p;', //        1
        'public class C', //    2
        '    extends B', //     3
        '    implements J {', //4
        '}', //                 5
      ],
    });
    expect(methodEdges(graph)).toEqual(['B#m -overrides-> J#m @C.java:4']);
    expect(uncertainGap(graph)).toBeUndefined();
  });

  it('finds the method two levels up the superclass chain, whichever type brings the interface in', () => {
    const viaC = graphOf({
      ...J,
      ...B,
      [`${P}/B2.java`]: ['package p;', 'public class B2 extends B {}'],
      [`${P}/C.java`]: ['package p;', 'public class C extends B2', '    implements J {}'],
    });
    expect(methodEdges(viaC)).toEqual(['B#m -overrides-> J#m @C.java:3']);
    // B2 brings J in: B2 and C both bind the pair; the smallest evidence wins.
    const viaB2 = graphOf({
      ...J,
      ...B,
      [`${P}/B2.java`]: ['package p;', 'public class B2 extends B implements J {}'],
      [`${P}/C.java`]: ['package p;', 'public class C extends B2 {}'],
    });
    expect(methodEdges(viaB2)).toEqual(['B#m -overrides-> J#m @B2.java:2']);
  });

  it('binds nothing past an abstract re-declaration in the superclass chain', () => {
    const graph = graphOf({
      ...J,
      ...B,
      [`${P}/Mid.java`]: ['package p;', 'public abstract class Mid extends B { public abstract void m(); }'],
      [`${P}/C.java`]: ['package p;', 'public abstract class C extends Mid implements J {}'],
    });
    expect(methodEdges(graph)).toEqual([]);
    expect(uncertainGap(graph)).toBeUndefined();
  });

  it('never repeats a pair the superclass method\'s own type already states', () => {
    const files = {
      ...J,
      [`${P}/B.java`]: ['package p;', 'public class B implements J { public void m() {} }'],
      [`${P}/C.java`]: ['package p;', 'public class C extends B implements J {}'],
    };
    expect(methodEdges(graphOf(files))).toEqual(['B#m -overrides-> J#m @B.java:2']);
    expect(resolverMethodEdges(files)).toEqual(['B#m() -overrides-> J#m() @B.java:2']);
  });

  it('leaves a class method whose own type already has the interface to its own nearest override', () => {
    // Mid#m overrides Base#m, which overrides J#m: the own rule keeps the
    // nearest only, and C inheriting Mid#m does not add Mid#m -> J#m.
    const graph = graphOf({
      ...J,
      [`${P}/Base.java`]: ['package p;', 'public class Base implements J { public void m() {} }'],
      [`${P}/Mid.java`]: ['package p;', 'public class Mid extends Base { public void m() {} }'],
      [`${P}/C.java`]: ['package p;', 'public class C extends Mid {}'],
    });
    expect(methodEdges(graph)).toEqual([
      'Base#m -overrides-> J#m @Base.java:2',
      'Mid#m -overrides-> Base#m @Mid.java:2',
    ]);
  });

  it('an uncertain signature is an uncertain overrides pair, not an edge', () => {
    const files = {
      [`${P}/Loan.java`]: ['package p;', 'public class Loan {}'],
      [`${P}/J.java`]: ['package p;', 'public interface J<T> { default void put(T x) {} }'],
      [`${P}/B.java`]: ['package p;', 'public class B { public void put(Loan x) {} }'],
      [`${P}/C.java`]: ['package p;', 'public class C extends B implements J<Loan> {}'],
    };
    const graph = graphOf(files);
    expect(methodEdges(graph)).toEqual([]);
    expect(uncertainGap(graph)).toMatchObject({ scope: 'java', count: 1 });
    expect(uncertainPairs(files)).toEqual(['B#put(Loan) ~overrides~ J#put(T) @C.java:2']);
  });

  it('no inherited edge when the class declares the method itself', () => {
    const graph = graphOf({
      ...J,
      ...B,
      [`${P}/C.java`]: ['package p;', 'public class C extends B implements J { public void m() {} }'],
    });
    expect(methodEdges(graph)).toEqual([
      'C#m -overrides-> B#m @C.java:2',
      'C#m -overrides-> J#m @C.java:2',
    ]);
  });
});

describe('Java concrete overrides', () => {
  const FALLBACK = {
    [`${P}/Base.java`]: [
      'package p;',
      'public class Base {',
      '  public String fallback(Long id, String reason) { return reason; }',
      '}',
    ],
    [`${P}/Sub.java`]: [
      'package p;',
      'public class Sub extends Base {',
      '  @Override',
      '  public String fallback(Long id, String reason) { return ""; }',
      '  public String fallback(Long id) { return ""; }',
      '}',
    ],
    [`${P}/Client.java`]: [
      'package p;',
      'public class Client {',
      '  private Base base;',
      '  String go() { return base.fallback(1L, "x"); }',
      '}',
    ],
  };

  it('a subclass method overrides the base method with the same erased signature, at its first line', () => {
    expect(methodEdges(graphOf(FALLBACK))).toEqual(['Sub#fallback -overrides-> Base#fallback @Sub.java:3']);
  });

  it('only the nearest concrete ancestor on a supertype path: a three-level chain gives two edges, not three', () => {
    const graph = graphOf({
      [`${P}/A.java`]: ['package p;', 'public class A { public void run() {} }'],
      [`${P}/B.java`]: ['package p;', 'public class B extends A { public void run() {} }'],
      [`${P}/C.java`]: ['package p;', 'public class C extends B { public void run() {} }'],
    });
    expect(methodEdges(graph)).toEqual([
      'B#run -overrides-> A#run @B.java:2',
      'C#run -overrides-> B#run @C.java:2',
    ]);
  });

  it('skips an ancestor that does not declare the method, and a private one, to reach the nearest that does', () => {
    const graph = graphOf({
      [`${P}/A.java`]: ['package p;', 'public class A { public void run() {} }'],
      [`${P}/B.java`]: ['package p;', 'public class B extends A { private void run(int n) {} }'],
      [`${P}/B2.java`]: ['package p;', 'public class B2 extends B { private void run() {} }'],
      [`${P}/C.java`]: ['package p;', 'public class C extends B2 { public void run() {} }'],
    });
    expect(methodEdges(graph)).toEqual(['C#run -overrides-> A#run @C.java:2']);
  });

  it('overrides the nearest method on every supertype path: a superclass method and an interface default', () => {
    const graph = graphOf({
      [`${P}/I.java`]: ['package p;', 'public interface I { default void m() {} }'],
      [`${P}/Base.java`]: ['package p;', 'public class Base { public void m() {} }'],
      [`${P}/C.java`]: ['package p;', 'public class C extends Base implements I {', '  public void m() {}', '}'],
    });
    expect(methodEdges(graph)).toEqual([
      'C#m -overrides-> Base#m @C.java:3',
      'C#m -overrides-> I#m @C.java:3',
    ]);
  });

  it('a package-access method is overridden only from its own package', () => {
    const graph = graphOf({
      'src/main/java/a/Base.java': ['package a;', 'public class Base { void hook() {} protected void shared() {} }'],
      'src/main/java/a/Near.java': ['package a;', 'public class Near extends Base { void hook() {} }'],
      'src/main/java/b/Far.java': [
        'package b;',
        'import a.Base;',
        'public class Far extends Base { void hook() {} protected void shared() {} }',
      ],
    });
    expect(methodEdges(graph)).toEqual([
      'Far#shared -overrides-> Base#shared @Far.java:3',
      'Near#hook -overrides-> Base#hook @Near.java:2',
    ]);
  });

  it('no edge to an ancestor outside the repository', () => {
    const graph = graphOf({
      [`${P}/Job.java`]: ['package p;', 'public class Job extends Thread {', '  public void run() {}', '}'],
    });
    expect(methodEdges(graph)).toEqual([]);
    expect(uncertainGap(graph)).toBeUndefined();
  });
});

describe('static and private methods never pair', () => {
  const FILES = {
    [`${P}/I.java`]: [
      'package p;',
      'public interface I {',
      '  static I of() { return null; }',
      '  private void secret() {}',
      '  void m();',
      '}',
    ],
    [`${P}/Base.java`]: [
      'package p;',
      'public class Base {',
      '  public static void util() {}',
      '  private void hidden() {}',
      '  public void m() {}',
      '}',
    ],
    [`${P}/Sub.java`]: [
      'package p;',
      'public class Sub extends Base implements I {',
      '  public static I of() { return null; }',
      '  public static void util() {}',
      '  private void hidden() {}',
      '  public void secret() {}',
      '}',
    ],
  };

  it('neither as the overriding nor as the overridden method, and never as an uncertain pair', () => {
    const graph = graphOf(FILES);
    expect(methodEdges(graph)).toEqual(['Base#m -implements-> I#m @Sub.java:2']);
    expect(uncertainGap(graph)).toBeUndefined();
  });

  it('a row extracted before modifiers existed is read as nothing being static or private', () => {
    const rows = extract(FILES);
    for (const row of rows) {
      for (const f of row.functions) {
        delete f.visibility;
        delete f.modifiers;
        delete f.annotations;
      }
    }
    expect(methodEdges(graphOfRows(rows))).toEqual([
      'Base#m -implements-> I#m @Sub.java:2',
      'Sub#hidden -overrides-> Base#hidden @Sub.java:5',
      'Sub#of -overrides-> I#of @Sub.java:3',
      'Sub#secret -overrides-> I#secret @Sub.java:6',
      'Sub#util -overrides-> Base#util @Sub.java:4',
    ]);
  });
});

describe('Java pairs whose erased signatures cannot be compared', () => {
  const COB = {
    [`${P}/Loan.java`]: ['package p;', 'public class Loan {}'],
    [`${P}/COBBusinessStep.java`]: ['package p;', 'public interface COBBusinessStep<T> {', '  T execute(T input);', '}'],
    [`${P}/LoanStep.java`]: [
      'package p;',
      'public class LoanStep implements COBBusinessStep<Loan> {',
      '  public Loan execute(Loan input) { return input; }',
      '}',
    ],
  };

  it('a type-variable parameter: no implements edge, an override-uncertain gap naming both declarations', () => {
    const graph = graphOf(COB);
    expect(methodEdges(graph)).toEqual([]);
    const gap = uncertainGap(graph);
    expect(gap).toMatchObject({ scope: 'java', count: 1 });
    expect(gap.reason).toMatch(/^Java method pair/);
    expect(gap.samples).toEqual([
      `function:${P}/LoanStep.java:LoanStep#execute(Loan) ~ function:${P}/COBBusinessStep.java:COBBusinessStep#execute(T)`,
    ]);
    expect(uncertainPairs(COB)).toEqual(['LoanStep#execute(Loan) ~implements~ COBBusinessStep#execute(T) @LoanStep.java:3']);
  });

  it('the resolver reports an uncertain pair as both ids, the relation it would be, and its evidence', () => {
    const rows = extract(COB);
    const functionIds = new Map(rows.map((row) => [row.path, (row.functions ?? []).map((f) => `${f.owner}#${f.name}`)]));
    const classIds = new Map(rows.map((row) => [row.path, (row.classes ?? []).map((c) => c.name)]));
    const result = createJavaCallResolver({ rows, functionIds, classIds }).hierarchyEdges();
    expect(Object.keys(result).sort()).toEqual(['methodEdges', 'overrideEdges', 'typeEdges', 'uncertainPairs']);
    expect(result.methodEdges).toEqual([]);
    expect(result.overrideEdges).toEqual([]);
    expect(result.uncertainPairs).toEqual([{
      source: 'LoanStep#execute', target: 'COBBusinessStep#execute', relation: 'implements', file: `${P}/LoanStep.java`, line: 3,
    }]);
  });

  it('a nested-type parameter on both sides: no overrides edge, an uncertain pair', () => {
    const files = {
      [`${P}/Outer.java`]: ['package p;', 'public class Outer {', '  public static class Event {}', '}'],
      [`${P}/Base.java`]: ['package p;', 'public class Base {', '  public void handle(Outer.Event e) {}', '}'],
      [`${P}/Sub.java`]: ['package p;', 'public class Sub extends Base {', '  public void handle(Outer.Event e) {}', '}'],
    };
    const graph = graphOf(files);
    expect(methodEdges(graph)).toEqual([]);
    expect(uncertainGap(graph)).toMatchObject({ count: 1 });
    expect(uncertainPairs(files)).toEqual(['Sub#handle(Outer.Event) ~overrides~ Base#handle(Outer.Event) @Sub.java:3']);
  });

  it('a parameter type an on-demand import of an outside package brings in: an uncertain pair', () => {
    const files = {
      [`${P}/Handler.java`]: ['package p;', 'import org.acme.*;', 'public interface Handler {', '  void accept(Payload payload);', '}'],
      [`${P}/Impl.java`]: ['package p;', 'import org.acme.*;', 'public class Impl implements Handler {', '  public void accept(Payload payload) {}', '}'],
    };
    const graph = graphOf(files);
    expect(methodEdges(graph)).toEqual([]);
    expect(uncertainPairs(files)).toEqual(['Impl#accept(Payload) ~implements~ Handler#accept(Payload) @Impl.java:4']);
  });

  it('an uncertain nearer ancestor does not stop a certain match further up', () => {
    const files = {
      [`${P}/Loan.java`]: ['package p;', 'public class Loan {}'],
      [`${P}/Top.java`]: ['package p;', 'public class Top { public void put(Loan x) {} }'],
      [`${P}/Mid.java`]: ['package p;', 'public class Mid<T> extends Top { public void put(T x) {} }'],
      [`${P}/Sub.java`]: ['package p;', 'public class Sub extends Mid<Loan> { public void put(Loan x) {} }'],
      [`${P}/Sink.java`]: ['package p;', 'public interface Sink { void put(Loan x); }'],
      [`${P}/Impl.java`]: ['package p;', 'public class Impl extends Mid<Loan>', '    implements Sink {}'],
    };
    expect(methodEdges(graphOf(files))).toEqual([
      'Sub#put -overrides-> Top#put @Sub.java:2',
      'Top#put -implements-> Sink#put @Impl.java:3',
    ]);
    expect(uncertainPairs(files)).toEqual([
      'Mid#put(T) ~implements~ Sink#put(Loan) @Impl.java:3',
      'Mid#put(T) ~overrides~ Top#put(Loan) @Mid.java:2',
      'Sub#put(Loan) ~overrides~ Mid#put(T) @Sub.java:2',
    ]);
  });

  it('records each pair once, however many types bind it, and counts every pair in the gap', () => {
    const files = {
      ...COB,
      [`${P}/StepBase.java`]: ['package p;', 'public class StepBase {', '  public Loan execute(Loan input) { return input; }', '}'],
      [`${P}/StepA.java`]: ['package p;', 'public class StepA extends StepBase implements COBBusinessStep<Loan> {}'],
      [`${P}/StepB.java`]: ['package p;', 'public class StepB extends StepBase implements COBBusinessStep<Loan> {}'],
    };
    const graph = graphOf(files);
    expect(methodEdges(graph)).toEqual([]);
    expect(uncertainPairs(files)).toEqual([
      'LoanStep#execute(Loan) ~implements~ COBBusinessStep#execute(T) @LoanStep.java:3',
      'StepBase#execute(Loan) ~implements~ COBBusinessStep#execute(T) @StepA.java:2',
    ]);
    const gap = uncertainGap(graph);
    expect(gap.count).toBe(2);
    expect(gap.samples).toEqual([
      `function:${P}/LoanStep.java:LoanStep#execute(Loan) ~ function:${P}/COBBusinessStep.java:COBBusinessStep#execute(T)`,
      `function:${P}/StepBase.java:StepBase#execute(Loan) ~ function:${P}/COBBusinessStep.java:COBBusinessStep#execute(T)`,
    ]);
  });

  it('keeps the gap and the call-site gaps apart: an uncertain pair is never a call-site bucket', () => {
    const graph = graphOf(COB);
    const kinds = graph.gaps.filter((g) => g.scope === 'java').map((g) => g.kind);
    expect(kinds).toEqual(['override-uncertain']);
  });
});

describe('traversal over overrides and inherited implementations', () => {
  it('reaches Sub#fallback from a caller of Base#fallback, through calls and overrides', () => {
    const graph = graphOf({
      [`${P}/Base.java`]: ['package p;', 'public class Base {', '  public String fallback(Long id, String reason) { return reason; }', '}'],
      [`${P}/Sub.java`]: ['package p;', 'public class Sub extends Base {', '  public String fallback(Long id, String reason) { return ""; }', '}'],
      [`${P}/Client.java`]: ['package p;', 'public class Client {', '  private Base base;', '  String go() { return base.fallback(1L, "x"); }', '}'],
    });
    const caller = fn(graph, 'Client', 'go');
    const override = fn(graph, 'Sub', 'fallback');
    const { path, edges } = boundedShortestPath(graph.edges, [caller], [override]);
    expect(path).toEqual([caller, fn(graph, 'Base', 'fallback'), override]);
    expect(edges.map((e) => e.type)).toEqual(['calls', 'overrides']);
  });

  it('reaches the inherited Base#m from a caller of I#m, through calls and implements', () => {
    const graph = graphOf({
      [`${P}/I.java`]: ['package p;', 'public interface I { void m(); }'],
      [`${P}/Base.java`]: ['package p;', 'public class Base { public void m() {} }'],
      [`${P}/C.java`]: ['package p;', 'public class C extends Base implements I {}'],
      [`${P}/Client.java`]: ['package p;', 'public class Client {', '  private I target;', '  void go() { target.m(); }', '}'],
    });
    const caller = fn(graph, 'Client', 'go');
    const inherited = fn(graph, 'Base', 'm');
    const { path, edges } = boundedShortestPath(graph.edges, [caller], [inherited]);
    expect(path).toEqual([caller, fn(graph, 'I', 'm'), inherited]);
    expect(edges.map((e) => e.type)).toEqual(['calls', 'implements']);
  });

  it('reaches the class-wins B#m from a caller of the default J#m, through calls and overrides', () => {
    const graph = graphOf({
      [`${P}/J.java`]: ['package p;', 'public interface J { default void m() {} }'],
      [`${P}/B.java`]: ['package p;', 'public class B { public void m() {} }'],
      [`${P}/C.java`]: ['package p;', 'public class C extends B implements J {}'],
      [`${P}/Client.java`]: ['package p;', 'public class Client {', '  private J target;', '  void go() { target.m(); }', '}'],
    });
    const caller = fn(graph, 'Client', 'go');
    const winner = fn(graph, 'B', 'm');
    const { path, edges } = boundedShortestPath(graph.edges, [caller], [winner]);
    expect(path).toEqual([caller, fn(graph, 'J', 'm'), winner]);
    expect(edges.map((e) => e.type)).toEqual(['calls', 'overrides']);
  });
});
