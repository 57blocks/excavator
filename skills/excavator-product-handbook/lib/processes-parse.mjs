/**
 * What the business-processes chapter and the feature chapters hold, read from their Markdown for `processes facts`,
 * `check processes`, the process numbers and the coverage section (openspec change handbook-process-review, design D7).
 * A process is a level-2 heading of the chapter; its steps are the top-level numbered list items under it; a step is
 * `<role>: **<operation>** (<feature name> (F<n>))` and names the operation in its first bold fragment and the feature
 * in the first `(F<n>)` after it. Pure; reads no file. Headings and items inside code fences are not read.
 */

const WIDE_OPEN = String.fromCharCode(0xff08);
const WIDE_CLOSE = String.fromCharCode(0xff09);
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const STEP = /^\d+\.\s/;
const TOP_ITEM = /^(?:[-*]|\d+\.)\s+\S/;
const FENCE = /^\s*```/;
const BOLD = /\*\*(.+?)\*\*/s;
const FEATURE_REF = new RegExp(`[(${WIDE_OPEN}]\\s*(F\\d+)\\s*[)${WIDE_CLOSE}]`);
const FEATURE_WORD = /\bF\d+\b/g;

/** The lines of `text` with their 1-based numbers, code-fence lines and the lines between them dropped. */
function proseLines(text) {
  const out = [];
  let inFence = false;
  text.replace(/\r\n?/g, '\n').split('\n').forEach((raw, at) => {
    if (FENCE.test(raw)) {
      inFence = !inFence;
      return;
    }
    if (!inFence) out.push({ raw, line: at + 1 });
  });
  return out;
}

/** The items of `lines` that start with `start` (a regex on the raw line), each with the indented lines after it; a heading ends the item. */
function itemsOf(lines, start) {
  const items = [];
  let current = null;
  for (const { raw, line } of lines) {
    if (HEADING.test(raw)) current = null;
    else if (start.test(raw)) {
      current = { line, text: raw };
      items.push(current);
    } else if (current !== null) {
      if (raw.trim() === '' || /^\s+\S/.test(raw)) current.text += `\n${raw}`;
      else current = null;
    }
  }
  return items;
}

/** `{ operation, feature }` of one step's text; either is null when the text has none. */
export function stepFields(text) {
  const bold = BOLD.exec(text);
  if (bold === null) return { operation: null, feature: null };
  const after = text.slice(bold.index + bold[0].length);
  const ref = FEATURE_REF.exec(after);
  return { operation: bold[1].trim(), feature: ref === null ? null : ref[1] };
}

/** `[{ name, line, steps: [{ line, operation, feature }] }]` of a business-processes chapter, in heading order. */
export function parseProcesses(text) {
  const lines = proseLines(text);
  const processes = [];
  lines.forEach(({ raw, line }, at) => {
    const heading = HEADING.exec(raw);
    if (heading === null || heading[1].length !== 2) return;
    const rest = [];
    for (const next of lines.slice(at + 1)) {
      if (HEADING.test(next.raw) && HEADING.exec(next.raw)[1].length <= 2) break;
      rest.push(next);
    }
    processes.push({ name: heading[2], line, steps: itemsOf(rest, STEP).map((item) => ({ line: item.line, ...stepFields(item.text) })) });
  });
  return processes;
}

/** `{ hasSection, operations: [{ title, line }], handovers: [{ line, features }] }` of a feature chapter; `strings` is the run's fixed text. */
export function featureParts(text, strings) {
  const operationsHeading = strings['chapter.section.operations'];
  const handoversHeading = strings['chapter.section.handovers'];
  const lines = proseLines(text);
  const operations = [];
  let hasSection = false;
  let section = null;
  const handoverLines = [];
  for (const entry of lines) {
    const heading = HEADING.exec(entry.raw);
    if (heading !== null) {
      const level = heading[1].length;
      if (level === 2) {
        section = heading[2];
        if (section === operationsHeading) hasSection = true;
      } else if (level === 3 && section === operationsHeading) operations.push({ title: heading[2], line: entry.line });
    }
    if (section === handoversHeading) handoverLines.push(entry);
  }
  const handovers = itemsOf(handoverLines, TOP_ITEM).map((item) => ({ line: item.line, features: [...new Set(item.text.match(FEATURE_WORD) ?? [])] }));
  return { hasSection, operations, handovers };
}
