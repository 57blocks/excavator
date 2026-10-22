import type { Manifest } from '../data/manifest';
import { loadGraphModel, type GraphModel } from '../data/model';
import type { PayloadReader } from '../data/payload';
import { filterChoices, type FilterChoices } from '../lib/graph-filters';
import { buildStructure, type Structure } from '../lib/graph-structure';
import { buildSearchIndex, type SearchEntry } from '../lib/search';
import { useLoaded, useViewer, type Loaded } from './viewer';

/** What the graph page and the top bar share: the graph, its structure and the search index, each built once per page load. */
export interface GraphScene {
  model: GraphModel;
  structure: Structure;
  search: SearchEntry[];
  choices: FilterChoices;
}

const scenes = new WeakMap<PayloadReader, Promise<GraphScene | null>>();

/** The scene of the page's graph; null when the knowledge graph is not included. Rejects when a payload cannot be read. */
export function loadGraphScene(manifest: Manifest, payloads: PayloadReader): Promise<GraphScene | null> {
  let pending = scenes.get(payloads);
  if (!pending) {
    pending = loadGraphModel(manifest, payloads).then((model) => {
      if (!model) return null;
      const structure = buildStructure(model.index);
      return {
        model,
        structure,
        search: buildSearchIndex(model.index.nodesById.values()),
        choices: filterChoices(model.index.nodesById.values(), model.graph.edges, structure),
      };
    });
    scenes.set(payloads, pending);
  }
  return pending;
}

/** The scene, loaded once `enabled` is true (the graph is not read for a page that has no use for it). */
export function useGraphScene(enabled: boolean): Loaded<GraphScene | null> {
  const { manifest, payloads } = useViewer();
  return useLoaded(enabled ? 'scene' : '', () => (enabled ? loadGraphScene(manifest, payloads) : Promise.resolve(null)));
}
