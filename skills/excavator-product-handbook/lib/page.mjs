/**
 * `handbook.mjs page <out> --project <root>` (design D13): write
 * `<out>/handbook.html`, and `<out>/handbook-data/` when the data is large
 * (page-chunks.mjs). The data (format /19, page-data.mjs) comes from the same loaded,
 * checked Markdown run `assemble` uses, so the two refuse the same runs; the template is the one
 * `packages/product-handbook-page` builds. Only the template's two markers are
 * replaced (page-template.mjs); every other byte is the template's. No time,
 * no machine path: the same run gives the same bytes. The page and the
 * directory this command owns are removed first, so a failed run never leaves
 * those of an earlier run behind; the new ones are written into a temp
 * directory and moved into place.
 */

import { realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chunkLimits, PAGE_FILE, PARTS_DIR, writePageFiles } from './page-chunks.mjs';
import { loadMdRun } from './md-run.mjs';
import { buildPageData } from './page-data.mjs';
import { checkTemplate, readTemplate } from './page-template.mjs';
import { restorePageData, splitPageData } from './page-units.mjs';
import { DEFAULT_VIEWS } from './views.mjs';

export { PAGE_FILE, PARTS_DIR };
export { CHUNKED_PAGE_CSP, DATA_ELEMENT_ID, PAGE_CSP, fillPageTemplate, jsonForScript } from './page-template.mjs';
/** Where the built template is, relative to the plugin root. */
export const PAGE_TEMPLATE_PATH = 'packages/product-handbook-page/dist/product-handbook-page.html';
/** Tests point the command at another template with this variable; the skill never sets it. */
export const TEMPLATE_VARIABLE = 'EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE';

/** The built template sits under the plugin root, three levels above this file (resolved through links). It may not exist yet. */
function defaultTemplatePath() {
  return resolve(realpathSync(dirname(fileURLToPath(import.meta.url))), '..', '..', '..', PAGE_TEMPLATE_PATH);
}

/**
 * Run page on `<out>`. Returns { status: 0, lines: [path] }, or { status: 1,
 * lines } for a run assemble would refuse; throws UsageError (exit 2) for a
 * missing out directory or state, or a template that is missing or wrong.
 * Either way no handbook.html and no handbook-data/ is left.
 * @param {string} outDirArg
 * @param {string} root the real path of --project
 * @param {{ templatePath?: string, rootAliases?: string[], views?: string[] }} [options] `views`: the views the page has (views.mjs)
 */
export function writePage(outDirArg, root, options = {}) {
  const outDir = resolve(outDirArg);
  const target = join(outDir, PAGE_FILE);
  // Before any check that can fail: a failed run leaves nothing of an earlier run behind.
  rmSync(target, { force: true });
  rmSync(join(outDir, PARTS_DIR), { recursive: true, force: true });
  const run = loadMdRun(outDir, root);
  if (!run.ok) return { status: 1, lines: run.lines };
  const limits = chunkLimits();
  const data = buildPageData(run, [root, ...(options.rootAliases ?? [])], { views: options.views ?? DEFAULT_VIEWS });
  const templatePath = options.templatePath ?? process.env[TEMPLATE_VARIABLE] ?? defaultTemplatePath();
  const template = readTemplate(templatePath);
  checkTemplate(template);
  const { core, units } = splitPageData(data);
  writePageFiles(outDir, { template, core, units, restore: restorePageData, ...limits });
  return { status: 0, lines: [target] };
}
