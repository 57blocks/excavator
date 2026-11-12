/**
 * `handbook.mjs check-remedies <out> --project <root>` (openspec change
 * handbook-remedies, design D3): check `<out>/entries/remedies.json`, which the
 * remedies lane wrote from the facts `remedy-facts` prints. Every problem is
 * printed, one line each:
 *
 * - the shape (remedies-shape.mjs); a category that is not in the enumeration, that
 *   has no verified group, or that has two paragraphs;
 * - the cites: 1 to 10 recommendations; each paragraph cites at least one id and
 *   every id is a fact of `remedy-facts` now; a category paragraph cites only
 *   the groups of its own category;
 * - the text (cause, measure, title, text): the checks of reader text (no code-shaped
 *   word, no file name, the run's language), but not the advice words, which this
 *   section alone may use; and every number in it occurs in the facts it cites
 *   (a level name such as P0 is no number).
 *
 * On success the unit is recorded as `checked` with the digest of the file and of the facts;
 * otherwise as `failed` with every problem, and the last line is a `Next:` line.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readJson } from './json-file.mjs';
import { readerTextProblems } from './priority-context.mjs';
import { loadRemediesContext } from './remedies-context.mjs';
import { MAX_RECOMMENDATIONS, REMEDIES_FILE, REMEDIES_ID, remediesShapeProblems } from './remedies-shape.mjs';
import { MAX_ATTEMPTS, entryDigest, loadState, saveState } from './state.mjs';
import { setUnitState } from './unit.mjs';
import { UsageError } from './errors.mjs';
import { missingNumbers } from './values.mjs';

/** A level name is not a number of the text: `P0` is stripped before the digits are read. */
const withoutLevels = (text) => text.replace(/\bP[0-2]\b/g, ' ');

/** The facts' text a paragraph cites, as passages for the number check: every field of each cited fact but its id. */
const passagesOf = (cites, facts) => cites.filter((id) => facts.byId.has(id)).map((id) => withoutLevels(facts.byId.get(id).fields.join(' ')));

/** The problems of the cites of one paragraph (`path` is where the list is); `own` is the category a category paragraph belongs to, else null. */
function citeProblems(cites, path, facts, own) {
  const problems = [];
  cites.forEach((id, index) => {
    const row = facts.byId.get(id);
    const where = `${path}[${index}]`;
    if (row === undefined) problems.push(`${where}: ${JSON.stringify(id)} is not a fact of remedy-facts`);
    else if (own !== null && (row.kind !== 'group' || row.category !== own)) {
      problems.push(`${where}: ${JSON.stringify(id)} is not a group of the category ${own}; a paragraph of a category cites only the groups of that category`);
    }
  });
  if (cites.length === 0) problems.push(`${path}: must cite at least one fact`);
  return problems;
}

/** The problems of the whole file against the facts and the run: `[line]`. */
export function remediesProblems(doc, facts, run) {
  const shape = remediesShapeProblems(doc);
  if (shape.length > 0) return shape;
  const problems = [];
  const withGroups = new Set(facts.rows.filter((row) => row.kind === 'group').map((row) => row.category));
  const seen = new Set();
  const texts = [];
  const numbered = (text, path, cites) => {
    for (const number of missingNumbers(withoutLevels(text), passagesOf(cites, facts))) problems.push(`${path}: number ${number} does not occur in the facts it cites`);
  };
  doc.categories.forEach((entry, index) => {
    const path = `categories[${index}]`;
    if (!withGroups.has(entry.category)) problems.push(`${path}.category: ${JSON.stringify(entry.category)} has no verified group; write only the categories that have one`);
    if (seen.has(entry.category)) problems.push(`${path}.category: ${JSON.stringify(entry.category)} has more than one paragraph`);
    seen.add(entry.category);
    problems.push(...citeProblems(entry.cites, `${path}.cites`, facts, entry.category));
    if (/[\r\n]/.test(entry.cause.trim())) problems.push(`${path}.cause: must be one line`);
    texts.push({ path: `${path}.cause`, text: entry.cause.trim() }, { path: `${path}.measure`, text: entry.measure.trim() });
    numbered(entry.cause, `${path}.cause`, entry.cites);
    numbered(entry.measure, `${path}.measure`, entry.cites);
  });
  if (doc.recommendations.length < 1) problems.push('recommendations: must have at least 1 item');
  if (doc.recommendations.length > MAX_RECOMMENDATIONS) problems.push(`recommendations: must have at most ${MAX_RECOMMENDATIONS} items, found ${doc.recommendations.length}`);
  doc.recommendations.forEach((entry, index) => {
    const path = `recommendations[${index}]`;
    problems.push(...citeProblems(entry.cites, `${path}.cites`, facts, null));
    if (/[\r\n]/.test(entry.title.trim())) problems.push(`${path}.title: must be one line`);
    texts.push({ path: `${path}.title`, text: entry.title.trim() }, { path: `${path}.text`, text: entry.text.trim() });
    numbered(entry.title, `${path}.title`, entry.cites);
    numbered(entry.text, `${path}.text`, entry.cites);
  });
  // The advice words are allowed here, and only here.
  problems.push(...readerTextProblems(texts, run, { advice: false }));
  return problems;
}

/** Run check-remedies. Returns { status, lines }. */
export function checkRemedies(outDirArg, root) {
  const context = loadRemediesContext(outDirArg, root);
  if (context.stop) return context.stop;
  const { run, outDir, facts, entry } = context;
  if (!context.hasGroups) return { status: 0, lines: ['Remedies: no verified findings; nothing to check'] };
  // Remedies that two judges settled for these facts and whose file is unchanged are not checked again: that would drop what the judges recorded.
  if (run.remedies.doc !== null && entry.factsDigest === facts.digest) return { status: 0, lines: [`${REMEDIES_ID}: ${run.remedies.status}, unchanged since it was ${run.remedies.status}`] };
  const stateRead = loadState(outDir);
  if (!stateRead.ok) {
    if (stateRead.missing) throw new UsageError(stateRead.problem);
    return { status: 1, lines: [stateRead.problem] };
  }
  const { state } = stateRead;
  // Other facts than the ones the entry was made for start the unit over: its attempts and what the judges dropped do not carry.
  const attempts = entry.factsDigest !== facts.digest ? 0 : entry.attempts;

  const path = join(outDir, REMEDIES_FILE);
  let problems;
  if (!existsSync(path)) problems = [`lane-wrote-nothing: ${REMEDIES_FILE} is missing`];
  else {
    const read = readJson(path);
    problems = read.ok ? remediesProblems(read.value, facts, run) : [`${REMEDIES_FILE} ${read.reason}`];
  }
  if (problems.length > 0) {
    setUnitState(state, REMEDIES_ID, { status: 'failed', attempts, factsDigest: facts.digest, failure: { step: 'check-entry', reasons: problems } });
    saveState(outDir, state);
    const next = attempts < MAX_ATTEMPTS
      ? `Next: delete ${REMEDIES_FILE}, mark remedies dispatched and re-dispatch the remedies lane once with the lines above (attempt 2 of 2)`
      : `Next: ${REMEDIES_ID} stays failed (${MAX_ATTEMPTS} of ${MAX_ATTEMPTS} attempts)`;
    return { status: 1, lines: [...problems, next] };
  }
  setUnitState(state, REMEDIES_ID, { status: 'checked', attempts, factsDigest: facts.digest, entryDigest: entryDigest(path) });
  saveState(outDir, state);
  const doc = readJson(path).value;
  return { status: 0, lines: [`${REMEDIES_ID}: checked (${doc.categories.length} categories, ${doc.recommendations.length} recommendations)`] };
}
