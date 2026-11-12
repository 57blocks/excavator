/**
 * Statement IDs cited outside the skopository (the run's questions and notes, the report's
 * summary) checked against the statements the skopository defines. The parser is the vendored
 * checker's; this module only looks the citations up.
 */
import { KINDS, lockedStatements, refsIn } from '../checker/spec.mjs';

/** A placeholder ID such as `R-@fresh-wasm`, which assign-ids replaces with a real one. */
export const PLACEHOLDER = new RegExp(`[${KINDS}]-@[a-z0-9][a-z0-9-]*`, 'g');

/** Map from each statement key the skopository defines to its kind letter. */
export function statementKinds(skopoDir) {
  return new Map(lockedStatements(skopoDir).map((statement) => [statement.key, statement.kind]));
}

/** Problems with the citations on one line, each prefixed with `where`. */
export function lineCitationProblems(line, kinds, where) {
  return [
    ...refsIn(line)
      .filter((ref) => kinds.get(ref.key) !== ref.kind)
      .map((ref) => (kinds.has(ref.key)
        ? `${where}  ${ref.id} is ${kinds.get(ref.key)}-${ref.key} in the skopository`
        : `${where}  ${ref.id} is cited but not defined in the skopository`)),
    ...[...line.matchAll(PLACEHOLDER)].map((m) => `${where}  ${m[0]} is still a placeholder`),
  ];
}

/** Problems with every citation in `text`, located as `<label>:<line>`. */
export function citationProblems(text, kinds, label) {
  return text.split('\n').flatMap((line, i) => lineCitationProblems(line, kinds, `${label}:${i + 1}`));
}
