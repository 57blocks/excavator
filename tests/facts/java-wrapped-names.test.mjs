// dead-code-detection, "Java type hierarchy edges": a pair whose erased
// signatures cannot be determined is never silently dropped. A qualified
// name wrapped across lines (`import p.model\n    .Req;`) is extracted as its
// dotted name, so it pairs with the same name written on one line; and a
// structure row that still carries a malformed name (as an extractor before
// that fix wrote it) makes the pair uncertain, never a certain mismatch.
import { beforeAll, describe, expect, it } from 'vitest';
import { PluginRegistry, TreeSitterPlugin, builtinLanguageConfigs, registerAllParsers } from '@excavator/core';
import { analyzeFileWithOutcomes, buildResult } from '../../skills/excavator/extract-structure-result.mjs';
import { buildFactGraph } from '../../skills/excavator/build-fact-graph.mjs';
import { createJavaCallResolver } from '../../skills/excavator/java-call-resolution.mjs';

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

const nameOf = (graph) => new Map(graph.nodes.map((n) => [n.id, n.owner ? `${n.owner}#${n.name}` : n.name]));

/** Hierarchy edges as `Source -type-> Target @file:line`, types and methods alike. */
function hierarchyEdges(graph) {
  const name = nameOf(graph);
  return graph.edges
    .filter((e) => e.type === 'implements' || e.type === 'overrides' || e.type === 'inherits')
    .map((e) => `${name.get(e.source)} -${e.type}-> ${name.get(e.target)} @${e.evidence[0].file.split('/').pop()}:${e.evidence[0].line}`)
    .sort();
}

/** The resolver's hierarchy result over rows, with `Owner#name(types)` stand-ins for node ids. */
function hierarchyOfRows(rows) {
  const label = (fn) => `${fn.owner}#${fn.name}(${(fn.paramTypes ?? []).join(',')})`;
  const functionIds = new Map(rows.map((row) => [row.path, (row.functions ?? []).map(label)]));
  const classIds = new Map(rows.map((row) => [row.path, (row.classes ?? []).map((c) => c.name)]));
  const result = createJavaCallResolver({ rows, functionIds, classIds }).hierarchyEdges();
  const show = (type) => (e) => `${e.source} -${type}-> ${e.target}`;
  return {
    edges: [...result.methodEdges.map(show('implements')), ...result.overrideEdges.map(show('overrides'))].sort(),
    uncertain: result.uncertainPairs.map((p) => `${p.source} ~${p.relation}~ ${p.target}`).sort(),
  };
}

const J = 'src/main/java/p';

const MODEL = {
  [`${J}/model/Req.java`]: ['package p.model;', 'public class Req {}'],
};

describe('Java hierarchy through a qualified name wrapped across lines', () => {
  it('implements: an interface method whose parameter type comes through a wrapped import', () => {
    const graph = graphOfRows(extract({
      ...MODEL,
      [`${J}/api/Handler.java`]: [
        'package p.api;',
        'import p.model',
        '    .Req;',
        'public interface Handler {',
        '  void handle(Req req);',
        '}',
      ],
      [`${J}/impl/HandlerImpl.java`]: [
        'package p.impl;',
        'import p.api.Handler;',
        'import p.model.Req;',
        'public class HandlerImpl implements Handler {',
        '  public void handle(Req req) {}',
        '}',
      ],
    }));
    expect(hierarchyEdges(graph)).toEqual([
      'HandlerImpl -implements-> Handler @HandlerImpl.java:4',
      'HandlerImpl#handle -implements-> Handler#handle @HandlerImpl.java:5',
    ]);
    expect(graph.gaps.find((g) => g.kind === 'override-uncertain')).toBeUndefined();
  });

  it('inherits and overrides: a superclass and a parameter type named through wrapped imports and a wrapped package', () => {
    const graph = graphOfRows(extract({
      ...MODEL,
      [`${J}/base/BaseTest.java`]: [
        'package p.base;',
        'import p.model.Req;',
        'public class BaseTest {',
        '  public void setup(Req r) {}',
        '}',
      ],
      [`${J}/impl/SubTest.java`]: [
        'package p',
        '    .impl;',
        'import p.base',
        '    .BaseTest;',
        'import p.model /* moved */ .Req;',
        'public class SubTest extends BaseTest {',
        '  public void setup(Req r) {}',
        '}',
      ],
    }));
    expect(hierarchyEdges(graph)).toEqual([
      'SubTest -inherits-> BaseTest @SubTest.java:6',
      'SubTest#setup -overrides-> BaseTest#setup @SubTest.java:7',
    ]);
  });
});

describe('Java hierarchy over structure rows that still carry a malformed name', () => {
  const HANDLER = {
    ...MODEL,
    [`${J}/api/Handler.java`]: ['package p.api;', 'import p.model.Req;', 'public interface Handler {', '  void handle(Req req);', '}'],
    [`${J}/impl/HandlerImpl.java`]: [
      'package p.impl;',
      'import p.api.Handler;',
      'import p.model.Req;',
      'public class HandlerImpl implements Handler {',
      '  public void handle(Req req) {}',
      '}',
    ],
  };
  const rowOf = (rows, file) => rows.find((r) => r.path.endsWith(file));

  it('is an edge when every name is well formed', () => {
    expect(hierarchyOfRows(extract(HANDLER))).toEqual({
      edges: ['HandlerImpl#handle(Req) -implements-> Handler#handle(Req)'],
      uncertain: [],
    });
  });

  it('an import source with whitespace inside makes the pair uncertain, never a mismatch', () => {
    const rows = extract(HANDLER);
    const handler = rowOf(rows, '/Handler.java');
    handler.imports = handler.imports.map((imp) => ({ ...imp, source: 'p.model\n    .Req' }));
    expect(hierarchyOfRows(rows)).toEqual({
      edges: [],
      uncertain: ['HandlerImpl#handle(Req) ~implements~ Handler#handle(Req)'],
    });
    const graph = graphOfRows(rows);
    const gap = graph.gaps.find((g) => g.kind === 'override-uncertain');
    expect(gap).toBeDefined();
    expect(gap.scope).toBe('java');
  });

  it('an import wrapped after its last dot still shadows a same-package type of that name', () => {
    const files = {
      ...HANDLER,
      [`${J}/impl/Req.java`]: ['package p.impl;', 'class Req {}'],
    };
    expect(hierarchyOfRows(extract(files)).edges).toEqual(['HandlerImpl#handle(Req) -implements-> Handler#handle(Req)']);
    const rows = extract(files);
    const impl = rowOf(rows, '/HandlerImpl.java');
    impl.imports = impl.imports.map((imp) => (imp.source === 'p.model.Req' ? { ...imp, source: 'p.model.\n    Req' } : imp));
    expect(hierarchyOfRows(rows)).toEqual({
      edges: [],
      uncertain: ['HandlerImpl#handle(Req) ~implements~ Handler#handle(Req)'],
    });
  });

  it('a comment inside a qualified parameter type makes the pair uncertain, never a mismatch', () => {
    const files = {
      [`${J}/api/Sink.java`]: ['package p.api;', 'public interface Sink {', '  void take(java.util.List<String> items);', '}'],
      [`${J}/impl/ListSink.java`]: [
        'package p.impl;',
        'import p.api.Sink;',
        'public class ListSink implements Sink {',
        '  public void take(java.util.List<String> items) {}',
        '}',
      ],
    };
    expect(hierarchyOfRows(extract(files)).edges).toEqual([
      'ListSink#take(java.util.List<String>) -implements-> Sink#take(java.util.List<String>)',
    ]);
    const rows = extract(files);
    const fn = rowOf(rows, '/ListSink.java').functions[0];
    fn.paramTypes = ['java.util /* legacy */ .List<String>'];
    expect(hierarchyOfRows(rows)).toEqual({
      edges: [],
      uncertain: ['ListSink#take(java.util /* legacy */ .List<String>) ~implements~ Sink#take(java.util.List<String>)'],
    });
  });

  it('a malformed package makes a package-access pair uncertain instead of a different package', () => {
    const files = {
      [`${J}/core/Job.java`]: ['package p.core;', 'public abstract class Job {', '  abstract void run(int times);', '}'],
      [`${J}/core/NightJob.java`]: [
        'package p.core;',
        'import p.core.Job;',
        'public class NightJob extends Job {',
        '  void run(int times) {}',
        '}',
      ],
    };
    expect(hierarchyOfRows(extract(files)).edges).toEqual(['NightJob#run(int) -implements-> Job#run(int)']);
    const rows = extract(files);
    const night = rowOf(rows, '/NightJob.java');
    night.classes = night.classes.map((c) => ({ ...c, qualifiedName: 'p\n    .core.NightJob' }));
    expect(hierarchyOfRows(rows)).toEqual({
      edges: [],
      uncertain: ['NightJob#run(int) ~implements~ Job#run(int)'],
    });
  });
});
