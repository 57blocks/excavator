// dead-code-detection, tasks 2.1-2.3: Java method references are call sites
// with an unknown argument count. The structure row accepts them, the
// resolver looks them up by name at any arity (one declaration is an edge,
// more are ambiguous, an array constructor is external), and the fact graph
// counts them in its call-site conservation. Every case runs the real
// tree-sitter extractor.
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

/** Structure rows for `{ path: lines }`, through the real extractor; `.kt` files are Kotlin. */
function extract(files) {
  return Object.entries(files).map(([path, lines]) => {
    const source = [...lines, ''].join('\n');
    const file = { path, language: path.endsWith('.kt') ? 'kotlin' : 'java', fileCategory: 'code' };
    const extracted = analyzeFileWithOutcomes(registry, file, source);
    expect(extracted.structureOutcome).toBe('succeeded');
    expect(extracted.callGraphOutcome).toBe('succeeded');
    return buildResult(file, lines.length, lines.length, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome);
  });
}

const label = (fn) => `${fn.owner}#${fn.name}(${(fn.paramTypes ?? []).join(',')})`;

/** Every method-reference site of `path` as `line callee -> outcome` (target and caller for an edge). */
function referenceOutcomes(files, path) {
  const all = extract(files);
  const rows = all.filter((row) => row.language === 'java');
  const functionIds = new Map(rows.map((row) => [row.path, (row.functions ?? []).map(label)]));
  const resolver = createJavaCallResolver({ rows, functionIds, otherJvmRows: all.filter((row) => row.language === 'kotlin') });
  const row = rows.find((r) => r.path === path);
  return resolver.resolveFileCalls(row).flatMap((result, i) => {
    const site = row.callGraph[i];
    if (site.argCount !== null) return [];
    const where = `${site.lineNumber} ${site.callee}`;
    return [result.outcome === 'edge'
      ? `${where} -> ${result.targetId} (from ${result.callerId})`
      : `${where} -> ${result.outcome}`];
  });
}

const P = 'src/main/java/p';

const PROJECT = {
  [`${P}/PlatformCache.java`]: [
    'package p;',
    'public class PlatformCache {',
    '  private Integer cacheType;',
    '  public boolean isEhcacheEnabled() { return cacheType != null; }',
    '}',
  ],
  [`${P}/Mapper.java`]: [
    'package p;',
    'public class Mapper {',
    '  public static String toData(Loan loan) { return ""; }',
    '  public static String toData(Loan loan, boolean deep) { return ""; }',
    '}',
  ],
  [`${P}/LoanData.java`]: [
    'package p;',
    'public class LoanData {',
    '  public LoanData(Loan loan) {}',
    '}',
  ],
  [`${P}/Pair.java`]: [
    'package p;',
    'public class Pair {',
    '  public Pair(Loan loan) {}',
    '  public Pair(Loan loan, Loan other) {}',
    '}',
  ],
  [`${P}/Empty.java`]: ['package p;', 'public class Empty {}'],
  [`${P}/Point.java`]: ['package p;', 'public record Point(int x, int y) {}'],
  [`${P}/Bean.java`]: [
    'package p;',
    '@lombok.NoArgsConstructor',
    'public class Bean {',
    '  public Bean(String name) {}',
    '}',
  ],
  [`${P}/Account.java`]: [
    'package p;',
    '@lombok.Data',
    'public class Account {',
    '  private String name;',
    '  private String owner;',
    '  public String getName(java.util.Locale locale) { return name; }',
    '  public String getOwner() { return owner; }',
    '}',
  ],
  [`${P}/Helper.java`]: [
    'package p;',
    'public class Helper {',
    '  public String assist() { return ""; }',
    '}',
  ],
  [`${P}/Base.java`]: [
    'package p;',
    'public class Base {',
    '  public void hook() {}',
    '}',
  ],
  [`${P}/Outer.java`]: [
    'package p;',
    'public class Outer {',
    '  public static class Inner { public static void run() {} }',
    '}',
  ],
  [`${P}/Loan.java`]: ['package p;', 'public class Loan {}'],
  'src/main/kotlin/q/UserRepository.kt': ['package q', 'interface UserRepository { fun findByLogin(login: String): Any? }'],
  [`${P}/Svc.java`]: [
    'package p;', //                                                      1
    'import java.util.List;', //                                          2
    'import q.UserRepository;', //                                        3
    'public class Svc extends Base {', //                                 4
    '  void run(List<Loan> loans, Helper h, UserRepository users) {', //  5
    '    f(PlatformCache::isEhcacheEnabled);', //                         6
    '    f(h::assist);', //                                               7
    '    f(this::local);', //                                             8
    '    f(super::hook);', //                                             9
    '    f(Mapper::toData);', //                                         10
    '    f(LoanData::new);', //                                          11
    '    f(Pair::new);', //                                              12
    '    f(int[]::new);', //                                             13
    '    f(String[]::new);', //                                          14
    '    loans.forEach(l -> f(PlatformCache::isEhcacheEnabled));', //    15
    '    f(this::spread);', //                                           16
    '    f(users::findByLogin);', //                                     17
    '    f(UserRepository::findByLogin);', //                            18
    '    f(Outer.Inner::new);', //                                       19
    '    f(Outer.Inner::run);', //                                       20
    '    f(String::valueOf);', //                                        21
    '    f(Helper::toString);', //                                       22
    '    f(Helper::missing);', //                                        23
    '    f(Empty::new);', //                                             24
    '    f(Point::new);', //                                             25
    '    f(Bean::new);', //                                              26
    '    f(Account::getName);', //                                       27
    '    f(Account::getOwner);', //                                      28
    '    f(Account::setName);', //                                       29
    '  }',
    '  void local() {}',
    '  void spread(String... parts) {}',
    '  void f(Object o) {}',
    '}',
  ],
};

const RUN = 'Svc#run(List<Loan>,Helper,UserRepository)';

describe('structure row: method reference call sites', () => {
  it('passes a method reference through with argCount null', () => {
    const [row] = extract({ [`${P}/Svc.java`]: ['package p;', 'class Svc {', '  void run() { f(PlatformCache::isEhcacheEnabled); }', '}'] });
    expect(row.callGraph).toEqual([
      { caller: 'run', callee: 'f', lineNumber: 3, receiver: { kind: 'none' }, argCount: 1, enclosingType: 'Svc' },
      {
        caller: 'run', callee: 'isEhcacheEnabled', lineNumber: 3,
        receiver: { kind: 'name', name: 'PlatformCache' }, argCount: null, enclosingType: 'Svc',
      },
    ]);
  });

  it('accepts a null argument count and still rejects any other non-count', () => {
    const file = { path: `${P}/X.java`, language: 'java', fileCategory: 'code' };
    const outcome = (argCount) => {
      const site = { caller: 'm', callee: 'n', lineNumber: 1, receiver: { kind: 'this' }, argCount, enclosingType: 'X' };
      const plugin = { analyzeFileFull: () => ({ structure: { functions: [], classes: [], imports: [], exports: [] }, callGraph: [site] }) };
      const fake = { getPluginForFile: () => plugin, analyzeFileFull: plugin.analyzeFileFull };
      return analyzeFileWithOutcomes(fake, file, '').callGraphOutcome;
    };
    expect(outcome(null)).toBe('succeeded');
    expect(outcome(0)).toBe('succeeded');
    expect(outcome(-1)).toBe('failed');
    expect(outcome('1')).toBe('failed');
    expect(outcome(1.5)).toBe('failed');
  });
});

describe('Java method references resolve by name at any arity', () => {
  const svc = () => referenceOutcomes(PROJECT, `${P}/Svc.java`);

  it('a type-qualified reference to the one declaration of that name is an edge from the enclosing method', () => {
    expect(svc()).toContain(`6 isEhcacheEnabled -> PlatformCache#isEhcacheEnabled() (from ${RUN})`);
  });

  it('expression, this and super references resolve like the calls of the same shape', () => {
    expect(svc()).toEqual(expect.arrayContaining([
      `7 assist -> Helper#assist() (from ${RUN})`,
      `8 local -> Svc#local() (from ${RUN})`,
      `9 hook -> Base#hook() (from ${RUN})`,
    ]));
  });

  it('overloads of any arity are ambiguous; one is never picked', () => {
    expect(svc()).toContain('10 toData -> calls-ambiguous');
  });

  it('a constructor reference: one constructor is an edge, two are ambiguous', () => {
    expect(svc()).toEqual(expect.arrayContaining([
      `11 new LoanData -> LoanData#LoanData(Loan) (from ${RUN})`,
      '12 new Pair -> calls-ambiguous',
    ]));
  });

  it('an array constructor reference is external', () => {
    expect(svc()).toEqual(expect.arrayContaining([
      '13 new int[] -> calls-external',
      '14 new String[] -> calls-external',
    ]));
  });

  it('a reference inside a lambda is attributed to the enclosing method', () => {
    expect(svc()).toContain(`15 isEhcacheEnabled -> PlatformCache#isEhcacheEnabled() (from ${RUN})`);
  });

  it('a varargs method is applicable', () => {
    expect(svc()).toContain(`16 spread -> Svc#spread(String...) (from ${RUN})`);
  });

  it('a Kotlin repository type or a nested member type is unresolved, never external', () => {
    expect(svc()).toEqual(expect.arrayContaining([
      '17 findByLogin -> calls-unresolved',
      '18 findByLogin -> calls-unresolved',
      '19 new Outer.Inner -> calls-unresolved',
      '20 run -> calls-unresolved',
    ]));
  });

  it('outside types and undeclared Object methods are external; a missing method is unresolved', () => {
    expect(svc()).toEqual(expect.arrayContaining([
      '21 valueOf -> calls-external',
      '22 toString -> calls-external',
      '23 missing -> calls-unresolved',
    ]));
  });

  it('constructors the source does not declare are generated; a possibly generated one makes a declared one ambiguous', () => {
    expect(svc()).toEqual(expect.arrayContaining([
      '24 new Empty -> calls-generated',
      '25 new Point -> calls-generated',
      '26 new Bean -> calls-ambiguous',
    ]));
  });

  it('a generated accessor of another arity makes a declared one ambiguous; of the same arity it is the declared one', () => {
    expect(svc()).toEqual(expect.arrayContaining([
      '27 getName -> calls-ambiguous',
      `28 getOwner -> Account#getOwner() (from ${RUN})`,
      '29 setName -> calls-generated',
    ]));
  });

  it('every method reference of the file has exactly one outcome', () => {
    expect(svc()).toHaveLength(24);
  });
});

describe('Java method references in the fact graph', () => {
  function graphOf(files) {
    const rows = extract(files);
    const scan = {
      files: rows.map((r) => ({ path: r.path, language: r.language, fileCategory: 'code', sizeLines: r.totalLines })),
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

  const SAMPLE = {
    [`${P}/PlatformCache.java`]: PROJECT[`${P}/PlatformCache.java`],
    [`${P}/Mapper.java`]: PROJECT[`${P}/Mapper.java`],
    [`${P}/LoanData.java`]: PROJECT[`${P}/LoanData.java`],
    [`${P}/Loan.java`]: PROJECT[`${P}/Loan.java`],
    [`${P}/ConfigService.java`]: [
      'package p;', //                                                                      1
      'import java.util.Optional;', //                                                      2
      'public class ConfigService {', //                                                    3
      '  public boolean isEhcacheEnabled(Optional<PlatformCache> cache) {', //              4
      '    return cache.map(PlatformCache::isEhcacheEnabled).orElseThrow();', //             5
      '  }', //                                                                             6
      '  public Object convert(Optional<Loan> loan) {', //                                  7
      '    loan.map(Mapper::toData);', //                                                   8
      '    return loan.map(LoanData::new);', //                                             9
      '  }', //                                                                            10
      '}', //                                                                              11
    ],
  };

  it('a PlatformCache::isEhcacheEnabled reference is a calls edge from the enclosing method, with its line as evidence', () => {
    const { graph } = graphOf(SAMPLE);
    const calls = graph.edges.filter((e) => e.type === 'calls');
    const edge = calls.find((e) => e.target === `function:${P}/PlatformCache.java:PlatformCache#isEhcacheEnabled()`);
    expect(edge).toMatchObject({
      source: `function:${P}/ConfigService.java:ConfigService#isEhcacheEnabled(Optional<PlatformCache>)`,
      provenance: 'extracted',
      evidence: [{ file: `${P}/ConfigService.java`, line: 5, source: 'tree-sitter' }],
    });
  });

  it('a constructor reference is a calls edge to the constructor; an overloaded reference is an ambiguous gap', () => {
    const { graph } = graphOf(SAMPLE);
    const calls = graph.edges.filter((e) => e.type === 'calls');
    expect(calls.find((e) => e.target === `function:${P}/LoanData.java:LoanData#LoanData(Loan)`)).toMatchObject({
      source: `function:${P}/ConfigService.java:ConfigService#convert(Optional<Loan>)`,
      evidence: [{ file: `${P}/ConfigService.java`, line: 9, source: 'tree-sitter' }],
    });
    expect(calls.some((e) => e.target.includes('Mapper#toData'))).toBe(false);
    const ambiguous = graph.gaps.find((g) => g.scope === 'java' && g.kind === 'calls-ambiguous');
    expect(ambiguous.samples).toEqual([`${P}/ConfigService.java:8 -> toData`]);
  });

  it('counts method reference sites in the call-site conservation', () => {
    const { rows, graph } = graphOf(SAMPLE);
    const sites = rows.flatMap((r) => r.callGraph ?? []);
    const references = sites.filter((s) => s.argCount === null);
    expect(references.map((s) => `${s.lineNumber} ${s.callee}`)).toEqual([
      '5 isEhcacheEnabled', '8 toData', '9 new LoanData',
    ]);
    // `cache.map` and both `loan.map` are outside the repository; the
    // `orElseThrow` on an outside call's result is unresolved.
    const tally = { edge: graph.edges.filter((e) => e.type === 'calls').length, ...javaTally(graph) };
    expect(tally).toEqual({ edge: 2, 'calls-ambiguous': 1, 'calls-external': 3, 'calls-unresolved': 1 });
    expect(() => assertCallConservation(sites.length, tally)).not.toThrow();
    // Dropping the method reference sites from the count is caught.
    expect(() => assertCallConservation(sites.length - references.length, tally)).toThrow(/call site/);
  });
});
