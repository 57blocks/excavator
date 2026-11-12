// @ts-check
/**
 * licenses.mjs
 *
 * The licence notice of the template (openspec: changes/viewer-app): explorer.html
 * bundles third-party code (elkjs is EPL-2.0 OR GPL-3.0-or-later; React, the
 * graph library, the motion library and the others carry their own licences),
 * so the file starts with one HTML comment that lists each bundled package with
 * its version and licence id.
 *
 * `collectBundledPackages` is a vite plugin, registered for the page build and
 * for the worker build: it records the package of every module vite transforms
 * from `node_modules`. The list is read from each package's own package.json,
 * sorted by name and version, so the same install gives the same notice.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MODULES = '/node_modules/';
/** Rollup marks a generated module (a CommonJS wrapper, say) of file `x` with a NUL before `x`. */
const NUL = String.fromCharCode(0);
/** The opening line of the notice; `checkLicenseNotice` looks for it. */
export const NOTICE_HEADING = 'Third-party software bundled in this file (package, version, licence):';

/**
 * The package a module belongs to, or null for a module outside node_modules:
 * the name and the directory that holds its package.json.
 * @param {string} moduleId a module id, with or without a `?query`
 * @returns {{ name: string, root: string } | null}
 */
export function packageOfModule(moduleId) {
  const id = (moduleId.startsWith(NUL) ? moduleId.slice(1) : moduleId).split('?')[0].replaceAll('\\', '/');
  const at = id.lastIndexOf(MODULES);
  if (at === -1) return null;
  const parts = id.slice(at + MODULES.length).split('/');
  const length = parts[0].startsWith('@') ? 2 : 1;
  if (parts.length <= length || parts.slice(0, length).some((part) => part === '' || part === '.' || part === '..')) return null;
  const name = parts.slice(0, length).join('/');
  return { name, root: id.slice(0, at + MODULES.length) + name };
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function licenseId(value) {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (value && typeof value === 'object' && typeof (/** @type {{ type?: unknown }} */ (value)).type === 'string') return /** @type {{ type: string }} */ (value).type;
  if (Array.isArray(value) && value.length > 0) return value.map(licenseId).join(' OR ');
  return null;
}

/**
 * @typedef {{ name: string, version: string, license: string }} BundledPackage
 */

/**
 * Name, version and licence id from the package.json in `root`; a package that
 * names no licence is listed as such, not left out.
 * @param {string} root
 * @returns {BundledPackage}
 */
export function readBundledPackage(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
  return {
    name: String(manifest.name),
    version: String(manifest.version),
    license: licenseId(manifest.license) ?? licenseId(manifest.licenses) ?? 'no licence field',
  };
}

/**
 * The comment: one line for each package, in name then version order, once each.
 * @param {readonly BundledPackage[]} packages
 * @returns {string}
 */
export function licenseNotice(packages) {
  const unique = new Map(packages.map((pkg) => [`${pkg.name}@${pkg.version}`, pkg]));
  const lines = [...unique.values()]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : a.version > b.version ? 1 : 0))
    // A comment cannot hold two hyphens in a row.
    .map((pkg) => `${pkg.name} ${pkg.version} ${pkg.license}`.replaceAll('--', '- -'));
  return `<!--\n${NOTICE_HEADING}\n${lines.join('\n')}\n-->\n`;
}

/** The package roots of the modules seen in this process, by build. */
const seen = new Set();

/**
 * The vite plugin that records the packages the build bundles; register it in
 * `plugins` and in `worker.plugins`, which build separately.
 * @returns {import('vite').Plugin}
 */
export function collectBundledPackages() {
  return {
    name: 'excavator-collect-packages',
    transform(_code, id) {
      const owner = packageOfModule(id);
      if (owner) seen.add(owner.root);
      return null;
    },
  };
}

/**
 * Record a package whose files the build inlines without a module of it
 * passing through `transform` (the fonts, which a plugin reads itself).
 * @param {string} root the directory that holds its package.json
 */
export function notePackage(root) {
  seen.add(root);
}

/** The notice for every package seen so far. */
export function bundledPackagesNotice() {
  return licenseNotice([...seen].map(readBundledPackage));
}

/**
 * Why `html` does not carry a notice that names `required` packages, or null.
 * @param {string} html
 * @param {readonly string[]} [required]
 * @param {string} [fileName] the template's name, for the messages
 * @returns {string | null}
 */
export function checkLicenseNotice(html, required = [], fileName = 'explorer.html') {
  const match = /^<!--\n([\s\S]*?)\n-->\n/.exec(html);
  if (!match) return `${fileName} does not start with the licence notice comment`;
  const lines = match[1].split('\n');
  if (lines[0] !== NOTICE_HEADING) return `the first comment of ${fileName} is not the licence notice`;
  const entries = lines.slice(1);
  if (entries.length === 0) return 'the licence notice lists no package';
  for (const name of required) {
    if (!entries.some((line) => line.startsWith(`${name} `))) return `the licence notice does not list ${name}`;
  }
  return null;
}
