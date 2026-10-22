/**
 * Maps product records to knowledge-graph nodes (openspec: changes/viewer-app,
 * design D3), for the overlays and "locate in graph":
 *   unused-code  `unused[].id` is a node id;
 *   hotspots     `files[].path` is the file node `file:<path>`;
 *   doc-map      `coverage.files[].path` is the file node `file:<path>`.
 *
 * Every record lands in exactly one of two lists: `mapped`, with the node id,
 * or `notInGraph`, with why. None is dropped, so the two lengths always add up
 * to the number of records.
 */

import { fileNodeId, type GraphIndex } from './indexes';

export interface MappedRecord<T> {
  record: T;
  nodeId: string;
}

export interface UnmappedRecord<T> {
  record: T;
  /** `no-key`: the record has no id or path to look up; `not-in-graph`: the graph has no such node. */
  reason: 'no-key' | 'not-in-graph';
  /** The node id that was looked up, when there was one. */
  lookedUp: string | null;
}

export interface RecordMapping<T> {
  mapped: MappedRecord<T>[];
  notInGraph: UnmappedRecord<T>[];
}

/** Map each record through `nodeIdOf`; a null id or one the graph lacks goes to `notInGraph`. */
export function mapRecords<T>(records: readonly T[], nodeIdOf: (record: T) => string | null, index: Pick<GraphIndex, 'nodesById'>): RecordMapping<T> {
  const mapping: RecordMapping<T> = { mapped: [], notInGraph: [] };
  for (const record of records) {
    const nodeId = nodeIdOf(record);
    if (nodeId === null) mapping.notInGraph.push({ record, reason: 'no-key', lookedUp: null });
    else if (index.nodesById.has(nodeId)) mapping.mapped.push({ record, nodeId });
    else mapping.notInGraph.push({ record, reason: 'not-in-graph', lookedUp: nodeId });
  }
  return mapping;
}

const stringField = (record: unknown, key: string): string | null => {
  if (record === null || typeof record !== 'object') return null;
  const value = (record as Record<string, unknown>)[key];
  return typeof value === 'string' && value !== '' ? value : null;
};

const listField = (value: unknown, key: string): unknown[] => {
  if (value === null || typeof value !== 'object') return [];
  const list = (value as Record<string, unknown>)[key];
  return Array.isArray(list) ? list : [];
};

/** unused-code: each `unused[]` row by its `id`. */
export function mapUnused(product: unknown, index: Pick<GraphIndex, 'nodesById'>): RecordMapping<unknown> {
  return mapRecords(listField(product, 'unused'), (row) => stringField(row, 'id'), index);
}

/** hotspots: each `files[]` row by `file:<path>`. */
export function mapHotspotFiles(product: unknown, index: Pick<GraphIndex, 'nodesById'>): RecordMapping<unknown> {
  return mapRecords(listField(product, 'files'), (row) => {
    const path = stringField(row, 'path');
    return path === null ? null : fileNodeId(path);
  }, index);
}

/** doc-map: each `coverage.files[]` row by `file:<path>`; a doc map without coverage has no rows. */
export function mapDocMapCoverageFiles(product: unknown, index: Pick<GraphIndex, 'nodesById'>): RecordMapping<unknown> {
  const coverage = product !== null && typeof product === 'object' ? (product as Record<string, unknown>).coverage : null;
  return mapRecords(listField(coverage, 'files'), (row) => {
    const path = stringField(row, 'path');
    return path === null ? null : fileNodeId(path);
  }, index);
}
