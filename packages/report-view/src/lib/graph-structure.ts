/**
 * The grouping behind the structure graph (openspec: changes/viewer-app, design
 * D4; spec "Structure graph"). Everything here is read off the graph's own
 * records and paths; no group, file or count is made up:
 *   - the top level has one cluster per layer when the index has layers
 *     (semantic layers first, then the graph's own, already chosen by the data
 *     layer), plus one for the files no layer lists; without layers it has one
 *     container per member repo or top-level directory, and a group that holds
 *     most of the files is split one directory deeper (directories only, no
 *     community algorithm);
 *   - inside a cluster or container the level is its subdirectories (a chain of
 *     directories with one child and no file of its own is shown as one
 *     container) and its files; a file expands to the nodes it owns;
 *   - one level draws at most LEVEL_LIMIT nodes: the overflow is folded into
 *     containers that say how many they hold, and each opens as a level of its
 *     own, so nothing is dropped.
 * The structure is built once per graph; `buildLevel` answers for one place in it.
 */

import type { GraphNode } from '../data/graph';
import type { GraphIndex } from '../data/indexes';

/** The most nodes one level draws, folded containers included. */
export const LEVEL_LIMIT = 400;
/** A top-level directory group that holds more than this share of the files is split one directory deeper. */
const DOMINANT_SHARE = 0.7;
const ROOT_KEY = '.';
const UNLAYERED_KEY = '~unlayered';

export interface FileInfo {
  id: string;
  path: string;
  name: string;
  /** The nodes the file owns, itself included. */
  nodes: number;
}

export interface Group {
  key: string;
  label: string;
  note: string | null;
  kind: 'layer' | 'unlayered' | 'directory';
  files: readonly FileInfo[];
  nodes: number;
  /** The directory a directory group's own level starts at; '' for a layer, whose files come from many directories. */
  baseDir: string;
  /** A group of the files directly in one directory, left over when its directory was split. */
  directOnly: boolean;
}

interface DirNode {
  name: string;
  path: string;
  files: FileInfo[];
  direct: FileInfo[];
  children: Map<string, DirNode>;
  nodes: number;
}

export interface Structure {
  mode: 'layers' | 'directories';
  groups: readonly Group[];
  /** Every file node of the graph; each is in exactly one group. */
  files: readonly FileInfo[];
  /** Nodes that belong to no file node, and so are in no group. */
  unowned: number;
  /** What the layers say that the page cannot follow: files listed twice, ids that name no file. */
  notes: readonly string[];
  owned: ReadonlyMap<string, readonly GraphNode[]>;
  trees: Map<string, DirNode>;
}

const dirOf = (path: string) => (path.lastIndexOf('/') === -1 ? '' : path.slice(0, path.lastIndexOf('/')));
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const sum = (items: readonly { nodes: number }[]) => items.reduce((total, item) => total + item.nodes, 0);

function newDir(name: string, path: string): DirNode {
  return { name, path, files: [], direct: [], children: new Map(), nodes: 0 };
}

function buildTree(files: readonly FileInfo[]): DirNode {
  const root = newDir('', '');
  for (const file of files) {
    let node = root;
    node.files.push(file);
    node.nodes += file.nodes;
    const dir = dirOf(file.path);
    if (dir !== '') {
      let path = '';
      for (const segment of dir.split('/')) {
        path = path === '' ? segment : `${path}/${segment}`;
        let child = node.children.get(segment);
        if (!child) {
          child = newDir(segment, path);
          node.children.set(segment, child);
        }
        node = child;
        node.files.push(file);
        node.nodes += file.nodes;
      }
    }
    node.direct.push(file);
  }
  return root;
}

function dirAt(root: DirNode, path: string): DirNode | null {
  let node: DirNode | null = root;
  for (const segment of path === '' ? [] : path.split('/')) {
    node = node.children.get(segment) ?? null;
    if (!node) return null;
  }
  return node;
}

const fileInfo = (node: GraphNode, nodes: number): FileInfo => {
  const path = typeof node.filePath === 'string' && node.filePath !== '' ? node.filePath : node.name;
  return { id: node.id, path, name: baseName(path), nodes };
};

function layerGroups(index: GraphIndex, files: readonly FileInfo[]): { groups: Group[]; notes: string[] } {
  const byId = new Map(files.map((file) => [file.id, file]));
  const claimed = new Set<string>();
  let overlapping = 0;
  let unmatched = 0;
  const groups: Group[] = index.semantics.layers.map((layer) => {
    const members: FileInfo[] = [];
    const seen = new Set<string>();
    for (const nodeId of layer.nodeIds) {
      const file = byId.get(index.owningFile.get(nodeId) ?? '');
      if (!file) {
        unmatched += 1;
        continue;
      }
      if (seen.has(file.id)) continue;
      seen.add(file.id);
      // A file shows in the first layer that lists it.
      if (claimed.has(file.id)) {
        overlapping += 1;
        continue;
      }
      claimed.add(file.id);
      members.push(file);
    }
    return { key: layer.id, label: layer.name || layer.id, note: layer.description ?? null, kind: 'layer', files: members, nodes: sum(members), baseDir: '', directOnly: false };
  });
  const rest = files.filter((file) => !claimed.has(file.id));
  if (rest.length > 0) {
    groups.push({ key: UNLAYERED_KEY, label: 'Not in any layer', note: 'Files that no layer lists', kind: 'unlayered', files: rest, nodes: sum(rest), baseDir: '', directOnly: false });
  }
  const notes: string[] = [];
  if (overlapping > 0) notes.push(`${overlapping} file(s) are listed by more than one layer and show in the first.`);
  if (unmatched > 0) notes.push(`${unmatched} layer entries name no file of the graph.`);
  return { groups, notes };
}

interface Bucket {
  dir: string;
  files: FileInfo[];
  directOnly: boolean;
}

/** Top-level directory groups; a group with more than DOMINANT_SHARE of the files is split one directory deeper, again while one still holds that much. */
function directoryGroups(files: readonly FileInfo[]): Group[] {
  const buckets = new Map<string, Bucket>();
  const add = (key: string, dir: string, directOnly: boolean, file: FileInfo) => {
    const bucket = buckets.get(key);
    if (bucket) bucket.files.push(file);
    else buckets.set(key, { dir, files: [file], directOnly });
  };
  for (const file of files) {
    const dir = dirOf(file.path);
    if (dir === '') add(ROOT_KEY, '', true, file);
    else add(dir.split('/')[0], dir.split('/')[0], false, file);
  }
  for (;;) {
    const dominant = [...buckets].find(([, bucket]) => !bucket.directOnly && bucket.files.length > files.length * DOMINANT_SHARE);
    if (!dominant) break;
    const [key, bucket] = dominant;
    buckets.delete(key);
    for (const file of bucket.files) {
      const dir = dirOf(file.path);
      if (dir === bucket.dir) add(dir, dir, true, file);
      else {
        const next = `${bucket.dir}/${dir.slice(bucket.dir.length + 1).split('/')[0]}`;
        add(next, next, false, file);
      }
    }
  }
  return [...buckets]
    .map(([key, bucket]): Group => ({
      key,
      label: key === ROOT_KEY ? '(root)' : key,
      note: bucket.directOnly ? (key === ROOT_KEY ? 'Files at the project root' : 'Files directly in this directory') : null,
      kind: 'directory',
      files: bucket.files,
      nodes: sum(bucket.files),
      baseDir: bucket.dir,
      directOnly: bucket.directOnly,
    }))
    .sort((a, b) => b.files.length - a.files.length || (a.key < b.key ? -1 : 1));
}

/** Group the graph's file nodes (see the top of this file). */
export function buildStructure(index: GraphIndex): Structure {
  const filesOwned = new Map<string, GraphNode[]>();
  for (const [nodeId, fileId] of index.owningFile) {
    if (nodeId === fileId) continue;
    const node = index.nodesById.get(nodeId);
    if (!node) continue;
    const list = filesOwned.get(fileId);
    if (list) list.push(node);
    else filesOwned.set(fileId, [node]);
  }
  const start = (node: GraphNode) => (Array.isArray(node.lineRange) ? node.lineRange[0] : Number.POSITIVE_INFINITY);
  for (const list of filesOwned.values()) {
    list.sort((a, b) => start(a) - start(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
  }
  const files: FileInfo[] = [];
  for (const node of index.nodesById.values()) {
    if (node.type === 'file') files.push(fileInfo(node, 1 + (filesOwned.get(node.id)?.length ?? 0)));
  }
  const { groups, notes } = index.semantics.layers.length > 0 ? layerGroups(index, files) : { groups: directoryGroups(files), notes: [] };
  return {
    mode: index.semantics.layers.length > 0 ? 'layers' : 'directories',
    groups,
    files,
    unowned: index.unowned.length,
    notes,
    owned: filesOwned,
    trees: new Map(),
  };
}

function treeOf(structure: Structure, group: Group): DirNode {
  let tree = structure.trees.get(group.key);
  if (!tree) {
    tree = buildTree(group.files);
    structure.trees.set(group.key, tree);
  }
  return tree;
}

/** The nodes a file owns, up to `limit`, and how many are left out of that. */
export function fileChildren(structure: Structure, fileId: string, limit = LEVEL_LIMIT): { shown: readonly GraphNode[]; more: number } {
  const all = structure.owned.get(fileId) ?? [];
  return { shown: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}

export interface LevelEntry {
  /** The id of the node that draws the entry. A file's is its graph node id. */
  id: string;
  kind: 'cluster' | 'container' | 'file' | 'fold';
  label: string;
  note: string | null;
  files: number;
  nodes: number;
  /** The files the entry stands for, for the edges that run through it. */
  members: readonly FileInfo[];
  /** Where a click goes (a file has none: a click selects it). */
  target: { path: string; fold: string | null } | null;
  /** For a fold: how many entries it holds. */
  folded: number;
}

export interface Crumb {
  label: string;
  path: string;
  fold: string | null;
}

export interface Level {
  path: string;
  fold: string | null;
  group: Group | null;
  dir: string;
  /** What is drawn: the entries that fit and the folds that hold the rest. */
  entries: LevelEntry[];
  /** The entries the level has before any are folded. */
  total: number;
  /** The entries held in folds. */
  folded: number;
  /** The files, and the nodes they own, under the level. */
  files: number;
  nodes: number;
  crumbs: Crumb[];
}

const layerLike = (group: Group) => group.kind !== 'directory';

/** The route path of directory `dir` of a group. */
function pathOf(group: Group, dir: string): string {
  if (layerLike(group)) return dir === '' ? group.key : `${group.key}/${dir}`;
  return dir === group.baseDir ? group.key : dir;
}

/** The group a path names and the directory in it; null when the path names no group of this graph. */
function resolve(structure: Structure, path: string): { group: Group | null; dir: string } | null {
  if (path === '') return { group: null, dir: '' };
  let best: { group: Group; dir: string } | null = null;
  for (const group of structure.groups) {
    let dir: string | null = null;
    if (path === group.key) dir = group.baseDir;
    else if (!group.directOnly && group.key !== ROOT_KEY && path.startsWith(`${group.key}/`)) dir = layerLike(group) ? path.slice(group.key.length + 1) : path;
    if (dir !== null && (!best || group.key.length > best.group.key.length)) best = { group, dir };
  }
  return best;
}

/** `node`, or the directory that ends the chain of single-child directories below it. */
function compact(node: DirNode): DirNode {
  let end = node;
  while (end.direct.length === 0 && end.children.size === 1) end = [...end.children.values()][0];
  return end;
}

const byFilesThenLabel = (a: LevelEntry, b: LevelEntry) => b.files - a.files || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);

function containerEntry(group: Group, dir: DirNode, from: string): LevelEntry {
  const end = compact(dir);
  const label = end.path.slice(from === '' ? 0 : from.length + 1);
  return { id: `container:${pathOf(group, end.path)}`, kind: 'container', label, note: null, files: end.files.length, nodes: end.nodes, members: end.files, target: { path: pathOf(group, end.path), fold: null }, folded: 0 };
}

const fileEntry = (file: FileInfo): LevelEntry => ({ id: file.id, kind: 'file', label: file.name, note: file.path, files: 1, nodes: file.nodes, members: [file], target: null, folded: 0 });

/** A group's entry; a click goes to the first directory below the group that has more than one thing in it (the group's own level would show one container). */
function groupEntry(structure: Structure, group: Group): LevelEntry {
  const inside = compact(dirAt(treeOf(structure, group), group.baseDir) as DirNode);
  return {
    id: `group:${group.key}`,
    kind: layerLike(group) ? 'cluster' : 'container',
    label: group.label,
    note: group.note,
    files: group.files.length,
    nodes: group.nodes,
    members: group.files,
    target: { path: pathOf(group, inside.path), fold: null },
    folded: 0,
  };
}

/** The entries of a directory before folding: its subdirectories, largest first, then its files by path. */
function directoryEntries(group: Group, dir: DirNode): LevelEntry[] {
  const containers = [...dir.children.values()].map((child) => containerEntry(group, child, dir.path)).sort(byFilesThenLabel);
  const files = [...dir.direct].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map(fileEntry);
  return [...containers, ...files];
}

/**
 * The ranges `[from, to)` of the sorted entries that the folds of a level hold;
 * none when everything fits. The drawn entries and the folds together fill
 * LEVEL_LIMIT, and each fold holds at most that many entries. A level of more
 * than LEVEL_LIMIT * (LEVEL_LIMIT - 1) + 1 entries has more folds than the
 * limit leaves room for; it draws only folds then, and nothing is dropped.
 */
export function foldRanges(total: number): [number, number][] {
  if (total <= LEVEL_LIMIT) return [];
  const folds = Math.ceil((total - LEVEL_LIMIT) / (LEVEL_LIMIT - 1));
  const kept = folds < LEVEL_LIMIT ? LEVEL_LIMIT - folds : 0;
  return Array.from({ length: Math.ceil((total - kept) / LEVEL_LIMIT) }, (_, i): [number, number] => [kept + i * LEVEL_LIMIT, Math.min(total, kept + (i + 1) * LEVEL_LIMIT)]);
}

function foldEntry(path: string, range: [number, number], held: readonly LevelEntry[]): LevelEntry {
  const first = held[0];
  const last = held[held.length - 1];
  const members = held.flatMap((entry) => entry.members);
  return {
    id: `fold:${range[0]}-${range[1]}`,
    kind: 'fold',
    label: `${held.length} more`,
    note: held.length > 1 ? `${first.label} to ${last.label}` : first.label,
    files: members.length,
    nodes: sum(held),
    members,
    target: { path, fold: `${range[0]}-${range[1]}` },
    folded: held.length,
  };
}

function crumbsOf(group: Group | null, root: DirNode | null, dir: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: 'Project', path: '', fold: null }];
  if (!group || !root) return crumbs;
  crumbs.push({ label: group.label, path: group.key, fold: null });
  // Walk down from the group's own directory; a compacted chain is one step, as in the level it came from.
  let at = dirAt(root, group.baseDir) as DirNode;
  while (at.path !== dir) {
    const next = [...at.children.values()].find((child) => dir === child.path || dir.startsWith(`${child.path}/`)) as DirNode;
    const end = compact(next);
    const stop = dir === end.path || dir.startsWith(`${end.path}/`) ? end : (dirAt(root, dir) as DirNode);
    crumbs.push({ label: stop.path.slice(at.path === '' ? 0 : at.path.length + 1), path: pathOf(group, stop.path), fold: null });
    at = stop;
  }
  return crumbs;
}

/**
 * The level at `path` (see the route's `path` and `fold` parameters); null when
 * the path names no place of this graph, or the fold is none the level makes.
 */
export function buildLevel(structure: Structure, params: { path?: string | null; fold?: string | null } = {}): Level | null {
  const path = params.path ?? '';
  const place = resolve(structure, path);
  if (!place) return null;
  const { group } = place;
  let root: DirNode | null = null;
  let all: LevelEntry[];
  const { dir } = place;
  if (group === null) {
    all = structure.groups.map((g) => groupEntry(structure, g)).sort(byFilesThenLabel);
  } else {
    root = treeOf(structure, group);
    const at = dirAt(root, dir);
    if (!at) return null;
    all = directoryEntries(group, at);
  }

  const ranges = foldRanges(all.length);
  const fold = params.fold ?? null;
  let entries: LevelEntry[];
  let total = all.length;
  let folded = 0;
  if (fold !== null) {
    const range = ranges.find(([from, to]) => `${from}-${to}` === fold);
    if (!range) return null;
    entries = all.slice(range[0], range[1]);
    total = entries.length;
  } else if (ranges.length === 0) {
    entries = all;
  } else {
    entries = [...all.slice(0, ranges[0][0]), ...ranges.map((range) => foldEntry(path, range, all.slice(range[0], range[1])))];
    folded = all.length - ranges[0][0];
  }

  const crumbs = crumbsOf(group, root, dir);
  if (fold !== null) crumbs.push({ label: `Folded ${entries[0].label} to ${entries[entries.length - 1].label}`, path, fold });
  const held = fold !== null ? entries : all;
  return { path, fold, group, dir, entries, total, folded, files: held.reduce((n, entry) => n + entry.files, 0), nodes: sum(held), crumbs };
}

const LAYER_SOURCE_TEXT = { semantic: 'the semantic graph', graph: "the graph's layer records", none: '' } as const;

/** What the page says about how this level is grouped and what it leaves out. */
export function levelNotes(structure: Structure, level: Level, layerSource: keyof typeof LAYER_SOURCE_TEXT): string[] {
  const notes: string[] = [];
  if (level.group === null) {
    notes.push(structure.mode === 'layers' ? `Grouped by layer, from ${LAYER_SOURCE_TEXT[layerSource]}; inside a layer the files are grouped by directory.` : 'Grouped by directory: the graph has no layers.');
    notes.push(...structure.notes);
    if (structure.unowned > 0) notes.push(`${structure.unowned} node(s) belong to no file and are not drawn.`);
  } else if (layerLike(level.group)) {
    notes.push('Files are grouped by directory.');
  }
  if (level.folded > 0) notes.push(`${level.folded} entries beyond the ${LEVEL_LIMIT} a level draws are folded into containers that open as levels of their own.`);
  return notes;
}

const groupsOfFiles = new WeakMap<Structure, Map<string, Group>>();

/** The group that holds each file (a file shows in one group). */
function groupOfFile(structure: Structure, fileId: string): Group | null {
  let byFile = groupsOfFiles.get(structure);
  if (!byFile) {
    byFile = new Map();
    for (const group of structure.groups) for (const file of group.files) byFile.set(file.id, group);
    groupsOfFiles.set(structure, byFile);
  }
  return byFile.get(fileId) ?? null;
}

/** The group (layer or top-level directory) that holds file node `fileId`; null when none does. */
export function groupKeyOfFile(structure: Structure, fileId: string): string | null {
  return groupOfFile(structure, fileId)?.key ?? null;
}

/** The level `path` or the fold of it that draws the entry `entryId`, as route parameters; null when neither does. */
function drawnAt(structure: Structure, path: string, entryId: string): { path: string; fold: string | null } | null {
  const level = buildLevel(structure, { path });
  if (!level) return null;
  if (level.entries.some((entry) => entry.id === entryId)) return { path, fold: null };
  for (const [from, to] of foldRanges(level.total)) {
    const fold = `${from}-${to}`;
    if (buildLevel(structure, { path, fold })?.entries.some((entry) => entry.id === entryId)) return { path, fold };
  }
  return null;
}

/**
 * The level that draws file node `fileId`, as route parameters: the level of the
 * file's directory, or the fold of that level that holds it. Null when no level
 * of this graph draws the file.
 */
export function locateFile(structure: Structure, fileId: string): { path: string; fold: string | null } | null {
  const group = groupOfFile(structure, fileId);
  const file = group?.files.find((candidate) => candidate.id === fileId);
  if (!group || !file) return null;
  return drawnAt(structure, pathOf(group, dirOf(file.path)), fileId);
}

/** The place of the container that stands for directory `dir` inside `group`: its entry id, and where it is drawn. */
function containerIn(structure: Structure, group: Group, dir: string): { path: string; fold: string | null; entry: string } | null {
  const tree = treeOf(structure, group);
  if (dirAt(tree, dir) === null) return null;
  const base = group.baseDir;
  // A group that is one directory is drawn as a container at the top; a group of only the files directly in a directory stands for no whole directory.
  if (!layerLike(group) && dir === base) {
    if (group.directOnly) return null;
    const entry = `group:${group.key}`;
    const at = drawnAt(structure, '', entry);
    return at && { ...at, entry };
  }
  let at = dirAt(tree, base) as DirNode;
  while (at.path !== dir) {
    const next = [...at.children.values()].find((child) => dir === child.path || dir.startsWith(`${child.path}/`));
    if (!next) return null;
    const end = compact(next);
    // The container stands for the whole chain from `next` to `end`: they hold the same files.
    if (end.path === dir || end.path.startsWith(`${dir}/`)) {
      const entry = `container:${pathOf(group, end.path)}`;
      const place = drawnAt(structure, pathOf(group, at.path), entry);
      return place && { ...place, entry };
    }
    at = end;
  }
  return null;
}

/**
 * The container that stands for directory `dir` (a path as the hotspots and doc-map products write it): the level that
 * draws it, and the entry to select there. A directory whose files are in several groups (layers) is taken from the
 * group that holds most of them, the first of those that hold as many. A directory that no container stands for (the
 * project root, one that holds a whole group and more, one the graph has no file in) gives null.
 */
export function locateDirectory(structure: Structure, dir: string): { path: string; fold: string | null; entry: string } | null {
  const clean = dir.replace(/\/+$/, '');
  const prefix = `${clean}/`;
  const holders = structure.groups
    .map((group, order) => ({ group, order, count: group.files.filter((file) => file.path.startsWith(prefix)).length }))
    .filter((holder) => holder.count > 0)
    .sort((a, b) => b.count - a.count || a.order - b.order);
  for (const { group } of holders) {
    const place = containerIn(structure, group, clean);
    if (place) return place;
  }
  return null;
}
