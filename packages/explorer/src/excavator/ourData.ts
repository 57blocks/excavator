import type { GraphCoverage, GraphEdge, GraphNode } from "../core/types";

/**
 * Readers for the fields our graph has and the copy did not show (openspec:
 * changes/viewer-explorer, design D4b): a node's verdict, an edge's evidence and
 * the extraction's coverage record. Each reads only what the data says; a field
 * that is absent or not in the expected shape reads as nothing.
 */

export type Verdict = "verified" | "unverified" | "contradicted";

const VERDICTS: ReadonlySet<string> = new Set<Verdict>(["verified", "unverified", "contradicted"]);

/** The verifier's verdict on the node's summary, or null when it was not checked. */
export function verdictOf(node: GraphNode): Verdict | null {
  return typeof node.verification === "string" && VERDICTS.has(node.verification) ? (node.verification as Verdict) : null;
}

/** True when the summary is empty because the verifier found the source contradicts it. */
export function summaryRemoved(node: GraphNode): boolean {
  return node.summary === "" && verdictOf(node) === "contradicted";
}

/** `file:line` (or `file:line-endLine`) of the edge's first evidence, or null when it has none. */
export function evidenceLabel(edge: GraphEdge): string | null {
  const first = Array.isArray(edge.evidence) ? edge.evidence[0] : undefined;
  if (!first || typeof first.file !== "string") return null;
  if (typeof first.line !== "number") return first.file;
  const end = typeof first.endLine === "number" && first.endLine !== first.line ? `-${first.endLine}` : "";
  return `${first.file}:${first.line}${end}`;
}

export interface CoverageRow {
  language: string;
  files: number;
  parsed: number;
  zeroSymbol: number;
  /** Each reason a file was skipped, with its count, most first; reasons with no file are left out. */
  skipped: [string, number][];
}

/** One row per language of the coverage record, most files first, then by name. */
export function coverageRows(coverage: GraphCoverage | undefined): CoverageRow[] {
  if (!coverage) return [];
  return Object.entries(coverage.byLanguage)
    .map(([language, row]) => ({
      language,
      files: row.files,
      parsed: row.parsed,
      zeroSymbol: row.zeroSymbol,
      skipped: Object.entries(row.skipped)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    }))
    .sort((a, b) => b.files - a.files || a.language.localeCompare(b.language));
}
