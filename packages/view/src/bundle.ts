// The page decodes with the same codec the bake script encodes with: one
// implementation, imported by relative path and bundled by Vite.
import { decodeBundle, isTable } from '../../../skills/excavator-view/bundle-codec.mjs';

export const DATA_ELEMENT_ID = 'excavator-view-data';

export interface BundleCounts {
  segments: number;
  nodes: number;
  edges: number;
  evidence: number;
  gaps: number;
}

function tableRows(value: unknown): number {
  return isTable(value) ? (value as { rows: number }).rows : 0;
}

/** Decode the embedded payload; `null` when the placeholder is empty (an unbaked template). */
export async function readEmbeddedBundle(): Promise<BundleCounts | null> {
  const payload = document.getElementById(DATA_ELEMENT_ID)?.textContent ?? '';
  if (payload.trim() === '') return null;
  const { segments } = await decodeBundle(payload);
  return {
    segments: Object.keys(segments).length,
    nodes: tableRows(segments.nodes),
    edges: tableRows(segments.edges),
    evidence: tableRows(segments.evidence),
    gaps: Array.isArray(segments.gaps) ? segments.gaps.length : 0,
  };
}
