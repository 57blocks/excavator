interface NodeLike {
  filePath?: string;
}

/**
 * Container atoms touched by a diff.
 *
 * A diff node resolves to a container through `nodeToContainer` directly; a
 * node that is not itself drawn (function/class nodes at file detail level, or
 * nodes outside the layer's visible set) resolves through the container of a
 * drawn node that shares its `filePath`. A node whose own id is its container
 * (an ungrouped atom) is not counted.
 */
export function diffContainerIds(
  changedNodeIds: Iterable<string>,
  affectedNodeIds: Iterable<string>,
  nodeToContainer: ReadonlyMap<string, string>,
  nodesById: ReadonlyMap<string, NodeLike>,
): Set<string> {
  const out = new Set<string>();
  let containerByPath: Map<string, string> | null = null;

  const containerOf = (id: string): string | undefined => {
    const direct = nodeToContainer.get(id);
    if (direct) return direct;
    const filePath = nodesById.get(id)?.filePath;
    if (!filePath) return undefined;
    if (!containerByPath) {
      containerByPath = new Map();
      for (const [nodeId, cid] of nodeToContainer) {
        const p = nodesById.get(nodeId)?.filePath;
        if (p && !containerByPath.has(p)) containerByPath.set(p, cid);
      }
    }
    return containerByPath.get(filePath);
  };

  for (const ids of [changedNodeIds, affectedNodeIds]) {
    for (const id of ids) {
      const cid = containerOf(id);
      if (cid && cid !== id) out.add(cid);
    }
  }
  return out;
}
