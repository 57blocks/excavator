#!/usr/bin/env node
/**
 * plan-units.mjs
 *
 * Decides the project's runtime units once and stores them, so every later
 * step (areas, pairing, the report) names the same units from run to run.
 *
 * A unit is a directory holding a manifest: package.json, go.mod, pom.xml,
 * build.gradle(.kts), pyproject.toml, setup.py, requirements.txt or a
 * *.csproj. A file belongs to the deepest unit whose directory holds it.
 * Each unit gets one kind, by fixed rules (no model):
 *   runtime       its own source has an entry: a Go `package main`; a JVM
 *                 `static void main`, `fun main(` or @SpringBootApplication;
 *                 a Python __main__ guard, manage.py, [project.scripts] or an
 *                 app object; a .csproj with OutputType Exe, the Web SDK or a
 *                 Program.cs; or an HTTP route entry point of the knowledge
 *                 graph in one of its files;
 *   container     otherwise, the manifest declares sub-projects (workspaces,
 *                 <modules>, a pnpm-workspace.yaml or lerna.json beside it,
 *                 include in settings.gradle);
 *   runtime       otherwise, the manifest has an entry: a package.json `bin`
 *                 or a script named start*, dev*, serve* or preview*;
 *   library       any other manifest;
 *   unmanifested  the synthetic unit `unit:.` holding files under no manifest
 *                 (only when the project root has no manifest).
 * Every piece of entry evidence is recorded (file, line, text, rule).
 *
 * Storage. The units are written to <dataDir>/relations-units.json with a
 * digest of their inputs (rules version, every manifest's path and content
 * hash, every piece of entry evidence). When the digest is unchanged the
 * stored units are reused as they are (`units=reused`); otherwise they are
 * decided again and the added, removed and re-kinded units are printed.
 * --reunit decides them again regardless.
 *
 * Usage:
 *   node plan-units.mjs <projectRoot> [--graph <knowledge-graph.jsonl>] [--reunit]
 *
 * Logging: summary to stdout, diagnostics to stderr.
 */

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  compare, extensionOf, httpEntryPointsByFile, isObject, isTestFile, readGraphFacts, readSourceLines, sha256, walkProject,
} from './relations-signals.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

export const UNITS_FORMAT = 'excavator-relations-units/1';
export const UNITS_FILE = 'relations-units.json';
export const UNIT_RULES_VERSION = 1;
export const UNIT_KINDS = Object.freeze(['runtime', 'library', 'container', 'unmanifested']);
const MAX_EVIDENCE_PER_RULE = 3;
const CONTAINER_RULES = new Set(['package-workspaces', 'maven-modules', 'workspace-file', 'gradle-include']);
const SOURCE_RULES = new Set(['go-main', 'jvm-main', 'python-main', 'python-manage', 'dotnet-program', 'dotnet-program-file', 'route-entry-point']);

const MANIFEST = /^(?:package\.json|go\.mod|pom\.xml|build\.gradle(?:\.kts)?|pyproject\.toml|setup\.py|requirements\.txt|[^/]+\.csproj)$/;

export function isManifest(file) {
  return MANIFEST.test(posix.basename(file));
}

export function unitIdOf(dir) {
  return `unit:${dir}`;
}

/** The deepest of `dirs` (sorted, '.' for the root) that holds `file`, or null. */
export function deepestDir(file, dirSet) {
  let dir = posix.dirname(file);
  for (;;) {
    if (dirSet.has(dir)) return dir;
    if (dir === '.' || dir === '/' || dir === '') return null;
    dir = posix.dirname(dir);
  }
}

function lineOf(lines, regex) {
  for (let i = 0; i < lines.length; i++) if (regex.test(lines[i])) return { line: i + 1, text: lines[i].trim().slice(0, 200) };
  return null;
}

function nameFromManifest(file, lines) {
  const base = posix.basename(file);
  const text = lines.join('\n');
  try {
    if (base === 'package.json') {
      const name = JSON.parse(text).name;
      if (typeof name === 'string' && name) return name;
    }
  } catch { /* not JSON: fall through */ }
  if (base === 'go.mod') {
    const m = /^module\s+(\S+)/m.exec(text);
    if (m) return m[1].split('/').pop();
  }
  if (base === 'pom.xml') {
    const m = /<artifactId>([^<]+)<\/artifactId>/.exec(text.replace(/<parent>[\s\S]*?<\/parent>/, ''));
    if (m) return m[1].trim();
  }
  if (base === 'pyproject.toml') {
    const m = /^name\s*=\s*["']([^"']+)["']/m.exec(text);
    if (m) return m[1];
  }
  if (base.endsWith('.csproj')) return base.replace(/\.csproj$/, '');
  return null;
}

/**
 * Manifest-level evidence: whether the manifest makes the unit a container or
 * gives it an entry. Returns { container: evidence|null, entries: evidence[] }.
 */
function manifestEvidence(file, lines, siblings) {
  const base = posix.basename(file);
  const out = { container: null, entries: [] };
  const ev = (rule, hit) => ({ rule, file, line: hit?.line ?? null, text: hit?.text ?? null });
  if (base === 'package.json') {
    let json = null;
    try { json = JSON.parse(lines.join('\n')); } catch { /* unreadable */ }
    if (isObject(json)) {
      if (json.workspaces !== undefined) out.container = ev('package-workspaces', lineOf(lines, /"workspaces"\s*:/));
      if (json.bin !== undefined) out.entries.push(ev('package-bin', lineOf(lines, /"bin"\s*:/)));
      for (const key of Object.keys(isObject(json.scripts) ? json.scripts : {}).sort(compare)) {
        if (/^(?:start|dev|serve|preview)/.test(key)) {
          out.entries.push(ev('package-script', lineOf(lines, new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:`))));
          break;
        }
      }
    }
  }
  if (base === 'pom.xml') {
    const hit = lineOf(lines, /<modules>/);
    if (hit) out.container = ev('maven-modules', hit);
  }
  if (base.endsWith('.csproj')) {
    const hit = lineOf(lines, /<OutputType>\s*Exe\s*<\/OutputType>|Sdk="Microsoft\.NET\.Sdk\.Web"/i);
    if (hit) out.entries.push(ev('csproj-exe', hit));
  }
  if (base === 'pyproject.toml') {
    const hit = lineOf(lines, /^\[(?:project\.scripts|tool\.poetry\.scripts)\]/);
    if (hit) out.entries.push(ev('python-scripts', hit));
  }
  for (const sibling of siblings) {
    const name = posix.basename(sibling);
    if (name === 'pnpm-workspace.yaml' || name === 'lerna.json') out.container ??= { rule: 'workspace-file', file: sibling, line: null, text: null };
  }
  return out;
}

/** Source-level entry rules, checked on the files a unit holds. */
const SOURCE_ENTRY_RULES = Object.freeze([
  { rule: 'go-main', ext: ['.go'], regex: /^package\s+main\b/ },
  { rule: 'jvm-main', ext: ['.java', '.kt', '.scala', '.groovy'], regex: /static\s+void\s+main\s*\(|^\s*fun\s+main\s*\(|@SpringBootApplication\b/ },
  { rule: 'python-main', ext: ['.py'], regex: /^if\s+__name__\s*==\s*['"]__main__['"]|=\s*(?:FastAPI|Flask)\s*\(/ },
  { rule: 'dotnet-program', ext: ['.cs'], regex: /static\s+(?:async\s+)?(?:void|Task|int)\s+Main\s*\(|WebApplication\.CreateBuilder\s*\(/ },
]);

/**
 * Decide the units. `files` is every project file; `readLines(file)` returns
 * a file's lines or null; `entryPointsByFile` the graph's HTTP route entry
 * points by file. Pure. Returns { units, inputs } where `inputs` is what the
 * digest is taken over.
 */
export function decideUnits({ files, readLines, entryPointsByFile = new Map(), projectName = 'project' }) {
  const manifests = files.filter(isManifest);
  const dirOf = (file) => posix.dirname(file);
  const byDir = new Map();
  for (const file of manifests) {
    const dir = dirOf(file);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(file);
  }
  const dirs = new Set(byDir.keys());
  const synthetic = !dirs.has('.') && files.some((f) => deepestDir(f, dirs) === null);

  const units = new Map();
  for (const dir of [...dirs].sort(compare)) {
    const siblings = files.filter((f) => dirOf(f) === dir);
    const unit = {
      id: unitIdOf(dir), root: dir, name: null, kind: 'library',
      manifests: [], evidence: [],
    };
    for (const file of byDir.get(dir).sort(compare)) {
      const lines = readLines(file) ?? [];
      unit.manifests.push({ file, sha256: sha256(lines.join('\n')) });
      unit.name ??= nameFromManifest(file, lines);
      const found = manifestEvidence(file, lines, siblings);
      if (found.container) unit.evidence.push(found.container);
      unit.evidence.push(...found.entries);
    }
    const settings = siblings.find((f) => /^settings\.gradle(?:\.kts)?$/.test(posix.basename(f)));
    if (settings) {
      const hit = lineOf(readLines(settings) ?? [], /^\s*include\b/);
      if (hit) unit.evidence.push({ rule: 'gradle-include', file: settings, line: hit.line, text: hit.text });
    }
    unit.name ??= dir === '.' ? projectName : posix.basename(dir);
    units.set(dir, unit);
  }
  if (synthetic) {
    units.set('.', { id: unitIdOf('.'), root: '.', name: projectName, kind: 'unmanifested', manifests: [], evidence: [] });
  }

  // Source-level evidence, on the files each unit holds.
  const counted = new Map();
  const unitDirs = new Set(units.keys());
  for (const file of files) {
    if (isTestFile(file)) continue;
    const dir = deepestDir(file, unitDirs);
    const unit = dir === null ? null : units.get(dir);
    if (!unit) continue;
    const ext = extensionOf(file);
    const rules = SOURCE_ENTRY_RULES.filter((r) => r.ext.includes(ext));
    const bump = (rule) => {
      const key = `${unit.id}|${rule}`;
      counted.set(key, (counted.get(key) ?? 0) + 1);
      return counted.get(key) <= MAX_EVIDENCE_PER_RULE;
    };
    if (posix.basename(file) === 'manage.py' && bump('python-manage')) unit.evidence.push({ rule: 'python-manage', file, line: null, text: null });
    if (posix.basename(file) === 'Program.cs' && unit.manifests.some((m) => m.file.endsWith('.csproj')) && bump('dotnet-program-file')) {
      unit.evidence.push({ rule: 'dotnet-program-file', file, line: null, text: null });
    }
    if (rules.length > 0) {
      const lines = readLines(file);
      if (lines) {
        for (const rule of rules) {
          const hit = lineOf(lines, rule.regex);
          if (hit && bump(rule.rule)) unit.evidence.push({ rule: rule.rule, file, line: hit.line, text: hit.text });
        }
      }
    }
    const routes = entryPointsByFile.get(file);
    if (routes && routes.length > 0 && bump('route-entry-point')) {
      const first = [...routes].sort((a, b) => (a.line ?? 0) - (b.line ?? 0))[0];
      unit.evidence.push({ rule: 'route-entry-point', file, line: first.line ?? null, text: `${first.method ?? ''} ${first.path ?? ''}`.trim() });
    }
  }
  const routeCounts = {};
  for (const [key, n] of counted) {
    const [id, rule] = key.split('|');
    if (rule === 'route-entry-point') routeCounts[id] = n;
  }

  for (const unit of units.values()) {
    if (unit.kind === 'unmanifested') continue;
    const rules = new Set(unit.evidence.map((e) => e.rule));
    // An entry in the unit's own source makes it runtime even when it also
    // declares sub-projects (an application whose build includes libraries);
    // otherwise sub-projects make it a container, and a manifest-level entry
    // (a start script) makes it runtime.
    if ([...rules].some((r) => SOURCE_RULES.has(r))) unit.kind = 'runtime';
    else if ([...rules].some((r) => CONTAINER_RULES.has(r))) unit.kind = 'container';
    else if (rules.size > 0) unit.kind = 'runtime';
    else unit.kind = 'library';
    unit.evidence.sort((a, b) => compare(a.rule, b.rule) || compare(a.file, b.file) || (a.line ?? 0) - (b.line ?? 0));
  }
  const list = [...units.values()].sort((a, b) => compare(a.root, b.root));
  const inputs = {
    rulesVersion: UNIT_RULES_VERSION,
    synthetic,
    manifests: list.flatMap((u) => u.manifests.map((m) => `${m.file}:${m.sha256}`)),
    evidence: list.flatMap((u) => u.evidence.map((e) => `${u.id}|${e.rule}|${e.file}|${e.line ?? ''}|${e.text ?? ''}`)),
    routeCounts,
  };
  return { units: list, inputs };
}

export function unitsDigest(inputs) {
  return sha256(JSON.stringify(inputs));
}

/** Compare a stored units file with freshly decided units. */
export function reconcileUnits({ stored, units, digest, reunit }) {
  if (!reunit && isObject(stored) && stored.format === UNITS_FORMAT && stored.digest === digest && Array.isArray(stored.units)) {
    return { mode: 'reused', units: stored.units, changes: [] };
  }
  const before = new Map((isObject(stored) && Array.isArray(stored.units) ? stored.units : []).map((u) => [u.id, u]));
  const changes = [];
  for (const unit of units) {
    const old = before.get(unit.id);
    if (!old) changes.push(`added ${unit.id} kind=${unit.kind}`);
    else if (old.kind !== unit.kind) changes.push(`rekinded ${unit.id} ${old.kind}->${unit.kind}`);
    before.delete(unit.id);
  }
  for (const id of [...before.keys()].sort(compare)) changes.push(`removed ${id}`);
  return { mode: stored ? 'changed' : 'new', units, changes };
}

/** File -> unit id, by the deepest unit root holding it. */
export function unitOfFile(units) {
  const roots = new Set(units.map((u) => u.root));
  return (file) => {
    const dir = deepestDir(file, roots);
    return dir === null ? null : unitIdOf(dir);
  };
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

function parseArgs(argv) {
  const args = { projectRoot: null, graph: null, reunit: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--graph') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('plan-units: --graph requires a value');
      args.graph = value;
      i++;
      continue;
    }
    if (arg === '--reunit') { args.reunit = true; continue; }
    if (arg.startsWith('--')) throw new Error(`plan-units: unknown option: ${arg}`);
    if (!args.projectRoot) { args.projectRoot = arg; continue; }
    throw new Error(`plan-units: unexpected argument: ${arg}`);
  }
  if (!args.projectRoot) throw new Error('Usage: node plan-units.mjs <projectRoot> [--graph <knowledge-graph.jsonl>] [--reunit]');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(args.projectRoot);
  const dataDir = await resolveDataDir(projectRoot);
  const graphPath = args.graph ? resolve(args.graph) : null;
  if (graphPath && !existsSync(graphPath)) throw new Error(`plan-units: knowledge graph not found: ${graphPath}`);
  const facts = readGraphFacts(graphPath);
  const files = walkProject(projectRoot);
  const cache = new Map();
  const readLines = (file) => {
    if (!cache.has(file)) cache.set(file, readSourceLines(projectRoot, file));
    return cache.get(file);
  };
  const { units, inputs } = decideUnits({
    files, readLines, entryPointsByFile: httpEntryPointsByFile(facts), projectName: basename(projectRoot),
  });
  const digest = unitsDigest(inputs);
  const path = join(dataDir, UNITS_FILE);
  let stored = null;
  if (existsSync(path)) {
    try { stored = JSON.parse(readFileSync(path, 'utf-8')); } catch { stored = null; }
  }
  const result = reconcileUnits({ stored, units, digest, reunit: args.reunit });
  if (result.mode !== 'reused') {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ format: UNITS_FORMAT, digest, rulesVersion: UNIT_RULES_VERSION, units: result.units }, null, 2)}\n`, 'utf-8');
  }
  const count = (kind) => result.units.filter((u) => u.kind === kind).length;
  const lines = [
    `units=${result.mode} digest=${digest.slice(0, 12)} units=${result.units.length} runtime=${count('runtime')} ` +
    `library=${count('library')} container=${count('container')} unmanifested=${count('unmanifested')} file=${path}`,
  ];
  for (const unit of result.units) {
    const ev = unit.evidence.filter((e) => !CONTAINER_RULES.has(e.rule));
    const first = ev[0] ?? unit.evidence[0];
    lines.push(`${unit.id} kind=${unit.kind} name=${unit.name}${first ? ` evidence=${first.rule}@${first.file}${first.line ? `:${first.line}` : ''}` : ''}`);
  }
  for (const change of result.changes) lines.push(change);
  process.stdout.write(`${lines.join('\n')}\n`);
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
    process.stderr.write(`plan-units.mjs failed: ${err.message}\n`);
    process.exit(1);
  }
}

export default { decideUnits, unitsDigest, reconcileUnits, unitOfFile, deepestDir, isManifest };
