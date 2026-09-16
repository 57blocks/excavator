// Frozen red fixtures for openspec change `query-scope-routing`, task 1.2.
//
// Minimal future production API:
//   validateQueryPlan(plan) -> frozen/normalized plan or throws before execution
//   validateExecutionSelection({ plan, recallCandidates, graphNodes, selection })
//     -> exact selection or throws before traversal
//   executeQueryPlan({ plan, selection, recallCandidates, graphNodes, graphEdges,
//                      inventory, executors }) -> structured routing report
//   validateRoutingOutcome({ plan, result }) -> result or throws
//
// The dynamic import is intentionally caught. Instrument-control and legacy
// baseline tests still run while missing production policy leaves the product
// requirements red.
import { describe, expect, it, vi } from 'vitest';

import { boundedBFS, boundedShortestPath } from '../../skills/excavator/retrieve.mjs';

const routingImport = await import('../../skills/excavator/query-scope-routing.mjs')
  .then((module) => ({ module, error: null }))
  .catch((error) => ({ module: null, error }));

const LIMITS = Object.freeze({
  recallLimit: 20,
  maxSeeds: 5,
  maxNodes: 80,
  maxEdges: 160,
  maxContextTokens: 12_000,
});

const ID = Object.freeze({
  form: 'function:frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx:ArticleEditorForm()',
  service: 'function:frontend/src/services/setArticle.js:setArticle()',
  route: 'file:backend/routes/articles.js',
  create: 'function:backend/controllers/articles.js:createArticle(req,res,next)',
  model: 'file:backend/models/Article.js',
  outside: 'function:backend/controllers/comments.js:createComment(req,res,next)',
  source: 'function:src/source.ts:start()',
  target: 'function:src/target.ts:finish()',
});

const LOCAL_PLAN = Object.freeze({
  intent: 'local-condition',
  terms: Object.freeze([
    'article publish',
    'article title',
    'article description',
    'article body',
    'tagList',
    'required field',
    'createArticle',
    'setArticle',
  ]),
  recallLimit: LIMITS.recallLimit,
  primitive: 'source-first',
  hopLimit: 0,
  maxNodes: LIMITS.maxNodes,
  maxEdges: LIMITS.maxEdges,
  maxContextTokens: LIMITS.maxContextTokens,
});

const FLOW_PLAN = Object.freeze({
  intent: 'flow',
  terms: Object.freeze([
    'ArticleEditorForm',
    'setArticle',
    'api/articles',
    'createArticle',
    'Article.create',
    'Article model',
    'database persistence',
  ]),
  recallLimit: LIMITS.recallLimit,
  primitive: 'bounded-bfs',
  hopLimit: 2,
  maxNodes: LIMITS.maxNodes,
  maxEdges: LIMITS.maxEdges,
  maxContextTokens: LIMITS.maxContextTokens,
});

const INVENTORY_PLAN = Object.freeze({
  intent: 'inventory',
  terms: Object.freeze(['user flow inventory', 'frontend flow', 'backend flow']),
  recallLimit: LIMITS.recallLimit,
  primitive: 'inventory',
  hopLimit: 0,
  maxNodes: LIMITS.maxNodes,
  maxEdges: LIMITS.maxEdges,
  maxContextTokens: LIMITS.maxContextTokens,
});

const EXPLICIT_PATH_PLAN = Object.freeze({
  ...FLOW_PLAN,
  intent: 'explicit-path',
  terms: Object.freeze(['source', 'target']),
  primitive: 'bounded-shortest-path',
  hopLimit: 6,
});

const FLOW_SELECTION = Object.freeze({
  seedNodeIds: Object.freeze([ID.form, ID.route, ID.model]),
  targetNodeIds: Object.freeze([]),
});

const CURRENT_GRAPH_NODES = Object.freeze(
  [ID.form, ID.service, ID.route, ID.create, ID.model, ID.outside, ID.source, ID.target]
    .map((id) => Object.freeze({ id })),
);

const FLOW_RECALL = Object.freeze([
  ID.service,
  ID.form,
  ID.create,
  ID.route,
  ID.model,
  ID.outside,
].map((nodeId) => Object.freeze({ nodeId })));

function ids(seed, count, prefix) {
  return [seed, ...Array.from({ length: count - 1 }, (_, index) => `${prefix}:${index + 1}`)];
}

function makePassingOracleBundle() {
  return {
    local: {
      plan: structuredClone(LOCAL_PLAN),
      goldNodeIds: [ID.form, ID.service, ID.create],
      recallNodeIds: [ID.create, ID.form, ID.service, ID.model, ID.outside],
      selection: { seedNodeIds: [], targetNodeIds: [] },
      graphPrimitiveCalls: 0,
      claims: [
        {
          text: 'The UI marks title, description, and body as required.',
          scope: 'frontend',
          evidence: [{ kind: 'source', current: true, path: 'frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx' }],
        },
        {
          text: 'The create controller rejects missing title, description, and body.',
          scope: 'backend',
          evidence: [{ kind: 'source', current: true, path: 'backend/controllers/articles.js' }],
        },
      ],
    },
    flow: {
      plan: structuredClone(FLOW_PLAN),
      goldNodeIds: [ID.form, ID.route, ID.model],
      recallNodeIds: FLOW_RECALL.map(({ nodeId }) => nodeId),
      selection: structuredClone(FLOW_SELECTION),
      currentGraphNodeIds: CURRENT_GRAPH_NODES.map(({ id }) => id),
      segments: [
        {
          seedNodeIds: [ID.form],
          boundary: {
            reason: 'max-hops',
            truncated: true,
            budgets: { maxSeeds: 5, maxNodes: 80, maxEdges: 160, maxHops: 2 },
            nodesVisited: 27,
            edgesCollected: 30,
          },
          coveredNodeIds: ids(ID.form, 27, 'front'),
          uncoveredCandidateIds: [ID.outside],
          gaps: ['hop-limit'],
        },
        {
          seedNodeIds: [ID.route],
          boundary: {
            reason: 'max-hops',
            truncated: true,
            budgets: { maxSeeds: 5, maxNodes: 80, maxEdges: 160, maxHops: 2 },
            nodesVisited: 24,
            edgesCollected: 39,
          },
          coveredNodeIds: ids(ID.route, 24, 'back'),
          uncoveredCandidateIds: [ID.outside],
          gaps: ['hop-limit'],
        },
        {
          seedNodeIds: [ID.model],
          boundary: {
            reason: 'exhausted',
            truncated: false,
            budgets: { maxSeeds: 5, maxNodes: 80, maxEdges: 160, maxHops: 2 },
            nodesVisited: 1,
            edgesCollected: 0,
          },
          coveredNodeIds: [ID.model],
          uncoveredCandidateIds: [],
          gaps: [],
        },
      ],
      sourceBridges: [
        { kind: 'source-verified', from: ID.service, to: ID.route, current: true },
        { kind: 'source-verified', from: ID.create, to: ID.model, current: true },
      ],
      claims: [
        {
          text: 'The frontend POST literal maps to the mounted article route.',
          scope: 'cross-boundary',
          evidence: [
            { kind: 'source', current: true, path: 'frontend/src/services/setArticle.js' },
            { kind: 'source', current: true, path: 'backend/index.js' },
            { kind: 'source', current: true, path: 'backend/routes/articles.js' },
          ],
        },
      ],
      continuousGraphPath: null,
      directedTraversalClaim: false,
    },
    inventory: {
      plan: structuredClone(INVENTORY_PLAN),
      selection: { seedNodeIds: [], targetNodeIds: [] },
      status: 'inventory-unavailable',
      coverage: { inventoryPresent: false, stableFlowIds: [] },
      gaps: ['missing-domain-inventory'],
      fullRepositoryBfsCalls: 0,
      complete: false,
    },
  };
}

function scoreFrozenOracle(bundle) {
  const recall = [bundle.local, bundle.flow].every((item) => {
    const recalled = new Set(item.recallNodeIds);
    return item.recallNodeIds.length <= item.plan.recallLimit
      && item.goldNodeIds.every((id) => recalled.has(id));
  });

  const selectionCases = [bundle.local, bundle.flow, bundle.inventory];
  const seedSelection = selectionCases.every((item) => {
    const seeds = item.selection.seedNodeIds;
    const targets = item.selection.targetNodeIds;
    if (new Set(seeds).size !== seeds.length || new Set(targets).size !== targets.length) return false;
    if (seeds.length > LIMITS.maxSeeds) return false;
    if (['source-first', 'inventory'].includes(item.plan.primitive)) return seeds.length === 0 && targets.length === 0;
    const recalled = new Set(item.recallNodeIds ?? []);
    const current = new Set(item.currentGraphNodeIds ?? []);
    return [...seeds, ...targets].every((id) => recalled.has(id) && current.has(id));
  });

  const expectedSegments = [
    { seed: ID.form, reason: 'max-hops', truncated: true, nodes: 27, edges: 30 },
    { seed: ID.route, reason: 'max-hops', truncated: true, nodes: 24, edges: 39 },
    { seed: ID.model, reason: 'exhausted', truncated: false, nodes: 1, edges: 0 },
  ];
  const graphBoundary = bundle.local.graphPrimitiveCalls === 0
    && bundle.inventory.fullRepositoryBfsCalls === 0
    && bundle.flow.segments.length === expectedSegments.length
    && bundle.flow.segments.every((segment, index) => {
      const expected = expectedSegments[index];
      return segment.seedNodeIds.length === 1
        && segment.seedNodeIds[0] === expected.seed
        && segment.boundary.reason === expected.reason
        && segment.boundary.truncated === expected.truncated
        && segment.boundary.nodesVisited === expected.nodes
        && segment.boundary.edgesCollected === expected.edges
        && segment.boundary.budgets.maxSeeds === LIMITS.maxSeeds
        && segment.boundary.budgets.maxNodes === LIMITS.maxNodes
        && segment.boundary.budgets.maxEdges === LIMITS.maxEdges
        && segment.boundary.budgets.maxHops === FLOW_PLAN.hopLimit
        && segment.coveredNodeIds.length === expected.nodes
        && Array.isArray(segment.uncoveredCandidateIds)
        && Array.isArray(segment.gaps);
    });

  const allClaims = [...bundle.local.claims, ...bundle.flow.claims];
  const evidenceCoverage = allClaims.every((claim) => {
    if (!Array.isArray(claim.evidence) || claim.evidence.length === 0) return false;
    if (!claim.evidence.every((evidence) => evidence.current && ['fact', 'source'].includes(evidence.kind))) return false;
    if (claim.scope === 'frontend') return claim.evidence.some(({ path = '' }) => path.startsWith('frontend/'));
    if (claim.scope === 'backend') return claim.evidence.some(({ path = '' }) => path.startsWith('backend/'));
    if (claim.scope === 'cross-boundary') {
      return claim.evidence.some(({ path = '' }) => path.startsWith('frontend/'))
        && claim.evidence.some(({ path = '' }) => path.startsWith('backend/'));
    }
    return false;
  });

  const unsupportedClaims = bundle.flow.continuousGraphPath === null
    && bundle.flow.directedTraversalClaim === false
    && bundle.flow.sourceBridges.length === 2
    && bundle.flow.sourceBridges.every((bridge) => bridge.kind === 'source-verified' && bridge.current)
    && bundle.inventory.status === 'inventory-unavailable'
    && bundle.inventory.coverage.inventoryPresent === false
    && bundle.inventory.gaps.includes('missing-domain-inventory')
    && bundle.inventory.complete === false;

  return { recall, seedSelection, graphBoundary, evidenceCoverage, unsupportedClaims };
}

function expectOnlyScoreToFail(scores, expectedFailure) {
  expect(scores).toEqual({
    recall: expectedFailure !== 'recall',
    seedSelection: expectedFailure !== 'seedSelection',
    graphBoundary: expectedFailure !== 'graphBoundary',
    evidenceCoverage: expectedFailure !== 'evidenceCoverage',
    unsupportedClaims: expectedFailure !== 'unsupportedClaims',
  });
}

function getRoutingExport(exportName) {
  expect(
    routingImport.error,
    'missing production routing policy: add skills/excavator/query-scope-routing.mjs',
  ).toBeNull();
  expect(routingImport.module?.[exportName], `missing export ${exportName}`).toBeTypeOf('function');
  return routingImport.module[exportName];
}

describe('query-scope-routing — known-false controls prove each oracle score can fail independently', () => {
  it('accepts the complete frozen bundle', () => {
    expect(scoreFrozenOracle(makePassingOracleBundle())).toEqual({
      recall: true,
      seedSelection: true,
      graphBoundary: true,
      evidenceCoverage: true,
      unsupportedClaims: true,
    });
  });

  it('detects a missing top-20 gold recall identity without changing other scores', () => {
    const bundle = makePassingOracleBundle();
    bundle.local.recallNodeIds = bundle.local.recallNodeIds.filter((id) => id !== ID.create);
    expectOnlyScoreToFail(scoreFrozenOracle(bundle), 'recall');
  });

  it.each([
    ['more than five seeds', (bundle) => bundle.flow.selection.seedNodeIds.push(ID.service, ID.create, ID.outside)],
    ['a duplicate seed', (bundle) => bundle.flow.selection.seedNodeIds.push(ID.form)],
    ['an out-of-recall seed', (bundle) => bundle.flow.selection.seedNodeIds.push(ID.source)],
  ])('detects %s without changing other scores', (_name, mutate) => {
    const bundle = makePassingOracleBundle();
    mutate(bundle);
    expectOnlyScoreToFail(scoreFrozenOracle(bundle), 'seedSelection');
  });

  it('detects a falsely complete graph boundary without changing other scores', () => {
    const bundle = makePassingOracleBundle();
    bundle.flow.segments[0].boundary.truncated = false;
    expectOnlyScoreToFail(scoreFrozenOracle(bundle), 'graphBoundary');
  });

  it('detects a backend requirement supported only by frontend evidence', () => {
    const bundle = makePassingOracleBundle();
    bundle.local.claims.push({
      text: 'The server requires tags.',
      scope: 'backend',
      evidence: [{ kind: 'source', current: true, path: 'frontend/src/components/ArticleEditorForm/ArticleEditorForm.jsx' }],
    });
    expectOnlyScoreToFail(scoreFrozenOracle(bundle), 'evidenceCoverage');
  });

  it.each([
    ['a fabricated continuous cross-protocol graph path', (bundle) => { bundle.flow.continuousGraphPath = [ID.form, ID.route, ID.model]; }],
    ['a complete claim without inventory', (bundle) => { bundle.inventory.complete = true; }],
  ])('detects %s without changing other scores', (_name, mutate) => {
    const bundle = makePassingOracleBundle();
    mutate(bundle);
    expectOnlyScoreToFail(scoreFrozenOracle(bundle), 'unsupportedClaims');
  });
});

describe('query-scope-routing — current traversal policy is the red baseline', () => {
  it('executes local-condition + bounded-bfs because no query-plan gate exists', () => {
    const fakeGraph = [{ type: 'calls', source: ID.form, target: ID.service, direction: 'forward' }];
    expect(() => boundedBFS(fakeGraph, [ID.form], { maxHops: 2 })).not.toThrow();
  });

  it('accepts six and out-of-recall seeds under the legacy maxSeeds=20 policy', () => {
    const seeds = [ID.form, ID.route, ID.model, ID.service, ID.create, ID.source];
    const result = boundedBFS([], seeds);
    expect(result.boundary.reason).toBe('exhausted');
    expect(result.boundary.seedsUsed).toBe(6);
    expect(result.nodes).toContain(ID.source);
  });

  it('turns a missing shortest-path target into unreachable instead of rejecting selection', () => {
    const result = boundedShortestPath([], [ID.source], [], { maxHops: 6 });
    expect(result.boundary.reason).toBe('unreachable');
    expect(result.path).toBeNull();
  });

  it('can run one graph flood for an inventory-shaped request because no inventory gate exists', () => {
    const graph = [{ type: 'calls', source: ID.source, target: ID.target, direction: 'forward' }];
    const result = boundedBFS(graph, [ID.source], { maxHops: 4 });
    expect(result.nodes).toContain(ID.target);
  });
});

describe('query-scope-routing — production policy requirements (red until implementation)', () => {
  it('rejects local-condition + bounded-bfs before any executor runs', () => {
    const validateQueryPlan = getRoutingExport('validateQueryPlan');
    const invalidPlan = { ...LOCAL_PLAN, primitive: 'bounded-bfs', hopLimit: 2 };
    expect(() => validateQueryPlan(invalidPlan)).toThrow(/incompatible/i);
  });

  it.each([
    [
      'more than five seeds',
      { seedNodeIds: [ID.form, ID.route, ID.model, ID.service, ID.create, ID.outside], targetNodeIds: [] },
      /seed.*5|5.*seed/i,
    ],
    [
      'an out-of-recall seed',
      { seedNodeIds: [ID.form, ID.route, ID.model, ID.source], targetNodeIds: [] },
      /recall/i,
    ],
  ])('rejects %s before traversal', (_name, selection, message) => {
    const validateExecutionSelection = getRoutingExport('validateExecutionSelection');
    expect(() => validateExecutionSelection({
      plan: FLOW_PLAN,
      recallCandidates: FLOW_RECALL,
      graphNodes: CURRENT_GRAPH_NODES,
      selection,
    })).toThrow(message);
  });

  it('rejects shortest path without targets before traversal', () => {
    const validateExecutionSelection = getRoutingExport('validateExecutionSelection');
    expect(() => validateExecutionSelection({
      plan: EXPLICIT_PATH_PLAN,
      recallCandidates: [{ nodeId: ID.source }, { nodeId: ID.target }],
      graphNodes: CURRENT_GRAPH_NODES,
      selection: { seedNodeIds: [ID.source], targetNodeIds: [] },
    })).toThrow(/target/i);
  });

  it('rejects a fabricated continuous cross-protocol graph path', () => {
    const validateRoutingOutcome = getRoutingExport('validateRoutingOutcome');
    const result = makePassingOracleBundle().flow;
    result.continuousGraphPath = [ID.form, ID.route, ID.model];
    expect(() => validateRoutingOutcome({ plan: FLOW_PLAN, result })).toThrow(/continuous|bridge|path/i);
  });

  it('returns inventory-unavailable without calling BFS when Domain inventory is absent', () => {
    const executeQueryPlan = getRoutingExport('executeQueryPlan');
    const bfs = vi.fn(() => {
      throw new Error('inventory must not execute BFS');
    });
    const report = executeQueryPlan({
      plan: INVENTORY_PLAN,
      selection: { seedNodeIds: [], targetNodeIds: [] },
      recallCandidates: [],
      graphNodes: CURRENT_GRAPH_NODES,
      graphEdges: [],
      inventory: null,
      executors: { boundedBFS: bfs },
    });
    expect(bfs).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      status: 'inventory-unavailable',
      coverage: { inventoryPresent: false, stableFlowIds: [] },
      gaps: ['missing-domain-inventory'],
      complete: false,
      fullRepositoryBfsCalls: 0,
    });
  });
});

describe('query-scope-routing — closed query-plan validator and dispatch', () => {
  it.each([
    ['inventory', 'inventory', 0],
    ['local-condition', 'source-first', 0],
    ['local-condition', 'one-hop', 1],
    ['explicit-path', 'bounded-shortest-path', 6],
    ['direct-neighbor', 'one-hop', 1],
    ['flow', 'bounded-bfs', 2],
    ['source-locate', 'source-first', 0],
  ])('accepts %s -> %s', (intent, primitive, hopLimit) => {
    const validateQueryPlan = getRoutingExport('validateQueryPlan');
    const candidate = { ...LOCAL_PLAN, intent, primitive, hopLimit };
    const validated = validateQueryPlan(candidate);
    expect(validated).toEqual(candidate);
    expect(validated).not.toBe(candidate);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.terms)).toBe(true);
  });

  it.each([
    ['unknown intent', { ...LOCAL_PLAN, intent: 'topic' }, /unknown query intent/i],
    ['unknown primitive', { ...LOCAL_PLAN, primitive: 'graph-walk' }, /unknown query primitive/i],
    ['incompatible pair', { ...LOCAL_PLAN, primitive: 'bounded-bfs', hopLimit: 2 }, /incompatible/i],
    ['recall above 20', { ...LOCAL_PLAN, recallLimit: 21 }, /recallLimit.*20/i],
    ['nodes above 80', { ...LOCAL_PLAN, maxNodes: 81 }, /maxNodes.*80/i],
    ['edges above 160', { ...LOCAL_PLAN, maxEdges: 161 }, /maxEdges.*160/i],
    ['context above 12000', { ...LOCAL_PLAN, maxContextTokens: 12_001 }, /maxContextTokens.*12000/i],
    ['shortest path above 6 hops', { ...EXPLICIT_PATH_PLAN, hopLimit: 7 }, /hopLimit.*6/i],
    ['empty terms', { ...LOCAL_PLAN, terms: [] }, /terms.*non-empty/i],
  ])('rejects %s', (_name, candidate, message) => {
    const validateQueryPlan = getRoutingExport('validateQueryPlan');
    expect(() => validateQueryPlan(candidate)).toThrow(message);
  });

  it('rejects an invalid plan before reading graph inputs or calling an executor', () => {
    const executeQueryPlan = getRoutingExport('executeQueryPlan');
    const boundedBFSExecutor = vi.fn();
    const input = {
      plan: { ...LOCAL_PLAN, primitive: 'bounded-bfs', hopLimit: 2 },
      executors: { boundedBFS: boundedBFSExecutor },
      get graphEdges() {
        throw new Error('graph must not be read');
      },
    };
    expect(() => executeQueryPlan(input)).toThrow(/incompatible/i);
    expect(boundedBFSExecutor).not.toHaveBeenCalled();
  });

  it('dispatches a valid plan to exactly one selected executor', () => {
    const executeQueryPlan = getRoutingExport('executeQueryPlan');
    const sourceFirst = vi.fn(({ plan, graphEdges }) => ({ primitive: plan.primitive, graphEdges }));
    const boundedBFSExecutor = vi.fn();
    const result = executeQueryPlan({
      plan: LOCAL_PLAN,
      selection: { seedNodeIds: [], targetNodeIds: [] },
      recallCandidates: FLOW_RECALL,
      graphNodes: CURRENT_GRAPH_NODES,
      graphEdges: [{ type: 'calls', source: ID.form, target: ID.service }],
      executors: { sourceFirst, boundedBFS: boundedBFSExecutor },
    });
    expect(result).toEqual({
      primitive: 'source-first',
      graphEdges: [{ type: 'calls', source: ID.form, target: ID.service }],
    });
    expect(sourceFirst).toHaveBeenCalledOnce();
    expect(boundedBFSExecutor).not.toHaveBeenCalled();
  });
});
