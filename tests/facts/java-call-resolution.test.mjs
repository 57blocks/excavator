// java-member-call-resolution, tasks 3.1–3.3: Java call sites resolve by the
// declared type of their receiver. Every case here runs real tree-sitter
// extraction, so the receivers are the ones the extractor actually reports.
import { beforeAll, describe, expect, it } from 'vitest';
import { PluginRegistry, TreeSitterPlugin, builtinLanguageConfigs, registerAllParsers } from '@excavator/core';
import { analyzeFileWithOutcomes, buildResult } from '../../skills/excavator/extract-structure-result.mjs';
import { buildFactGraph } from '../../skills/excavator/build-fact-graph.mjs';
import {
  JAVA_CALL_OUTCOMES,
  assertCallConservation,
  createJavaCallResolver,
} from '../../skills/excavator/java-call-resolution.mjs';

let registry;
beforeAll(async () => {
  const tsPlugin = new TreeSitterPlugin(builtinLanguageConfigs.filter((c) => c.treeSitter));
  await tsPlugin.init();
  registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);
});

/** Structure rows for `{ path: source }`, through the real extractor. */
function extract(files) {
  return Object.entries(files).map(([path, lines]) => {
    const source = [...lines, ''].join('\n');
    const file = { path, language: 'java', fileCategory: 'code' };
    const extracted = analyzeFileWithOutcomes(registry, file, source);
    expect(extracted.structureOutcome).toBe('succeeded');
    expect(extracted.callGraphOutcome).toBe('succeeded');
    return buildResult(file, lines.length, lines.length, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome);
  });
}

const label = (fn) => `${fn.owner}#${fn.name}(${(fn.paramTypes ?? []).join(',')})`;

/**
 * Every call site of `path` as `line callee -> outcome`, with the target
 * declaration for an edge. Node ids are stand-ins (`Owner#name(types)`) so
 * the expectations read like the source.
 */
function outcomes(files, path) {
  const rows = extract(files);
  const functionIds = new Map(rows.map((row) => [row.path, (row.functions ?? []).map(label)]));
  const resolver = createJavaCallResolver({ rows, functionIds });
  const row = rows.find((r) => r.path === path);
  return resolver.resolveFileCalls(row).map((result, i) => {
    const site = row.callGraph[i];
    const where = `${site.lineNumber} ${site.callee}`;
    return result.outcome === 'edge'
      ? `${where} -> ${result.targetId} (from ${result.callerId})`
      : `${where} -> ${result.outcome}`;
  });
}

const P = 'src/main/java/p';

const PROJECT = {
  [`${P}/Helper.java`]: [
    'package p;',
    'public class Helper {',
    '  public String assist() { return ""; }',
    '  public int find(Long id) { return 0; }',
    '  public int find(Long id, boolean deep) { return 0; }',
    '  public int pick(String a) { return 0; }',
    '  public int pick(Long a) { return 0; }',
    '}',
  ],
  [`${P}/PaymentService.java`]: [
    'package p;',
    'public interface PaymentService {',
    '  void pay(long amount);',
    '  default void payTwice(long amount) { pay(amount); }',
    '}',
  ],
  [`${P}/Loan.java`]: [
    'package p;',
    'import org.springframework.data.domain.AbstractAggregateRoot;',
    '@lombok.AllArgsConstructor',
    'public class Loan extends AbstractAggregateRoot<Loan> {',
    '  private String status;',
    '  private boolean isActive;',
    '  private Money principal;',
    '  public Loan() {}',
    '  public Money principal() { return principal; }',
    '  public <T> T convert(Class<T> type) { return null; }',
    '}',
  ],
  [`${P}/Money.java`]: [
    'package p;',
    'public class Money {',
    '  public Money plus(Money other) { return this; }',
    '}',
  ],
  [`${P}/Status.java`]: [
    'package p;',
    'public enum Status {',
    '  ACTIVE, CLOSED;',
    '  public String code() { return name(); }',
    '}',
  ],
  [`${P}/Point.java`]: [
    'package p;',
    'public record Point(int x, int y) {}',
  ],
  [`${P}/Util.java`]: [
    'package p;',
    'public final class Util {',
    '  public static String helper(String s) { return s; }',
    '  public static final Helper SHARED = new Helper();',
    '}',
  ],
  [`${P}/Svc.java`]: [
    'package p;', //                                             1
    'import java.util.List;', //                                 2
    'import static p.Util.helper;', //                           3
    'public class Svc<M extends Money> {', //                    4
    '  private Helper helper;', //                               5
    '  private PaymentService payments;', //                     6
    '  private M amount;', //                                    7
    '  void run(Loan loan, List<String> names, Status status, int[] arr) {', // 8
    '    helper.assist();', //                                   9
    '    payments.pay(1L);', //                                 10
    '    helper.find(1L, true);', //                            11
    '    helper.pick("a");', //                                 12
    '    names.size();', //                                     13
    '    loan.getStatus();', //                                 14
    '    loan.isActive();', //                                  15
    '    loan.principal().plus(null);', //                      16
    '    loan.convert(Money.class).plus(null);', //             17
    '    names.forEach(n -> n.trim());', //                     18
    '    helper("x");', //                                      19
    '    Status.values();', //                                  20
    '    status.name();', //                                    21
    '    Status.ACTIVE.code();', //                             22
    '    Util.SHARED.assist();', //                             23
    '    java.util.Collections.emptyList();', //                24
    '    amount.plus(null);', //                                25
    '    new Helper();', //                                     26
    '    new Loan();', //                                       27
    '    new Loan("a", true, null);', //                        28
    '    new Point(1, 2);', //                                  29
    '    new java.util.ArrayList<String>();', //                30
    '    "abc".length();', //                                   31
    '    ((Helper) null).assist();', //                         32
    '    arr.clone();', //                                      33
    '    helper.equals(null);', //                              34
    '    helper.missing();', //                                 35
    '    this.local();', //                                     36
    '    local();', //                                          37
    '    new Runnable() { public void run() { local(); } };', // 38
    '  }',
    '  void local() {}',
    '}',
  ],
};

const RUN = 'Svc#run(Loan,List<String>,Status,int[])';

describe('Java call sites resolve by the receiver\'s declared type', () => {
  const svc = () => outcomes(PROJECT, `${P}/Svc.java`);

  it('a field whose declared type is a repository class', () => {
    expect(svc()).toContain(`9 helper.assist -> Helper#assist() (from ${RUN})`);
  });

  it('a receiver typed as a repository interface targets the interface method', () => {
    expect(svc()).toContain(`10 payments.pay -> PaymentService#pay(long) (from ${RUN})`);
  });

  it('overloads are told apart by argument count; same-arity overloads are ambiguous', () => {
    expect(svc()).toContain(`11 helper.find -> Helper#find(Long,boolean) (from ${RUN})`);
    expect(svc()).toContain('12 helper.pick -> calls-ambiguous');
  });

  it('types outside the repository are external', () => {
    expect(svc()).toEqual(expect.arrayContaining([
      '13 names.size -> calls-external',
      '18 names.forEach -> calls-external',
      '24 java.util.Collections.emptyList -> calls-external',
      '30 new java.util.ArrayList<String> -> calls-external',
      '31 "abc".length -> calls-external',
    ]));
  });

  it('a generated accessor is generated, not external, even below an outside superclass', () => {
    expect(svc()).toEqual(expect.arrayContaining([
      '14 loan.getStatus -> calls-generated',
      '15 loan.isActive -> calls-generated',
    ]));
  });

  it('a lambda parameter without a declared type is unresolved', () => {
    expect(svc()).toContain('18 n.trim -> calls-unresolved');
  });

  it('a chained call uses the declared return type; a type variable return is unresolved', () => {
    expect(svc()).toEqual(expect.arrayContaining([
      `16 loan.principal -> Loan#principal() (from ${RUN})`,
      `16 loan.principal().plus -> Money#plus(Money) (from ${RUN})`,
      `17 loan.convert -> Loan#convert(Class<Object>) (from ${RUN})`,
      '17 loan.convert(Money.class).plus -> calls-unresolved',
    ]));
  });

  it('static imports, type names, enum constants and static fields', () => {
    expect(svc()).toEqual(expect.arrayContaining([
      `19 helper -> Util#helper(String) (from ${RUN})`,
      '20 Status.values -> calls-generated',
      '21 status.name -> calls-external',
      `22 Status.ACTIVE.code -> Status#code() (from ${RUN})`,
      `23 Util.SHARED.assist -> Helper#assist() (from ${RUN})`,
    ]));
  });

  it('a field typed by the enclosing type\'s own type variable resolves to its bound', () => {
    expect(svc()).toContain(`25 amount.plus -> Money#plus(Money) (from ${RUN})`);
  });

  it('constructors: declared, implicit, Lombok, record canonical', () => {
    expect(svc()).toEqual(expect.arrayContaining([
      '26 new Helper -> calls-generated',
      `27 new Loan -> Loan#Loan() (from ${RUN})`,
      '28 new Loan -> calls-generated',
      '29 new Point -> calls-generated',
    ]));
  });

  it('casts, arrays, Object methods and missing methods', () => {
    expect(svc()).toEqual(expect.arrayContaining([
      `32 ((Helper) null).assist -> Helper#assist() (from ${RUN})`,
      '33 arr.clone -> calls-external',
      '34 helper.equals -> calls-external',
      '35 helper.missing -> calls-unresolved',
    ]));
  });

  it('this and bare calls resolve in the enclosing type; calls inside an anonymous class have no caller', () => {
    expect(svc()).toEqual(expect.arrayContaining([
      `36 this.local -> Svc#local() (from ${RUN})`,
      `37 local -> Svc#local() (from ${RUN})`,
      // Creating an anonymous class constructs its (here outside) supertype.
      '38 new Runnable -> calls-external',
      '38 local -> calls-caller-unresolved',
    ]));
  });

  it('every call site of the file has exactly one outcome', () => {
    const rows = extract(PROJECT);
    const row = rows.find((r) => r.path === `${P}/Svc.java`);
    expect(svc()).toHaveLength(row.callGraph.length);
  });

  it('a bare call in an interface default method targets the interface method', () => {
    expect(outcomes(PROJECT, `${P}/PaymentService.java`)).toEqual([
      '4 pay -> PaymentService#pay(long) (from PaymentService#payTwice(long))',
    ]);
  });

  it('a bare call to an inherited java.lang.Enum method is external', () => {
    expect(outcomes(PROJECT, `${P}/Status.java`)).toEqual(['4 name -> calls-external']);
  });
});

describe('Java hierarchy, shadowing and type names', () => {
  it('super calls go to the superclass; an outside superclass is external', () => {
    const files = {
      [`${P}/Base.java`]: ['package p;', 'public class Base { void hook() {} }'],
      [`${P}/Child.java`]: [
        'package p;',
        'public class Child extends Base {',
        '  void hook() { super.hook(); }',
        '}',
      ],
      [`${P}/Names.java`]: [
        'package p;',
        'public class Names extends java.util.ArrayList<String> {',
        '  public boolean add(String s) { return super.add(s); }',
        '}',
      ],
    };
    expect(outcomes(files, `${P}/Child.java`)).toEqual(['3 super.hook -> Base#hook() (from Child#hook())']);
    expect(outcomes(files, `${P}/Names.java`)).toEqual(['3 super.add -> calls-external']);
  });

  it('inherited repository methods resolve through the superclass and interfaces', () => {
    const files = {
      [`${P}/Base.java`]: ['package p;', 'public abstract class Base implements Named { void hook() {} }'],
      [`${P}/Named.java`]: ['package p;', 'public interface Named { String label(); }'],
      [`${P}/Child.java`]: [
        'package p;',
        'public class Child extends Base {',
        '  public String label() { return ""; }',
        '  void go(Child c, Base b) { c.hook(); b.label(); c.label(); }',
        '}',
      ],
    };
    expect(outcomes(files, `${P}/Child.java`)).toEqual([
      '4 c.hook -> Base#hook() (from Child#go(Child,Base))',
      '4 b.label -> Named#label() (from Child#go(Child,Base))',
      '4 c.label -> Child#label() (from Child#go(Child,Base))',
    ]);
  });

  it('a static import an outside supertype could shadow is ambiguous, not an edge', () => {
    const files = {
      [`${P}/Util.java`]: PROJECT[`${P}/Util.java`],
      [`${P}/Handler.java`]: [
        'package p;',
        'import static p.Util.helper;',
        'import org.example.Base;',
        'public class Handler extends Base {',
        '  void go() { helper("x"); }',
        '}',
      ],
    };
    expect(outcomes(files, `${P}/Handler.java`)).toEqual(['5 helper -> calls-ambiguous']);
  });

  it('a field inherited from an outside supertype is unresolved, not external', () => {
    const files = {
      [`${P}/Handler.java`]: [
        'package p;',
        'import org.example.Base;',
        'public class Handler extends Base {',
        '  void go() { value.run(); }',
        '}',
      ],
    };
    expect(outcomes(files, `${P}/Handler.java`)).toEqual(['4 value.run -> calls-unresolved']);
  });

  it('a field typed by a supertype\'s type variable is unresolved', () => {
    const files = {
      [`${P}/Money.java`]: PROJECT[`${P}/Money.java`],
      [`${P}/Box.java`]: ['package p;', 'public class Box<T> { public T value; }'],
      [`${P}/User.java`]: [
        'package p;',
        'public class User {',
        '  void go(Box<Money> box) { box.value.plus(null); }',
        '}',
      ],
    };
    expect(outcomes(files, `${P}/User.java`)).toEqual(['3 box.value.plus -> calls-unresolved']);
  });

  it('a nested type is not resolved, even when a top-level type has the same name', () => {
    const files = {
      [`${P}/Entry.java`]: ['package p;', 'public class Entry { public static void make() {} }'],
      [`${P}/Outer.java`]: [
        'package p;',
        'public class Outer {',
        '  static class Entry { static void make() {} }',
        '  void go() { Entry.make(); }',
        '}',
      ],
    };
    expect(outcomes(files, `${P}/Outer.java`)).toEqual(['4 Entry.make -> calls-unresolved']);
  });

  it('a type name declared in two source roots prefers the caller\'s own root', () => {
    const helper = (root) => [`${root}/p/Helper.java`, ['package p;', 'public class Helper { public void assist() {} }']];
    const files = Object.fromEntries([
      helper('a/src/main/java'),
      helper('b/src/main/java'),
      ['a/src/main/java/p/Svc.java', ['package p;', 'public class Svc {', '  void go(Helper h) { h.assist(); }', '}']],
      ['c/src/main/java/q/Other.java', ['package q;', 'import p.Helper;', 'public class Other {', '  void go(Helper h) { h.assist(); }', '}']],
    ]);
    const rows = extract(files);
    const functionIds = new Map(rows.map((row) => [row.path, (row.functions ?? []).map((fn) => `${row.path.split('/')[0]}:${label(fn)}`)]));
    const resolver = createJavaCallResolver({ rows, functionIds });
    const resolve = (path) => resolver.resolveFileCalls(rows.find((r) => r.path === path));
    expect(resolve('a/src/main/java/p/Svc.java')).toEqual([
      { outcome: 'edge', callerId: 'a:Svc#go(Helper)', targetId: 'a:Helper#assist()' },
    ]);
    expect(resolve('c/src/main/java/q/Other.java')).toEqual([{ outcome: 'calls-ambiguous' }]);
  });

  it('a call site whose receiver the extractor did not describe is unresolved', () => {
    const rows = extract({ [`${P}/Money.java`]: PROJECT[`${P}/Money.java`] });
    rows[0].callGraph = [{ caller: 'plus', callee: 'other.plus', lineNumber: 3, enclosingType: 'Money' }];
    const resolver = createJavaCallResolver({ rows, functionIds: new Map([[rows[0].path, ['Money#plus(Money)']]]) });
    expect(resolver.resolveFileCalls(rows[0])).toEqual([{ outcome: 'calls-unresolved' }]);
  });

  it('a target or caller whose node id is shared by another declaration never becomes an edge', () => {
    const rows = extract({ [`${P}/Svc.java`]: ['package p;', 'public class Svc {', '  void a() { b(); }', '  void b() {}', '}'] });
    const resolve = (ids) => createJavaCallResolver({ rows, functionIds: new Map([[rows[0].path, ids]]) }).resolveFileCalls(rows[0]);
    expect(resolve(['Svc#a()', 'Svc#b()'])).toEqual([{ outcome: 'edge', callerId: 'Svc#a()', targetId: 'Svc#b()' }]);
    expect(resolve(['Svc#a()', null])).toEqual([{ outcome: 'calls-ambiguous' }]);
    expect(resolve([null, 'Svc#b()'])).toEqual([{ outcome: 'calls-caller-unresolved' }]);
  });
});

describe('Java call sites in the fact graph', () => {
  function graphOf(files) {
    const rows = extract(files);
    const scan = {
      files: rows.map((r) => ({ path: r.path, language: 'java', fileCategory: 'code', sizeLines: r.totalLines })),
      skipped: [],
      coverage: { limits: { maxFileLines: 20000, maxFileBytes: 2097152 } },
    };
    const importMap = { importMap: Object.fromEntries(rows.map((r) => [r.path, []])), unresolved: {} };
    return { rows, graph: buildFactGraph({ scan, structureAll: { results: rows }, importMap }) };
  }

  const javaTally = (graph) => {
    const tally = {};
    for (const gap of graph.gaps) {
      if (gap.scope === 'java' && JAVA_CALL_OUTCOMES.includes(gap.kind)) tally[gap.kind] = gap.count;
    }
    return tally;
  };

  it('emits a calls edge per resolved site, between real node ids, with evidence', () => {
    const { graph } = graphOf(PROJECT);
    const name = new Map(graph.nodes.map((n) => [n.id, `${n.owner}#${n.name}`]));
    const calls = graph.edges.filter((e) => e.type === 'calls');
    for (const edge of calls) {
      expect(name.has(edge.source) && name.has(edge.target)).toBe(true);
      expect(edge.provenance).toBe('extracted');
      expect(edge.evidence).toHaveLength(1);
    }
    expect(calls.map((e) => `${name.get(e.source)} -> ${name.get(e.target)}`).sort()).toEqual([
      'PaymentService#payTwice -> PaymentService#pay',
      'Svc#run -> Helper#assist',
      'Svc#run -> Helper#find',
      'Svc#run -> Loan#Loan',
      'Svc#run -> Loan#convert',
      'Svc#run -> Loan#principal',
      'Svc#run -> Money#plus',
      'Svc#run -> PaymentService#pay',
      'Svc#run -> Status#code',
      'Svc#run -> Svc#local',
      'Svc#run -> Util#helper',
    ]);
  });

  it('conserves every Java call site: edge sites plus the five buckets equal the site total', () => {
    const { rows, graph } = graphOf(PROJECT);
    const siteCount = rows.reduce((n, r) => n + (r.callGraph?.length ?? 0), 0);
    // Known answers (see the per-site expectations above): 14 of Svc's 34
    // sites and PaymentService.payTwice's one resolve to an edge.
    const edgeSites = 14 + 1;
    const tally = { edge: edgeSites, ...javaTally(graph) };
    expect(siteCount).toBe(36);
    expect(tally).toEqual({
      edge: 15,
      'calls-ambiguous': 1,
      'calls-caller-unresolved': 1,
      'calls-external': 10,
      'calls-generated': 6,
      'calls-unresolved': 3,
    });
    expect(() => assertCallConservation(siteCount, tally)).not.toThrow();

    // A variant that leaks one bucket is caught.
    const { 'calls-generated': _dropped, ...leaky } = tally;
    expect(() => assertCallConservation(siteCount, leaky)).toThrow(/call site/);
    // So is an outcome outside the known set.
    expect(() => assertCallConservation(siteCount, { ...leaky, 'calls-guessed': tally['calls-generated'] })).toThrow(/outside the known set/);
  });

  it('gives Java call gaps Java reasons, and never resolves a Java call by name alone', () => {
    // `save` is declared once in the repository, but `repo` has no declared
    // type the repository knows: the old by-name rule would have linked it.
    const files = {
      [`${P}/Repo.java`]: ['package p;', 'public class Repo { public void save() {} }'],
      [`${P}/Svc.java`]: ['package p;', 'public class Svc {', '  void go() { repo.save(); save(); }', '}'],
    };
    const { graph } = graphOf(files);
    expect(graph.edges.filter((e) => e.type === 'calls')).toEqual([]);
    const gap = graph.gaps.find((g) => g.scope === 'java' && g.kind === 'calls-unresolved');
    expect(gap.count).toBe(2);
    expect(gap.reason).toMatch(/^Java call site/);
    expect(gap.samples).toEqual([`${P}/Svc.java:3 -> repo.save`, `${P}/Svc.java:3 -> save`]);
  });
});
