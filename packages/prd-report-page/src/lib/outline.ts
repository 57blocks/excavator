/**
 * The id of a Markdown h2 or h3 (design D6): the block's id prefix and the
 * heading's source line. It does not depend on the heading text, so two
 * headings with the same words never collide.
 */
export const headingId = (idPrefix: string, line: number): string => `${idPrefix}-L${line}`;

/** Whether `id` has the shape `headingId` writes. */
export const isHeadingId = (id: string): boolean => /-L\d+$/.test(id);

/** How far below the reading line an entry's top may sit and still count as reached. */
const READING_TOLERANCE = 2;

/**
 * The index of the current outline entry: the last one whose top is at or above
 * the reading line (plus a 2px tolerance), else the first. `tops` are the
 * entries' tops in document order; an empty list gives -1.
 */
export function activeIndex(tops: readonly number[], line: number): number {
  if (tops.length === 0) return -1;
  let current = 0;
  for (let at = 0; at < tops.length; at += 1) {
    if (tops[at] <= line + READING_TOLERANCE) current = at;
    else break;
  }
  return current;
}
