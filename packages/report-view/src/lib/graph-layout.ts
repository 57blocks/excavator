/**
 * The layout of one level (openspec: changes/viewer-app, design D4): ELK
 * `layered`, run on the main thread from elkjs's bundled build. It places the
 * level's entries by the edges between them; the nodes a file owns are laid out
 * by hand inside the file's box, as a column of rows. A level whose entries are
 * joined by about as many edges as it takes to join each to most of the others
 * (a layered layout of those is a tall chain, drawn small) is placed in ELK's
 * `rectpacking` grid instead, in the order of the entries, with the edges drawn
 * as straight lines between the boxes. Each run reports the time ELK took, which
 * the page publishes for the acceptance record.
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

/** The size of a cluster card, the structure graph's top-level card; the domain view draws its domain and flow cards at the same size. */
export const CLUSTER_SIZE: Size = { width: 340, height: 144 };
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
  /** `layered` places entries by their edges; `grid` packs them in rows in the order given. */
  kind: 'layered' | 'grid';
}

/** A level of at least this many entries, with at least this many edges for each, is laid out as a grid. */
const GRID_MIN_ENTRIES = 4;
const GRID_EDGES_PER_ENTRY = 2;

/** Whether a level with `entries` entries and `edges` drawn edges is placed as a grid: it is dense enough that a layered layout would be one tall chain. */
export function prefersGrid(entries: number, edges: number): boolean {
  return entries >= GRID_MIN_ENTRIES && edges >= GRID_EDGES_PER_ENTRY * entries;
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

const GRID_OPTIONS = {
  'elk.algorithm': 'rectpacking',
  'elk.aspectRatio': '1.4',
  'elk.spacing.nodeNode': '56',
  'elk.padding': '[top=24,left=24,right=24,bottom=24]',
};

const elk = new ELK();

/** The layered options that keep a chain of nodes in one column instead of wrapping it into rows, closer together (the steps of a flow). */
export const COLUMN_OPTIONS = { 'elk.layered.wrapping.strategy': 'OFF', 'elk.layered.spacing.nodeNodeBetweenLayers': '40' } as const;

/**
 * Place `nodes` by `links`, pairs of node ids; a link to a node that is not there is left out. With `grid` the nodes are packed
 * in rows in the order given; `options` replace the options of either layout for this run.
 */
export async function layoutNodes(nodes: readonly { id: string; size: Size }[], links: readonly (readonly [string, string])[], { grid = false, options }: { grid?: boolean; options?: Readonly<Record<string, string>> } = {}): Promise<LevelLayout> {
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
    layoutOptions: { ...(grid ? GRID_OPTIONS : OPTIONS), ...options },
    children: nodes.map((node) => ({ id: node.id, ...node.size })),
    edges,
  });
  const ms = performance.now() - started;
  const boxes = new Map<string, Box>();
  for (const child of laid.children ?? []) {
    boxes.set(child.id, { x: child.x ?? 0, y: child.y ?? 0, width: child.width ?? 0, height: child.height ?? 0 });
  }
  return { boxes, ms, kind: grid ? 'grid' : 'layered' };
}
