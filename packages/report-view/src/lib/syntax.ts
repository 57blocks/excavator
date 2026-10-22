/**
 * Which Prism grammar colours a file, by extension. Prism-react-renderer ships a
 * fixed set of grammars; a file whose extension none covers is shown without
 * colours, and so is any file over MAX_HIGHLIGHTED_LINES lines, so a very long
 * file cannot make the page crawl.
 */

export const MAX_HIGHLIGHTED_LINES = 5000;

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  py: 'python', go: 'go', rs: 'rust', swift: 'swift', kt: 'kotlin', kts: 'kotlin',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', m: 'objectivec',
  java: 'clike', cs: 'clike', scala: 'clike', dart: 'clike',
  json: 'json', yml: 'yaml', yaml: 'yaml', md: 'markdown', css: 'css', sql: 'sql', graphql: 'graphql',
  html: 'markup', xml: 'markup', svg: 'markup',
};

/** The Prism language of `path`, or null when none covers its extension. */
export function languageOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return LANGUAGE_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null;
}
