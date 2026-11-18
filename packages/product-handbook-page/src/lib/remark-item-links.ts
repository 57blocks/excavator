/** A minimal view of an mdast node: enough to walk the tree, replace text nodes and set element properties. */
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  url?: string;
  position?: { start: { line: number } };
  data?: { hProperties?: Record<string, unknown> };
}

export interface ItemLinkOptions {
  /** The ids of the problem rows (`d3`, `r12`, lower case) that exist; a `D<n>` or `R<n>` that is not among them stays text. */
  problems: ReadonlySet<string>;
  /** The ids of the processes (`P4`) that exist. */
  processes: ReadonlySet<string>;
  /** The address of the problems page at one row, and of one process. */
  problemHref: (rowId: string) => string;
  processHref: (id: string) => string;
}

/** The id the remedies page puts on the list item or paragraph that starts at `line` of its text (the anchor `page-problems.mjs` writes). */
export const remedyAnchorOf = (line: number): string => `remedy-${line}`;

const WIDE_COMMA = String.fromCharCode(0xff0c);
const ID = '[DRP]\\d+';
const GROUP = new RegExp(`\\[\\s*(${ID}(?:\\s*[,${WIDE_COMMA}]\\s*${ID})*)\\s*\\]`, 'g');
const LEADING = /^([DR]\d+)(?=\s)/;

/** Nodes whose text is never linked: code, links, headings and raw HTML. */
const SKIPPED = new Set(['code', 'inlineCode', 'link', 'linkReference', 'heading', 'html', 'definition']);

const textNode = (value: string): MdNode => ({ type: 'text', value });

/** The node for one id: a link when the id names an existing row or process, else its text. */
function idNode(id: string, options: ItemLinkOptions): MdNode {
  const known = id.startsWith('P') ? options.processes.has(id) : options.problems.has(id.toLowerCase());
  if (!known) return textNode(id);
  const url = id.startsWith('P') ? options.processHref(id) : options.problemHref(id.toLowerCase());
  return { type: 'link', url, children: [textNode(id)], data: { hProperties: { 'data-item': id } } };
}

/** One text value as text and link nodes, or null when it holds no id group and no leading id. */
function split(value: string, options: ItemLinkOptions, leading: boolean): MdNode[] | null {
  const out: MdNode[] = [];
  const push = (node: MdNode): void => {
    const last = out[out.length - 1];
    if (node.type === 'text' && last !== undefined && last.type === 'text') last.value = (last.value ?? '') + (node.value ?? '');
    else out.push(node);
  };
  let rest = value;
  let changed = false;
  if (leading) {
    const found = LEADING.exec(rest);
    if (found !== null) {
      push(idNode(found[1], options));
      rest = rest.slice(found[1].length);
      changed = true;
    }
  }
  let cursor = 0;
  for (const match of rest.matchAll(GROUP)) {
    const at = match.index as number;
    push(textNode(rest.slice(cursor, at)));
    const inner = match[0];
    let part = 0;
    push(textNode('['));
    part += 1;
    for (const id of inner.matchAll(new RegExp(ID, 'g'))) {
      const start = id.index as number;
      push(textNode(inner.slice(part, start)));
      push(idNode(id[0], options));
      part = start + id[0].length;
    }
    push(textNode(inner.slice(part)));
    cursor = at + inner.length;
    changed = true;
  }
  if (!changed) return null;
  push(textNode(rest.slice(cursor)));
  return out.filter((node) => node.type !== 'text' || node.value !== '');
}

function walk(node: MdNode, parent: MdNode | null, options: ItemLinkOptions): void {
  if (node.children === undefined) return;
  const next: MdNode[] = [];
  node.children.forEach((child, at) => {
    if (SKIPPED.has(child.type)) { next.push(child); return; }
    if (child.type === 'text' && child.value !== undefined) {
      const leading = at === 0 && node.type === 'paragraph' && parent !== null && parent.type === 'listItem';
      const pieces = split(child.value, options, leading);
      if (pieces === null) next.push(child);
      else next.push(...pieces);
      return;
    }
    walk(child, node, options);
    next.push(child);
  });
  node.children = next;
}

/** Give each list item, and each paragraph that does not start a list item, the id `remedy-<line>` of the line it starts on, and make it focusable, so a link can jump to it. */
function anchor(node: MdNode, parent: MdNode | null): void {
  const line = node.position?.start.line;
  const startsItem = node.type === 'paragraph' && parent !== null && parent.type === 'listItem' && parent.position?.start.line === line;
  if (line !== undefined && (node.type === 'listItem' || (node.type === 'paragraph' && !startsItem))) {
    node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: remedyAnchorOf(line), tabIndex: -1 } };
  }
  for (const child of node.children ?? []) anchor(child, node);
}

/**
 * A remark plugin for the improvement suggestions chapter: every item id in an id group (`[P4, R12, D3]`), and a bare id that
 * starts a list item (the generated section lists problems that way), becomes a link to its row on the problems page or its
 * process page when it exists, and stays text when it does not; every list item and paragraph gets the id `remedy-<line>`.
 * It reads the tree and changes only text nodes and the properties of items.
 */
export function remarkItemLinks(options: ItemLinkOptions): (tree: MdNode) => void {
  return (tree) => {
    anchor(tree, null);
    walk(tree, null, options);
  };
}
