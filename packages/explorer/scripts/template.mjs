// @ts-check
/**
 * template.mjs
 *
 * The dashboard's one-file template (openspec: changes/viewer-explorer,
 * design D3): the single-file approach of `packages/report-view`, reused by
 * import. That plugin knows one output name, `view.html`; vite names the
 * copied entry `index.html` and the packing step wants `explorer.html`, so two
 * small plugins rename around it.
 *
 * The file starts with two comments: the upstream MIT notice (the copied
 * dashboard's licence, from LICENSE.upstream), then the list of the bundled
 * third-party packages and their licences. The data placeholder is the
 * template's `<!-- xv:data -->` marker and the policy placeholder its
 * `<!-- xv:csp -->` marker; the packing step replaces both.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { bundledPackagesNotice, checkLicenseNotice } from '../../report-view/scripts/licenses.mjs';
import { TEMPLATE_FILE, checkTemplate, singleFile } from '../../report-view/scripts/single-file.mjs';
import { FONT_PACKAGES, inlineFonts } from './fonts.mjs';

/** The template this package builds, and the name vite gives the copied entry. */
export const EXPLORER_TEMPLATE = 'explorer.html';
const ENTRY_NAME = 'index.html';

export const UPSTREAM_NOTICE_HEADING = 'This file contains a copy of the Understand Anything dashboard, which is licensed under the MIT License:';

const LICENSE_PATH = fileURLToPath(new URL('../LICENSE.upstream', import.meta.url));

/** Packages the template must name: the ones the dashboard certainly bundles. */
const REQUIRED_PACKAGES = ['react', 'react-dom', '@xyflow/react', 'elkjs', 'd3-force', '@dagrejs/dagre', 'zustand', 'graphology', 'react-markdown', 'prism-react-renderer', ...FONT_PACKAGES];

/**
 * The upstream notice: the heading, then the licence text, in one comment.
 * @param {string} licenseText
 * @returns {string}
 */
export function upstreamNotice(licenseText) {
  // A comment cannot hold two hyphens in a row.
  return `<!--\n${UPSTREAM_NOTICE_HEADING}\n\n${licenseText.trim().replaceAll('--', '- -')}\n-->\n`;
}

/** Both comments, in the order the template starts with them. */
export function explorerNotice() {
  return upstreamNotice(readFileSync(LICENSE_PATH, 'utf-8')) + bundledPackagesNotice();
}

/**
 * Why the template's start is not the two notices, or null: the upstream
 * notice first (with the licence's grant), then the third-party list.
 * @param {string} html
 * @param {string} licenseText the upstream licence text the notice must carry
 * @param {readonly string[]} [required]
 * @returns {string | null}
 */
export function checkNotices(html, licenseText, required = REQUIRED_PACKAGES) {
  const expected = upstreamNotice(licenseText);
  if (!html.startsWith(expected)) return `${EXPLORER_TEMPLATE} does not start with the upstream MIT notice`;
  return checkLicenseNotice(html.slice(expected.length), required)?.replaceAll(TEMPLATE_FILE, EXPLORER_TEMPLATE) ?? null;
}

/**
 * Every way the build output breaks the template contract.
 * @param {string[]} fileNames every entry of the output directory
 * @param {string | null} html the text of explorer.html, or null when it is missing
 * @param {string} licenseText
 * @returns {string[]}
 */
export function checkExplorerTemplate(fileNames, html, licenseText = readFileSync(LICENSE_PATH, 'utf-8')) {
  const problems = checkTemplate(
    fileNames.map((name) => (name === EXPLORER_TEMPLATE ? TEMPLATE_FILE : name)),
    html,
  ).map((problem) => problem.replaceAll(TEMPLATE_FILE, EXPLORER_TEMPLATE));
  if (html !== null) {
    const notice = checkNotices(html, licenseText);
    if (notice) problems.push(notice);
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
    name: `excavator-explorer-rename-${to}`,
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
 * The plugins that turn the dashboard build into explorer.html: the fonts, then
 * the single-file plugin between the two renames. Order matters.
 * @returns {import('vite').Plugin[]}
 */
export function explorerTemplate() {
  return [inlineFonts(), renameOutput(ENTRY_NAME, TEMPLATE_FILE), afterVite(singleFile(explorerNotice)), afterVite(renameOutput(TEMPLATE_FILE, EXPLORER_TEMPLATE))];
}

/**
 * Run a plugin's generateBundle after every other plugin's, vite's own included.
 * The copy loads its panels with dynamic imports, and vite's import analysis
 * fills in each chunk's preload placeholder in its own generateBundle, which
 * `enforce: 'post'` alone does not wait for: the chunk would be folded into the
 * page with the placeholder still in it.
 * @param {import('vite').Plugin} plugin
 * @returns {import('vite').Plugin}
 */
function afterVite(plugin) {
  const handler = /** @type {(this: import('vite').Rollup.PluginContext, ...args: any[]) => any} */ (plugin.generateBundle);
  return { ...plugin, generateBundle: { order: 'post', handler } };
}
