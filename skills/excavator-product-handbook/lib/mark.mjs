/**
 * `handbook.mjs mark <out> <id> dispatched | failed lane <reason>...`
 * (design D9; `<id>` is a feature id, `overview`, `<featureId>.findings` or `app<n>.system`): the orchestrator records a lane dispatch (status dispatched,
 * attempts + 1) and a lane that wrote nothing (status failed, step lane)
 * through this command, so the model never edits state.json by hand.
 * check-entry records its own result. A third dispatch is refused, and so is
 * dispatching a feature that is already checked, confirmed or verified.
 */

import { UsageError } from './errors.mjs';
import { MAX_ATTEMPTS, loadState, saveState } from './state.mjs';
import { bindSystemRoot } from './system-unit.mjs';
import { isSystemId, setUnitState, unitState } from './unit.mjs';

const EVENTS = ['dispatched', 'failed'];
/** The one step `mark ... failed` records. */
const MARKED_STEP = 'lane';

/** Run mark on `<out>`. Returns { status, lines }; a wrong event, step or reason throws UsageError. */
export function mark(outDir, id, event, rest, root) {
  if (!EVENTS.includes(event)) throw new UsageError(`unknown event ${event ?? '(none)'}; use ${EVENTS.join(' or ')}`);
  if (event === 'dispatched' && rest.length > 0) throw new UsageError('mark <out> <id> dispatched takes no further argument');
  const [step, ...reasons] = event === 'failed' ? rest : [];
  if (event === 'failed') {
    if (step !== MARKED_STEP) throw new UsageError(`mark records only the ${MARKED_STEP} step, not ${step ?? '(none)'}; check-entry records its own result`);
    if (reasons.length === 0 || reasons.some((reason) => reason.trim() === '')) throw new UsageError('mark ... failed lane needs one or more non-empty reasons');
  }
  const loaded = loadState(outDir);
  if (!loaded.ok) {
    if (loaded.missing) throw new UsageError(loaded.problem);
    return { status: 1, lines: [loaded.problem] };
  }
  const { state } = loaded;
  // A system unit is recorded with the application root it belongs to, and refused when the source moved it.
  if (isSystemId(id)) {
    const problem = bindSystemRoot(state, id, root);
    if (problem !== null) return { status: 1, lines: [problem] };
  }
  const current = unitState(state, id);
  if (event === 'dispatched') {
    if (['checked', 'confirmed', 'verified'].includes(current.status)) return { status: 1, lines: [`${id}: already ${current.status}; it is not written again`] };
    if (current.attempts >= MAX_ATTEMPTS) return { status: 1, lines: [`${id}: attempts is already ${MAX_ATTEMPTS}, the most a lane gets`] };
    setUnitState(state, id, { status: 'dispatched', attempts: current.attempts + 1 });
    saveState(outDir, state);
    return { status: 0, lines: [`${id}: dispatched, attempts ${current.attempts + 1}`] };
  }
  const failure = { step, reasons: reasons.map((reason) => reason.trim()) };
  setUnitState(state, id, { status: 'failed', attempts: current.attempts, failure });
  saveState(outDir, state);
  return { status: 0, lines: [`${id}: failed at ${step}: ${failure.reasons.join('; ')}`] };
}
