/**
 * The key numbers of each product's card on the Products page (openspec: changes/viewer-learn, design D6). Each is a
 * field the product or the packer states, or a count over the product's entries; a field that is absent is null and
 * the card says it is not provided. A product that is not in the page has no numbers.
 */

import type { ManifestProduct } from '../data/manifest';

export interface KeyNumber {
  label: string;
  value: number | null;
}

/** The page each product's card leads to. */
export const PRODUCT_PAGES: Readonly<Record<string, string>> = {
  'knowledge-graph': 'graph',
  semantics: 'graph',
  tour: 'graph',
  'domain-graph': 'domain',
  'unused-code': 'unused',
  'doc-map': 'doc-map',
  hotspots: 'hotspots',
  reports: 'reports',
};

/** The products whose key numbers are read from their payload, not from the manifest. */
export const PAYLOAD_PRODUCTS: readonly string[] = ['unused-code', 'doc-map', 'hotspots'];

const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const length = (value: unknown): number | null => (Array.isArray(value) ? value.length : null);

export const inPage = (product: Pick<ManifestProduct, 'status'>) => product.status === 'included' || product.status === 'different-revision';

/**
 * The key numbers of `product`: `graph` is the knowledge graph's node and edge totals once read (null while it is
 * read, undefined when it cannot be), `data` the product's parsed payload for the products in PAYLOAD_PRODUCTS (null
 * while it is read). Null while what they come from is still being read.
 */
export function keyNumbers(
  product: ManifestProduct,
  sources: { graph?: { nodes: number; edges: number } | null; data?: Record<string, any> | null },
): KeyNumber[] | null {
  if (product.name === 'reports') {
    const items = product.items ?? [];
    return [{ label: 'Reports written', value: items.filter((item) => item.status === 'included').length }];
  }
  if (!inPage(product)) return [];
  const c = (product.counts ?? {}) as Record<string, unknown>;
  switch (product.name) {
    case 'knowledge-graph':
      if (sources.graph === undefined) return [];
      return sources.graph === null ? null : [{ label: 'Nodes', value: sources.graph.nodes }, { label: 'Edges', value: sources.graph.edges }];
    case 'semantics':
      return [{ label: 'Summaries', value: count(c.entries) }, { label: 'Not fresh', value: count(c.stale) }];
    case 'domain-graph':
      return [{ label: 'Domains', value: count(c.domains) }, { label: 'Flows', value: count(c.flows) }];
    case 'tour':
      return [{ label: 'Steps', value: count(c.steps) }, { label: 'Sentences', value: count(c.sentences) }];
    case 'unused-code': {
      const d = sources.data;
      if (d === undefined) return [];
      return d ? [{ label: 'Unused', value: count(d.counts?.unused) }, { label: 'Test only', value: count(d.counts?.testOnly) }] : null;
    }
    case 'doc-map': {
      const d = sources.data;
      if (d === undefined) return [];
      return d ? [{ label: 'Units', value: count(d.counts?.units) }, { label: 'Code found', value: count(d.counts?.found) }] : null;
    }
    case 'hotspots': {
      const d = sources.data;
      if (d === undefined) return [];
      return d ? [{ label: 'Files', value: length(d.files) }, { label: 'Pairs', value: length(d.pairs) }] : null;
    }
    default:
      return [];
  }
}
