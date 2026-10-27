/**
 * validate-graph.mjs — a declaration head or a call expression written over several lines.
 *
 * An extractor cites the first line of a construct, and the name the validator looks for is a few lines
 * below: the callee of a call expression, or the name of a declaration whose modifiers wrap onto a line of
 * their own. Each rule exists only in the languages that have the syntax, so each case is written per
 * language: the shapes that must be read, the statements that must not be taken for them, and the languages
 * that do not have them.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as validator from '../../../skills/excavator/validate-graph.mjs';

const { validateAgainstSource, createSourceReader } = validator;
// Absent on a validator that has no leading-line bound yet, so this file still loads and its cases go red one by one.
const CONSTRUCT_SCAN_LINES = validator.CONSTRUCT_SCAN_LINES ?? 400;

const VALIDATE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../skills/excavator/validate-graph.mjs');

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function project(sources) {
  const root = mkdtempSync(join(tmpdir(), 'excavator-constructs-'));
  tempDirs.push(root);
  for (const [rel, lines] of Object.entries(sources)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `${lines.join('\n')}\n`);
  }
  return root;
}

const fileNode = (path) => ({
  id: `file:${path}`, type: 'file', name: path.split('/').pop(), filePath: path, summary: '', tags: [], complexity: 'simple',
});
const declNode = (type, path, name, lineRange) => ({
  id: `${type}:${path}:${name}`, type, name, filePath: path, lineRange, summary: '', tags: [], complexity: 'simple',
});
const edge = (type, source, target, file, line, from = 'tree-sitter') => ({
  source: source.id, target: target.id, type, direction: 'forward', weight: 1,
  provenance: 'extracted', evidence: [{ file, line, source: from }],
});

function run(root, nodes, edges = []) {
  const graph = {
    version: '1.0.0',
    project: { name: 'fixture', languages: [], frameworks: [], description: '', analyzedAt: '2026-10-27T00:00:00.000Z', gitCommitHash: null },
    nodes, edges, layers: [{ id: 'l', name: 'L', description: 'L', nodeIds: nodes.filter((n) => n.type === 'file').map((n) => n.id) }], tour: [],
  };
  return validateAgainstSource({ graph, reader: createSourceReader(root), sampleLimit: 5 });
}

/** A declaration block of `count` lines of nested annotations whose string literals hold brackets, `@` and `\n`. */
function bigAnnotationBlock(count) {
  const lines = ['@Outer(', '    values = {'];
  while (lines.length < count - 3) {
    lines.push(`      @Inner(text = "dn: ) ( @x\\n", n = ${lines.length}),`);
  }
  lines.push('    })', '@Marker', '@Last("a)b")');
  return lines;
}

describe('validate-graph — a declaration head that wraps its modifiers onto a line before the name', () => {
  it('confirms the anchor and the edges of a method whose modifiers and return type are on their own line', () => {
    const lines = [
      'class W {', //                                    1
      '  @Test', //                                       2
      '  public void', //                                 3
      '  testWrapped() throws Exception {}', //            4
      '', //                                               5
      '  public static', //                                6
      '  void bare() {}', //                               7
      '}', //                                                8
    ];
    const root = project({ 'src/W.java': lines });
    const file = fileNode('src/W.java');
    const wrapped = declNode('function', 'src/W.java', 'testWrapped', [2, 4]);
    const bare = declNode('function', 'src/W.java', 'bare', [6, 7]);
    const { report } = run(root, [file, wrapped, bare], [
      edge('contains', file, wrapped, 'src/W.java', 2),
      edge('exports', file, wrapped, 'src/W.java', 2),
      edge('contains', file, bare, 'src/W.java', 6),
    ]);
    expect(report.counts.anchorMismatch).toBe(0);
    expect(report.counts.edgeContradicted).toBe(0);
    expect(report.counts.edgeConfirmed).toBe(3);
  });

  it('follows a head that wraps over several lines while each line holds only words and types', () => {
    const lines = ['class K {', '  public static final', '  int', '  LIMIT = 4;', '}'];
    const root = project({ 'src/K.java': lines });
    const file = fileNode('src/K.java');
    const limit = declNode('function', 'src/K.java', 'LIMIT', [2, 4]);
    const { report } = run(root, [file, limit], [edge('contains', file, limit, 'src/K.java', 2)]);
    expect(report.counts.anchorMismatch).toBe(0);
    expect(report.counts.edgeConfirmed).toBe(1);
  });

  it('does not look past a declaration line that is already complete', () => {
    const lines = ['class D {', '  void first() {}', '  void second() {}', '}'];
    const root = project({ 'src/D.java': lines });
    const file = fileNode('src/D.java');
    const second = declNode('function', 'src/D.java', 'second', [3, 3]);
    const { report } = run(root, [file, second], [
      edge('contains', file, second, 'src/D.java', 2),
      edge('exports', file, second, 'src/D.java', 2),
    ]);
    expect(report.counts.edgeContradicted).toBe(2);
  });

  // A line that is a statement, or that starts with a word that also starts a statement. None may be taken
  // for the start of a wrapped head, so none may let an edge that cites it reach the name on the next line.
  const NOT_A_HEAD = [
    ['java', 'return x'], ['java', 'break'], ['java', 'else'], ['java', 'import foo.Bar'], ['java', 'package app'],
    ['ts', 'export default router'], ['ts', 'export const router'], ['ts', 'const router'], ['ts', 'static x'], ['ts', 'async'],
    ['kt', 'val x'], ['kt', 'object Registry'], ['cs', 'using System'], ['cs', 'return value'], ['php', 'namespace App'], ['php', 'return $x'],
  ];
  it.each(NOT_A_HEAD)('%s: does not read %j as the start of a wrapped head', (ext, statement) => {
    const path = `src/s.${ext}`;
    const root = project({ [path]: [statement, 'helper() {}', ''] });
    const file = fileNode(path);
    const helper = declNode('function', path, 'helper', [1, 2]);
    const { report } = run(root, [file, helper], [edge('contains', file, helper, path, 1)]);
    expect(report.counts.edgeContradicted).toBe(1);
  });

  // Declaration heads wrap only in the languages that have these modifiers.
  it.each([['py', 'public'], ['rb', 'public'], ['go', 'public'], ['txt', 'public'], ['js', 'public'], ['rs', 'public']])(
    '%s: does not read %j as the start of a wrapped head', (ext, line) => {
      const path = `src/s.${ext}`;
      const root = project({ [path]: [line, 'helper() {}', ''] });
      const file = fileNode(path);
      const helper = declNode('function', path, 'helper', [1, 2]);
      const { report } = run(root, [file, helper], [edge('contains', file, helper, path, 1)]);
      expect(report.counts.edgeContradicted).toBe(1);
    },
  );

  it.each([['java', 'public'], ['cs', 'private'], ['kt', 'override'], ['scala', 'final'], ['ts', 'public'], ['php', 'public']])(
    '%s: reads %j as the start of a wrapped head', (ext, modifier) => {
      const path = `src/s.${ext}`;
      const root = project({ [path]: [modifier, 'helper() {}', ''] });
      const file = fileNode(path);
      const helper = declNode('function', path, 'helper', [1, 2]);
      const { report } = run(root, [file, helper], [edge('contains', file, helper, path, 1)]);
      expect(report.counts.edgeConfirmed).toBe(1);
    },
  );

  it('marks a head that never ends within the scan bound as unverified, not as contradicted', () => {
    const lines = ['public', ...Array.from({ length: CONSTRUCT_SCAN_LINES + 20 }, (_, i) => `word${i}`)];
    const root = project({ 'src/Long.java': lines });
    const { validated, report } = run(root, [declNode('function', 'src/Long.java', 'helper', [1, lines.length])]);
    expect(report.counts.anchorMismatch).toBe(0);
    expect(report.counts.constructTooLong).toBe(1);
    expect(validated.nodes[0].verification).toBe('unverified');
  });
});
