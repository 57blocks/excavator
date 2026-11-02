/**
 * The two verifiers of a part (design D14): an item is verified only when both
 * say `verified`; `contradicted` when either says so; `unverified` otherwise.
 * The reason kept is that of a verdict that is not `verified`: the
 * `contradicted` one when there is one, else `a`'s when it is not verified,
 * else `b`'s. When both are `verified` no reason is shown to anyone, so `a`'s
 * stands in.
 *
 * The two tracers of a part (handbook-dual-tracer): an item is `contradicted`
 * when either says so, `holds` otherwise.
 */

/** The verdict `{ id, verdict, reason }` of an item from the verdicts `a` and `b` of its two verifiers. */
export function combineVerdicts(a, b) {
  const pair = [a, b];
  const kept = pair.find((one) => one.verdict === 'contradicted') ?? pair.find((one) => one.verdict !== 'verified') ?? a;
  return { id: a.id, verdict: kept.verdict, reason: kept.reason };
}

/**
 * The verdict `{ id, verdict, reason, reasons, at }` of a traced item from the
 * verdicts `a` and `b` of its two tracers (`{ id, verdict, reason, at? }`).
 * `reason` is that of the first tracer in letter order that says `contradicted`
 * (the one reason a reader sees), `reasons` that of every such tracer in letter
 * order, `at` the positions of every such tracer, `a`'s first, each as
 * `{ file, line }`, a position two tracers gave once. When both say `holds`,
 * no reason is shown to anyone, so `a`'s stands in and `reasons` and `at` are empty.
 */
export function combineTraceVerdicts(a, b) {
  const contradicting = [a, b].filter((one) => one.verdict === 'contradicted');
  if (contradicting.length === 0) return { id: a.id, verdict: 'holds', reason: a.reason.trim(), reasons: [], at: [] };
  const at = [];
  for (const { file, line } of contradicting.flatMap((one) => one.at)) {
    if (!at.some((seen) => seen.file === file && seen.line === line)) at.push({ file, line });
  }
  const reasons = contradicting.map((one) => one.reason.trim());
  return { id: a.id, verdict: 'contradicted', reason: reasons[0], reasons, at };
}
