/**
 * html-output.mjs
 *
 * Template loading, pre-write page checks, and the atomic write of
 * `view.html` (openspec change `artifact-view`, design D4). The page is
 * written piecewise (template prefix, one line per bundle segment, suffix),
 * never as one joined string, to a sibling temporary file that is renamed
 * over the target only after every check passed. Any failure removes the
 * temporary file and leaves the target untouched.
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { DATA_PLACEHOLDER, countPlaceholders, cspProblems, externalReferences } from '../html-guards.mjs';
import { ViewSelfCheckError, ViewTemplateError } from './errors.mjs';

const DATA_OPEN = '<script type="text/plain" id="excavator-view-data">';
const DATA_CLOSE = '</script>';

/** Characters a bundle line may contain: base64, segment headers, column lists. */
const BUNDLE_LINE = /^[A-Za-z0-9+/=@ ,._-]*$/;

/**
 * Load and vet the page template: exactly one data placeholder, no external
 * reference, the required CSP.
 * @param {string} templatePath
 */
export function loadTemplate(templatePath) {
  if (!existsSync(templatePath)) {
    throw new ViewTemplateError(
      `view template not found at ${templatePath}; build it with: pnpm --filter @excavator/view build`,
    );
  }
  const html = readFileSync(templatePath, 'utf-8');
  const placeholders = countPlaceholders(html);
  if (placeholders !== 1) {
    throw new ViewTemplateError(`${templatePath} has ${placeholders} data placeholders, expected exactly 1`);
  }
  const problems = [
    ...externalReferences(html).map((ref) => `external reference ${ref}`),
    ...cspProblems(html),
  ];
  if (problems.length > 0) throw new ViewTemplateError(`${templatePath} is not a valid view template: ${problems.join('; ')}`);
  const at = html.indexOf(DATA_PLACEHOLDER);
  return {
    prefix: `${html.slice(0, at)}${DATA_OPEN}\n`,
    suffix: `\n${DATA_CLOSE}${html.slice(at + DATA_PLACEHOLDER.length)}`,
  };
}

/**
 * Check the composed page before it is written: the markup around the data
 * passes the guards, and no bundle line can break out of the data element.
 * @param {{ prefix: string, suffix: string }} template
 * @param {string[]} lines
 */
export function pageProblems(template, lines) {
  const shell = `${template.prefix}${template.suffix}`;
  const problems = [
    ...externalReferences(shell).map((ref) => `external reference ${ref}`),
    ...cspProblems(shell),
  ];
  lines.forEach((line, i) => {
    if (!BUNDLE_LINE.test(line)) problems.push(`bundle line ${i + 1} contains characters outside the bundle alphabet`);
  });
  return problems;
}

/**
 * Write the page atomically. Returns the byte size written.
 * @param {string} outPath
 * @param {{ prefix: string, suffix: string }} template
 * @param {string[]} lines
 */
export function writePageAtomic(outPath, template, lines) {
  const problems = pageProblems(template, lines);
  if (problems.length > 0) throw new ViewSelfCheckError(problems);
  mkdirSync(dirname(outPath), { recursive: true });
  const tmpPath = join(dirname(outPath), `.${basename(outPath)}.tmp-${process.pid}-${Date.now()}`);
  let fd = null;
  let bytes = 0;
  try {
    fd = openSync(tmpPath, 'w');
    const put = (/** @type {string} */ text) => {
      const buf = Buffer.from(text, 'utf-8');
      let offset = 0;
      while (offset < buf.length) offset += writeSync(fd, buf, offset, buf.length - offset);
      bytes += buf.length;
    };
    put(template.prefix);
    lines.forEach((line, i) => put(i === 0 ? line : `\n${line}`));
    put(template.suffix);
    closeSync(fd);
    fd = null;
    renameSync(tmpPath, outPath);
    return bytes;
  } catch (error) {
    if (fd !== null) closeSync(fd);
    rmSync(tmpPath, { force: true });
    throw error;
  }
}

/**
 * The bundle payload embedded in a baked page, or null. For tooling (the
 * committed dev fixture is extracted with it) and tests.
 * @param {string} html
 */
export function extractBundleText(html) {
  const start = html.indexOf(DATA_OPEN);
  if (start < 0) return null;
  const end = html.indexOf(DATA_CLOSE, start + DATA_OPEN.length);
  if (end < 0) return null;
  return html.slice(start + DATA_OPEN.length, end).trim();
}
