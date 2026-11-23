#!/usr/bin/env node
/**
 * split-relation-areas.mjs
 *
 * Chooses the files a relations analyzer reads and cuts them into bounded
 * areas, one analyzer each. Needs the units plan-units.mjs stored.
 *
 * Candidates, per unit (test files never are):
 *   - a source file with a signal line (relations-signals.mjs);
 *   - a source file that imports a client definition (a file with a signal of
 *     a client family), so calls through a wrapped client are read; imports
 *     come from the knowledge graph's `imports` edges and, for JS-family
 *     files, from their import/require specifiers: relative ones, and `@/` or
 *     `~/`, the usual alias of the unit's `src/` directory;
 *   - a file holding an HTTP route entry point of the knowledge graph.
 * A candidate of a container unit (a build or tool script beside the
 * sub-projects) is counted as container-skipped and never analyzed.
 * Areas: a unit's candidates in path order, packed while their line total
 * stays within --max-lines; a file over the cap is its own area, marked
 * overBudget, never cut. An area never spans two units.
 *
 * Address lines: from configuration files (relations-signals.mjs
 * isConfigFile), lines naming a URL, host, port, topic or queue, never a line
 * whose key looks like a secret, and at most MAX_ADDRESS_LINES_PER_FILE of one
 * file, so one large manifest cannot fill a unit's share. A unit's own lines go to its areas (at most
 * MAX_UNIT_ADDRESS_LINES); lines of container and unmanifested units and of
 * deployment files go to every area as project configuration (at most
 * MAX_PROJECT_ADDRESS_LINES); every area also gets a short summary of every
 * unit with up to MAX_SUMMARY_ADDRESS_LINES of its lines.
 *
 * Freshness: every run deletes intermediate/relations-areas/ first, then
 * writes a random token into the manifest and every area context; the
 * analyzer copies it into its output and the merge rejects an output without
 * it. The manifest also carries `inputDigest` (units digest, signals
 * version, the cap, every candidate's path and content hash, every address
 * line): two runs with the same digest read the same input, so the merge may
 * compare their results.
 *
 * Usage:
 *   node split-relation-areas.mjs <projectRoot> [--graph <knowledge-graph.jsonl>] [--max-lines <n>]
 *
 * Prints one line per area; counts to stderr.
 */

import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CLIENT_FAMILIES, SIGNALS, SIGNALS_VERSION, SOURCE_EXTENSIONS, compare, extensionOf, httpEntryPointsByFile, isAddressLine,
  isConfigFile, isTestFile, languageFamilyOf, readGraphFacts, readSourceLines, sha256, walkProject,
} from './relations-signals.mjs';
import { UNITS_FILE, UNITS_FORMAT, unitOfFile } from './plan-units.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

export const AREA_CONTEXT_FORMAT = 'excavator-relations-area/1';
export const AREA_MANIFEST_FORMAT = 'excavator-relations-areas/1';
export const AREAS_DIR = 'relations-areas';
export const DEFAULT_MAX_LINES = 4000;
export const MAX_UNIT_ADDRESS_LINES = 200;
export const MAX_PROJECT_ADDRESS_LINES = 200;
export const MAX_SUMMARY_ADDRESS_LINES = 20;
export const MAX_ADDRESS_LINES_PER_FILE = 25;
export const MAX_HITS_PER_FILE = 40;
export const MAX_GRAPH_NODES_PER_FILE = 150;
const MAX_TEXT = 200;
export const IN_SCOPE_KINDS = Object.freeze(['http', 'rpc', 'message', 'realtime', 'external']);
export const OUT_OF_SCOPE_KINDS = Object.freeze(['shared-database', 'shared-cache', 'shared-file', 'auth-trust', 'scheduled-trigger', 'deploy-config']);
const DEPLOY_FILE = /(?:^|\/)(?:docker-compose[^/]*|Dockerfile[^/]*|nginx[^/]*|[^/]+\.conf|proxy\.conf[^/]*)$/i;
const RESOLVE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'];
const RELATIVE_IMPORT = /(?:from\s+|require\(\s*|import\s*\(\s*|import\s+)['"]((?:\.{1,2}|@|~)\/[^'"]+)['"]/g;

const clip = (text) => text.trim().slice(0, MAX_TEXT);

/**
 * Import specifiers of a JS-family file, resolved against `fileSet`: relative
 * ones against the file's directory, `@/` and `~/` against `<unitRoot>/src/`.
 */
export function relativeImports(file, lines, fileSet, unitRoot = '.') {
  const out = new Set();
  const dir = posix.dirname(file);
  const srcDir = posix.join(unitRoot || '.', 'src');
  for (const line of lines) {
    for (const m of line.matchAll(RELATIVE_IMPORT)) {
      const aliased = m[1].startsWith('@/') || m[1].startsWith('~/');
      const base = posix.normalize(aliased ? posix.join(srcDir, m[1].slice(2)) : posix.join(dir, m[1]));
      if (base.startsWith('..')) continue;
      for (const ext of RESOLVE_EXTENSIONS) {
        const hit = [`${base}${ext}`, ext ? `${base}/index${ext}` : null].find((p) => p && fileSet.has(p));
        if (hit) { out.add(hit); break; }
      }
    }
  }
  return [...out];
}

/** Signal hits of one file's lines. */
export function scanSignals(lines) {
  const hits = [];
  lines.forEach((text, i) => {
    for (const signal of SIGNALS) {
      if (signal.regex.test(text)) hits.push({ line: i + 1, signal: signal.id, family: signal.family, text: clip(text) });
    }
  });
  return hits;
}

/**
 * Pure planning. `files` every project file, `readLines(file)` its lines or
 * null, `units` the stored units, `facts` the graph facts (readGraphFacts) or
 * null. Returns { files, candidates, areas, unitConfig, projectConfig, counts }.
 */
export function planRelationAreas({ files, readLines, units, facts = null, maxLines = DEFAULT_MAX_LINES }) {
  if (!Number.isInteger(maxLines) || maxLines <= 0) throw new Error('maxLines must be a positive integer');
  const unitOf = unitOfFile(units);
  const unitById = new Map(units.map((u) => [u.id, u]));
  const fileSet = new Set(files);
  const entryPoints = httpEntryPointsByFile(facts);
  const counts = {
    files: files.length, sourceFiles: 0, testExcluded: 0, unreadable: 0, candidateFiles: 0, notCandidate: 0,
    bySignal: 0, byClientImport: 0, byEntryPoint: 0, containerSkipped: 0, configFiles: 0, addressLines: 0, addressLinesOverFileCap: 0, secretLinesSkipped: 0, areas: 0,
  };
  const classified = [];
  const material = new Map();
  const unitConfig = new Map();
  const projectConfig = [];
  const addressCount = new Map();

  for (const file of files) {
    const unit = unitOf(file);
    const isSource = SOURCE_EXTENSIONS.has(extensionOf(file));
    const isConfig = isConfigFile(file);
    if (!isSource && !isConfig) continue;
    if (isTestFile(file)) {
      if (isSource) { counts.testExcluded += 1; classified.push({ file, unit, status: 'test-excluded' }); }
      continue;
    }
    const lines = readLines(file);
    if (isSource) counts.sourceFiles += 1;
    if (lines === null) {
      if (isSource) { counts.unreadable += 1; classified.push({ file, unit, status: 'unreadable' }); }
      continue;
    }
    if (isConfig) {
      counts.configFiles += 1;
      const kind = unitById.get(unit)?.kind;
      const toProject = DEPLOY_FILE.test(file) || kind === 'container' || kind === 'unmanifested' || unit === null;
      let inFile = 0;
      lines.forEach((text, i) => {
        if (!text.trim()) return;
        const address = isAddressLine(text);
        if (!address) {
          if (/(?:https?|wss?):\/\//i.test(text)) counts.secretLinesSkipped += 1;
          return;
        }
        counts.addressLines += 1;
        inFile += 1;
        if (inFile > MAX_ADDRESS_LINES_PER_FILE) { counts.addressLinesOverFileCap += 1; return; }
        const row = { file, line: i + 1, text: clip(text) };
        if (toProject) { if (projectConfig.length < MAX_PROJECT_ADDRESS_LINES) projectConfig.push(row); return; }
        if (!unitConfig.has(unit)) unitConfig.set(unit, []);
        const n = addressCount.get(unit) ?? 0;
        addressCount.set(unit, n + 1);
        if (n < MAX_UNIT_ADDRESS_LINES) unitConfig.get(unit).push(row);
      });
    }
    if (isSource) {
      material.set(file, { file, unit, lines: lines.length, hits: scanSignals(lines), source: lines });
    }
  }

  // Client definitions and their importers.
  const clientFiles = new Set([...material.values()].filter((m) => m.hits.some((h) => CLIENT_FAMILIES.has(h.family))).map((m) => m.file));
  const importersOf = new Map();
  const addImport = (from, to) => {
    if (!clientFiles.has(to) || !material.has(from) || from === to) return;
    if (!importersOf.has(from)) importersOf.set(from, new Set());
    importersOf.get(from).add(to);
  };
  if (facts) {
    const fileOfNode = (id) => facts.nodes.get(id)?.filePath ?? null;
    for (const [source, target] of facts.imports) {
      const from = fileOfNode(source);
      const to = fileOfNode(target);
      if (from && to) addImport(from, to);
    }
  }
  for (const m of material.values()) {
    if (languageFamilyOf(m.file) !== 'js') continue;
    for (const to of relativeImports(m.file, m.source, fileSet, unitById.get(m.unit)?.root)) addImport(m.file, to);
  }

  const nodesByFile = new Map();
  if (facts) {
    for (const node of facts.nodes.values()) {
      if (!node.filePath || !node.lineRange || node.type === 'file') continue;
      if (!nodesByFile.has(node.filePath)) nodesByFile.set(node.filePath, []);
      nodesByFile.get(node.filePath).push([node.id, node.lineRange[0], node.lineRange[1]]);
    }
  }

  const candidates = [];
  for (const m of [...material.values()].sort((a, b) => compare(a.file, b.file))) {
    const reasons = [];
    if (m.hits.length > 0) reasons.push(...[...new Set(m.hits.map((h) => `signal:${h.signal}`))]);
    const imported = importersOf.get(m.file);
    if (imported) reasons.push(...[...imported].sort(compare).slice(0, 5).map((f) => `imports-client:${f}`));
    const routes = entryPoints.get(m.file);
    if (routes) reasons.push('route-entry-point');
    if (reasons.length === 0) { counts.notCandidate += 1; classified.push({ file: m.file, unit: m.unit, status: 'not-candidate' }); continue; }
    if (unitById.get(m.unit)?.kind === 'container') {
      // Files a container holds outside its sub-projects are build and tool
      // scripts, not a runtime unit: counted, never analyzed.
      counts.containerSkipped += 1;
      classified.push({ file: m.file, unit: m.unit, status: 'container-skipped' });
      continue;
    }
    counts.candidateFiles += 1;
    // Each candidate is counted once, by its first reason.
    if (m.hits.length > 0) counts.bySignal += 1;
    else if (imported) counts.byClientImport += 1;
    else counts.byEntryPoint += 1;
    classified.push({ file: m.file, unit: m.unit, status: 'candidate' });
    candidates.push({
      file: m.file,
      unit: m.unit,
      lines: m.lines,
      reasons,
      hits: m.hits.slice(0, MAX_HITS_PER_FILE),
      hitsOmitted: Math.max(0, m.hits.length - MAX_HITS_PER_FILE),
      ...(facts ? { graphNodes: (nodesByFile.get(m.file) ?? []).sort((a, b) => a[1] - b[1]).slice(0, MAX_GRAPH_NODES_PER_FILE) } : {}),
      ...(routes ? { entryPoints: [...routes].sort((a, b) => (a.line ?? 0) - (b.line ?? 0)) } : {}),
      sha256: sha256(m.source.join('\n')),
    });
  }

  // Pack per unit.
  const byUnit = new Map();
  for (const c of candidates) {
    const key = c.unit ?? 'unit:?';
    if (!byUnit.has(key)) byUnit.set(key, []);
    byUnit.get(key).push(c);
  }
  const areas = [];
  for (const unit of [...byUnit.keys()].sort(compare)) {
    let current = null;
    for (const c of byUnit.get(unit)) {
      if (c.lines > maxLines) {
        areas.push({ unit, files: [c], lines: c.lines, overBudget: true });
        current = null;
        continue;
      }
      if (current === null || current.lines + c.lines > maxLines) {
        current = { unit, files: [], lines: 0, overBudget: false };
        areas.push(current);
      }
      current.files.push(c);
      current.lines += c.lines;
    }
  }
  const width = Math.max(3, String(areas.length).length);
  areas.forEach((area, i) => { area.areaId = `area-${String(i + 1).padStart(width, '0')}`; });
  counts.areas = areas.length;

  const families = new Map();
  for (const m of material.values()) {
    if (!families.has(m.unit)) families.set(m.unit, new Map());
    const f = families.get(m.unit);
    const fam = languageFamilyOf(m.file);
    f.set(fam, (f.get(fam) ?? 0) + 1);
  }
  const summaries = units.map((u) => ({
    id: u.id, name: u.name, root: u.root, kind: u.kind,
    languages: Object.fromEntries([...(families.get(u.id) ?? new Map())].sort(([a], [b]) => compare(a, b))),
    candidateFiles: (byUnit.get(u.id) ?? []).length,
    addressLines: (unitConfig.get(u.id) ?? []).slice(0, MAX_SUMMARY_ADDRESS_LINES),
  }));

  return {
    classified: classified.sort((a, b) => compare(a.file, b.file)),
    candidates, areas, summaries,
    unitConfig: Object.fromEntries([...unitConfig].map(([k, v]) => [k, v])),
    projectConfig,
    counts,
  };
}

export function inputDigestOf({ unitsDigest, maxLines, candidates, unitConfig, projectConfig }) {
  return sha256(JSON.stringify({
    unitsDigest, signalsVersion: SIGNALS_VERSION, maxLines,
    candidates: candidates.map((c) => `${c.file}:${c.sha256}`),
    unitConfig, projectConfig,
  }));
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

function parseArgs(argv) {
  const args = { projectRoot: null, graph: null, maxLines: DEFAULT_MAX_LINES };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--graph' || arg === '--max-lines') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`split-relation-areas: ${arg} requires a value`);
      i++;
      if (arg === '--graph') args.graph = value;
      else {
        const n = Number.parseInt(value, 10);
        if (!Number.isInteger(n) || n <= 0 || String(n) !== value) throw new Error('split-relation-areas: --max-lines requires a positive integer');
        args.maxLines = n;
      }
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`split-relation-areas: unknown option: ${arg}`);
    if (!args.projectRoot) { args.projectRoot = arg; continue; }
    throw new Error(`split-relation-areas: unexpected argument: ${arg}`);
  }
  if (!args.projectRoot) throw new Error('Usage: node split-relation-areas.mjs <projectRoot> [--graph <knowledge-graph.jsonl>] [--max-lines <n>]');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(args.projectRoot);
  const dataDir = await resolveDataDir(projectRoot);
  const unitsPath = join(dataDir, UNITS_FILE);
  if (!existsSync(unitsPath)) throw new Error(`split-relation-areas: no units at ${unitsPath}; run plan-units.mjs first`);
  const stored = JSON.parse(readFileSync(unitsPath, 'utf-8'));
  if (stored?.format !== UNITS_FORMAT || !Array.isArray(stored.units)) throw new Error(`split-relation-areas: malformed units file ${unitsPath}; run plan-units.mjs again`);
  const graphPath = args.graph ? resolve(args.graph) : null;
  if (graphPath && !existsSync(graphPath)) throw new Error(`split-relation-areas: knowledge graph not found: ${graphPath}`);
  const facts = readGraphFacts(graphPath);

  const files = walkProject(projectRoot);
  const plan = planRelationAreas({
    files, readLines: (f) => readSourceLines(projectRoot, f), units: stored.units, facts, maxLines: args.maxLines,
  });
  const inputDigest = inputDigestOf({ unitsDigest: stored.digest, maxLines: args.maxLines, ...plan });

  const intermediate = join(dataDir, 'intermediate');
  const areasDir = join(intermediate, AREAS_DIR);
  rmSync(areasDir, { recursive: true, force: true });
  mkdirSync(areasDir, { recursive: true });
  const token = randomBytes(16).toString('hex');
  const unitById = new Map(stored.units.map((u) => [u.id, u]));

  const areas = plan.areas.map((area) => {
    const contextFile = join(areasDir, `${area.areaId}.context.json`);
    const outputFile = join(areasDir, `${area.areaId}.relations.json`);
    const unit = unitById.get(area.unit) ?? { id: area.unit, name: null, root: null, kind: null };
    writeJson(contextFile, {
      format: AREA_CONTEXT_FORMAT,
      areaRun: { areaId: area.areaId, token },
      projectRoot,
      output: outputFile,
      kinds: { inScope: IN_SCOPE_KINDS, outOfScope: OUT_OF_SCOPE_KINDS },
      unit: { id: unit.id, name: unit.name, root: unit.root, kind: unit.kind },
      units: plan.summaries,
      files: area.files.map(({ sha256: _sha, ...rest }) => rest),
      unitConfig: plan.unitConfig[area.unit] ?? [],
      projectConfig: plan.projectConfig,
      graph: facts !== null,
    });
    return {
      areaId: area.areaId, unit: area.unit, files: area.files.map((f) => f.file), lines: area.lines,
      overBudget: area.overBudget, contextFile, outputFile,
    };
  });

  writeJson(join(areasDir, 'manifest.json'), {
    format: AREA_MANIFEST_FORMAT,
    token,
    inputDigest,
    unitsDigest: stored.digest,
    maxLines: args.maxLines,
    signalsVersion: SIGNALS_VERSION,
    graph: facts !== null,
    graphPath,
    areas,
    files: plan.classified,
    candidates: plan.candidates.map((c) => ({ file: c.file, unit: c.unit, lines: c.lines, reasons: c.reasons })),
    configFiles: [...new Set([...Object.values(plan.unitConfig).flat(), ...plan.projectConfig].map((r) => r.file))].sort(compare),
    counts: plan.counts,
  });

  for (const area of areas) {
    process.stdout.write(
      `${area.areaId} unit=${area.unit} files=${area.files.length} lines=${area.lines}${area.overBudget ? ' overBudget' : ''} ` +
      `context=${area.contextFile} output=${area.outputFile}\n`,
    );
  }
  const c = plan.counts;
  process.stdout.write(
    `areas=${c.areas} candidates=${c.candidateFiles} (signal=${c.bySignal} client-import=${c.byClientImport} entry-point=${c.byEntryPoint}) ` +
    `sourceFiles=${c.sourceFiles} not-candidate=${c.notCandidate} container-skipped=${c.containerSkipped} test-excluded=${c.testExcluded} unreadable=${c.unreadable} ` +
    `addressLines=${c.addressLines} inputDigest=${inputDigest.slice(0, 12)}\n`,
  );
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
    process.stderr.write(`split-relation-areas.mjs failed: ${err.message}\n`);
    process.exit(1);
  }
}

export default { planRelationAreas, inputDigestOf, relativeImports, scanSignals };
