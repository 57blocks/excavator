// @ts-check
/**
 * fonts.mjs
 *
 * The page's fonts, inlined into the template (openspec: changes/viewer-learn,
 * design D7): headings in DM Serif Display, text in Inter, code in JetBrains
 * Mono, each only in its Latin subset and only in the weights the page uses.
 * The page is opened from file:// with no network, so every face is a
 * `data:font/woff2` URL in the stylesheet, with `font-display: block`: the
 * first paint already uses the right font.
 *
 * `inlineFonts` is a vite plugin that serves the stylesheet of these faces as
 * the module `virtual:xv-fonts.css` (main.tsx imports it). It reads the woff2
 * files of the installed @fontsource packages itself and records those
 * packages for the licence notice, so a face in the template is always a face
 * the notice names.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { notePackage } from './licenses.mjs';

/** The module id main.tsx imports. */
export const FONTS_MODULE = 'virtual:xv-fonts.css';

/**
 * @typedef {{ family: string, weight: number, pkg: string, file: string }} FontFace
 */

/** Every face the page uses: the family, the weight, and the Latin woff2 of its package. */
export const FONT_FACES = /** @type {readonly FontFace[]} */ ([
  { family: 'DM Serif Display', weight: 400, pkg: '@fontsource/dm-serif-display', file: 'dm-serif-display-latin-400-normal.woff2' },
  { family: 'Inter', weight: 400, pkg: '@fontsource/inter', file: 'inter-latin-400-normal.woff2' },
  { family: 'Inter', weight: 500, pkg: '@fontsource/inter', file: 'inter-latin-500-normal.woff2' },
  { family: 'Inter', weight: 600, pkg: '@fontsource/inter', file: 'inter-latin-600-normal.woff2' },
  { family: 'JetBrains Mono', weight: 400, pkg: '@fontsource/jetbrains-mono', file: 'jetbrains-mono-latin-400-normal.woff2' },
  { family: 'JetBrains Mono', weight: 600, pkg: '@fontsource/jetbrains-mono', file: 'jetbrains-mono-latin-600-normal.woff2' },
]);

/** The packages the faces come from, once each. */
export const FONT_PACKAGES = [...new Set(FONT_FACES.map((face) => face.pkg))];

const require = createRequire(import.meta.url);

/**
 * The directory that holds the package.json of an installed package.
 * @param {string} pkg
 * @returns {string}
 */
export function packageRoot(pkg) {
  return dirname(require.resolve(`${pkg}/package.json`));
}

/**
 * One `@font-face` rule with the font's bytes as a data URL.
 * @param {FontFace} face
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function fontFaceRule(face, bytes) {
  const data = Buffer.from(bytes).toString('base64');
  return [
    '@font-face {',
    `  font-family: "${face.family}";`,
    '  font-style: normal;',
    `  font-weight: ${face.weight};`,
    '  font-display: block;',
    `  src: url(data:font/woff2;base64,${data}) format("woff2");`,
    '}',
  ].join('\n');
}

/**
 * The stylesheet of every face, read from the installed packages; `read` is
 * given the package root and the file name (the tests pass their own).
 * @param {(root: string, file: string) => Uint8Array} [read]
 * @returns {string}
 */
export function fontsStylesheet(read = (root, file) => readFileSync(join(root, 'files', file))) {
  return FONT_FACES.map((face) => fontFaceRule(face, read(packageRoot(face.pkg), face.file))).join('\n') + '\n';
}

/**
 * The vite plugin: resolves and loads `virtual:xv-fonts.css`, and records the
 * font packages for the licence notice when it does.
 * @returns {import('vite').Plugin}
 */
export function inlineFonts() {
  return {
    name: 'excavator-inline-fonts',
    resolveId(id) {
      return id === FONTS_MODULE ? FONTS_MODULE : null;
    },
    load(id) {
      if (id !== FONTS_MODULE) return null;
      for (const pkg of FONT_PACKAGES) notePackage(packageRoot(pkg));
      return fontsStylesheet();
    },
  };
}
