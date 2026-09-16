/**
 * Request-local query-scope policy.
 *
 * The host agent supplies semantic intent and English retrieval terms. This
 * module does not classify natural language. It only validates the closed
 * plan schema and dispatches a validated plan to the selected executor.
 * Selection identity validation and structured boundary/outcome validation
 * are layered onto this module by the later query-scope-routing tasks.
 */

export const QUERY_INTENTS = Object.freeze([
  'inventory',
  'local-condition',
  'explicit-path',
  'direct-neighbor',
  'flow',
  'source-locate',
]);

export const QUERY_PRIMITIVES = Object.freeze([
  'inventory',
  'source-first',
  'one-hop',
  'bounded-bfs',
  'bounded-shortest-path',
]);

export const QUERY_PLAN_LIMITS = Object.freeze({
  recallLimit: 20,
  maxNodes: 80,
  maxEdges: 160,
  maxContextTokens: 12_000,
  maxShortestPathHops: 6,
});

export const INTENT_PRIMITIVES = Object.freeze({
  inventory: Object.freeze(['inventory']),
  'local-condition': Object.freeze(['source-first', 'one-hop']),
  'explicit-path': Object.freeze(['bounded-shortest-path']),
  'direct-neighbor': Object.freeze(['one-hop']),
  flow: Object.freeze(['bounded-bfs']),
  'source-locate': Object.freeze(['source-first']),
});

const PLAN_FIELDS = Object.freeze([
  'intent',
  'terms',
  'recallLimit',
  'primitive',
  'hopLimit',
  'maxNodes',
  'maxEdges',
  'maxContextTokens',
]);

const EXECUTOR_BY_PRIMITIVE = Object.freeze({
  inventory: 'inventory',
  'source-first': 'sourceFirst',
  'one-hop': 'oneHop',
  'bounded-bfs': 'boundedBFS',
  'bounded-shortest-path': 'boundedShortestPath',
});

export class QueryPlanValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'QueryPlanValidationError';
    this.code = code;
  }
}

function reject(code, message) {
  throw new QueryPlanValidationError(code, message);
}

function requireIntegerInRange(value, field, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    reject('invalid-budget', `${field} must be an integer from ${minimum} through ${maximum}`);
  }
}

/**
 * Validate the complete request-local plan before any graph access.
 *
 * @param {object} candidate
 * @returns {Readonly<object>} a detached, shallow-frozen plan with frozen terms
 */
export function validateQueryPlan(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    reject('invalid-plan', 'query plan must be an object');
  }

  const candidateFields = Object.keys(candidate);
  const missing = PLAN_FIELDS.filter((field) => !Object.hasOwn(candidate, field));
  if (missing.length > 0) {
    reject('missing-field', `query plan is missing fields: ${missing.join(', ')}`);
  }
  const unknown = candidateFields.filter((field) => !PLAN_FIELDS.includes(field));
  if (unknown.length > 0) {
    reject('unknown-field', `query plan has unknown fields: ${unknown.join(', ')}`);
  }

  const { intent, primitive } = candidate;
  if (!QUERY_INTENTS.includes(intent)) {
    reject('unknown-intent', `unknown query intent: ${String(intent)}`);
  }
  if (!QUERY_PRIMITIVES.includes(primitive)) {
    reject('unknown-primitive', `unknown query primitive: ${String(primitive)}`);
  }
  if (!INTENT_PRIMITIVES[intent].includes(primitive)) {
    reject('incompatible-intent-primitive', `incompatible intent/primitive pair: ${intent} + ${primitive}`);
  }

  if (!Array.isArray(candidate.terms) || candidate.terms.length === 0) {
    reject('invalid-terms', 'terms must be a non-empty array of English retrieval expressions or source literals');
  }
  if (candidate.terms.some((term) => typeof term !== 'string' || term.trim().length === 0)) {
    reject('invalid-terms', 'every retrieval term must be a non-empty string');
  }

  requireIntegerInRange(candidate.recallLimit, 'recallLimit', 1, QUERY_PLAN_LIMITS.recallLimit);
  requireIntegerInRange(candidate.maxNodes, 'maxNodes', 1, QUERY_PLAN_LIMITS.maxNodes);
  requireIntegerInRange(candidate.maxEdges, 'maxEdges', 1, QUERY_PLAN_LIMITS.maxEdges);
  requireIntegerInRange(
    candidate.maxContextTokens,
    'maxContextTokens',
    1,
    QUERY_PLAN_LIMITS.maxContextTokens,
  );
  requireIntegerInRange(candidate.hopLimit, 'hopLimit', 0, QUERY_PLAN_LIMITS.maxShortestPathHops);

  if (['inventory', 'source-first'].includes(primitive) && candidate.hopLimit !== 0) {
    reject('invalid-hop-limit', `${primitive} requires hopLimit=0`);
  }
  if (primitive === 'one-hop' && candidate.hopLimit !== 1) {
    reject('invalid-hop-limit', 'one-hop requires hopLimit=1');
  }
  if (['bounded-bfs', 'bounded-shortest-path'].includes(primitive) && candidate.hopLimit < 1) {
    reject('invalid-hop-limit', `${primitive} requires a positive hopLimit`);
  }
  if (
    primitive === 'bounded-shortest-path'
    && candidate.hopLimit > QUERY_PLAN_LIMITS.maxShortestPathHops
  ) {
    reject(
      'invalid-hop-limit',
      `bounded-shortest-path hopLimit must not exceed ${QUERY_PLAN_LIMITS.maxShortestPathHops}`,
    );
  }

  return Object.freeze({
    intent,
    terms: Object.freeze([...candidate.terms]),
    recallLimit: candidate.recallLimit,
    primitive,
    hopLimit: candidate.hopLimit,
    maxNodes: candidate.maxNodes,
    maxEdges: candidate.maxEdges,
    maxContextTokens: candidate.maxContextTokens,
  });
}

/**
 * Validate first, then dispatch to the one executor named by the primitive.
 * Invalid plans never read graph inputs or call an executor.
 *
 * @param {object} input
 * @returns {*} executor result
 */
export function executeQueryPlan(input = {}) {
  const plan = validateQueryPlan(input.plan);
  const executorName = EXECUTOR_BY_PRIMITIVE[plan.primitive];
  const executor = input.executors?.[executorName];
  if (typeof executor !== 'function') {
    throw new Error(`missing query executor for ${plan.primitive}: executors.${executorName}`);
  }

  return executor({
    plan,
    selection: input.selection,
    recallCandidates: input.recallCandidates,
    graphNodes: input.graphNodes,
    graphEdges: input.graphEdges,
    inventory: input.inventory,
  });
}
