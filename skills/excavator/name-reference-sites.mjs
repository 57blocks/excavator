/**
 * name-reference-sites.mjs
 *
 * The name-reference stage of the Lazy driver (openspec: changes/
 * name-binding-references, design D9): read every non-code file of the manifest
 * once and gather what the projection needs to resolve expression names -
 *
 *   files         per expression file (by extension, or by XML root and
 *                 namespace, as the catalog's expression language says): the
 *                 root names its expressions write, and how many expressions
 *                 were escaped or never closed;
 *   bindings      the name bindings XML descriptors declare, by the catalog's
 *                 XML binders, each with what its binder means by a missing
 *                 target (annotation bindings are the projection's: they come
 *                 from the structure rows);
 *   missingNames  the elements a binder matched that gave no name, by binder;
 *   conditions    the descriptors that open a namespace to expressions (the
 *                 catalog's `elementTextIn`), as facts: file, language,
 *                 namespace, line;
 *   outsideFiles  files that write `#{` (in the text as written, a comment
 *                 included: it only says expressions may be there) but are not
 *                 expression files: an `.xml` file by `xml:<root element>` (by
 *                 `xml` when no root element can be read), any other file by
 *                 lower-case extension, or `(none)` - an expression the catalog
 *                 does not cover, counted, never read. An HTML fragment that
 *                 starts with a tag is still `html`, not an XML document.
 *
 * Scope is the whole manifest minus code languages (tree-sitter languages of
 * the registry). Content comes from the injected `readFile`, which the driver
 * binds to the MATERIALIZED snapshot - never to the live tree. Pure otherwise:
 * no model, no build.
 */

import { extname } from 'node:path';
import { lexElExpressions } from './el-expressions.mjs';
import { isCodeLanguage } from './text-mentions.mjs';
import {
  bindingsOfTree, parseXml, readRootElement, rootMatches, textConditionHitsOfTree,
} from './xml-name-bindings.mjs';

/**
 * The one delimiter whose presence in a file the catalog does not cover says
 * the file holds expressions: `${` is ordinary property syntax in build files
 * and shell, so it would turn every one of those into a finding.
 */
const OUTSIDE_PROBE = '#{';

const STARTS_WITH_MARKUP = /^[\s﻿]*</;

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * @param {{
 *   scan: { files: Array<{ path: string, language: string }> },
 *   catalog: object,
 *   readFile: (path: string) => string,
 *   mutations?: { noCommentMask?: boolean, anyParent?: boolean },
 * }} args
 *   `mutations` is the test seam of the reading-stage mutation tripwires
 *   (name-reference-resolution.mjs has the resolution-stage ones); production
 *   callers leave it empty.
 * @returns {{
 *   files: Array<{ file: string, language: string, expressionLanguage: string, roots: object[], escaped: number, unterminated: number }>,
 *   bindings: Array<{ file: string, binder: string, name: string, line: number, target: { kind: string, text: string }|null, missingTarget: string }>,
 *   missingNames: Record<string, number>,
 *   conditions: Array<{ file: string, expressionLanguage: string, namespace: string, line: number, text: string }>,
 *   outsideFiles: Record<string, number>,
 * }}
 *   `files` has one row per expression file, in manifest order; a file with no
 *   root name still has its row, because the row is what coverage counts
 */
export function collectNameReferenceSites({ scan, catalog, readFile, mutations = {} }) {
  const read = (path) => {
    try {
      return readFile(path);
    } catch (error) {
      // The scan already read this file; failing now means the materialized
      // snapshot is damaged. A silent empty result would read as "nothing there".
      throw new Error(`name-references: cannot read ${path} from the snapshot: ${error.message}`);
    }
  };

  const languages = catalog.expressionLanguages;
  const conditionsOf = (language) => language.sees.filter((entry) => entry.when).map((entry) => ({ namespace: entry.namespace, ...entry.when.elementTextIn }));
  const result = { files: [], bindings: [], missingNames: {}, conditions: [], outsideFiles: {} };

  for (const file of scan.files) {
    if (isCodeLanguage(file.language)) continue;
    const text = read(file.path);
    const extension = extname(file.path).slice(1).toLowerCase();
    const info = STARTS_WITH_MARKUP.test(text) ? readRootElement(text) : null;

    const language = languages.find((candidate) =>
      candidate.files.extensions.some((e) => e.toLowerCase() === extension)
      || (info !== null && candidate.files.xmlRoots.some((entry) => rootMatches(info, entry.root, entry.rootNamespace))));

    // The descriptor is parsed once, and only when a binder or a condition reads its root.
    const reads = info !== null && (
      catalog.xmlBinders.some((binder) => rootMatches(info, binder.root, binder.rootNamespace))
      || languages.some((candidate) => conditionsOf(candidate).some((condition) => condition.root === info.local)));
    if (reads) {
      const tree = parseXml(text, { maskComments: !mutations.noCommentMask });
      const declared = bindingsOfTree(tree, catalog.xmlBinders, { mutations });
      for (const binding of declared.bindings) result.bindings.push({ file: file.path, ...binding });
      for (const [binder, count] of Object.entries(declared.missing)) result.missingNames[binder] = (result.missingNames[binder] ?? 0) + count;
      for (const candidate of languages) {
        for (const condition of conditionsOf(candidate)) {
          for (const hit of textConditionHitsOfTree(tree, condition)) {
            result.conditions.push({ file: file.path, expressionLanguage: candidate.id, namespace: condition.namespace, ...hit });
          }
        }
      }
    }

    if (language) {
      const lexed = lexElExpressions(text, { language: file.language, expressionLanguage: language, mutations });
      result.files.push({ file: file.path, language: file.language, expressionLanguage: language.id, ...lexed });
    } else if (text.includes(OUTSIDE_PROBE)) {
      const key = extension === 'xml' && info ? `xml:${info.local}` : (extension || '(none)');
      result.outsideFiles[key] = (result.outsideFiles[key] ?? 0) + 1;
    }
  }

  result.outsideFiles = Object.fromEntries(Object.entries(result.outsideFiles).sort(([a], [b]) => compareText(a, b)));
  return result;
}
