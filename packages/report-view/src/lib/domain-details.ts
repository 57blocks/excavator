/**
 * What the domain view's sidebar says (openspec: changes/viewer-app, design D12):
 * the fixed notes, `domainMeta` as titled sections, and the code a step or an
 * evidence line opens in the drawer. Every field of the file is shown as written;
 * a value the sidebar has no special layout for is written as JSON, not left out.
 */

import type { DomainEvidence, DomainNode } from '../data/domain';
import type { GraphNode } from '../data/graph';
import type { DomainCounts } from '../data/manifest';
import { formatNumber } from './format';

/** The line at the top of the domain view. */
export const DOMAIN_NOTE = 'The domain graph is derived by a model from the code; it describes the code and is not itself a fact of the code.';

/** What the arrows between the steps of a flow are. */
export const ARROWS_NOTE = 'The arrows between steps follow the flow_step weights in ascending order. They show the order of the steps and are not edges of the domain graph.';

/** What the domain view says when the graph is not the one for this source and these facts: the revisions and the digests, as the packer wrote them; null when it is. */
export function revisionNote(product: { status: string; revision: string | null; reason: string | null }, snapshotRevision: string): string | null {
  if (product.status !== 'different-revision') return null;
  const parts = [
    ...(product.revision !== snapshotRevision ? [`The domain graph was made at ${product.revision}; the source snapshot is ${snapshotRevision}.`] : []),
    ...(product.reason ? [`${product.reason}.`] : []),
  ];
  return parts.length === 0 ? null : parts.join(' ');
}

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

/** What the packer counted in the domain graph, as one sentence for the Overview; null when the product has no such counts. */
export function domainCountsText(counts: Partial<DomainCounts> | undefined): string | null {
  if (!counts || ![counts.domains, counts.flows, counts.steps, counts.crossDomain].every((n) => typeof n === 'number')) return null;
  return `${plural(counts.domains as number, 'domain', 'domains')}, ${plural(counts.flows as number, 'flow', 'flows')}, ${plural(counts.steps as number, 'step', 'steps')} and ${plural(counts.crossDomain as number, 'cross-domain edge', 'cross-domain edges')}.`;
}

export interface MetaSection {
  key: string;
  title: string;
  items: string[];
  /** The field is there and holds nothing. */
  empty?: boolean;
}

const asText = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value));

/** "businessRules" becomes "Business rules". */
function titleOf(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `domainMeta` as one section for each field, in the order the file has them. */
export function metaSections(meta: Record<string, unknown> | undefined): MetaSection[] {
  return Object.entries(meta ?? {}).map(([key, value]) => {
    const items = value === null || value === undefined ? [] : Array.isArray(value) ? value.map(asText) : [asText(value)];
    return { key, title: titleOf(key), items, ...(items.length === 0 ? { empty: true } : {}) };
  });
}

const isRange = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every((n) => Number.isInteger(n) && n >= 1);

/** The node the code drawer shows for a step: its file and lines. Null when the step has no file. */
export function stepTarget(step: Pick<DomainNode, 'id' | 'name' | 'filePath' | 'lineRange'>): GraphNode | null {
  if (typeof step.filePath !== 'string' || step.filePath === '') return null;
  return { id: step.id, type: 'step', name: step.name, filePath: step.filePath, ...(isRange(step.lineRange) ? { lineRange: step.lineRange } : {}) };
}

/** The node the code drawer shows for a line of evidence: that line of its file. Null when it names no file. */
export function evidenceTarget(evidence: DomainEvidence): GraphNode | null {
  if (typeof evidence.file !== 'string' || evidence.file === '') return null;
  const line = typeof evidence.line === 'number' && Number.isInteger(evidence.line) && evidence.line >= 1 ? evidence.line : null;
  const name = line === null ? evidence.file : `${evidence.file}:${line}`;
  return { id: name, type: 'evidence', name, filePath: evidence.file, ...(line === null ? {} : { lineRange: [line, line] as [number, number] }) };
}
