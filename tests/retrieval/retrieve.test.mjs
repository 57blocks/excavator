// Group 3 — hybrid-retrieval mechanics contract (openspec: changes/
// hybrid-retrieval, specs/hybrid-retrieval/spec.md). Only the DETERMINISTIC
// mechanics live here: candidate merge/ranking and budgeted graph traversal.
// Query expansion and question-type judgment are the chat's job (group 5,
// same-inference, not a subagent) and are intentionally NOT exercised here.
import { describe, expect, it } from 'vitest';
import {
  bm25Search,
  mergeCandidates,
  oneHop,
  boundedBFS,
  boundedShortestPath,
  DEFAULT_TRAVERSAL_BUDGETS,
} from '../../skills/excavator/retrieve.mjs';

describe('bm25Search — recall remains separate from traversal seeds', () => {
  it('retains up to 20 ranked candidates for recall', () => {
    const chunks = Array.from({ length: 25 }, (_, index) => ({ id: `chunk:${index}` }));
    const index = {
      postings: { match: chunks.map(({ id }) => ({ chunkId: id, tf: 1 })) },
      docLengths: Object.fromEntries(chunks.map(({ id }) => [id, 1])),
      avgDocLength: 1,
      N: chunks.length,
      chunks,
    };

    const result = bm25Search(index, ['match'], 20);

    expect(result).toHaveLength(20);
  });
});

// ---------------------------------------------------------------------------
// mergeCandidates — Requirement "candidates merged and ranked from multiple sources".
// ---------------------------------------------------------------------------
describe('mergeCandidates', () => {
  it('ranks an exact match above a weak BM25-only match, and merges duplicate hits', () => {
    const exact = [{ nodeId: 'function:src/a.ts:doThing', path: 'src/a.ts', symbol: 'doThing' }];
    const bm25 = [
      { nodeId: 'function:src/a.ts:doThing', path: 'src/a.ts', symbol: 'doThing', score: 0.4 },
      { nodeId: 'function:src/b.ts:unrelated', path: 'src/b.ts', symbol: 'unrelated', score: 3.2 },
    ];

    const merged = mergeCandidates({ exact, bm25, sourceSearch: [], semanticCacheText: [] });

    expect(merged[0].nodeId).toBe('function:src/a.ts:doThing');
    expect(merged[0].sources).toEqual(expect.arrayContaining(['exact', 'bm25']));
    // The exact-matched candidate outranks the BM25-only one even though the
    // BM25-only candidate's own raw score (3.2) is numerically larger than
    // the shared candidate's BM25 contribution (0.4) — exact identity beats
    // lexical score.
    expect(merged.map((c) => c.nodeId)).toEqual([
      'function:src/a.ts:doThing',
      'function:src/b.ts:unrelated',
    ]);
  });

  it('merges a source-search hit and a valid semantic-cache hit for the same node', () => {
    const merged = mergeCandidates({
      exact: [],
      bm25: [],
      sourceSearch: [{ nodeId: 'file:src/c.ts', path: 'src/c.ts' }],
      semanticCacheText: [{ nodeId: 'file:src/c.ts', path: 'src/c.ts', score: 1 }],
    });
    expect(merged).toHaveLength(1);
    expect(merged[0].sources.sort()).toEqual(['semantic-cache', 'source-search']);
  });

  it('is a pure deterministic function — same inputs, same output', () => {
    const args = {
      exact: [{ nodeId: 'x', path: 'p' }],
      bm25: [{ nodeId: 'y', path: 'q', score: 1.1 }],
      sourceSearch: [],
      semanticCacheText: [],
    };
    expect(mergeCandidates(args)).toEqual(mergeCandidates(args));
  });
});

// ---------------------------------------------------------------------------
// Budgeted traversal — Requirement "budgeted multi-hop traversal that reports its boundary".
//
// Fixture: a synthetic Controller -> Service -> Handler -> EventBus chain
// (all deterministic `calls` edges), per the spec's own scenario.
// ---------------------------------------------------------------------------
const CONTROLLER = 'function:src/controller.ts:handle';
const SERVICE = 'function:src/service.ts:process';
const HANDLER = 'function:src/handler.ts:onEvent';
const EVENT_BUS = 'function:src/event-bus.ts:publish';

function chainEdges() {
  return [
    { type: 'calls', source: CONTROLLER, target: SERVICE, direction: 'forward' },
    { type: 'calls', source: SERVICE, target: HANDLER, direction: 'forward' },
    { type: 'calls', source: HANDLER, target: EVENT_BUS, direction: 'forward' },
  ];
}

describe('oneHop', () => {
  it('returns only the immediate neighbors of the seed', () => {
    const result = oneHop(chainEdges(), [CONTROLLER]);
    expect(new Set(result.nodes)).toEqual(new Set([CONTROLLER, SERVICE]));
    expect(result.edges).toHaveLength(1);
    expect(result.boundary.reason).toBe('max-hops'); // 1-hop cap, more graph exists beyond it
  });
});

describe('boundedBFS — full deterministic path within budget', () => {
  it('reaches the whole Controller -> Service -> Handler -> EventBus chain within the default budget', () => {
    const result = boundedBFS(chainEdges(), [CONTROLLER], { maxHops: 4 });
    expect(new Set(result.nodes)).toEqual(new Set([CONTROLLER, SERVICE, HANDLER, EVENT_BUS]));
    expect(result.edges).toHaveLength(3);
    expect(result.boundary.reason).toBe('exhausted');
    expect(result.boundary.truncated).toBe(false);
  });
});

describe('boundedShortestPath — full deterministic path within budget', () => {
  it('returns the complete Controller -> EventBus path', () => {
    const result = boundedShortestPath(chainEdges(), [CONTROLLER], [EVENT_BUS], { maxHops: 6 });
    expect(result.path).toEqual([CONTROLLER, SERVICE, HANDLER, EVENT_BUS]);
    expect(result.edges).toHaveLength(3);
    expect(result.boundary.reason).toBe('found');
  });

  it('ignores a semantic/domain edge as a path shortcut — traversal uses only deterministic edges', () => {
    const edgesWithShortcut = [
      ...chainEdges(),
      // A "semantic-similarity" edge directly from Controller to EventBus —
      // if traversal used it, a 1-hop budget would find a (fake) path.
      { type: 'semantic-similarity', source: CONTROLLER, target: EVENT_BUS, direction: 'forward' },
    ];
    const result = boundedShortestPath(edgesWithShortcut, [CONTROLLER], [EVENT_BUS], { maxHops: 1 });
    // With maxHops=1 the REAL chain cannot reach EventBus either, so this
    // proves the shortcut edge was never consulted: the result must show the
    // path as not found within budget, not a fake 1-edge path.
    expect(result.path).toBeNull();
    expect(result.boundary.reason).toBe('max-hops');
  });
});

describe('budgeted traversal — hitting a budget stops expansion and reports the boundary', () => {
  it('verify the instrument: a generous budget finds the full chain (baseline)', () => {
    const baseline = boundedBFS(chainEdges(), [CONTROLLER], {
      maxHops: 4,
      budgets: { ...DEFAULT_TRAVERSAL_BUDGETS, maxNodes: 80 },
    });
    expect(baseline.nodes).toHaveLength(4);
    expect(baseline.boundary.truncated).toBe(false);
  });

  it('a tiny node budget truncates expansion and reports it — not a silent partial result', () => {
    const truncated = boundedBFS(chainEdges(), [CONTROLLER], {
      maxHops: 4,
      budgets: { ...DEFAULT_TRAVERSAL_BUDGETS, maxNodes: 2 },
    });
    expect(truncated.nodes.length).toBeLessThan(4);
    expect(truncated.nodes.length).toBeLessThanOrEqual(2);
    expect(truncated.boundary.truncated).toBe(true);
    expect(truncated.boundary.reason).toBe('node-budget');
    // The report must be legible enough to explain what was cut, not just a
    // boolean: it names which budget and how much of the graph was covered.
    expect(truncated.boundary.budgets.maxNodes).toBe(2);
    expect(truncated.nodes).not.toContain(EVENT_BUS);
  });

  it('a tiny edge budget truncates expansion and reports it', () => {
    const truncated = boundedBFS(chainEdges(), [CONTROLLER], {
      maxHops: 4,
      budgets: { ...DEFAULT_TRAVERSAL_BUDGETS, maxEdges: 1 },
    });
    expect(truncated.edges.length).toBeLessThanOrEqual(1);
    expect(truncated.boundary.reason).toBe('edge-budget');
    expect(truncated.boundary.truncated).toBe(true);
  });

  it('a sixth seed is cut off and reported as a visible seed-budget boundary', () => {
    const manySeeds = Array.from({ length: 6 }, (_, i) => `node:${i}`);
    const result = boundedBFS([], manySeeds, { budgets: DEFAULT_TRAVERSAL_BUDGETS });
    expect(result.boundary.reason).toBe('seed-budget');
    expect(DEFAULT_TRAVERSAL_BUDGETS.maxSeeds).toBe(5);
    expect(result.boundary.seedsUsed).toBe(5);
    expect(result.boundary.seedsRequested).toBe(6);
    expect(result.nodes).toEqual(manySeeds.slice(0, 5));
    expect(result.nodes).not.toContain(manySeeds[5]);
  });
});
