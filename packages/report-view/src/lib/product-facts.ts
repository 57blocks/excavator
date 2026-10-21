/**
 * What the sidebar says about a node from the products (openspec:
 * changes/viewer-app, design D5; spec "Node details and code drawer"):
 *   - a file: its hotspots commits and score, and how many doc-map evidence
 *     passages name it;
 *   - a function: whether the unused-code product lists it, with the reason and
 *     the confidence.
 * A product that was not run says so and gives the command that makes it; it
 * never shows 0 or "none" in place of facts nobody computed. A product that
 * ran and has nothing for the node says that, in words. Numbers are shown as
 * the product states them; a field the product lacks says so.
 */

import type { GraphNode } from '../data/graph';
import type { ManifestProduct } from '../data/manifest';
import { EMPTY, formatNumber, NOT_PROVIDED } from './format';

export type ProductName = 'hotspots' | 'unused-code' | 'doc-map';

/** A product of the page and, when it is included, its parsed data. */
export interface ProductSource {
  product: Pick<ManifestProduct, 'status' | 'label' | 'command' | 'file' | 'reason' | 'revision'>;
  data: Record<string, any> | null;
}

export interface FactRow {
  label: string;
  value: string;
}

export type ProductFact =
  | { name: ProductName; label: string; state: 'not-run'; text: string; command: string }
  | { name: ProductName; label: string; state: 'unreadable'; text: string }
  | { name: ProductName; label: string; state: 'facts'; rows: FactRow[]; note: string | null };

/** Which products speak about a node: a file has hotspots and doc-map facts, a function has unused-code facts. */
export function productsFor(node: Pick<GraphNode, 'type'>): ProductName[] {
  if (node.type === 'file') return ['hotspots', 'doc-map'];
  if (node.type === 'function') return ['unused-code'];
  return [];
}

const text = (value: unknown): string => (typeof value === 'string' && value !== '' ? value : value === undefined ? NOT_PROVIDED : EMPTY);
const count = (value: unknown): string => (value === undefined ? NOT_PROVIDED : formatNumber(value));

const listOf = (value: unknown): Record<string, any>[] => (Array.isArray(value) ? value.filter((row) => row !== null && typeof row === 'object') : []);

function keyed(rows: readonly Record<string, any>[], key: string): Map<string, Record<string, any>> {
  const map = new Map<string, Record<string, any>>();
  for (const row of rows) if (typeof row[key] === 'string' && !map.has(row[key])) map.set(row[key], row);
  return map;
}

/** The doc-map evidence by file: how many evidence passages name it, and in how many units. */
function evidenceByFile(units: readonly Record<string, any>[]): Map<string, { passages: number; units: number }> {
  const byFile = new Map<string, { passages: number; units: number }>();
  for (const unit of units) {
    const seen = new Set<string>();
    for (const item of listOf(unit.code?.evidence)) {
      if (typeof item.file !== 'string') continue;
      const entry = byFile.get(item.file) ?? { passages: 0, units: 0 };
      entry.passages += 1;
      if (!seen.has(item.file)) entry.units += 1;
      seen.add(item.file);
      byFile.set(item.file, entry);
    }
  }
  return byFile;
}

/** A product's rows looked up by path or id, built once for a product's data and read for each node. */
const lookups = new WeakMap<object, unknown>();

function lookup<T>(data: Record<string, any>, build: () => T): T {
  if (!lookups.has(data)) lookups.set(data, build());
  return lookups.get(data) as T;
}

function unavailable(name: ProductName, source: ProductSource): ProductFact | null {
  const { product } = source;
  if (product.status === 'not-run') return { name, label: product.label, state: 'not-run', text: `Not run: there is no ${product.file} in .excavator/.`, command: product.command };
  if (product.status === 'unreadable' || source.data === null) {
    return { name, label: product.label, state: 'unreadable', text: product.status === 'unreadable' ? (product.reason || 'The file could not be read.') : 'The data is not loaded.' };
  }
  return null;
}

const revisionNote = (source: ProductSource) => (source.product.status === 'different-revision' ? `Made at ${source.product.revision}, not at the source snapshot.` : null);

function hotspotsFact(node: GraphNode, source: ProductSource & { data: Record<string, any> }): ProductFact {
  const path = typeof node.filePath === 'string' ? node.filePath : node.name;
  const row = lookup(source.data, () => keyed(listOf(source.data.files), 'path')).get(path);
  const rows: FactRow[] = row
    ? [{ label: 'Commits', value: count(row.commits) }, { label: 'Authors', value: count(row.authors) }, { label: 'Score', value: count(row.score) }]
    : [{ label: 'History', value: 'The product lists no history for this file.' }];
  return { name: 'hotspots', label: source.product.label, state: 'facts', rows, note: revisionNote(source) };
}

function unusedFact(node: GraphNode, source: ProductSource & { data: Record<string, any> }): ProductFact {
  const { unused: unusedRows, testOnly: testOnlyRows } = lookup(source.data, () => ({ unused: keyed(listOf(source.data.unused), 'id'), testOnly: keyed(listOf(source.data.testOnly), 'id') }));
  const unused = unusedRows.get(node.id);
  const testOnly = testOnlyRows.get(node.id);
  const row = unused ?? testOnly;
  const rows: FactRow[] = row
    ? [
        { label: 'State', value: unused ? 'Listed as unused' : 'Listed as test only' },
        { label: 'Reason', value: text(row.reason) },
        { label: 'Confidence', value: text(row.confidence) },
      ]
    : [{ label: 'State', value: 'Not in the unused list' }];
  return { name: 'unused-code', label: source.product.label, state: 'facts', rows, note: revisionNote(source) };
}

function docMapFact(node: GraphNode, source: ProductSource & { data: Record<string, any> }): ProductFact {
  const path = typeof node.filePath === 'string' ? node.filePath : node.name;
  const evidence = lookup(source.data, () => evidenceByFile(listOf(source.data.units))).get(path) ?? { passages: 0, units: 0 };
  const rows: FactRow[] = [{ label: 'Evidence', value: `${formatNumber(evidence.passages)} passage${evidence.passages === 1 ? '' : 's'} in ${formatNumber(evidence.units)} unit${evidence.units === 1 ? '' : 's'}` }];
  return { name: 'doc-map', label: source.product.label, state: 'facts', rows, note: revisionNote(source) };
}

/** The product facts of `node`, one entry for each product that speaks about its kind of node and that the page lists. */
export function nodeProductFacts(node: GraphNode, sources: Partial<Record<ProductName, ProductSource>>): ProductFact[] {
  const facts: ProductFact[] = [];
  for (const name of productsFor(node)) {
    const source = sources[name];
    if (!source) continue;
    const missing = unavailable(name, source);
    if (missing) facts.push(missing);
    else if (name === 'hotspots') facts.push(hotspotsFact(node, source as ProductSource & { data: Record<string, any> }));
    else if (name === 'unused-code') facts.push(unusedFact(node, source as ProductSource & { data: Record<string, any> }));
    else facts.push(docMapFact(node, source as ProductSource & { data: Record<string, any> }));
  }
  return facts;
}
