// The structure treemap's data model (artifact-view task 5.1): a directory
// tree over the bundle's `files` table (one row per manifest entry), with each
// file's line count, language and symbols. Pure and DOM-free.
//
// Sizing: by `totalLines`. When no file has a count (no fingerprints.json) the
// whole tree is sized by file count and the page says so. When only some files
// lack a count (files fingerprints.json does not cover, such as extensionless
// scripts), they take no area and the page states how many; they stay listed
// in their directory's table, so none disappears silently.
//
// Language: the source index's chunk language for the file (the same language
// keys as the coverage record, so the overview's color mapping applies).
// Files the index does not cover, or every file when the bundle has no index,
// fall into a visible "unknown" language bucket; the page never guesses a
// language from an extension.
import { isTable, type Meta, type Segments } from '../data';

export interface TreeFile {
  kind: 'file';
  name: string;
  path: string;
  /** Line count from fingerprints.json; -1 when unknown. */
  lines: number;
  language: string | null;
  /** Row of the file's own node in `nodes`; -1 when the graph has no file node for it. */
  fileNode: number;
  /** Rows of the non-file nodes anchored in this file, in graph order. */
  symbols: number[];
}

export interface TreeDir {
  kind: 'dir';
  name: string;
  path: string;
  children: TreeEntry[];
  /** Files under this directory, at any depth. */
  files: number;
  /** Lines under this directory, counting only files with a known count. */
  lines: number;
  /** The language with the most weight (sizing unit) under this directory; null when none is known. */
  language: string | null;
  /** A member repository of a multi-repo target (top level only). */
  member: boolean;
}

export type TreeEntry = TreeDir | TreeFile;

export interface StructureModel {
  root: TreeDir;
  sizing: 'lines' | 'files';
  totalFiles: number;
  filesWithoutLines: number;
  /** Files whose language is unknown (not covered by the source index, or no index). */
  unknownLanguageFiles: number;
  /** Whether the bundle carries a source index at all (language colors need it). */
  hasIndex: boolean;
  /** Non-file nodes whose path is not a manifest file (shown as a count, never dropped silently). */
  symbolsOutsideFiles: number;
  byPath: Map<string, TreeEntry>;
}

/** The weight of an entry in the treemap's sizing unit. */
export function entryWeight(entry: TreeEntry, sizing: StructureModel['sizing']): number {
  if (entry.kind === 'dir') return sizing === 'lines' ? entry.lines : entry.files;
  return sizing === 'lines' ? Math.max(entry.lines, 0) : 1;
}

function cell(strings: string[], value: number | undefined): string | null {
  return value !== undefined && value >= 0 && typeof strings[value] === 'string' ? strings[value] : null;
}

export function buildStructure(segments: Segments, strings: string[], meta: Meta): StructureModel {
  const root: TreeDir = { kind: 'dir', name: '', path: '', children: [], files: 0, lines: 0, language: null, member: false };
  const byPath = new Map<string, TreeEntry>([['', root]]);
  const filesTable = segments.files;
  const nodes = segments.nodes;
  const chunks = segments['index.chunks'];

  // path -> language, from the source index chunks (first chunk of a path wins).
  const languageByPath = new Map<string, string>();
  const hasIndex = isTable(chunks);
  if (hasIndex && isTable(nodes) && chunks.columns.node && chunks.columns.language) {
    const rowByIdCell = new Map<number, number>();
    const ids = nodes.columns.id;
    for (let row = 0; row < nodes.rows; row += 1) rowByIdCell.set(ids[row], row);
    for (let row = 0; row < chunks.rows; row += 1) {
      const nodeRow = rowByIdCell.get(chunks.columns.node[row]);
      if (nodeRow === undefined) continue;
      const path = cell(strings, nodes.columns.path[nodeRow]);
      const language = cell(strings, chunks.columns.language[row]);
      if (path !== null && language !== null && !languageByPath.has(path)) languageByPath.set(path, language);
    }
  }

  const dirFor = (path: string): TreeDir => {
    const existing = byPath.get(path);
    if (existing && existing.kind === 'dir') return existing;
    const at = path.lastIndexOf('/');
    const parent = dirFor(at < 0 ? '' : path.slice(0, at));
    const dir: TreeDir = { kind: 'dir', name: at < 0 ? path : path.slice(at + 1), path, children: [], files: 0, lines: 0, language: null, member: false };
    parent.children.push(dir);
    byPath.set(path, dir);
    return dir;
  };

  let filesWithoutLines = 0;
  let unknownLanguageFiles = 0;
  const fileList: TreeFile[] = [];
  if (isTable(filesTable)) {
    const { path: pathCol, totalLines } = filesTable.columns;
    for (let row = 0; row < filesTable.rows; row += 1) {
      const path = cell(strings, pathCol?.[row]);
      if (path === null || byPath.has(path)) continue;
      const lines = totalLines ? totalLines[row] : -1;
      const at = path.lastIndexOf('/');
      const parent = dirFor(at < 0 ? '' : path.slice(0, at));
      const language = languageByPath.get(path) ?? null;
      const file: TreeFile = { kind: 'file', name: at < 0 ? path : path.slice(at + 1), path, lines, language, fileNode: -1, symbols: [] };
      parent.children.push(file);
      byPath.set(path, file);
      fileList.push(file);
      if (lines < 0) filesWithoutLines += 1;
      if (language === null) unknownLanguageFiles += 1;
    }
  }

  let symbolsOutsideFiles = 0;
  if (isTable(nodes)) {
    const { path: pathCol, type: typeCol } = nodes.columns;
    for (let row = 0; row < nodes.rows; row += 1) {
      const path = cell(strings, pathCol?.[row]);
      const entry = path === null ? undefined : byPath.get(path);
      const isFileNode = cell(strings, typeCol?.[row]) === 'file';
      if (!entry || entry.kind !== 'file') {
        if (!isFileNode) symbolsOutsideFiles += 1;
        continue;
      }
      if (isFileNode) {
        if (entry.fileNode < 0) entry.fileNode = row;
      } else entry.symbols.push(row);
    }
  }

  const sizing: StructureModel['sizing'] = fileList.length > 0 && filesWithoutLines === fileList.length ? 'files' : 'lines';
  const members = new Set((meta.members ?? []).map((m) => m.name));
  const finish = (dir: TreeDir): Map<string, number> => {
    const weights = new Map<string, number>();
    let files = 0;
    let lines = 0;
    for (const child of dir.children) {
      if (child.kind === 'dir') {
        for (const [language, weight] of finish(child)) weights.set(language, (weights.get(language) ?? 0) + weight);
        files += child.files;
        lines += child.lines;
      } else {
        files += 1;
        lines += Math.max(child.lines, 0);
        if (child.language !== null) weights.set(child.language, (weights.get(child.language) ?? 0) + entryWeight(child, sizing));
      }
    }
    dir.files = files;
    dir.lines = lines;
    let best: string | null = null;
    for (const [language, weight] of weights) {
      if (best === null || weight > (weights.get(best) as number) || (weight === weights.get(best) && language < best)) best = language;
    }
    dir.language = best;
    dir.children.sort((a, b) => entryWeight(b, sizing) - entryWeight(a, sizing) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return weights;
  };
  finish(root);
  for (const child of root.children) if (child.kind === 'dir' && members.has(child.name)) child.member = true;

  return {
    root,
    sizing,
    totalFiles: fileList.length,
    filesWithoutLines,
    unknownLanguageFiles,
    hasIndex,
    symbolsOutsideFiles,
    byPath,
  };
}

/** Ancestors of a path from the root ('' first) down to and including the path. */
export function breadcrumbs(path: string): string[] {
  if (path === '') return [''];
  const parts = path.split('/');
  return ['', ...parts.map((_, i) => parts.slice(0, i + 1).join('/'))];
}

export interface Located {
  /** The directory the treemap shows. */
  dir: TreeDir;
  /** The file selected in it (a `#/dir/<file path>` link), or null. */
  file: TreeFile | null;
}

/** Resolve a `#/dir/<path>` target: a directory, or a file shown selected in its directory; null when absent. */
export function locate(model: StructureModel, path: string): Located | null {
  const entry = model.byPath.get(path);
  if (!entry) return null;
  if (entry.kind === 'dir') return { dir: entry, file: null };
  const at = path.lastIndexOf('/');
  const parent = model.byPath.get(at < 0 ? '' : path.slice(0, at));
  return parent && parent.kind === 'dir' ? { dir: parent, file: entry } : null;
}
