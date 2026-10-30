/** `candidates.json` (design D2): the lister's output stamped with a format, and the read of it that every later command does. */

import { join } from 'node:path';

import { KINDS, listEntrypoints } from './entrypoints.mjs';
import { UsageError } from './errors.mjs';
import { isObject, readJson } from './json-file.mjs';
import { projectRootProblem } from './project-root.mjs';

export const CANDIDATES_FORMAT = 'excavator-product-handbook-candidates/1';
export const CANDIDATES_FILE = 'candidates.json';

/** The `candidates` command's output: the listing with the format as its first key. */
export async function candidatesOutput(project, scope) {
  return { format: CANDIDATES_FORMAT, ...(await listEntrypoints(project, { scope: scope ?? null })) };
}

/**
 * Read `<out>/candidates.json`. A missing file is a usage error; anything
 * wrong with its content, or a project root that is not `root`, is a problem
 * line. Returns `{ ok: true, items }` or `{ ok: false, problems }`.
 */
export function loadCandidates(outDir, root) {
  const read = readJson(join(outDir, CANDIDATES_FILE));
  if (read.missing) throw new UsageError(`${join(outDir, CANDIDATES_FILE)} does not exist; run the candidates command and save its output there`);
  if (!read.ok) return { ok: false, problems: [`${CANDIDATES_FILE} ${read.reason}`] };
  const file = read.value;
  if (!isObject(file) || file.format !== CANDIDATES_FORMAT) return { ok: false, problems: [`${CANDIDATES_FILE}: format must be ${CANDIDATES_FORMAT}`] };
  if (typeof file.projectRoot !== 'string') return { ok: false, problems: [`${CANDIDATES_FILE}: projectRoot must be a string`] };
  const rootProblem = projectRootProblem(file.projectRoot, root);
  if (rootProblem !== null) return { ok: false, problems: [rootProblem] };
  if (!Array.isArray(file.items)) return { ok: false, problems: [`${CANDIDATES_FILE}: items must be an array`] };
  const problems = [];
  const seen = new Set();
  file.items.forEach((entry, index) => {
    if (!isObject(entry) || typeof entry.id !== 'string' || entry.id === '' || !KINDS.includes(entry.kind)) {
      problems.push(`${CANDIDATES_FILE}: items[${index}] needs an id and a kind (${KINDS.join(', ')})`);
    } else if (seen.has(entry.id)) {
      problems.push(`${CANDIDATES_FILE}: candidate id ${entry.id} appears twice`);
    } else {
      seen.add(entry.id);
    }
  });
  return problems.length > 0 ? { ok: false, problems } : { ok: true, items: file.items };
}
