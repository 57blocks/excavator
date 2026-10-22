/**
 * The plain fields of a node in the sidebar (openspec: changes/viewer-app,
 * design D5): its language, its layer and its place in its file. The language
 * is the node's own `language` field when it has one, else the language the
 * file's extension names; a file with an unknown extension has none shown.
 */

import type { GraphNode } from '../data/graph';
import type { GraphIndex } from '../data/indexes';
import { rangeText } from './code';
import { groupKeyOfFile, type Structure } from './graph-structure';

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript', tsx: 'TypeScript (JSX)', js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript (JSX)',
  py: 'Python', go: 'Go', rs: 'Rust', swift: 'Swift', kt: 'Kotlin', kts: 'Kotlin', java: 'Java', cs: 'C#', scala: 'Scala', dart: 'Dart',
  c: 'C', h: 'C', cc: 'C++', cpp: 'C++', cxx: 'C++', hpp: 'C++', m: 'Objective-C', rb: 'Ruby', php: 'PHP', sh: 'Shell',
  json: 'JSON', yml: 'YAML', yaml: 'YAML', md: 'Markdown', css: 'CSS', scss: 'SCSS', sql: 'SQL', graphql: 'GraphQL', html: 'HTML', xml: 'XML', toml: 'TOML',
};

/** The language of `node`: its `language` field, else the one its file's extension names; null when neither says. */
export function nodeLanguage(node: Pick<GraphNode, 'filePath' | 'name'> & { language?: unknown }): string | null {
  if (typeof node.language === 'string' && node.language !== '') return node.language;
  const path = typeof node.filePath === 'string' ? node.filePath : node.name;
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? null : (LANGUAGE_BY_EXTENSION[base.slice(dot + 1).toLowerCase()] ?? null);
}

/** The name of the layer that holds the node's file; null when the graph is not grouped by layer or no layer holds it. */
export function nodeLayerName(index: Pick<GraphIndex, 'owningFile'>, structure: Structure, nodeId: string): string | null {
  if (structure.mode !== 'layers') return null;
  const file = index.owningFile.get(nodeId);
  if (file === undefined) return null;
  const key = groupKeyOfFile(structure, file);
  return structure.groups.find((group) => group.key === key)?.label ?? null;
}

/** "12-20" for a node's line range, or null when it has none. */
export function nodeLines(node: Pick<GraphNode, 'lineRange'>): string | null {
  return rangeText(node.lineRange);
}
