/** One entry of the table of contents: the heading's id (`h-<n>`), its level (2 or 3), its text. */
export interface TocItem { id: string; level: 2 | 3; text: string }

/**
 * Give each `h2` and `h3` of the article an id `h-<n>`, n counting them in document order from 0, and make it focusable
 * (tabindex -1, so the table of contents can move the focus to it). The search of the page relies on this numbering.
 * Returns the headings with their entries.
 */
export function numberHeadings(root: ParentNode): { element: HTMLElement; item: TocItem }[] {
  const out: { element: HTMLElement; item: TocItem }[] = [];
  root.querySelectorAll<HTMLElement>('.prose h2, .prose h3').forEach((element, at) => {
    element.id = `h-${at}`;
    element.setAttribute('tabindex', '-1');
    out.push({ element, item: { id: element.id, level: element.tagName === 'H2' ? 2 : 3, text: element.textContent ?? '' } });
  });
  return out;
}

/** A table of contents is shown when the article has at least two `h2`. */
export const wantsToc = (items: readonly TocItem[]): boolean => items.filter((item) => item.level === 2).length >= 2;

/** How far below the top of the viewport a heading counts as reached: the bar's height plus a quarter of the viewport, at least 24px. */
export const spyLimit = (barHeight: number, viewportHeight: number): number => barHeight + Math.max(24, Math.round(viewportHeight * 0.25));

/** The active heading: the last whose top is at or above the limit, else the first. */
export function activeIndex(tops: readonly number[], limit: number): number {
  let active = 0;
  tops.forEach((top, at) => { if (top <= limit) active = at; });
  return active;
}
