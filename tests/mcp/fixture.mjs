import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { auditSemanticCacheFields } from '../../skills/excavator/semantic-language-audit.mjs';
import { resolveSourceSnapshot } from '../../skills/excavator/source-snapshot.mjs';

export const IDS = Object.freeze({
  a: 'function:src/same-a.ts:save()',
  b: 'function:src/same-b.ts:save()',
  ownerA: 'method:src/owners.ts:OwnerA.save()',
  ownerB: 'method:src/owners.ts:OwnerB.save()',
  missing: 'function:src/missing.ts:load()',
  noncanonical: 'function:src/noncanonical.ts:remove()',
  orphan: 'function:src/orphan.ts:orphan()',
});

const FILES = Object.freeze({
  'src/same-a.ts': 'export function save() { return 1; }\n',
  'src/same-b.ts': 'export function save() { return 1; }\n',
  'src/owners.ts': 'export class OwnerA { save() { return 1; } }\nexport class OwnerB { save() { return 2; } }\n',
  'src/missing.ts': 'export function load() { return 2; }\n',
  'src/noncanonical.ts': 'export function remove() { return 3; }\n',
});

function entry(contentHash, summary = 'Returns a local value.') {
  const fields = {
    summary,
    tags: ['value'],
    semanticSourceHash: contentHash,
    model: 'fixture-host',
    generatedAt: '2026-09-16T00:00:00.000Z',
  };
  return { ...fields, languageAudit: auditSemanticCacheFields({ fields }) };
}

export function makeMcpFixture({ escapedDataDir = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'excavator-mcp-'));
  const outside = mkdtempSync(join(tmpdir(), 'excavator-mcp-outside-'));
  for (const [path, content] of Object.entries(FILES)) {
    const dest = join(root, path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
  writeFileSync(join(outside, 'secret.ts'), 'export const secret = true;\n');
  symlinkSync(join(outside, 'secret.ts'), join(root, 'src', 'escape.ts'));

  const snapshot = resolveSourceSnapshot(root);
  const entries = snapshot.entries();
  const hashByPath = new Map(entries.map((item) => [item.path, item.contentHash]));
  const nodes = [
    { id: IDS.a, name: 'save', type: 'function', filePath: 'src/same-a.ts', lineRange: [1, 1] },
    { id: IDS.b, name: 'save', type: 'function', filePath: 'src/same-b.ts', lineRange: [1, 1] },
    { id: IDS.ownerA, name: 'save', type: 'method', filePath: 'src/owners.ts', lineRange: [1, 1] },
    { id: IDS.ownerB, name: 'save', type: 'method', filePath: 'src/owners.ts', lineRange: [2, 2] },
    { id: IDS.missing, name: 'load', type: 'function', filePath: 'src/missing.ts', lineRange: [1, 1] },
    { id: IDS.noncanonical, name: 'remove', type: 'function', filePath: 'src/noncanonical.ts', lineRange: [1, 1] },
    { id: IDS.orphan, name: 'orphan', type: 'function', filePath: 'src/orphan.ts', lineRange: [1, 1] },
  ];
  const noncanonical = entry(hashByPath.get('src/noncanonical.ts'));
  noncanonical.summary = '移除本地条目。';
  const cache = {
    version: '2.0.0',
    contentLanguage: 'en',
    entries: {
      [IDS.a]: entry(hashByPath.get('src/same-a.ts')),
      [IDS.b]: entry(hashByPath.get('src/same-b.ts')),
      [IDS.ownerA]: entry('stale-source-hash'),
      [IDS.noncanonical]: noncanonical,
    },
  };
  const graph = { nodes, edges: [
    { type: 'calls', source: IDS.a, target: IDS.b },
    { type: 'calls', source: IDS.b, target: IDS.ownerA },
    { type: 'calls', source: IDS.ownerA, target: IDS.ownerB },
  ], coverage: {}, gaps: [], project: { analysisMode: 'lazy' } };
  const manifest = {
    sourceRevision: snapshot.revision,
    selectionDigest: snapshot.selectionDigest,
    pipelineVersion: 'lazy-fact-graph/1',
    entries,
  };

  if (escapedDataDir) {
    symlinkSync(outside, join(root, '.excavator'));
  } else {
    mkdirSync(join(root, '.excavator'));
    writeFileSync(join(root, '.excavator', 'knowledge-graph.json'), JSON.stringify(graph));
    writeFileSync(join(root, '.excavator', 'source-manifest.json'), JSON.stringify(manifest));
    writeFileSync(join(root, '.excavator', 'semantic-cache.json'), JSON.stringify(cache));
    const chunks = [{ id: 'chunk:a', nodeId: IDS.a, path: 'src/same-a.ts', symbol: 'save', lineRange: [1, 1] }];
    const sourceIndex = { sourceRevision: snapshot.revision, chunks,
      postings: { save: [{ chunkId: 'chunk:a', tf: 1 }] },
      docLengths: { 'chunk:a': 1 }, avgDocLength: 1, N: 1 };
    writeFileSync(join(root, '.excavator', 'source-index.json'), JSON.stringify(sourceIndex));
  }
  return {
    root,
    outside,
    snapshot,
    graph,
    manifest,
    cache,
    readCacheBytes: () => readFileSync(join(root, '.excavator', 'semantic-cache.json')),
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    },
  };
}
