import { buildDomainIndex, type DomainIndex, type DomainPayload } from '../data/domain';
import { findProduct, type Manifest } from '../data/manifest';
import type { PayloadReader } from '../data/payload';
import { loadGraphScene, type GraphScene } from './graph-scene';

/** What the domain view draws from: the domain graph, indexed, and the knowledge graph its steps point into. */
export interface DomainScene {
  index: DomainIndex;
  graph: GraphScene;
}

const scenes = new WeakMap<PayloadReader, Promise<DomainScene | null>>();

async function build(manifest: Manifest, payloads: PayloadReader): Promise<DomainScene | null> {
  const product = findProduct(manifest, 'domain-graph');
  if (!product || (product.status !== 'included' && product.status !== 'different-revision')) return null;
  const payload = await payloads.parsed<DomainPayload>(product.payloads[0]);
  const graph = await loadGraphScene(manifest, payloads);
  // The packer reads a domain graph only against a readable knowledge graph, so this does not happen with a page it wrote.
  if (!graph) throw new Error('the knowledge graph that the domain steps point into is not in the page');
  return { index: buildDomainIndex(payload), graph };
}

/** The scene of the page's domain graph; null when the domain graph is not in the page. Rejects when a payload cannot be read. */
export function loadDomainScene(manifest: Manifest, payloads: PayloadReader): Promise<DomainScene | null> {
  let pending = scenes.get(payloads);
  if (!pending) {
    pending = build(manifest, payloads);
    scenes.set(payloads, pending);
  }
  return pending;
}
