/** A minimal view of an mdast node: enough to walk the tree and replace text nodes. */
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  url?: string;
  data?: { hProperties?: Record<string, string> };
}

export interface FeatureLinkOptions {
  /** The title of each chapter of the page, by chapter id; an id not in it is never linked. */
  titles: Record<string, string>;
  /** The address of a chapter in the view the reader is in. */
  hrefOf: (id: string) => string;
  /** The chapter this text belongs to, which is not linked from itself. */
  own?: string;
}

// Full-width parentheses are built from code points so that the source stays ASCII.
const OPEN_WIDE = String.fromCharCode(0xff08);
const CLOSE_WIDE = String.fromCharCode(0xff09);
const REFERENCE = new RegExp(`\\((F\\d+)\\)|${OPEN_WIDE}(F\\d+)${CLOSE_WIDE}`, 'g');

/** Nodes whose text is never linked: code, links, headings (the table of contents numbers them) and raw HTML. */
const SKIPPED = new Set(['code', 'inlineCode', 'link', 'linkReference', 'heading', 'html', 'definition']);

const link = (id: string, text: string, href: string): MdNode => ({
  type: 'link',
  url: href,
  children: [{ type: 'text', value: text }],
  data: { hProperties: { 'data-feature': id } },
});

/** Split one text value into text and link nodes; returns null when nothing in it is a linkable reference. */
function split(value: string, options: FeatureLinkOptions): MdNode[] | null {
  const out: MdNode[] = [];
  const push = (text: string): void => {
    if (text === '') return;
    const last = out[out.length - 1];
    if (last !== undefined && last.type === 'text') last.value = (last.value ?? '') + text;
    else out.push({ type: 'text', value: text });
  };
  let cursor = 0;
  for (const match of value.matchAll(REFERENCE)) {
    const id = match[1] ?? match[2];
    const title = options.titles[id];
    if (title === undefined || title === '' || id === options.own) continue;
    const at = match.index as number;
    const before = value.slice(cursor, at);
    const trimmed = before.trimEnd();
    if (trimmed.endsWith(title)) {
      push(trimmed.slice(0, trimmed.length - title.length));
      out.push(link(id, title, options.hrefOf(id)));
    } else {
      push(before);
      push(match[0].charAt(0));
      out.push(link(id, id, options.hrefOf(id)));
      push(match[0].charAt(match[0].length - 1));
    }
    cursor = at + match[0].length;
  }
  if (cursor === 0) return null;
  push(value.slice(cursor));
  return out;
}

function walk(node: MdNode, options: FeatureLinkOptions): void {
  if (node.children === undefined) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (SKIPPED.has(child.type)) { next.push(child); continue; }
    if (child.type === 'text' && child.value !== undefined) {
      const pieces = split(child.value, options);
      if (pieces === null) next.push(child);
      else next.push(...pieces);
      continue;
    }
    walk(child, options);
    next.push(child);
  }
  node.children = next;
}

/** A remark plugin: `Title (F12)` and `Title (full-width F12)` in the running text become links to the chapter of F12. It reads the tree and changes only text nodes. */
export function remarkFeatureLinks(options: FeatureLinkOptions): (tree: MdNode) => void {
  return (tree) => walk(tree, options);
}
