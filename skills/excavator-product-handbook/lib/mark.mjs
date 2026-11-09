/**
 * `handbook.mjs mark <out> <id> dispatched | failed lane <reason>...`
 * (design D9; `<id>` is a feature id, `overview`, `<featureId>.findings`, `app<n>.system`, `priority`, `remedies` or `topics:<lane>`): the orchestrator records a lane dispatch (status dispatched,
 * attempts + 1) and a lane that wrote nothing (status failed, step lane)
 * through this command, so the model never edits state.json by hand.
 * check-entry records its own result. A third dispatch is refused, and so is
 * dispatching a feature that is already checked, confirmed or verified.
 */

import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { UsageError } from './errors.mjs';
import { loadPriorityContext } from './priority-context.mjs';
import { PRIORITY_DIR } from './priority-shape.mjs';
import { loadRemediesContext } from './remedies-context.mjs';
import { REMEDIES_DIR, REMEDIES_FILE, REMEDIES_ID } from './remedies-shape.mjs';
import { loadTopicsContext, requireLane } from './topics-context.mjs';
import { judgeFilePath, judgeVerdictPath, JUDGES, laneOfUnitId, laneUnitId, partFilePath } from './topics-shape.mjs';
import { MAX_ATTEMPTS, loadState, saveState } from './state.mjs';
import { bindSystemRoot } from './system-unit.mjs';
import { isPriority, isRemedies, isSystemId, isTopics, setUnitState, unitState } from './unit.mjs';

/**
 * A dispatch of the priority unit (openspec change handbook-findings-priority): a ranking is made for the groups of
 * the findings as they are now, so a unit recorded for other groups (or never for any) starts over with no attempt
 * and loses its part, judge and verdict files; for the same groups it counts one more attempt as any unit does.
 */
function dispatchPriority(outDir, state, current, root) {
  const context = loadPriorityContext(outDir, root);
  if (context.stop) return context.stop;
  if (context.groups.length === 0) return { status: 0, lines: ['Priority: no verified findings; nothing to dispatch'] };
  const fresh = current.groupsDigest !== context.digest;
  if (!fresh && ['checked', 'verified'].includes(current.status)) return { status: 1, lines: [`priority: already ${current.status} for these groups; it is not ranked again`] };
  const attempts = fresh ? 0 : current.attempts;
  if (attempts >= MAX_ATTEMPTS) return { status: 1, lines: [`priority: attempts is already ${MAX_ATTEMPTS}, the most a lane gets`] };
  if (fresh) rmSync(join(context.outDir, PRIORITY_DIR), { recursive: true, force: true });
  setUnitState(state, 'priority', { status: 'dispatched', attempts: attempts + 1, groupsDigest: context.digest });
  saveState(outDir, state);
  return { status: 0, lines: [`priority: dispatched, attempts ${attempts + 1}`] };
}

/**
 * A dispatch of the remedies unit (openspec change handbook-remedies): the lane writes for the facts as they are now, so a unit
 * recorded for other facts (or never for any) starts over with no attempt and loses its file, judge and verdict files; for the
 * same facts it counts one more attempt as any unit does.
 */
function dispatchRemedies(outDir, state, current, root) {
  const context = loadRemediesContext(outDir, root);
  if (context.stop) return context.stop;
  if (!context.hasGroups) return { status: 0, lines: ['Remedies: no verified findings; nothing to dispatch'] };
  const digest = context.facts.digest;
  const fresh = current.factsDigest !== digest;
  if (!fresh && ['checked', 'verified'].includes(current.status)) return { status: 1, lines: [`remedies: already ${current.status} for these facts; it is not written again`] };
  const attempts = fresh ? 0 : current.attempts;
  if (attempts >= MAX_ATTEMPTS) return { status: 1, lines: [`remedies: attempts is already ${MAX_ATTEMPTS}, the most a lane gets`] };
  if (fresh) {
    rmSync(join(context.outDir, REMEDIES_DIR), { recursive: true, force: true });
    rmSync(join(context.outDir, REMEDIES_FILE), { force: true });
  }
  setUnitState(state, REMEDIES_ID, { status: 'dispatched', attempts: attempts + 1, factsDigest: digest });
  saveState(outDir, state);
  return { status: 0, lines: [`remedies: dispatched, attempts ${attempts + 1}`] };
}

/**
 * A dispatch of a topics lane (openspec change handbook-topics): the lane writes for the facts it is given now, so a lane recorded
 * for other facts (or never for any) starts over with no attempt and loses its part, judge and verdict files; for the same facts it
 * counts one more attempt as any unit does. A lane that is not listed by `topic-lanes` is a usage error.
 */
function dispatchTopics(outDir, state, current, root, id) {
  const context = loadTopicsContext(outDir, root);
  if (context.stop) return context.stop;
  const laneId = laneOfUnitId(id);
  if (!context.hasLanes) return { status: 0, lines: ['Topics: no verified entry and no verified finding; nothing to dispatch'] };
  const lane = requireLane(context, laneId);
  const fresh = current.factsDigest !== lane.digest;
  if (!fresh && ['checked', 'verified'].includes(current.status)) return { status: 1, lines: [`${id}: already ${current.status} for these facts; it is not written again`] };
  const attempts = fresh ? 0 : current.attempts;
  if (attempts >= MAX_ATTEMPTS) return { status: 1, lines: [`${id}: attempts is already ${MAX_ATTEMPTS}, the most a lane gets`] };
  if (fresh) {
    rmSync(partFilePath(context.outDir, laneId), { force: true });
    rmSync(judgeFilePath(context.outDir, laneId), { force: true });
    for (const letter of JUDGES) rmSync(judgeVerdictPath(context.outDir, laneId, letter), { force: true });
  }
  setUnitState(state, laneUnitId(laneId), { status: 'dispatched', attempts: attempts + 1, factsDigest: lane.digest });
  saveState(outDir, state);
  return { status: 0, lines: [`${id}: dispatched, attempts ${attempts + 1}`] };
}

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
    if (isPriority(id)) return dispatchPriority(outDir, state, current, root);
    if (isRemedies(id)) return dispatchRemedies(outDir, state, current, root);
    if (isTopics(id)) return dispatchTopics(outDir, state, current, root, id);
    if (['checked', 'confirmed', 'verified'].includes(current.status)) return { status: 1, lines: [`${id}: already ${current.status}; it is not written again`] };
    if (current.attempts >= MAX_ATTEMPTS) return { status: 1, lines: [`${id}: attempts is already ${MAX_ATTEMPTS}, the most a lane gets`] };
    setUnitState(state, id, { status: 'dispatched', attempts: current.attempts + 1 });
    saveState(outDir, state);
    return { status: 0, lines: [`${id}: dispatched, attempts ${current.attempts + 1}`] };
  }
  const failure = { step, reasons: reasons.map((reason) => reason.trim()) };
  // The ranking keeps the digest of its groups (the remedies that of their facts) through a failure, so the next dispatch for the same input counts as the next attempt.
  const kept = isPriority(id) && current.groupsDigest !== undefined ? { groupsDigest: current.groupsDigest } : (isRemedies(id) || isTopics(id)) && current.factsDigest !== undefined ? { factsDigest: current.factsDigest } : {};
  setUnitState(state, id, { status: 'failed', attempts: current.attempts, failure, ...kept });
  saveState(outDir, state);
  return { status: 0, lines: [`${id}: failed at ${step}: ${failure.reasons.join('; ')}`] };
}
