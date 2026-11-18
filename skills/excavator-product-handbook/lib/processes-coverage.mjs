/**
 * The operations in no process (openspec change handbook-process-review, design D7): per feature in map order, the
 * operations of its chapter that no step of any process names, a step naming an operation when it has that feature and that
 * exact operation. The script computes them; the assembled handbook and the page append them to the rendered
 * business-processes chapter as a generated level-2 section. The chapter file is not changed.
 */

import { featureParts } from './processes-parse.mjs';

/** `[{ feature, id, operations: [title] }]`: the map features whose chapter has operations that `numbers.items` (the process numbers) do not name. */
export function uncoveredOperations({ map, chapters, strings, items }) {
  const named = new Set(items.flatMap((item) => item.steps.map((step) => `${step.feature}\n${step.operation}`)));
  const out = [];
  for (const feature of map.features) {
    const chapter = chapters.get(feature.id);
    if (chapter === undefined) continue;
    const missing = featureParts(chapter.text, strings).operations.map((operation) => operation.title).filter((title) => !named.has(`${feature.id}\n${title}`));
    if (missing.length > 0) out.push({ feature, id: feature.id, operations: missing });
  }
  return out;
}

/** The lines of the generated section: heading, then one list item per feature with gaps or the fixed none line. */
export function processCoverageLines({ map, chapters, strings, items }) {
  const gaps = uncoveredOperations({ map, chapters, strings, items });
  const join = strings['chapter.processes.uncoveredJoin'] ?? ', ';
  return [
    `## ${strings['chapter.processes.uncovered']}`,
    '',
    ...(gaps.length === 0 ? [strings['chapter.processes.uncoveredNone']] : gaps.map((gap) => `- ${gap.feature.name} (${gap.id}): ${gap.operations.join(join)}`)),
  ];
}
