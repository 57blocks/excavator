/**
 * Whether a mermaid flowchart is one straight chain of steps with no text on its edges, and the steps' labels in
 * order. A chain reads better as a numbered list than as a tall drawing; anything else (a branch, a merge, two
 * starts, fewer than three steps, a cycle, text on an edge, a line this reader does not know) returns null and is
 * drawn as a diagram, so no part of a diagram is ever dropped by this rule.
 */

const HEADER = /^(?:flowchart|graph)\s+(?:TD|TB|LR)\s*;?$/i;
const ARROW = /^(?:-{2,}>|={2,}>|-\.+->)/;
const CLOSER: Record<string, string> = { '[': ']', '(': ')', '{': '}' };

interface Parsed { id: string; label: string | null; end: number }

/** One node reference at `at`: an id with an optional shape (`[x]`, `(x)`, `{x}`, `([x])`, `[[x]]`, `((x))`, quoted or not). */
function readNode(text: string, at: number): Parsed | null {
  const head = /^[A-Za-z_][\w-]*/.exec(text.slice(at));
  if (head === null) return null;
  const id = head[0];
  let pos = at + id.length;
  if (!(text[pos] in CLOSER)) return { id, label: null, end: pos };
  let opener = '';
  while (text[pos] !== undefined && text[pos] in CLOSER) { opener += text[pos]; pos += 1; }
  const closer = [...opener].reverse().map((char) => CLOSER[char]).join('');
  let body: string;
  if (text[pos] === '"') {
    const quote = text.indexOf('"', pos + 1);
    if (quote === -1) return null;
    body = text.slice(pos + 1, quote);
    pos = quote + 1;
    if (!text.startsWith(closer, pos)) return null;
  } else {
    const close = text.indexOf(closer, pos);
    if (close === -1) return null;
    body = text.slice(pos, close);
    pos = close;
  }
  const label = body.replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
  return { id, label: label === '' ? null : label, end: pos + closer.length };
}

/** The labels of the steps in order when `source` is a chain of at least three steps, else null. */
export function chainSteps(source: string): string[] | null {
  const lines = source.split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('%%'));
  if (lines.length < 2 || !HEADER.test(lines[0])) return null;
  const labels = new Map<string, string | null>();
  const next = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  const note = (parsed: Parsed): void => {
    if (!labels.has(parsed.id)) { labels.set(parsed.id, null); next.set(parsed.id, []); incoming.set(parsed.id, 0); }
    if (parsed.label !== null) labels.set(parsed.id, parsed.label);
  };
  for (const line of lines.slice(1)) {
    const text = line.replace(/;$/, '');
    let node = readNode(text, 0);
    if (node === null) return null;
    note(node);
    let pos = node.end;
    while (pos < text.length) {
      const space = /^\s*/.exec(text.slice(pos))![0].length;
      const arrow = ARROW.exec(text.slice(pos + space));
      if (arrow === null) return null;
      pos += space + arrow[0].length;
      pos += /^\s*/.exec(text.slice(pos))![0].length;
      const target = readNode(text, pos);
      if (target === null) return null; // `-->|text|` and anything else after an arrow
      note(target);
      next.get(node.id)!.push(target.id);
      incoming.set(target.id, incoming.get(target.id)! + 1);
      node = target;
      pos = target.end;
    }
  }
  if (labels.size < 3) return null;
  for (const [id, targets] of next) if (targets.length > 1 || incoming.get(id)! > 1) return null;
  const starts = [...labels.keys()].filter((id) => incoming.get(id) === 0);
  if (starts.length !== 1) return null;
  const order: string[] = [];
  const seen = new Set<string>();
  for (let id: string | undefined = starts[0]; id !== undefined && !seen.has(id); id = next.get(id)![0]) { seen.add(id); order.push(id); }
  if (order.length !== labels.size) return null;
  return order.map((id) => labels.get(id) ?? id);
}
