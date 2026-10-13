// What each graph node looks like, from the data the page already holds
// (artifact-view task 10.0): the explorer's items (member / directory / file /
// more / no path) and symbols (by graph node type) get a visual kind, a fill
// (language color through the shared mapping, or a neutral aggregate token),
// and, for directories and members, a language ring and a file-count badge
// from the structure model. One rule set for every level, so the same file or
// symbol has the same shape and color at the aggregate, directory and symbol
// levels. Pure and DOM-free.
import type { StructureModel } from './tree';
import { fillVar, languageRing, type RingSegment, type VisualKind } from './node-visual';

export interface NodeVisual {
  kind: VisualKind;
  /** Language of a file or symbol (null: unknown, or an aggregate). */
  language: string | null;
  /** Custom property the node is filled with, before layer coloring. */
  fill: string;
  /** Directory / member language ring (empty for files, symbols and unknown languages). */
  ring: RingSegment[];
  /** Directory / member: files under it per the structure model; null when the model does not hold it. */
  badge: number | null;
}

function fileLanguage(structure: StructureModel | null, path: string | null): string | null {
  if (!structure || path === null) return null;
  const entry = structure.byPath.get(path);
  return entry && entry.kind === 'file' ? entry.language : null;
}

/** An explorer item (`dir` / `member` / `file` / `more` / `nopath`) at the member, directory or file level. */
export function itemVisual(kind: 'member' | 'dir' | 'file' | 'more' | 'nopath', path: string, structure: StructureModel | null, colors: Map<string, string>): NodeVisual {
  if (kind === 'dir' || kind === 'member') {
    const entry = structure?.byPath.get(path);
    const dir = entry && entry.kind === 'dir' ? entry : null;
    return { kind, language: null, fill: fillVar(kind, null, colors), ring: dir ? languageRing(dir.languageWeights, colors) : [], badge: dir ? dir.files : null };
  }
  if (kind === 'file') {
    const language = fileLanguage(structure, path);
    return { kind, language, fill: fillVar(kind, language, colors), ring: [], badge: null };
  }
  return { kind, language: null, fill: fillVar(kind, null, colors), ring: [], badge: null };
}

/** A graph node drawn as a symbol (file and symbol levels, neighborhoods): its type, colored by its file's language. */
export function symbolVisual(type: string | null, path: string | null, structure: StructureModel | null, colors: Map<string, string>): NodeVisual {
  const kind = type ?? 'unknown';
  const language = fileLanguage(structure, path);
  return { kind, language, fill: fillVar(kind, language, colors), ring: [], badge: null };
}
