/**
 * The page's template and the two things `page` puts into it: the Content-Security-Policy and the
 * data block (design D13 of openspec change product-handbook-map, D5 of handbook-page-chunked-data).
 * Only the template's two markers are replaced, `<!-- xv:csp -->` and `<!-- xv:data -->`; every
 * other byte is the template's.
 */

import { readFileSync } from 'node:fs';

import { UsageError } from './errors.mjs';

/** The id of the data block; the page reads its data from the element with this id. */
export const DATA_ELEMENT_ID = 'xv-product-handbook-data';

/** No connection of any kind; scripts and styles only inline; images and fonts only data: URLs. */
export const PAGE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** The policy of a page with a `handbook-data/` directory: the same, and scripts also from the page's own origin (the part files next to it). */
export const CHUNKED_PAGE_CSP = PAGE_CSP.replace("script-src 'unsafe-inline'", "script-src 'self' 'unsafe-inline'");

const CSP_MARKER = '<!-- xv:csp -->';
const DATA_MARKER = '<!-- xv:data -->';
export const BUILD_HINT = 'run `pnpm -r build` at the plugin root to build it';
const BACKSLASH = String.fromCharCode(92);

/** JSON for a `<script type="application/json">`: every `<` is written as a unicode escape, so no content can close the element. */
export const jsonForScript = (value) => JSON.stringify(value).replace(/</g, `${BACKSLASH}u003c`);

/** The template's text; a template that is not there was never built. */
export function readTemplate(templatePath) {
  try {
    return readFileSync(templatePath, 'utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new UsageError(`the handbook page template ${templatePath} does not exist: ${BUILD_HINT}`);
    throw error;
  }
}

/** Each marker must occur exactly once. */
export function checkTemplate(template) {
  for (const marker of [CSP_MARKER, DATA_MARKER]) {
    if (template.split(marker).length !== 2) throw new UsageError(`the handbook page template must contain ${marker} exactly once: ${BUILD_HINT}`);
  }
}

/** The page: `template` with the policy and the data block at its two markers; `chunked` selects the policy of a page with part files. */
export function fillPageTemplate(template, data, { chunked = false } = {}) {
  checkTemplate(template);
  const csp = `<meta http-equiv="Content-Security-Policy" content="${chunked ? CHUNKED_PAGE_CSP : PAGE_CSP}">`;
  const block = `<script type="application/json" id="${DATA_ELEMENT_ID}">${jsonForScript(data)}</script>`;
  return template.replace(CSP_MARKER, () => csp).replace(DATA_MARKER, () => block);
}
