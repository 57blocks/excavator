// java-overload-identity: Java overloads that share parameter names (and
// generic overloads that differ only in a type variable's bound) must become
// distinct nodes, end to end — real tree-sitter extraction, the structure row,
// the fact graph and the source index.
import { beforeAll, describe, expect, it } from 'vitest';
import { PluginRegistry, TreeSitterPlugin, builtinLanguageConfigs, registerAllParsers } from '@excavator/core';
import { analyzeFileWithOutcomes, buildResult } from '../../skills/excavator/extract-structure-result.mjs';
import { buildFactGraph } from '../../skills/excavator/build-fact-graph.mjs';
import { buildSourceIndex } from '../../skills/excavator/build-source-index.mjs';

const SOURCE = [
  'package demo;',
  'public class Rule {',
  '  void handle(JsonCommand command) {}',
  '  void handle(String command) {}',
  '  public <T> T register(String name, T source) { return source; }',
  '  public <T extends Sink> T register(String name, T sink) { return sink; }',
  '}',
  '',
].join('\n');

const FILE = { path: 'src/demo/Rule.java', language: 'java', fileCategory: 'code', sizeLines: 7 };

let registry;
beforeAll(async () => {
  const tsPlugin = new TreeSitterPlugin(builtinLanguageConfigs.filter((c) => c.treeSitter));
  await tsPlugin.init();
  registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);
});

function build() {
  const extracted = analyzeFileWithOutcomes(registry, FILE, SOURCE);
  expect(extracted.structureOutcome).toBe('succeeded');
  const row = buildResult(FILE, 7, 6, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome);
  const scan = { files: [FILE], skipped: [], coverage: { limits: { maxFileLines: 20000, maxFileBytes: 2097152 } } };
  const structureAll = { results: [row] };
  const graph = buildFactGraph({ scan, structureAll, importMap: { importMap: { [FILE.path]: [] }, unresolved: {} } });
  return { row, scan, structureAll, graph };
}

describe('Java overload identity, end to end', () => {
  it('passes parameter types and the declaring type through the structure row', () => {
    const { row } = build();
    expect(row.functions.map((f) => [f.owner, f.name, f.paramTypes])).toEqual([
      ['Rule', 'handle', ['JsonCommand']],
      ['Rule', 'handle', ['String']],
      ['Rule', 'register', ['String', 'Object']],
      ['Rule', 'register', ['String', 'Sink']],
    ]);
  });

  it('gives every overload its own node and reports no identity collision', () => {
    const { graph } = build();
    const ids = graph.nodes.filter((n) => n.type === 'function').map((n) => n.id).sort();
    expect(ids).toEqual([
      'function:src/demo/Rule.java:Rule#handle(JsonCommand)',
      'function:src/demo/Rule.java:Rule#handle(String)',
      'function:src/demo/Rule.java:Rule#register(String,Object)',
      'function:src/demo/Rule.java:Rule#register(String,Sink)',
    ]);
    expect(graph.gaps.filter((g) => g.kind === 'identity-collision')).toEqual([]);
  });

  it('derives the same ids in the source index', () => {
    const { scan, structureAll, graph } = build();
    const factIds = new Set(graph.nodes.map((n) => n.id));
    const index = buildSourceIndex({ scan, structureAll, readFile: () => SOURCE, sourceRevision: 'rev-1' });
    const functionChunks = index.chunks.filter((c) => c.type === 'function');
    expect(functionChunks).toHaveLength(4);
    for (const chunk of functionChunks) expect(factIds.has(chunk.nodeId)).toBe(true);
  });
});
