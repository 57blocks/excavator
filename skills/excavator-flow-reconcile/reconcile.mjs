import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraphHeader } from '../excavator/knowledge-graph-store.mjs';
import { PIPELINE_VERSION } from '../excavator/lazy-analyze.mjs';
import { assertDataFile, assertDataTree, assertSourcePath, bindProjectRoot, canonicalSourcePath, scopePredicate } from '../excavator/project-paths.mjs';
import { resolveSourceSnapshot } from '../excavator/source-snapshot.mjs';
import { planBatches } from './batch-plan.mjs';

const FORMAT = 'excavator-flow-reconciliation/1';
const MANIFEST = 'source-manifest.json';
const text = z.string().trim().min(1);
const sourcePath = z.string().min(1);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const evidence = z.strictObject({
  path: sourcePath,
  line: z.int().positive(),
  quote: z.string().refine((value) => value.trim() !== '' && !/[\r\n]/.test(value)),
});
const basis = z.strictObject({
  sourceRevision: text, factsDigest: digest, manifestDigest: digest, scope: sourcePath, previousDigest: digest.nullable(),
});
const gap = z.strictObject({ path: sourcePath, reason: text });
const flowRemoval = z.strictObject({ id: text, reason: text });
const candidateSchema = z.strictObject({
  basis,
  reviewedPaths: z.array(sourcePath),
  flows: z.array(z.strictObject({
    id: text,
    title: text,
    entry: evidence,
    claims: z.array(z.strictObject({
      kind: z.enum(['field', 'step', 'ui-validation', 'backend-rule', 'branch', 'state-change', 'side-effect']),
      text,
      evidence: z.array(evidence).min(1),
    })).min(1),
  })),
  gaps: z.array(gap),
  removed: z.array(flowRemoval),
});
const revision = z.discriminatedUnion('kind', [
  flowRemoval.extend({ kind: z.literal('flow') }),
  z.strictObject({ kind: z.literal('gap'), path: sourcePath, previousReason: text, reason: text }),
]);
const batchCandidateSchema = candidateSchema.extend({
  run: digest,
  batch: z.string().regex(/^[1-9]\d*$/),
  checkpointDigest: digest.nullable(),
  deferred: z.array(gap),
  revisions: z.array(revision).optional(),
});
const relocationsSchema = z.strictObject({
  run: digest,
  moves: z.array(z.strictObject({ fromId: text, toId: text })),
});

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hostId = hash(hostname()).slice(0, 16);

function readOptional(path) {
  try {
    return readFileSync(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

function readFacts(root, snapshot) {
  const manifestBytes = readFileSync(assertDataFile(root, MANIFEST));
  const manifest = JSON.parse(manifestBytes);
  const header = readKnowledgeGraphHeader(assertDataFile(root, KNOWLEDGE_GRAPH_FILE));
  const project = header.fields.project;
  if (snapshot.selectionDigest !== manifest.selectionDigest) {
    throw new Error('Reuse the same --exclude selection as the Lazy build or rebuild with the intended selection.');
  }
  if (snapshot.revision !== manifest.sourceRevision || project.sourceRevision !== manifest.sourceRevision
    || project.selectionDigest !== manifest.selectionDigest || !project.factsDigest || project.factsDigest !== manifest.factsDigest
    || project.pipelineVersion !== PIPELINE_VERSION || manifest.pipelineVersion !== PIPELINE_VERSION) {
    throw new Error('Refresh the Lazy fact graph for this source snapshot.');
  }
  return {
    factsDigest: project.factsDigest,
    manifestDigest: hash(manifestBytes),
    entries: new Map(manifest.entries.map((entry) => [entry.path, entry.contentHash])),
    selected: (manifest.selection?.entries ?? []).filter((entry) => entry.kind === 'selected').map((entry) => entry.path),
  };
}

function readBaseline(root, scope, snapshot) {
  scope = scope === '.' ? scope : canonicalSourcePath(scope.replace(/\/+$/, ''));
  const { entries, selected, factsDigest, manifestDigest } = readFacts(root, snapshot);
  const matchesScope = scope === '.' ? () => true : scopePredicate(scope);
  const files = [...new Set([...entries.keys(), ...selected])].filter(matchesScope).sort();
  if (files.length === 0) throw new Error('The scope selects no files in the Lazy source manifest.');
  const unavailablePaths = files.filter((file) => !entries.has(file));
  const path = assertDataFile(root, `flow-reconciliation-${hash(scope).slice(0, 24)}.json`);
  const previousBytes = readOptional(path);
  const previous = previousBytes === null ? null : JSON.parse(previousBytes);
  if (previous && (previous.format !== FORMAT || previous.basis?.scope !== scope || !Array.isArray(previous.flows))) {
    throw new Error('The existing flow reconciliation has an invalid format or scope.');
  }
  return {
    path, previous, entries, files, unavailablePaths,
    basis: {
      sourceRevision: snapshot.revision,
      factsDigest,
      manifestDigest,
      scope,
      previousDigest: previousBytes === null ? null : hash(previousBytes),
    },
  };
}

export function prepareReconciliation(projectRoot, scope = '.', selection = {}) {
  const root = bindProjectRoot(projectRoot);
  const snapshot = resolveSourceSnapshot(root, selection);
  const baseline = readBaseline(root, scope, snapshot);
  return {
    basis: baseline.basis,
    files: baseline.files.filter((file) => baseline.entries.has(file)),
    unavailablePaths: baseline.unavailablePaths,
    previous: baseline.previous,
  };
}

function unique(values, label) {
  const result = new Set(values);
  if (result.size !== values.length) throw new Error(`Duplicate ${label}.`);
  return result;
}

function sourceLines(root, snapshot, entries, path) {
  if (!entries.has(path)) throw new Error(`Evidence path is outside the Lazy source manifest: ${path}`);
  assertSourcePath(root, path, snapshot);
  const bytes = snapshot.readFile(path);
  if (hash(bytes) !== entries.get(path)) throw new Error(`Evidence source has changed: ${path}`);
  return bytes.toString('utf8').split(/\r?\n/);
}

function verifyEvidence(root, snapshot, entries) {
  const linesByPath = new Map();
  return ({ path, line, quote }) => {
    if (!linesByPath.has(path)) linesByPath.set(path, sourceLines(root, snapshot, entries, path));
    if (!linesByPath.get(path)[line - 1]?.includes(quote)) throw new Error(`Evidence quote does not match ${path}:${line}`);
  };
}

function readSource(projectRoot, file, firstArg = '1', lastArg, selection) {
  const root = bindProjectRoot(projectRoot);
  const snapshot = resolveSourceSnapshot(root, selection);
  const { entries } = readFacts(root, snapshot);
  const first = Number(firstArg);
  const last = lastArg === undefined ? first + 119 : Number(lastArg);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last - first >= 200) {
    throw new Error('Provide a valid source line range of at most 200 lines.');
  }
  const lines = sourceLines(root, snapshot, entries, file);
  return lines.slice(first - 1, last).map((line, index) => ({ line: first + index, text: line }));
}

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function claimPublication(path) {
  const directory = dirname(path);
  const prefix = `${basename(path)}.lock-`;
  const claim = `${prefix}${hostId}-${process.pid}-${randomUUID()}`;
  const claimPath = join(directory, claim);
  // Announce before checking. A later entrant sees an ongoing publisher.
  // Simultaneous entrants can both back off. Dead owners have unique names.
  writeFileSync(claimPath, '', { flag: 'wx' });
  try {
    for (const name of readdirSync(directory)) {
      if (name === claim || !name.startsWith(prefix)) continue;
      const owner = /^([a-f0-9]{16})-([1-9]\d*)-([a-f0-9-]{36})$/.exec(name.slice(prefix.length));
      if (!owner) continue;
      const pid = Number(owner[2]);
      if (owner[1] !== hostId || !Number.isSafeInteger(pid) || pidIsAlive(pid)) {
        throw new Error('Another flow reconciliation is publishing to this scope. Retry after it finishes.');
      }
      rmSync(join(directory, name), { force: true });
    }
    return claimPath;
  } catch (error) {
    rmSync(claimPath, { force: true });
    throw error;
  }
}

function assertBasis(current, offered) {
  for (const key of Object.keys(current)) {
    if (current[key] !== offered[key]) {
      throw new Error(`Reconciliation baseline changed (${key}). Prepare again before publishing.`);
    }
  }
}

function validateCandidate(candidate, files, entries, oldFlows, verify) {
  const reviewed = unique(candidate.reviewedPaths, 'reviewed paths');
  const scope = new Set(files);
  for (const path of reviewed) {
    if (!scope.has(path) || !entries.has(path)) throw new Error(`Reviewed path is unavailable or outside the scope: ${path}`);
  }
  for (const { path } of candidate.gaps) {
    canonicalSourcePath(path);
    if (!entries.has(path)) throw new Error(`Gap path is outside the source manifest: ${path}`);
  }
  const flowIds = unique(candidate.flows.map((flow) => flow.id), 'flow ids');
  const oldIds = new Set(oldFlows.map((flow) => flow.id));
  const removed = unique(candidate.removed.map((flow) => flow.id), 'removed flow ids');
  for (const id of removed) {
    if (!oldIds.has(id) || flowIds.has(id)) throw new Error(`Invalid removed flow id: ${id}`);
  }
  for (const id of oldIds) {
    if (!flowIds.has(id) && !removed.has(id)) throw new Error(`Missing disposition for previous flow: ${id}`);
  }
  for (const flow of candidate.flows) {
    if (!reviewed.has(flow.entry.path)) throw new Error(`Flow entry is outside the reviewed scope: ${flow.entry.path}`);
    verify(flow.entry);
    for (const claim of flow.claims) for (const item of claim.evidence) verify(item);
  }
  return reviewed;
}

function atomicWrite(path, result, check) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    check();
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function publishInventory(root, snapshot, selection, current, candidate, batchRun) {
  const reviewed = validateCandidate(candidate, current.files, current.entries, current.previous?.flows ?? [],
    verifyEvidence(root, snapshot, current.entries));
  const { flows, gaps, removed } = candidate;
  const result = {
    format: FORMAT,
    basis: current.basis,
    reviewedPaths: [...reviewed].sort(),
    uncheckedPaths: current.files.filter((path) => current.entries.has(path) && !reviewed.has(path)),
    unavailablePaths: current.unavailablePaths,
    flows, gaps, removed,
    ...(batchRun && { batchRun }),
  };
  atomicWrite(current.path, result, () => {
    const latest = readBaseline(root, current.basis.scope, resolveSourceSnapshot(root, selection));
    assertBasis(latest.basis, current.basis);
  });
  return {
    path: current.path, flows: flows.length, reviewed: reviewed.size, unchecked: result.uncheckedPaths.length,
    unavailable: result.unavailablePaths.length, gaps: gaps.length, removed: removed.length,
  };
}

export function publishReconciliation(projectRoot, input, selection = {}) {
  const root = bindProjectRoot(projectRoot);
  const candidate = candidateSchema.parse(input);
  const snapshot = resolveSourceSnapshot(root, selection);
  const before = readBaseline(root, candidate.basis.scope, snapshot);
  const lock = claimPublication(before.path);
  try {
    const current = readBaseline(root, candidate.basis.scope, snapshot);
    assertBasis(current.basis, candidate.basis);
    return publishInventory(root, snapshot, selection, current, candidate);
  } finally {
    rmSync(lock, { force: true });
  }
}

function getRun(root, selection) {
  const snapshot = resolveSourceSnapshot(root, selection);
  const baseline = readBaseline(root, '.', snapshot);
  const batches = planBatches(baseline.files);
  const planDigest = hash(JSON.stringify(batches));
  const run = hash(JSON.stringify({ basis: baseline.basis, planDigest }));
  const refreshPath = assertDataFile(root, `flow-refresh-${run}.json`);
  const previousRun = baseline.previous?.batchRun;
  const merged = previousRun?.planDigest === planDigest && ['sourceRevision', 'factsDigest', 'manifestDigest']
    .every((key) => baseline.previous.basis[key] === baseline.basis[key]) && readOptional(refreshPath) === null;
  return { root, snapshot, baseline, batches, run, planDigest, merged, refreshPath };
}

function getBatch(job, id) {
  const batch = job.batches.find((item) => item.id === id);
  if (!batch) throw new Error(`Unknown reconciliation batch: ${id}`);
  const path = assertDataFile(job.root, `flow-checkpoint-${job.run}-${id}.json`);
  const bytes = readOptional(path);
  const checkpoint = bytes ? batchCandidateSchema.parse(JSON.parse(bytes)) : null;
  if (checkpoint) {
    assertBasis(job.baseline.basis, checkpoint.basis);
    if (checkpoint.run !== job.run || checkpoint.batch !== id) throw new Error('Checkpoint belongs to a different batch.');
  }
  const files = batch.files.filter((file) => job.baseline.entries.has(file));
  const unavailablePaths = batch.files.filter((file) => !job.baseline.entries.has(file));
  return {
    ...batch, path, checkpoint, files, unavailablePaths,
    checkpointDigest: bytes ? hash(bytes) : null,
    previousFlows: (job.baseline.previous?.flows ?? []).filter((flow) => files.includes(flow.entry.path)),
  };
}

function coverage(batch, candidate) {
  const reviewed = new Set(candidate?.reviewedPaths ?? []);
  const deferred = new Set((candidate?.deferred ?? []).map(({ path }) => path));
  const pending = batch.files.filter((file) => !reviewed.has(file) && !deferred.has(file));
  return { reviewed: reviewed.size, deferred: deferred.size, unavailable: batch.unavailablePaths.length, pending: pending.length };
}

export function reconciliationStatus(projectRoot, selection = {}) {
  const job = getRun(bindProjectRoot(projectRoot), selection);
  if (job.merged) {
    const { previous, path } = job.baseline;
    return {
      state: 'merged', run: previous.batchRun.id, path, batches: job.batches.length,
      reviewed: previous.reviewedPaths.length, deferred: previous.uncheckedPaths.length,
      unavailable: previous.unavailablePaths.length, flows: previous.flows.length, gaps: previous.gaps.length,
    };
  }
  const batches = job.batches.map(({ id, module }) => {
    const batch = getBatch(job, id);
    return { id, module, ...coverage(batch, batch.checkpoint) };
  });
  const previousFlows = (job.baseline.previous?.flows ?? []).map(({ id, title, entry }) => ({ id, title, entry }));
  return { state: 'in-progress', run: job.run, batches, previousFlows };
}

export function refreshReconciliation(projectRoot, selection = {}) {
  const root = bindProjectRoot(projectRoot);
  const before = getRun(root, selection);
  const lock = claimPublication(before.baseline.path);
  try {
    const job = getRun(root, selection);
    assertBasis(job.baseline.basis, before.baseline.basis);
    if (job.merged) {
      atomicWrite(job.refreshPath, { run: job.run }, () => {
        assertBasis(readBaseline(root, '.', resolveSourceSnapshot(root, selection)).basis, job.baseline.basis);
      });
    }
    return reconciliationStatus(root, selection);
  } finally {
    rmSync(lock, { force: true });
  }
}

export function prepareBatch(projectRoot, id, selection = {}) {
  const job = getRun(bindProjectRoot(projectRoot), selection);
  if (job.merged) throw new Error('This source snapshot already has a merged reconciliation.');
  const { module, files, unavailablePaths, previousFlows, checkpoint, checkpointDigest } = getBatch(job, id);
  return { run: job.run, batch: id, module, basis: job.baseline.basis, files, unavailablePaths, previousFlows, checkpoint, checkpointDigest };
}

function validateBatch(job, batch, candidate, verify) {
  const files = new Set(batch.files);
  const deferred = unique(candidate.deferred.map(({ path }) => path), 'deferred paths');
  const reviewed = new Set(candidate.reviewedPaths);
  for (const path of deferred) {
    if (!files.has(path) || reviewed.has(path)) throw new Error(`Deferred path is reviewed or outside the batch: ${path}`);
  }
  const decided = new Set([...reviewed, ...deferred, ...batch.unavailablePaths]);
  const oldFlows = batch.previousFlows.filter((flow) => decided.has(flow.entry.path));
  validateCandidate(candidate, batch.files, job.baseline.entries, oldFlows, verify);
  const prior = new Set((job.baseline.previous?.flows ?? []).map(({ id }) => id));
  const localIds = new Set(batch.previousFlows.map(({ id }) => id));
  for (const flow of candidate.flows) {
    if (localIds.has(flow.id)) continue;
    const prefix = `entry:${encodeURIComponent(flow.entry.path)}#`;
    if (prior.has(flow.id) || !flow.id.startsWith(prefix) || flow.id.length === prefix.length) {
      throw new Error(`New batch flow ids must be unique and start with ${prefix}`);
    }
  }
  return decided;
}

const flowRevisionKey = (id) => JSON.stringify(['flow', id]);
const gapRevisionKey = (path, reason) => JSON.stringify(['gap', path, reason]);
const revisionKey = (item) => item.kind === 'flow' ? flowRevisionKey(item.id) : gapRevisionKey(item.path, item.previousReason);

function assertCheckpointProgress(previous, candidate, decided) {
  for (const path of previous?.reviewedPaths ?? []) {
    if (!candidate.reviewedPaths.includes(path)) throw new Error(`Checkpoint must keep previously reviewed path: ${path}`);
  }
  for (const { path } of previous?.deferred ?? []) {
    if (!decided.has(path)) throw new Error(`Checkpoint must keep previously decided path: ${path}`);
  }
  const retainedFlows = new Set([...candidate.flows, ...candidate.removed].map(({ id }) => id));
  const retainedGaps = new Set(candidate.gaps.map(({ path, reason }) => gapRevisionKey(path, reason)));
  const lost = new Set([
    ...(previous?.flows ?? []).filter(({ id }) => !retainedFlows.has(id)).map(({ id }) => flowRevisionKey(id)),
    ...(previous?.gaps ?? []).map(({ path, reason }) => gapRevisionKey(path, reason)).filter((key) => !retainedGaps.has(key)),
  ]);
  const oldRevisions = new Map((previous?.revisions ?? []).map((item) => [revisionKey(item), item.reason]));
  const revisions = candidate.revisions ?? [];
  const keys = unique(revisions.map(revisionKey), 'checkpoint revisions');
  for (const item of revisions) {
    const key = revisionKey(item);
    if (oldRevisions.has(key) ? oldRevisions.get(key) !== item.reason : !lost.has(key)) {
      throw new Error(`Invalid checkpoint revision: ${key}`);
    }
  }
  for (const key of [...oldRevisions.keys(), ...lost]) {
    if (!keys.has(key)) throw new Error(`Missing disposition for saved finding: ${key}`);
  }
}

export function saveBatch(projectRoot, id, input, selection = {}) {
  const root = bindProjectRoot(projectRoot);
  const candidate = batchCandidateSchema.parse(input);
  const job = getRun(root, selection);
  assertBasis(job.baseline.basis, candidate.basis);
  if (job.merged || candidate.run !== job.run || candidate.batch !== id) {
    throw new Error('This checkpoint belongs to a different or finished reconciliation.');
  }
  const lock = claimPublication(getBatch(job, id).path);
  try {
    const batch = getBatch(job, id);
    if (candidate.checkpointDigest !== batch.checkpointDigest) throw new Error('Checkpoint changed. Prepare the batch again.');
    if (coverage(batch, batch.checkpoint).pending === 0) throw new Error('This batch is already finished.');
    const decided = validateBatch(job, batch, candidate, verifyEvidence(root, job.snapshot, job.baseline.entries));
    assertCheckpointProgress(batch.checkpoint, candidate, decided);
    atomicWrite(batch.path, candidate, () => {
      assertBasis(readBaseline(root, '.', resolveSourceSnapshot(root, selection)).basis, job.baseline.basis);
    });
    return { path: batch.path, ...coverage(batch, candidate) };
  } finally {
    rmSync(lock, { force: true });
  }
}

function applyRelocations(candidate, prior, moves) {
  const oldIds = new Set(prior.map(({ id }) => id));
  const removed = new Set(candidate.removed.map(({ id }) => id));
  const flows = new Map(candidate.flows.map((flow) => [flow.id, flow]));
  unique(moves.map(({ fromId }) => fromId), 'relocated prior flow ids');
  unique(moves.map(({ toId }) => toId), 'relocation targets');
  for (const { fromId, toId } of moves) {
    if (!removed.has(fromId) || flows.has(fromId) || !flows.has(toId) || oldIds.has(toId)) {
      throw new Error(`Relocation requires a removed prior flow and a new checkpoint flow: ${fromId} -> ${toId}`);
    }
    flows.get(toId).id = fromId;
    removed.delete(fromId);
  }
  candidate.removed = candidate.removed.filter(({ id }) => removed.has(id));
}

export function mergeBatches(projectRoot, selection = {}, input) {
  const root = bindProjectRoot(projectRoot);
  const job = getRun(root, selection);
  const lock = claimPublication(job.baseline.path);
  try {
    assertBasis(readBaseline(root, '.', job.snapshot).basis, job.baseline.basis);
    const relocations = input === undefined ? null : relocationsSchema.parse(input);
    if (job.merged) {
      const published = job.baseline.previous.batchRun;
      if (relocations && (relocations.run !== published.id
        || JSON.stringify(relocations.moves) !== JSON.stringify(published.relocations ?? []))) {
        throw new Error('Relocations differ from the already merged reconciliation.');
      }
      return reconciliationStatus(root, selection);
    }
    if (relocations && relocations.run !== job.run) throw new Error('Relocations belong to a different reconciliation.');
    const parts = job.batches.map(({ id }) => getBatch(job, id));
    const pending = parts.filter((batch) => coverage(batch, batch.checkpoint).pending > 0);
    if (pending.length) throw new Error(`Finish pending reconciliation batches before merging: ${pending.map(({ id }) => id).join(', ')}`);
    const verify = verifyEvidence(root, job.snapshot, job.baseline.entries);
    for (const batch of parts) {
      if (batch.checkpoint) validateBatch(job, batch, batch.checkpoint, verify);
    }
    const completed = parts.flatMap(({ checkpoint }) => checkpoint ? [checkpoint] : []);
    const selected = new Set(job.baseline.files);
    const retired = (job.baseline.previous?.flows ?? [])
      .filter((flow) => !job.baseline.entries.has(flow.entry.path))
      .map(({ id, entry }) => ({
        id,
        reason: selected.has(entry.path)
          ? 'The former entry path is unavailable in the current source snapshot.'
          : 'The former entry path is no longer in the Lazy selection.',
      }));
    const candidate = {
      basis: job.baseline.basis,
      reviewedPaths: completed.flatMap((batch) => batch.reviewedPaths),
      flows: completed.flatMap((batch) => batch.flows),
      gaps: completed.flatMap((batch) => [...batch.gaps, ...batch.deferred]),
      removed: [...completed.flatMap((batch) => batch.removed), ...retired],
    };
    if (relocations?.moves.length) applyRelocations(candidate, job.baseline.previous?.flows ?? [], relocations.moves);
    const revisions = completed.flatMap((batch) => (batch.revisions ?? []).map((item) => ({ ...item, batch: batch.batch })));
    const batchRun = {
      id: job.run, planDigest: job.planDigest,
      ...(revisions.length && { revisions }),
      ...(relocations?.moves.length && { relocations: relocations.moves }),
    };
    return publishInventory(root, job.snapshot, selection, job.baseline, candidate, batchRun);
  } finally {
    rmSync(lock, { force: true });
  }
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    const args = process.argv.slice(2);
    // Lazy accepts a separate pattern argument even when the pattern starts with a dash.
    for (let index = 0; index < args.length; index++) {
      if (args[index] === '--') break;
      if (args[index] === '--exclude' && index + 1 < args.length) {
        args.splice(index, 2, `--exclude=${args[index + 1]}`);
      }
    }
    const { positionals, values } = parseArgs({
      args, allowPositionals: true, options: { exclude: { type: 'string' }, relocations: { type: 'boolean' } },
    });
    const [command, root, path, first, last] = positionals;
    const extraExcludePatterns = values.exclude?.split(',').map((pattern) => pattern.trim()).filter(Boolean) ?? [];
    const selection = { extraExcludePatterns };
    if (!root || !['check-root', 'prepare', 'read', 'publish', 'status', 'refresh', 'prepare-batch', 'save-batch', 'merge'].includes(command)) {
      throw new Error('Usage: reconcile.mjs <check-root|prepare|read|publish|status|refresh|prepare-batch|save-batch|merge> <root> [path|batch]. All commands accept --exclude <patterns>.');
    }
    if (values.relocations && command !== 'merge') throw new Error('--relocations requires the merge command.');
    let result;
    if (command === 'check-root') result = { dataDir: assertDataTree(bindProjectRoot(root)) };
    else if (command === 'prepare') result = prepareReconciliation(root, path, selection);
    else if (command === 'read') result = readSource(root, path, first, last, selection);
    else if (command === 'status') result = reconciliationStatus(root, selection);
    else if (command === 'refresh') result = refreshReconciliation(root, selection);
    else if (command === 'prepare-batch') result = prepareBatch(root, path, selection);
    else if (command === 'save-batch') result = saveBatch(root, path, JSON.parse(readFileSync(0, 'utf8')), selection);
    else if (command === 'merge') result = mergeBatches(root, selection,
      values.relocations ? JSON.parse(readFileSync(0, 'utf8')) : undefined);
    else result = publishReconciliation(root, JSON.parse(readFileSync(0, 'utf8')), selection);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
