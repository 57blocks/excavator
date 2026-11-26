import { joinChecks, type DocMapCheck } from "./products/docmap";
import { unitFiles } from "./products/docmap-charts";
import { coChanged } from "./products/hotspots-charts";
import { unusedCandidates } from "./overview";

/** The facts about one node that the product pages used to show: its file's history, unused code, and documents. */

type Table = Record<string, unknown>;

const isTable = (value: unknown): value is Table => typeof value === "object" && value !== null && !Array.isArray(value);
const listOf = (value: unknown): Table[] => (Array.isArray(value) ? value.filter(isTable) : []);
const numberOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

export interface FileHotspot {
  commits: number | null;
  authors: number | null;
  lastChanged: string | null;
  /** 1-based position by score over every scored file; null for a file without a score. */
  rank: number | null;
}

export function hotspotOfFile(hotspotsProduct: unknown, filePath: string): FileHotspot | null {
  if (!isTable(hotspotsProduct)) return null;
  const files = listOf(hotspotsProduct.files);
  const row = files.find((f) => f.path === filePath);
  if (!row) return null;
  const score = numberOrNull(row.score);
  const rank = score === null ? null : 1 + files.filter((f) => {
    const other = numberOrNull(f.score);
    return other !== null && (other > score || (other === score && typeof f.path === "string" && f.path < filePath));
  }).length;
  return {
    commits: numberOrNull(row.commits),
    authors: numberOrNull(row.authors),
    lastChanged: typeof row.lastChanged === "string" ? row.lastChanged : null,
    rank,
  };
}

/** The files most often changed together with `filePath`, most first. */
export function coChangedFiles(hotspotsProduct: unknown, filePath: string, n: number): { path: string; together: number }[] {
  if (!isTable(hotspotsProduct)) return [];
  return coChanged(hotspotsProduct.pairs, filePath, n);
}

export interface NodeUnused {
  id: string;
  name: string | null;
  line: number | null;
  confidence: string | null;
  reason: string | null;
}

/**
 * The unused-code candidates of a node: for a file node every candidate in the file (by line), for any other
 * node the candidate with the node's id.
 */
export function unusedOfNode(unusedProduct: unknown, node: { id: string; type: string; filePath?: string }): NodeUnused[] {
  const rows = unusedCandidates(unusedProduct);
  const matching = node.type === "file"
    ? node.filePath === undefined ? [] : rows.filter((r) => r.file === node.filePath).sort((a, b) => (a.lineRange?.[0] ?? Infinity) - (b.lineRange?.[0] ?? Infinity))
    : rows.filter((r) => r.id === node.id);
  return matching.map((r) => ({ id: r.id, name: r.name, line: r.lineRange?.[0] ?? null, confidence: r.confidence, reason: r.reason }));
}

export interface DocUnit {
  document: string | null;
  id: string | null;
  title: string | null;
  verdict: string | null;
}

/** The units of the doc map whose evidence cites `filePath`, with the verdict text of their checks. */
export function docUnitsCitingFile(docMap: unknown, checks: unknown, filePath: string): DocUnit[] {
  if (!isTable(docMap)) return [];
  const list = Array.isArray(checks) ? checks : isTable(checks) && Array.isArray(checks.checks) ? checks.checks : null;
  const joined = joinChecks(listOf(docMap.units), list as DocMapCheck[] | null);
  return joined.rows
    .filter((row) => unitFiles(row).includes(filePath))
    .map((row) => ({ document: row.document, id: row.id, title: row.title, verdict: row.verdictText }));
}
