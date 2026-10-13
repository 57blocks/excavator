// annotation-injection-references, task 1.2 (skill side): a Java file's
// `memberAnnotations` is validated by the structure result, passes through to
// the structure row exactly as Core emits it, never enters node identity, and
// leaves the rows of other languages as they were.
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

const JAVA_FILE = { path: 'src/com/acme/OrderService.java', language: 'java', fileCategory: 'code' };
const JAVA_SOURCE = [
  'package com.acme;',
  'public class OrderService {',
  '  @Resource(',
  '      name = "orderDao")',
  '  private OrderDao dao, other;',
  '  @Autowired',
  '  public void setAudit(@Qualifier("audit") Audit audit) {}',
  '  static class Inner {',
  '    @In Dao inner;',
  '  }',
  '}',
  '',
].join('\n');

describe('structure row: Java member annotations', () => {
  it('carries every member annotation exactly as Core emits it', () => {
    const { memberAnnotations } = row(JAVA_FILE, JAVA_SOURCE);
    expect(memberAnnotations).toEqual([
      {
        name: 'Resource', line: 3, arguments: [{ key: 'name', value: 'orderDao', line: 4 }],
        on: 'field', owner: 'OrderService', nested: false, member: { name: 'dao', line: 5 },
      },
      {
        name: 'Resource', line: 3, arguments: [{ key: 'name', value: 'orderDao', line: 4 }],
        on: 'field', owner: 'OrderService', nested: false, member: { name: 'other', line: 5 },
      },
      {
        name: 'Autowired', line: 6, arguments: [],
        on: 'method', owner: 'OrderService', nested: false, member: { name: 'setAudit', line: 7 },
      },
      {
        name: 'Qualifier', line: 7, arguments: [{ key: 'value', value: 'audit', line: 7 }],
        on: 'parameter', owner: 'OrderService', nested: false,
        member: { name: 'setAudit', line: 7 }, parameter: { name: 'audit', index: 0, line: 7 },
      },
      {
        name: 'In', line: 9, arguments: [],
        on: 'field', owner: 'OrderService', nested: true, member: { name: 'inner', line: 9 },
      },
    ]);
  });

  it('gives a Java file with no annotated member an empty list', () => {
    const { memberAnnotations } = row({ path: 'src/p/A.java', language: 'java', fileCategory: 'code' },
      'package p;\nclass A { void f() {} }\n');
    expect(memberAnnotations).toEqual([]);
  });

  it('carries the members of a top-level @interface, which has no class entry', () => {
    const { memberAnnotations } = row({ path: 'src/p/M.java', language: 'java', fileCategory: 'code' },
      'package p;\n@interface M { @Deprecated String NAME = "n"; }\n');
    expect(memberAnnotations.map((use) => [use.name, use.owner, use.member.name])).toEqual([['Deprecated', 'M', 'NAME']]);
  });

  it('leaves the type annotations, method annotation names and node identity as without the field', () => {
    const withField = row(JAVA_FILE, JAVA_SOURCE);
    const without = structuredClone(withField);
    delete without.memberAnnotations;
    const graphOf = (r) => {
      const file = { ...JAVA_FILE, sizeLines: 12 };
      const scan = { files: [file], skipped: [], coverage: { limits: { maxFileLines: 20000, maxFileBytes: 2097152 } } };
      return buildFactGraph({ scan, structureAll: { results: [r] }, importMap: { importMap: { [file.path]: [] }, unresolved: {} } });
    };
    expect(withField.functions.find((f) => f.name === 'setAudit').annotations).toEqual(['Autowired']);
    expect(withField.classes[0].annotationArguments).toEqual([]);
    expect(JSON.stringify(graphOf(withField))).toBe(JSON.stringify(graphOf(without)));
  });

  it('gives a row of another language no memberAnnotations', () => {
    const ts = row({ path: 'src/a.ts', language: 'typescript', fileCategory: 'code' },
      '@Component({ selector: "x" })\nexport class A { @Input() name: string; }\n');
    const py = row({ path: 'src/b.py', language: 'python', fileCategory: 'code' }, 'class S:\n    @staticmethod\n    def f(): pass\n');
    expect(ts).not.toHaveProperty('memberAnnotations');
    expect(py).not.toHaveProperty('memberAnnotations');
  });
});

describe('structure row: memberAnnotations validation', () => {
  const file = { path: 'src/p/X.java', language: 'java', fileCategory: 'code' };
  const fake = (structure) => {
    const plugin = { analyzeFileFull: () => ({ structure, callGraph: [] }) };
    return { getPluginForFile: () => plugin, analyzeFileFull: plugin.analyzeFileFull };
  };
  const outcome = (memberAnnotations) => analyzeFileWithOutcomes(
    fake({ functions: [], classes: [], imports: [], exports: [], memberAnnotations }), file, '',
  ).structureOutcome;

  const field = (extra) => ({
    name: 'In', line: 3, arguments: [{ key: 'value', value: 'x', line: 3 }],
    on: 'field', owner: 'X', nested: false, member: { name: 'dao', line: 3 }, ...extra,
  });
  const parameter = (extra) => field({
    on: 'parameter', member: { name: 'set', line: 4 }, parameter: { name: 'd', index: 0, line: 4 }, ...extra,
  });

  it('accepts a well-formed list, an empty one and no field at all', () => {
    expect(outcome([field()])).toBe('succeeded');
    expect(outcome([])).toBe('succeeded');
    expect(outcome(undefined)).toBe('succeeded');
    expect(outcome([field({ arguments: [] })])).toBe('succeeded');
    expect(outcome([field({ arguments: [{ key: 'name', value: null, line: 3 }] })])).toBe('succeeded');
    for (const on of ['method', 'constructor']) expect(outcome([field({ on })])).toBe('succeeded');
    expect(outcome([parameter()])).toBe('succeeded');
    expect(outcome([parameter({ on: 'component' })])).toBe('succeeded');
    expect(outcome([field({ nested: true })])).toBe('succeeded');
  });

  it('fails the file for any wrong shape', () => {
    expect(outcome(field())).toBe('failed'); // not an array
    expect(outcome([null])).toBe('failed');
    expect(outcome([field({ name: 7 })])).toBe('failed');
    expect(outcome([field({ line: '3' })])).toBe('failed');
    expect(outcome([field({ line: 3.5 })])).toBe('failed');
    expect(outcome([field({ arguments: 'x' })])).toBe('failed');
    expect(outcome([field({ arguments: [{ key: 'value', value: 'x' }] })])).toBe('failed'); // no line
    expect(outcome([field({ arguments: [{ key: 'value', line: 3 }] })])).toBe('failed'); // no value: undefined is not null
    expect(outcome([field({ arguments: [{ key: 'value', value: 3, line: 3 }] })])).toBe('failed');
    expect(outcome([field({ arguments: [{ key: 4, value: 'x', line: 3 }] })])).toBe('failed');
    expect(outcome([field({ owner: undefined })])).toBe('failed');
    expect(outcome([field({ nested: 'false' })])).toBe('failed');
    expect(outcome([field({ nested: undefined })])).toBe('failed');
    expect(outcome([field({ member: undefined })])).toBe('failed');
    expect(outcome([field({ member: { name: 'dao' } })])).toBe('failed');
    expect(outcome([field({ member: { name: 1, line: 3 } })])).toBe('failed');
  });

  it('fails the file for a member kind outside the closed set', () => {
    expect(outcome([field({ on: 'class' })])).toBe('failed');
    expect(outcome([field({ on: 'local' })])).toBe('failed');
    expect(outcome([field({ on: undefined })])).toBe('failed');
  });

  it('requires the parameter for a parameter or component and forbids it elsewhere', () => {
    expect(outcome([parameter({ parameter: undefined })])).toBe('failed');
    expect(outcome([parameter({ on: 'component', parameter: undefined })])).toBe('failed');
    expect(outcome([parameter({ parameter: { name: 'd', line: 4 } })])).toBe('failed'); // no index
    expect(outcome([parameter({ parameter: { name: 'd', index: -1, line: 4 } })])).toBe('failed');
    expect(outcome([parameter({ parameter: { name: 'd', index: 0.5, line: 4 } })])).toBe('failed');
    expect(outcome([parameter({ parameter: { name: 'd', index: 0 } })])).toBe('failed'); // no line
    expect(outcome([field({ parameter: { name: 'd', index: 0, line: 4 } })])).toBe('failed');
    expect(outcome([field({ on: 'method', parameter: { name: 'd', index: 0, line: 4 } })])).toBe('failed');
  });

  it('turns a bad shape into a visible parse-failed row, not a missing one', () => {
    const extracted = analyzeFileWithOutcomes(
      fake({ functions: [], classes: [], imports: [], exports: [], memberAnnotations: [field({ on: 'class' })] }), file, '',
    );
    expect(extracted.analysis).toBeNull();
    const result = buildResult(file, 1, 1, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome);
    expect(result).toMatchObject({ path: file.path, status: 'parse-failed', statusReason: 'extractor-error-or-invalid-output' });
  });

  it('does not count member annotations as symbols', () => {
    const extracted = analyzeFileWithOutcomes(
      fake({ functions: [], classes: [], imports: [], exports: [], memberAnnotations: [field()] }), file, '',
    );
    const result = buildResult(file, 1, 1, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome);
    expect(result.status).toBe('zero-symbol');
    expect(result.memberAnnotations).toEqual([field()]);
  });
});
