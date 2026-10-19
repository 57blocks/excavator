// dead-code-detection, tasks 1.1-1.3: Java method and constructor entries
// carry visibility, modifiers and annotations, Java files carry their class
// literals, the structure row validates and passes them through, they never
// enter node identity, and rows of other languages keep their exact bytes.
import { createHash } from 'node:crypto';
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

const JAVA_FILE = { path: 'src/p/LoanMapper.java', language: 'java', fileCategory: 'code' };
const JAVA_SOURCE = [
  'package p;',
  '@Mapper(uses = Helper.class)',
  'public class LoanMapper {',
  '  private static final Logger LOG = LoggerFactory.getLogger(LoanMapper.class);',
  '  @GET @Path("/x") public Response list() { return null; }',
  '  static void helper() {}',
  '  protected LoanMapper() {}',
  '}',
  '',
].join('\n');

describe('structure row: Java declaration facts', () => {
  it('carries visibility, modifiers and annotations on every method and constructor', () => {
    const { functions } = row(JAVA_FILE, JAVA_SOURCE);
    expect(functions.map((f) => [f.name, f.visibility, f.modifiers, f.annotations])).toEqual([
      ['list', 'public', [], ['GET', 'Path']],
      ['helper', 'package', ['static'], []],
      ['LoanMapper', 'protected', [], []],
    ]);
  });

  it('carries the class literals of the file with line and context', () => {
    const { classLiterals } = row(JAVA_FILE, JAVA_SOURCE);
    expect(classLiterals).toEqual([
      { type: 'Helper', line: 2, context: 'annotation' },
      { type: 'LoanMapper', line: 4, context: 'code' },
    ]);
  });

  it('gives a Java file with no class literals an empty list', () => {
    const { classLiterals } = row({ path: 'src/p/A.java', language: 'java', fileCategory: 'code' },
      'package p;\nclass A { void f() {} }\n');
    expect(classLiterals).toEqual([]);
  });

  it('leaves node identity and the fact graph exactly as without the new fields', () => {
    const withFields = row(JAVA_FILE, JAVA_SOURCE);
    const without = structuredClone(withFields);
    delete without.classLiterals;
    for (const fn of without.functions) {
      delete fn.visibility;
      delete fn.modifiers;
      delete fn.annotations;
    }
    const graphOf = (r) => {
      const file = { ...JAVA_FILE, sizeLines: 8 };
      const scan = { files: [file], skipped: [], coverage: { limits: { maxFileLines: 20000, maxFileBytes: 2097152 } } };
      return buildFactGraph({ scan, structureAll: { results: [r] }, importMap: { importMap: { [file.path]: [] }, unresolved: {} } });
    };
    const a = graphOf(withFields);
    const b = graphOf(without);
    expect(a.nodes.map((n) => n.id)).toEqual(b.nodes.map((n) => n.id));
    expect(a.nodes.filter((n) => n.type === 'function').map((n) => n.id)).toEqual([
      'function:src/p/LoanMapper.java:LoanMapper#LoanMapper()',
      'function:src/p/LoanMapper.java:LoanMapper#helper()',
      'function:src/p/LoanMapper.java:LoanMapper#list()',
    ]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('structure row: Java declaration fact validation', () => {
  const file = { path: 'src/p/X.java', language: 'java', fileCategory: 'code' };
  const fn = { name: 'm', lineRange: [2, 2], params: [], paramTypes: [], owner: 'X' };
  const fake = (structure) => {
    const plugin = { analyzeFileFull: () => ({ structure, callGraph: [] }) };
    return { getPluginForFile: () => plugin, analyzeFileFull: plugin.analyzeFileFull };
  };
  const outcome = (structure) => analyzeFileWithOutcomes(fake(structure), file, '').structureOutcome;
  const withFunction = (extra) => ({ functions: [{ ...fn, ...extra }], classes: [], imports: [], exports: [] });
  const withLiterals = (classLiterals) => ({ functions: [], classes: [], imports: [], exports: [], classLiterals });

  it('accepts every visibility in the closed set and rejects anything else', () => {
    for (const visibility of ['public', 'protected', 'package', 'private']) {
      expect(outcome(withFunction({ visibility }))).toBe('succeeded');
    }
    expect(outcome(withFunction({ visibility: 'internal' }))).toBe('failed');
    expect(outcome(withFunction({ visibility: null }))).toBe('failed');
  });

  it('accepts modifier keywords from the closed set only', () => {
    expect(outcome(withFunction({ modifiers: ['static', 'final', 'native', 'default', 'synchronized', 'abstract'] })))
      .toBe('succeeded');
    expect(outcome(withFunction({ modifiers: ['volatile'] }))).toBe('failed');
    expect(outcome(withFunction({ modifiers: 'static' }))).toBe('failed');
  });

  it('accepts annotation names as a list of strings', () => {
    expect(outcome(withFunction({ annotations: ['GET', 'Path'] }))).toBe('succeeded');
    expect(outcome(withFunction({ annotations: [1] }))).toBe('failed');
    expect(outcome(withFunction({ annotations: 'GET' }))).toBe('failed');
  });

  it('accepts class literals with a closed context and rejects a wrong shape', () => {
    expect(outcome(withLiterals([]))).toBe('succeeded');
    expect(outcome(withLiterals([{ type: 'Helper', line: 2, context: 'annotation' }, { type: 'X', line: 3, context: 'code' }])))
      .toBe('succeeded');
    expect(outcome(withLiterals([{ type: 'Helper', line: 2, context: 'javadoc' }]))).toBe('failed');
    expect(outcome(withLiterals([{ type: 'Helper', context: 'code' }]))).toBe('failed');
    expect(outcome(withLiterals([{ type: 7, line: 2, context: 'code' }]))).toBe('failed');
    expect(outcome(withLiterals({ type: 'Helper', line: 2, context: 'code' }))).toBe('failed');
  });

  it('does not count class literals as symbols', () => {
    const extracted = analyzeFileWithOutcomes(fake(withLiterals([{ type: 'X', line: 1, context: 'code' }])), file, '');
    const result = buildResult(file, 1, 1, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome);
    expect(result.status).toBe('zero-symbol');
    expect(result.classLiterals).toEqual([{ type: 'X', line: 1, context: 'code' }]);
  });
});

// Synthetic non-Java files whose structure rows must keep their exact bytes.
// The digest was frozen from the extractor before dead-code-detection; a red
// here means a non-Java row changed, which this change must never do.
const NON_JAVA_FILES = [
  [{ path: 'src/a.ts', language: 'typescript', fileCategory: 'code' }, [
    "import { b } from './b';",
    '@Component({ selector: "x" })',
    'export class A { private run(x: number): string { return b(x); } static make(): A { return new A(); } }',
    'export function f(y: string): number { return 1; }',
    '',
  ]],
  [{ path: 'src/b.py', language: 'python', fileCategory: 'code' }, [
    'import os',
    'class Svc:',
    '    @staticmethod',
    '    def run(x):',
    '        return os.path.join(x)',
    '@app.route("/x")',
    'def view():',
    '    return Svc.run(1)',
    '',
  ]],
  [{ path: 'src/c.go', language: 'go', fileCategory: 'code' }, [
    'package c',
    'import "fmt"',
    'type T struct{ n int }',
    'func (t *T) Run() { fmt.Println(t.n) }',
    'func helper() int { return 1 }',
    '',
  ]],
  [{ path: 'src/d.kt', language: 'kotlin', fileCategory: 'code' }, [
    'package d',
    '@Service',
    'class Svc(private val repo: Repo) {',
    '    @Transactional',
    '    internal fun run(): Int = repo.count(Svc::class.java)',
    '    private fun hidden() {}',
    '}',
    '',
  ]],
  [{ path: 'src/e.cs', language: 'csharp', fileCategory: 'code' }, [
    'using System;',
    'namespace E {',
    '  [Serializable]',
    '  public class Svc {',
    '    [Obsolete] private static void Run() { Console.WriteLine(typeof(Svc)); }',
    '    protected internal int Count() { return 1; }',
    '  }',
    '}',
    '',
  ]],
  [{ path: 'src/f.scala', language: 'scala', fileCategory: 'code' }, [
    'package f',
    'class Svc { private def run(): Int = 1; def go(): Int = run() }',
    'object Svc { val k = classOf[Svc] }',
    '',
  ]],
  [{ path: 'config/app.yaml', language: 'yaml', fileCategory: 'config' }, [
    'server:',
    '  port: 8080',
    'handler: com.acme.Svc',
    '',
  ]],
];

// Re-frozen by jsx-element-references: the TS row's import gained its
// `bindings`; with that field removed the rows hash to the previous value
// (a905dcdb...).
const NON_JAVA_ROWS_SHA256 = '0b1066f9f72fed2d7463a471a28c855970112298feda5af24abd1d6ea53a029c';

describe('structure row: other languages byte-identical', () => {
  it('produces exactly the rows frozen before Java declaration facts existed', () => {
    const rows = NON_JAVA_FILES.map(([file, lines]) => row(file, lines.join('\n')));
    const json = JSON.stringify(rows);
    for (const key of ['visibility', 'modifiers', 'classLiterals']) expect(json).not.toContain(`"${key}"`);
    expect(createHash('sha256').update(json).digest('hex'), json).toBe(NON_JAVA_ROWS_SHA256);
  });
});
