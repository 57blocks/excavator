/**
 * The colour of each node type (openspec: changes/viewer-app, design D8): eight
 * kinds, each with a colour token in index.css, and a legend row per kind that
 * lists every node type it covers. A type the table does not know is drawn in
 * the muted grey and listed under `other` rather than given a kind it does not
 * have.
 */

export const NODE_KINDS = ['file', 'callable', 'type', 'config', 'docs', 'data', 'service', 'domain'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** Every node type of the graph schema, by kind. */
export const NODE_TYPES_BY_KIND: Record<NodeKind, readonly string[]> = {
  file: ['file', 'module'],
  callable: ['function'],
  type: ['class', 'component', 'componentSet', 'instance'],
  config: ['config', 'token', 'resource'],
  docs: ['document', 'article', 'page', 'source'],
  data: ['table', 'schema', 'entity', 'claim', 'topic', 'concept'],
  service: ['service', 'endpoint', 'pipeline', 'screen'],
  domain: ['domain', 'flow', 'step'],
};

const KIND_OF_TYPE = new Map<string, NodeKind>(NODE_KINDS.flatMap((kind) => NODE_TYPES_BY_KIND[kind].map((type) => [type, kind] as const)));

export const KIND_LABELS: Record<NodeKind, string> = {
  file: 'Files and modules',
  callable: 'Functions',
  type: 'Classes and components',
  config: 'Configuration',
  docs: 'Documents',
  data: 'Data and concepts',
  service: 'Services and entry points',
  domain: 'Domains, flows and steps',
};

export function nodeKind(type: string): NodeKind | null {
  return KIND_OF_TYPE.get(type) ?? null;
}

/** The CSS colour of a node type: the token of its kind, or muted grey for a type no kind lists. */
export function nodeColor(type: string): string {
  const kind = nodeKind(type);
  return kind === null ? 'var(--color-muted)' : `var(--color-node-${kind})`;
}

export interface LegendRow {
  label: string;
  /** The node types of the graph that this colour covers. */
  types: string[];
  colour: string;
}

/** One legend row for each kind some node type of the graph belongs to, and one `other` row for a type no kind lists. */
export function legendRows(types: Iterable<string>): LegendRow[] {
  const present = new Set(types);
  const rows: LegendRow[] = [];
  for (const kind of NODE_KINDS) {
    const own = NODE_TYPES_BY_KIND[kind].filter((type) => present.has(type));
    if (own.length > 0) rows.push({ label: KIND_LABELS[kind], types: own, colour: `var(--color-node-${kind})` });
  }
  const unknown = [...present].filter((type) => nodeKind(type) === null).sort();
  if (unknown.length > 0) rows.push({ label: 'Other', types: unknown, colour: 'var(--color-muted)' });
  return rows;
}
