/**
 * The layout of one level (openspec: changes/viewer-app, design D4): ELK
 * `layered`, run on the main thread from elkjs's bundled build. It places the
 * level's entries by the edges between them; the nodes a file owns are laid out
 * by hand inside the file's box, as a column of rows. Each run reports the time
 * ELK took, which the page publishes for the acceptance record.
 */

import ELK from 'elkjs/lib/elk.bundled.js';

import type { LevelEntry } from './graph-structure';

export interface Size {
  width: number;
  height: number;
}

export interface Box extends Size {
  x: number;
  y: number;
}

const CLUSTER_SIZE: Size = { width: 280, height: 120 };
const CONTAINER_SIZE: Size = { width: 240, height: 96 };
const FILE_SIZE: Size = { width: 240, height: 56 };
/** The rows of the nodes a file owns, inside an expanded file's box. */
const CHILD_ROW = 26;
const CHILD_INSET = 12;
const FILE_PADDING = 8;

/** The size of an entry's node; an expanded file grows by one row for each node it shows (and one for the note that more are not). */
export function entrySize(entry: LevelEntry, rows = 0): Size {
  if (entry.kind === 'cluster') return CLUSTER_SIZE;
  if (entry.kind === 'file') return rows === 0 ? FILE_SIZE : { width: FILE_SIZE.width, height: FILE_SIZE.height + rows * CHILD_ROW + FILE_PADDING };
  return CONTAINER_SIZE;
}

/** Where the `index`-th node an expanded file shows sits inside the file's box. */
export function childBox(index: number): Box {
  return { x: CHILD_INSET, y: FILE_SIZE.height + index * CHILD_ROW, width: FILE_SIZE.width - 2 * CHILD_INSET, height: CHILD_ROW - 4 };
}

export interface LevelLayout {
  boxes: Map<string, Box>;
  /** Milliseconds ELK took. */
  ms: number;
}

const OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.spacing.nodeNode': '36',
  'elk.layered.spacing.nodeNodeBetweenLayers': '72',
  'elk.padding': '[top=24,left=24,right=24,bottom=24]',
  // Things that no edge reaches are packed into rows instead of one long layer.
  'elk.separateConnectedComponents': 'true',
  'elk.aspectRatio': '1.8',
  // A long chain of ranks is wrapped into rows so the level stays about as wide as it is tall.
  'elk.layered.wrapping.strategy': 'MULTI_EDGE',
};

const elk = new ELK();

/** Place `nodes` by `links`, pairs of node ids; a link to a node that is not there is left out. */
export async function layoutNodes(nodes: readonly { id: string; size: Size }[], links: readonly (readonly [string, string])[]): Promise<LevelLayout> {
  const ids = new Set(nodes.map((node) => node.id));
  const seen = new Set<string>();
  const edges: { id: string; sources: string[]; targets: string[] }[] = [];
  for (const [source, target] of links) {
    const key = `${source.length}:${source}${target}`;
    if (source === target || !ids.has(source) || !ids.has(target) || seen.has(key)) continue;
    seen.add(key);
    edges.push({ id: `e${edges.length}`, sources: [source], targets: [target] });
  }
  const started = performance.now();
  const laid = await elk.layout({
    id: 'root',
    layoutOptions: OPTIONS,
    children: nodes.map((node) => ({ id: node.id, ...node.size })),
    edges,
  });
  const ms = performance.now() - started;
  const boxes = new Map<string, Box>();
  for (const child of laid.children ?? []) {
    boxes.set(child.id, { x: child.x ?? 0, y: child.y ?? 0, width: child.width ?? 0, height: child.height ?? 0 });
  }
  return { boxes, ms };
}
