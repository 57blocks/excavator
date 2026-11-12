/**
 * `handbook.mjs page <out> --project <root>` (design D13): write
 * `<out>/handbook.html`. The data comes from the same loaded, re-checked run
 * `assemble` uses, so the two refuse the same runs; the template is the one
 * `packages/product-handbook-page` builds. Only the template's two markers are
 * replaced, `<!-- xv:csp -->` by the Content-Security-Policy and
 * `<!-- xv:data -->` by the data as one JSON block; every other byte is the
 * template's. No time, no machine path: the same run gives the same bytes. The
 * page this command owns is removed first, so a failed run never leaves the
 * page of an earlier run behind; the new page is written through a temp file
 * and a rename.
 */

import { readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UsageError } from './errors.mjs';
import { writeTextAtomic } from './json-file.mjs';
import { loadCheckedRun } from './load-run.mjs';
import { buildPageData } from './page-data.mjs';
import { DEFAULT_VIEWS } from './views.mjs';

export const PAGE_FILE = 'handbook.html';
/** Where the built template is, relative to the plugin root. */
export const PAGE_TEMPLATE_PATH = 'packages/product-handbook-page/dist/product-handbook-page.html';
/** The id of the data block; the page reads its data from the element with this id. */
export const DATA_ELEMENT_ID = 'xv-product-handbook-data';
/** Tests point the command at another template with this variable; the skill never sets it. */
export const TEMPLATE_VARIABLE = 'EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE';

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

const CSP_MARKER = '<!-- xv:csp -->';
const DATA_MARKER = '<!-- xv:data -->';
const BUILD_HINT = 'run `pnpm -r build` at the plugin root to build it';
const BACKSLASH = String.fromCharCode(92);

/** JSON for a `<script type="application/json">`: every `<` is written as a unicode escape, so no content can close the element. */
export const jsonForScript = (value) => JSON.stringify(value).replace(/</g, `${BACKSLASH}u003c`);

/** The built template sits under the plugin root, three levels above this file (resolved through links). It may not exist yet. */
function defaultTemplatePath() {
  return resolve(realpathSync(dirname(fileURLToPath(import.meta.url))), '..', '..', '..', PAGE_TEMPLATE_PATH);
}

/** The template's text; a template that is not there was never built. */
function readTemplate(templatePath) {
  try {
    return readFileSync(templatePath, 'utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new UsageError(`the handbook page template ${templatePath} does not exist: ${BUILD_HINT}`);
    throw error;
  }
}

/** The page: `template` with the policy and the data block at its two markers. Each marker must occur exactly once. */
export function fillPageTemplate(template, data) {
  for (const marker of [CSP_MARKER, DATA_MARKER]) {
    if (template.split(marker).length !== 2) throw new UsageError(`the handbook page template must contain ${marker} exactly once: ${BUILD_HINT}`);
  }
  const csp = `<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">`;
  const block = `<script type="application/json" id="${DATA_ELEMENT_ID}">${jsonForScript(data)}</script>`;
  return template.replace(CSP_MARKER, () => csp).replace(DATA_MARKER, () => block);
}

/**
 * Run page on `<out>`. Returns { status: 0, lines: [path] }, or { status: 1,
 * lines } for a run assemble would refuse; throws UsageError (exit 2) for a
 * missing out directory or state, or a template that is missing or wrong.
 * Either way no handbook.html is left.
 * @param {string} outDirArg
 * @param {string} root the real path of --project
 * @param {{ templatePath?: string, rootAliases?: string[], views?: string[] }} [options] `views`: the views the page has (views.mjs)
 */
export function writePage(outDirArg, root, options = {}) {
  const outDir = resolve(outDirArg);
  const target = join(outDir, PAGE_FILE);
  // Before any check that can fail: a failed run leaves no handbook.html, whatever an earlier run wrote.
  rmSync(target, { force: true });
  const run = loadCheckedRun(outDir, root);
  if (!run.ok) return { status: 1, lines: run.lines };
  const data = buildPageData(run, [root, ...(options.rootAliases ?? [])], { views: options.views ?? DEFAULT_VIEWS });
  const templatePath = options.templatePath ?? process.env[TEMPLATE_VARIABLE] ?? defaultTemplatePath();
  writeTextAtomic(target, fillPageTemplate(readTemplate(templatePath), data));
  return { status: 0, lines: [target] };
}
