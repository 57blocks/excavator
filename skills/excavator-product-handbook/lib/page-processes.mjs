/**
 * The `processes` key of the page data (openspec change handbook-process-review, task 7.1, design D7 and D10): the
 * business processes of the checked business-processes chapter, numbered by item-numbers.mjs (never a second numbering), each with
 * its steps, its end state and the features its steps pass through, plus the operations that no step names. `null` when the run
 * has no usable chapter (no file, or one that did not pass its check) or the outline leaves the chapter out, so the page shows
 * neither a page nor an empty one.
 */

import { citationGroups, specKey } from './chapter-cites.mjs';
import { runNumbers } from './item-numbers.mjs';
import { productText } from './md-views.mjs';
import { uncoveredOperations } from './processes-coverage.mjs';
import { parseProcesses } from './processes-parse.mjs';

const WIDE_OPEN = String.fromCharCode(0xff08);
const WIDE_CLOSE = String.fromCharCode(0xff09);
const WIDE_COLON = String.fromCharCode(0xff1a);
const NUMBERED_ROLE = /^\s*\d+\.\s+/;
const FEATURE_REF = new RegExp(`[(${WIDE_OPEN}]\\s*F\\d+\\s*[)${WIDE_CLOSE}]`);
const CLOSER = new RegExp(`^\\s*[)${WIDE_CLOSE}]`);
const LEADING_COLON = new RegExp(`^\\s*[:${WIDE_COLON}]\\s*`);

const specsOf = (text) => [...new Set(citationGroups(text).flatMap((group) => group.specs.map(specKey)))];
const flat = (text) => text.replace(/\s+/g, ' ').trim();

/** The role of a step: the text before its first bold fragment, without the list number and the colon (ASCII or full-width). */
function roleOf(text) {
  const bold = text.indexOf('**');
  const head = bold === -1 ? '' : text.slice(0, bold).replace(NUMBERED_ROLE, '').trim();
  return head.replace(new RegExp(`[:${WIDE_COLON}]\\s*$`), '').trim();
}

/** The sentence of a step: what follows the feature reference `(<name> (F<n>))` after the bold operation, flattened to one line. */
function sentenceOf(text) {
  const bold = /\*\*(.+?)\*\*/s.exec(text);
  const after = bold === null ? text : text.slice(bold.index + bold[0].length);
  const ref = FEATURE_REF.exec(after);
  if (ref === null) return flat(after);
  return flat(after.slice(ref.index + ref[0].length).replace(CLOSER, '').replace(LEADING_COLON, ''));
}

/** `{ text, cites? }` of a raw sentence: the product text without citations, and the citations in the technical view. */
function shown(raw, technical) {
  const text = flat(productText(raw));
  return technical ? { text, cites: specsOf(raw) } : { text };
}

/** The end-state line of a process (the fixed end label and a colon, then the text), read from the lines `from`..`to` (1-based, inclusive) of the chapter, or null. */
function endOf(lines, from, to, label, technical) {
  const pattern = new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:${WIDE_COLON}]\\s*(.*)$`);
  for (let at = from; at <= to; at += 1) {
    const found = pattern.exec(lines[at - 1] ?? '');
    if (found !== null) return shown(found[1], technical);
  }
  return null;
}

/** The `processes` key: `{ items, coverage }`, or null. `views` are the page's views. */
export function processesData(run, views, { placed = true } = {}) {
  const numbers = runNumbers(run).processes;
  if (numbers.state !== 'ok' || !placed) return null;
  const technical = views.includes('technical');
  const text = run.chapters.get('processes').text;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const parsed = parseProcesses(text);
  const label = run.ui['chapter.processes.end'];
  const items = numbers.items.map((entry, at) => {
    const process = parsed[at];
    const stop = at + 1 < parsed.length ? parsed[at + 1].line - 1 : lines.length;
    const steps = process.steps.filter((step) => step.feature !== null && step.operation !== null).map((step) => ({
      role: roleOf(step.text),
      operation: step.operation,
      feature: step.feature,
      ...shown(sentenceOf(step.text), technical),
    }));
    const end = endOf(lines, process.line + 1, stop, label, technical);
    return { id: entry.id, name: entry.title, steps, ...(end === null ? {} : { end }), features: [...entry.features] };
  });
  const coverage = uncoveredOperations({ map: run.map, chapters: run.chapters, strings: run.ui, items: numbers.items }).map((gap) => ({ feature: gap.id, operations: gap.operations }));
  return { items, coverage };
}
