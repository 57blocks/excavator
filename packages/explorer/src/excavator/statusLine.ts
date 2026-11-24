import type { GraphIssue } from "../core/schema";
import type { DashboardFreshnessReport } from "../freshness";
import { freshnessLines } from "./freshnessLines";
import { overviewLine, type NameTranslations } from "./nameTranslations";
import { describeProductState, productStateOf, snapshotRevisionOf, type ProductState } from "./productStates";

/**
 * The one status line at the bottom of the right panel: which products the page holds and in what state,
 * with the longer reasons as detail lines. The states come from the pack's manifest (all eight products);
 * `products.json` adds the reason, command and revisions of the four it describes.
 */

/** A named hole of the knowledge graph (`graph.gaps`). */
export interface Gap {
  kind: string;
  scope: string;
  reason: string;
  count?: number;
}

export interface StatusLine {
  summary: string;
  details: string[];
  attention: boolean;
}

export interface ManifestProduct {
  name: string;
  status: string;
  reason: string | null;
}

export type PageManifest = { products: ManifestProduct[] } | { reason: string };

const MANIFEST_ID = "xv-explorer-manifest";

/** The words each product is shown by (the packer's reply words with a capital first letter). */
const LABELS: Record<string, string> = {
  "knowledge-graph": "Knowledge graph",
  semantics: "Semantics",
  "domain-graph": "Domain graph",
  "unused-code": "Unused code",
  "doc-map": "Doc map",
  hotspots: "Hotspots",
  tour: "Tour",
  relations: "Relations",
};

const labelOf = (name: string) => LABELS[name] ?? name;

const isTable = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The `products` list of the page's manifest block, or the reason it cannot be read. */
export function readPageManifest(doc: Document = document): PageManifest {
  const block = doc.getElementById(MANIFEST_ID);
  if (!block) return { reason: "the page has no manifest" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(block.textContent ?? "");
  } catch (error) {
    return { reason: `the page manifest is not valid JSON (${error instanceof Error ? error.message : String(error)})` };
  }
  if (!isTable(parsed) || !Array.isArray(parsed.products)) return { reason: "the page manifest has no products list" };
  const products: ManifestProduct[] = [];
  for (const [index, item] of parsed.products.entries()) {
    if (!isTable(item) || typeof item.name !== "string" || typeof item.status !== "string") {
      return { reason: `the page manifest's product ${index + 1} has no name or status` };
    }
    products.push({ name: item.name, status: item.status, reason: typeof item.reason === "string" && item.reason !== "" ? item.reason : null });
  }
  return { products };
}

export interface StatusLineInput {
  manifest: PageManifest;
  /** The parsed `products.json`, or undefined/null when the page holds none. */
  products?: unknown;
  freshness: DashboardFreshnessReport | null;
  issues: readonly GraphIssue[];
  gaps: readonly Gap[] | undefined;
  nameTable: NameTranslations | null;
}

const GROUPS: readonly (readonly [status: string, word: string])[] = [
  ["included", "included"],
  ["different-revision", "different revision"],
  ["not-run", "not run"],
  ["unreadable", "unreadable"],
];

/** "not run, command /x": a state's lines on one line. */
function stateText(state: ProductState, snapshotRevision: string | null): string {
  return describeProductState(state, snapshotRevision)
    .map((line, index) => {
      const text = line.replace(/^Status: /, "");
      return index === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1).replace(": ", " ");
    })
    .join(", ");
}

function gapLine(gap: Gap): string {
  let line = `Gap: ${gap.kind}`;
  if (gap.scope) line += ` \u00b7 ${gap.scope}`;
  if (gap.count !== undefined) line += ` ${gap.count}`;
  if (gap.reason) line += ` ${gap.reason}`;
  return line;
}

export function buildStatusLine(input: StatusLineInput): StatusLine {
  const { manifest } = input;
  if ("reason" in manifest || manifest.products.length === 0) {
    const reason = "reason" in manifest ? manifest.reason : "the page manifest lists no products";
    return { summary: `Product states unreadable: ${reason}`, details: [], attention: true };
  }
  const json = isTable(input.products) && Array.isArray(input.products.products) ? input.products.products.filter(isTable) : [];
  const snapshotRevision = snapshotRevisionOf(input.products);
  const entries = manifest.products.map((p) => {
    const extra = json.find((item) => item.name === p.name) ?? {};
    const state = productStateOf(p.name, { ...extra, status: p.status, reason: p.reason ?? extra.reason });
    return { name: p.name, label: labelOf(p.name), state };
  });

  const groups: string[] = [];
  for (const [status, word] of GROUPS) {
    const labels = entries.filter((e) => e.state.status === status).map((e) => e.label);
    if (labels.length > 0) groups.push(`${labels.join(", ")} ${word}`);
  }

  const details: string[] = [];
  let attention = false;
  for (const e of entries) {
    if (e.state.status !== "included") {
      attention = true;
      details.push(`${e.label}: ${stateText(e.state, snapshotRevision)}`);
    } else if (e.name === "tour") {
      details.push("Tour: included, not shown on this page");
    }
  }
  const freshness = freshnessLines(input.freshness);
  details.push(...freshness);
  for (const issue of input.issues) details.push(`Graph issue (${issue.level}): ${issue.message}`);
  for (const gap of input.gaps ?? []) details.push(gapLine(gap));
  if (input.nameTable) details.push(overviewLine(input.nameTable));
  if (freshness.length > 0 || input.issues.length > 0 || (input.gaps?.length ?? 0) > 0) attention = true;

  return { summary: groups.join(" \u00b7 "), details, attention };
}
