/**
 * Reading a mermaid source for the choice of drawing engine, and tidying the drawing of the lighter engine.
 */

/**
 * Whether `source` is a state diagram with a line that is only one state name (a state declared on its own line).
 * The lighter engine drops such a state when it has no transition, so the whole diagram goes to mermaid.
 */
export function hasBareState(source: string): boolean {
  const lines = source.split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('%%'));
  if (lines.length === 0 || !/^stateDiagram(?:-v2)?\s*$/i.test(lines[0])) return false;
  return lines.slice(1).some((line) => /^[A-Za-z_][\w.-]*$/.test(line) && !KEYWORDS.has(line.toLowerCase()));
}

const KEYWORDS = new Set(['direction', 'end', 'state', 'note', 'classdef', 'class', 'style', 'hide', 'scale', 'accdescr', 'acctitle', 'title']);

/** `svg` without its `@import` rules: the page makes no network request, and the lighter engine adds a font import to every drawing. */
export function withoutImports(svg: string): string {
  return svg.replace(/@import\s*url\([^)]*\)[^;{}<]*;?/gi, '').replace(/@import\s*(?:"[^"]*"|'[^']*')[^;{}<]*;?/gi, '');
}

/** The width of the drawing's viewBox in px, or null when the SVG has none. */
export function viewBoxWidth(svg: string): number | null {
  const match = /<svg\b[^>]*\sviewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+[\d.]+\s*"/.exec(svg);
  const width = match === null ? NaN : Number(match[1]);
  return Number.isFinite(width) && width > 0 ? width : null;
}
