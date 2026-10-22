/**
 * tour-check.mjs
 *
 * The structure rules of a tour the model wrote (openspec: changes/tour-product,
 * capability `learning-tour`, requirement "tour structure"). A pure function over
 * the draft and the candidate ids; the command prints every problem it finds, not
 * the first, so the model can fix them in one pass.
 *
 *   5 to 15 steps, `order` running 1..n without gap or repeat, listed in order;
 *   per step: `title` (at most 60 characters), `description` (2 to 5 sentences),
 *   `nodeIds` (1 to 5 distinct ids, each in the candidate set), and an optional
 *   `languageLesson` (at most 3 sentences).
 * Sentences are counted with the splitter `slices` uses.
 */

import { splitSentences } from './tour-sentences.mjs';

export const LIMITS = Object.freeze({
  minSteps: 5,
  maxSteps: 15,
  titleChars: 60,
  minDescription: 2,
  maxDescription: 5,
  minNodes: 1,
  maxNodes: 5,
  maxLesson: 3,
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = (values) => values.join(', ');

function checkOrders(steps, issues) {
  const orders = steps.map((step) => step.order);
  if (!orders.every((order) => Number.isInteger(order) && order >= 1)) {
    issues.push('every step needs an integer order of at least 1');
    return;
  }
  const n = steps.length;
  const seen = new Set(orders);
  const missing = Array.from({ length: n }, (_, i) => i + 1).filter((order) => !seen.has(order));
  const unexpected = [...seen].filter((order) => order > n).sort((a, b) => a - b);
  const repeated = [...new Set(orders.filter((order, i) => orders.indexOf(order) !== i))].sort((a, b) => a - b);
  const parts = [];
  if (missing.length > 0) parts.push(`missing ${list(missing)}`);
  if (unexpected.length > 0) parts.push(`unexpected ${list(unexpected)}`);
  if (repeated.length > 0) parts.push(`repeated ${list(repeated)}`);
  if (parts.length > 0) issues.push(`step orders must run 1..${n} without a gap or a repeat: ${parts.join('; ')} (found ${list(orders)})`);
  else if (orders.some((order, i) => order !== i + 1)) issues.push(`steps must be listed in order, but the orders are ${list(orders)}`);
}

function checkStep(step, label, candidateIds, issues) {
  if (typeof step.title !== 'string' || step.title.trim() === '') issues.push(`${label}: title must be a non-empty string`);
  else if ([...step.title].length > LIMITS.titleChars) issues.push(`${label}: title has ${[...step.title].length} characters; the limit is ${LIMITS.titleChars}`);

  if (typeof step.description !== 'string') issues.push(`${label}: description must be a string`);
  else {
    const count = splitSentences(step.description).length;
    if (count < LIMITS.minDescription || count > LIMITS.maxDescription) {
      issues.push(`${label}: description has ${count} sentence(s); it needs ${LIMITS.minDescription} to ${LIMITS.maxDescription}`);
    }
  }

  if (step.languageLesson !== undefined) {
    if (typeof step.languageLesson !== 'string' || step.languageLesson.trim() === '') issues.push(`${label}: languageLesson must be a non-empty string when present`);
    else {
      const count = splitSentences(step.languageLesson).length;
      if (count > LIMITS.maxLesson) issues.push(`${label}: languageLesson has ${count} sentence(s); the limit is ${LIMITS.maxLesson}`);
    }
  }

  if (!Array.isArray(step.nodeIds) || !step.nodeIds.every((id) => typeof id === 'string')) {
    issues.push(`${label}: nodeIds must be an array of strings`);
    return;
  }
  if (step.nodeIds.length < LIMITS.minNodes || step.nodeIds.length > LIMITS.maxNodes) {
    issues.push(`${label}: nodeIds has ${step.nodeIds.length} id(s); it needs ${LIMITS.minNodes} to ${LIMITS.maxNodes}`);
  }
  for (const id of new Set(step.nodeIds.filter((value, i) => step.nodeIds.indexOf(value) !== i))) issues.push(`${label}: nodeIds repeats ${JSON.stringify(id)}`);
  for (const id of new Set(step.nodeIds)) {
    if (!candidateIds.has(id)) issues.push(`${label}: nodeIds contains ${JSON.stringify(id)}, which is not in the candidate set`);
  }
}

/**
 * @param {unknown} draft the parsed draft
 * @param {Set<string>} candidateIds the ids in candidates.json
 * @returns {string[]} the problems, in a stable order; empty when the draft passes
 */
export function checkDraft(draft, candidateIds) {
  if (!isObject(draft) || !Array.isArray(draft.steps)) return ['the draft must be an object with a steps array'];
  const issues = [];
  if (draft.contentLanguage !== undefined && (typeof draft.contentLanguage !== 'string' || draft.contentLanguage.trim() === '')) {
    issues.push('contentLanguage must be a non-empty string when present');
  }
  const { steps } = draft;
  if (steps.length < LIMITS.minSteps || steps.length > LIMITS.maxSteps) {
    issues.push(`the tour has ${steps.length} step(s); it needs ${LIMITS.minSteps} to ${LIMITS.maxSteps}`);
  }
  const bad = steps.findIndex((step) => !isObject(step));
  if (bad !== -1) {
    issues.push(`the step at position ${bad + 1} is not an object`);
    return issues;
  }
  checkOrders(steps, issues);
  steps.forEach((step, i) => checkStep(step, Number.isInteger(step.order) ? `step ${step.order}` : `step at position ${i + 1}`, candidateIds, issues));
  return issues;
}
