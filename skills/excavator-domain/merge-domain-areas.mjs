#!/usr/bin/env node
/**
 * merge-domain-areas.mjs
 *
 * Merges the per-area flow analyses that split-domain-areas.mjs planned into
 * the one `intermediate/domain-analysis.json` the rest of the domain skill
 * already consumes (anchoring, validation, save), and writes a coverage
 * report that says, per area, per module and per file with an entry point,
 * what came back with no flow. Flows and steps stay model-authored; domains
 * come only from the accepted plan (plan-domains.mjs, `<dataDir>/domain-plan.json`):
 * this script accepts or rejects area outputs, joins them by fixed rules,
 * homes flows under plan domains by rule, and counts.
 *
 * Acceptance. An area output must carry `areaRun: {areaId, token}` matching
 * the manifest. Without it the output is `rejected-stale` (an earlier run's
 * file or a published domain-graph.json copied into place cannot carry this
 * run's token); unparsable JSON is `rejected-parse`; no file is `missing`.
 * Every flow that starts in a choose module (see Homing) must carry a
 * `domainMeta.domain` that is a plan domain id and a non-empty
 * `domainMeta.domainReason`; an output with any flow short of that is
 * `rejected-choice`, and one line per such flow names it and the allowed
 * ids, so the analyzer is sent back to choose instead of the merge placing
 * the flow by fallback. `--accept-unchosen` (used only after one re-dispatch)
 * accepts such an output anyway and records its flows on the area
 * (`unchosen`); homing then treats them as before: a missing or invalid
 * pick falls back and is counted, a pick without a reason is kept and
 * counted as choicesWithoutReason.
 * Every `domainMeta.entryPointIds` must cite script entry points of the area
 * (each carries an `id` and a handler `group`, from extract-domain-context.py):
 * a citation that is malformed, names an unknown id, mixes groups or cites
 * a group an earlier flow of the area cites makes the area
 * `rejected-entry-point` (`rejected-choice` when it also fails the choice
 * check), one line per flow. `--accept-unchosen` accepts it too and drops
 * the wrong ids by fixed rules (checkCitations), counted as citationsDropped.
 * Nothing of a rejected area enters the merged graph. Exit code 3 when any
 * area is not accepted; the graph and the report are still written.
 *
 * Anchored flows. A flow with a citation that survives is named by the
 * script: `flow:` plus its group's id without `ep:`, whatever id the analyzer
 * gave it, so two runs that cite the same handler give the same flow id. Its
 * entryPointIds are rewritten in fact order, entryPoint to the facts' method
 * and path, entryType to http (manual for a UI route), and its home module is
 * the module of the group's file. The renames are in flowIdsDerived; every
 * raw id -> merged id (derived or collision suffix) is in renames, which the
 * conservation check follows.
 *
 * `--check <areaId>` runs the acceptance of that one area against the stored
 * plan, writes nothing, prints `accepted` or the rejection lines and exits 0
 * or 3. The analyzer runs it on its own output before it returns.
 *
 * Merge rules, over accepted outputs in area-id order:
 *   - one domain node per plan domain, in plan order, carrying its kind, the
 *     sorted modules assigned to it and its cross-domain interactions;
 *     complexity is a structural count of the modules it holds (<=2 simple,
 *     <=6 moderate, else complex);
 *   - domain nodes, `contains_flow` and `cross_domain` edges an analyzer
 *     wrote are ignored and counted (analyzerDomainsIgnored,
 *     analyzerEdgesIgnored); `cross_domain` edges come from the plan;
 *   - any other node whose id an earlier area already used is renamed
 *     `<id>--<areaId>`, and that area's edges follow the rename;
 *   - edges whose ends are not nodes of the area that wrote them are dropped
 *     (edgesDangling), self loops
 *     dropped (edgesSelfLoop), repeated type|source|target kept once.
 *
 * Homing. A flow's home module is the module of its first locatable step,
 * steps taken by `flow_step` weight ascending then edge order (homedBy
 * step). With no locatable step, a `domainMeta.module` that is a module the
 * flow's area holds is the home module (declared). Otherwise the flow is
 * unplaced: it and its steps stay, no `contains_flow` edge is made, and it is
 * counted and listed. Nothing is guessed.
 *
 * The domain then follows from the home module. A module of one business
 * area (not marked mixed in the plan, assigned to a business domain) decides
 * it (byModule); a `domainMeta.domain` the analyzer wrote there is ignored
 * and counted (choicesIgnored). A mixed module, or a module of a support
 * domain, holds flows of many areas, so there the analyzer's
 * `domainMeta.domain` decides when it is a plan domain id (byChoice); a
 * missing or unknown one falls back to the module's domain and is counted
 * (fallbackMissing, fallbackInvalid). Acceptance rejects such flows, so the
 * fallback is reached only by an area accepted with `--accept-unchosen`. Every such flow is listed in `choices`
 * with the analyzer's `domainMeta.domainReason`, and `support` counts the
 * flows that end in a support domain, naming those that got there without a
 * choice that carries a reason. A claim the merge did not follow (ignored or
 * invalid) is removed from the merged flow node, so the graph never shows a
 * domain the flow is not under; the report keeps the invalid value.
 *
 * Conservation. checkConservation compares every accepted area's flow ids,
 * step ids and `flow_step` edges (through that area's renames) with the
 * merged graph: each must appear exactly once, and nothing may appear that
 * no area gave. Exit code 4 when it fails; the coverage report is still
 * written, domain-analysis.json is not.
 *
 * Coverage. A step is located by its `filePath` when that is a file of a
 * module, else by its `nodeIds` through the graph nodes the area contexts
 * carried. A filePath that is absolute or escapes the root is never located,
 * not even through its nodeIds.
 * Each module lands in exactly one bucket: covered (a flow has a step in
 * it), declared-skip (no flow, its area listed it in skippedModules with a
 * reason), silent-zero (no flow, not declared, and script + pattern + accepted
 * model entry points > 0 or it has files with unrecognised registrations) or
 * no-candidates (no flow, not declared, none of those).
 *
 * Model entry points. An area output's top-level `entryPoints` (entries the
 * analyzer found in the area's unrecognised files) is area-only: it never
 * reaches the merged graph. model-entry-points.mjs checks each element against
 * the area's unrecognised files and the file text; accepted ones are written
 * to the report with `source: "model"` and their module, rejected ones are
 * counted per reason. A module split
 * into parts is covered when any part is; each area also names the parts
 * it holds that have entry points, no cited file and no declared skip
 * (silentZeroParts), so an area that returned nothing for its part shows.
 *
 * Usage:
 *   node merge-domain-areas.mjs <projectRoot> [--out <path>] [--coverage <path>] [--accept-unchosen]
 *   node merge-domain-areas.mjs <projectRoot> --check <areaId>
 *
 * Logging: summary to stdout, diagnostics to stderr.
 */

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AREAS_DIR, relativeInsideRoot } from './split-domain-areas.mjs';
import { MODEL_ENTRY_REJECTIONS, checkModelEntryPoints, readProjectLines } from './model-entry-points.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

export const COVERAGE_FORMAT = 'excavator-domain-coverage/1';
export const EXIT_INCOMPLETE = 3;
export const EXIT_NOT_CONSERVED = 4;
export const MODULE_BUCKETS = Object.freeze(['covered', 'declared-skip', 'silent-zero', 'no-candidates']);
export const ENTRY_POINT_BUCKETS = Object.freeze(['in-flow', 'declared-skip', 'silent', 'area-not-accepted', 'outside-areas']);
const AREA_ID = /^area-\d+$/;
/** Fields of an area output that describe the run, not the domain graph. */
const IGNORED_EDGE_TYPES = new Set(['contains_flow', 'cross_domain']);
const AREA_ONLY_FIELDS = ['areaRun', 'skippedModules', 'skippedEntryPoints', 'entryPoints'];

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const clone = (value) => JSON.parse(JSON.stringify(value));
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Accept or reject one area's output text. `text: null` means the file does
 * not exist. With `choice: {plan, manifest, nodeFiles}` the flows of choose
 * modules are checked too (checkChoices); `allowUnchosen` accepts an output
 * that fails only that check and returns its flows as `unchosen`.
 */
export function acceptOutput({ token, areaId, text, choice = null, allowUnchosen = false }) {
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
  if (choice === null) return { status: 'accepted', graph };
  const { problems: citationProblems } = checkCitations({ graph, entries: choice.entries ?? [] });
  const { allowed, problems } = checkChoices({ graph, areaId, ...choice });
  if (problems.length === 0 && citationProblems.length === 0) return { status: 'accepted', graph };
  if (allowUnchosen) {
    return {
      status: 'accepted', graph,
      ...(problems.length ? { unchosen: problems } : {}),
      ...(citationProblems.length ? { uncited: citationProblems } : {}),
    };
  }
  const name = (list) => list.slice(0, 5).map((p) => p.flow).join(', ') + (list.length > 5 ? ` (+${list.length - 5} more)` : '');
  const reasons = [];
  if (problems.length) {
    reasons.push(`${problems.length} flow(s) of choose modules lack a plan domain id in domainMeta.domain with a domainMeta.domainReason: ${name(problems)}; allowed: ${allowed.join(', ')}`);
  }
  if (citationProblems.length) {
    reasons.push(`${citationProblems.length} flow(s) cite entry points wrongly in domainMeta.entryPointIds: ${name(citationProblems)}`);
  }
  return {
    status: problems.length ? 'rejected-choice' : 'rejected-entry-point',
    reason: reasons.join('; '),
    problems,
    citationProblems,
    allowed,
  };
}

/** Fact order of script entry points: registration file and line, method, path, then the entry's own file and line. */
function compareEntries(a, b) {
  const key = (e) => [
    e.registeredAt?.file ?? '', e.registeredAt?.line ?? 0, e.method ?? '', e.path ?? e.pathText ?? '', e.file ?? '', e.line ?? 0,
  ];
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < ka.length; i++) {
    const c = typeof ka[i] === 'number' && typeof kb[i] === 'number' ? ka[i] - kb[i] : compare(String(ka[i]), String(kb[i]));
    if (c !== 0) return c;
  }
  return 0;
}

/** "GET /orders" for an http entry point, the path alone for a ui one. */
export function entryPointText(entry) {
  const path = entry.path ?? entry.pathText ?? '';
  return entry.type === 'ui' || !entry.method ? path : `${entry.method} ${path}`;
}

/**
 * The `domainMeta.entryPointIds` of one area output, checked against the
 * area's script entry points (`entries`, each with `id` and `group`), flows in
 * output order. `problems` names each flow whose citation is malformed (not
 * an array of strings), unknown (an id that is not a script entry point of
 * the area), mixed-groups (ids of more than one handler group) or
 * shared-group (a group an earlier flow already cites). `cited` maps each
 * flow id to what survives fixed rules, which the merge uses: malformed and
 * unknown ids are dropped; of several groups only the group of the first
 * remaining id in fact order is kept; a flow whose group is taken keeps
 * none. `dropped` counts the ids (a non-array field counts as one) not kept.
 */
export function checkCitations({ graph, entries = [] }) {
  const byId = new Map(entries.filter((e) => typeof e?.id === 'string').map((e) => [e.id, e]));
  const { areaNodes } = areaParts(graph);
  const problems = [];
  const cited = new Map();
  const claimed = new Map();
  let dropped = 0;
  for (const flow of areaNodes.values()) {
    if (flow.type !== 'flow') continue;
    const raw = flow.domainMeta?.entryPointIds;
    if (raw === undefined || raw === null) continue;
    if (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string')) {
      problems.push({ flow: flow.id, problem: 'malformed', ids: Array.isArray(raw) ? raw.filter((id) => typeof id !== 'string') : [raw] });
    }
    const strings = Array.isArray(raw) ? [...new Set(raw.filter((id) => typeof id === 'string'))] : [];
    dropped += Array.isArray(raw) ? raw.length - strings.length : 1;
    const unknown = strings.filter((id) => !byId.has(id));
    if (unknown.length) problems.push({ flow: flow.id, problem: 'unknown', ids: unknown });
    dropped += unknown.length;
    const known = strings.filter((id) => byId.has(id)).map((id) => byId.get(id)).sort(compareEntries);
    if (known.length === 0) continue;
    const groups = [...new Set(known.map((e) => e.group ?? e.id))];
    if (groups.length > 1) problems.push({ flow: flow.id, problem: 'mixed-groups', ids: known.map((e) => e.id) });
    const group = known[0].group ?? known[0].id;
    const kept = known.filter((e) => (e.group ?? e.id) === group);
    dropped += known.length - kept.length;
    if (claimed.has(group)) {
      problems.push({ flow: flow.id, problem: 'shared-group', ids: kept.map((e) => e.id), with: claimed.get(group) });
      dropped += kept.length;
      continue;
    }
    claimed.set(group, flow.id);
    cited.set(flow.id, { ids: kept.map((e) => e.id), group, entries: kept });
  }
  return { problems, cited, dropped };
}

/** One stdout line per flow of a rejected area whose entry-point citation failed. */
export function citationLines(areaId, result) {
  if (!Array.isArray(result.citationProblems)) return [];
  return result.citationProblems.map((p) => `rejected-entry-point ${areaId} ${p.flow} problem=${p.problem} ids=${p.ids.map(String).join(',')}` +
    `${p.with ? ` cited-by=${p.with}` : ''}`);
}

/**
 * The script entry points of one area output that no flow cites (itself or
 * its group, after checkCitations' rules) and no skip declares (the id in
 * `skippedEntryPoints` with a reason, or its module in `skippedModules` with
 * a reason). Used by --check to show the analyzer what it left silent.
 */
export function uncoveredEntryPoints({ graph, entries = [], fileModule = new Map() }) {
  const { cited } = checkCitations({ graph, entries });
  const citedIds = new Set();
  const citedGroups = new Set();
  for (const c of cited.values()) { for (const id of c.ids) citedIds.add(id); citedGroups.add(c.group); }
  const skippedIds = new Set((Array.isArray(graph.skippedEntryPoints) ? graph.skippedEntryPoints : [])
    .filter((s) => isObject(s) && typeof s.id === 'string' && typeof s.reason === 'string' && s.reason.trim())
    .map((s) => s.id));
  const skippedModules = new Set((Array.isArray(graph.skippedModules) ? graph.skippedModules : [])
    .filter((s) => isObject(s) && typeof s.module === 'string' && typeof s.reason === 'string' && s.reason.trim())
    .map((s) => s.module));
  return entries.filter((e) => !citedIds.has(e.id) && !citedGroups.has(e.group ?? e.id)
    && !skippedIds.has(e.id) && !skippedModules.has(fileModule.get(e.file)));
}

/** Flow nodes and flow_step edges of one raw area output, read as mergeAreas reads them. */
function areaParts(graph) {
  const areaNodes = new Map();
  for (const raw of Array.isArray(graph.nodes) ? graph.nodes : []) {
    if (!isObject(raw) || typeof raw.id !== 'string' || raw.id.length === 0 || areaNodes.has(raw.id) || raw.type === 'domain') continue;
    areaNodes.set(raw.id, raw);
  }
  const areaStepEdges = (Array.isArray(graph.edges) ? graph.edges : [])
    .filter((e) => isObject(e) && e.type === 'flow_step' && areaNodes.has(e.source) && areaNodes.has(e.target));
  return { areaNodes, areaStepEdges };
}

/**
 * The module a flow starts in: the module of the file of the entry points it
 * cites (`cited`, from checkCitations), else the module of its first locatable step
 * (`flow_step` weight ascending, then edge order), else its
 * `domainMeta.module` when the flow's area holds it; null when neither.
 */
function homeModuleOf({ flow, areaId, areaNodes, areaStepEdges, fileModule, moduleAreas, nodeFiles, cited = new Map() }) {
  const anchor = cited.get(flow.id);
  const anchorFile = anchor ? relativeInsideRoot(anchor.entries[0]?.file) : null;
  if (anchorFile !== null && fileModule.has(anchorFile)) return { home: fileModule.get(anchorFile), by: 'entry-point' };
  const steps = areaStepEdges
    .map((edge, order) => ({ edge, order }))
    .filter(({ edge }) => edge.source === flow.id)
    .sort((a, b) => ((Number.isFinite(a.edge.weight) ? a.edge.weight : Infinity) - (Number.isFinite(b.edge.weight) ? b.edge.weight : Infinity)) || a.order - b.order);
  for (const { edge } of steps) {
    const step = areaNodes.get(edge.target);
    if (!step || step.type !== 'step') continue;
    const { file } = locateStep(step, fileModule, nodeFiles);
    if (file !== null) return { home: fileModule.get(file), by: 'step' };
  }
  const declared = flow.domainMeta?.module;
  if (typeof declared === 'string' && (moduleAreas.get(declared) ?? []).includes(areaId)) return { home: declared, by: 'declared' };
  return { home: null, by: null };
}

/** Whether the analyzer chooses the domain of flows starting in a module: mixed, or of a support domain. */
function choosesFor(plan) {
  const kindOf = new Map(plan.domains.map((d) => [d.id, d.kind]));
  const mixed = new Set(Array.isArray(plan.mixed) ? plan.mixed : []);
  return { kindOf, chooses: (module) => mixed.has(module) || kindOf.get(plan.modules[module]) === 'support' };
}

/**
 * The flows of one area output that start in a choose module without a
 * valid choice: `problem` is missing (no domainMeta.domain), invalid (not a
 * plan domain id; `chosen` keeps it) or no-reason (no domainMeta.domainReason).
 * `allowed` is every plan domain id, in plan order.
 */
export function checkChoices({ graph, areaId, plan, manifest, nodeFiles = new Map(), entries = [] }) {
  const { fileModule, moduleAreas } = moduleIndex(manifest);
  const { kindOf, chooses } = choosesFor(plan);
  const { areaNodes, areaStepEdges } = areaParts(graph);
  const { cited } = checkCitations({ graph, entries });
  const problems = [];
  for (const flow of areaNodes.values()) {
    if (flow.type !== 'flow') continue;
    const { home } = homeModuleOf({ flow, areaId, areaNodes, areaStepEdges, fileModule, moduleAreas, nodeFiles, cited });
    if (home === null || plan.modules[home] === undefined || !chooses(home)) continue;
    const chosen = flow.domainMeta?.domain;
    const reason = flow.domainMeta?.domainReason;
    if (chosen === undefined || chosen === null || chosen === '') problems.push({ flow: flow.id, module: home, problem: 'missing' });
    else if (typeof chosen !== 'string' || !kindOf.has(chosen)) problems.push({ flow: flow.id, module: home, problem: 'invalid', chosen });
    else if (typeof reason !== 'string' || reason.trim().length === 0) problems.push({ flow: flow.id, module: home, problem: 'no-reason' });
  }
  return { allowed: plan.domains.map((d) => d.id), problems };
}

/** One stdout line per flow of a `rejected-choice` area, naming the flow, its module and the allowed ids. */
export function choiceLines(areaId, result) {
  if (result.status !== 'rejected-choice' && result.status !== 'rejected-entry-point') return [];
  return [
    ...result.problems.map((p) => `rejected-choice ${areaId} ${p.flow} module=${p.module} problem=${p.problem}` +
      `${p.problem === 'invalid' ? ` chosen=${JSON.stringify(p.chosen)}` : ''} allowed=${result.allowed.join(',')}`),
    ...citationLines(areaId, result),
  ];
}

function unionInto(target, source) {
  const seen = new Set(target.map((v) => JSON.stringify(v)));
  for (const value of source) {
    const key = JSON.stringify(value);
    if (!seen.has(key)) { seen.add(key); target.push(value); }
  }
  return target;
}

/** module path -> its project files, file -> module path, module path -> area ids. */
function moduleIndex(manifest) {
  const fileModule = new Map();
  const moduleAreas = new Map();
  for (const module of manifest.modules) {
    for (const file of module.files) fileModule.set(file, module.path);
    moduleAreas.set(module.path, module.areas ?? []);
  }
  return { fileModule, moduleAreas };
}

/**
 * Where a step is: its `filePath` when that is a file of a module, else the
 * first of its `nodeIds` whose file is. state says why it is not located:
 * 'outside-root' (never placed, not even through node ids), 'outside-modules'
 * or 'absent'. Shared by homing and coverage.
 */
export function locateStep(node, fileModule, nodeFiles) {
  let state = 'absent';
  if (typeof node.filePath === 'string' && node.filePath.length > 0) {
    const rel = relativeInsideRoot(node.filePath);
    if (rel === null) state = 'outside-root';
    else if (fileModule.has(rel)) return { file: rel, state: 'located' };
    else state = 'outside-modules';
  }
  if (state !== 'outside-root' && Array.isArray(node.nodeIds)) {
    const file = node.nodeIds.map((id) => nodeFiles.get(id)).find((f) => f && fileModule.has(f));
    if (file) return { file, state: 'located' };
  }
  return { file: null, state };
}

function complexityOf(moduleCount) {
  return moduleCount <= 2 ? 'simple' : moduleCount <= 6 ? 'moderate' : 'complex';
}

function planDomainNode(domain, plan) {
  const modules = Object.keys(plan.modules).filter((path) => plan.modules[path] === domain.id).sort(compare);
  const interactions = (plan.crossDomain ?? []).filter((e) => e.source === domain.id).map((e) => e.description);
  return {
    id: domain.id,
    type: 'domain',
    name: domain.name,
    summary: domain.summary,
    tags: Array.isArray(domain.tags) ? [...domain.tags] : [],
    complexity: complexityOf(modules.length),
    domainMeta: {
      kind: domain.kind,
      modules,
      entities: Array.isArray(domain.entities) ? [...domain.entities] : [],
      businessRules: Array.isArray(domain.businessRules) ? [...domain.businessRules] : [],
      crossDomainInteractions: interactions,
    },
  };
}

/**
 * Merge accepted area graphs. `accepted` is [{areaId, graph}] in any order;
 * it is processed in area-id order. `plan` is the stored domain plan,
 * `manifest` the area manifest (modules, their files and areas), `nodeFiles`
 * maps knowledge-graph node ids to project files. Returns { graph, merge }.
 */
export function mergeAreas({ accepted, plan, manifest, nodeFiles = new Map(), entriesOf = new Map() }) {
  if (!isObject(plan) || !isObject(plan.modules) || !Array.isArray(plan.domains)) throw new Error('mergeAreas needs the stored domain plan');
  const { fileModule, moduleAreas } = moduleIndex(manifest);
  const ordered = [...accepted].sort((a, b) => compare(a.areaId, b.areaId));
  const merge = {
    idsRenamed: [],
    flowIdsDerived: [],
    renames: [],
    citationsDropped: 0,
    analyzerDomainsIgnored: 0,
    analyzerEdgesIgnored: 0,
    nodesWithoutId: 0,
    duplicateIdsInArea: 0,
    edgesDangling: 0,
    edgesSelfLoop: 0,
    edgesDuplicate: 0,
    flowHoming: {
      anchored: 0, unanchored: 0, homedByEntryPoint: 0, homedByStep: 0, homedByDeclared: 0, unplaced: 0, unplacedFlows: [], unplacedAreas: {},
      byModule: 0, byChoice: 0, fallbackMissing: 0, fallbackInvalid: 0, choicesIgnored: 0, choicesWithoutReason: 0, choices: [],
      support: { total: 0, chosen: 0, unchosen: 0, unchosenFlows: [] },
    },
  };
  const nodes = new Map();
  for (const domain of plan.domains) nodes.set(domain.id, planDomainNode(domain, plan));
  const edges = [];
  const homing = [];
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

    // A flow that cites fact entry points is named by the script from its
    // group's first entry point, whatever id the analyzer gave it.
    const { cited, dropped } = checkCitations({ graph, entries: entriesOf.get(areaId) ?? [] });
    merge.citationsDropped += dropped;
    const citedFinal = new Map();
    const rename = new Map();
    const seenHere = new Set();
    const areaNodes = new Map();
    for (const raw of Array.isArray(graph.nodes) ? graph.nodes : []) {
      if (!isObject(raw) || typeof raw.id !== 'string' || raw.id.length === 0) { merge.nodesWithoutId += 1; continue; }
      if (seenHere.has(raw.id)) { merge.duplicateIdsInArea += 1; continue; }
      seenHere.add(raw.id);
      if (raw.type === 'domain') { merge.analyzerDomainsIgnored += 1; continue; }
      const node = clone(raw);
      const anchor = raw.type === 'flow' ? cited.get(raw.id) : undefined;
      if (anchor) {
        node.id = `flow:${anchor.group.slice('ep:'.length)}`;
        node.domainMeta = {
          ...(isObject(node.domainMeta) ? node.domainMeta : {}),
          entryPointIds: anchor.ids,
          entryPoint: anchor.entries.map(entryPointText).join(', '),
          entryType: anchor.entries[0].type === 'ui' ? 'manual' : 'http',
        };
        if (node.id !== raw.id) merge.flowIdsDerived.push({ from: raw.id, to: node.id, areaId });
      } else if (raw.type === 'flow' && isObject(node.domainMeta) && 'entryPointIds' in node.domainMeta) {
        // A citation the merge did not follow is not shown on the graph.
        delete node.domainMeta.entryPointIds;
      }
      if (nodes.has(node.id)) {
        // The suffixed id may itself be taken (an area can hand in an id that
        // looks renamed); a numbered suffix keeps every node.
        let renamed = `${node.id}--${areaId}`;
        for (let n = 2; nodes.has(renamed); n++) renamed = `${node.id}--${areaId}-${n}`;
        merge.idsRenamed.push({ from: node.id, to: renamed, areaId });
        node.id = renamed;
      }
      if (node.id !== raw.id) {
        rename.set(raw.id, node.id);
        merge.renames.push({ from: raw.id, to: node.id, areaId });
      }
      if (anchor) citedFinal.set(node.id, anchor);
      nodes.set(node.id, node);
      areaNodes.set(node.id, node);
    }
    const areaStepEdges = [];
    for (const raw of Array.isArray(graph.edges) ? graph.edges : []) {
      if (!isObject(raw)) { merge.edgesDangling += 1; continue; }
      if (IGNORED_EDGE_TYPES.has(raw.type)) { merge.analyzerEdgesIgnored += 1; continue; }
      const edge = clone(raw);
      if (rename.has(edge.source)) edge.source = rename.get(edge.source);
      if (rename.has(edge.target)) edge.target = rename.get(edge.target);
      // An edge joins nodes of the area that wrote it; one that reaches
      // another area's node (or none) is dangling for this area.
      if (!areaNodes.has(edge.source) || !areaNodes.has(edge.target)) { merge.edgesDangling += 1; continue; }
      edges.push(edge);
      if (edge.type === 'flow_step') areaStepEdges.push(edge);
    }
    homing.push({ areaId, areaNodes, areaStepEdges, cited: citedFinal });
  }

  // Homing: contains_flow edges are made here, by rule, never taken from an analyzer.
  const { kindOf, chooses } = choosesFor(plan);
  const fh = merge.flowHoming;
  const homed = [];
  for (const { areaId, areaNodes, areaStepEdges, cited } of homing) {
    for (const flow of areaNodes.values()) {
      if (flow.type !== 'flow') continue;
      if (cited.has(flow.id)) fh.anchored += 1;
      else fh.unanchored += 1;
      const { home, by } = homeModuleOf({ flow, areaId, areaNodes, areaStepEdges, fileModule, moduleAreas, nodeFiles, cited });
      const moduleDomain = home === null ? null : plan.modules[home] ?? null;
      if (moduleDomain === null) {
        fh.unplaced += 1;
        fh.unplacedFlows.push(flow.id);
        fh.unplacedAreas[flow.id] = areaId;
        continue;
      }
      if (by === 'entry-point') fh.homedByEntryPoint += 1;
      else if (by === 'step') fh.homedByStep += 1;
      else fh.homedByDeclared += 1;

      const chosen = flow.domainMeta?.domain;
      let domainId = moduleDomain;
      let reasoned = false;
      const dropClaim = () => {
        if (isObject(flow.domainMeta)) { delete flow.domainMeta.domain; delete flow.domainMeta.domainReason; }
      };
      if (!chooses(home)) {
        fh.byModule += 1;
        if (chosen !== undefined) { fh.choicesIgnored += 1; dropClaim(); }
      } else {
        const row = { flow: flow.id, module: home, moduleDomain };
        if (typeof chosen === 'string' && kindOf.has(chosen)) {
          domainId = chosen;
          fh.byChoice += 1;
          Object.assign(row, { domain: chosen, by: 'choice' });
          const reason = flow.domainMeta?.domainReason;
          if (typeof reason === 'string' && reason.trim()) { row.reason = reason.trim(); reasoned = true; }
          else fh.choicesWithoutReason += 1;
        } else if (chosen === undefined || chosen === null || chosen === '') {
          fh.fallbackMissing += 1;
          Object.assign(row, { domain: moduleDomain, by: 'fallback', fallback: 'missing' });
        } else {
          fh.fallbackInvalid += 1;
          Object.assign(row, { domain: moduleDomain, by: 'fallback', fallback: 'invalid', chosen });
          dropClaim();
        }
        fh.choices.push(row);
      }
      if (kindOf.get(domainId) === 'support') {
        fh.support.total += 1;
        if (reasoned) fh.support.chosen += 1;
        else { fh.support.unchosen += 1; fh.support.unchosenFlows.push(flow.id); }
      }
      homed.push({ source: domainId, target: flow.id, type: 'contains_flow', direction: 'forward', weight: 1 });
    }
  }
  edges.push(...homed);
  for (const entry of plan.crossDomain ?? []) {
    edges.push({ source: entry.source, target: entry.target, type: 'cross_domain', direction: 'forward', description: entry.description, weight: 0.6 });
  }

  const kept = [];
  const seenEdges = new Set();
  for (const edge of edges) {
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

/**
 * Every accepted area's flow ids, step ids and flow_step edges (through that
 * area's renames) must be in `merged` exactly once, and nothing in `merged`
 * may lack an origin. What the merge discards on purpose (nodes without an
 * id, repeated ids in an area, edges with an end that is not a node of the
 * area, self loops) is counted by mergeAreas and not expected here.
 * `renames` is merge.idsRenamed.
 */
export function checkConservation({ accepted, merged, renames = [] }) {
  const renameOf = new Map();
  for (const { from, to, areaId } of renames) renameOf.set(`${areaId}|${from}`, to);
  // Counted, not collected: two areas ending with the same id is a loss,
  // because the merged graph can hold that id only once.
  const expected = { flow: new Map(), step: new Map(), edge: new Map() };
  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const { areaId, graph } of accepted) {
    const mapId = (id) => renameOf.get(`${areaId}|${id}`) ?? id;
    const own = new Set();
    for (const raw of Array.isArray(graph.nodes) ? graph.nodes : []) {
      if (!isObject(raw) || typeof raw.id !== 'string' || raw.id.length === 0 || own.has(raw.id) || raw.type === 'domain') continue;
      own.add(raw.id);
      if (raw.type === 'flow') bump(expected.flow, mapId(raw.id));
      else if (raw.type === 'step') bump(expected.step, mapId(raw.id));
    }
    // A repeated edge within one area is kept once by the merge (edgesDuplicate).
    const ownEdges = new Set();
    for (const raw of Array.isArray(graph.edges) ? graph.edges : []) {
      if (!isObject(raw) || raw.type !== 'flow_step' || !own.has(raw.source) || !own.has(raw.target) || raw.source === raw.target) continue;
      ownEdges.add(`${mapId(raw.source)}|${mapId(raw.target)}`);
    }
    for (const key of ownEdges) bump(expected.edge, key);
  }
  const nodes = Array.isArray(merged?.nodes) ? merged.nodes : [];
  const occurrences = (type) => {
    const counts = new Map();
    for (const n of nodes) if (isObject(n) && n.type === type) counts.set(n.id, (counts.get(n.id) ?? 0) + 1);
    return counts;
  };
  const out = {
    flow: occurrences('flow'),
    step: occurrences('step'),
    edge: new Map(),
  };
  for (const e of Array.isArray(merged?.edges) ? merged.edges : []) {
    if (isObject(e) && e.type === 'flow_step') out.edge.set(`${e.source}|${e.target}`, (out.edge.get(`${e.source}|${e.target}`) ?? 0) + 1);
  }
  const missing = [];
  const extra = [];
  const label = { flow: (k) => k, step: (k) => k, edge: (k) => `flow_step ${k}` };
  for (const kind of ['flow', 'step', 'edge']) {
    for (const [key, want] of [...expected[kind]].sort(([a], [b]) => compare(a, b))) {
      const have = out[kind].get(key) ?? 0;
      if (have < want) missing.push(want > 1 ? `${label[kind](key)} (given x${want}, kept x${have})` : label[kind](key));
      else if (have > want) extra.push(`${label[kind](key)} (x${have})`);
    }
    for (const key of [...out[kind].keys()].sort(compare)) {
      if (!expected[kind].has(key)) extra.push(label[kind](key));
    }
  }
  const total = (m) => [...m.values()].reduce((n, v) => n + v, 0);
  return {
    flowsIn: total(expected.flow),
    flowsOut: total(out.flow),
    stepsIn: total(expected.step),
    stepsOut: total(out.step),
    flowStepEdgesIn: total(expected.edge),
    flowStepEdgesOut: total(out.edge),
    missing,
    extra,
    ok: missing.length === 0 && extra.length === 0,
  };
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
export function computeCoverage({
  manifest, areaResults, merged, nodeFiles = new Map(), merge = null, plan = null, planStatus = null, conservation = null,
  modelEntryPoints = null, entriesOf = new Map(),
}) {
  const { fileModule } = moduleIndex(manifest);

  // Steps -> files.
  const steps = { total: 0, located: 0, unlocated: 0, fileOutsideRoot: 0, fileOutsideModules: 0 };
  const stepFile = new Map();
  for (const node of merged.nodes) {
    if (node.type !== 'step') continue;
    steps.total += 1;
    const { file, state } = locateStep(node, fileModule, nodeFiles);
    if (file !== null) { steps.located += 1; stepFile.set(node.id, file); continue; }
    if (state === 'outside-root') steps.fileOutsideRoot += 1;
    else if (state === 'outside-modules') steps.fileOutsideModules += 1;
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

  // Model entry points the merge accepted, by module.
  const modelEntries = (modelEntryPoints?.accepted ?? []).map((e) => ({ ...e, module: fileModule.get(e.file) ?? null }));
  const modelOfModule = new Map();
  for (const entry of modelEntries) modelOfModule.set(entry.module, (modelOfModule.get(entry.module) ?? 0) + 1);

  const buckets = Object.fromEntries(MODULE_BUCKETS.map((b) => [b, 0]));
  let skippedModulesWithoutCandidates = 0;
  const modules = manifest.modules.map((module) => {
    const flows = flowsOfModule.get(module.path)?.size ?? 0;
    const script = module.scriptEntryPoints ?? 0;
    const pattern = module.patternEntryPoints ?? 0;
    const model = modelOfModule.get(module.path) ?? 0;
    const unrecognised = module.unrecognisedFiles ?? 0;
    const candidates = script + pattern + model > 0 || unrecognised > 0;
    let status;
    if (flows > 0) status = 'covered';
    else if (!candidates) {
      // A skip declared for a module with nothing to skip does not change its bucket.
      status = 'no-candidates';
      if (declared.has(module.path)) skippedModulesWithoutCandidates += 1;
    } else if (declared.has(module.path)) status = 'declared-skip';
    else status = 'silent-zero';
    buckets[status] += 1;
    const row = {
      path: module.path, areas: module.areas, files: module.files.length,
      entryPoints: { script, pattern, model }, entryPointsTotal: module.entryPoints, unrecognisedFiles: unrecognised,
      flows, status,
    };
    if (plan) row.domain = plan.modules[module.path] ?? null;
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
    if (result.unchosen?.length) row.unchosen = result.unchosen;
    if (result.uncited?.length) row.uncited = result.uncited;
    return row;
  });

  const totals = countTypes(merged);
  const homing = merge?.flowHoming;
  const rejectedByReason = Object.fromEntries(MODEL_ENTRY_REJECTIONS.map((r) => [r, modelEntryPoints?.rejected?.[r] ?? 0]));
  const sumOf = (key) => manifest.modules.reduce((n, m) => n + (m[key] ?? 0), 0);
  return {
    format: COVERAGE_FORMAT,
    token: manifest.token,
    status: areas.every((a) => a.status === 'accepted') ? 'complete' : 'incomplete',
    totals,
    buckets,
    steps,
    entryPoints: {
      source: manifest.entryPointSource ?? null,
      script: sumOf('scriptEntryPoints'),
      pattern: sumOf('patternEntryPoints'),
      model: { accepted: modelEntries.length, rejected: rejectedByReason, entries: modelEntries },
    },
    candidateFiles: { total: candidates.length, cited: candidates.length - uncited.length, uncited },
    silentZeroParts: areas.reduce((n, a) => n + a.silentZeroParts.length, 0),
    split: manifest.counts ?? null,
    plan: plan
      ? {
        status: planStatus,
        moduleSetDigest: plan.moduleSetDigest,
        businessDomains: plan.domains.filter((d) => d.kind === 'business').length,
        supportDomains: plan.domains.filter((d) => d.kind === 'support').length,
      }
      : null,
    flows: {
      total: totals.flows,
      anchored: homing?.anchored ?? 0,
      unanchored: homing?.unanchored ?? 0,
      citationsDropped: merge?.citationsDropped ?? 0,
      homedByEntryPoint: homing?.homedByEntryPoint ?? 0,
      homedByStep: homing?.homedByStep ?? 0,
      homedByDeclared: homing?.homedByDeclared ?? 0,
      unplaced: homing?.unplaced ?? 0,
      byModule: homing?.byModule ?? 0,
      byChoice: homing?.byChoice ?? 0,
      fallback: { missing: homing?.fallbackMissing ?? 0, invalid: homing?.fallbackInvalid ?? 0 },
      choicesIgnored: homing?.choicesIgnored ?? 0,
      choicesWithoutReason: homing?.choicesWithoutReason ?? 0,
      support: homing?.support ?? { total: 0, chosen: 0, unchosen: 0, unchosenFlows: [] },
      choices: homing?.choices ?? [],
    },
    conservation,
    areas,
    modules,
    entryPointCoverage: entryPointCoverage({ manifest, areaResults, merged, entriesOf, declared, fileModule }),
    merge: { ...(merge ?? {}), skippedModulesUnknown, skippedModulesWithoutReason, skippedModulesWithoutCandidates },
  };
}

/**
 * One bucket per fact (script) entry point, in this order: area-not-accepted
 * (its area's output was not accepted), in-flow (a merged flow cites it, or
 * cites its group), declared-skip (its id is in its area's
 * skippedEntryPoints with a reason, or its module was declared skipped),
 * silent (none of these); outside-areas for the ids the split found in no
 * module. `ok` is false when the buckets do not add up to the distinct ids.
 */
function entryPointCoverage({ manifest, areaResults, merged, entriesOf, declared, fileModule }) {
  const citedBy = new Map();
  const groupCitedBy = new Map();
  for (const node of merged.nodes) {
    if (node.type !== 'flow' || !Array.isArray(node.domainMeta?.entryPointIds)) continue;
    for (const id of node.domainMeta.entryPointIds) if (!citedBy.has(id)) citedBy.set(id, node.id);
  }
  const statusOf = new Map(areaResults.map((r) => [r.areaId, r]));
  const buckets = Object.fromEntries(ENTRY_POINT_BUCKETS.map((b) => [b, 0]));
  const inFlowBy = { cited: 0, group: 0 };
  const declaredBy = { 'entry-point': 0, module: 0 };
  let skippedEntryPointsUnknown = 0;
  let skippedEntryPointsWithoutReason = 0;
  const rows = [];
  const silent = [];
  for (const { areaId } of manifest.areas) {
    const entries = entriesOf.get(areaId) ?? [];
    for (const e of entries) if (citedBy.has(e.id)) groupCitedBy.set(e.group ?? e.id, citedBy.get(e.id));
  }
  for (const { areaId } of manifest.areas) {
    const entries = entriesOf.get(areaId) ?? [];
    const result = statusOf.get(areaId) ?? { status: 'missing' };
    const known = new Set(entries.map((e) => e.id));
    const skipped = new Map();
    if (result.status === 'accepted') {
      for (const entry of Array.isArray(result.graph?.skippedEntryPoints) ? result.graph.skippedEntryPoints : []) {
        const id = isObject(entry) ? entry.id : undefined;
        const reason = isObject(entry) && typeof entry.reason === 'string' ? entry.reason.trim() : '';
        if (typeof id !== 'string' || !known.has(id)) { skippedEntryPointsUnknown += 1; continue; }
        if (reason.length === 0) { skippedEntryPointsWithoutReason += 1; continue; }
        if (!skipped.has(id)) skipped.set(id, reason);
      }
    }
    for (const e of entries) {
      const module = fileModule.get(relativeInsideRoot(e.file)) ?? null;
      const row = {
        id: e.id, method: e.method ?? null, path: e.path ?? e.pathText ?? null, type: e.type ?? null,
        file: e.file, module, areaId, group: e.group ?? e.id,
      };
      if (result.status !== 'accepted') row.bucket = 'area-not-accepted';
      else if (citedBy.has(e.id)) { row.bucket = 'in-flow'; row.flow = citedBy.get(e.id); inFlowBy.cited += 1; }
      else if (groupCitedBy.has(row.group)) { row.bucket = 'in-flow'; row.flow = groupCitedBy.get(row.group); inFlowBy.group += 1; }
      else if (skipped.has(e.id)) { row.bucket = 'declared-skip'; row.reason = skipped.get(e.id); declaredBy['entry-point'] += 1; }
      else if (module !== null && declared.has(module)) { row.bucket = 'declared-skip'; row.reason = declared.get(module); declaredBy.module += 1; }
      else { row.bucket = 'silent'; silent.push(e.id); }
      buckets[row.bucket] += 1;
      rows.push(row);
    }
  }
  for (const id of manifest.entryPointsOutsideModules ?? []) {
    rows.push({ id, bucket: 'outside-areas' });
    buckets['outside-areas'] += 1;
  }
  const total = new Set(rows.map((r) => r.id)).size;
  const sum = Object.values(buckets).reduce((n, v) => n + v, 0);
  return {
    total, buckets, ok: sum === total && rows.length === total,
    inFlowBy, declaredBy, skippedEntryPointsUnknown, skippedEntryPointsWithoutReason,
    silent, rows,
  };
}

/**
 * The stdout lines on how flow domains were decided: one count line, then one
 * line per flow of a choose module that has no valid choice with a reason,
 * written `support-unchosen` when it ended in a support domain, else
 * `fallback`. The reason is missing, invalid or no-reason.
 */
export function homingLines(coverage) {
  const f = coverage.flows;
  const lines = [
    `flows domain module=${f.byModule} choice=${f.byChoice} fallback=${f.fallback.missing + f.fallback.invalid} ` +
    `choices-ignored=${f.choicesIgnored} choices-without-reason=${f.choicesWithoutReason} ` +
    `support=${f.support.total} support-chosen=${f.support.chosen} support-unchosen=${f.support.unchosen}`,
  ];
  const unchosen = new Set(f.support.unchosenFlows);
  for (const row of f.choices) {
    if (row.by === 'choice' && row.reason !== undefined) continue;
    const reason = row.by === 'fallback' ? row.fallback : 'no-reason';
    if (row.by === 'choice' && !unchosen.has(row.flow)) continue;
    lines.push(`${unchosen.has(row.flow) ? 'support-unchosen' : 'fallback'} ${row.flow} module=${row.module} reason=${reason}`);
  }
  return lines;
}

const USAGE = 'Usage: node merge-domain-areas.mjs <projectRoot> [--out <path>] [--coverage <path>] [--accept-unchosen]\n' +
  '       node merge-domain-areas.mjs <projectRoot> --check <areaId>';

function parseArgs(argv) {
  const args = { projectRoot: null, out: null, coverage: null, check: null, acceptUnchosen: false };
  const flags = { '--out': 'out', '--coverage': 'coverage', '--check': 'check' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--accept-unchosen') { args.acceptUnchosen = true; continue; }
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
    throw new Error(USAGE);
  }
  if (args.check !== null && (args.out || args.coverage || args.acceptUnchosen)) {
    throw new Error('merge-domain-areas: --check takes no other option');
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

/** The stored plan, which must cover exactly the manifest's modules. */
function loadPlan(dataDir, manifest) {
  const planPath = join(dataDir, 'domain-plan.json');
  const hint = 'run plan-domains.mjs prepare, dispatch the planner if it asks for one, then plan-domains.mjs accept';
  const text = readOrNull(planPath);
  if (text === null) throw new Error(`merge-domain-areas: no domain plan at ${planPath}; ${hint}`);
  let plan;
  try {
    plan = JSON.parse(text);
  } catch (error) {
    throw new Error(`merge-domain-areas: unreadable domain plan ${planPath} (${error.message}); ${hint}`);
  }
  if (!isObject(plan) || !isObject(plan.modules) || !Array.isArray(plan.domains) || !Array.isArray(plan.mixed)) {
    throw new Error(`merge-domain-areas: malformed domain plan ${planPath}; ${hint}`);
  }
  const planned = new Set(Object.keys(plan.modules));
  const current = new Set(manifest.modules.map((m) => m.path));
  const onlyManifest = [...current].filter((p) => !planned.has(p)).sort(compare);
  const onlyPlan = [...planned].filter((p) => !current.has(p)).sort(compare);
  if (onlyManifest.length || onlyPlan.length) {
    const some = (list) => list.slice(0, 5).join(', ') + (list.length > 5 ? ` (+${list.length - 5} more)` : '');
    throw new Error(
      `merge-domain-areas: the domain plan's modules differ from this run's modules; ${hint}` +
      `${onlyManifest.length ? `\n  not in the plan: ${some(onlyManifest)}` : ''}` +
      `${onlyPlan.length ? `\n  not in this run: ${some(onlyPlan)}` : ''}`,
    );
  }
  return plan;
}

function loadManifest(areasDir) {
  const manifestPath = join(areasDir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`merge-domain-areas: no area manifest at ${manifestPath}; run split-domain-areas.mjs first`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  for (const { areaId } of manifest.areas) {
    if (!AREA_ID.test(areaId)) throw new Error(`merge-domain-areas: malformed area id ${JSON.stringify(areaId)} in the manifest`);
  }
  return manifest;
}

/**
 * What the merge reads from the area contexts: knowledge-graph node id ->
 * project file (from every context's graph nodes), area id -> the project
 * files its context lists as unrecognised, and area id -> its script entry
 * points (those with an `id`).
 */
function loadAreaContexts(areasDir, manifest) {
  const nodeFiles = new Map();
  const unrecognisedOf = new Map();
  const entriesOf = new Map();
  for (const { areaId } of manifest.areas) {
    const contextText = readOrNull(join(areasDir, `${areaId}.context.json`));
    if (contextText === null) continue;
    const areaContext = JSON.parse(contextText);
    entriesOf.set(areaId, (areaContext.entryPoints ?? []).filter((e) => e?.source === 'script' && typeof e.id === 'string'));
    unrecognisedOf.set(areaId, (areaContext.unrecognisedFiles ?? []).map((u) => relativeInsideRoot(u?.file)).filter((f) => f !== null));
    for (const node of areaContext.graphNodes ?? []) {
      const file = relativeInsideRoot(node?.filePath);
      if (typeof node?.id === 'string' && file !== null) nodeFiles.set(node.id, file);
    }
  }
  return { nodeFiles, unrecognisedOf, entriesOf };
}

/**
 * The acceptance of one area, as the merge would decide it, without writing
 * anything: prints `<areaId> accepted` or the status, its reason and one
 * `rejected-choice` line per flow. Returns { exitCode } (0 or 3).
 */
export async function runCheck({ projectRoot, areaId, stdout = (t) => process.stdout.write(t) }) {
  const root = resolve(projectRoot);
  const dataDir = await resolveDataDir(root);
  const areasDir = join(dataDir, 'intermediate', AREAS_DIR);
  const manifest = loadManifest(areasDir);
  if (!manifest.areas.some((a) => a.areaId === areaId)) throw new Error(`merge-domain-areas: no area ${JSON.stringify(areaId)} in the manifest`);
  const plan = loadPlan(dataDir, manifest);
  const { nodeFiles, entriesOf } = loadAreaContexts(areasDir, manifest);
  const entries = entriesOf.get(areaId) ?? [];
  const result = acceptOutput({
    token: manifest.token, areaId, text: readOrNull(join(areasDir, `${areaId}.analysis.json`)),
    choice: { plan, manifest, nodeFiles, entries },
  });
  const lines = [`${areaId} ${result.status}${result.status === 'accepted' || !result.reason ? '' : ` (${result.reason})`}`, ...choiceLines(areaId, result)];
  // Not a rejection: entry points with neither a flow nor a skip are shown so
  // the analyzer can account for them before it returns.
  if (result.graph) {
    const { fileModule } = moduleIndex(manifest);
    for (const e of uncoveredEntryPoints({ graph: result.graph, entries, fileModule })) {
      lines.push(`uncovered-entry-point ${areaId} ${e.id} ${entryPointText(e)}`);
    }
  }
  stdout(`${lines.join('\n')}\n`);
  return { exitCode: result.status === 'accepted' ? 0 : EXIT_INCOMPLETE };
}

/**
 * The whole merge for one project. `mergeFn` is injectable so the not-conserved
 * path can be exercised with a lossy merge; `stdout`/`stderr` receive text.
 * Returns { exitCode }.
 */
export async function runMerge({
  projectRoot, out = null, coverage: coverageOut = null, mergeFn = mergeAreas, acceptUnchosen = false,
  stdout = (t) => process.stdout.write(t), stderr = (t) => process.stderr.write(t),
}) {
  const root = resolve(projectRoot);
  const dataDir = await resolveDataDir(root);
  const intermediate = join(dataDir, 'intermediate');
  const areasDir = join(intermediate, AREAS_DIR);
  const manifest = loadManifest(areasDir);
  const plan = loadPlan(dataDir, manifest);
  const planStatus = existsSync(join(areasDir, 'plan.input.json'))
    ? (JSON.parse(readFileSync(join(areasDir, 'plan.input.json'), 'utf-8')).mode ?? 'reused')
    : 'reused';

  // Area files are found from the area id, never from a path the manifest carries.
  const { nodeFiles, unrecognisedOf, entriesOf } = loadAreaContexts(areasDir, manifest);
  const areaResults = manifest.areas.map(({ areaId }) => ({
    areaId,
    ...acceptOutput({
      token: manifest.token, areaId, text: readOrNull(join(areasDir, `${areaId}.analysis.json`)),
      choice: { plan, manifest, nodeFiles, entries: entriesOf.get(areaId) ?? [] }, allowUnchosen: acceptUnchosen,
    }),
  }));

  const accepted = areaResults.filter((r) => r.status === 'accepted').map(({ areaId, graph }) => ({ areaId, graph }));
  const { graph, merge } = mergeFn({ accepted, plan, manifest, nodeFiles, entriesOf });
  const conservation = checkConservation({ accepted, merged: graph, renames: merge.renames ?? merge.idsRenamed });
  const modelEntryPoints = { accepted: [], rejected: Object.fromEntries(MODEL_ENTRY_REJECTIONS.map((r) => [r, 0])) };
  const lineCache = new Map();
  const readLines = (file) => {
    if (!lineCache.has(file)) lineCache.set(file, readProjectLines(root, file));
    return lineCache.get(file);
  };
  for (const { areaId, graph: areaGraph } of accepted) {
    const checked = checkModelEntryPoints({ entries: areaGraph.entryPoints, unrecognisedFiles: unrecognisedOf.get(areaId) ?? [], readLines });
    modelEntryPoints.accepted.push(...checked.accepted);
    for (const [reason, n] of Object.entries(checked.rejected)) modelEntryPoints.rejected[reason] += n;
  }
  const coverage = computeCoverage({ manifest, areaResults, merged: graph, nodeFiles, merge, plan, planStatus, conservation, modelEntryPoints, entriesOf });
  const epc = coverage.entryPointCoverage;
  const conserved = conservation.ok && epc.ok;

  const outPath = resolve(out ?? join(intermediate, 'domain-analysis.json'));
  // A failed check leaves no merged graph behind, not even an earlier merge's.
  if (conserved) writeJson(outPath, graph);
  else rmSync(outPath, { force: true });
  const coveragePath = resolve(coverageOut ?? join(dataDir, 'reports', 'domain-coverage.json'));
  writeJson(coveragePath, coverage);

  const lines = [];
  for (const area of coverage.areas) {
    lines.push(
      `${area.areaId} ${area.status}${area.reason ? ` (${area.reason})` : ''} domains=${area.domains} flows=${area.flows} ` +
      `steps=${area.steps} modules=${area.modules.length} silent-zero=${area.silentZeroModules.length}` +
      `${area.silentZeroParts.length ? ` silent-zero-parts=${area.silentZeroParts.length}` : ''}` +
      `${area.unchosen ? ` unchosen=${area.unchosen.length}` : ''}` +
      `${area.uncited ? ` uncited=${area.uncited.length}` : ''}`,
    );
  }
  for (const result of areaResults) lines.push(...choiceLines(result.areaId, result));
  const b = coverage.buckets;
  lines.push(
    `modules=${coverage.modules.length} covered=${b.covered} declared-skip=${b['declared-skip']} ` +
    `silent-zero=${b['silent-zero']} no-candidates=${b['no-candidates']}`,
  );
  const ep = coverage.entryPoints;
  const modelRejected = Object.values(ep.model.rejected).reduce((n, v) => n + v, 0);
  lines.push(
    `entry-points source=${ep.source ?? 'unknown'} script=${ep.script} pattern=${ep.pattern} model=${ep.model.accepted} model-rejected=${modelRejected}`,
  );
  lines.push(`candidate files cited=${coverage.candidateFiles.cited}/${coverage.candidateFiles.total}`);
  lines.push(`totals domains=${coverage.totals.domains} flows=${coverage.totals.flows} steps=${coverage.totals.steps}`);
  lines.push(`plan status=${coverage.plan.status} business=${coverage.plan.businessDomains} support=${coverage.plan.supportDomains}`);
  lines.push(`flows anchored=${coverage.flows.anchored} unanchored=${coverage.flows.unanchored} citations-dropped=${coverage.flows.citationsDropped}`);
  lines.push(`flows homed entry-point=${coverage.flows.homedByEntryPoint} step=${coverage.flows.homedByStep} declared=${coverage.flows.homedByDeclared} unplaced=${coverage.flows.unplaced}`);
  for (const id of merge.flowHoming.unplacedFlows) lines.push(`unplaced ${id} area=${merge.flowHoming.unplacedAreas[id]}`);
  lines.push(...homingLines(coverage));
  lines.push(
    `entry-point coverage total=${epc.total} ${ENTRY_POINT_BUCKETS.map((b) => `${b}=${epc.buckets[b]}`).join(' ')}` +
    ` in-flow-by-group=${epc.inFlowBy.group} declared-by-module=${epc.declaredBy.module}`,
  );
  for (const row of epc.rows.filter((r) => r.bucket === 'silent')) {
    lines.push(`silent-entry-point ${row.id} ${entryPointText(row)} area=${row.areaId}`);
  }
  lines.push(conserved
    ? 'conservation ok'
    : `conservation FAILED missing=${conservation.missing.length} extra=${conservation.extra.length}${epc.ok ? '' : ' entry-point-buckets'}`);
  for (const module of coverage.modules.filter((m) => m.status === 'silent-zero')) {
    lines.push(`silent-zero ${module.path} entryPoints=${module.entryPointsTotal} unrecognised=${module.unrecognisedFiles} areas=${module.areas.join(',')}`);
  }
  for (const area of coverage.areas) {
    for (const { path, part } of area.silentZeroParts) lines.push(`silent-zero-part ${path} part=${part.index}/${part.of} area=${area.areaId}`);
  }
  lines.push(`coverage report: ${coveragePath}`);
  stdout(`${lines.join('\n')}\n`);

  if (!conserved) {
    const detail = [...conservation.missing.map((m) => `missing ${m}`), ...conservation.extra.map((e) => `extra ${e}`)];
    if (!epc.ok) detail.push(`entry-point buckets add up to ${Object.values(epc.buckets).reduce((n, v) => n + v, 0)}, not ${epc.total} distinct entry points`);
    stderr(`merge-domain-areas: merge did not conserve flows, steps and flow_step edges; domain-analysis.json not written\n${detail.join('\n')}\n`);
    return { exitCode: EXIT_NOT_CONSERVED };
  }
  if (coverage.status !== 'complete') {
    const bad = coverage.areas.filter((a) => a.status !== 'accepted').map((a) => `${a.areaId}=${a.status}`);
    stderr(`merge-domain-areas: areas not accepted: ${bad.join(' ')}\n`);
    return { exitCode: EXIT_INCOMPLETE };
  }
  return { exitCode: 0 };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { exitCode } = args.check !== null
    ? await runCheck({ projectRoot: args.projectRoot, areaId: args.check })
    : await runMerge({ projectRoot: args.projectRoot, out: args.out, coverage: args.coverage, acceptUnchosen: args.acceptUnchosen });
  if (exitCode !== 0) process.exitCode = exitCode;
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

export default {
  acceptOutput, checkChoices, choiceLines, mergeAreas, checkConservation, computeCoverage, homingLines, locateStep, runMerge, runCheck, MODULE_BUCKETS,
};
