/**
 * "Locate in graph" (openspec: changes/viewer-app, design D3 and D7; spec
 * "Product overlays"): the address that shows a table row's node on the graph
 * and turns on the overlay of the row's product. The mapping is design D3's:
 *   unused-code  `unused[].id` is a node id;
 *   hotspots     a file `path` is the file node `file:<path>`, a directory
 *                `path` is the container that stands for the directory;
 *   doc-map      a file `path` is the file node `file:<path>`, a directory
 *                `path` is that container.
 * A row the graph has no node for gives a message instead, and the page says so
 * beside the row and does nothing else.
 */

import type { GraphIndex } from '../data/indexes';
import { fileNodeId } from '../data/indexes';
import { selectHash } from './graph-actions';
import { graphHash, TOP_LEVEL } from './graph-state';
import { locateDirectory, type Structure } from './graph-structure';
import type { OverlayName } from './overlay-names';

export type LocateTarget =
  | { kind: 'node'; nodeId: string }
  | { kind: 'file'; path: string }
  | { kind: 'directory'; path: string };

/** What the page says beside a row whose node the graph does not have. */
export const NOT_IN_GRAPH = 'Not in the graph.';
/** What it says beside a directory whose files are in the graph but that no single container stands for (its files are in several layers or groups, and none holds them all). */
export const NO_SINGLE_NODE = 'No single node of the graph stands for this directory.';

export type Located = { hash: string } | { message: string };

/**
 * Where `target` is in the graph, with `overlay` on (none when null): the address that shows it, or the message when the
 * graph has no such node. A node is selected where it is drawn; a directory is selected as the container of its level.
 */
export function locate(graph: { index: Pick<GraphIndex, 'nodesById' | 'owningFile'>; structure: Structure }, target: LocateTarget, overlay: OverlayName | null): Located {
  const overlays = overlay === null ? [] : [overlay];
  if (target.kind === 'directory') {
    const place = locateDirectory(graph.structure, target.path);
    if (place !== null) return { hash: graphHash({ ...TOP_LEVEL, path: place.path, fold: place.fold, entry: place.entry, overlays }) };
    const prefix = `${target.path.replace(/\/+$/, '')}/`;
    const hasFiles = graph.structure.files.some((file) => file.path.startsWith(prefix));
    return { message: hasFiles ? NO_SINGLE_NODE : NOT_IN_GRAPH };
  }
  const nodeId = target.kind === 'file' ? fileNodeId(target.path) : target.nodeId;
  if (!graph.index.nodesById.has(nodeId)) return { message: NOT_IN_GRAPH };
  return { hash: selectHash({ ...TOP_LEVEL, overlays }, graph.index, graph.structure, nodeId) };
}
