/** A minimal view of an mdast node: enough to walk the tree, replace text nodes and set element properties. */
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  url?: string;
  position?: { start: { line: number } };
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

export interface ItemLinkOptions {
  /** The ids of the problem rows (`d3`, `r12`, lower case) that exist; a `D<n>` or `R<n>` that is not among them stays text. */
  problems: ReadonlySet<string>;
  /** The ids of the processes (`P4`) that exist. */
  processes: ReadonlySet<string>;
  /** The address of the problems page at one row, and of one process. */
  problemHref: (rowId: string) => string;
  processHref: (id: string) => string;
  /** With `plain`: the short title of each problem row by id (lower case), the labels of the two rows of an item and the separator of the titles. */
  summaries?: ReadonlyMap<string, string>;
  problemLabel?: string;
  suggestionLabel?: string;
  separator?: string;
  /** Added to the line of an item for its id `remedy-<line>`, for an item rendered alone from the line `lineOffset + 1`. */
  lineOffset?: number;
  /** The start of the id of an item before its line, `remedy-` unless given (the remedies page has an item under several domains, each with its own). */
  anchorPrefix?: string;
  /** Plain text for the reader who does not see numbers: every id group leaves the sentence, and each item is a row of its problems' titles and a row of the suggestion, no id and no link. */
  plain?: boolean;
  /** With `plain`: the rows (`d3`, `r12`) the lines are for, in order, instead of the ones the id groups of the item name. */
  problemIds?: readonly string[];
  /** With `plain`: a first row of each item, the process the item was written under, as its label and a link to the process page. */
  processRow?: { label: string; name: string; href: string };
}

/** The id the remedies page puts on the list item or paragraph that starts at `line` of its text (the anchor `page-problems.mjs` writes). */
export const remedyAnchorOf = (line: number, prefix = 'remedy-'): string => `${prefix}${line}`;

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
    const inner = match[0];
    const all = Array.from(inner.matchAll(new RegExp(ID, 'g'))).map((id) => id[0]);
    // A process number never shows, and in plain text the whole group leaves the sentence; a group left empty goes with its brackets and the space before them.
    const kept = all.filter((id) => !(options.plain === true || id.startsWith('P')));
    if (kept.length < all.length) {
      const before = rest.slice(cursor, at);
      if (kept.length === 0) push(textNode(before.replace(/\s+$/, '')));
      else {
        push(textNode(`${before}[`));
        kept.forEach((id, index) => { if (index > 0) push(textNode(', ')); push(idNode(id, options)); });
        push(textNode(']'));
      }
      cursor = at + inner.length;
      changed = true;
      continue;
    }
    push(textNode(rest.slice(cursor, at)));
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
function anchor(node: MdNode, parent: MdNode | null, offset: number, prefix: string): void {
  const line = node.position?.start.line;
  const startsItem = node.type === 'paragraph' && parent !== null && parent.type === 'listItem' && parent.position?.start.line === line;
  if (line !== undefined && (node.type === 'listItem' || (node.type === 'paragraph' && !startsItem))) {
    node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: remedyAnchorOf(line + offset, prefix), tabIndex: -1 } };
  }
  for (const child of node.children ?? []) anchor(child, node, offset, prefix);
}

/** The D and R ids of the id groups in the text of `node` (code, links and the like are not read), in order, each once. */
function problemIds(node: MdNode, into: string[] = []): string[] {
  for (const child of node.children ?? []) {
    if (SKIPPED.has(child.type)) continue;
    if (child.type === 'text' && child.value !== undefined) {
      for (const group of child.value.matchAll(GROUP)) {
        for (const id of group[0].matchAll(new RegExp(ID, 'g'))) if (id[0].startsWith('D') || id[0].startsWith('R')) if (!into.includes(id[0])) into.push(id[0]);
      }
    } else problemIds(child, into);
  }
  return into;
}

/** The ids of the problem rows each block (list item or paragraph) names, read before the ids are turned into links. */
function problemLinesOf(node: MdNode, _parent: MdNode | null, options: ItemLinkOptions, into: Map<MdNode, string[]>): void {
  if (node.type === 'listItem') {
    const named = options.problemIds !== undefined ? options.problemIds.map((id) => id.toUpperCase()) : problemIds(node);
    into.set(node, named.filter((id) => options.summaries?.has(id.toLowerCase()) === true));
  }
  for (const child of node.children ?? []) problemLinesOf(child, node, options, into);
}

/** The most problem titles an item shows at once; the rest are behind a button on the same row. */
export const MAX_PROBLEM_TITLES = 3;

const el = (type: string, tag: string, className: string, children: MdNode[], extra: Record<string, unknown> = {}): MdNode => ({ type, data: { hName: tag, hProperties: { className: [className], ...extra } }, children });

/** One title of a problem, in plain text; the id is only an attribute. */
const titleNode = (id: string, options: ItemLinkOptions): MdNode => el('remedyTitle', 'span', 'remedy-problem-title', [textNode(options.summaries?.get(id.toLowerCase()) ?? '')], { 'data-problem-line': id });

/** The row of the problems of an item: the label once, then the titles on one line joined by the separator, the first three, then a button for the rest. */
function problemRow(ids: string[], options: ItemLinkOptions): MdNode {
  const separator = options.separator ?? '; ';
  const joined = (list: string[], first: boolean): MdNode[] => list.flatMap((id, at) => [...(first && at === 0 ? [] : [textNode(separator)]), titleNode(id, options)]);
  const rest = ids.slice(MAX_PROBLEM_TITLES);
  const value = [
    ...joined(ids.slice(0, MAX_PROBLEM_TITLES), true),
    ...(rest.length === 0 ? [] : [{ type: 'remedyMore', data: { hName: 'remedy-more', hProperties: { 'data-count': rest.length } }, children: joined(rest, false) }]),
  ];
  return el('remedyRow', 'div', 'remedy-row', [
    el('remedyLabel', 'span', 'remedy-row-label', [textNode(options.problemLabel ?? '')]),
    el('remedyValue', 'div', 'remedy-row-content', value),
  ], { 'data-part': 'remedy-problems' });
}

/** The row of the suggestion: its label, then what the list item held. */
const suggestionRow = (children: MdNode[], options: ItemLinkOptions): MdNode => el('remedyRow', 'div', 'remedy-row', [
  el('remedyLabel', 'span', 'remedy-row-label', [textNode(options.suggestionLabel ?? '')]),
  el('remedyValue', 'div', 'remedy-row-content', children),
], { 'data-part': 'remedy-suggestion' });

/** The row of the process an item was written under: its label, then the process name as a link to its page. */
const processRowOf = (process: NonNullable<ItemLinkOptions['processRow']>): MdNode => el('remedyRow', 'div', 'remedy-row', [
  el('remedyLabel', 'span', 'remedy-row-label', [textNode(process.label)]),
  el('remedyValue', 'div', 'remedy-row-content', [{ type: 'link', url: process.href, children: [textNode(process.name)] }]),
], { 'data-part': 'remedy-process' });

/**
 * Every list item of a plain-text chapter text as rows: its process (only with `processRow`), its problems (none: no row) and its
 * suggestion. The rows are the only children of the item, so they share one grid and their labels one column.
 */
function layoutItems(node: MdNode, rows: Map<MdNode, string[]>, options: ItemLinkOptions): void {
  for (const child of node.children ?? []) {
    layoutItems(child, rows, options);
    const ids = rows.get(child);
    if (ids === undefined || child.type !== 'listItem') continue;
    child.children = [
      ...(options.processRow === undefined ? [] : [processRowOf(options.processRow)]),
      ...(ids.length === 0 ? [] : [problemRow(ids, options)]),
      suggestionRow(child.children ?? [], options),
    ];
  }
}

/**
 * A remark plugin for the improvement suggestions chapter. Without `plain`: every item id in an id group (`[P4, R12, D3]`), and a
 * bare id that starts a list item (the generated section lists problems that way), becomes a link to its row on the problems page
 * when it exists and stays text when it does not (a process number never shows); every list item and paragraph gets the id
 * `remedy-<line>`. With `plain` (an item rendered alone): the id groups leave the sentence and each list item is two rows, the
 * problems it names (their titles in plain text, no id and no link) and the suggestion. It changes only text nodes, the properties
 * of items and the children of list items.
 */
export function remarkItemLinks(options: ItemLinkOptions): (tree: MdNode) => void {
  return (tree) => {
    const rows = new Map<MdNode, string[]>();
    if (options.plain === true) problemLinesOf(tree, null, options, rows);
    anchor(tree, null, options.lineOffset ?? 0, options.anchorPrefix ?? 'remedy-');
    walk(tree, null, options);
    if (rows.size > 0) layoutItems(tree, rows, options);
  };
}
