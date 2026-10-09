// openspec: changes/knowledge-graph-line-store, design D7 — the Python merge
// script keeps its own copy of the knowledge-graph.jsonl line contract. This
// cross-implementation test writes the base graph with the JS store, merges
// a subdomain graph with merge-subdomain-graphs.py, and reads the result back
// with the JS store, so the two implementations cannot drift apart silently.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  KNOWLEDGE_GRAPH_FILE,
  KNOWLEDGE_GRAPH_FORMAT,
  LEGACY_KNOWLEDGE_GRAPH_FILE,
  readKnowledgeGraph,
  writeKnowledgeGraph,
} from '../../skills/excavator/knowledge-graph-store.mjs';

const MERGE_SCRIPT = fileURLToPath(new URL('../../skills/excavator/merge-subdomain-graphs.py', import.meta.url));

function runMerge(root) {
  const result = spawnSync('python3', [MERGE_SCRIPT, root], { encoding: 'utf-8' });
  if (result.error) throw result.error; // python3 missing is a failure, never a skip
  return result;
}

const node = (id, extra = {}) => ({ id, type: 'file', name: id, summary: '', tags: [], complexity: 'simple', ...extra });

let root;
let dataDir;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kg-python-'));
  dataDir = join(root, '.excavator');
  mkdirSync(dataDir);
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('merge-subdomain-graphs.py reads and writes the knowledge-graph.jsonl contract', () => {
  it('merges a JS-written base with a subdomain graph; the JS store reads the result back', () => {
    writeKnowledgeGraph(join(dataDir, KNOWLEDGE_GRAPH_FILE), {
      version: '1.0.0',
      project: { name: 'demo', languages: ['ts'], frameworks: [], description: '', analyzedAt: 't', gitCommitHash: '' },
      nodes: [node('file:a.ts', { summary: '处理订单 😀' })],
      edges: [],
      layers: [],
      tour: [],
    });
    writeFileSync(join(dataDir, 'billing-knowledge-graph.json'), JSON.stringify({
      nodes: [node('file:b.ts')],
      edges: [{ source: 'file:a.ts', target: 'file:b.ts', type: 'imports', direction: 'forward', weight: 0.7 }],
    }));
    writeFileSync(join(dataDir, LEGACY_KNOWLEDGE_GRAPH_FILE), JSON.stringify({ nodes: [node('file:legacy.ts')], edges: [] }));

    const result = runMerge(root);
    expect(result.status, result.stderr).toBe(0);

    const merged = readKnowledgeGraph(join(dataDir, KNOWLEDGE_GRAPH_FILE));
    expect(merged.nodes.map((n) => n.id).sort()).toEqual(['file:a.ts', 'file:b.ts']); // legacy file never read
    expect(merged.nodes.find((n) => n.id === 'file:a.ts').summary).toBe('处理订单 😀');
    expect(merged.edges).toEqual([expect.objectContaining({ source: 'file:a.ts', target: 'file:b.ts', type: 'imports' })]);
    const header = JSON.parse(readFileSync(join(dataDir, KNOWLEDGE_GRAPH_FILE), 'utf-8').split('\n')[0]);
    expect(header).toMatchObject({ record: 'header', format: KNOWLEDGE_GRAPH_FORMAT });
    expect(existsSync(join(dataDir, LEGACY_KNOWLEDGE_GRAPH_FILE))).toBe(false);
  });

  it('a JS-written graph with every stream round-trips through the Python reader and writer unchanged', () => {
    const graph = {
      version: '1.0.0',
      project: { name: 'demo' },
      nodes: [node('file:a.ts')],
      edges: [],
      layers: [{ id: 'layer:core', name: 'Core', nodeIds: ['file:a.ts'] }],
      tour: [{ order: 1, title: 'Start', nodeIds: ['file:a.ts'] }],
      coverage: { files: 1, byLanguage: {}, ignored: 0 },
      gaps: [{ kind: 'k', scope: 's', reason: 'r', count: 1, samples: [] }],
    };
    const path = join(dataDir, KNOWLEDGE_GRAPH_FILE);
    writeKnowledgeGraph(path, graph);
    const script = [
      'import importlib.util, sys',
      `spec = importlib.util.spec_from_file_location('m', ${JSON.stringify(MERGE_SCRIPT)})`,
      'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
      'from pathlib import Path',
      `p = Path(${JSON.stringify(path)})`,
      'm.write_knowledge_graph(p, m.read_knowledge_graph(p))',
    ].join('\n');
    const result = spawnSync('python3', ['-c', script], { encoding: 'utf-8' });
    if (result.error) throw result.error;
    expect(result.status, result.stderr).toBe(0);
    expect(readKnowledgeGraph(path)).toEqual(graph);
  });

  it('refuses to merge over a base graph that does not read back, leaving it untouched', () => {
    const path = join(dataDir, KNOWLEDGE_GRAPH_FILE);
    writeFileSync(path, '{"record":"node","node":{}}\n');
    writeFileSync(join(dataDir, 'billing-knowledge-graph.json'), JSON.stringify({ nodes: [node('file:b.ts')], edges: [] }));

    const result = runMerge(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`cannot read base ${KNOWLEDGE_GRAPH_FILE}`);
    expect(readFileSync(path, 'utf-8')).toBe('{"record":"node","node":{}}\n');
  });
});
