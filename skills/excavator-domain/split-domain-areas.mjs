#!/usr/bin/env node
/**
 * split-domain-areas.mjs
 *
 * Cuts the domain skill's candidate material into bounded areas so that one
 * domain-analyzer is dispatched per area instead of one for the whole
 * project. A single analyzer facing a large project reads what fits and skips
 * the rest without saying so; this split is the deterministic floor under
 * coverage: every non-test source file lands in exactly one area, and the
 * merge step (merge-domain-areas.mjs) reports per area and per module which
 * ones came back with no flow.
 *
 *   module = the directory a source file is in ("." for the project root).
 *   area   = consecutive modules, in path order, whose material fits the
 *            byte budget and whose entry points fit the entry-point budget.
 *            A module over either budget is split by file into numbered
 *            parts, one area each. A single file over either budget is its
 *            own part, marked overBudget, never cut.
 *
 * The material of a file is its entry points, its signature and (when
 * --graph is given) the knowledge-graph nodes on that file. An area's
 * `bytes` is the JSON size of that material; project metadata and the list
 * of other areas are added on top and are not counted against the budget.
 *
 * Freshness: every run first deletes intermediate/domain-areas/ and
 * intermediate/domain-analysis.json, then writes a random token into the
 * manifest and into every area context. The analyzer echoes it back as
 * `areaRun`; an output without the current token (an earlier run's file, an
 * old domain-graph.json copied into place) is rejected by the merge.
 *
 * Usage:
 *   node split-domain-areas.mjs <projectRoot>
 *     [--context <domain-context.json>] [--graph <knowledge-graph.jsonl>]
 *     [--budget-bytes <n>] [--max-entry-points <n>]
 *
 * Writes intermediate/domain-areas/manifest.json and one
 * <areaId>.context.json per area; prints one line per area to stdout.
 * Logging: stderr.
 */

import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readKnowledgeGraph } from '../excavator/knowledge-graph-store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

export const AREA_CONTEXT_FORMAT = 'excavator-domain-area/1';
export const AREA_MANIFEST_FORMAT = 'excavator-domain-areas/1';
export const DEFAULT_BUDGET_BYTES = 150_000;
export const DEFAULT_MAX_ENTRY_POINTS = 40;
export const AREAS_DIR = 'domain-areas';

/** Test files hold no business flow; the extractor skips the same shapes for entry points. */
const TEST_FILE = /(?:\.test\.|\.spec\.|__tests__\/|_test\.go$|_test\.py$|(?:^|\/)test_\w+\.py$)/;

export function isTestFile(path) {
  return TEST_FILE.test(path);
}

export function moduleOf(path) {
  const dir = posix.dirname(path);
  return dir === '' ? '.' : dir;
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A project-relative POSIX path, or null when the path is absolute or
 * resolves outside the root. Paths come from an artifact, so they are
 * untrusted input: one that escapes the root is counted, never placed.
 */
export function relativeInsideRoot(path) {
  if (typeof path !== 'string' || path.length === 0) return null;
  const slashed = path.replace(/\\/g, '/');
  if (isAbsolute(slashed) || /^[A-Za-z]:\//.test(slashed)) return null;
  const normal = posix.normalize(slashed);
  if (normal === '..' || normal.startsWith('../') || normal === '.') return null;
  return normal.replace(/^\.\//, '');
}

function bytesOf(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf-8');
}

function graphNodeView(node, filePath) {
  const view = { id: node.id, type: node.type, name: node.name, filePath };
  if (typeof node.summary === 'string') view.summary = node.summary;
  if (Array.isArray(node.lineRange)) view.lineRange = node.lineRange;
  return view;
}

/**
 * Pure planning over an already-read domain context (and optional graph
 * nodes). Returns { modules, areas, counts }; areas carry their material.
 */
export function planAreas({
  context, graphNodes = null, budgetBytes = DEFAULT_BUDGET_BYTES, maxEntryPoints = DEFAULT_MAX_ENTRY_POINTS,
}) {
  if (!Number.isInteger(budgetBytes) || budgetBytes <= 0) throw new Error('budgetBytes must be a positive integer');
  if (!Number.isInteger(maxEntryPoints) || maxEntryPoints <= 0) throw new Error('maxEntryPoints must be a positive integer');
  const counts = {
    sourceFiles: 0,
    testFilesExcluded: 0,
    contextFilesOutsideRoot: 0,
    modules: 0,
    areas: 0,
    entryPoints: 0,
    entryPointsOutsideModules: 0,
    graphNodesAttached: 0,
    graphNodesOutsideRoot: 0,
    graphNodesOutsideModules: 0,
    graphNodesWithoutFile: 0,
  };

  // Files, by module.
  const fileMaterial = new Map();
  for (const raw of context?.fileTree ?? []) {
    const file = relativeInsideRoot(raw);
    if (file === null) { counts.contextFilesOutsideRoot += 1; continue; }
    if (isTestFile(file)) { counts.testFilesExcluded += 1; continue; }
    if (fileMaterial.has(file)) continue;
    fileMaterial.set(file, { file, entryPoints: [], signature: null, graphNodes: [] });
  }
  counts.sourceFiles = fileMaterial.size;

  for (const entry of context?.entryPoints ?? []) {
    const file = relativeInsideRoot(entry?.file);
    const material = file === null ? undefined : fileMaterial.get(file);
    if (!material) { counts.entryPointsOutsideModules += 1; continue; }
    material.entryPoints.push({ ...entry, file });
    counts.entryPoints += 1;
  }
  for (const signature of context?.fileSignatures ?? []) {
    const file = relativeInsideRoot(signature?.file);
    const material = file === null ? undefined : fileMaterial.get(file);
    if (material && material.signature === null) material.signature = { ...signature, file };
  }
  if (Array.isArray(graphNodes)) {
    for (const node of graphNodes) {
      if (!node || typeof node !== 'object') continue;
      if (typeof node.filePath !== 'string' || node.filePath.length === 0) { counts.graphNodesWithoutFile += 1; continue; }
      const file = relativeInsideRoot(node.filePath);
      if (file === null) { counts.graphNodesOutsideRoot += 1; continue; }
      const material = fileMaterial.get(file);
      if (!material) { counts.graphNodesOutsideModules += 1; continue; }
      material.graphNodes.push(graphNodeView(node, file));
      counts.graphNodesAttached += 1;
    }
  }

  const byModule = new Map();
  for (const material of fileMaterial.values()) {
    const module = moduleOf(material.file);
    if (!byModule.has(module)) byModule.set(module, []);
    byModule.get(module).push(material);
  }
  const modulePaths = [...byModule.keys()].sort(compare);
  for (const list of byModule.values()) list.sort((a, b) => compare(a.file, b.file));
  counts.modules = modulePaths.length;

  // Pack.
  const areas = [];
  let current = null;
  const open = () => {
    current = { modules: [], files: [], bytes: 0, entries: 0, overBudget: false };
    areas.push(current);
  };
  const close = () => { current = null; };
  for (const path of modulePaths) {
    const files = byModule.get(path);
    const sizes = files.map((m) => bytesOf(m));
    const total = sizes.reduce((a, b) => a + b, 0);
    const entries = files.reduce((n, m) => n + m.entryPoints.length, 0);
    if (total <= budgetBytes && entries <= maxEntryPoints) {
      if (current === null || current.bytes + total > budgetBytes || current.entries + entries > maxEntryPoints) open();
      current.modules.push({ path, part: null, files: files.map((m) => m.file) });
      current.files.push(...files);
      current.bytes += total;
      current.entries += entries;
      continue;
    }
    // Larger than the budget: numbered parts, one area each.
    close();
    const parts = [];
    let part = null;
    files.forEach((material, i) => {
      const n = material.entryPoints.length;
      const full = part !== null && part.files.length > 0
        && (part.bytes + sizes[i] > budgetBytes || part.entries + n > maxEntryPoints);
      if (part === null || full) {
        part = { files: [], bytes: 0, entries: 0 };
        parts.push(part);
      }
      part.files.push(material);
      part.bytes += sizes[i];
      part.entries += n;
    });
    parts.forEach((p, i) => {
      open();
      current.modules.push({ path, part: { index: i + 1, of: parts.length }, files: p.files.map((m) => m.file) });
      current.files.push(...p.files);
      current.bytes = p.bytes;
      current.entries = p.entries;
      current.overBudget = p.bytes > budgetBytes || p.entries > maxEntryPoints;
      close();
    });
  }

  const width = Math.max(3, String(areas.length).length);
  const finished = areas.map((area, i) => {
    const areaId = `area-${String(i + 1).padStart(width, '0')}`;
    return {
      areaId,
      modules: area.modules.map((m) => ({ ...m, areaId })),
      bytes: area.bytes,
      overBudget: area.overBudget,
      entryPoints: area.files.flatMap((m) => m.entryPoints),
      fileSignatures: area.files.map((m) => m.signature).filter(Boolean),
      graphNodes: area.files.flatMap((m) => m.graphNodes),
    };
  });
  counts.areas = finished.length;

  const modules = modulePaths.map((path) => {
    const files = byModule.get(path);
    return {
      path,
      files: files.map((m) => m.file),
      entryPoints: files.reduce((n, m) => n + m.entryPoints.length, 0),
      candidateFiles: files.filter((m) => m.entryPoints.length > 0).map((m) => m.file),
      areas: finished.filter((a) => a.modules.some((m) => m.path === path)).map((a) => a.areaId),
    };
  });

  return { modules, areas: finished, counts };
}

function parseArgs(argv) {
  const args = {
    projectRoot: null, context: null, graph: null,
    budgetBytes: DEFAULT_BUDGET_BYTES, maxEntryPoints: DEFAULT_MAX_ENTRY_POINTS,
  };
  const numeric = { '--budget-bytes': 'budgetBytes', '--max-entry-points': 'maxEntryPoints' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--context' || arg === '--graph' || numeric[arg]) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`split-domain-areas: ${arg} requires a value`);
      i++;
      if (numeric[arg]) {
        const n = Number.parseInt(value, 10);
        if (!Number.isInteger(n) || n <= 0 || String(n) !== value) throw new Error(`split-domain-areas: ${arg} requires a positive integer`);
        args[numeric[arg]] = n;
      } else {
        args[arg.slice(2)] = value;
      }
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`split-domain-areas: unknown option: ${arg}`);
    if (!args.projectRoot) { args.projectRoot = arg; continue; }
    throw new Error(`split-domain-areas: unexpected argument: ${arg}`);
  }
  if (!args.projectRoot) {
    throw new Error('Usage: node split-domain-areas.mjs <projectRoot> [--context <path>] [--graph <path>] [--budget-bytes <n>] [--max-entry-points <n>]');
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(args.projectRoot);
  const dataDir = await resolveDataDir(projectRoot);
  const intermediate = join(dataDir, 'intermediate');
  const contextPath = resolve(args.context ?? join(intermediate, 'domain-context.json'));
  if (!existsSync(contextPath)) throw new Error(`split-domain-areas: domain context not found: ${contextPath}`);
  const context = JSON.parse(readFileSync(contextPath, 'utf-8'));
  const graphPath = args.graph ? resolve(args.graph) : null;
  if (graphPath && !existsSync(graphPath)) throw new Error(`split-domain-areas: knowledge graph not found: ${graphPath}`);
  const graphNodes = graphPath ? (readKnowledgeGraph(graphPath)?.nodes ?? []) : null;

  const plan = planAreas({ context, graphNodes, budgetBytes: args.budgetBytes, maxEntryPoints: args.maxEntryPoints });

  // Freshness: nothing an earlier run left may be mistaken for this run's output.
  const areasDir = join(intermediate, AREAS_DIR);
  rmSync(areasDir, { recursive: true, force: true });
  rmSync(join(intermediate, 'domain-analysis.json'), { force: true });
  mkdirSync(areasDir, { recursive: true });

  const token = randomBytes(16).toString('hex');
  const index = plan.areas.map((area) => ({
    areaId: area.areaId,
    modules: area.modules.map((m) => m.path),
  }));
  const areas = plan.areas.map((area) => {
    const contextFile = join(areasDir, `${area.areaId}.context.json`);
    const outputFile = join(areasDir, `${area.areaId}.analysis.json`);
    writeJson(contextFile, {
      format: AREA_CONTEXT_FORMAT,
      areaRun: { areaId: area.areaId, token },
      projectRoot,
      output: outputFile,
      modules: area.modules.map(({ path, part, files }) => ({ path, part, files })),
      entryPoints: area.entryPoints,
      fileSignatures: area.fileSignatures,
      ...(graphNodes ? { graphNodes: area.graphNodes } : {}),
      metadata: context?.metadata ?? {},
      otherAreas: index.filter((other) => other.areaId !== area.areaId),
    });
    return {
      areaId: area.areaId,
      contextFile,
      outputFile,
      modules: area.modules.map(({ path, part }) => ({ path, part })),
      files: area.modules.reduce((n, m) => n + m.files.length, 0),
      entryPoints: area.entryPoints.length,
      graphNodes: area.graphNodes.length,
      bytes: area.bytes,
      overBudget: area.overBudget,
    };
  });

  writeJson(join(areasDir, 'manifest.json'), {
    format: AREA_MANIFEST_FORMAT,
    token,
    budgetBytes: args.budgetBytes,
    maxEntryPoints: args.maxEntryPoints,
    graph: graphNodes !== null,
    contextPath,
    areas,
    modules: plan.modules,
    counts: plan.counts,
    truncated: context?.truncated ?? null,
  });

  for (const area of areas) {
    process.stdout.write(
      `${area.areaId} modules=${area.modules.length} files=${area.files} entryPoints=${area.entryPoints} ` +
      `graphNodes=${area.graphNodes} bytes=${area.bytes}${area.overBudget ? ' overBudget' : ''} ` +
      `context=${area.contextFile} output=${area.outputFile}\n`,
    );
  }
  const c = plan.counts;
  process.stderr.write(
    `split-domain-areas: areas=${c.areas} modules=${c.modules} sourceFiles=${c.sourceFiles} ` +
    `entryPoints=${c.entryPoints} testFilesExcluded=${c.testFilesExcluded} ` +
    `contextFilesOutsideRoot=${c.contextFilesOutsideRoot} graphNodesAttached=${c.graphNodesAttached} ` +
    `graphNodesOutsideRoot=${c.graphNodesOutsideRoot} graphNodesOutsideModules=${c.graphNodesOutsideModules}\n`,
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
    process.stderr.write(`split-domain-areas.mjs failed: ${err.message}\n`);
    process.exit(1);
  }
}

export default { planAreas, moduleOf, isTestFile, relativeInsideRoot };
