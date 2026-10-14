// by-type-injection, tasks 1.1-1.3 (skill side): the Java facts Core records for
// by-type injection - `classes[].modifiers`, `nestedTypes`, the `classLiterals`
// of an annotation argument and the declared `type` of a member annotation's
// member - are validated by the structure result, pass through to the structure
// row exactly as Core emits them, and never enter node identity.
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
  '@Stateless',
  '@Local({OrderPort.class, "text", Names.X, AuditPort.class})',
  'public abstract class OrderService extends Base {',
  '  @Resource(type = Dao.class)',
  '  private OrderDao dao, extra[];',
  '  @Produces',
  '  public Cache cache(@Named("c") String key) { return null; }',
  '  @Inject OrderService() {}',
  '  static class Inner implements Port {}',
  '  void run() {',
  '    Object o = new Handler<String>() {};',
  '  }',
  '}',
  '',
].join('\n');

describe('structure row: Java facts for by-type injection', () => {
  it('carries the modifiers of a top-level type exactly as Core emits them', () => {
    const { classes } = row(JAVA_FILE, JAVA_SOURCE);
    expect(classes.map((c) => [c.name, c.modifiers])).toEqual([['OrderService', ['public', 'abstract']]]);
  });

  it('carries the nested types, in source order, exactly as Core emits them', () => {
    const { nestedTypes } = row(JAVA_FILE, JAVA_SOURCE);
    expect(nestedTypes).toEqual([
      {
        kind: 'class', name: 'Inner', line: 10, owner: 'OrderService', local: false,
        modifiers: ['static'], supertypes: [{ relation: 'implements', type: 'Port', line: 10 }],
      },
      {
        kind: 'anonymous', name: null, line: 12, owner: 'OrderService', local: true,
        modifiers: [], supertypes: [], instantiates: { type: 'Handler<String>', line: 12 },
      },
    ]);
  });

  it('gives a Java file that nests nothing an empty nestedTypes, and modifiers on every class', () => {
    const result = row({ path: 'src/p/A.java', language: 'java', fileCategory: 'code' }, 'package p;\nclass A { void f() {} }\n');
    expect(result.nestedTypes).toEqual([]);
    expect(result.classes[0].modifiers).toEqual([]);
  });

  it('carries the class literals of a type annotation argument, the value staying null', () => {
    const { classes } = row(JAVA_FILE, JAVA_SOURCE);
    expect(classes[0].annotationArguments).toEqual([
      { name: 'Stateless', line: 2, arguments: [] },
      {
        name: 'Local',
        line: 3,
        arguments: [{
          key: 'value',
          value: null,
          classLiterals: [{ type: 'OrderPort', line: 3 }, { type: 'AuditPort', line: 3 }],
        }],
      },
    ]);
  });

  it('carries the class literals of a member annotation argument and the type of each member', () => {
    const { memberAnnotations } = row(JAVA_FILE, JAVA_SOURCE);
    expect(memberAnnotations).toEqual([
      {
        name: 'Resource', line: 5,
        arguments: [{ key: 'type', value: null, line: 5, classLiterals: [{ type: 'Dao', line: 5 }] }],
        on: 'field', owner: 'OrderService', nested: false, member: { name: 'dao', line: 6, type: 'OrderDao' },
      },
      {
        name: 'Resource', line: 5,
        arguments: [{ key: 'type', value: null, line: 5, classLiterals: [{ type: 'Dao', line: 5 }] }],
        on: 'field', owner: 'OrderService', nested: false, member: { name: 'extra', line: 6, type: 'OrderDao[]' },
      },
      {
        name: 'Produces', line: 7, arguments: [],
        on: 'method', owner: 'OrderService', nested: false, member: { name: 'cache', line: 8, type: 'Cache' },
      },
      {
        name: 'Named', line: 8, arguments: [{ key: 'value', value: 'c', line: 8 }],
        on: 'parameter', owner: 'OrderService', nested: false,
        member: { name: 'cache', line: 8, type: 'Cache' }, parameter: { name: 'key', index: 0, line: 8 },
      },
      {
        name: 'Inject', line: 9, arguments: [],
        on: 'constructor', owner: 'OrderService', nested: false, member: { name: 'OrderService', line: 9 },
      },
    ]);
    // A constructor has no declared type: the key is absent, not undefined.
    expect(Object.hasOwn(memberAnnotations[4].member, 'type')).toBe(false);
  });

  it('gives rows of other languages none of the fields', () => {
    const ts = row({ path: 'src/a.ts', language: 'typescript', fileCategory: 'code' },
      '@Component({ selector: "x" })\nexport class A { @Input() name: string; }\n');
    expect(ts).not.toHaveProperty('nestedTypes');
    expect(ts.classes[0]).not.toHaveProperty('modifiers');
  });

  it('leaves node identity and the fact graph exactly as without the fields', () => {
    const withFields = row(JAVA_FILE, JAVA_SOURCE);
    const without = structuredClone(withFields);
    delete without.nestedTypes;
    for (const cls of without.classes) {
      delete cls.modifiers;
      for (const use of cls.annotationArguments) for (const argument of use.arguments) delete argument.classLiterals;
    }
    for (const use of without.memberAnnotations) {
      delete use.member.type;
      for (const argument of use.arguments) delete argument.classLiterals;
    }
    const graphOf = (r) => {
      const file = { ...JAVA_FILE, sizeLines: 14 };
      const scan = { files: [file], skipped: [], coverage: { limits: { maxFileLines: 20000, maxFileBytes: 2097152 } } };
      return buildFactGraph({ scan, structureAll: { results: [r] }, importMap: { importMap: { [file.path]: [] }, unresolved: {} } });
    };
    expect(JSON.stringify(graphOf(withFields))).toBe(JSON.stringify(graphOf(without)));
  });
});

describe('structure result: by-type injection facts validation', () => {
  const file = { path: 'src/p/X.java', language: 'java', fileCategory: 'code' };
  const fake = (structure) => {
    const plugin = { analyzeFileFull: () => ({ structure, callGraph: [] }) };
    return { getPluginForFile: () => plugin, analyzeFileFull: plugin.analyzeFileFull };
  };
  const base = { functions: [], classes: [], imports: [], exports: [] };
  const run = (structure) => analyzeFileWithOutcomes(fake({ ...base, ...structure }), file, '');
  const cls = { name: 'X', lineRange: [1, 1], methods: [], properties: [] };

  // The well-formed shapes the cases below each break in one place.
  const supertype = { relation: 'implements', type: 'Port', line: 2 };
  const named = (extra) => ({
    kind: 'class', name: 'Inner', line: 2, owner: 'X', local: false,
    modifiers: ['static'], supertypes: [supertype], ...extra,
  });
  const anonymous = (extra) => ({
    kind: 'anonymous', name: null, line: 3, owner: 'X', local: true,
    modifiers: [], supertypes: [], instantiates: { type: 'Handler', line: 3 }, ...extra,
  });
  const literal = { type: 'Port', line: 4 };
  const typeAnnotation = (argument) => ({
    classes: [{ ...cls, annotationArguments: [{ name: 'Local', line: 4, arguments: [argument] }] }],
  });
  const memberAnnotation = (argument, extra) => ({
    memberAnnotations: [{
      name: 'Local', line: 4, arguments: [{ line: 4, ...argument }],
      on: 'field', owner: 'X', nested: false, member: { name: 'port', line: 4, type: 'Port' }, ...extra,
    }],
  });
  const carriers = {
    'a type annotation': (argument) => typeAnnotation(argument),
    'a member annotation': (argument) => memberAnnotation(argument),
  };

  describe('accepted shapes', () => {
    it('accepts the modifiers, nested types and member types Core emits', () => {
      expect(run({ classes: [{ ...cls, modifiers: ['public', 'sealed', 'non-sealed', 'strictfp', 'abstract'] }] }).structureOutcome).toBe('succeeded');
      expect(run({ classes: [{ ...cls, modifiers: [] }] }).structureOutcome).toBe('succeeded');
      expect(run({ nestedTypes: [] }).structureOutcome).toBe('succeeded');
      expect(run({ nestedTypes: [named(), anonymous()] }).structureOutcome).toBe('succeeded');
      for (const kind of ['class', 'interface', 'enum', 'record', 'annotation']) {
        expect(run({ nestedTypes: [named({ kind })] }).structureOutcome).toBe('succeeded');
      }
      expect(run({ nestedTypes: [named({ local: true })] }).structureOutcome).toBe('succeeded');
    });

    it('accepts class literals on an argument of either kind of annotation, and none', () => {
      for (const [, carry] of Object.entries(carriers)) {
        expect(run(carry({ key: 'value', value: null, classLiterals: [literal] })).structureOutcome).toBe('succeeded');
        expect(run(carry({ key: 'value', value: null, classLiterals: [] })).structureOutcome).toBe('succeeded');
        expect(run(carry({ key: 'value', value: 'text' })).structureOutcome).toBe('succeeded');
      }
    });

    it('accepts a member type on a field, a method and a parameter, and none on a field or a constructor', () => {
      const withMember = (member, extra) => memberAnnotation({ key: 'value', value: null }, { member, ...extra });
      expect(run(withMember({ name: 'm', line: 4, type: 'Port' }, { on: 'method' })).structureOutcome).toBe('succeeded');
      expect(run(withMember({ name: 'm', line: 4, type: 'void' }, {
        on: 'parameter', parameter: { name: 'p', index: 0, line: 4 },
      })).structureOutcome).toBe('succeeded');
      expect(run(withMember({ name: 'm', line: 4 }, { on: 'field' })).structureOutcome).toBe('succeeded');
      expect(run(withMember({ name: 'X', line: 4 }, { on: 'constructor' })).structureOutcome).toBe('succeeded');
      expect(run(withMember({ name: 'X', line: 4 }, {
        on: 'component', parameter: { name: 'p', index: 0, line: 4 },
      })).structureOutcome).toBe('succeeded');
    });
  });

  describe('classes[].modifiers', () => {
    const modifiers = (value) => run({ classes: [{ ...cls, modifiers: value }] }).structureOutcome;

    it('fails the file when modifiers is not an array', () => {
      expect(modifiers('public')).toBe('failed');
    });
    it('fails the file when a modifier is not a string', () => {
      expect(modifiers([7])).toBe('failed');
    });
    it('fails the file for a keyword outside the closed set', () => {
      expect(modifiers(['volatile'])).toBe('failed');
    });
    it('fails the file when annotation text sits among the keywords', () => {
      expect(modifiers(['public', '@Entity'])).toBe('failed');
    });
  });

  describe('nestedTypes', () => {
    const outcome = (nestedTypes) => run({ nestedTypes }).structureOutcome;

    it('fails the file when nestedTypes is not an array', () => {
      expect(outcome(named())).toBe('failed');
    });
    it('fails the file for an entry that is not an object', () => {
      expect(outcome([null])).toBe('failed');
    });
    it('fails the file for a kind outside the closed set', () => {
      expect(outcome([named({ kind: 'struct' })])).toBe('failed');
    });
    it('fails the file when the kind is missing', () => {
      expect(outcome([named({ kind: undefined })])).toBe('failed');
    });
    it('fails the file when a named type has no string name', () => {
      expect(outcome([named({ name: null })])).toBe('failed');
      expect(outcome([named({ name: 7 })])).toBe('failed');
    });
    it('fails the file when an anonymous class has a name', () => {
      expect(outcome([anonymous({ name: 'Anon' })])).toBe('failed');
    });
    it('fails the file when the line is not an integer', () => {
      expect(outcome([named({ line: '2' })])).toBe('failed');
      expect(outcome([named({ line: 2.5 })])).toBe('failed');
    });
    it('fails the file when the owner is not a string', () => {
      expect(outcome([named({ owner: undefined })])).toBe('failed');
    });
    it('fails the file when local is not a boolean', () => {
      expect(outcome([named({ local: 'false' })])).toBe('failed');
      expect(outcome([named({ local: undefined })])).toBe('failed');
    });
    it('fails the file when an anonymous class is not local', () => {
      expect(outcome([anonymous({ local: false })])).toBe('failed');
    });
    it('fails the file when modifiers is missing, not an array, or holds a keyword outside the closed set', () => {
      expect(outcome([named({ modifiers: undefined })])).toBe('failed');
      expect(outcome([named({ modifiers: 'static' })])).toBe('failed');
      expect(outcome([named({ modifiers: ['volatile'] })])).toBe('failed');
    });
    it('fails the file when supertypes is missing or holds a wrong entry', () => {
      expect(outcome([named({ supertypes: undefined })])).toBe('failed');
      expect(outcome([named({ supertypes: [{ relation: 'uses', type: 'Port', line: 2 }] })])).toBe('failed');
      expect(outcome([named({ supertypes: [{ relation: 'extends', type: 'Port' }] })])).toBe('failed');
    });
    it('fails the file when an anonymous class has no instantiates', () => {
      expect(outcome([anonymous({ instantiates: undefined })])).toBe('failed');
    });
    it('fails the file when instantiates has a wrong shape', () => {
      expect(outcome([anonymous({ instantiates: { type: 7, line: 3 } })])).toBe('failed');
      expect(outcome([anonymous({ instantiates: { type: 'Handler' } })])).toBe('failed');
      expect(outcome([anonymous({ instantiates: 'Handler' })])).toBe('failed');
    });
    it('fails the file when a named type has instantiates', () => {
      expect(outcome([named({ instantiates: { type: 'Handler', line: 2 } })])).toBe('failed');
    });
  });

  describe.each(Object.entries(carriers))('classLiterals of an argument of %s', (_, carry) => {
    const outcome = (classLiterals, value = null) => run(carry({ key: 'value', value, classLiterals })).structureOutcome;

    it('fails the file when classLiterals is not an array', () => {
      expect(outcome(literal)).toBe('failed');
    });
    it('fails the file for an entry that is not an object', () => {
      expect(outcome([null])).toBe('failed');
    });
    it('fails the file for an entry with no type, or a type that is not a string', () => {
      expect(outcome([{ line: 4 }])).toBe('failed');
      expect(outcome([{ type: 7, line: 4 }])).toBe('failed');
    });
    it('fails the file for an entry whose line is not an integer', () => {
      expect(outcome([{ type: 'Port' }])).toBe('failed');
      expect(outcome([{ type: 'Port', line: '4' }])).toBe('failed');
      expect(outcome([{ type: 'Port', line: 4.5 }])).toBe('failed');
    });
    it('fails the file when the argument also has a string value: a class literal is not a string', () => {
      expect(outcome([literal], 'Port')).toBe('failed');
    });
  });

  describe('member.type', () => {
    const outcome = (member, extra) => run(memberAnnotation({ key: 'value', value: null }, { member, ...extra })).structureOutcome;

    it('fails the file when type is not a string', () => {
      expect(outcome({ name: 'm', line: 4, type: 7 })).toBe('failed');
      expect(outcome({ name: 'm', line: 4, type: null })).toBe('failed');
    });
    it('fails the file when a constructor has a type', () => {
      expect(outcome({ name: 'X', line: 4, type: 'X' }, { on: 'constructor' })).toBe('failed');
    });
    it('fails the file when a record component has a type', () => {
      expect(outcome({ name: 'X', line: 4, type: 'X' }, {
        on: 'component', parameter: { name: 'p', index: 0, line: 4 },
      })).toBe('failed');
    });
  });

  describe('a rejected file', () => {
    it('becomes a visible parse-failed row, not a missing one', () => {
      const extracted = run({ nestedTypes: [named({ kind: 'struct' })] });
      expect(extracted.analysis).toBeNull();
      const result = buildResult(file, 1, 1, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome);
      expect(result).toMatchObject({ path: file.path, status: 'parse-failed', statusReason: 'extractor-error-or-invalid-output' });
    });

    it('does not count nested types as symbols', () => {
      const extracted = run({ nestedTypes: [named()] });
      const result = buildResult(file, 1, 1, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome);
      expect(result.status).toBe('zero-symbol');
      expect(result.nestedTypes).toEqual([named()]);
    });
  });
});
