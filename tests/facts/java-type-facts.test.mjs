// java-member-call-resolution, tasks 1.3 and 2.2: the structure row carries
// the Java type facts the fact graph resolves member calls with, and rows of
// other languages keep their exact shape.
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

const JAVA_FILE = { path: 'src/p/Loan.java', language: 'java', fileCategory: 'code' };
const JAVA_SOURCE = [
  'package p;',
  'import static p.Util.helper;',
  'import java.util.List;',
  '@lombok.Builder',
  'public class Loan<T extends Money> extends Base implements Payable {',
  '  private Helper helper;',
  '  public Loan() {}',
  '  public <R> R pay(long amount) { return null; }',
  '  static class Inner {}',
  '}',
  'interface Payable { void pay(long amount); }',
  '',
].join('\n');

describe('structure row: Java type facts', () => {
  it('carries the class facts', () => {
    const { classes } = row(JAVA_FILE, JAVA_SOURCE);
    expect(classes.map((c) => ({ ...c, startLine: undefined, endLine: undefined }))).toEqual([
      {
        name: 'Loan', startLine: undefined, endLine: undefined,
        methods: ['Loan', 'pay'], properties: ['helper'],
        kind: 'class', qualifiedName: 'p.Loan',
        supertypes: [
          { relation: 'extends', type: 'Base', line: 5 },
          { relation: 'implements', type: 'Payable', line: 5 },
        ],
        fieldTypes: [{ name: 'helper', type: 'Helper' }],
        annotations: ['lombok.Builder'],
        typeParameters: [{ name: 'T', bound: 'Money' }],
        memberTypes: ['Inner'],
      },
      {
        name: 'Payable', startLine: undefined, endLine: undefined,
        methods: ['pay'], properties: [],
        kind: 'interface', qualifiedName: 'p.Payable',
        supertypes: [], fieldTypes: [], annotations: [], typeParameters: [], memberTypes: [],
      },
    ]);
  });

  it('carries the declared return type, the abstract flag and method type parameters, but never `returnType`', () => {
    const { functions } = row(JAVA_FILE, JAVA_SOURCE);
    expect(functions.map((f) => [f.owner, f.name, f.declaredReturnType, f.abstract, f.typeParameters])).toEqual([
      ['Loan', 'Loan', undefined, undefined, undefined],
      ['Loan', 'pay', 'R', undefined, [{ name: 'R', bound: null }]],
      ['Payable', 'pay', 'void', true, undefined],
    ]);
    // `returnType` feeds node identity; carrying it would rename every Java node.
    for (const fn of functions) expect(fn).not.toHaveProperty('returnType');
  });

  it('marks static imports', () => {
    const { imports } = row(JAVA_FILE, JAVA_SOURCE);
    expect(imports).toEqual([
      { source: 'p.Util.helper', specifiers: ['helper'], line: 2, static: true },
      { source: 'java.util.List', specifiers: ['List'], line: 3 },
    ]);
  });
});

describe('structure row: other languages unchanged', () => {
  it('a TypeScript row carries no Java fields, even though its extractor reports return types', () => {
    const file = { path: 'src/a.ts', language: 'typescript', fileCategory: 'code' };
    const source = [
      "import { b } from './b';",
      'export class A { run(x: number): string { return b(x); } }',
      'export function f(y: string): number { return 1; }',
      '',
    ].join('\n');
    const extracted = analyzeFileWithOutcomes(registry, file, source);
    expect(extracted.analysis.functions.some((fn) => typeof fn.returnType === 'string')).toBe(true);
    const result = row(file, source);
    const allowed = {
      functions: new Set(['name', 'owner', 'startLine', 'endLine', 'params', 'paramTypes']),
      classes: new Set(['name', 'startLine', 'endLine', 'methods', 'properties']),
      imports: new Set(['source', 'specifiers', 'line']),
    };
    for (const [field, keys] of Object.entries(allowed)) {
      for (const entry of result[field] ?? []) {
        for (const key of Object.keys(entry)) expect(keys.has(key), `${field}.${key}`).toBe(true);
      }
    }
    for (const site of result.callGraph ?? []) {
      expect(Object.keys(site).sort()).toEqual(['callee', 'caller', 'lineNumber']);
    }
  });
});
