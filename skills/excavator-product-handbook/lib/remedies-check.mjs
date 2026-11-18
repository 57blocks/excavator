/**
 * `check remedies`: what guards the remedies chapter against fabrication (openspec change handbook-process-review, task 1.3,
 * design D11). The chapter's shape is a writing instruction (sections/remedies.md), not checked. The script checks that every
 * id in an id group exists in the tables `remedies-inputs` prints, that a block holds at most one id group, and that every
 * citation of a block is one of the citations of the items its id group names. The chapter's own lint (citations exist, code
 * words) runs as for every chapter.
 *
 * `numbers.processes` is where a later slice supplies the process ids.
 */

import { UNAVAILABLE } from './item-numbers.mjs';
import { parseRemedies } from './remedies-parse.mjs';

/** Where an id points: `{ entry }` of the numbers table, or `{ problem }` saying why it cannot be used. */
function resolveId(id, numbers) {
  const number = Number(id.slice(1));
  if (id[0] === 'D' || id[0] === 'R') {
    const [source, file, what] = id[0] === 'D' ? [numbers.defects, 'defects', 'a defect'] : [numbers.design, 'review', 'a design problem'];
    const label = id[0] === 'D' ? 'defects' : 'design problems';
    if (source.state !== 'ok') return { problem: `${id}: the ${label} are not available (${file}.md ${UNAVAILABLE[source.state]})` };
    const entry = source.items[number - 1];
    return entry === undefined ? { problem: `${id} is not ${what}: there ${source.items.length === 1 ? 'is' : 'are'} ${source.items.length}` } : { entry };
  }
  if (numbers.processes === undefined) return { problem: `${id}: there is no process inventory` };
  const entry = numbers.processes.items?.[number - 1];
  return entry === undefined ? { problem: `${id} is not a process` } : { entry };
}

/** The reasons the remedies chapter `text` is refused; `numbers` is `itemNumbers`' result. */
export function remediesReasons(text, { numbers }) {
  const reasons = [];
  for (const block of parseRemedies(text).items) {
    if (block.groups.length > 1) reasons.push(`line ${block.line}: the block holds ${block.groups.length} id groups; hold at most one`);
    const resolved = [];
    let broken = false;
    for (const id of new Set(block.ids)) {
      const found = resolveId(id, numbers);
      if (found.problem !== undefined) {
        reasons.push(`line ${block.line}: ${found.problem}`);
        broken = true;
      } else resolved.push({ id, entry: found.entry });
    }
    if (broken || block.cites.length === 0) continue;
    if (resolved.length === 0) {
      reasons.push(`line ${block.line}: a citation must sit with the ids of the items it is copied from; this block cites \`${block.cites[0]}\` and names no id`);
      continue;
    }
    const allowed = new Set(resolved.flatMap(({ entry }) => entry.cites ?? []));
    for (const spec of block.cites) {
      if (!allowed.has(spec)) reasons.push(`line ${block.line}: the citation \`${spec}\` is not one of the citations of ${resolved.map(({ id }) => id).join(', ')}; copy a citation from the items the id group names`);
    }
  }
  return reasons;
}
