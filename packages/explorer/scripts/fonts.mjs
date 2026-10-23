// @ts-check
/**
 * fonts.mjs
 *
 * The fonts the copied page asked Google Fonts for, inlined (openspec:
 * changes/viewer-explorer, design D3). The upstream index.html linked one
 * stylesheet: DM Serif Display 400, Inter 300/400/500/600 and JetBrains Mono
 * 400/500, each with every unicode-range subset. A page opened from disk has no
 * network, so the same families, weights and ranges are written into the head as
 * `@font-face` rules whose source is a `data:font/woff2` URL, read from the
 * @fontsource packages (the same fonts, at the same versions as the other
 * viewer). The subsets are the ones the dashboard's locales can need: latin,
 * latin-ext, cyrillic, cyrillic-ext and vietnamese (greek is not shipped by any
 * locale, and DM Serif Display has only the two latin ones). `font-display` is
 * `block` so the first paint already uses the right face.
 *
 * `inlineFonts` is a vite plugin that injects the stylesheet into the page's
 * head and records the font packages for the licence notice.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { notePackage } from './licenses.mjs';

const LATIN = ['latin', 'latin-ext'];
const ALL = ['cyrillic-ext', 'cyrillic', 'latin-ext', 'latin', 'vietnamese'];

/** The packages and the weights and subsets of each that the upstream stylesheet asked for. */
export const FONT_REQUESTS = /** @type {const} */ ([
  { pkg: '@fontsource/dm-serif-display', weights: [400], subsets: LATIN },
  { pkg: '@fontsource/inter', weights: [300, 400, 500, 600], subsets: ALL },
  { pkg: '@fontsource/jetbrains-mono', weights: [400, 500], subsets: ALL },
]);

export const FONT_PACKAGES = FONT_REQUESTS.map((request) => request.pkg);

const require = createRequire(import.meta.url);

/** @param {string} pkg */
export function packageRoot(pkg) {
  return dirname(require.resolve(`${pkg}/package.json`));
}

const FACE_BLOCK = /\/\*\s*(\S+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;

/**
 * The rules of one @fontsource `<weight>.css` for the wanted subsets, with each
 * woff2 file read through `read` and written as a data URL.
 * @param {string} css the text of `<weight>.css`
 * @param {readonly string[]} subsets
 * @param {(file: string) => Uint8Array} read gives the bytes of `files/<file>`
 * @returns {string[]}
 */
export function inlineFaces(css, subsets, read) {
  /** @type {string[]} */
  const rules = [];
  for (const match of css.matchAll(FACE_BLOCK)) {
    const body = match[2];
    const file = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(body)?.[1];
    const subset = /-(?:\d+)-normal$/.test(match[1]) && file ? subsetOf(match[1]) : null;
    if (!file || !subset || !subsets.includes(subset)) continue;
    const declared = (/** @type {string} */ name) => new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1].trim();
    const family = declared('font-family');
    const weight = declared('font-weight');
    const range = declared('unicode-range');
    if (!family || !weight || !range) throw new Error(`font face ${match[1]} lacks a family, weight or unicode-range`);
    const data = Buffer.from(read(file)).toString('base64');
    rules.push(
      [
        '@font-face {',
        `  font-family: ${family};`,
        '  font-style: normal;',
        `  font-weight: ${weight};`,
        '  font-display: block;',
        `  src: url(data:font/woff2;base64,${data}) format("woff2");`,
        `  unicode-range: ${range};`,
        '}',
      ].join('\n'),
    );
  }
  return rules;
}

/**
 * `inter-cyrillic-ext-400-normal` is the subset `cyrillic-ext`: the words between the package's name and the weight.
 * @param {string} faceName
 * @returns {string | null}
 */
function subsetOf(faceName) {
  const parts = faceName.replace(/-\d+-normal$/, '');
  for (const subset of ALL) if (parts.endsWith(`-${subset}`)) return subset;
  return null;
}

/**
 * The whole stylesheet, read from the installed packages. A request that finds
 * no face for a (weight, subset) it asked for is an error, not a gap.
 * @param {(root: string, file: string) => Uint8Array} [readFile]
 * @param {(pkg: string) => string} [rootOf]
 * @returns {string}
 */
export function fontsStylesheet(readFile = (root, file) => readFileSync(join(root, file)), rootOf = packageRoot) {
  /** @type {string[]} */
  const rules = [];
  for (const { pkg, weights, subsets } of FONT_REQUESTS) {
    const root = rootOf(pkg);
    for (const weight of weights) {
      const css = Buffer.from(readFile(root, `${weight}.css`)).toString('utf-8');
      const made = inlineFaces(css, subsets, (file) => readFile(root, join('files', file)));
      if (made.length !== subsets.length) throw new Error(`${pkg} ${weight}: expected ${subsets.length} faces (${subsets.join(', ')}), found ${made.length}`);
      rules.push(...made);
    }
  }
  return rules.join('\n') + '\n';
}

/**
 * @returns {import('vite').Plugin}
 */
export function inlineFonts() {
  return {
    name: 'excavator-explorer-fonts',
    transformIndexHtml() {
      for (const pkg of FONT_PACKAGES) notePackage(packageRoot(pkg));
      return [{ tag: 'style', children: fontsStylesheet(), injectTo: 'head' }];
    },
  };
}
