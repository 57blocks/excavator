// name-binding-references, tasks 1.1-1.2 (skill side): a Java class entry's
// `annotationArguments` is validated by the structure result, passes through to
// the structure row exactly as Core emits it, and never enters node identity.
import { beforeAll, describe, expect, it } from 'vitest';
import { PluginRegistry, TreeSitterPlugin, builtinLanguageConfigs, registerAllParsers } from '@excavator/core';
import { analyzeFileWithOutcomes, buildResult } from '../../skills/excavator/extract-structure-result.mjs';
import { buildFactGraph } from '../../skills/excavator/build-fact-graph.mjs';

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

const JAVA_FILE = { path: 'src/com/acme/web/OrderBean.java', language: 'java', fileCategory: 'code' };
const JAVA_SOURCE = [
  'package com.acme.web;',
  'import javax.inject.Named;',
  '@Named("orders")',
  '@Scoped(value = Scope.REQUEST, eager = true)',
  'public class OrderBean {',
  '  public void save() {}',
  '}',
  '',
].join('\n');

describe('structure row: Java type annotation arguments', () => {
  it('carries the annotations of a top-level type with their line and arguments', () => {
    const { classes } = row(JAVA_FILE, JAVA_SOURCE);
    expect(classes[0].annotations).toEqual(['Named', 'Scoped']);
    expect(classes[0].annotationArguments).toEqual([
      { name: 'Named', line: 3, arguments: [{ key: 'value', value: 'orders' }] },
      { name: 'Scoped', line: 4, arguments: [{ key: 'value', value: null }, { key: 'eager', value: null }] },
    ]);
  });

  it('gives an unannotated Java type an empty list', () => {
    const { classes } = row({ path: 'src/p/A.java', language: 'java', fileCategory: 'code' }, 'package p;\nclass A { void f() {} }\n');
    expect(classes[0].annotationArguments).toEqual([]);
  });

  it('leaves node identity and the fact graph exactly as without the field', () => {
    const withField = row(JAVA_FILE, JAVA_SOURCE);
    const without = structuredClone(withField);
    for (const cls of without.classes) delete cls.annotationArguments;
    const graphOf = (r) => {
      const file = { ...JAVA_FILE, sizeLines: 7 };
      const scan = { files: [file], skipped: [], coverage: { limits: { maxFileLines: 20000, maxFileBytes: 2097152 } } };
      return buildFactGraph({ scan, structureAll: { results: [r] }, importMap: { importMap: { [file.path]: [] }, unresolved: {} } });
    };
    expect(JSON.stringify(graphOf(withField))).toBe(JSON.stringify(graphOf(without)));
  });
});

describe('structure row: annotationArguments validation', () => {
  const file = { path: 'src/p/X.java', language: 'java', fileCategory: 'code' };
  const cls = { name: 'X', lineRange: [1, 1], methods: [], properties: [] };
  const fake = (structure) => {
    const plugin = { analyzeFileFull: () => ({ structure, callGraph: [] }) };
    return { getPluginForFile: () => plugin, analyzeFileFull: plugin.analyzeFileFull };
  };
  const outcome = (annotationArguments) => analyzeFileWithOutcomes(
    fake({ functions: [], classes: [{ ...cls, annotationArguments }], imports: [], exports: [] }), file, '',
  ).structureOutcome;
  const use = (extra) => ({ name: 'Named', line: 1, arguments: [{ key: 'value', value: 'x' }], ...extra });

  it('accepts a well-formed list, an empty one, and a null-valued argument', () => {
    expect(outcome([use()])).toBe('succeeded');
    expect(outcome([])).toBe('succeeded');
    expect(outcome([use({ arguments: [] })])).toBe('succeeded');
    expect(outcome([use({ arguments: [{ key: 'value', value: null }, { key: 'eager', value: null }] })])).toBe('succeeded');
  });

  it('accepts a class entry that states no annotationArguments at all', () => {
    expect(outcome(undefined)).toBe('succeeded');
  });

  it('fails the file for any wrong shape', () => {
    expect(outcome(use())).toBe('failed'); // not an array
    expect(outcome([use({ name: 7 })])).toBe('failed');
    expect(outcome([use({ line: '1' })])).toBe('failed');
    expect(outcome([use({ line: 1.5 })])).toBe('failed');
    expect(outcome([use({ arguments: 'x' })])).toBe('failed');
    expect(outcome([use({ arguments: [{ key: 'value' }] })])).toBe('failed'); // no value: undefined is not null
    expect(outcome([use({ arguments: [{ key: 'value', value: 3 }] })])).toBe('failed');
    expect(outcome([use({ arguments: [{ key: 4, value: 'x' }] })])).toBe('failed');
    expect(outcome([null])).toBe('failed');
  });
});
