/**
 * `prd.mjs assemble <out>` (openspec change prd-feature-pipeline, design D7):
 * concatenates overview.md, the roles table, the chapters of the written
 * features (checked or verified) in `chapter` order, then an appendix with
 * the coverage and verification tables, the failed features with their
 * reasons and the features not written. Front-matter is stripped; the same
 * input gives the same bytes. Statuses come from index.json as `aggregate`
 * left it.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { PRD_FILE, TABLE_FILES, WRITTEN_STATUSES } from './aggregate.mjs';
import { INDEX_FILE, loadIndex, schemaProblems } from './index-check.mjs';
import { chapterPath } from './lane-check.mjs';
import { projectRootProblem } from './project-root.mjs';

const OVERVIEW_FILE = 'overview.md';

/** The text without a leading `---` front-matter block, line endings made LF, outer blank lines trimmed. */
export function body(text) {
  const lf = text.replace(/\r\n/g, '\n');
  const stripped = lf.startsWith('---\n') && lf.indexOf('\n---\n', 3) !== -1 ? lf.slice(lf.indexOf('\n---\n', 3) + 5) : lf;
  return stripped.replace(/^\s*\n/, '').replace(/\s+$/, '');
}

const cell = (value) => String(value).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const featureNumber = (id) => Number(id.slice(1));

/** Run assemble on `<out>`. Returns { status, lines }. */
export function assemble(outDirArg, root) {
  const outDir = resolve(outDirArg);
  const read = loadIndex(outDir);
  if (!read.ok) return { status: 1, lines: [`index: ${INDEX_FILE} ${read.reason}`] };
  const schema = schemaProblems(read.value);
  if (schema.length > 0) return { status: 1, lines: schema };
  const index = read.value;
  const rootProblem = projectRootProblem(index, root);
  if (rootProblem !== null) return { status: 1, lines: [rootProblem] };

  const missing = [];
  if (!existsSync(join(outDir, OVERVIEW_FILE))) missing.push(`index: ${OVERVIEW_FILE} is missing; write the overview before assemble`);
  for (const table of TABLE_FILES) {
    if (!existsSync(join(outDir, table))) missing.push(`index: ${table} is missing; run aggregate before assemble`);
  }
  const written = index.features
    .filter((feature) => WRITTEN_STATUSES.includes(feature.status))
    .sort((a, b) => a.chapter - b.chapter || featureNumber(a.id) - featureNumber(b.id));
  for (const feature of written) {
    if (!existsSync(join(outDir, chapterPath(feature.id)))) missing.push(`${feature.id}: ${chapterPath(feature.id)} is missing; run aggregate before assemble`);
  }
  if (missing.length > 0) return { status: 1, lines: missing };

  const readPart = (rel) => body(readFileSync(join(outDir, rel), 'utf-8'));
  const parts = [readPart(OVERVIEW_FILE), readPart(TABLE_FILES[0])];
  for (const feature of written) parts.push(readPart(chapterPath(feature.id)));

  parts.push('## Appendix', readPart(TABLE_FILES[1]), readPart(TABLE_FILES[2]));
  const failed = index.features.filter((feature) => feature.status === 'failed');
  const failedLines = ['### Failed features', ''];
  if (failed.length === 0) {
    failedLines.push('None.');
  } else {
    failedLines.push('| Feature | Name | Step | Reasons |', '|---|---|---|---|');
    for (const feature of failed) {
      failedLines.push(`| ${feature.id} | ${cell(feature.name)} | ${feature.failure?.step ?? '-'} | ${cell((feature.failure?.reasons ?? []).join('; '))} |`);
    }
  }
  parts.push(failedLines.join('\n'));
  const notWritten = index.features.filter((feature) => feature.status === 'planned' || feature.status === 'written');
  if (notWritten.length > 0) {
    const lines = ['### Features not written', '', '| Feature | Name | Status |', '|---|---|---|'];
    for (const feature of notWritten) lines.push(`| ${feature.id} | ${cell(feature.name)} | ${feature.status} |`);
    parts.push(lines.join('\n'));
  }

  const prdPath = join(outDir, PRD_FILE);
  writeFileSync(prdPath, `${parts.filter((part) => part !== '').join('\n\n')}\n`);
  return { status: 0, lines: [prdPath] };
}
