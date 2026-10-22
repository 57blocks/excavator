/**
 * The merge of the Full-mode semantic payload into the graph (openspec:
 * changes/viewer-app, design D3 and D11). The packer decides what is fresh and
 * blanks what a verifier contradicted; the page only chooses which source
 * speaks for each field:
 *   - a node's summary and tags come from its semantic entry first, then from
 *     the node's own fields (Lazy mode writes them into the graph);
 *   - the layers come from the semantic graph first, then from the graph's own
 *     `layer` records.
 * A contradicted entry owns its node's text for good: its summary is empty in
 * the payload and the node's own summary never takes its place. A summary whose
 * verdict is contradicted is empty here whichever source it came from, so no
 * later reader has to remember to hide it.
 */

import type { GraphLayer, GraphNode } from './graph';

export interface SemanticEntry {
  id: string;
  summary: string;
  tags: string[];
  /** The verifier's verdict on the summary, when there is one. */
  verification?: string | null;
}

export interface SemanticPayload {
  entries: SemanticEntry[];
  layers?: GraphLayer[];
}

export type TextSource = 'semantic' | 'graph' | 'none';

export interface NodeSemantics {
  summary: string;
  tags: string[];
  verification: string | null;
  /** Where the summary came from; `none` when no source had one. */
  source: TextSource;
}

export interface MergedSemantics {
  /** One row per node of the graph, in graph order. */
  byNode: Map<string, NodeSemantics>;
  layers: GraphLayer[];
  layerSource: TextSource;
  /** Semantic entries whose id is not a node of the graph, kept visible rather than dropped. */
  orphanEntries: SemanticEntry[];
}

const CONTRADICTED = 'contradicted';

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value !== '';
const tagList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : []);

function ownText(node: GraphNode): Pick<NodeSemantics, 'summary' | 'tags'> {
  return { summary: nonEmpty(node.summary) ? node.summary : '', tags: tagList(node.tags) };
}

function nodeSemantics(node: GraphNode, entry: SemanticEntry | undefined): NodeSemantics {
  const merged = pickSources(node, entry);
  return merged.verification === CONTRADICTED ? { ...merged, summary: '', source: 'none' } : merged;
}

function pickSources(node: GraphNode, entry: SemanticEntry | undefined): NodeSemantics {
  const own = ownText(node);
  const graphVerification = nonEmpty(node.verification) ? node.verification : null;
  if (!entry) {
    return { ...own, verification: graphVerification, source: own.summary ? 'graph' : 'none' };
  }
  const verification = nonEmpty(entry.verification) ? entry.verification : graphVerification;
  const entryTags = tagList(entry.tags);
  const tags = entryTags.length > 0 ? entryTags : own.tags;
  if (nonEmpty(entry.summary)) return { summary: entry.summary, tags, verification, source: 'semantic' };
  // An empty summary on a contradicted entry is the packer's blanking; the node's own text must not stand in for it.
  if (entry.verification === CONTRADICTED) return { summary: '', tags, verification, source: 'none' };
  return { summary: own.summary, tags, verification, source: own.summary ? 'graph' : 'none' };
}

/** Merge the semantic payload, when there is one, into the nodes and layers of a graph. */
export function mergeSemantics(nodes: readonly GraphNode[], graphLayers: readonly GraphLayer[], semantics?: SemanticPayload | null): MergedSemantics {
  const entries = new Map<string, SemanticEntry>();
  for (const entry of semantics?.entries ?? []) if (!entries.has(entry.id)) entries.set(entry.id, entry);

  const byNode = new Map<string, NodeSemantics>();
  for (const node of nodes) if (!byNode.has(node.id)) byNode.set(node.id, nodeSemantics(node, entries.get(node.id)));

  const orphanEntries = [...entries.values()].filter((entry) => !byNode.has(entry.id));
  const semanticLayers = semantics?.layers ?? [];
  if (semanticLayers.length > 0) return { byNode, layers: [...semanticLayers], layerSource: 'semantic', orphanEntries };
  if (graphLayers.length > 0) return { byNode, layers: [...graphLayers], layerSource: 'graph', orphanEntries };
  return { byNode, layers: [], layerSource: 'none', orphanEntries };
}
