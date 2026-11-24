import type { KnowledgeGraph } from "../core/types";
import { domainTitle, type Translate } from "./nameTranslations";
import { externalLabel, unitsOf, type UnitInfo } from "./products/relations";
import { topFiles } from "./products/hotspots-charts";
import { normalizeRow, type UnusedRow } from "./products/unused";

/**
 * The facts the right panel's overview shows, read from the graphs and the products the page holds. Every
 * function is pure: a product that is missing or not in the expected shape gives an empty list or null,
 * and the caller says which product state that is (the page never writes its own text).
 */

type Table = Record<string, unknown>;

const isTable = (value: unknown): value is Table => typeof value === "object" && value !== null && !Array.isArray(value);
const listOf = (value: unknown): Table[] => (Array.isArray(value) ? value.filter(isTable) : []);
const numberOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const stringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

/**
 * One spelling per case-insensitive (trimmed) value, in first-occurrence order. When the spellings differ the
 * one with an uppercase letter is kept ("express" and "Express" give "Express"). Empty strings are dropped.
 */
export function dedupeCaseVariants(values: readonly string[]): string[] {
  const kept = new Map<string, string>();
  for (const raw of values) {
    const value = raw.trim();
    if (value === "") continue;
    const key = value.toLowerCase();
    const current = kept.get(key);
    if (current === undefined || (!/[A-Z]/.test(current) && /[A-Z]/.test(value))) kept.set(key, value);
  }
  return [...kept.values()];
}

/**
 * The project introduction. This is the one seam where a later change will let the domain planner's written
 * introduction take precedence; today it reads only the knowledge graph's `project.description`, and the page
 * never writes its own text. `text` is null when the description is empty or missing.
 */
export function projectIntroduction(
  graph: KnowledgeGraph | null,
  _domainGraph: KnowledgeGraph | null,
): { text: string | null; source: "knowledge-graph" } {
  const text = typeof graph?.project?.description === "string" ? graph.project.description.trim() : "";
  return { text: text === "" ? null : text, source: "knowledge-graph" };
}

export type DomainKind = "business" | "support";

export interface DomainRow {
  id: string;
  label: string;
  /** The English name when `label` is a translation, else null. */
  original: string | null;
  /** The first line of the node's summary, trimmed; empty when the node has none. */
  summary: string;
  kind: DomainKind | null;
}

const KIND_ORDER: Record<string, number> = { business: 0, support: 1 };

/** The domain nodes of the domain graph: business first, then support, then no kind, each in product order. */
export function domainList(domainGraph: KnowledgeGraph | null, translate?: Translate): DomainRow[] {
  const rows: DomainRow[] = [];
  for (const node of domainGraph?.nodes ?? []) {
    if (node.type !== "domain") continue;
    const kind = (node.domainMeta as Table | undefined)?.kind;
    const { label, original } = domainTitle(node.name, translate);
    rows.push({
      id: node.id,
      label,
      original,
      summary: (node.summary ?? "").split("\n")[0].trim(),
      kind: kind === "business" || kind === "support" ? kind : null,
    });
  }
  const rank = (row: DomainRow) => (row.kind === null ? 2 : KIND_ORDER[row.kind]);
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index)
    .map((item) => item.row);
}

/** Every runtime unit of the relations product, of every kind, in product order. */
export function runtimeUnits(relationsProduct: unknown): UnitInfo[] {
  return unitsOf(relationsProduct);
}

export function techStack(graph: KnowledgeGraph | null): { languages: string[]; frameworks: string[] } {
  return {
    languages: dedupeCaseVariants(graph?.project?.languages ?? []),
    frameworks: dedupeCaseVariants(graph?.project?.frameworks ?? []),
  };
}

/** The external systems of the relations product, in product order; an entry without a string id is skipped. */
export function externalSystemList(relationsProduct: unknown): { id: string; label: string }[] {
  if (!isTable(relationsProduct)) return [];
  const rows: { id: string; label: string }[] = [];
  for (const item of listOf(relationsProduct.externals)) {
    if (typeof item.id === "string") rows.push({ id: item.id, label: externalLabel(item.id) });
  }
  return rows;
}

export interface HotspotFile {
  path: string;
  commits: number | null;
  authors: number | null;
  lastChanged: string | null;
}

/** The `n` files with the highest hotspot score (ties by path). */
export function topHotspotFiles(hotspotsProduct: unknown, n: number): HotspotFile[] {
  if (!isTable(hotspotsProduct)) return [];
  const rows = listOf(hotspotsProduct.files);
  const byPath = new Map<string, Table>();
  for (const row of rows) if (typeof row.path === "string" && !byPath.has(row.path)) byPath.set(row.path, row);
  return topFiles(rows, n).map(({ path }) => {
    const row = byPath.get(path) as Table;
    return { path, commits: numberOrNull(row.commits), authors: numberOrNull(row.authors), lastChanged: stringOrNull(row.lastChanged) };
  });
}

const CONFIDENCE_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** The unused-code candidates, most confident first, then by file and line. */
export function unusedCandidates(unusedProduct: unknown): UnusedRow[] {
  if (!isTable(unusedProduct)) return [];
  const confidence = (row: UnusedRow) => (row.confidence === null ? 3 : CONFIDENCE_ORDER[row.confidence] ?? 3);
  const compareText = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);
  return listOf(unusedProduct.unused)
    .filter((raw) => typeof raw.id === "string")
    .map(normalizeRow)
    .sort(
      (a, b) =>
        confidence(a) - confidence(b) ||
        compareText(a.file, b.file) ||
        (a.lineRange?.[0] ?? Infinity) - (b.lineRange?.[0] ?? Infinity) ||
        0,
    );
}
