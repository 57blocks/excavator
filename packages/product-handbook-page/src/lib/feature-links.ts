/** A piece of a hand-over text: plain text, or a feature chapter's title that links to the chapter. */
export type Segment = { kind: 'text'; text: string } | { kind: 'link'; id: string; text: string };

const REFERENCE = /\((F\d+)\)/g;

/**
 * Turn the `(F<n>)` references of a hand-over text into links to the chapters. When the text right before a reference ends
 * with that chapter's title, the title becomes the link and the reference is dropped; otherwise the reference is replaced by
 * a link whose text is the chapter's title. A reference to a chapter the page does not have stays as written.
 */
export function linkFeatures(text: string, titleOf: (id: string) => string | undefined): Segment[] {
  const out: Segment[] = [];
  const push = (piece: string): void => { if (piece !== '') out.push({ kind: 'text', text: piece }); };
  let cursor = 0;
  for (const match of text.matchAll(REFERENCE)) {
    const id = match[1];
    const title = titleOf(id);
    const at = match.index as number;
    if (title === undefined || title === '') continue;
    const before = text.slice(cursor, at);
    const trimmed = before.trimEnd();
    if (trimmed.endsWith(title)) push(trimmed.slice(0, trimmed.length - title.length));
    else push(before);
    out.push({ kind: 'link', id, text: title });
    cursor = at + match[0].length;
  }
  push(text.slice(cursor));
  return out;
}
