/**
 * The chapters the handbook and the page show: the file's text, except that the defects chapter gets the number `D<n>` in
 * front of each item's short title, the business-processes chapter gets `P<n>` after the `## ` of each process heading and
 * the generated section of the operations in no process, and the remedies chapter gets the generated section of the
 * problems no measure addresses (openspec change handbook-process-review, design D2 and D11). The files are not changed. Both `assemble` and
 * `page-data` render a chapter through here, so the two views and the page show the same text.
 */

import { runNumbers } from './item-numbers.mjs';
import { processCoverageLines } from './processes-coverage.mjs';
import { withCoverage } from './remedies-coverage.mjs';

const AFTER_CATEGORY = /^(\s*[-*+]\s+\*\*[^*]+\*\*)\s*(.*)$/;
const BEFORE_TITLE = /^(\s*[-*+]\s+\*\*[^*]+\*\*\s*)(\*\*)/;

/** `text` with `D<n> ` before the bold short title of each defect item (after the bold category for an item without one); no line is added or moved. */
export function numberDefects(text, items) {
  const lines = text.split('\n');
  for (const { n, item, line } of items) {
    const raw = lines[line - 1];
    if (item.title !== null) lines[line - 1] = raw.replace(BEFORE_TITLE, `$1D${n} $2`);
    else lines[line - 1] = raw.replace(AFTER_CATEGORY, (_, head, rest) => `${head} D${n}${rest === '' ? '' : ` ${rest}`}`);
  }
  return lines.join('\n');
}

/** `text` with `P<n> ` after the `## ` of each process heading; no line is added or moved. */
export function numberProcesses(text, items) {
  const lines = text.split('\n');
  for (const { n, line } of items) lines[line - 1] = lines[line - 1].replace(/^##\s+/, `## P${n} `);
  return lines.join('\n');
}

/** The chapter `name` of the loaded run as it is shown: `{ text, record }`. */
export function renderedChapter(run, name) {
  const chapter = run.chapters.get(name);
  if (name === 'defects') {
    const numbers = runNumbers(run).defects;
    return numbers.state === 'ok' ? { ...chapter, text: numberDefects(chapter.text, numbers.items) } : chapter;
  }
  if (name === 'processes') {
    const numbers = runNumbers(run).processes;
    if (numbers.state !== 'ok') return chapter;
    const coverage = processCoverageLines({ map: run.map, chapters: run.chapters, strings: run.ui, items: numbers.items });
    return { ...chapter, text: `${numberProcesses(chapter.text, numbers.items).replace(/\s+$/, '')}\n\n${coverage.join('\n')}\n` };
  }
  if (name === 'remedies') return { ...chapter, text: withCoverage(chapter.text, runNumbers(run), run.ui) };
  return chapter;
}
