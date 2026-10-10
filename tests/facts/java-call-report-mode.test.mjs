// dead-code-detection, task 3.3 (design D13): the Java resolver's report
// mode. Every site may carry the repository type its method lookup ran on
// (`receiverType`); an ambiguous site carries its candidate declarations
// when the set is known (`candidates`, absent = unknown, never "none"); a
// site whose caller cannot be attributed carries the one declaration it
// resolves to in its enclosing type's scope (`target`). The non-report output
// is byte-identical to before. Real tree-sitter extraction throughout.
import { beforeAll, describe, expect, it } from 'vitest';
import { PluginRegistry, TreeSitterPlugin, builtinLanguageConfigs, registerAllParsers } from '@excavator/core';
import { analyzeFileWithOutcomes, buildResult } from '../../skills/excavator/extract-structure-result.mjs';
import { createJavaCallResolver } from '../../skills/excavator/java-call-resolution.mjs';

let registry;
beforeAll(async () => {
  const tsPlugin = new TreeSitterPlugin(builtinLanguageConfigs.filter((c) => c.treeSitter));
  await tsPlugin.init();
  registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);
});

const P = 'src/main/java/p';

const PROJECT = {
  [`${P}/Helper.java`]: [
    'package p;',
    'public class Helper {',
    '  public String assist() { return ""; }',
    '  public Helper self() { return this; }',
    '  public int pick(String a) { return 0; }',
    '  public int pick(Long a) { return 0; }',
    '  public static String toData(Loan loan) { return ""; }',
    '  public static String toData(Loan loan, boolean deep) { return ""; }',
    '}',
  ],
  [`${P}/Loan.java`]: [
    'package p;',
    'public class Loan {',
    '  public Loan() {}',
    '  public Loan(String code) {}',
    '  public Loan(Long id) {}',
    '}',
  ],
  [`${P}/Account.java`]: [
    'package p;',
    '@lombok.Data',
    'public class Account {',
    '  private String name;',
    '  public String getName(java.util.Locale locale) { return name; }',
    '}',
  ],
  [`${P}/Base.java`]: [
    'package p;',
    'import org.acme.External;',
    'public class Base extends External {',
    '  public void hook() {}',
    '}',
  ],
  [`${P}/Outer.java`]: [
    'package p;',
    'public class Outer {',
    '  public static class Inner {}',
    '}',
  ],
  [`${P}/Odd.java`]: [
    'package p;',
    'public class Odd extends Outer.Inner {',
    '  public void x(int a) {}',
    '  public void x(long a) {}',
    '}',
  ],
  // The same type name in two source roots: a caller in a third cannot tell them apart.
  'src/a/java/p/Dup.java': [
    'package p;',
    'public class Dup {',
    '  public void go() {}',
    '  public void go(int n) {}',
    '}',
  ],
  'src/b/java/p/Dup.java': [
    'package p;',
    'public class Dup {',
    '  public void go() {}',
    '}',
  ],
  [`${P}/Coll.java`]: [
    'package p;',
    'public class Coll {',
    '  private Helper helper;',
    '  void go() { helper.assist(); helper.pick(null); new Loan(); helper.self().assist(); }',
    '}',
  ],
  [`${P}/Stat.java`]: [
    'package p;',
    'import static p.Helper.pick;',
    'public class Stat {',
    '  void go() { pick(null); }',
    '}',
  ],
  [`${P}/Svc.java`]: [
    'package p;', //                                                                      1
    'import java.util.List;', //                                                          2
    'public class Svc {', //                                                              3
    '  private Helper helper;', //                                                        4
    '  void run(Loan loan, List<String> names, Dup dup, Account acct, Odd odd) {', //    5
    '    helper.assist();', //                                                            6
    '    helper.pick(null);', //                                                          7
    '    helper.missing();', //                                                           8
    '    names.size();', //                                                               9
    '    f(Helper::toData);', //                                                         10
    '    f(Account::getName);', //                                                       11
    '    new Loan(null);', //                                                            12
    '    new Loan();', //                                                                13
    '    dup.go();', //                                                                  14
    '    new Base().hook();', //                                                         15
    '    odd.x(1);', //                                                                  16
    '    acct.getName();', //                                                            17
    '    Runnable r = new Runnable() { public void run() { helper.assist(); } };', //   18
    '  }', //                                                                            19
    '  void f(Object o) {}', //                                                          20
    '}', //                                                                              21
  ],
};

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

/** Node id stand-ins `Owner#name(types)`, prefixed with the source root for the two `Dup` files. */
function idsFor(row) {
  const root = row.path.startsWith('src/main/') ? '' : `${row.path.split('/')[1]}:`;
  return (row.functions ?? []).map((fn) => `${root}${fn.owner}#${fn.name}(${(fn.paramTypes ?? []).join(',')})`);
}

/** `{ site, ...result }` for every call site of `path`. */
function resolve(path, { report = false, nullCallers = [] } = {}) {
  const rows = extract(PROJECT);
  const functionIds = new Map(rows.map((row) => [row.path, idsFor(row)]));
  // A null id is how the fact graph marks a declaration whose node id collides with another's.
  for (const [file, index] of nullCallers) functionIds.get(file)[index] = null;
  const row = rows.find((r) => r.path === path);
  return createJavaCallResolver({ rows, functionIds }).resolveFileCalls(row, { report })
    .map((result, i) => ({ site: `${row.callGraph[i].lineNumber} ${row.callGraph[i].callee}`, ...result }));
}

const RUN = 'Svc#run(Loan,List<String>,Dup,Account,Odd)';

describe('non-report mode is unchanged', () => {
  // Frozen from the resolver before report mode gained these fields: every
  // site, in order, with exactly these keys and values.
  const FROZEN = {
    [`${P}/Svc.java`]: [
      ['6 helper.assist', { outcome: 'edge', callerId: RUN, targetId: 'Helper#assist()' }],
      ['7 helper.pick', { outcome: 'calls-ambiguous' }],
      ['8 helper.missing', { outcome: 'calls-unresolved' }],
      ['9 names.size', { outcome: 'calls-external' }],
      ['10 f', { outcome: 'edge', callerId: RUN, targetId: 'Svc#f(Object)' }],
      ['10 toData', { outcome: 'calls-ambiguous' }],
      ['11 f', { outcome: 'edge', callerId: RUN, targetId: 'Svc#f(Object)' }],
      ['11 getName', { outcome: 'calls-ambiguous' }],
      ['12 new Loan', { outcome: 'calls-ambiguous' }],
      ['13 new Loan', { outcome: 'edge', callerId: RUN, targetId: 'Loan#Loan()' }],
      ['14 dup.go', { outcome: 'calls-ambiguous' }],
      ['15 new Base().hook', { outcome: 'edge', callerId: RUN, targetId: 'Base#hook()' }],
      ['15 new Base', { outcome: 'calls-generated' }],
      ['16 odd.x', { outcome: 'calls-ambiguous' }],
      ['17 acct.getName', { outcome: 'calls-generated' }],
      ['18 new Runnable', { outcome: 'calls-external' }],
      ['18 helper.assist', { outcome: 'calls-caller-unresolved' }],
    ],
    [`${P}/Coll.java`]: [
      ['4 helper.assist', { outcome: 'edge', callerId: 'Coll#go()', targetId: 'Helper#assist()' }],
      ['4 helper.pick', { outcome: 'calls-ambiguous' }],
      ['4 new Loan', { outcome: 'edge', callerId: 'Coll#go()', targetId: 'Loan#Loan()' }],
      ['4 helper.self().assist', { outcome: 'edge', callerId: 'Coll#go()', targetId: 'Helper#assist()' }],
      ['4 helper.self', { outcome: 'edge', callerId: 'Coll#go()', targetId: 'Helper#self()' }],
    ],
    [`${P}/Stat.java`]: [
      ['4 pick', { outcome: 'calls-ambiguous' }],
    ],
  };

  it('produces exactly the frozen records, byte for byte', () => {
    for (const [path, expected] of Object.entries(FROZEN)) {
      const actual = resolve(path).map(({ site, ...result }) => [site, JSON.stringify(result)]);
      expect(actual).toEqual(expected.map(([site, result]) => [site, JSON.stringify(result)]));
    }
  });

  it('a caller-unresolved site carries nothing but its outcome', () => {
    const records = resolve(`${P}/Coll.java`, { nullCallers: [[`${P}/Coll.java`, 0]] });
    for (const { site, ...result } of records) expect(JSON.stringify(result), site).toBe('{"outcome":"calls-caller-unresolved"}');
  });

  it('report mode agrees with it on every outcome, caller and target', () => {
    for (const path of [`${P}/Svc.java`, `${P}/Coll.java`, `${P}/Stat.java`]) {
      const plain = resolve(path);
      const report = resolve(path, { report: true });
      expect(report.map(({ site, outcome, callerId, targetId }) => ({ site, outcome, callerId, targetId })))
        .toEqual(plain.map(({ site, outcome, callerId, targetId }) => ({ site, outcome, callerId, targetId })));
    }
  });
});

describe('report mode', () => {
  const svc = () => new Map(resolve(`${P}/Svc.java`, { report: true }).map(({ site, ...r }) => [site, r]));

  it('names the repository type the lookup ran on, and only when the receiver resolved to one', () => {
    const r = svc();
    expect(r.get('6 helper.assist')).toEqual({
      outcome: 'edge', callerId: RUN, targetId: 'Helper#assist()', outsideHierarchy: false, receiverType: 'p.Helper',
    });
    expect(r.get('8 helper.missing')).toEqual({ outcome: 'calls-unresolved', receiverType: 'p.Helper' });
    expect(r.get('10 f').receiverType).toBe('p.Svc'); // a bare call looks up the enclosing type
    expect(r.get('13 new Loan').receiverType).toBe('p.Loan'); // a construction, the constructed type
    expect(r.get('15 new Base')).toEqual({ outcome: 'calls-generated', receiverType: 'p.Base' });
    expect(r.get('17 acct.getName')).toEqual({ outcome: 'calls-generated', receiverType: 'p.Account' });
    expect(r.get('9 names.size')).toEqual({ outcome: 'calls-external' });
    expect(r.get('18 new Runnable')).toEqual({ outcome: 'calls-external' });
  });

  it('keeps an edge\'s outsideHierarchy flag', () => {
    expect(svc().get('15 new Base().hook')).toEqual({
      outcome: 'edge', callerId: RUN, targetId: 'Base#hook()', outsideHierarchy: true, receiverType: 'p.Base',
    });
  });

  it('lists the sorted candidates of an ambiguous call: overloads, method references, constructors', () => {
    const r = svc();
    expect(r.get('7 helper.pick')).toEqual({
      outcome: 'calls-ambiguous', candidates: ['Helper#pick(Long)', 'Helper#pick(String)'], receiverType: 'p.Helper',
    });
    expect(r.get('10 toData').candidates).toEqual(['Helper#toData(Loan)', 'Helper#toData(Loan,boolean)']);
    expect(r.get('12 new Loan')).toEqual({
      outcome: 'calls-ambiguous', candidates: ['Loan#Loan(Long)', 'Loan#Loan(String)'], receiverType: 'p.Loan',
    });
  });

  it('a method reference ambiguous only with an undeclared overload lists the declared one', () => {
    // `getName()` is generated from the field; only `getName(Locale)` is declared.
    expect(svc().get('11 getName')).toEqual({
      outcome: 'calls-ambiguous', candidates: ['Account#getName(java.util.Locale)'], receiverType: 'p.Account',
    });
  });

  it('a receiver of a type name two source roots declare: the union of the lookups, and no single receiver type', () => {
    expect(svc().get('14 dup.go')).toEqual({ outcome: 'calls-ambiguous', candidates: ['a:Dup#go()', 'b:Dup#go()'] });
  });

  it('a statically imported name with several declarations lists them', () => {
    expect(resolve(`${P}/Stat.java`, { report: true })).toEqual([
      { site: '4 pick', outcome: 'calls-ambiguous', candidates: ['Helper#pick(Long)', 'Helper#pick(String)'] },
    ]);
  });

  it('leaves candidates out when the set is not known: a supertype the resolver cannot read may add one', () => {
    const odd = svc().get('16 odd.x');
    expect(odd).toEqual({ outcome: 'calls-ambiguous', receiverType: 'p.Odd' });
    expect('candidates' in odd).toBe(false);
  });

  it('a caller-unresolved site in a nested or anonymous type has no target: its enclosing type is not read', () => {
    expect(svc().get('18 helper.assist')).toEqual({ outcome: 'calls-caller-unresolved' });
  });

  it('a caller-unresolved site in a type the resolver reads resolves its target in that type\'s scope', () => {
    const records = resolve(`${P}/Coll.java`, { report: true, nullCallers: [[`${P}/Coll.java`, 0]] });
    expect(records).toEqual([
      { site: '4 helper.assist', outcome: 'calls-caller-unresolved', target: 'Helper#assist()', receiverType: 'p.Helper' },
      // Ambiguous: no single target, the candidates instead.
      {
        site: '4 helper.pick',
        outcome: 'calls-caller-unresolved',
        candidates: ['Helper#pick(Long)', 'Helper#pick(String)'],
        receiverType: 'p.Helper',
      },
      { site: '4 new Loan', outcome: 'calls-caller-unresolved', target: 'Loan#Loan()', receiverType: 'p.Loan' },
      // A chained call types its receiver through the inner call, which has the same unknown caller.
      { site: '4 helper.self().assist', outcome: 'calls-caller-unresolved', target: 'Helper#assist()', receiverType: 'p.Helper' },
      { site: '4 helper.self', outcome: 'calls-caller-unresolved', target: 'Helper#self()', receiverType: 'p.Helper' },
    ]);
  });

  it('never names a target or candidate whose node id is shared with another declaration', () => {
    // Helper#pick(String) and Loan#Loan() collide with another declaration's node.
    const records = new Map(resolve(`${P}/Svc.java`, {
      report: true,
      nullCallers: [[`${P}/Helper.java`, 2], [`${P}/Loan.java`, 0]],
    }).map(({ site, ...r }) => [site, r]));
    expect(records.get('7 helper.pick')).toEqual({ outcome: 'calls-ambiguous', receiverType: 'p.Helper' });
    expect(records.get('13 new Loan')).toEqual({ outcome: 'calls-ambiguous', receiverType: 'p.Loan' });
  });
});
