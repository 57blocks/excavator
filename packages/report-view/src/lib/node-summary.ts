/**
 * What the page says about a node's summary (openspec: changes/viewer-app,
 * design D11; spec "Source of summaries, tags and layers"). The text and tags
 * come from the merged index; this module decides how they are shown:
 *   - a verified or unverified summary is shown with that word;
 *   - a summary with no verdict is shown as unchecked;
 *   - a contradicted summary is never shown: the page says so in its place;
 *   - a node with no summary from any source says so.
 * The sidebar and any list of nodes use this one function.
 */

import type { GraphIndex } from '../data/indexes';
import type { TextSource } from '../data/semantics';

export const CONTRADICTED_NOTICE = 'This summary disagrees with the source and is not shown.';
export const NO_SUMMARY_NOTICE = 'This node has no summary.';

const VERDICT_LABELS: Record<string, string> = {
  verified: 'Verified',
  unverified: 'Unverified',
  contradicted: 'Contradicted',
  unchecked: 'Unchecked',
};

export interface NodeSummaryView {
  /** The summary to show; null when none is shown (see `notice`). */
  text: string | null;
  /** The sentence shown where the summary would be, when `text` is null. */
  notice: string | null;
  /** `verified`, `unverified`, `contradicted`, `unchecked`, or another value the verifier wrote, as written. */
  verdict: string;
  verdictLabel: string;
  tags: string[];
  source: TextSource;
}

/** The summary of node `nodeId` as the page shows it; null when the graph has no such node. */
export function nodeSummaryView(index: GraphIndex, nodeId: string): NodeSummaryView | null {
  const merged = index.semantics.byNode.get(nodeId);
  if (!merged) return null;
  const verdict = merged.verification ?? 'unchecked';
  const verdictLabel = Object.hasOwn(VERDICT_LABELS, verdict) ? VERDICT_LABELS[verdict] : verdict;
  // Checked again here, not only in the merge: whatever reaches this function, a contradicted summary does not leave it.
  if (verdict === 'contradicted') {
    return { text: null, notice: CONTRADICTED_NOTICE, verdict, verdictLabel, tags: merged.tags, source: merged.source };
  }
  if (merged.summary === '') {
    return { text: null, notice: NO_SUMMARY_NOTICE, verdict, verdictLabel, tags: merged.tags, source: merged.source };
  }
  return { text: merged.summary, notice: null, verdict, verdictLabel, tags: merged.tags, source: merged.source };
}
