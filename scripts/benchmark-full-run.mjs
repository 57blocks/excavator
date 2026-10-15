#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CliUsageError,
  helpText,
  parseArgs,
  parseRunRecord,
  readSample,
  renderMarkdown,
  runMeasured,
  summarizeRun,
} from './lib/full-run-report.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function write(result, outDir, stem) {
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, `${stem}.report.json`);
  const markdownPath = join(outDir, `${stem}.report.md`);
  const markdown = renderMarkdown(result, { title: `Full run report: ${stem}` });
  writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(markdownPath, markdown);
  process.stdout.write(`${markdown}\nJSON report: ${jsonPath}\nMarkdown report: ${markdownPath}\n`);
}

function report(options) {
  const recordPath = resolve(options.record);
  if (!existsSync(recordPath)) throw new CliUsageError(`no run record at ${recordPath}`);
  const missingSample = [];
  const sample = options.project ? readSample(resolve(options.project), missingSample) : null;
  const result = summarizeRun(parseRunRecord(readFileSync(recordPath, 'utf-8')), { sample });
  result.missing.push(...missingSample);
  result.record = recordPath;
  write(result, resolve(options.out ?? dirname(recordPath)), basename(recordPath, extname(recordPath)));
}

async function run(options) {
  const result = await runMeasured(options, {
    repoRoot: REPO_ROOT,
    onProgress: (message) => process.stderr.write(`[full-run] ${message}\n`),
  });
  write(result, resolve(options.out), 'run');
  if (result.run.exitCode !== 0) process.exitCode = 1;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(helpText());
      return;
    }
    if (options.command === 'run') await run(options);
    else report(options);
  } catch (error) {
    if (error instanceof CliUsageError) {
      process.stderr.write(`Error: ${error.message}\n\n${helpText()}`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
}

await main();
