/**
 * index.json of a PRD run (openspec change prd-feature-pipeline, design D2):
 * the schema, the candidate conservation, every candidate's file and line and
 * the seed files inside the project given with --project. `check-index` prints one reason per line, prefixed by
 * its subject (a candidate id, a feature id, `unassigned` or `index`), and
 * writes the conservation it computed, and the per-feature defaults, back.
 */

import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { KINDS } from './entrypoints.mjs';
import { UsageError } from './errors.mjs';
import { isCount, isObject, isString, isStringArray, readJson, writeJson } from './json-file.mjs';
import { projectFiles } from './project-files.mjs';
import { projectRootProblem } from './project-root.mjs';

export const INDEX_FILE = 'index.json';
export const INDEX_FORMAT = 'excavator-prd-report/1';
export const FEATURE_ID = /^F[1-9]\d*$/;
export const FEATURE_KINDS = Object.freeze(['flow', 'automated']);
export const TIERS = Object.freeze(['frontend', 'backend']);
export const STATUSES = Object.freeze(['planned', 'written', 'checked', 'verified', 'failed']);
export const FAILURE_STEPS = Object.freeze(['lane', 'check-lane', 'verify']);
export const VERIFICATION_KEYS = Object.freeze([
  'verified', 'contradicted', 'misattributed', 'unverifiable',
  'resolvedRight', 'resolvedWrong', 'stillOpen', 'conflicts', 'notChecked',
]);
/** The levels of a finding's priority, and the bucket of the findings with none (see priorities.mjs). */
export const PRIORITY_LEVELS = Object.freeze(['P0', 'P1', 'P2']);
export const UNRANKED = 'unranked';
export const PROVENANCES = Object.freeze(['pattern', 'inferred']);
export const MAX_ATTEMPTS = 2;

export const emptyCounts = () => ({ diagrams: 0, evidence: 0, findings: { product: 0, technical: 0 }, verification: null });

/** Read `<out>/index.json`: a missing directory or file is a usage error; a file that is not JSON is a check failure. */
export function loadIndex(outDir) {
  if (!existsSync(outDir) || !statSync(outDir).isDirectory()) throw new UsageError(`out directory ${outDir} does not exist`);
  const read = readJson(join(outDir, INDEX_FILE));
  if (read.missing) throw new UsageError(`${join(outDir, INDEX_FILE)} does not exist`);
  return read;
}

function countsProblems(counts) {
  if (!isObject(counts)) return ['counts is not an object'];
  const problems = [];
  if (!isCount(counts.diagrams)) problems.push('counts.diagrams is not a count');
  if (!isCount(counts.evidence)) problems.push('counts.evidence is not a count');
  if (!isObject(counts.findings) || !isCount(counts.findings.product) || !isCount(counts.findings.technical)) {
    problems.push('counts.findings is not { product, technical }');
  } else if (counts.findings.priority !== undefined) {
    // Optional: an index.json from before priorities has none, and aggregate always writes it.
    const levels = [...PRIORITY_LEVELS, UNRANKED];
    if (!isObject(counts.findings.priority) || !levels.every((level) => isCount(counts.findings.priority[level]))) {
      problems.push(`counts.findings.priority is not { ${levels.join(', ')} }`);
    }
  }
  if (counts.verification !== null && counts.verification !== undefined) {
    if (!isObject(counts.verification) || !VERIFICATION_KEYS.every((key) => isCount(counts.verification[key]))) {
      problems.push(`counts.verification is not null or { ${VERIFICATION_KEYS.join(', ')} }`);
    }
  }
  return problems;
}

/** Schema problems of the index, each `<subject>: <problem>`. Pure. */
export function schemaProblems(index) {
  const problems = [];
  const add = (subject, problem) => problems.push(`${subject}: ${problem}`);
  if (!isObject(index)) return ['index: index.json is not an object'];

  if (index.format !== INDEX_FORMAT) add('index', `format is ${JSON.stringify(index.format)}, not "${INDEX_FORMAT}"`);
  if (!isString(index.projectRoot) || !isAbsolute(index.projectRoot)) add('index', 'projectRoot is not an absolute path');
  else if (!existsSync(index.projectRoot) || !statSync(index.projectRoot).isDirectory()) add('index', `projectRoot ${index.projectRoot} is not a directory`);
  if (!isString(index.sourceRevision)) add('index', 'sourceRevision is not a string');
  if (index.factsDigest !== null && typeof index.factsDigest !== 'string') add('index', 'factsDigest is not a string or null');
  for (const key of ['language', 'role']) if (!isString(index[key])) add('index', `${key} is not a string`);
  if (index.scope !== null && !isString(index.scope)) add('index', 'scope is not a string or null');
  if (!isStringArray(index.frameworks)) add('index', 'frameworks is not a list of names');
  if (!isStringArray(index.unassigned)) add('index', 'unassigned is not a list of candidate ids');
  if (!Array.isArray(index.glossary) || !index.glossary.every((entry) => isObject(entry) && isString(entry.term) && isString(entry.meaning))) {
    add('index', 'glossary is not a list of { term, meaning }');
  }
  if (!isStringArray(index.residualAssumptions)) add('index', 'residualAssumptions is not a list of strings');

  const candidates = index.candidates;
  if (!isObject(candidates)) {
    add('index', 'candidates is not { byFramework, uncovered, items }');
  } else {
    if (!isObject(candidates.byFramework) || !Object.values(candidates.byFramework).every(isCount)) add('index', 'candidates.byFramework is not { <framework>: <count> }');
    if (!isStringArray(candidates.uncovered)) add('index', 'candidates.uncovered is not a list of frameworks');
    if (!Array.isArray(candidates.items)) {
      add('index', 'candidates.items is not a list');
    } else {
      const seen = new Set();
      candidates.items.forEach((item, at) => {
        const subject = isObject(item) && isString(item.id) ? item.id : `candidates.items[${at}]`;
        if (!isObject(item) || !isString(item.id)) return add(subject, 'has no id');
        if (seen.has(item.id)) add(subject, 'the candidate id repeats');
        seen.add(item.id);
        if (!KINDS.includes(item.kind)) add(subject, `kind ${JSON.stringify(item.kind)} is not one of ${KINDS.join(', ')}`);
        if (!isString(item.file)) add(subject, 'file is not a path');
        if (!Number.isInteger(item.line) || item.line < 1) add(subject, 'line is not a line number');
        if (typeof item.text !== 'string') add(subject, 'text is not a string');
        if (!isString(item.framework)) add(subject, 'framework is not a name');
        if (item.provenance !== undefined && !PROVENANCES.includes(item.provenance)) {
          add(subject, `provenance ${JSON.stringify(item.provenance)} is not ${PROVENANCES.join(' or ')}`);
        }
      });
    }
  }

  if (!Array.isArray(index.features)) {
    add('index', 'features is not a list');
  } else {
    const seen = new Set();
    index.features.forEach((feature, at) => {
      const subject = isObject(feature) && isString(feature.id) ? feature.id : `features[${at}]`;
      if (!isObject(feature)) return add(subject, 'is not an object');
      if (!isString(feature.id) || !FEATURE_ID.test(feature.id)) add(subject, `id ${JSON.stringify(feature.id)} is not F<n>`);
      else if (seen.has(feature.id)) add(subject, 'the feature id repeats');
      seen.add(feature.id);
      if (!isString(feature.name)) add(subject, 'name is not a string');
      if (!FEATURE_KINDS.includes(feature.kind)) add(subject, `kind ${JSON.stringify(feature.kind)} is not flow or automated`);
      if (!Number.isInteger(feature.chapter) || feature.chapter < 1) add(subject, 'chapter is not a positive whole number');
      if (!isStringArray(feature.entrypoints)) add(subject, 'entrypoints is not a list of candidate ids');
      if (!isStringArray(feature.seedFiles) || feature.seedFiles.length === 0) add(subject, 'seedFiles is not a non-empty list of paths');
      if (!Array.isArray(feature.tiers) || feature.tiers.length === 0 || !feature.tiers.every((tier) => TIERS.includes(tier))) {
        add(subject, `tiers is not a non-empty list of ${TIERS.join(' and ')}`);
      }
      if (feature.status !== undefined && !STATUSES.includes(feature.status)) add(subject, `status ${JSON.stringify(feature.status)} is not one of ${STATUSES.join(', ')}`);
      if (feature.attempts !== undefined && !(Number.isInteger(feature.attempts) && feature.attempts >= 0 && feature.attempts <= MAX_ATTEMPTS)) {
        add(subject, `attempts is not 0 to ${MAX_ATTEMPTS}`);
      }
      if (feature.failure !== undefined && feature.failure !== null) {
        if (!isObject(feature.failure) || !FAILURE_STEPS.includes(feature.failure.step) || !isStringArray(feature.failure.reasons)) {
          add(subject, `failure is not null or { step: ${FAILURE_STEPS.join('|')}, reasons }`);
        }
      }
      if (feature.counts !== undefined) for (const problem of countsProblems(feature.counts)) add(subject, problem);
    });
  }
  return problems;
}

/**
 * The conservation of candidates over features and `unassigned`, with the
 * set differences as problems. Needs the lists schemaProblems checks.
 */
export function conservation(index) {
  const problems = [];
  const items = Array.isArray(index.candidates?.items) ? index.candidates.items.filter((item) => isObject(item) && isString(item.id)) : [];
  const ids = new Set(items.map((item) => item.id));
  const owners = new Map();
  for (const feature of Array.isArray(index.features) ? index.features : []) {
    if (!isObject(feature) || !isStringArray(feature.entrypoints)) continue;
    for (const id of new Set(feature.entrypoints)) {
      if (!ids.has(id)) {
        problems.push(`${feature.id}: entrypoint ${id} is not a candidate`);
        continue;
      }
      owners.set(id, [...(owners.get(id) ?? []), feature.id]);
    }
  }
  const unassigned = new Set();
  for (const id of isStringArray(index.unassigned) ? index.unassigned : []) {
    if (!ids.has(id)) problems.push(`unassigned: ${id} is not a candidate`);
    else unassigned.add(id);
  }
  for (const id of ids) {
    const features = owners.get(id) ?? [];
    if (features.length > 1) problems.push(`${id}: in more than one feature: ${features.join(', ')}`);
    if (features.length > 0 && unassigned.has(id)) problems.push(`${id}: in feature ${features.join(', ')} and in unassigned`);
    if (features.length === 0 && !unassigned.has(id)) problems.push(`${id}: in no feature and not in unassigned`);
  }
  const summary = {
    candidates: ids.size,
    assigned: owners.size,
    unassigned: unassigned.size,
    holds: problems.length === 0 && owners.size + unassigned.size === ids.size,
  };
  return { problems, summary };
}

/**
 * Every candidate, listed by the script or inferred, names a file and line
 * that exist (the model copies the candidates into index.json); seed files
 * stay inside the project. `root` is the --project root.
 */
export function fileProblems(index, root) {
  const problems = [];
  const files = projectFiles(root);
  for (const item of index.candidates.items) {
    const file = files.resolve(item.file);
    if (!file.ok) problems.push(`${item.id}: ${item.file} ${file.reason}`);
    else if (item.line > file.lines) problems.push(`${item.id}: line ${item.line} is past the end of ${item.file} (${file.lines} lines)`);
  }
  for (const feature of index.features) {
    for (const path of feature.seedFiles) {
      const file = files.resolve(path);
      if (!file.ok) problems.push(`${feature.id}: seed file ${path} ${file.reason}`);
    }
  }
  return problems;
}

export const ENTRYPOINTS_FILE = 'entrypoints.json';
/** The fields a candidate the script listed keeps exactly as `prd.mjs entrypoints` wrote them. */
const SCRIPT_FIELDS = Object.freeze(['kind', 'file', 'line', 'text', 'framework']);

/**
 * A candidate without provenance `inferred` claims the script listed it: it
 * must be the item of the same id in `<out>/entrypoints.json`, which Phase 1
 * writes with `prd.mjs entrypoints`, in every field. An inferred candidate
 * is the model's and only needs its file and line (fileProblems).
 */
export function scriptProblems(index, outDir) {
  const listed = index.candidates.items.filter((item) => item.provenance !== 'inferred');
  if (listed.length === 0) return [];
  const read = readJson(join(outDir, ENTRYPOINTS_FILE));
  if (read.missing) {
    return [`index: ${ENTRYPOINTS_FILE} is missing; write it with prd.mjs entrypoints (Phase 1): every candidate without provenance "inferred" must be one of its items`];
  }
  if (!read.ok) return [`index: ${ENTRYPOINTS_FILE} ${read.reason}`];
  if (!isObject(read.value) || !Array.isArray(read.value.items)) return [`index: ${ENTRYPOINTS_FILE} has no items list`];
  const byId = new Map(read.value.items.filter(isObject).map((item) => [item.id, item]));
  const problems = [];
  for (const item of listed) {
    const script = byId.get(item.id);
    if (!script) {
      problems.push(`${item.id}: is not in ${ENTRYPOINTS_FILE}; a candidate the script did not list has provenance "inferred"`);
      continue;
    }
    const differs = SCRIPT_FIELDS.filter((field) => item[field] !== script[field]);
    if (differs.length > 0) problems.push(`${item.id}: differs from ${ENTRYPOINTS_FILE} in ${differs.join(', ')}; copy a listed candidate unchanged`);
  }
  return problems;
}

/** Fill the per-feature fields a fresh plan leaves out. */
function withDefaults(feature) {
  return {
    ...feature,
    status: feature.status ?? 'planned',
    attempts: feature.attempts ?? 0,
    failure: feature.failure ?? null,
    counts: feature.counts ?? emptyCounts(),
  };
}

/**
 * Run check-index on `<out>`. Returns { status, lines }; writes the computed
 * conservation and the defaults back when the schema holds.
 */
export function checkIndex(outDir, root) {
  const read = loadIndex(outDir);
  if (!read.ok) return { status: 1, lines: [`index: ${INDEX_FILE} ${read.reason}`] };
  const index = read.value;
  const schema = schemaProblems(index);
  if (schema.length > 0) {
    return { status: 1, lines: [...schema, ...(isObject(index) ? conservation(index).problems : [])] };
  }
  const rootProblem = projectRootProblem(index, root);
  if (rootProblem !== null) return { status: 1, lines: [rootProblem] };
  const { problems, summary } = conservation(index);
  const files = fileProblems(index, root);
  const script = scriptProblems(index, outDir);
  writeJson(join(outDir, INDEX_FILE), { ...index, features: index.features.map(withDefaults), conservation: summary });
  const all = [...problems, ...files, ...script];
  if (all.length > 0) return { status: 1, lines: all };
  return {
    status: 0,
    lines: [`index: ok, ${summary.candidates} candidates (${summary.assigned} assigned, ${summary.unassigned} unassigned), ${index.features.length} features`],
  };
}
