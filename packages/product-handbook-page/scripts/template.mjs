// @ts-check
/**
 * template.mjs
 *
 * The handbook page's one-file template (openspec change product-handbook-map,
 * design D13). The generic plugins (single-file inlining, the licence list)
 * are the explorer's; this file names this page's template, writes its fonts
 * into the head and names the packages its notice must list. The template
 * starts with one comment, the bundled third-party packages and their
 * licences, placed right after the charset meta so the charset stays within
 * the first 1024 bytes. Its two markers, `<!-- xv:csp -->` and
 * `<!-- xv:data -->`, are replaced by `handbook.mjs page`.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { bundledPackagesNotice, checkLicenseNotice, notePackage } from '../../explorer/scripts/licenses.mjs';
import { checkTemplate, singleFile } from '../../explorer/scripts/single-file.mjs';

export const PAGE_TEMPLATE = 'product-handbook-page.html';
/** A browser reads a file from disk with no header: it finds the charset only in the first 1024 bytes. */
const CHARSET_WINDOW = 1024;
const CHARSET_META = /<meta\s+charset=(?:"[^"]*"|'[^']*'|[^\s>]+)\s*\/?>/i;
const ENTRY_NAME = 'index.html';

/**
 * The faces the page inlines: IBM Plex Sans and IBM Plex Mono in the Latin subset, normal style (the sans text weights, the
 * mono 400 and 500). Other scripts (Chinese, Japanese, ...) use the reader's system fonts through the font stack in
 * index.css; no font for them is embedded. Only the woff2 file of a face is read, so the template holds each face once.
 */
export const PAGE_FONTS = [
  { pkg: '@fontsource/ibm-plex-sans', family: 'IBM Plex Sans', slug: 'ibm-plex-sans', weights: [400, 500, 600, 700] },
  { pkg: '@fontsource/ibm-plex-mono', family: 'IBM Plex Mono', slug: 'ibm-plex-mono', weights: [400, 500] },
];

const require = createRequire(import.meta.url);

/**
 * The stylesheet of `PAGE_FONTS`: one `@font-face` rule per weight, its source the woff2 file as a data URL.
 * @param {(pkg: string, file: string) => Uint8Array} [read] gives the bytes of `files/<file>` of a package
 * @param {readonly { pkg: string, family: string, slug: string, weights: readonly number[] }[]} [fonts]
 * @returns {string}
 */
export function pageFontsStylesheet(read = (pkg, file) => readFileSync(join(dirname(require.resolve(`${pkg}/package.json`)), 'files', file)), fonts = PAGE_FONTS) {
  const rules = [];
  for (const { pkg, family, slug, weights } of fonts) {
    for (const weight of weights) {
      const data = Buffer.from(read(pkg, `${slug}-latin-${weight}-normal.woff2`)).toString('base64');
      rules.push(`@font-face {\n  font-family: '${family}';\n  font-style: normal;\n  font-weight: ${weight};\n  font-display: block;\n  src: url(data:font/woff2;base64,${data}) format("woff2");\n}`);
    }
  }
  return rules.join('\n') + '\n';
}

/**
 * The vite plugin that writes the faces into the head and records their packages for the licence notice.
 * @returns {import('vite').Plugin}
 */
function inlinePageFonts() {
  return {
    name: 'excavator-product-handbook-page-fonts',
    transformIndexHtml() {
      for (const { pkg } of PAGE_FONTS) notePackage(dirname(require.resolve(`${pkg}/package.json`)));
      return [{ tag: 'style', children: pageFontsStylesheet(), injectTo: 'head' }];
    },
  };
}

/** Packages the template must name: the ones the page certainly bundles. */
const REQUIRED_PACKAGES = ['react', 'react-dom', '@radix-ui/react-select', ...PAGE_FONTS.map((font) => font.pkg)];

/**
 * Every way the build output breaks the template contract.
 * @param {string[]} fileNames every entry of the output directory
 * @param {string | null} html the text of the template, or null when it is missing
 * @returns {string[]}
 */
export function checkPageTemplate(fileNames, html) {
  const problems = checkTemplate(fileNames, html, PAGE_TEMPLATE);
  if (html !== null) {
    const meta = CHARSET_META.exec(html);
    const noticeFrom = meta ? meta.index + meta[0].length : 0;
    const notice = meta ? checkLicenseNotice(html.slice(noticeFrom), REQUIRED_PACKAGES, PAGE_TEMPLATE) : null;
    if (notice) problems.push(notice.replace(/does not start with the licence notice comment$/, 'does not carry the licence notice comment right after its charset meta'));
    const offset = meta ? Buffer.byteLength(html.slice(0, meta.index)) : -1;
    if (!meta || !/charset=["']?utf-8/i.test(meta[0])) problems.push(`${PAGE_TEMPLATE} has no <meta charset="utf-8"> within its first ${CHARSET_WINDOW} bytes`);
    else if (offset + Buffer.byteLength(meta[0]) > CHARSET_WINDOW) problems.push(`${PAGE_TEMPLATE} has its <meta charset> at byte ${offset}, past the first ${CHARSET_WINDOW} bytes`);
    // The template is ASCII: non-ASCII text in the code is written as escapes (esbuild charset), the font is base64.
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
    name: `excavator-product-handbook-page-rename-${to}`,
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
 * included.
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
 * regular expression literals; in a string or a regular expression the escape
 * is the same character.
 * @returns {import('vite').Plugin}
 */
function asciiOnly() {
  return {
    name: 'excavator-product-handbook-page-ascii',
    renderChunk(code) {
      return { code: code.replace(/[^\x00-\x7f]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`), map: null };
    },
  };
}

/**
 * The plugins that turn the build into product-handbook-page.html: the font,
 * the rename, then the single-file plugin. Order matters.
 * @returns {import('vite').Plugin[]}
 */
export function pageTemplate() {
  return [asciiOnly(), inlinePageFonts(), renameOutput(ENTRY_NAME, PAGE_TEMPLATE), afterVite(singleFile(bundledPackagesNotice, PAGE_TEMPLATE, 'after-charset'))];
}
