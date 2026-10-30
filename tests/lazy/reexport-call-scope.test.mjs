// reexport-call-scope: `export ... from` binds no name in the file that writes
// it, so the module it forwards must not join that file's call scope. The tree
// below runs through the real Lazy driver, and the audit's call-site resolver
// then reads the same structure and import map:
//   - forward-only.ts reaches logger.ts only through a re-export and calls its
//     own parameter `log`;
//   - forward-and-import.ts imports `log` from util.ts and forwards logger.ts,
//     which also declares `log`;
//   - forward-and-require.js forwards logger.ts and also require()s it, so
//     logger.ts is not re-export-only; its call to the require()d `log`
//     still draws no edge, since TS/JS calls resolve only through import
//     bindings (import-binding-call-scope);
//   - empty-forward.ts writes `export {} from`, which forwards no name at all.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { PIPELINE_VERSION, runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';
import { readStructureAll } from '../../skills/excavator/structure-all-store.mjs';
import { buildExpectedRecords, resolveUniqueCallSites } from '../../skills/excavator/annotate-graph.mjs';

const LOGGER = 'src/logger.ts';
const UTIL = 'src/util.ts';
const FORWARD_ONLY = 'src/forward-only.ts';
const FORWARD_AND_IMPORT = 'src/forward-and-import.ts';
const FORWARD_AND_REQUIRE = 'src/forward-and-require.js';
const EMPTY_FORWARD = 'src/empty-forward.ts';

const TREE = {
  [LOGGER]: 'export function createLogger() {\n  return log;\n}\nexport function log(message) {\n  return message;\n}\n',
  [UTIL]: 'export function log(message) {\n  return message;\n}\n',
  [FORWARD_ONLY]: "export { createLogger } from './logger';\nexport function run(log) {\n  log('a');\n}\n",
  [FORWARD_AND_IMPORT]: "import { log } from './util';\nexport { createLogger } from './logger';\nexport function report() {\n  log('b');\n}\n",
  [FORWARD_AND_REQUIRE]: "export { createLogger } from './logger';\nconst { log } = require('./logger');\nexport function trace() {\n  log('d');\n}\n",
  [EMPTY_FORWARD]: "export {} from './logger';\nexport function flush(log) {\n  log('e');\n}\n",
};

describe('re-export targets and the call scope', () => {
  let root;
  let graph;
  let importMap;
  let structure;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'excavator-reexport-scope-'));
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
  const fileId = (file) => graph.nodes.find((n) => n.type === 'file' && n.filePath === file).id;
  const callTargetsOf = (file, caller) => graph.edges
    .filter((e) => e.type === 'calls' && e.source === nodeId(file, caller))
    .map((e) => e.target);
  const gapSamples = (kind) => graph.gaps.filter((g) => g.kind === kind).flatMap((g) => g.samples);

  it('moves the pipeline version so graphs built with the wider scope are rebuilt', () => {
    expect(PIPELINE_VERSION).toBe('lazy-fact-graph/15');
    expect(graph.project.pipelineVersion).toBe('lazy-fact-graph/15');
  });

  it('keeps every re-export target in the import map and as an imports edge', () => {
    for (const file of [FORWARD_ONLY, FORWARD_AND_IMPORT, FORWARD_AND_REQUIRE, EMPTY_FORWARD]) {
      expect(importMap.importMap[file], file).toContain(LOGGER);
      const imports = graph.edges.filter((e) => e.type === 'imports' && e.source === fileId(file)).map((e) => e.target);
      expect(imports, file).toContain(fileId(LOGGER));
    }
  });

  it('lists the targets only a re-export reaches, and none that require() also reaches', () => {
    expect(importMap.reexportOnly).toEqual({
      [EMPTY_FORWARD]: [LOGGER],
      [FORWARD_AND_IMPORT]: [LOGGER],
      [FORWARD_ONLY]: [LOGGER],
    });
  });

  it('records an empty re-export with an empty reexports list', () => {
    const row = structure.results.find((r) => r.path === EMPTY_FORWARD);
    expect(row.imports).toEqual([{ source: './logger', specifiers: [], line: 1, reexports: [] }]);
  });

  it('leaves a call to a parameter unresolved when the same name is only forwarded', () => {
    expect(callTargetsOf(FORWARD_ONLY, 'run')).toEqual([]);
    expect(gapSamples('calls-unresolved')).toContain(`${FORWARD_ONLY}:3 -> log`);
  });

  it('resolves an imported name without ambiguity from a forwarded module', () => {
    expect(callTargetsOf(FORWARD_AND_IMPORT, 'report')).toEqual([nodeId(UTIL, 'log')]);
    expect(gapSamples('calls-ambiguous')).not.toContain(`${FORWARD_AND_IMPORT}:4 -> log`);
  });

  it('leaves a call to a require()d name unresolved though the module is not re-export-only', () => {
    expect(callTargetsOf(FORWARD_AND_REQUIRE, 'trace')).toEqual([]);
    expect(gapSamples('calls-unresolved')).toContain(`${FORWARD_AND_REQUIRE}:4 -> log`);
  });

  it('keeps an empty re-export out of the call scope', () => {
    expect(callTargetsOf(EMPTY_FORWARD, 'flush')).toEqual([]);
    expect(gapSamples('calls-unresolved')).toContain(`${EMPTY_FORWARD}:3 -> log`);
  });

  it('gives the audit the same scope as the fact graph', () => {
    const expected = buildExpectedRecords({ structure, importMap });
    const { unique, ambiguous, unresolved } = resolveUniqueCallSites({ structure, importMap, expected });
    const site = (records, file) => records.filter((r) => r.file === file && r.callee === 'log').map((r) => r.targets);
    expect(site(unresolved, FORWARD_ONLY)).toEqual([[]]);
    expect(site(unique, FORWARD_ONLY)).toEqual([]);
    expect(site(unique, FORWARD_AND_IMPORT)).toEqual([[UTIL]]);
    expect(site(ambiguous, FORWARD_AND_IMPORT)).toEqual([]);
    expect(site(unresolved, FORWARD_AND_REQUIRE)).toEqual([[]]);
    expect(site(unresolved, EMPTY_FORWARD)).toEqual([[]]);
  });
});
