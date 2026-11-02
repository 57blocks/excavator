/**
 * The two verifiers of a part (design D14): an item is verified only when both
 * say `verified`; `contradicted` when either says so; `unverified` otherwise.
 * The reason kept is that of a verdict that is not `verified`: the
 * `contradicted` one when there is one, else `a`'s when it is not verified,
 * else `b`'s. When both are `verified` no reason is shown to anyone, so `a`'s
 * stands in.
 */

/** The verdict `{ id, verdict, reason }` of an item from the verdicts `a` and `b` of its two verifiers. */
export function combineVerdicts(a, b) {
  const pair = [a, b];
  const kept = pair.find((one) => one.verdict === 'contradicted') ?? pair.find((one) => one.verdict !== 'verified') ?? a;
  return { id: a.id, verdict: kept.verdict, reason: kept.reason };
}
