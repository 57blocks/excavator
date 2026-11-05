/**
 * Where a citation sits in its file, for the outputs that show a line range
 * (the scheduled-job descriptions in summary.mjs, the technical view in
 * locations.mjs). One function does the locating, `locatePassage` (locate.mjs),
 * the one the citation check's normalization defines; this only adds the file
 * read, which is cached per file and per passage.
 */

import { locatePassage } from './locate.mjs';
import { projectFiles } from './project-files.mjs';

/**
 * A function `(citation: { file, passage }) => { startLine, endLine } | null`
 * over the project at `root`; null when the file cannot be read or the
 * passage occurs zero times or more than once. The project is opened on the
 * first call.
 */
export function citationLocator(root) {
  let files = null;
  const located = new Map();
  return (citation) => {
    const key = `${citation.file}\0${citation.passage}`;
    if (!located.has(key)) {
      files ??= projectFiles(root);
      const resolved = files.resolve(citation.file);
      located.set(key, resolved.ok ? locatePassage(resolved.text, citation.passage) : null);
    }
    return located.get(key);
  };
}
