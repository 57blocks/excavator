#!/usr/bin/env node
// @ts-check
/**
 *   node scripts/check-template.mjs <outDir>
 *
 * The check `pnpm build` runs after vite: the output directory holds only
 * prd-report-page.html, which keeps the template contract and starts with the
 * list of bundled packages. Prints one line per violation and exits 1, or
 * prints the template's size and exits 0.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { PAGE_TEMPLATE, checkPageTemplate } from './template.mjs';

const outDir = resolve(process.argv[2] ?? 'dist');
if (!existsSync(outDir)) {
  process.stderr.write(`check-template: ${outDir} does not exist\n`);
  process.exit(1);
}
const names = readdirSync(outDir, { recursive: true, encoding: 'utf-8' });
const path = join(outDir, PAGE_TEMPLATE);
const html = existsSync(path) ? readFileSync(path, 'utf-8') : null;
const problems = checkPageTemplate(names, html);
if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`check-template: ${problem}\n`);
  process.exit(1);
}
process.stdout.write(`check-template: ${PAGE_TEMPLATE} ${Buffer.byteLength(/** @type {string} */ (html))} bytes, one file, contract holds\n`);
