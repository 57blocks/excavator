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
  gaps: z.array(z.strictObject({ path: sourcePath, reason: text })),
  removed: z.array(z.strictObject({ id: text, reason: text })),
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

export function publishReconciliation(projectRoot, input, selection = {}) {
  const root = bindProjectRoot(projectRoot);
  const candidate = candidateSchema.parse(input);
  const snapshot = resolveSourceSnapshot(root, selection);
  const before = readBaseline(root, candidate.basis.scope, snapshot);
  const lock = claimPublication(before.path);
  const temporary = `${before.path}.${randomUUID()}.tmp`;
  try {
    const current = readBaseline(root, candidate.basis.scope, snapshot);
    for (const key of Object.keys(current.basis)) {
      if (current.basis[key] !== candidate.basis[key]) {
        throw new Error(`Reconciliation baseline changed (${key}). Prepare again before publishing.`);
      }
    }
    const reviewed = unique(candidate.reviewedPaths, 'reviewed paths');
    const scope = new Set(current.files);
    for (const path of reviewed) {
      if (!scope.has(path) || !current.entries.has(path)) throw new Error(`Reviewed path is unavailable or outside the scope: ${path}`);
    }
    for (const gap of candidate.gaps) {
      canonicalSourcePath(gap.path);
      if (!current.entries.has(gap.path)) throw new Error(`Gap path is outside the source manifest: ${gap.path}`);
    }
    const verify = verifyEvidence(root, snapshot, current.entries);
    const flowIds = unique(candidate.flows.map((flow) => flow.id), 'flow ids');
    const oldIds = new Set((current.previous?.flows ?? []).map((flow) => flow.id));
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
    const { flows, gaps, removed: removedFlows } = candidate;
    const result = {
      format: FORMAT,
      basis: current.basis,
      reviewedPaths: [...reviewed].sort(),
      uncheckedPaths: current.files.filter((path) => current.entries.has(path) && !reviewed.has(path)),
      unavailablePaths: current.unavailablePaths,
      flows,
      gaps,
      removed: removedFlows,
    };
    writeFileSync(temporary, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    const latest = readBaseline(root, candidate.basis.scope, resolveSourceSnapshot(root, selection));
    if (Object.keys(latest.basis).some((key) => latest.basis[key] !== current.basis[key])) {
      throw new Error('Source or product changed during verification. Prepare again.');
    }
    renameSync(temporary, current.path);
    return {
      path: current.path,
      flows: result.flows.length,
      reviewed: reviewed.size,
      unchecked: result.uncheckedPaths.length,
      unavailable: result.unavailablePaths.length,
      gaps: result.gaps.length,
      removed: removedFlows.length,
    };
  } finally {
    rmSync(temporary, { force: true });
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
    const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { exclude: { type: 'string' } } });
    const [command, root, path, first, last] = positionals;
    const extraExcludePatterns = values.exclude?.split(',').map((pattern) => pattern.trim()).filter(Boolean) ?? [];
    const selection = { extraExcludePatterns };
    if (!root || !['check-root', 'prepare', 'read', 'publish'].includes(command)) {
      throw new Error('Usage: reconcile.mjs check-root <root> | prepare <root> [scope] | read <root> <path> [first last] | publish <root> < candidate.json. All commands accept --exclude <patterns>.');
    }
    let result;
    if (command === 'check-root') result = { dataDir: assertDataTree(bindProjectRoot(root)) };
    else if (command === 'prepare') result = prepareReconciliation(root, path, selection);
    else if (command === 'read') result = readSource(root, path, first, last, selection);
    else result = publishReconciliation(root, JSON.parse(readFileSync(0, 'utf8')), selection);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
