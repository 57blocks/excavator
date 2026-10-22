/**
 * Which nodes the node-type and layer filters leave visible (openspec:
 * changes/viewer-app, design D8). A node is visible when its type is not hidden
 * and the layer (group) of its file is not hidden. A level draws an entry while
 * some file under it is visible; an edge end that is not visible takes no part
 * in an edge. The structure's own counts are facts about the graph, so they do
 * not change with the filters.
 */

import type { GraphIndex } from '../data/indexes';
import type { GraphFilters } from './graph-filters';
import { groupKeyOfFile, type Level, type LevelEntry, type Structure } from './graph-structure';

export interface Visibility {
  nodeVisible: (nodeId: string) => boolean;
  fileVisible: (fileId: string) => boolean;
}

/** The visibility under `filters`; null when no node type or layer is hidden, so nothing needs checking. */
export function visibilityOf(index: Pick<GraphIndex, 'nodesById' | 'owningFile'>, structure: Structure, filters: GraphFilters): Visibility | null {
  if (filters.nodeTypes.size === 0 && filters.layers.size === 0) return null;
  const fileVisible = (fileId: string) => {
    const file = index.nodesById.get(fileId);
    if (file && filters.nodeTypes.has(file.type)) return false;
    if (filters.layers.size === 0) return true;
    const key = groupKeyOfFile(structure, fileId);
    return key === null || !filters.layers.has(key);
  };
  const nodeVisible = (nodeId: string) => {
    const node = index.nodesById.get(nodeId);
    if (!node || filters.nodeTypes.has(node.type)) return false;
    const file = index.owningFile.get(nodeId);
    return file === undefined || fileVisible(file);
  };
  return { nodeVisible, fileVisible };
}

/** The level with the entries that have no visible file taken out; the level's own counts stay. */
export function visibleLevel(level: Level, visibility: Visibility | null): Level {
  if (visibility === null) return level;
  const keep = (entry: LevelEntry) => entry.members.some((file) => visibility.fileVisible(file.id));
  return { ...level, entries: level.entries.filter(keep) };
}
