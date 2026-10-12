/**
 * mention-sites.mjs
 *
 * The mentions stage of the Lazy driver (openspec: changes/name-mention-facts,
 * design D1-D2, D4, D6): lex every non-code file of the manifest, and gather
 * the two facts about files the stage cannot lex or the index cannot see that
 * the projection needs to ground "unindexed":
 *
 *   - the package a Java file declares, for the Java files whose own type the
 *     structure extraction has no class entry for (an annotation type) and for
 *     Java files the scanner skipped as too large; and
 *   - how many non-code files the scanner skipped, by reason, which were
 *     therefore not lexed.
 *
 * Scope is the whole manifest minus code languages (tree-sitter languages of
 * the registry), so a `.ftl`, a `.tag` or a vendor descriptor needs no
 * declaration anywhere. Content comes from the injected `readFile`, which the
 * driver binds to the MATERIALIZED snapshot - never to the live tree - the
 * same way its source-index stage does. Pure otherwise: no model, no build.
 */

import { basename, extname } from 'node:path';
import { readJavaPackage } from './java-package-declaration.mjs';
import { TARGET_SKIP_REASONS } from './mention-resolution.mjs';
import { isCodeLanguage, lexMentions } from './text-mentions.mjs';

const fileStem = (path) => basename(path, extname(path));

/**
 * @param {{
 *   scan: { files: Array<{ path: string, language: string }>, skipped?: Array<{ path: string, reason: string, language?: string }> },
 *   structureAll: { results: object[] },
 *   readFile: (path: string) => string,
 * }} args
 * @returns {{
 *   sites: Array<{ file: string, language: string, fqn: object[], path: object[] }>,
 *   inputs: { javaPackages: Array<{ file: string, package: string }>, skippedNonCode: Record<string, number> },
 * }}
 *   `sites` has one row per scanned non-code file, in manifest order; a file
 *   with no mention still has its row, because the row is what coverage counts
 */
export function collectMentionSites({ scan, structureAll, readFile }) {
  const read = (path) => {
    try {
      return readFile(path);
    } catch (error) {
      // The scan already read this file; failing now means the materialized
      // snapshot is damaged. A silent empty result would read as "nothing there".
      throw new Error(`mentions: cannot read ${path} from the snapshot: ${error.message}`);
    }
  };

  // A path token whose extension no manifest file has cannot name one.
  const extensions = new Set(scan.files.map((f) => extname(f.path).slice(1).toLowerCase()).filter(Boolean));
  const sites = [];
  for (const file of scan.files) {
    if (isCodeLanguage(file.language)) continue;
    sites.push({ file: file.path, language: file.language, ...lexMentions(file.path, file.language, read(file.path), { extensions }) });
  }

  // A Java type the structure extraction made no class entry for (an
  // annotation type) is still a declaration of the repository. Its package is
  // the one the file declares, not a guess from its directory.
  const rowByPath = new Map(structureAll.results.map((row) => [row.path, row]));
  const hasOwnType = (path) => (rowByPath.get(path)?.classes ?? [])
    .some((cls) => cls.name === fileStem(path) && typeof cls.qualifiedName === 'string');
  const javaPackages = [];
  const declare = (path) => {
    const declared = readJavaPackage(read(path));
    if (declared !== null) javaPackages.push({ file: path, package: declared });
  };
  for (const file of scan.files) {
    if (file.language === 'java' && !hasOwnType(file.path)) declare(file.path);
  }

  const skippedNonCode = {};
  for (const entry of scan.skipped ?? []) {
    if (!TARGET_SKIP_REASONS.includes(entry.reason)) continue;
    if (!isCodeLanguage(entry.language)) {
      skippedNonCode[entry.reason] = (skippedNonCode[entry.reason] ?? 0) + 1;
    } else if (entry.language === 'java' && entry.reason === 'too-large') {
      // Present in the snapshot, only too big to extract; a symlink, a file
      // that failed to read and a binary one are not read.
      declare(entry.path);
    }
  }
  return { sites, inputs: { javaPackages, skippedNonCode } };
}
