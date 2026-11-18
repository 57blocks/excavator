/**
 * The problems no measure addresses (openspec change handbook-process-review, task 1.4, design D11): the design problems of
 * impact `high` and the P0 defects whose id no list item of the remedies chapter names. The script computes them; the
 * assembled handbook and the page append them to the rendered remedies chapter as a generated level-2 section. The
 * remedies chapter file is not changed.
 */

import { namedIds, parseRemedies } from './remedies-parse.mjs';

/** `{ defects, design }`: the P0 defect entries and the high-impact design problem entries of `numbers` that `text` (the remedies chapter) does not name. */
export function uncoveredItems(numbers, text) {
  const named = namedIds(parseRemedies(text));
  return {
    defects: numbers.defects.items.filter((entry) => entry.level === 'P0' && !named.has(entry.id)),
    design: numbers.design.items.filter((entry) => entry.impact === 'high' && !named.has(entry.id)),
  };
}

/** The lines of the generated section for the remedies chapter `text`: heading, then the gaps or the fixed none line. */
export function coverageLines(numbers, text, strings) {
  const { defects, design } = uncoveredItems(numbers, text);
  const lines = [`## ${strings['chapter.remedies.uncovered']}`, ''];
  const listed = [...defects.map((entry) => `- ${entry.id} ${entry.title}`), ...design.map((entry) => `- ${entry.id} ${entry.title}`)];
  const reviewAvailable = numbers.design.state === 'ok';
  if (listed.length > 0) lines.push(...listed);
  else if (reviewAvailable) lines.push(strings['chapter.remedies.uncoveredNone']);
  if (!reviewAvailable) lines.push(...(listed.length > 0 ? [''] : []), strings['chapter.remedies.uncoveredNoReview']);
  return lines;
}

/** The remedies chapter `text` with the generated section appended. */
export const withCoverage = (text, numbers, strings) => `${text.replace(/\s+$/, '')}\n\n${coverageLines(numbers, text, strings).join('\n')}\n`;
