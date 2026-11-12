/**
 * check-domain-flows <out> --project <root> (openspec change handbook-free-chapter, D8): check
 * `<out>/domain-flows.json` against the entries and chapters that go into the handbook and
 * record the attempt in state.json under `domainFlows`: `{ status, attempts, reasons }`.
 * At most three attempts; after the third failure the handbook draws no flow and says so.
 * A missing file is no attempt. The caller holds the state lock.
 */

import { join } from 'node:path';

import { DOMAIN_FLOWS_FILE, domainFlowProblems } from './domain-flows-check.mjs';
import { UsageError } from './errors.mjs';
import { readJson } from './json-file.mjs';
import { loadCheckedRun } from './load-run.mjs';
import { MAX_FLOW_ATTEMPTS, loadState, saveState } from './state.mjs';

const LAST = `Next: the domain flows stay failed (${MAX_FLOW_ATTEMPTS} of ${MAX_FLOW_ATTEMPTS} attempts); the handbook draws none`;
const again = (next) => `Next: fix ${DOMAIN_FLOWS_FILE} and run check-domain-flows again (attempt ${next} of ${MAX_FLOW_ATTEMPTS})`;

/** Returns { status, lines }. */
export function checkDomainFlows(outDir, root) {
  const run = loadCheckedRun(outDir, root);
  if (!run.ok) return { status: 1, lines: run.lines };
  const loaded = loadState(outDir);
  if (!loaded.ok) {
    if (loaded.missing) throw new UsageError(loaded.problem);
    return { status: 1, lines: [loaded.problem] };
  }
  const { state } = loaded;
  const before = state.domainFlows;
  if (before?.status === 'failed' && before.attempts >= MAX_FLOW_ATTEMPTS) {
    return { status: 1, lines: [`domain flows: ${before.attempts} of ${MAX_FLOW_ATTEMPTS} attempts failed already; no further attempt is made`, LAST] };
  }
  const read = readJson(join(outDir, DOMAIN_FLOWS_FILE));
  if (read.missing) return { status: 1, lines: [`${DOMAIN_FLOWS_FILE} is missing; write it in ${outDir} and run check-domain-flows`] };
  const attempts = (before?.attempts ?? 0) + 1;
  const result = read.ok
    ? domainFlowProblems(read.value, { map: run.map, domains: run.domains, entries: run.entries, chapters: run.chapters })
    : { problems: [`${DOMAIN_FLOWS_FILE} ${read.reason}`], counts: null };
  if (result.problems.length === 0) {
    state.domainFlows = { status: 'checked', attempts, reasons: [] };
    saveState(outDir, state);
    const { domains, nodes, edges } = result.counts;
    return { status: 0, lines: [`domain flows ok: ${domains} domains, ${nodes} nodes, ${edges} edges`] };
  }
  state.domainFlows = { status: 'failed', attempts, reasons: result.problems };
  saveState(outDir, state);
  return { status: 1, lines: [...result.problems, attempts < MAX_FLOW_ATTEMPTS ? again(attempts + 1) : LAST] };
}
