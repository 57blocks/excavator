#!/usr/bin/env node
/**
 * plan-domains.mjs
 *
 * Decides the project's domain partition (module -> domain) once, and reuses
 * it. Area analyzers used to name their own domains, so the domain count grew
 * with the area count and the partition drifted between runs. Now one planner
 * model call sees every module of the project and assigns each to a domain;
 * the result is stored in `<dataDir>/domain-plan.json` and reused whenever the
 * set of module directories is unchanged, so a repeat run cannot drift.
 *
 * This script never writes a domain name, summary or assignment. It builds the
 * planner's input from source facts (same project, same bytes), checks the
 * planner's output, reconciles with the stored plan, and writes the accepted
 * plan. Everything about domains that needs judgment stays with the planner.
 *
 * Modes (decided by `prepare`):
 *   new     no usable stored plan, or --replan: every module is planned.
 *   extend  the stored plan lost no coverage but the project gained module
 *           directories: only the new ones are planned; existing assignments
 *           and domains are carried over verbatim, and the planner cannot
 *           change them (an assignment for an already-assigned module is a
 *           rejection reason).
 *   reused  the module set is unchanged, or only shrank: the stored plan is
 *           pruned (removed modules dropped, domains left empty dropped with
 *           the cross-domain entries that touch them) and used as is.
 *
 * Acceptance. `accept` rejects the whole output (exit 3) when any check fails
 * and lists every reason: stale token, malformed domain (id shape, kind,
 * name, summary), assignments that are not exactly the modules to plan,
 * assignment to an undeclared domain, a new domain holding no module, more
 * business domains than max(3, ceil(sqrt(modules))) or more than 3 support
 * domains. Cross-domain entries that are not between two plan domains, are
 * self loops, or have no description are dropped and counted, not rejected.
 * A rejected output leaves domain-plan.json untouched.
 *
 * Usage:
 *   node plan-domains.mjs prepare <projectRoot> [--replan]
 *   node plan-domains.mjs accept  <projectRoot>
 *
 * Logging: summary to stdout (rejection reasons too), diagnostics to stderr.
 */

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AREAS_DIR } from './split-domain-areas.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

export const PLAN_INPUT_FORMAT = 'excavator-domain-plan-input/1';
export const PLAN_FORMAT = 'excavator-domain-plan/1';
export const PLAN_FILE = 'domain-plan.json';
export const MAX_SUPPORT_DOMAINS = 3;
export const SAMPLE_LIMITS = Object.freeze({ fileNames: 20, entrySamples: 8, exports: 12 });
export const EXIT_REJECTED = 3;
const ENTRY_SAMPLE_CHARS = 120;
const DOMAIN_ID = /^domain:[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KINDS = ['business', 'support'];
const PLAN_ARTIFACTS = ['plan.input.json', 'plan.output.json', 'plan.rejection.json'];

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;
const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** sha256 of the sorted module paths joined with newlines. */
export function moduleSetDigest(paths) {
  return createHash('sha256').update([...paths].sort(compare).join('\n')).digest('hex');
}

/** Domains are business areas: on average a domain holds at least sqrt(N) modules. */
export function maxBusinessDomains(moduleCount) {
  return Math.max(3, Math.ceil(Math.sqrt(moduleCount)));
}

function malformedReason(stored) {
  if (!isObject(stored)) return 'stored plan is not an object';
  if (stored.format !== PLAN_FORMAT) return `stored plan format is ${JSON.stringify(stored.format)}`;
  if (!isObject(stored.modules)) return 'stored plan modules is not an object';
  if (!Array.isArray(stored.domains)) return 'stored plan domains is not an array';
  const ids = new Set(stored.domains.map((d) => d?.id));
  for (const [path, id] of Object.entries(stored.modules)) {
    if (!ids.has(id)) return `stored plan assigns ${path} to unknown domain ${JSON.stringify(id)}`;
  }
  return null;
}

/**
 * Compare the stored plan with the current module paths.
 * Returns { mode, plan, unassigned, pruned, reason }; `plan` is the stored
 * plan pruned to the current modules (null for mode new).
 */
export function reconcilePlan({ stored, modulePaths, replan }) {
  const all = [...modulePaths].sort(compare);
  const fresh = (reason) => ({
    mode: 'new', plan: null, unassigned: all, pruned: { modulesRemoved: [], domainsEmptied: [] }, reason,
  });
  if (replan) return fresh('replan requested');
  if (stored === null || stored === undefined) return fresh('no stored plan');
  const bad = malformedReason(stored);
  if (bad) return fresh(bad);

  const keys = Object.keys(stored.modules).sort(compare);
  if (stored.moduleSetDigest === moduleSetDigest(all) && sameList(keys, all)) {
    return { mode: 'reused', plan: stored, unassigned: [], pruned: { modulesRemoved: [], domainsEmptied: [] }, reason: 'module set unchanged' };
  }

  const current = new Set(all);
  const modules = {};
  const modulesRemoved = [];
  for (const path of keys) {
    if (current.has(path)) modules[path] = stored.modules[path];
    else modulesRemoved.push(path);
  }
  const held = new Set(Object.values(modules));
  const domainsEmptied = stored.domains.filter((d) => !held.has(d.id)).map((d) => d.id);
  const emptied = new Set(domainsEmptied);
  const pruned = {
    ...stored,
    moduleSetDigest: moduleSetDigest(Object.keys(modules)),
    modules,
    domains: stored.domains.filter((d) => !emptied.has(d.id)),
    crossDomain: (Array.isArray(stored.crossDomain) ? stored.crossDomain : [])
      .filter((e) => !emptied.has(e?.source) && !emptied.has(e?.target)),
  };
  const added = all.filter((p) => !(p in stored.modules));
  return {
    mode: added.length > 0 ? 'extend' : 'reused',
    plan: pruned,
    unassigned: added,
    pruned: { modulesRemoved, domainsEmptied },
    reason: added.length > 0 ? 'module directories added' : 'module directories removed',
  };
}

function sampleOf(entry) {
  const text = typeof entry?.match === 'string' && entry.match.trim() ? entry.match : entry?.description;
  return typeof text === 'string' ? text.trim().slice(0, ENTRY_SAMPLE_CHARS) : '';
}

/** The planner's input (design D2). One row per manifest module, bounded samples, exact omitted counts. */
export function buildPlanInput({ manifest, context, token, mode, plan, unassigned, outputPath }) {
  const entriesByFile = new Map();
  for (const entry of context?.entryPoints ?? []) {
    if (typeof entry?.file !== 'string') continue;
    if (!entriesByFile.has(entry.file)) entriesByFile.set(entry.file, []);
    entriesByFile.get(entry.file).push(entry);
  }
  const exportsByFile = new Map();
  for (const signature of context?.fileSignatures ?? []) {
    if (typeof signature?.file === 'string' && !exportsByFile.has(signature.file)) exportsByFile.set(signature.file, signature.exports);
  }
  const toPlan = new Set(unassigned);
  const modules = manifest.modules.map((module) => {
    const fileNames = module.files.map((f) => posix.basename(f)).sort(compare);
    const samples = [];
    const names = [];
    const seenNames = new Set();
    for (const file of module.files) {
      const entries = [...(entriesByFile.get(file) ?? [])].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
      for (const entry of entries) samples.push(sampleOf(entry));
      for (const name of Array.isArray(exportsByFile.get(file)) ? exportsByFile.get(file) : []) {
        if (typeof name === 'string' && !seenNames.has(name)) { seenNames.add(name); names.push(name); }
      }
    }
    return {
      path: module.path,
      files: module.files.length,
      fileNames: fileNames.slice(0, SAMPLE_LIMITS.fileNames),
      fileNamesOmitted: Math.max(0, fileNames.length - SAMPLE_LIMITS.fileNames),
      entryPoints: module.entryPoints,
      entrySamples: samples.slice(0, SAMPLE_LIMITS.entrySamples),
      entrySamplesOmitted: Math.max(0, samples.length - SAMPLE_LIMITS.entrySamples),
      exports: names.slice(0, SAMPLE_LIMITS.exports),
      exportsOmitted: Math.max(0, names.length - SAMPLE_LIMITS.exports),
      assigned: mode === 'extend' && !toPlan.has(module.path) ? plan?.modules?.[module.path] ?? null : null,
    };
  });
  return {
    format: PLAN_INPUT_FORMAT,
    planRun: { token },
    mode,
    output: outputPath,
    limits: planLimits(manifest.modules.length, mode === 'extend' ? plan.domains : []),
    modules,
    domains: mode === 'extend' ? plan.domains : [],
  };
}

/**
 * The domain limits a plan is checked against. A project that shrank keeps
 * every domain that still holds a module, so its stored plan may hold more
 * than the smaller project's limit; extending it never makes that a
 * rejection: the limit is never below what the plan already holds.
 */
function planLimits(moduleCount, existing) {
  const count = (kind) => existing.filter((d) => d?.kind === kind).length;
  return {
    maxBusinessDomains: Math.max(maxBusinessDomains(moduleCount), count('business')),
    maxSupportDomains: Math.max(MAX_SUPPORT_DOMAINS, count('support')),
  };
}

function checkDomain(domain, index, reasons) {
  const label = `domains[${index}]${isObject(domain) && typeof domain.id === 'string' ? ` (${domain.id})` : ''}`;
  if (!isObject(domain)) { reasons.push(`${label}: not an object`); return false; }
  let ok = true;
  if (typeof domain.id !== 'string' || !DOMAIN_ID.test(domain.id)) { reasons.push(`${label}: id ${JSON.stringify(domain.id)} is not domain:<kebab-case>`); ok = false; }
  if (!KINDS.includes(domain.kind)) { reasons.push(`${label}: kind ${JSON.stringify(domain.kind)} is not business or support`); ok = false; }
  if (!isText(domain.name)) { reasons.push(`${label}: name is empty`); ok = false; }
  if (!isText(domain.summary)) { reasons.push(`${label}: summary is empty`); ok = false; }
  for (const field of ['tags', 'entities', 'businessRules']) {
    const value = domain[field];
    if (value !== undefined && !(Array.isArray(value) && value.every((v) => typeof v === 'string'))) {
      reasons.push(`${label}: ${field} must be an array of strings`);
      ok = false;
    }
  }
  return ok;
}

/**
 * Check the planner's output. `input` is the plan input it answered; `plan`
 * is the pruned stored plan (extend mode) or null. Returns
 * { ok: true, plan, dropped } or { ok: false, reasons }.
 */
export function acceptPlan({ input, output, plan = null, now = new Date() }) {
  const reasons = [];
  if (!isObject(output)) return { ok: false, reasons: ['output is not a JSON object'] };
  const extend = input.mode === 'extend';
  const existing = extend ? plan.domains : [];
  const existingIds = new Set(existing.map((d) => d.id));

  if (output.planRun?.token !== input.planRun.token) reasons.push('token: planRun.token is not this run\'s token (stale copy)');

  const newDomains = [];
  if (!Array.isArray(output.domains)) reasons.push('domains is not an array');
  else {
    const seen = new Set();
    output.domains.forEach((domain, i) => {
      checkDomain(domain, i, reasons);
      const id = isObject(domain) ? domain.id : undefined;
      if (typeof id === 'string') {
        if (seen.has(id)) reasons.push(`domains[${i}] (${id}): duplicate domain id`);
        else if (existingIds.has(id)) reasons.push(`domains[${i}] (${id}): id already exists in the stored plan`);
        seen.add(id);
      }
      if (isObject(domain)) newDomains.push(domain);
    });
  }
  const declared = new Set([...existingIds, ...newDomains.map((d) => d.id).filter((id) => typeof id === 'string')]);

  const toPlan = input.modules.filter((m) => !extend || m.assigned === null).map((m) => m.path).sort(compare);
  const assignments = isObject(output.assignments) ? output.assignments : null;
  if (assignments === null) reasons.push('assignments is not an object');
  const given = assignments ? Object.keys(assignments) : [];
  const wanted = new Set(toPlan);
  for (const path of toPlan) if (!(assignments && path in assignments)) reasons.push(`assignments: missing module ${path}`);
  for (const key of given.sort(compare)) {
    if (!wanted.has(key)) {
      const known = input.modules.some((m) => m.path === key);
      reasons.push(known
        ? `assignments: ${key} is already assigned and cannot be changed`
        : `assignments: unknown module ${key}`);
    }
  }
  const held = new Map();
  for (const path of toPlan) {
    if (!(assignments && path in assignments)) continue;
    const id = assignments[path];
    if (typeof id !== 'string' || !declared.has(id)) { reasons.push(`assignments: ${path} points to undeclared domain ${JSON.stringify(id)}`); continue; }
    held.set(id, (held.get(id) ?? 0) + 1);
  }
  for (const domain of newDomains) {
    if (typeof domain.id === 'string' && !held.has(domain.id)) reasons.push(`domain ${domain.id} holds no module`);
  }

  const all = [...existing, ...newDomains];
  const business = all.filter((d) => d.kind === 'business').length;
  const support = all.filter((d) => d.kind === 'support').length;
  const replan = extend ? '; existing domains cannot change here, run with --replan to decide every domain again' : '';
  if (business > input.limits.maxBusinessDomains) reasons.push(`business domains: ${business} exceeds the limit ${input.limits.maxBusinessDomains}${replan}`);
  if (support > input.limits.maxSupportDomains) reasons.push(`support domains: ${support} exceeds the limit ${input.limits.maxSupportDomains}${replan}`);

  if (reasons.length > 0) return { ok: false, reasons };

  const modules = { ...(extend ? plan.modules : {}) };
  for (const path of toPlan) modules[path] = assignments[path];
  const sortedModules = Object.fromEntries(Object.keys(modules).sort(compare).map((k) => [k, modules[k]]));
  const ids = new Set(all.map((d) => d.id));
  const rawCross = Array.isArray(output.crossDomain) ? output.crossDomain : [];
  const crossDomain = extend ? [...plan.crossDomain] : [];
  let dropped = 0;
  for (const entry of rawCross) {
    if (isObject(entry) && ids.has(entry.source) && ids.has(entry.target) && entry.source !== entry.target && isText(entry.description)) {
      crossDomain.push({ source: entry.source, target: entry.target, description: entry.description });
    } else dropped += 1;
  }
  const stored = {
    format: PLAN_FORMAT,
    moduleSetDigest: moduleSetDigest(Object.keys(sortedModules)),
    modules: sortedModules,
    domains: [
      ...existing,
      ...newDomains.map((d) => ({
        id: d.id, kind: d.kind, name: d.name, summary: d.summary,
        tags: d.tags ?? [], entities: d.entities ?? [], businessRules: d.businessRules ?? [],
      })),
    ],
    crossDomain,
    history: [
      ...(extend && Array.isArray(plan.history) ? plan.history : []),
      { mode: input.mode, at: new Date(now).toISOString(), modules: Object.keys(sortedModules).length, planned: toPlan.length },
    ],
  };
  return { ok: true, plan: stored, dropped: { crossDomain: dropped } };
}

function parseArgs(argv) {
  const usage = 'Usage: node plan-domains.mjs prepare <projectRoot> [--replan] | accept <projectRoot>';
  const [command, ...rest] = argv;
  if (command !== 'prepare' && command !== 'accept') throw new Error(usage);
  const args = { command, projectRoot: null, replan: false };
  for (const arg of rest) {
    if (arg === '--replan' && command === 'prepare') { args.replan = true; continue; }
    if (arg.startsWith('--')) throw new Error(`plan-domains: unknown option: ${arg}`);
    if (!args.projectRoot) { args.projectRoot = arg; continue; }
    throw new Error(`plan-domains: unexpected argument: ${arg}`);
  }
  if (!args.projectRoot) throw new Error(usage);
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

function readJsonOrNull(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function loadManifest(areasDir) {
  const manifestPath = join(areasDir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`plan-domains: no area manifest at ${manifestPath}; run split-domain-areas.mjs first`);
  return JSON.parse(readFileSync(manifestPath, 'utf-8'));
}

function clearPlanArtifacts(areasDir, names) {
  for (const name of names) rmSync(join(areasDir, name), { force: true });
}

async function prepare(args, dataDir, areasDir) {
  const manifest = loadManifest(areasDir);
  const contextPath = typeof manifest.contextPath === 'string' && existsSync(manifest.contextPath)
    ? manifest.contextPath
    : join(dataDir, 'intermediate', 'domain-context.json');
  if (!existsSync(contextPath)) throw new Error(`plan-domains: domain context not found: ${contextPath}`);
  const context = JSON.parse(readFileSync(contextPath, 'utf-8'));

  const planPath = join(dataDir, PLAN_FILE);
  const stored = readJsonOrNull(planPath);
  const modulePaths = manifest.modules.map((m) => m.path);
  const result = reconcilePlan({ stored, modulePaths, replan: args.replan });

  if (result.mode === 'reused') {
    if (JSON.stringify(result.plan) !== JSON.stringify(stored)) writeJson(planPath, result.plan);
    clearPlanArtifacts(areasDir, PLAN_ARTIFACTS);
    process.stdout.write(
      `plan=reused modules=${modulePaths.length} domains=${result.plan.domains.length} digest=${result.plan.moduleSetDigest}\n`,
    );
    return;
  }

  const inputPath = join(areasDir, 'plan.input.json');
  const outputPath = join(areasDir, 'plan.output.json');
  const input = buildPlanInput({
    manifest, context, token: manifest.token, mode: result.mode, plan: result.plan, unassigned: result.unassigned, outputPath,
  });
  clearPlanArtifacts(areasDir, ['plan.output.json', 'plan.rejection.json']);
  writeJson(inputPath, input);
  const why = result.mode === 'new' && (args.replan || existsSync(planPath)) ? ` reason=${JSON.stringify(result.reason)}` : '';
  process.stdout.write(
    `plan=${result.mode} modules=${modulePaths.length} toPlan=${result.unassigned.length} ` +
    `maxBusinessDomains=${input.limits.maxBusinessDomains} input=${inputPath} output=${outputPath}${why}\n`,
  );
}

async function accept(args, dataDir, areasDir) {
  const manifest = loadManifest(areasDir);
  const inputPath = join(areasDir, 'plan.input.json');
  const input = readJsonOrNull(inputPath);
  if (input === null) throw new Error(`plan-domains: no readable plan input at ${inputPath}; run prepare first`);

  const planPath = join(dataDir, PLAN_FILE);
  const reasons = [];
  let plan = null;
  if (input.mode === 'extend') {
    const result = reconcilePlan({ stored: readJsonOrNull(planPath), modulePaths: manifest.modules.map((m) => m.path), replan: false });
    const pending = input.modules.filter((m) => m.assigned === null).map((m) => m.path).sort(compare);
    if (result.mode !== 'extend' || !sameList(result.unassigned, pending)) {
      throw new Error('plan-domains: the stored plan changed since prepare; run prepare again');
    }
    plan = result.plan;
  }

  const outputPath = join(areasDir, 'plan.output.json');
  let output = null;
  if (!existsSync(outputPath)) reasons.push(`missing: no planner output at ${outputPath}`);
  else {
    try {
      output = JSON.parse(readFileSync(outputPath, 'utf-8'));
    } catch (error) {
      reasons.push(`parse: ${error.message}`);
    }
  }
  const verdict = reasons.length > 0 ? { ok: false, reasons } : acceptPlan({ input, output, plan });

  if (!verdict.ok) {
    writeJson(join(areasDir, 'plan.rejection.json'), { reasons: verdict.reasons });
    process.stdout.write(`${verdict.reasons.map((r) => `rejected: ${r}`).join('\n')}\n`);
    process.exitCode = EXIT_REJECTED;
    return;
  }
  writeJson(planPath, verdict.plan);
  rmSync(join(areasDir, 'plan.rejection.json'), { force: true });
  const kinds = (kind) => verdict.plan.domains.filter((d) => d.kind === kind).length;
  process.stdout.write(
    `plan accepted mode=${input.mode} business=${kinds('business')} support=${kinds('support')} ` +
    `modules=${Object.keys(verdict.plan.modules).length} crossDomainDropped=${verdict.dropped.crossDomain}\n`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(args.projectRoot);
  const dataDir = await resolveDataDir(projectRoot);
  const areasDir = join(dataDir, 'intermediate', AREAS_DIR);
  if (args.command === 'prepare') await prepare(args, dataDir, areasDir);
  else await accept(args, dataDir, areasDir);
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
    process.stderr.write(`plan-domains.mjs failed: ${err.message}\n`);
    process.exit(1);
  }
}

export default { moduleSetDigest, maxBusinessDomains, reconcilePlan, buildPlanInput, acceptPlan };
