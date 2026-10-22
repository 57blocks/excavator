/**
 * The graph the pages draw from (openspec: changes/viewer-app, design D3 and
 * D11): the knowledge graph parsed, indexed, and merged with the semantic
 * payload when the manifest says there is one. Built once per page load and
 * shared by every page that asks for it.
 */

import { parseGraphJsonl, type ParsedGraph } from './graph';
import { buildIndex, type GraphIndex } from './indexes';
import { findProduct, type Manifest } from './manifest';
import type { PayloadReader } from './payload';
import type { SemanticPayload } from './semantics';

export interface GraphModel {
  graph: ParsedGraph;
  index: GraphIndex;
  /** The semantic payload that was merged, or null when the page has none. */
  semantics: SemanticPayload | null;
}

const usable = (status: string | undefined) => status === 'included' || status === 'different-revision';

const models = new WeakMap<PayloadReader, Promise<GraphModel | null>>();

async function build(manifest: Manifest, payloads: PayloadReader): Promise<GraphModel | null> {
  const product = findProduct(manifest, 'knowledge-graph');
  if (!product || !usable(product.status)) return null;
  const graph = parseGraphJsonl(await payloads.text(product.payloads[0]));
  const semanticsProduct = findProduct(manifest, 'semantics');
  const semantics = semanticsProduct && usable(semanticsProduct.status)
    ? await payloads.parsed<SemanticPayload>(semanticsProduct.payloads[0])
    : null;
  return { graph, index: buildIndex(graph, semantics), semantics };
}

/** The model of the page's graph; null when the knowledge graph is not included. Rejects when a payload cannot be read. */
export function loadGraphModel(manifest: Manifest, payloads: PayloadReader): Promise<GraphModel | null> {
  let pending = models.get(payloads);
  if (!pending) {
    pending = build(manifest, payloads);
    models.set(payloads, pending);
  }
  return pending;
}
