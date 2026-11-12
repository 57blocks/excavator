/**
 * `handbook.mjs remedy-facts <out> --project <root>` (openspec change
 * handbook-remedies, design D2): print the facts a remedies lane may cite, one
 * line a fact, tab-separated, the first field the id a paragraph cites
 * (remedies-facts.mjs holds the line formats), computed from the checked run as
 * it is now. When there is nothing for a lane to do it prints one line that
 * starts with `Remedies:` and no fact: no verified finding, remedies that are
 * current, ones waiting for their judges, or ones that failed twice. Changes no
 * file.
 */

import { factLine } from './remedies-facts.mjs';
import { loadRemediesContext } from './remedies-context.mjs';
import { MAX_ATTEMPTS } from './state.mjs';

const note = (text) => ({ status: 0, lines: [`Remedies: ${text}`] });

/** Run remedy-facts. Returns { status, lines }. */
export function remedyFacts(outDir, root) {
  const context = loadRemediesContext(outDir, root);
  if (context.stop) return context.stop;
  const { run, facts, entry, hasGroups } = context;
  if (!hasGroups) return note('no verified findings; nothing to write');
  const current = entry.factsDigest === facts.digest;
  if (run.remedies.doc !== null && current) return note(`${run.remedies.status}; nothing to write`);
  if (entry.status === 'failed' && entry.attempts >= MAX_ATTEMPTS && current) return note(`failed (${MAX_ATTEMPTS} of ${MAX_ATTEMPTS} attempts); the remedies are not written`);
  return { status: 0, lines: facts.rows.map(factLine) };
}
