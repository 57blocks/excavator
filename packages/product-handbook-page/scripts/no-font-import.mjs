// @ts-check
/**
 * The diagram library writes a font `@import` (a network address) into every drawing. The page makes no network
 * request and its template may not name one, so the build removes those two literals from the library's code; the
 * page also removes any `@import` rule from a drawing at run time. If the library changes and a literal survives,
 * the template check fails the build.
 *
 * @returns {import('vite').Plugin}
 */
export function dropDiagramFontImport() {
  return {
    name: 'excavator-drop-diagram-font-import',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]beautiful-mermaid[\\/]/.test(id)) return null;
      const out = code.replace(/`@import url\('https:\/\/fonts\.googleapis\.com[^`]*`/g, '""');
      return out === code ? null : { code: out, map: null };
    },
  };
}
