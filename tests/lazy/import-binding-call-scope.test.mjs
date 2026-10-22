// import-binding-call-scope: a TS/JS call resolves its callee only to what
// the file binds: a top-level function or class of its own, or what an import
// binding names through the module's exports. A same-named declaration that
// an imported module happens to have is never a candidate. The tree below
// runs through the real Lazy driver, and the audit's call-site resolver then
// reads the same structure and import map. Each caller file shows one form:
//   - param.ts calls its parameter `log` while importing only `createLogger`;
//   - star-and-import.ts forwards a.ts and imports `helper` from b.ts, and
//     both modules declare `log`;
//   - external.ts imports `format` from a package and something else from
//     fmt.ts, which declares `format` too;
//   - shadow.ts imports `log`, and `wrap(log)` shadows it;
//   - alias.ts, default-user.ts, namespace-user.ts and barrel-user.ts reach a
//     declaration through a renamed, default, namespace or re-exported binding;
//   - ambiguous-user.ts imports `log` from a module two `export *` provide it;
//   - cjs-user.js binds `log` with require(), which no structure row records;
//   - own.ts calls its own top-level function.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { PIPELINE_VERSION, runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';
import { readStructureAll } from '../../skills/excavator/structure-all-store.mjs';
import { buildExpectedRecords, resolveUniqueCallSites } from '../../skills/excavator/annotate-graph.mjs';

const LOGGER = 'src/logger.ts';
const A = 'src/a.ts';
const B = 'src/b.ts';
const FMT = 'src/fmt.ts';
const FACTORY = 'src/factory.ts';
const BARREL = 'src/barrel.ts';
const BOTH = 'src/both.ts';
const PARAM = 'src/param.ts';
const STAR = 'src/star-and-import.ts';
const EXTERNAL = 'src/external.ts';
const SHADOW = 'src/shadow.ts';
const ALIAS = 'src/alias.ts';
const DEFAULT_USER = 'src/default-user.ts';
const NAMESPACE_USER = 'src/namespace-user.ts';
const BARREL_USER = 'src/barrel-user.ts';
const AMBIGUOUS_USER = 'src/ambiguous-user.ts';
const CJS_USER = 'src/cjs-user.js';
const OWN = 'src/own.ts';

const lines = (...text) => `${text.join('\n')}\n`;

const TREE = {
  [LOGGER]: lines('export function createLogger() {', '  return 1;', '}', 'export function log(message) {', '  return message;', '}'),
  [A]: lines('export function log(message) {', '  return message;', '}'),
  [B]: lines('export function helper() {', '  return 1;', '}', 'export function log(message) {', '  return message;', '}'),
  [FMT]: lines('export function stamp() {', '  return 1;', '}', 'export function format() {', '  return 2;', '}'),
  [FACTORY]: lines('export default function createThing() {', '  return 1;', '}'),
  [BARREL]: lines("export { log } from './logger';"),
  [BOTH]: lines("export * from './a';", "export * from './b';"),
  [PARAM]: lines("import { createLogger } from './logger';", 'export function run(log) {', "  log('a');", '  createLogger();', '}'),
  [STAR]: lines("export * from './a';", "import { helper } from './b';", 'export function report() {', "  log('b');", '  helper();', '}'),
  [EXTERNAL]: lines("import { format } from 'date-fns';", "import { stamp } from './fmt';", 'export function show() {', '  format(1);', '  stamp();', '}'),
  [SHADOW]: lines("import { log } from './logger';", 'export function wrap(log) {', "  log('c');", '}', 'export function direct() {', "  log('d');", '}'),
  [ALIAS]: lines("import { log as write } from './logger';", 'export function save() {', "  write('e');", '}'),
  [DEFAULT_USER]: lines("import make from './factory';", 'export function build() {', '  make();', '}'),
  [NAMESPACE_USER]: lines("import * as util from './b';", 'export function use() {', '  util.helper();', '  util();', '  util.missing();', '}'),
  [BARREL_USER]: lines("import { log } from './barrel';", 'export function viaBarrel() {', "  log('f');", '}'),
  [AMBIGUOUS_USER]: lines("import { log } from './both';", 'export function pick() {', "  log('g');", '}'),
  [CJS_USER]: lines("const { log } = require('./logger');", 'function trace() {', "  log('h');", '}', 'module.exports = { trace };'),
  [OWN]: lines('function tidy() {', '  return 1;', '}', 'export function outer() {', '  tidy();', '}'),
};

describe('TS/JS calls resolve through the file\'s own bindings', () => {
  let root;
  let graph;
  let importMap;
  let structure;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'excavator-binding-scope-'));
    for (const [path, text] of Object.entries(TREE)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const result = await runLazyAnalysis({ projectRoot: root, now: () => '2024-01-01T00:00:00.000Z' });
    expect(result.saveError).toBeNull();
    graph = readKnowledgeGraph(join(root, '.excavator', KNOWLEDGE_GRAPH_FILE));
    const intermediate = join(root, '.excavator', 'intermediate');
    importMap = JSON.parse(readFileSync(join(intermediate, 'import-map.json'), 'utf-8'));
    structure = readStructureAll(join(intermediate, 'structure-all.jsonl'));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const nodeId = (file, name) => {
    const matches = graph.nodes.filter((n) => n.filePath === file && n.name === name && n.type !== 'file');
    expect(matches, `${file} ${name}`).toHaveLength(1);
    return matches[0].id;
  };
  const callTargetsOf = (file, caller) => graph.edges
    .filter((e) => e.type === 'calls' && e.source === nodeId(file, caller))
    .map((e) => e.target);
  const callGap = (kind, scope) => graph.gaps.find((g) => g.kind === kind && g.scope === scope);

  it('moves the pipeline version so graphs built by the same-name search are rebuilt', () => {
    expect(PIPELINE_VERSION).toBe('lazy-fact-graph/15');
    expect(graph.project.pipelineVersion).toBe('lazy-fact-graph/15');
  });

  it('does not call a module-level name the file never imports', () => {
    expect(callTargetsOf(PARAM, 'run')).toEqual([nodeId(LOGGER, 'createLogger')]);
    expect(callTargetsOf(STAR, 'report')).toEqual([nodeId(B, 'helper')]);
    expect(callTargetsOf(EXTERNAL, 'show')).toEqual([nodeId(FMT, 'stamp')]);
  });

  it('does not resolve a callee a parameter shadows', () => {
    expect(callTargetsOf(SHADOW, 'wrap')).toEqual([]);
    expect(callTargetsOf(SHADOW, 'direct')).toEqual([nodeId(LOGGER, 'log')]);
  });

  it('follows renamed, default, namespace and re-exported bindings to the declaration', () => {
    expect(callTargetsOf(ALIAS, 'save')).toEqual([nodeId(LOGGER, 'log')]);
    expect(callTargetsOf(DEFAULT_USER, 'build')).toEqual([nodeId(FACTORY, 'createThing')]);
    expect(callTargetsOf(NAMESPACE_USER, 'use')).toEqual([nodeId(B, 'helper')]);
    expect(callTargetsOf(BARREL_USER, 'viaBarrel')).toEqual([nodeId(LOGGER, 'log')]);
    expect(callTargetsOf(OWN, 'outer')).toEqual([nodeId(OWN, 'tidy')]);
  });

  it('draws no edge for an ambiguous export or a require() binding', () => {
    expect(callTargetsOf(AMBIGUOUS_USER, 'pick')).toEqual([]);
    expect(callTargetsOf(CJS_USER, 'trace')).toEqual([]);
  });

  it('puts every call that draws no edge in a visible calls gap', () => {
    const shape = (gap) => gap && { count: gap.count, samples: gap.samples };
    // Six TypeScript sites; the gap keeps the first five samples in path order.
    expect(shape(callGap('calls-unresolved', 'typescript'))).toEqual({
      count: 6,
      samples: [
        `${EXTERNAL}:4 -> format`,
        `${NAMESPACE_USER}:4 -> util`,
        `${NAMESPACE_USER}:5 -> util.missing`,
        `${PARAM}:3 -> log`,
        `${SHADOW}:3 -> log`,
      ],
    });
    expect(shape(callGap('calls-ambiguous', 'typescript'))).toEqual({ count: 1, samples: [`${AMBIGUOUS_USER}:3 -> log`] });
    expect(shape(callGap('calls-unresolved', 'javascript'))).toEqual({ count: 1, samples: [`${CJS_USER}:3 -> log`] });
    expect(callGap('calls-caller-unresolved', 'typescript')).toBeUndefined();
    expect(callGap('calls-unresolved', 'javascript').reason).toContain('require()');
  });

  it('keeps the shadowing mark in the structure row', () => {
    const row = structure.results.find((r) => r.path === SHADOW);
    expect(row.callGraph).toEqual([
      { caller: 'wrap', callee: 'log', lineNumber: 3, local: true },
      { caller: 'direct', callee: 'log', lineNumber: 6 },
    ]);
  });

  it('gives the audit the same outcome for every call site', () => {
    const expected = buildExpectedRecords({ structure, importMap });
    const { unique, ambiguous, unresolved } = resolveUniqueCallSites({ structure, importMap, expected });
    const outcomes = [
      ...unique.map((r) => [r.file, r.line, r.callee, 'unique', r.targets]),
      ...ambiguous.map((r) => [r.file, r.line, r.callee, 'ambiguous']),
      ...unresolved.map((r) => [r.file, r.line, r.callee, 'unresolved', r.targets]),
    ].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1]));
    expect(outcomes).toEqual([
      [ALIAS, 3, 'write', 'unique', [LOGGER]],
      [AMBIGUOUS_USER, 3, 'log', 'ambiguous'],
      [BARREL_USER, 3, 'log', 'unique', [LOGGER]],
      [CJS_USER, 3, 'log', 'unresolved', []],
      [DEFAULT_USER, 3, 'make', 'unique', [FACTORY]],
      [EXTERNAL, 4, 'format', 'unresolved', []],
      [EXTERNAL, 5, 'stamp', 'unique', [FMT]],
      [NAMESPACE_USER, 3, 'util.helper', 'unique', [B]],
      [NAMESPACE_USER, 4, 'util', 'unresolved', []],
      [NAMESPACE_USER, 5, 'util.missing', 'unresolved', []],
      [OWN, 5, 'tidy', 'unique', [OWN]],
      [PARAM, 3, 'log', 'unresolved', []],
      [PARAM, 4, 'createLogger', 'unique', [LOGGER]],
      [SHADOW, 3, 'log', 'unresolved', []],
      [SHADOW, 6, 'log', 'unique', [LOGGER]],
      [STAR, 4, 'log', 'unresolved', []],
      [STAR, 5, 'helper', 'unique', [B]],
    ]);
  });
});
