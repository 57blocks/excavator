// Typed view of a decoded excavator-view-bundle/1 (see
// skills/excavator-view/FORMAT.md). Only fields the bake writes are declared;
// everything is optional at runtime because the page must render whatever a
// bundle actually carries and say so when something is absent.

export interface Table {
  rows: number;
  columns: Record<string, Int32Array>;
}

export type Segments = Record<string, unknown>;

export interface InventoryItem {
  name: string;
  required: boolean;
  sections?: string[];
  status: 'present' | 'missing' | 'invalid' | string;
  bytes?: number | null;
  missing?: string;
  reason?: string;
}

export interface FactLayerFreshness {
  status: 'fresh' | 'stale' | 'missing' | string;
  currentSourceRevision?: string | null;
  manifestSourceRevision?: string | null;
  reason?: string;
}

export interface SemanticCacheSummary {
  entries: number;
  nodesInGraph: number;
  fresh: number;
  stale: number;
  missing: number;
  'noncanonical-language': number;
  notInGraph: number;
}

export interface SelectionEntry {
  path?: string;
  kind?: string;
  reason?: string;
  detail?: string;
  [key: string]: unknown;
}

export interface SelectionFunnel {
  policyVersion?: string;
  candidates?: number;
  selected?: number;
  filteredByDefaults?: number;
  filteredByIgnore?: number;
  sensitive?: number;
  entries?: SelectionEntry[];
}

export interface SourceEmbedding {
  snapshotPinned?: boolean;
  filesCited?: number;
  filesEmbedded?: number;
  filesHashMismatch?: number;
  filesNotInManifest?: number;
  filesUnreadable?: number;
  linesOutOfRange?: number;
  hashMismatchSamples?: string[];
}

export interface Meta {
  format?: string;
  bakedAt?: string;
  graph?: {
    keys?: string[];
    fields?: { version?: string; project?: Record<string, unknown> } & Record<string, unknown>;
    counts?: Record<string, number>;
  };
  counts?: Record<string, number>;
  inventory?: InventoryItem[];
  embeds?: Array<{ segment: string; status: string; reason?: string }>;
  dropped?: Array<{ segment: string; reason: string; bytes?: number }>;
  freshness?: {
    factLayer?: FactLayerFreshness | null;
    semanticCache?: SemanticCacheSummary | null;
    semanticGraph?: { freshness: string; layers?: number } | null;
    domainGraph?: { freshness: string; reason?: string } | null;
  };
  source?: {
    sourceRevision?: string | null;
    selectionDigest?: string | null;
    pipelineVersion?: string | null;
    manifestEntries?: number;
    filesWithoutLineCount?: number;
    embedding?: SourceEmbedding | null;
    budgetBytes?: number;
  };
  selection?: SelectionFunnel | null;
  /** `files`: manifest entries; `selected`: the selection funnel's selected entries (null when not recorded). */
  members?: Array<{ name: string; files: number; selected?: number | null }>;
  index?: Record<string, unknown> | null;
  unembedded?: Record<string, Record<string, number>>;
  anomalies?: Record<string, number>;
}

export interface LanguageCoverage {
  files?: number;
  parsed?: number;
  zeroSymbol?: number;
  skipped?: Record<string, number>;
  kinds?: Record<string, number>;
}

export interface Coverage {
  files?: number;
  byLanguage?: Record<string, LanguageCoverage>;
  ignored?: number;
  selection?: SelectionFunnel;
  [key: string]: unknown;
}

export interface Gap {
  kind?: string;
  scope?: string;
  reason?: string;
  count?: number;
  samples?: unknown[];
  [key: string]: unknown;
}

export interface DecodedCounts {
  segments: number;
  nodes: number;
  edges: number;
  evidence: number;
  gaps: number;
}

export interface ViewData {
  segments: Segments;
  meta: Meta;
  strings: string[];
  coverage: Coverage | null;
  gaps: Gap[];
  counts: DecodedCounts;
  /** Where decoding ran: a blob Worker, or the main thread as fallback. */
  decodeMode: 'worker' | 'main';
}

export function isTable(value: unknown): value is Table {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { rows?: unknown; columns?: unknown };
  if (!Number.isInteger(candidate.rows) || candidate.columns === null || typeof candidate.columns !== 'object') return false;
  const cols = Object.values(candidate.columns as object);
  return cols.length > 0 && cols.every((col) => col instanceof Int32Array);
}

function rows(value: unknown): number {
  return isTable(value) ? value.rows : 0;
}

export function toViewData(segments: Segments, decodeMode: 'worker' | 'main'): ViewData {
  const meta = (segments.meta && typeof segments.meta === 'object' ? segments.meta : {}) as Meta;
  const strings = Array.isArray(segments.strings) ? (segments.strings as string[]) : [];
  const coverage = segments.coverage && typeof segments.coverage === 'object' ? (segments.coverage as Coverage) : null;
  const gaps = Array.isArray(segments.gaps) ? (segments.gaps as Gap[]) : [];
  return {
    segments,
    meta,
    strings,
    coverage,
    gaps,
    counts: {
      segments: Object.keys(segments).length,
      nodes: rows(segments.nodes),
      edges: rows(segments.edges),
      evidence: rows(segments.evidence),
      gaps: Array.isArray(segments.gaps) ? segments.gaps.length : 0,
    },
    decodeMode,
  };
}

/** A string cell's text, or undefined when the cell is not a string. */
export function cellText(strings: string[], cell: number): string | undefined {
  return cell >= 0 ? strings[cell] : undefined;
}
