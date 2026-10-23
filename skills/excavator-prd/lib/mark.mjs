/**
 * `prd.mjs mark <out> <id> dispatched | failed lane <reason>...` (openspec
 * change prd-feature-pipeline, design D4, D6): the orchestrator records each
 * lane dispatch (`attempts` + 1, status unchanged) and a lane that failed
 * without writing its files (status `failed`, step `lane`, with the reasons)
 * through this command, so the model never edits index.json by hand. Only the
 * `lane` step is recorded here: check-lane records its own result, and a
 * verification failure is computed from the files by `aggregate`. While the
 * lane's files are missing, `aggregate` keeps the recorded lane failure; once
 * they exist, it recomputes the status from them. A third dispatch is
 * refused: a lane gets at most two.
 */

import { join, resolve } from 'node:path';

import { UsageError } from './errors.mjs';
import { INDEX_FILE, MAX_ATTEMPTS, loadIndex, schemaProblems } from './index-check.mjs';
import { writeJson } from './json-file.mjs';
import { projectRootProblem } from './project-root.mjs';

const EVENTS = ['dispatched', 'failed'];
/** The one step `mark ... failed` records. */
const MARKED_STEP = 'lane';

/** Run mark on `<out>`. Returns { status, lines }; a wrong id, event, step or reason throws UsageError. */
export function mark(outDirArg, id, event, rest, root) {
  if (!EVENTS.includes(event)) throw new UsageError(`unknown event ${event ?? '(none)'}; use ${EVENTS.join(' or ')}`);
  if (event === 'dispatched' && rest.length > 0) throw new UsageError('mark <out> <id> dispatched takes no further argument');
  const [step, ...reasons] = event === 'failed' ? rest : [];
  if (event === 'failed') {
    if (step !== MARKED_STEP) {
      throw new UsageError(`mark records only the ${MARKED_STEP} step, not ${step ?? '(none)'}; check-lane records its own result and aggregate computes the verify step`);
    }
    if (reasons.length === 0 || reasons.some((reason) => reason.trim() === '')) throw new UsageError('mark ... failed lane needs one or more non-empty reasons');
  }

  const outDir = resolve(outDirArg);
  const read = loadIndex(outDir);
  if (!read.ok) return { status: 1, lines: [`index: ${INDEX_FILE} ${read.reason}`] };
  const schema = schemaProblems(read.value);
  if (schema.length > 0) return { status: 1, lines: schema };
  const index = read.value;
  const rootProblem = projectRootProblem(index, root);
  if (rootProblem !== null) return { status: 1, lines: [rootProblem] };
  const at = index.features.findIndex((feature) => feature.id === id);
  if (at < 0) throw new UsageError(`no feature ${id} in ${INDEX_FILE}`);

  const feature = index.features[at];
  if (event === 'dispatched' && (feature.attempts ?? 0) >= MAX_ATTEMPTS) {
    return { status: 1, lines: [`${id}: attempts is already ${MAX_ATTEMPTS}, the most a lane gets`] };
  }
  const updated = event === 'dispatched'
    ? { ...feature, attempts: (feature.attempts ?? 0) + 1 }
    : { ...feature, status: 'failed', failure: { step, reasons: reasons.map((reason) => reason.trim()) } };
  const features = index.features.map((f, i) => (i === at ? updated : f));
  writeJson(join(outDir, INDEX_FILE), { ...index, features });
  return {
    status: 0,
    lines: [event === 'dispatched' ? `${id}: attempts ${updated.attempts}` : `${id}: failed at ${step}: ${updated.failure.reasons.join('; ')}`],
  };
}
