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
  /** The short title of each problem row by id (lower case); with it, each item gets one line per `D<n>` or `R<n>` of its id groups that is a row: `problemLabel`, the id, the title, the last two linked to the row. */
  summaries?: ReadonlyMap<string, string>;
  problemLabel?: string;
  /** Added to the line of an item for its id `remedy-<line>`, for an item rendered alone from the line `lineOffset + 1`. */
  lineOffset?: number;
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
function split(value: string, options: ItemLinkOptions, leading: boolean, dropping: boolean): MdNode[] | null {
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
    // An item that has problem lines names its D and R rows there, so they leave the group; a group left empty goes with its brackets and the space before them.
    const kept = all.filter((id) => !(dropping && !id.startsWith('P') && options.summaries?.has(id.toLowerCase()) === true));
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

function walk(node: MdNode, parent: MdNode | null, options: ItemLinkOptions, lines: Map<MdNode, string[]>, dropping = false): void {
  if (node.children === undefined) return;
  const next: MdNode[] = [];
  node.children.forEach((child, at) => {
    if (SKIPPED.has(child.type)) { next.push(child); return; }
    if (child.type === 'text' && child.value !== undefined) {
      const leading = at === 0 && node.type === 'paragraph' && parent !== null && parent.type === 'listItem';
      const pieces = split(child.value, options, leading, dropping);
      if (pieces === null) next.push(child);
      else next.push(...pieces);
      return;
    }
    walk(child, node, options, lines, dropping || lines.has(child));
    next.push(child);
  });
  node.children = next;
}

/** Give each list item, and each paragraph that does not start a list item, the id `remedy-<line>` of the line it starts on, and make it focusable, so a link can jump to it. */
function anchor(node: MdNode, parent: MdNode | null, offset: number): void {
  const line = node.position?.start.line;
  const startsItem = node.type === 'paragraph' && parent !== null && parent.type === 'listItem' && parent.position?.start.line === line;
  if (line !== undefined && (node.type === 'listItem' || (node.type === 'paragraph' && !startsItem))) {
    node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: remedyAnchorOf(line + offset), tabIndex: -1 } };
  }
  for (const child of node.children ?? []) anchor(child, node, offset);
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

/** An item whose paragraph is the start of a list item is handled by the list item. */
const isBlock = (node: MdNode, parent: MdNode | null): boolean => node.type === 'listItem' || (node.type === 'paragraph' && !(parent !== null && parent.type === 'listItem'));

/** The ids of the problem rows each block (list item or paragraph) names, read before the ids are turned into links. */
function problemLinesOf(node: MdNode, parent: MdNode | null, options: ItemLinkOptions, into: Map<MdNode, string[]>): void {
  if (isBlock(node, parent)) {
    const known = problemIds(node).filter((id) => options.summaries?.has(id.toLowerCase()) === true);
    if (known.length > 0) into.set(node, known);
  }
  for (const child of node.children ?? []) problemLinesOf(child, node, options, into);
}

const link = (url: string, text: string, part: string): MdNode => ({ type: 'link', url, children: [textNode(text)], data: { hProperties: { 'data-item': part } } });

/** The most problem lines an item shows at once; the rest are behind one row that unfolds. */
export const MAX_PROBLEM_LINES = 3;

/** The block of the lines of one item: for each id one `div` of the label, the id and the title, the last two linked to the row. */
function problemBlock(ids: string[], options: ItemLinkOptions): MdNode {
  return {
    type: 'remedyProblems',
    data: { hName: 'div', hProperties: { className: ['remedy-problems'], 'data-part': 'remedy-problems' } },
    children: [...ids.slice(0, MAX_PROBLEM_LINES).map((id) => problemLine(id, options)), ...(ids.length > MAX_PROBLEM_LINES
      ? [{ type: 'remedyMore', data: { hName: 'remedy-more', hProperties: { 'data-count': ids.length - MAX_PROBLEM_LINES } }, children: ids.slice(MAX_PROBLEM_LINES).map((id) => problemLine(id, options)) }]
      : [])],
  };
}

/** One line: the label, the id and the title, the last two linked to the row. */
function problemLine(id: string, options: ItemLinkOptions): MdNode {
  {
    {
      const key = id.toLowerCase();
      const href = options.problemHref(key);
      return {
        type: 'remedyProblem',
        data: { hName: 'div', hProperties: { className: ['remedy-problem'], 'data-problem-line': id } },
        children: [
          { type: 'remedyLabel', data: { hName: 'span', hProperties: { className: ['remedy-problem-label'] } }, children: [textNode(options.problemLabel ?? '')] },
          textNode(' '),
          link(href, id, id),
          textNode(' '),
          { ...link(href, options.summaries?.get(key) ?? '', `${id}-title`), data: { hProperties: { 'data-item': `${id}-title`, className: ['remedy-problem-title'] } } },
        ],
      };
    }
  }
}

/** Put the lines in front of the content of a list item, and in front of a paragraph that is no list item's. */
function insertProblemLines(node: MdNode, lines: Map<MdNode, string[]>, options: ItemLinkOptions): void {
  if (node.children === undefined) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    insertProblemLines(child, lines, options);
    const ids = lines.get(child);
    if (ids === undefined) { next.push(child); continue; }
    if (child.type === 'listItem') child.children = [problemBlock(ids, options), ...(child.children ?? [])];
    else next.push(problemBlock(ids, options));
    next.push(child);
  }
  node.children = next;
}

/**
 * A remark plugin for the improvement suggestions chapter: every item id in an id group (`[P4, R12, D3]`), and a bare id that
 * starts a list item (the generated section lists problems that way), becomes a link to its row on the problems page or its
 * process page when it exists, and stays text when it does not; every list item and paragraph gets the id `remedy-<line>`.
 * With `summaries`, each item also gets one line per problem it names (`problemBlock`). It reads the tree and changes only text
 * nodes and the properties of items, and adds those lines.
 */
export function remarkItemLinks(options: ItemLinkOptions): (tree: MdNode) => void {
  return (tree) => {
    const lines = new Map<MdNode, string[]>();
    if (options.summaries !== undefined) problemLinesOf(tree, null, options, lines);
    anchor(tree, null, options.lineOffset ?? 0);
    walk(tree, null, options, lines);
    if (lines.size > 0) insertProblemLines(tree, lines, options);
  };
}
