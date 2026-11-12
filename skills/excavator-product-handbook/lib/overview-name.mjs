/**
 * The checks of the overview's `name` (openspec change handbook-system-name)
 * against the name candidates of the project (name-candidates.mjs): its text is
 * the value of a candidate, written as the code writes it; it has one passage,
 * and that passage is in the candidate's file and covers the candidate's line.
 * A candidate that still refers to a variable (`resolved: false`) is not a name.
 * A null name needs at least one `unknowns` item, which says what was looked at
 * (its wording is not checked). The citation itself (the file is project source,
 * the passage occurs once, no documentation file) and the text occurring in the
 * passage are the ordinary item checks; this adds what only a candidate can say.
 * A key that is absent is no name to check (an overview verified before the
 * key existed, or one whose name verification removed).
 */

import { locatePassage } from './locate.mjs';
import { normalize } from './normalize.mjs';
import { nameCandidates } from './name-candidates.mjs';

const quote = JSON.stringify;
const LISTED = 8;

/** The candidates that hold `text` as their value, and the problems the text itself gives. */
function textProblems(text, candidates) {
  const same = candidates.filter((candidate) => candidate.value === text);
  if (same.length === 0) {
    const values = [...new Set(candidates.filter((candidate) => candidate.resolved).map((candidate) => candidate.value))];
    const shown = values.slice(0, LISTED).map(quote).join(', ');
    const rest = values.length > LISTED ? `, and ${values.length - LISTED} more` : '';
    return { same, problems: [`name.text: ${quote(text)} is not the value of any name candidate (run names for the list; candidates: ${shown === '' ? 'none' : `${shown}${rest}`})`] };
  }
  if (!same.some((candidate) => candidate.resolved)) {
    return { same, problems: [`name.text: ${quote(text)} is a reference to a variable, not a name; choose a candidate that is marked resolved`] };
  }
  return { same: same.filter((candidate) => candidate.resolved), problems: [] };
}

/** The problems of the passage of a name whose text is the value of the candidates `same`. */
function evidenceProblems(evidence, same, files) {
  if (evidence.length !== 1) return [`name.evidence: must be one passage, the line of the candidate (found ${evidence.length})`];
  const [{ file, passage }] = evidence;
  const places = same.map((candidate) => `${candidate.file}:${candidate.line}`);
  const where = `the value is written at ${places.join(', ')}`;
  const here = same.filter((candidate) => candidate.file === file);
  if (here.length === 0) return [`name.evidence[0]: ${file} is not the file of a candidate with this value; cite the line of the candidate (${where})`];
  const resolved = files.resolve(file);
  if (!resolved.ok) return [];
  const located = locatePassage(resolved.text, passage);
  // A passage that is not in the file, or in it more than once, is the ordinary citation check's to report.
  if (located === null) return [];
  const covers = here.some((candidate) => candidate.line >= located.startLine && candidate.line <= located.endLine);
  if (!covers) return [`name.evidence[0]: the passage covers ${file} lines ${located.startLine} to ${located.endLine}, not the line of the candidate (${where})`];
  const needle = normalize(same[0].value).text;
  return normalize(passage).text.includes(needle) ? [] : [`name.evidence[0]: the passage does not hold the value ${quote(same[0].value)}`];
}

/** The problems of `doc.name` and the unknowns that explain a null one; `scan` is the project scan (applications.mjs), `files` the project file reader. */
export function nameProblems(doc, scan, files) {
  if (!Object.hasOwn(doc, 'name')) return [];
  if (doc.name === null) {
    return doc.unknowns.length > 0 ? [] : ['name: is null and unknowns lists nothing; say in unknowns which name candidates you looked at (run names)'];
  }
  const { same, problems } = textProblems(doc.name.text, nameCandidates(scan).candidates);
  if (problems.length > 0) return problems;
  return evidenceProblems(doc.name.evidence, same, files);
}
