// route-entry-points, oracle O7: the unused-code candidates read the knowledge
// graph's `entryPoints` stream. A purpose-built Express tree runs through the
// real Lazy driver: `app.js` registers a handler imported from another file, the
// handler calls a helper, and a third function is called by nothing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';
import { readStructureAll } from '../../skills/excavator/structure-all-store.mjs';
import { buildUnusedCandidates } from '../../skills/excavator/unused-code.mjs';

const lines = (...text) => `${text.join('\n')}\n`;
const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';

const TREE = {
  'app.js': lines(
    "import express from 'express';",
    "import { listOrders } from './orders';",
    'const app = express();',
    "app.get('/orders', listOrders);",
  ),
  'orders.js': lines(
    'function loadOrders() {',
    '  return [];',
    '}',
    'function listOrders(req, res) {',
    '  res.json(loadOrders());',
    '}',
    'function unusedHelper() {',
    '  return 1;',
    '}',
    'export { listOrders };',
  ),
};

describe('unused-code candidates over entry points in the real Lazy driver', () => {
  let root;
  let product;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'excavator-unused-entry-roots-'));
    for (const [path, text] of Object.entries(TREE)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const result = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    expect(result.saveError).toBeNull();
    const data = join(root, '.excavator');
    const graph = readKnowledgeGraph(join(data, KNOWLEDGE_GRAPH_FILE));
    product = buildUnusedCandidates({ graph: { ...graph, factsDigest: 'digest-1' }, structure: readStructureAll(join(data, 'intermediate', 'structure-all.jsonl')), sourceRevision: 'rev-1' });
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const candidateNames = () => product.candidates.map((c) => c.name).sort();

  it('the handler and its callee are not candidates; the function nothing calls is', () => {
    expect(candidateNames()).toEqual(['unusedHelper']);
  });

  it('counts one entry point root', () => {
    expect(product.counts.roots).toEqual({ routes: 0, invokes: 0, entryPoints: 1 });
  });
});
