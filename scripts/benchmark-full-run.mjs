#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import {
  CliUsageError,
  helpText,
  parseArgs,
  parseRunRecord,
  readSample,
  renderMarkdown,
  summarizeRun,
} from './lib/full-run-report.mjs';

function report(options) {
  const recordPath = resolve(options.record);
  if (!existsSync(recordPath)) throw new CliUsageError(`no run record at ${recordPath}`);
  const missingSample = [];
  const sample = options.project ? readSample(resolve(options.project), missingSample) : null;
  const result = summarizeRun(parseRunRecord(readFileSync(recordPath, 'utf-8')), { sample });
  result.missing.push(...missingSample);
  result.record = recordPath;

  const outDir = resolve(options.out ?? dirname(recordPath));
  mkdirSync(outDir, { recursive: true });
  const stem = basename(recordPath, extname(recordPath));
  const jsonPath = join(outDir, `${stem}.report.json`);
  const markdownPath = join(outDir, `${stem}.report.md`);
  const markdown = renderMarkdown(result, { title: `Full run report: ${stem}` });
  writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(markdownPath, markdown);
  process.stdout.write(`${markdown}\nJSON report: ${jsonPath}\nMarkdown report: ${markdownPath}\n`);
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(helpText());
      return;
    }
    report(options);
  } catch (error) {
    if (error instanceof CliUsageError) {
      process.stderr.write(`Error: ${error.message}\n\n${helpText()}`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
}

main();
