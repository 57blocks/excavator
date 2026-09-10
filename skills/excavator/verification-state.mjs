/**
 * verification-state.mjs
 *
 * The node `verification` field has exactly four values and one merge rule.
 * Both phases that write it — ANNOTATE (2.3, freshness) and the verification
 * write-back (2.5, summaries) — import them from here, so "no fourth state"
 * is a property of one module rather than a convention two scripts happen to
 * share.
 *
 * The merge rule is: a later writer never DOWNGRADES an earlier marking.
 * Without it, a `verified` summary verdict would erase the `dirty` marking
 * annotate had put on the same node for having changed since it was analysed,
 * and the graph would claim a checked, current summary for stale code.
 *
 * No model, no I/O: pure functions over strings.
 */

/** Severity order. Higher wins a merge. */
export const VERIFICATION_SEVERITY = Object.freeze({
  verified: 0,
  unverified: 1,
  dirty: 2,
  contradicted: 3,
});

/** The only values the field may hold. */
export const VERIFICATION_STATES = Object.freeze(Object.keys(VERIFICATION_SEVERITY));

/** Is this a value the field is allowed to hold at all? */
export function isVerificationState(value) {
  return typeof value === 'string' && Object.hasOwn(VERIFICATION_SEVERITY, value);
}

/**
 * Merge an existing marking with a new one.
 *
 * @returns {{value: string, preserved: boolean}} `value` is what the field
 * should become; `preserved` is true when the existing marking outranked the
 * new one, so the caller can count how often a write was held back rather
 * than let it happen invisibly.
 */
export function mergeVerification(existing, next) {
  if (!isVerificationState(next)) {
    throw new Error(`mergeVerification: "${next}" is not one of ${VERIFICATION_STATES.join('/')}`);
  }
  if (!isVerificationState(existing)) return { value: next, preserved: false };
  if (VERIFICATION_SEVERITY[existing] > VERIFICATION_SEVERITY[next]) {
    return { value: existing, preserved: true };
  }
  return { value: next, preserved: false };
}

export default { VERIFICATION_SEVERITY, VERIFICATION_STATES, isVerificationState, mergeVerification };
