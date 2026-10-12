// dead-code-detection, "Java call sites outside method and constructor
// bodies": a site in a field initializer, an initializer block, an enum
// constant argument or a record compact constructor has a sentinel caller
// (`<clinit>` / `<init>`) that matches no declaration. It is never a `calls`
// edge; it lands in `calls-caller-unresolved` and counts toward the call-site
// conservation, and report mode resolves its target in the enclosing type's
// scope, so a method reached only from a field initializer is visibly
// referenced. Real tree-sitter extraction throughout.
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

const P = 'src/main/java/p';
const idOf = (path, fn) => `function:${path}:${fn.owner}#${fn.name}(${(fn.paramTypes ?? []).join(',')})`;

const PROJECT = {
  [`${P}/CleanerUtil.java`]: [
    'package p;', //                                                                       1
    'import java.util.function.Function;', //                                              2
    'public final class CleanerUtil {', //                                                 3
    '  private static final Runnable HOOK = CleanerUtil::unmapHackImpl;', //               4
    '  private static final Function<String, String> NORM = Names::normalize;', //         5
    '  private final Helper helper = new Helper();', //                                    6
    '  private final String label = helper.describe();', //                                7
    '  private final Runnable tick = this::tick;', //                                      8
    '  static { Names.normalize("boot"); }', //                                            9
    '  private static void unmapHackImpl() {}', //                                        10
    '  private void tick() {}', //                                                        11
    '  void go() { tick(); }', //                                                         12
    '}', //                                                                               13
  ],
  [`${P}/Names.java`]: [
    'package p;',
    'public class Names {',
    '  public static String normalize(String s) { return s; }',
    '}',
  ],
  [`${P}/Helper.java`]: [
    'package p;',
    'public class Helper {',
    '  public Helper() {}',
    '  public String describe() { return ""; }',
    '}',
  ],
};

const CLEANER = `${P}/CleanerUtil.java`;
const id = (path, signature) => `function:${path}:${signature}`;

describe('Java call sites outside method and constructor bodies in the fact graph', () => {
  it('a static field method reference is a caller-unresolved gap, never a calls edge', () => {
    const { graph } = graphOf(PROJECT);
    const calls = graph.edges.filter((e) => e.type === 'calls');
    // The one site inside a method body is the one edge.
    expect(calls.map((e) => `${e.source} -> ${e.target} @${e.evidence[0].line}`)).toEqual([
      `${id(CLEANER, 'CleanerUtil#go()')} -> ${id(CLEANER, 'CleanerUtil#tick()')} @12`,
    ]);
    const gap = graph.gaps.find((g) => g.scope === 'java' && g.kind === 'calls-caller-unresolved');
    expect(gap.count).toBe(6);
    expect(gap.samples).toContain(`${CLEANER}:4 -> unmapHackImpl`);
    expect(gap.reason).toMatch(/field initializers/);
    expect(gap.reason).toMatch(/initializer blocks/);
    expect(gap.reason).toMatch(/enum constant arguments/);
  });

  it('every site, inside a method body or not, is one edge or one bucket', () => {
    const { rows, graph } = graphOf(PROJECT);
    const sites = rows.flatMap((r) => r.callGraph ?? []);
    expect(sites.filter((s) => s.caller.startsWith('<')).map((s) => `${s.lineNumber} ${s.caller} ${s.callee}`)).toEqual([
      '4 <clinit> unmapHackImpl',
      '5 <clinit> normalize',
      '6 <init> new Helper',
      '7 <init> helper.describe',
      '8 <init> tick',
      '9 <clinit> Names.normalize',
    ]);
    const tally = { edge: graph.edges.filter((e) => e.type === 'calls').length };
    for (const g of graph.gaps) if (g.scope === 'java' && JAVA_CALL_OUTCOMES.includes(g.kind)) tally[g.kind] = g.count;
    expect(tally).toEqual({ edge: 1, 'calls-caller-unresolved': 6 });
    expect(() => assertCallConservation(sites.length, tally)).not.toThrow();
  });

  it('report mode names the target each sentinel-caller site resolves to in its enclosing type', () => {
    const { rows, graph } = graphOf(PROJECT);
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    const functionIds = new Map(rows.map((row) => [row.path, (row.functions ?? []).map((fn) => idOf(row.path, fn))]));
    for (const ids of functionIds.values()) for (const fnId of ids) expect(nodeIds.has(fnId), fnId).toBe(true);
    const row = rows.find((r) => r.path === CLEANER);
    const records = createJavaCallResolver({ rows, functionIds }).resolveFileCalls(row, { report: true })
      .map((record, i) => [`${row.callGraph[i].lineNumber} ${row.callGraph[i].callee}`, record]);
    expect(records).toEqual([
      ['4 unmapHackImpl', { outcome: 'calls-caller-unresolved', target: id(CLEANER, 'CleanerUtil#unmapHackImpl()'), receiverType: 'p.CleanerUtil' }],
      ['5 normalize', { outcome: 'calls-caller-unresolved', target: id(`${P}/Names.java`, 'Names#normalize(String)'), receiverType: 'p.Names' }],
      ['6 new Helper', { outcome: 'calls-caller-unresolved', target: id(`${P}/Helper.java`, 'Helper#Helper()'), receiverType: 'p.Helper' }],
      // A field receiver.
      ['7 helper.describe', { outcome: 'calls-caller-unresolved', target: id(`${P}/Helper.java`, 'Helper#describe()'), receiverType: 'p.Helper' }],
      // `this::m` in an instance field initializer.
      ['8 tick', { outcome: 'calls-caller-unresolved', target: id(CLEANER, 'CleanerUtil#tick()'), receiverType: 'p.CleanerUtil' }],
      // A type receiver in a static initializer block.
      ['9 Names.normalize', { outcome: 'calls-caller-unresolved', target: id(`${P}/Names.java`, 'Names#normalize(String)'), receiverType: 'p.Names' }],
      ['12 tick', { outcome: 'edge', callerId: id(CLEANER, 'CleanerUtil#go()'), targetId: id(CLEANER, 'CleanerUtil#tick()'), outsideHierarchy: false, receiverType: 'p.CleanerUtil' }],
    ]);
  });

  it('an ambiguous sentinel-caller site lists its candidates; one in a nested type has no target', () => {
    const files = {
      ...PROJECT,
      [`${P}/Picks.java`]: [
        'package p;',
        'public class Picks {',
        '  static final Object CHOSEN = Picks::pick;',
        '  static int pick(String s) { return 0; }',
        '  static int pick(Long s) { return 0; }',
        '  static class Inner { static final Object N = Names.normalize("x"); }',
        '}',
      ],
    };
    const rows = extract(files);
    const functionIds = new Map(rows.map((row) => [row.path, (row.functions ?? []).map((fn) => idOf(row.path, fn))]));
    const row = rows.find((r) => r.path === `${P}/Picks.java`);
    const records = createJavaCallResolver({ rows, functionIds }).resolveFileCalls(row, { report: true });
    expect(row.callGraph.map((s) => `${s.lineNumber} ${s.caller} ${s.callee} ${s.enclosingType}`)).toEqual([
      '3 <clinit> pick Picks',
      '6 <clinit> Names.normalize null',
    ]);
    expect(records).toEqual([
      {
        outcome: 'calls-caller-unresolved',
        candidates: [id(`${P}/Picks.java`, 'Picks#pick(Long)'), id(`${P}/Picks.java`, 'Picks#pick(String)')],
        receiverType: 'p.Picks',
      },
      { outcome: 'calls-caller-unresolved' },
    ]);
  });
});
