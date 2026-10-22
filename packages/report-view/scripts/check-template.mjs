#!/usr/bin/env node
// @ts-check
/**
 * check-template.mjs
 *
 *   node scripts/check-template.mjs <outDir>
 *
 * The check `pnpm build` runs after vite (openspec: changes/viewer-app, design
 * D2): the output directory holds only view.html, view.html keeps the
 * template contract (see checkTemplate) and starts with the licence notice that
 * names the packages it bundles, the inlined fonts among them. Prints one
 * line per violation and exits 1, or prints the template's size and exits 0.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { FONT_PACKAGES } from './fonts.mjs';
import { checkLicenseNotice } from './licenses.mjs';
import { TEMPLATE_FILE, checkTemplate } from './single-file.mjs';

const outDir = resolve(process.argv[2] ?? 'dist');
if (!existsSync(outDir)) {
  process.stderr.write(`check-template: ${outDir} does not exist\n`);
  process.exit(1);
}
const names = readdirSync(outDir, { recursive: true, encoding: 'utf-8' });
const path = join(outDir, TEMPLATE_FILE);
const html = existsSync(path) ? readFileSync(path, 'utf-8') : null;
const problems = checkTemplate(names, html);
if (html !== null) {
  const notice = checkLicenseNotice(html, ['elkjs', 'react', 'd3-force', ...FONT_PACKAGES]);
  if (notice) problems.push(notice);
}
if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`check-template: ${problem}\n`);
  process.exit(1);
}
process.stdout.write(`check-template: ${TEMPLATE_FILE} ${Buffer.byteLength(/** @type {string} */ (html))} bytes, one file, contract holds\n`);
