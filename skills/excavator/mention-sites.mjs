/**
 * mention-sites.mjs
 *
 * The mentions stage of the Lazy driver (openspec: changes/name-mention-facts,
 * design D1-D2): lex every non-code file of the manifest and hand the rows to
 * `buildFactGraph({ mentionSites })`.
 *
 * Scope is the whole manifest minus code languages (tree-sitter languages of
 * the registry), so a `.ftl`, a `.tag` or a vendor descriptor needs no
 * declaration anywhere. Content comes from the injected `readFile`, which the
 * driver binds to the MATERIALIZED snapshot - never to the live tree - the
 * same way its source-index stage does. Pure otherwise: no model, no build.
 */

import { extname } from 'node:path';
import { isCodeLanguage, lexMentions } from './text-mentions.mjs';

/**
 * @param {{ scan: { files: Array<{ path: string, language: string }> }, readFile: (path: string) => string }} args
 * @returns {Array<{ file: string, language: string, fqn: object[], path: object[] }>}
 *   one row per scanned non-code file, in manifest order; a file with no
 *   mention still has its row, because the row is what coverage counts
 */
export function collectMentionSites({ scan, readFile }) {
  // A path token whose extension no manifest file has cannot name one.
  const extensions = new Set(scan.files.map((f) => extname(f.path).slice(1).toLowerCase()).filter(Boolean));
  const sites = [];
  for (const file of scan.files) {
    if (isCodeLanguage(file.language)) continue;
    let text;
    try {
      text = readFile(file.path);
    } catch (error) {
      // The scan already read this file; failing now means the materialized
      // snapshot is damaged. A silent empty row would read as "no mentions".
      throw new Error(`mentions: cannot read ${file.path} from the snapshot: ${error.message}`);
    }
    sites.push({ file: file.path, language: file.language, ...lexMentions(file.path, file.language, text, { extensions }) });
  }
  return sites;
}
