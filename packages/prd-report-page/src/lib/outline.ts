/**
 * The id of a Markdown h2 or h3 (design D6): the block's id prefix and the
 * heading's source line. It does not depend on the heading text, so two
 * headings with the same words never collide.
 */
export const headingId = (idPrefix: string, line: number): string => `${idPrefix}-L${line}`;

/** Whether `id` has the shape `headingId` writes. */
export const isHeadingId = (id: string): boolean => /-L\d+$/.test(id);
