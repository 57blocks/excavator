// @ts-check
/**
 * template.mjs
 *
 * The report page's one-file template (openspec change prd-report-page,
 * design D2). The generic plugins (single-file inlining, the licence list, the
 * font inlining) are the explorer's; this file only names this page's template,
 * its fonts and the packages its notice must list. The template starts with one
 * comment, the bundled third-party packages and their licences: the page's own
 * code carries no upstream notice. Its two markers, `<!-- xv:csp -->` and
 * `<!-- xv:data -->`, are replaced by `prd.mjs page`.
 */

import { inlineFonts, FONT_REQUESTS } from '../../explorer/scripts/fonts.mjs';
import { bundledPackagesNotice, checkLicenseNotice } from '../../explorer/scripts/licenses.mjs';
import { checkTemplate, singleFile } from '../../explorer/scripts/single-file.mjs';

export const PAGE_TEMPLATE = 'prd-report-page.html';
const ENTRY_NAME = 'index.html';

/** The faces the page uses: Inter and JetBrains Mono, as in the explorer, in the Latin subsets and the weights the page sets. */
export const PAGE_FONTS = FONT_REQUESTS
  .filter((request) => request.pkg !== '@fontsource/dm-serif-display')
  .map((request) => ({
    pkg: request.pkg,
    weights: request.pkg === '@fontsource/inter' ? [400, 500, 600] : [400, 500],
    subsets: ['latin', 'latin-ext'],
  }));

/** Packages the template must name: the ones the page certainly bundles. */
const REQUIRED_PACKAGES = ['react', 'react-dom', 'react-markdown', 'remark-gfm', 'rehype-raw', 'rehype-sanitize', 'mermaid', ...PAGE_FONTS.map((font) => font.pkg)];

/**
 * Every way the build output breaks the template contract.
 * @param {string[]} fileNames every entry of the output directory
 * @param {string | null} html the text of the template, or null when it is missing
 * @returns {string[]}
 */
export function checkPageTemplate(fileNames, html) {
  const problems = checkTemplate(fileNames, html, PAGE_TEMPLATE);
  if (html !== null) {
    const notice = checkLicenseNotice(html, REQUIRED_PACKAGES, PAGE_TEMPLATE);
    if (notice) problems.push(notice);
    // The template is ASCII: the libraries' non-ASCII text is written as escapes (esbuild charset), the fonts are base64.
    const at = html.search(/[^\x00-\x7f]/);
    if (at !== -1) problems.push(`${PAGE_TEMPLATE} holds a non-ASCII character at offset ${at}`);
  }
  return problems;
}

/**
 * A plugin that renames one html output to another (after vite wrote it).
 * @param {string} from
 * @param {string} to
 * @returns {import('vite').Plugin}
 */
function renameOutput(from, to) {
  return {
    name: `excavator-prd-report-page-rename-${to}`,
    enforce: 'post',
    generateBundle(_options, bundle) {
      const output = bundle[from];
      if (!output) return;
      delete bundle[from];
      output.fileName = to;
      bundle[to] = output;
    },
  };
}

/**
 * Run a plugin's generateBundle after every other plugin's, vite's own
 * included: mermaid loads its diagram types with dynamic imports, and vite's
 * import analysis fills in each chunk's preload placeholder in its own
 * generateBundle, which `enforce: 'post'` alone does not wait for.
 * @param {import('vite').Plugin} plugin
 * @returns {import('vite').Plugin}
 */
function afterVite(plugin) {
  const handler = /** @type {(this: import('vite').Rollup.PluginContext, ...args: any[]) => any} */ (plugin.generateBundle);
  return { ...plugin, generateBundle: { order: 'post', handler } };
}

/**
 * Write every non-ASCII character left in the JavaScript as a `\uXXXX` escape.
 * esbuild's `charset: 'ascii'` does that for strings and templates but not for
 * regular expression literals, and the template is read from disk with no
 * transport header: a character beyond ASCII would depend on the browser
 * finding the `<meta charset>` in the first 1024 bytes, which the licence
 * notice at the top pushes out. In a string or a regular expression the escape
 * is the same character.
 * @returns {import('vite').Plugin}
 */
function asciiOnly() {
  return {
    name: 'excavator-prd-report-page-ascii',
    renderChunk(code) {
      return { code: code.replace(/[^\x00-\x7f]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`), map: null };
    },
  };
}

/**
 * The plugins that turn the build into prd-report-page.html: the fonts, the
 * rename, then the single-file plugin. Order matters.
 * @returns {import('vite').Plugin[]}
 */
export function pageTemplate() {
  return [asciiOnly(), inlineFonts(PAGE_FONTS), renameOutput(ENTRY_NAME, PAGE_TEMPLATE), afterVite(singleFile(bundledPackagesNotice, PAGE_TEMPLATE))];
}
