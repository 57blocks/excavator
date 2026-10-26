/**
 * `prd.mjs page <out>` (openspec change prd-report-page, design D7): the
 * report page. The data comes from `collectPageData`, which refuses a run
 * whose files disagree; the template is the one `packages/prd-report-page`
 * builds. Only the template's two markers are replaced, `<!-- xv:csp -->` by
 * the Content-Security-Policy and `<!-- xv:data -->` by the data as one JSON
 * block; every other byte is the template's. No time, no machine path: the same
 * run gives the same bytes. The page `page` owns is removed first, so a failed
 * run never leaves the page of an earlier run for `reply` to name; nothing else
 * is touched, and the new page is written through a temp file and a rename.
 */

import { existsSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { jsonForScript } from '../../excavator-view/page-assembly.mjs';
import { UsageError } from './errors.mjs';
import { loadIndex } from './index-check.mjs';
import { collectPageData } from './page-data.mjs';

export const PAGE_FILE = 'report.html';
/** Where the built template is, relative to the plugin root. */
export const PAGE_TEMPLATE_PATH = 'packages/prd-report-page/dist/prd-report-page.html';
export const DATA_ELEMENT_ID = 'xv-prd-report-data';
/** Tests point the command at another template with this variable; the skill never sets it. */
export const TEMPLATE_VARIABLE = 'EXCAVATOR_PRD_REPORT_PAGE_TEMPLATE';

/** No connection of any kind; scripts and styles only inline; images and fonts only data: URLs. */
export const PAGE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  "font-src data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const CSP_MARKER = '<!-- xv:csp -->';
const DATA_MARKER = '<!-- xv:data -->';
const BUILD_HINT = 'run `pnpm -r build` at the plugin root to build it';

/** The built template sits under the plugin root, three levels above this file (resolved through links). It may not exist yet. */
function defaultTemplatePath() {
  return resolve(realpathSync(dirname(fileURLToPath(import.meta.url))), '..', '..', '..', PAGE_TEMPLATE_PATH);
}

/** The template's text; a template that is not there was never built. */
function readTemplate(templatePath) {
  try {
    return readFileSync(templatePath, 'utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new UsageError(`the report page template ${templatePath} does not exist: ${BUILD_HINT}`);
    throw error;
  }
}

/**
 * The page: `template` with the policy and the data block at its two markers.
 * Each marker must occur exactly once, or the template is not this build's.
 * @param {string} template
 * @param {object} data the page data
 * @returns {string}
 */
export function fillPageTemplate(template, data) {
  for (const marker of [CSP_MARKER, DATA_MARKER]) {
    if (template.split(marker).length !== 2) throw new UsageError(`the report page template must contain ${marker} exactly once: ${BUILD_HINT}`);
  }
  const csp = `<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">`;
  const block = `<script type="application/json" id="${DATA_ELEMENT_ID}">${jsonForScript(data)}</script>`;
  return template.replace(CSP_MARKER, () => csp).replace(DATA_MARKER, () => block);
}

/**
 * Run page on `<out>`. Returns { status: 0, lines: [path] }, or { status: 1,
 * lines } for an index of the previous format; throws UsageError (exit 2) for
 * a run that is not up to date or a template that is missing or wrong. Either
 * way no report.html is left.
 * @param {string} outDirArg
 * @param {string} root the real path of --project
 * @param {{ templatePath?: string }} [options]
 */
export function writePage(outDirArg, root, options = {}) {
  const outDir = resolve(outDirArg);
  const target = join(outDir, PAGE_FILE);
  // Before any check that can fail: a failed run leaves no report.html, whatever an earlier run wrote.
  rmSync(target, { force: true });
  // An index of the previous format is a failed check (exit 1) like in every other command; any other trouble with it is collectPageData's.
  const early = loadIndex(outDir);
  if (early.stale) return { status: 1, lines: [early.line] };
  const data = collectPageData(outDir, root);
  const templatePath = options.templatePath ?? process.env[TEMPLATE_VARIABLE] ?? defaultTemplatePath();
  const html = fillPageTemplate(readTemplate(templatePath), data);

  const temp = `${target}.tmp-${process.pid}`;
  try {
    writeFileSync(temp, html);
    renameSync(temp, target);
  } finally {
    if (existsSync(temp)) rmSync(temp, { force: true });
  }
  return { status: 0, lines: [target] };
}
