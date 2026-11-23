#!/usr/bin/env node
/**
 * merge-domain-areas.mjs
 *
 * Merges the per-area domain analyses that split-domain-areas.mjs planned
 * into the one `intermediate/domain-analysis.json` the rest of the domain
 * skill already consumes (anchoring, validation, save), and writes a
 * coverage report that says, per area, per module and per file with an entry
 * point, what came back with no flow. The graph itself stays model-authored:
 * this script only accepts or rejects outputs, joins them by fixed rules and
 * counts.
 *
 * Acceptance. An area output must carry `areaRun: {areaId, token}` matching
 * the manifest. Without it the output is `rejected-stale` (an earlier run's
 * file or a published domain-graph.json copied into place cannot carry this
 * run's token); unparsable JSON is `rejected-parse`; no file is `missing`.
 * Nothing of a rejected area enters the merged graph. Exit code 3 when any
 * area is not accepted; the graph and the report are still written.
 *
 * Merge rules, over accepted outputs in area-id order:
 *   - domains with the same id become one: first name and summary, union of
 *     tags and of every array in domainMeta, the higher complexity;
 *   - any other node whose id an earlier area already used is renamed
 *     `<id>--<areaId>`, and that area's edges follow the rename;
 *   - optional aliases {"domain:a": "domain:b"} (written by the
 *     orchestrator, never by this script) fold a into b when both are
 *     domains, a != b and b is not itself an alias source;
 *   - edges whose ends are missing are dropped (edgesDangling), self loops
 *     dropped (edgesSelfLoop), repeated type|source|target kept once.
 *
 * Coverage. A step is located by its `filePath` when that is a file of a
 * module, else by its `nodeIds` through the graph nodes the area contexts
 * carried. A filePath that is absolute or escapes the root is never located,
 * not even through its nodeIds.
 * Each module lands in exactly one bucket: covered (a flow has a step in
 * it), declared-skip (no flow, its area listed it in skippedModules with a
 * reason), silent-zero (no flow, not declared, has entry points) or
 * no-candidates (no flow, not declared, no entry point). A module split
 * into parts is covered when any part is; each area also names the parts
 * it holds that have entry points, no cited file and no declared skip
 * (silentZeroParts), so an area that returned nothing for its part shows.
 *
 * Usage:
 *   node merge-domain-areas.mjs <projectRoot>
 *     [--aliases <file>] [--out <path>] [--coverage <path>]
 *
 * Logging: summary to stdout, diagnostics to stderr.
 */

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AREAS_DIR, relativeInsideRoot } from './split-domain-areas.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

export const COVERAGE_FORMAT = 'excavator-domain-coverage/1';
export const EXIT_INCOMPLETE = 3;
export const MODULE_BUCKETS = Object.freeze(['covered', 'declared-skip', 'silent-zero', 'no-candidates']);
const AREA_ID = /^area-\d+$/;
const COMPLEXITY = ['simple', 'moderate', 'complex'];
/** Fields of an area output that describe the run, not the domain graph. */
const AREA_ONLY_FIELDS = ['areaRun', 'skippedModules'];

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const clone = (value) => JSON.parse(JSON.stringify(value));
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Accept or reject one area's output text. `text: null` means the file does not exist. */
export function acceptOutput({ token, areaId, text }) {
  if (text === null || text === undefined) return { status: 'missing' };
  let graph;
  try {
    graph = JSON.parse(text);
  } catch (error) {
    return { status: 'rejected-parse', reason: error.message };
  }
  if (!isObject(graph)) return { status: 'rejected-parse', reason: 'not a JSON object' };
  const run = graph.areaRun;
  if (!isObject(run)) return { status: 'rejected-stale', reason: 'no areaRun' };
  if (run.token !== token) return { status: 'rejected-stale', reason: 'areaRun.token is not this run\'s token' };
  if (run.areaId !== areaId) return { status: 'rejected-stale', reason: `areaRun.areaId is ${JSON.stringify(run.areaId)}` };
  return { status: 'accepted', graph };
}

function unionInto(target, source) {
  const seen = new Set(target.map((v) => JSON.stringify(v)));
  for (const value of source) {
    const key = JSON.stringify(value);
    if (!seen.has(key)) { seen.add(key); target.push(value); }
  }
  return target;
}

function mergeDomainInto(target, source) {
  if (Array.isArray(source.tags)) target.tags = unionInto(Array.isArray(target.tags) ? target.tags : [], source.tags);
  const rank = (c) => COMPLEXITY.indexOf(c);
  if (rank(source.complexity) > rank(target.complexity)) target.complexity = source.complexity;
  if (isObject(source.domainMeta)) {
    if (!isObject(target.domainMeta)) target.domainMeta = {};
    for (const [key, value] of Object.entries(source.domainMeta)) {
      const have = target.domainMeta[key];
      if (have === undefined) target.domainMeta[key] = clone(value);
      else if (Array.isArray(have) && Array.isArray(value)) unionInto(have, value);
    }
  }
}

/**
 * Merge accepted area graphs. `accepted` is [{areaId, graph}] in any order;
 * it is processed in area-id order. Returns { graph, merge }.
 */
export function mergeAreas({ accepted, aliases = null }) {
  const ordered = [...accepted].sort((a, b) => compare(a.areaId, b.areaId));
  const merge = {
    domainsMerged: [],
    idsRenamed: [],
    aliasesApplied: [],
    aliasesRejected: [],
    nodesWithoutId: 0,
    duplicateIdsInArea: 0,
    edgesDangling: 0,
    edgesSelfLoop: 0,
    edgesDuplicate: 0,
  };
  const nodes = new Map();
  const domainAreas = new Map();
  const edges = [];
  let project = null;
  let version = null;

  for (const { areaId, graph } of ordered) {
    if (project === null && isObject(graph.project)) project = clone(graph.project);
    else if (project && isObject(graph.project)) {
      for (const key of ['languages', 'frameworks']) {
        if (Array.isArray(graph.project[key])) project[key] = unionInto(Array.isArray(project[key]) ? project[key] : [], graph.project[key]);
      }
    }
    if (version === null && typeof graph.version === 'string') version = graph.version;

    const rename = new Map();
    const seenHere = new Set();
    for (const raw of Array.isArray(graph.nodes) ? graph.nodes : []) {
      if (!isObject(raw) || typeof raw.id !== 'string' || raw.id.length === 0) { merge.nodesWithoutId += 1; continue; }
      if (seenHere.has(raw.id)) { merge.duplicateIdsInArea += 1; continue; }
      seenHere.add(raw.id);
      const node = clone(raw);
      if (node.type === 'domain') {
        if (!domainAreas.has(node.id)) domainAreas.set(node.id, []);
        domainAreas.get(node.id).push(areaId);
        const existing = nodes.get(node.id);
        if (existing && existing.type === 'domain') { mergeDomainInto(existing, node); continue; }
      }
      if (nodes.has(node.id)) {
        const renamed = `${node.id}--${areaId}`;
        rename.set(node.id, renamed);
        merge.idsRenamed.push({ from: node.id, to: renamed, areaId });
        node.id = renamed;
      }
      nodes.set(node.id, node);
    }
    for (const raw of Array.isArray(graph.edges) ? graph.edges : []) {
      if (!isObject(raw)) { merge.edgesDangling += 1; continue; }
      const edge = clone(raw);
      if (rename.has(edge.source)) edge.source = rename.get(edge.source);
      if (rename.has(edge.target)) edge.target = rename.get(edge.target);
      edges.push(edge);
    }
  }
  for (const [id, areas] of domainAreas) {
    if (areas.length > 1) merge.domainsMerged.push({ id, areas });
  }
  merge.domainsMerged.sort((a, b) => compare(a.id, b.id));

  // Aliases: judged by the orchestrator, checked and applied here.
  const aliasMap = new Map();
  if (aliases !== null) {
    if (!isObject(aliases)) throw new Error('aliases must be a JSON object of "domain:a": "domain:b"');
    const sources = new Set(Object.keys(aliases));
    for (const [from, to] of Object.entries(aliases).sort(([a], [b]) => compare(a, b))) {
      let reason = null;
      if (typeof to !== 'string') reason = 'target is not a string';
      else if (from === to) reason = 'self';
      else if (!nodes.has(from)) reason = 'source-missing';
      else if (!nodes.has(to)) reason = 'target-missing';
      else if (nodes.get(from).type !== 'domain' || nodes.get(to).type !== 'domain') reason = 'not-a-domain';
      else if (sources.has(to)) reason = 'chained';
      if (reason) { merge.aliasesRejected.push({ from, to, reason }); continue; }
      aliasMap.set(from, to);
      merge.aliasesApplied.push({ from, to });
    }
    for (const [from, to] of aliasMap) {
      mergeDomainInto(nodes.get(to), nodes.get(from));
      nodes.delete(from);
    }
  }

  const kept = [];
  const seenEdges = new Set();
  for (const edge of edges) {
    if (aliasMap.has(edge.source)) edge.source = aliasMap.get(edge.source);
    if (aliasMap.has(edge.target)) edge.target = aliasMap.get(edge.target);
    if (typeof edge.source !== 'string' || typeof edge.target !== 'string' || !nodes.has(edge.source) || !nodes.has(edge.target)) {
      merge.edgesDangling += 1;
      continue;
    }
    if (edge.source === edge.target) { merge.edgesSelfLoop += 1; continue; }
    const key = `${edge.type}|${edge.source}|${edge.target}`;
    if (seenEdges.has(key)) { merge.edgesDuplicate += 1; continue; }
    seenEdges.add(key);
    kept.push(edge);
  }

  const graph = {
    version: version ?? '1.0.0',
    project: project ?? {},
    nodes: [...nodes.values()],
    edges: kept,
    layers: [],
    tour: [],
  };
  for (const field of AREA_ONLY_FIELDS) delete graph[field];
  return { graph, merge };
}

function countTypes(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const count = (type) => nodes.filter((n) => isObject(n) && n.type === type).length;
  return { domains: count('domain'), flows: count('flow'), steps: count('step') };
}

/**
 * The coverage report. `areaResults` is [{areaId, status, reason?, graph?}]
 * for every area of the manifest; `merged` is mergeAreas' graph; `nodeFiles`
 * maps knowledge-graph node ids to project-relative files.
 */
export function computeCoverage({ manifest, areaResults, merged, nodeFiles = new Map(), merge = null }) {
  const fileModule = new Map();
  for (const module of manifest.modules) for (const file of module.files) fileModule.set(file, module.path);

  // Steps -> files.
  const steps = { total: 0, located: 0, unlocated: 0, fileOutsideRoot: 0, fileOutsideModules: 0 };
  const stepFile = new Map();
  for (const node of merged.nodes) {
    if (node.type !== 'step') continue;
    steps.total += 1;
    let file = null;
    let pathState = 'absent';
    if (typeof node.filePath === 'string' && node.filePath.length > 0) {
      const rel = relativeInsideRoot(node.filePath);
      if (rel === null) pathState = 'outside-root';
      else if (fileModule.has(rel)) file = rel;
      else pathState = 'outside-modules';
    }
    if (file === null && pathState !== 'outside-root' && Array.isArray(node.nodeIds)) {
      file = node.nodeIds.map((id) => nodeFiles.get(id)).find((f) => f && fileModule.has(f)) ?? null;
    }
    if (file !== null) { steps.located += 1; stepFile.set(node.id, file); continue; }
    if (pathState === 'outside-root') steps.fileOutsideRoot += 1;
    else if (pathState === 'outside-modules') steps.fileOutsideModules += 1;
    else steps.unlocated += 1;
  }

  // Flows -> modules, and the files steps cite.
  const flowsOfModule = new Map();
  const citedFiles = new Set(stepFile.values());
  for (const edge of merged.edges) {
    if (edge.type !== 'flow_step') continue;
    const file = stepFile.get(edge.target);
    if (!file) continue;
    const module = fileModule.get(file);
    if (!flowsOfModule.has(module)) flowsOfModule.set(module, new Set());
    flowsOfModule.get(module).add(edge.source);
  }

  // Declared skips, from accepted outputs only.
  const declared = new Map();
  const skippedModulesUnknown = [];
  let skippedModulesWithoutReason = 0;
  for (const result of areaResults) {
    if (result.status !== 'accepted' || !Array.isArray(result.graph?.skippedModules)) continue;
    for (const entry of result.graph.skippedModules) {
      const path = isObject(entry) ? entry.module : undefined;
      const reason = isObject(entry) && typeof entry.reason === 'string' ? entry.reason.trim() : '';
      const module = manifest.modules.find((m) => m.path === path);
      if (!module || !module.areas.includes(result.areaId)) {
        skippedModulesUnknown.push({ areaId: result.areaId, module: path ?? null });
        continue;
      }
      if (reason.length === 0) { skippedModulesWithoutReason += 1; continue; }
      if (!declared.has(path)) declared.set(path, reason);
    }
  }

  const buckets = Object.fromEntries(MODULE_BUCKETS.map((b) => [b, 0]));
  const modules = manifest.modules.map((module) => {
    const flows = flowsOfModule.get(module.path)?.size ?? 0;
    let status;
    if (flows > 0) status = 'covered';
    else if (declared.has(module.path)) status = 'declared-skip';
    else if (module.entryPoints > 0) status = 'silent-zero';
    else status = 'no-candidates';
    buckets[status] += 1;
    const row = { path: module.path, areas: module.areas, files: module.files.length, entryPoints: module.entryPoints, flows, status };
    if (status === 'declared-skip') row.skipReason = declared.get(module.path);
    return row;
  });

  const candidates = manifest.modules.flatMap((m) => m.candidateFiles ?? []).sort(compare);
  const uncited = candidates.filter((f) => !citedFiles.has(f));

  const statusOf = new Map(modules.map((m) => [m.path, m.status]));
  const candidateSet = new Set(candidates);
  const areas = manifest.areas.map(({ areaId, modules: held = [] }) => {
    const result = areaResults.find((r) => r.areaId === areaId) ?? { status: 'missing' };
    const paths = manifest.modules.filter((m) => m.areas.includes(areaId)).map((m) => m.path);
    const row = {
      areaId,
      status: result.status,
      modules: paths,
      entryPoints: manifest.modules.filter((m) => m.areas.includes(areaId)).reduce((n, m) => n + m.entryPoints, 0),
      ...(result.status === 'accepted' ? countTypes(result.graph) : { domains: 0, flows: 0, steps: 0 }),
      silentZeroModules: paths.filter((p) => statusOf.get(p) === 'silent-zero').sort(compare),
      silentZeroParts: held
        .filter(({ path, part, files = [] }) => part
          && !declared.has(path)
          && files.some((f) => candidateSet.has(f))
          && !files.some((f) => citedFiles.has(f)))
        .map(({ path, part }) => ({ path, part })),
    };
    if (result.reason) row.reason = result.reason;
    return row;
  });

  return {
    format: COVERAGE_FORMAT,
    token: manifest.token,
    status: areas.every((a) => a.status === 'accepted') ? 'complete' : 'incomplete',
    totals: countTypes(merged),
    buckets,
    steps,
    candidateFiles: { total: candidates.length, cited: candidates.length - uncited.length, uncited },
    silentZeroParts: areas.reduce((n, a) => n + a.silentZeroParts.length, 0),
    split: manifest.counts ?? null,
    areas,
    modules,
    merge: { ...(merge ?? {}), skippedModulesUnknown, skippedModulesWithoutReason },
  };
}

function parseArgs(argv) {
  const args = { projectRoot: null, aliases: null, out: null, coverage: null };
  const flags = { '--aliases': 'aliases', '--out': 'out', '--coverage': 'coverage' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (flags[arg]) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`merge-domain-areas: ${arg} requires a value`);
      args[flags[arg]] = value;
      i++;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`merge-domain-areas: unknown option: ${arg}`);
    if (!args.projectRoot) { args.projectRoot = arg; continue; }
    throw new Error(`merge-domain-areas: unexpected argument: ${arg}`);
  }
  if (!args.projectRoot) {
    throw new Error('Usage: node merge-domain-areas.mjs <projectRoot> [--aliases <file>] [--out <path>] [--coverage <path>]');
  }
  return args;
}

async function resolveDataDir(projectRoot) {
  let core;
  try {
    core = await import(pathToFileURL(require.resolve('@excavator/core')).href);
  } catch {
    core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
  }
  return core.resolveDataDir(projectRoot);
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function readOrNull(path) {
  return existsSync(path) ? readFileSync(path, 'utf-8') : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(args.projectRoot);
  const dataDir = await resolveDataDir(projectRoot);
  const intermediate = join(dataDir, 'intermediate');
  const areasDir = join(intermediate, AREAS_DIR);
  const manifestPath = join(areasDir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`merge-domain-areas: no area manifest at ${manifestPath}; run split-domain-areas.mjs first`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  // Area files are found from the area id, never from a path the manifest carries.
  const areaResults = [];
  const nodeFiles = new Map();
  for (const { areaId } of manifest.areas) {
    if (!AREA_ID.test(areaId)) throw new Error(`merge-domain-areas: malformed area id ${JSON.stringify(areaId)} in the manifest`);
    const result = acceptOutput({ token: manifest.token, areaId, text: readOrNull(join(areasDir, `${areaId}.analysis.json`)) });
    areaResults.push({ areaId, ...result });
    const contextText = readOrNull(join(areasDir, `${areaId}.context.json`));
    if (contextText !== null) {
      for (const node of JSON.parse(contextText).graphNodes ?? []) {
        const file = relativeInsideRoot(node?.filePath);
        if (typeof node?.id === 'string' && file !== null) nodeFiles.set(node.id, file);
      }
    }
  }

  const aliases = args.aliases ? JSON.parse(readFileSync(resolve(args.aliases), 'utf-8')) : null;
  const accepted = areaResults.filter((r) => r.status === 'accepted').map(({ areaId, graph }) => ({ areaId, graph }));
  const { graph, merge } = mergeAreas({ accepted, aliases });
  const coverage = computeCoverage({ manifest, areaResults, merged: graph, nodeFiles, merge });

  writeJson(resolve(args.out ?? join(intermediate, 'domain-analysis.json')), graph);
  const coveragePath = resolve(args.coverage ?? join(dataDir, 'reports', 'domain-coverage.json'));
  writeJson(coveragePath, coverage);

  const out = [];
  for (const area of coverage.areas) {
    out.push(
      `${area.areaId} ${area.status}${area.reason ? ` (${area.reason})` : ''} domains=${area.domains} flows=${area.flows} ` +
      `steps=${area.steps} modules=${area.modules.length} silent-zero=${area.silentZeroModules.length}` +
      `${area.silentZeroParts.length ? ` silent-zero-parts=${area.silentZeroParts.length}` : ''}`,
    );
  }
  const b = coverage.buckets;
  out.push(
    `modules=${coverage.modules.length} covered=${b.covered} declared-skip=${b['declared-skip']} ` +
    `silent-zero=${b['silent-zero']} no-candidates=${b['no-candidates']}`,
  );
  out.push(`candidate files cited=${coverage.candidateFiles.cited}/${coverage.candidateFiles.total}`);
  out.push(`totals domains=${coverage.totals.domains} flows=${coverage.totals.flows} steps=${coverage.totals.steps}`);
  for (const module of coverage.modules.filter((m) => m.status === 'silent-zero')) {
    out.push(`silent-zero ${module.path} entryPoints=${module.entryPoints} areas=${module.areas.join(',')}`);
  }
  for (const area of coverage.areas) {
    for (const { path, part } of area.silentZeroParts) out.push(`silent-zero-part ${path} part=${part.index}/${part.of} area=${area.areaId}`);
  }
  out.push(`coverage report: ${coveragePath}`);
  process.stdout.write(`${out.join('\n')}\n`);

  if (coverage.status !== 'complete') {
    const bad = coverage.areas.filter((a) => a.status !== 'accepted').map((a) => `${a.areaId}=${a.status}`);
    process.stderr.write(`merge-domain-areas: areas not accepted: ${bad.join(' ')}\n`);
    process.exitCode = EXIT_INCOMPLETE;
  }
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    await main();
  } catch (err) {
    process.stderr.write(`merge-domain-areas.mjs failed: ${err.message}\n`);
    process.exit(1);
  }
}

export default { acceptOutput, mergeAreas, computeCoverage, MODULE_BUCKETS };
