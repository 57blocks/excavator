/**
 * `prd.mjs assemble <out>` (openspec changes prd-feature-pipeline, design D7,
 * and prd-report-prd-shape, design D4): concatenates, in this order,
 * overview.md, Terminology, the flow index, Roles, the chapters of the
 * written features (checked or verified) in `chapter` order without their
 * open items sections, Open items, and an appendix with the coverage and
 * verification tables, the failed features with their reasons and the
 * features not written. The tables come from `aggregate`; the flow index is
 * made here because its links are the anchors GitHub gives the headings of
 * the assembled text. Front-matter is stripped; the same input gives the same
 * bytes. Statuses come from index.json as `aggregate` left it.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { PRD_FILE, TABLE_FILES, WRITTEN_STATUSES } from './aggregate.mjs';
import { anchoredHeadings } from './anchors.mjs';
import { body, byChapter, splitChapter } from './chapter.mjs';
import { endsInsideFence } from './headings.mjs';
import { loadIndex, schemaProblems } from './index-check.mjs';
import { MERMAID, chapterPath } from './lane-check.mjs';
import { projectRootProblem } from './project-root.mjs';

const OVERVIEW_FILE = 'overview.md';
const [TERMINOLOGY_FILE, ROLES_FILE, OPEN_ITEMS_FILE, COVERAGE_FILE, VERIFICATION_FILE] = TABLE_FILES;

const cell = (value) => String(value).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const label = (feature) => `${feature.id} ${feature.name}`;
/** A heading's text as the label of a link: brackets escaped, so the link syntax holds. */
const linkLabel = (text) => text.replace(/[\\[\]]/g, '\\$&');
const FLOW_INDEX_HEADING = '## Flow index';
/** The position of the flow index among the parts of the document: after the overview and Terminology, before Roles and the chapters. */
const FLOW_INDEX_AT = 2;

/** The problem lines of an overview that is not the title and capability map the document starts with, or an empty list. */
function overviewProblems(overview) {
  const problems = [];
  if (!/^# \S/.test(overview)) problems.push(`index: ${OVERVIEW_FILE} must start with one # heading, the document title, on its first line`);
  if ((overview.match(MERMAID) ?? []).length === 0) problems.push(`index: ${OVERVIEW_FILE} has no mermaid block; write the capability map with one`);
  // An open fence would swallow every heading after the overview, so the flow index could not find them.
  if (endsInsideFence(overview)) problems.push(`index: ${OVERVIEW_FILE} ends inside an open code fence; close it`);
  return problems;
}

/**
 * The flow index: a row for each written reference feature (its `##`
 * heading) and for each flow of the other written features (its `###`
 * heading), each linking to the anchor of that heading in `headings`, the
 * anchored headings of the assembled text. Returns { lines } or { problems }.
 */
function flowIndex(chapters, headings) {
  const problems = [];
  const rows = [];
  for (const { feature, split, start, end } of chapters) {
    const own = headings.filter((heading) => heading.line >= start && heading.line < end);
    const link = (text, anchor) => `[${linkLabel(text)}](#${anchor})`;
    if (feature.kind === 'reference') {
      const chapter = own.find((heading) => heading.level === 2);
      if (chapter === undefined) problems.push(`${feature.id}: the chapter has no ## heading in the assembled text; run aggregate before assemble`);
      else rows.push([feature.id, link(chapter.text, chapter.anchor), label(feature), feature.kind]);
      continue;
    }
    const taken = new Map();
    split.flows.forEach((title, at) => {
      const seen = taken.get(title) ?? 0;
      taken.set(title, seen + 1);
      const heading = own.filter((item) => item.level === 3 && item.text === title)[seen];
      if (heading === undefined) problems.push(`${feature.id}: flow "${title}" is not a ### heading of the assembled chapter; run aggregate before assemble`);
      else rows.push([`${feature.id}.${at + 1}`, link(title, heading.anchor), label(feature), feature.kind]);
    });
  }
  if (problems.length > 0) return { problems };
  if (rows.length === 0) return { lines: ['None.'] };
  const line = (cells) => `| ${cells.map(cell).join(' | ')} |`;
  return { lines: [line(['#', 'Flow', 'Feature', 'Kind']), '|---|---|---|---|', ...rows.map(line)] };
}

/** Run assemble on `<out>`. Returns { status, lines }. */
export function assemble(outDirArg, root) {
  const outDir = resolve(outDirArg);
  const read = loadIndex(outDir);
  if (!read.ok) return { status: 1, lines: [read.line] };
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
  const written = index.features.filter((feature) => WRITTEN_STATUSES.includes(feature.status)).sort(byChapter);
  for (const feature of written) {
    if (!existsSync(join(outDir, chapterPath(feature.id)))) missing.push(`${feature.id}: ${chapterPath(feature.id)} is missing; run aggregate before assemble`);
  }
  if (missing.length > 0) return { status: 1, lines: missing };

  const readPart = (rel) => body(readFileSync(join(outDir, rel), 'utf-8'));
  const overview = readPart(OVERVIEW_FILE);
  const problems = overviewProblems(overview);
  const chapters = written.map((feature) => ({ feature, split: splitChapter(readFileSync(join(outDir, chapterPath(feature.id)), 'utf-8')) }));
  for (const { feature, split } of chapters) {
    if (!split.ok) problems.push(`${feature.id}: ${chapterPath(feature.id)} ${split.reason}; run aggregate before assemble`);
  }
  if (problems.length > 0) return { status: 1, lines: problems };

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
  const notWritten = index.features.filter((feature) => feature.status === 'planned' || feature.status === 'written');
  const notWrittenLines = ['### Features not written', '', '| Feature | Name | Status |', '|---|---|---|'];
  for (const feature of notWritten) notWrittenLines.push(`| ${feature.id} | ${cell(feature.name)} | ${feature.status} |`);

  // The parts in the order of the document; the flow index is a placeholder until the anchors of the whole text are known.
  // None is empty: the overview starts with a heading, each chapter holds its ## heading, each table has text.
  const parts = [
    overview,
    `## Terminology\n\n${readPart(TERMINOLOGY_FILE)}`,
    FLOW_INDEX_HEADING,
    `## Roles\n\n${readPart(ROLES_FILE)}`,
    ...chapters.map(({ split }) => split.body),
    `## Open items\n\n${readPart(OPEN_ITEMS_FILE)}`,
    '## Appendix',
    readPart(COVERAGE_FILE),
    readPart(VERIFICATION_FILE),
    failedLines.join('\n'),
    ...(notWritten.length > 0 ? [notWrittenLines.join('\n')] : []),
  ];

  // Where each chapter's lines lie in the text, parts being joined by one blank line.
  const firstChapter = FLOW_INDEX_AT + 2;
  let line = parts.slice(0, firstChapter).reduce((total, part) => total + part.split('\n').length + 1, 0);
  for (const chapter of chapters) {
    chapter.start = line;
    line += chapter.split.body.split('\n').length + 1;
    chapter.end = line;
  }
  const headings = anchoredHeadings(parts.join('\n\n'));
  const flows = flowIndex(chapters, headings);
  if (flows.problems) return { status: 1, lines: flows.problems };
  parts[FLOW_INDEX_AT] = [FLOW_INDEX_HEADING, '', ...flows.lines].join('\n');

  const prdPath = join(outDir, PRD_FILE);
  writeFileSync(prdPath, `${parts.join('\n\n')}\n`);
  return { status: 0, lines: [prdPath] };
}
