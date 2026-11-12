/**
 * tour-titles.mjs
 *
 * The title a step gets when the verifier contradicts its own title twice (openspec:
 * changes/tour-product, requirement "sentence verification", design D3): the names of
 * the nodes the step cites, in `nodeIds` order, joined with ", ". A title that is wrong
 * does not make the description wrong, and the node names are facts of the knowledge
 * graph, so the step stays and only its title is replaced.
 *
 * The names come from candidates.json, whose `name` is the knowledge graph node's
 * `name`, copied by `candidates` from the same facts (`report` refuses a graph with
 * another facts digest). A cited node with no name there is refused, never replaced by
 * its id.
 *
 * A title holds at most 60 characters (code points, as `check` counts them). When the
 * names do not fit, the title keeps the whole names that fit before ", " and an ellipsis,
 * so a reader sees that more nodes are cited and no name is shown cut; when even the
 * first name does not fit, it is cut to 59 characters and the ellipsis.
 */

import { LIMITS } from './tour-check.mjs';
import { TourInputError } from './tour-layout.mjs';

const ELLIPSIS = '\u2026';
const SEPARATOR = ', ';
const length = (text) => [...text].length;

/** The replacement title for `names`, at most LIMITS.titleChars characters. */
export function titleFromNames(names) {
  const limit = LIMITS.titleChars;
  const full = names.join(SEPARATOR);
  if (length(full) <= limit) return full;
  const tail = `${SEPARATOR}${ELLIPSIS}`;
  let kept = 0;
  while (kept < names.length && length(`${names.slice(0, kept + 1).join(SEPARATOR)}${tail}`) <= limit) kept += 1;
  if (kept > 0) return `${names.slice(0, kept).join(SEPARATOR)}${tail}`;
  return `${[...names[0]].slice(0, limit - 1).join('')}${ELLIPSIS}`;
}

/** The replacement title of a step citing `nodeIds`, from the candidates' names. Throws TourInputError for a node with no name. */
export function titleFromNodes(nodeIds, candidates) {
  const byId = new Map(candidates.candidates.map((candidate) => [candidate.id, candidate]));
  const names = nodeIds.map((id) => {
    const name = byId.get(id)?.name;
    if (typeof name !== 'string' || name.trim() === '') {
      throw new TourInputError(`the title of a step citing ${id} must be replaced by node names, but ${id} has no name in candidates.json; run \`tour.mjs candidates\` again`);
    }
    return name;
  });
  return titleFromNames(names);
}
