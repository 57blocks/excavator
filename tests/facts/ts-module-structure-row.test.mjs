// jsx-element-references, tasks 2.1: TS/JS structure rows carry import
// bindings, re-exports, local export names and JSX elements through the
// structure result, and a bad shape fails the file instead of reaching the
// fact graph.
import { beforeAll, describe, expect, it } from 'vitest';
import { PluginRegistry, TreeSitterPlugin, builtinLanguageConfigs, registerAllParsers } from '@excavator/core';
import { analyzeFileWithOutcomes, buildResult } from '../../skills/excavator/extract-structure-result.mjs';

let registry;
beforeAll(async () => {
  const tsPlugin = new TreeSitterPlugin(builtinLanguageConfigs.filter((c) => c.treeSitter));
  await tsPlugin.init();
  registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);
});

function row(file, source) {
  const extracted = analyzeFileWithOutcomes(registry, file, source);
  expect(extracted.structureOutcome).toBe('succeeded');
  const lines = source.split('\n');
  return buildResult(file, lines.length, lines.filter((l) => l.trim()).length,
    extracted.analysis, extracted.callGraph, null, extracted.structureOutcome);
}

describe('structure row: TS/JS module bindings and JSX', () => {
  it('passes bindings, re-exports, local export names and JSX elements through', () => {
    const file = { path: 'src/page.tsx', language: 'typescript', fileCategory: 'code' };
    const result = row(file, [
      "import Btn, { Card as C } from './ui';",
      "export * from './more';",
      'function Page({ Icon }) {',
      '  return <div><Btn /><C /><Icon /></div>;',
      '}',
      'export default Page;',
      '',
    ].join('\n'));
    expect(result.imports).toEqual([
      { source: './ui', specifiers: ['Btn', 'C'], line: 1, bindings: [{ local: 'Btn', imported: 'default' }, { local: 'C', imported: 'Card' }] },
      { source: './more', specifiers: [], line: 2, reexports: [{ exported: '*', imported: '*' }] },
    ]);
    expect(result.exports).toEqual([{ name: 'default', line: 6, isDefault: true, local: 'Page' }]);
    expect(result.jsx).toEqual({
      elements: [{ name: 'Btn', line: 4 }, { name: 'C', line: 4 }, { name: 'Icon', line: 4, local: true }],
      intrinsic: 1,
    });
  });

  it('carries the syntax-error flag of a recovered tag', () => {
    const file = { path: 'src/legacy.jsx', language: 'javascript', fileCategory: 'code' };
    const extracted = analyzeFileWithOutcomes(registry, file, 'function T() { return <div><this.Foo /></div>; }\n');
    const result = buildResult(file, 1, 1, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome);
    expect(result.jsx.elements).toEqual([expect.objectContaining({ syntaxError: true })]);
  });

  it('writes no jsx field for a file without JSX', () => {
    const file = { path: 'src/util.ts', language: 'typescript', fileCategory: 'code' };
    expect(row(file, 'export function f() { return 1; }\n')).not.toHaveProperty('jsx');
  });
});

describe('structure row: TS/JS module fact validation', () => {
  const file = { path: 'src/x.tsx', language: 'typescript', fileCategory: 'code' };
  const fake = (structure) => {
    const plugin = { analyzeFileFull: () => ({ structure, callGraph: [] }) };
    return { getPluginForFile: () => plugin, analyzeFileFull: plugin.analyzeFileFull };
  };
  const outcome = (extra) => analyzeFileWithOutcomes(
    fake({ functions: [], classes: [], imports: [], exports: [], ...extra }), file, '').structureOutcome;
  const imp = (fields) => ({ imports: [{ source: './a', specifiers: [], lineNumber: 1, ...fields }] });
  const element = (fields) => ({ jsx: { elements: [{ name: 'A', lineNumber: 1, ...fields }], intrinsic: 0 } });

  it('accepts the shapes the extractor writes', () => {
    expect(outcome(imp({ bindings: [{ local: 'A', imported: 'default' }] }))).toBe('succeeded');
    expect(outcome(imp({ reexports: [{ exported: '*', imported: '*' }] }))).toBe('succeeded');
    expect(outcome({ exports: [{ name: 'default', lineNumber: 1, isDefault: true, local: 'A' }] })).toBe('succeeded');
    expect(outcome(element({ local: true, syntaxError: true }))).toBe('succeeded');
  });

  it('rejects malformed bindings, re-exports and local names', () => {
    expect(outcome(imp({ bindings: [{ local: 'A' }] }))).toBe('failed');
    expect(outcome(imp({ bindings: { local: 'A', imported: 'B' } }))).toBe('failed');
    expect(outcome(imp({ reexports: [{ exported: 1, imported: '*' }] }))).toBe('failed');
    expect(outcome({ exports: [{ name: 'default', lineNumber: 1, local: null }] })).toBe('failed');
  });

  it('rejects malformed JSX facts', () => {
    expect(outcome(element({ local: false }))).toBe('failed');
    expect(outcome(element({ syntaxError: 'yes' }))).toBe('failed');
    expect(outcome(element({ lineNumber: '1' }))).toBe('failed');
    expect(outcome({ jsx: { elements: [], intrinsic: -1 } })).toBe('failed');
    expect(outcome({ jsx: { intrinsic: 0 } })).toBe('failed');
  });
});
