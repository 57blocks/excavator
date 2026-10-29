export interface DiffCount {
  changed: number;
  affected: number;
}

interface LayerLike {
  id: string;
  nodeIds: string[];
}

interface NodeLike {
  filePath?: string;
}

/**
 * Per-layer diff counts for the layer overview.
 *
 * A diff node belongs to a layer when its id is in `layer.nodeIds`, or when it
 * is not itself in any layer and its `filePath` equals the `filePath` of a node
 * in that layer (function and class nodes usually only have their file in the
 * layer). Each node is counted once per layer.
 */
export function computeDiffLayerCounts(
  layers: readonly LayerLike[],
  nodesById: ReadonlyMap<string, NodeLike>,
  changedNodeIds: ReadonlySet<string>,
  affectedNodeIds: ReadonlySet<string>,
): Map<string, DiffCount> {
  const counts = new Map<string, DiffCount>();
  for (const layer of layers) counts.set(layer.id, { changed: 0, affected: 0 });

  const idToLayers = new Map<string, Set<string>>();
  const pathToLayers = new Map<string, Set<string>>();
  for (const layer of layers) {
    for (const nodeId of layer.nodeIds) {
      let ids = idToLayers.get(nodeId);
      if (!ids) idToLayers.set(nodeId, (ids = new Set()));
      ids.add(layer.id);
      const filePath = nodesById.get(nodeId)?.filePath;
      if (filePath) {
        let paths = pathToLayers.get(filePath);
        if (!paths) pathToLayers.set(filePath, (paths = new Set()));
        paths.add(layer.id);
      }
    }
  }

  const layersOf = (nodeId: string): ReadonlySet<string> | undefined => {
    const direct = idToLayers.get(nodeId);
    if (direct) return direct;
    const filePath = nodesById.get(nodeId)?.filePath;
    return filePath ? pathToLayers.get(filePath) : undefined;
  };

  for (const nodeId of changedNodeIds) {
    for (const layerId of layersOf(nodeId) ?? []) counts.get(layerId)!.changed++;
  }
  for (const nodeId of affectedNodeIds) {
    for (const layerId of layersOf(nodeId) ?? []) counts.get(layerId)!.affected++;
  }
  return counts;
}
