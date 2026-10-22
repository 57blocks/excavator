/**
 * The Overview's counts over a parsed knowledge graph (openspec:
 * changes/viewer-app, design D6; spec "Overview page"). Every number is read
 * from a header field or counted over the graph's records; nothing is
 * estimated. A record the parser could not use is counted in `problems`, and a
 * stream whose record count differs from the header's is named in `notes`.
 */

import type { ParsedGraph } from '../data/graph';
import { formatNumber } from './format';

export interface TypeCount {
  type: string;
  count: number;
}

export interface GapKindRow {
  kind: string;
  records: number;
  count: number;
}

export interface CoverageLanguageRow {
  language: string;
  files: number | null;
  parsed: number | null;
  zeroSymbol: number | null;
  skipped: number;
  functions: number | null;
  classes: number | null;
}

export interface GraphSummary {
  project: { name: string | null; description: string | null; languages: string[]; frameworks: string[] };
  kind: string | null;
  totals: { nodes: number; edges: number; gaps: number };
  nodesByType: TypeCount[];
  edgesByType: TypeCount[];
  gapsByKind: GapKindRow[];
  coverage: { files: number | null; ignored: number | null; languages: CoverageLanguageRow[] } | null;
  /** Sentences about what in the graph file could not be counted as written. */
  notes: string[];
}

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
const numberOrNull = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const isObject = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);

function rank(counts: Map<string, number>): TypeCount[] {
  return [...counts].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
}

function countBy<T>(items: readonly T[], typeOf: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(typeOf(item), (counts.get(typeOf(item)) ?? 0) + 1);
  return counts;
}

function summarizeCoverage(coverage: unknown): GraphSummary['coverage'] {
  if (!isObject(coverage)) return null;
  const byLanguage = isObject(coverage.byLanguage) ? coverage.byLanguage : {};
  const languages = Object.keys(byLanguage).sort().map((language): CoverageLanguageRow => {
    const entry = isObject(byLanguage[language]) ? byLanguage[language] : {};
    const kinds = isObject(entry.kinds) ? entry.kinds : {};
    let skipped = 0;
    for (const value of Object.values(isObject(entry.skipped) ? entry.skipped : {})) if (typeof value === 'number') skipped += value;
    return {
      language,
      files: numberOrNull(entry.files),
      parsed: numberOrNull(entry.parsed),
      zeroSymbol: numberOrNull(entry.zeroSymbol),
      skipped,
      functions: numberOrNull(kinds.function),
      classes: numberOrNull(kinds.class),
    };
  });
  return { files: numberOrNull(coverage.files), ignored: numberOrNull(coverage.ignored), languages };
}

/** Count the records of a parsed graph: nodes and edges by type, gaps by kind, the header's facts and the coverage record. */
export function summarizeGraph(graph: ParsedGraph): GraphSummary {
  const fields = graph.header.fields;
  const project = isObject(fields.project) ? fields.project : {};

  const gapKinds = new Map<string, GapKindRow>();
  for (const raw of graph.gaps) {
    const gap = isObject(raw) ? raw : {};
    const kind = typeof gap.kind === 'string' ? gap.kind : 'unknown';
    const row = gapKinds.get(kind) ?? { kind, records: 0, count: 0 };
    row.records += 1;
    if (typeof gap.count === 'number') row.count += gap.count;
    gapKinds.set(kind, row);
  }

  const notes: string[] = [];
  if (graph.problems.length > 0) notes.push(`${formatNumber(graph.problems.length)} line(s) of the graph file could not be used as records and are not counted.`);
  for (const stream of graph.countMismatches) {
    notes.push(`The header states ${formatNumber(stream.header)} ${stream.stream}; ${formatNumber(stream.read)} records are in the file.`);
  }

  return {
    project: {
      name: typeof project.name === 'string' ? project.name : null,
      description: typeof project.description === 'string' && project.description !== '' ? project.description : null,
      languages: stringList(project.languages),
      frameworks: stringList(project.frameworks),
    },
    kind: typeof fields.kind === 'string' ? fields.kind : null,
    totals: { nodes: graph.nodes.length, edges: graph.edges.length, gaps: graph.gaps.length },
    nodesByType: rank(countBy(graph.nodes, (node) => node.type)),
    edgesByType: rank(countBy(graph.edges, (edge) => edge.type)),
    gapsByKind: [...gapKinds.values()].sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)),
    coverage: summarizeCoverage(graph.coverage),
    notes,
  };
}
