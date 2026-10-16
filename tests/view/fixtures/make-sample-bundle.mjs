#!/usr/bin/env node
/**
 * make-sample-bundle.mjs
 *
 * Regenerates the page's dev fixture `packages/view/fixtures/sample.bundle.txt`
 * (and nothing else): copies the synthetic project in
 * `tests/view/fixtures/sample-project` to a temp dir, runs the Lazy first run
 * on it, bakes it with a fixed clock and extracts the bundle payload.
 *
 * The output is reproducible byte for byte; `tests/view/sample-bundle.test.mjs`
 * regenerates it and compares with the committed file, so the fixture cannot
 * silently drift from the bake.
 *
 * Usage:
 *   node tests/view/fixtures/make-sample-bundle.mjs [--check] [--out <path>]
 *   --check   exit 1 when the committed fixture differs from a fresh bake
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runLazyAnalysis } from '../../../skills/excavator/lazy-analyze.mjs';
import { buildView } from '../../../skills/excavator-view/build-view.mjs';
import { extractBundleText } from '../../../skills/excavator-view/bake/html-output.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const SAMPLE_PROJECT = join(repoRoot, 'tests/view/fixtures/sample-project');
export const SAMPLE_BUNDLE = join(repoRoot, 'packages/view/fixtures/sample.bundle.txt');
/** Fixed clock for every timestamp the analysis and the bake record. */
export const FIXED_NOW = '2026-01-01T00:00:00.000Z';

/** The smallest template the bake accepts; the payload is all we keep. */
const TEMPLATE_HTML = [
  '<!doctype html><html><head>',
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; '
    + 'style-src \'unsafe-inline\'; img-src data:; worker-src blob:; connect-src \'none\'">',
  '<title>sample bundle</title></head><body><div id="root"></div>',
  '<script type="text/plain" id="excavator-view-data"></script>',
  '</body></html>',
].join('\n');

/** Bake the sample project and return the bundle payload text (with a trailing newline). */
export async function makeSampleBundle() {
  const scratch = mkdtempSync(join(tmpdir(), 'excavator-sample-bundle-'));
  try {
    const project = join(scratch, 'sample-project');
    cpSync(SAMPLE_PROJECT, project, { recursive: true });
    const now = () => FIXED_NOW;
    const result = await runLazyAnalysis({ projectRoot: project, now });
    if (result.saveError) throw new Error(`lazy analysis failed to save: ${result.saveError}`);
    const templatePath = join(scratch, 'template.html');
    writeFileSync(templatePath, TEMPLATE_HTML);
    const out = join(scratch, 'view.html');
    await buildView({ projectRoot: project, out, templatePath, now });
    const payload = extractBundleText(readFileSync(out, 'utf-8'));
    if (!payload) throw new Error('the baked page carries no bundle payload');
    return `${payload}\n`;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function isCliEntry() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isCliEntry()) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const out = outIndex >= 0 ? resolve(args[outIndex + 1]) : SAMPLE_BUNDLE;
  const text = await makeSampleBundle();
  if (args.includes('--check')) {
    const same = readFileSync(out, 'utf-8') === text;
    process.stdout.write(same ? `${out} is up to date\n` : `${out} differs from a fresh bake\n`);
    process.exit(same ? 0 : 1);
  }
  writeFileSync(out, text);
  process.stdout.write(`wrote ${out} (${Buffer.byteLength(text)} bytes)\n`);
}
