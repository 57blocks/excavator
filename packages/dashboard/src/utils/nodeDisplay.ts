/**
 * What to show for a node whose summary is empty.
 *
 * `summary` became optional-in-practice with the evidence model: a file whose
 * language has no reader, or a node whose summary a verifier could not check,
 * can legitimately arrive with `""`. Rendering that empty string leaves a
 * blank block where a name should be, which reads as a broken dashboard rather
 * than as an honest absence.
 *
 * The fallback is the node's own name — never invented prose, and never a
 * placeholder sentence like "No summary available" that a reader could mistake
 * for a description of the code.
 */
export function displaySummary(
  summary: string | undefined | null,
  name: string | undefined | null,
): string {
  const text = typeof summary === "string" ? summary.trim() : "";
  if (text.length > 0) return text;
  const fallback = typeof name === "string" ? name.trim() : "";
  return fallback;
}

/** Does this node have a summary of its own, as opposed to a name fallback? */
export function hasSummary(summary: string | undefined | null): boolean {
  return typeof summary === "string" && summary.trim().length > 0;
}
