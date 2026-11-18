/**
 * The chapters the handbook and the page show: the file's text, except that the defects chapter gets the number `D<n>` in
 * front of each item's short title and the remedies chapter gets the generated section of the problems no measure
 * addresses (openspec change handbook-process-review, design D2 and D11). The files are not changed. Both `assemble` and
 * `page-data` render a chapter through here, so the two views and the page show the same text.
 */

import { runNumbers } from './item-numbers.mjs';
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

/** The chapter `name` of the loaded run as it is shown: `{ text, record }`. */
export function renderedChapter(run, name) {
  const chapter = run.chapters.get(name);
  if (name === 'defects') {
    const numbers = runNumbers(run).defects;
    return numbers.state === 'ok' ? { ...chapter, text: numberDefects(chapter.text, numbers.items) } : chapter;
  }
  if (name === 'remedies') return { ...chapter, text: withCoverage(chapter.text, runNumbers(run), run.ui) };
  return chapter;
}
