/**
 * Entrypoint candidates for /excavator-prd (openspec change
 * prd-feature-pipeline, design D1).
 *
 * Reads the project's source statically and lists every line a pattern of
 * `entrypoint-catalog.json` matches, as `{ id, kind, file, line, text,
 * framework }`. Which catalog groups run is decided by the detected
 * frameworks: the knowledge-graph header's `project.frameworks` when the graph
 * is there, otherwise the build files read by the same detector /excavator
 * uses; the catalog's own `detect` rules add the libraries the graph never
 * records (cron libraries, a Go or Node main). Every detected framework lands
 * in exactly one of `covered` (the catalog has patterns for it) or
 * `uncovered`. Every walked file lands in one bucket of `files`. No model
 * call, nothing built or run.
 */

import { closeSync, existsSync, lstatSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { UsageError } from './errors.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(here, '../../..');
export const CATALOG_FILE = resolve(here, '../entrypoint-catalog.json');

export const ENTRYPOINTS_FORMAT = 'excavator-prd-entrypoints/1';
export const KINDS = Object.freeze(['route', 'page', 'job', 'main']);
export const SKIPPED_DIRECTORIES = Object.freeze(['.git', '.excavator', 'node_modules', 'vendor', 'dist', 'build']);
const TEST_FILE = /_test\.go$|\.test\.|\.spec\./;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const TEXT_CAP = 200;
const GRAPH_FILE = join('.excavator', 'knowledge-graph.jsonl');
const HEADER_CAP_BYTES = 16 * 1024 * 1024;

const RESIDUAL = Object.freeze({
  skips: `Directories named ${SKIPPED_DIRECTORIES.join(', ')} and files whose name ends in _test.go or contains .test. or .spec. are not scanned; an entrypoint in them is not listed.`,
  size: `Files over ${MAX_FILE_BYTES} bytes and files with a NUL byte are not scanned; they are counted under files.skipped.`,
  oneLine: 'A pattern matches one line: a registration whose path argument starts on a later line than the call is not listed.',
  oneCandidate: 'One candidate per line: a line that patterns of two frameworks match is credited to the framework listed first in the catalog.',
  react: 'react is listed by the router patterns, only in files whose path contains "router"; a React app routed another way has no candidates under react.',
  noGraph: 'No knowledge graph: frameworks were detected from the build files, by the detector /excavator uses and the catalog\'s own rules.',
});

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Load and shape-check the catalog; a malformed catalog is a usage/IO error, never a silent empty result. */
export function loadCatalog(path = CATALOG_FILE) {
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    throw new UsageError(`cannot read the entrypoint catalog ${path}: ${error.message}`);
  }
  if (catalog === null || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new UsageError(`the entrypoint catalog ${path} is not an object`);
  }
  const groups = [];
  for (const [name, group] of Object.entries(catalog)) {
    const where = `entrypoint catalog: ${name}`;
    if (!Array.isArray(group?.entries) || group.entries.length === 0) throw new UsageError(`${where} has no entries`);
    if (!Array.isArray(group.extensions)) throw new UsageError(`${where} has no extensions list`);
    const entries = group.entries.map((entry, index) => {
      if (!KINDS.includes(entry.kind)) throw new UsageError(`${where} entries[${index}] has kind ${JSON.stringify(entry.kind)}`);
      let regex;
      try {
        regex = new RegExp(entry.pattern, (entry.flags ?? '').replace(/[gy]/g, ''));
      } catch (error) {
        throw new UsageError(`${where} entries[${index}] pattern does not compile: ${error.message}`);
      }
      return { kind: entry.kind, regex, pathHint: typeof entry.pathHint === 'string' ? entry.pathHint.toLowerCase() : null };
    });
    groups.push({ name, extensions: new Set(group.extensions), entries, detect: Array.isArray(group.detect) ? group.detect : null });
  }
  return groups;
}

/** Resolve the scope to a project-relative POSIX path inside the root; null for the whole project. */
function resolveScope(projectRoot, scope) {
  if (scope === undefined || scope === null || scope === '' || scope === '.') return null;
  const target = resolve(projectRoot, scope);
  let real;
  try {
    real = realpathSync(target);
  } catch {
    throw new UsageError(`--scope ${scope} does not exist under ${projectRoot}`);
  }
  const rel = relative(projectRoot, real);
  if (rel === '') return null;
  if (rel.startsWith('..') || resolve(projectRoot, rel) !== real || !statSync(real).isDirectory()) {
    throw new UsageError(`--scope ${scope} is not a directory inside ${projectRoot}`);
  }
  return rel.split(sep).join('/');
}

/** The first line of the knowledge graph, read without loading the whole file. */
function readGraphFrameworks(projectRoot) {
  const path = join(projectRoot, GRAPH_FILE);
  if (!existsSync(path)) return { state: 'absent' };
  let fd;
  try {
    fd = openSync(path, 'r');
    const chunks = [];
    let total = 0;
    const buffer = Buffer.alloc(64 * 1024);
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, total);
      if (read === 0) break;
      const chunk = Buffer.from(buffer.subarray(0, read));
      const end = chunk.indexOf(0x0a);
      chunks.push(end === -1 ? chunk : chunk.subarray(0, end));
      total += read;
      if (end !== -1) break;
      if (total > HEADER_CAP_BYTES) return { state: 'unreadable', reason: `line 1 is longer than ${HEADER_CAP_BYTES} bytes` };
    }
    const header = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    const frameworks = header?.record === 'header' ? header.fields?.project?.frameworks : undefined;
    if (!Array.isArray(frameworks) || !frameworks.every((value) => typeof value === 'string')) {
      return { state: 'unreadable', reason: 'line 1 is not a header with fields.project.frameworks' };
    }
    return { state: 'read', frameworks };
  } catch (error) {
    return { state: 'unreadable', reason: error.message };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The detector /excavator's scan uses, from the plugin's own @excavator/core build. */
async function loadFrameworkRegistry() {
  const require = createRequire(join(PLUGIN_ROOT, 'package.json'));
  let core;
  try {
    core = await import(pathToFileURL(require.resolve('@excavator/core')).href);
  } catch {
    try {
      core = await import(pathToFileURL(join(PLUGIN_ROOT, 'packages/core/dist/index.js')).href);
    } catch (error) {
      throw new UsageError(`cannot load @excavator/core to detect frameworks (build the plugin with pnpm -r build): ${error.message}`);
    }
  }
  return core.FrameworkRegistry.createDefault();
}

/**
 * Walk `startRel` under `projectRoot` in code-unit order, without following
 * symlinks. Calls `onFile(rel, abs)` for each regular file; counts the rest.
 */
function walk(projectRoot, startRel, stats, onFile) {
  const stack = [startRel ?? ''];
  while (stack.length > 0) {
    const rel = stack.pop();
    const abs = rel === '' ? projectRoot : join(projectRoot, rel);
    const names = readdirSync(abs).sort(compare);
    const subdirs = [];
    for (const name of names) {
      const childRel = rel === '' ? name : `${rel}/${name}`;
      const childAbs = join(abs, name);
      const info = lstatSync(childAbs);
      if (info.isSymbolicLink()) {
        stats.seen += 1;
        stats.skipped.symlink += 1;
      } else if (info.isDirectory()) {
        if (SKIPPED_DIRECTORIES.includes(name)) {
          stats.skippedDirectories[name] = (stats.skippedDirectories[name] ?? 0) + 1;
        } else {
          subdirs.push(childRel);
        }
      } else if (info.isFile()) {
        stats.seen += 1;
        onFile(childRel, childAbs, info.size);
      } else {
        stats.seen += 1;
        stats.skipped.unreadable += 1;
      }
    }
    for (let i = subdirs.length - 1; i >= 0; i -= 1) stack.push(subdirs[i]);
  }
}

/** Manifests directly in each directory from the root down to (not including) the scope. */
function ancestorManifests(projectRoot, scopeRel, isManifest) {
  if (scopeRel === null) return [];
  const parts = scopeRel.split('/');
  const found = [];
  for (let depth = 0; depth < parts.length; depth += 1) {
    const dirRel = parts.slice(0, depth).join('/');
    const dirAbs = dirRel === '' ? projectRoot : join(projectRoot, dirRel);
    for (const name of readdirSync(dirAbs).sort(compare)) {
      const rel = dirRel === '' ? name : `${dirRel}/${name}`;
      const info = lstatSync(join(dirAbs, name));
      if (info.isFile() && isManifest(rel)) found.push(rel);
    }
  }
  return found;
}

function readManifest(projectRoot, rel) {
  try {
    return readFileSync(join(projectRoot, rel), 'utf-8');
  } catch {
    return null;
  }
}

/** True when one of a catalog group's `detect` rules matches one of the manifests. */
function detectedByCatalog(group, manifests) {
  return group.detect.some((rule) => manifests.some(({ path, content }) => {
    if (content === null || basename(path) !== rule.manifest) return false;
    if (rule.manifest === 'package.json') {
      let pkg;
      try {
        pkg = JSON.parse(content);
      } catch {
        return false;
      }
      if (rule.dependency !== undefined) {
        return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
          .some((key) => pkg?.[key] !== null && typeof pkg?.[key] === 'object' && Object.hasOwn(pkg[key], rule.dependency));
      }
      if (rule.field !== undefined) return pkg !== null && typeof pkg === 'object' && pkg[rule.field] !== undefined && pkg[rule.field] !== null;
      return true;
    }
    if (rule.require !== undefined) {
      return content.split('\n').some((raw) => {
        const line = raw.replace(/\/\/.*$/, '').trim().replace(/^require\s+/, '').replace(/^\(\s*/, '');
        const module = line.split(/\s+/)[0];
        return module === rule.require || module.startsWith(`${rule.require}/`);
      });
    }
    return true;
  }));
}

/**
 * List the entrypoint candidates of `projectRoot` (optionally only under
 * `scope`). Returns the JSON object `prd.mjs entrypoints` prints.
 */
export async function listEntrypoints(projectRootArg, { scope = null, catalogPath = CATALOG_FILE } = {}) {
  let projectRoot;
  try {
    projectRoot = realpathSync(resolve(projectRootArg));
  } catch {
    throw new UsageError(`project ${projectRootArg} does not exist`);
  }
  if (!statSync(projectRoot).isDirectory()) throw new UsageError(`project ${projectRootArg} is not a directory`);
  const scopeRel = resolveScope(projectRoot, scope);
  const groups = loadCatalog(catalogPath);
  const catalogManifests = new Set(groups.flatMap((group) => (group.detect ?? []).map((rule) => rule.manifest)));

  const graph = readGraphFrameworks(projectRoot);
  const registry = graph.state === 'read' ? null : await loadFrameworkRegistry();
  const isManifest = (rel) => catalogManifests.has(basename(rel)) || (registry !== null && registry.isManifestPath(rel));

  // Pass 1: every file under the scope, with the manifests among them.
  const stats = {
    seen: 0,
    scanned: 0,
    otherExtension: 0,
    skipped: { 'test-file': 0, 'too-large': 0, binary: 0, symlink: 0, unreadable: 0 },
    skippedDirectories: {},
  };
  const files = [];
  walk(projectRoot, scopeRel, stats, (rel, abs, size) => files.push({ rel, abs, size }));
  const manifestPaths = [...ancestorManifests(projectRoot, scopeRel, isManifest), ...files.filter((f) => isManifest(f.rel)).map((f) => f.rel)];
  const manifests = manifestPaths.map((path) => ({ path, content: readManifest(projectRoot, path) }));

  // Detected frameworks: the graph header, else the build-file detector; plus the catalog's own rules.
  const detected = new Set(graph.state === 'read'
    ? graph.frameworks
    : registry.detectWithEvidence(manifests.filter((m) => m.content !== null)).map((d) => d.id));
  for (const group of groups) {
    if (group.detect !== null && detectedByCatalog(group, manifests)) detected.add(group.name);
  }
  const frameworks = [...detected].sort(compare);
  const groupNames = new Set(groups.map((group) => group.name));
  const covered = frameworks.filter((name) => groupNames.has(name));
  const uncovered = frameworks.filter((name) => !groupNames.has(name));
  const active = groups.filter((group) => covered.includes(group.name));

  // Pass 2: match each scanned line; the first matching group in catalog order wins the line.
  const found = [];
  for (const file of files) {
    const ext = extname(file.rel);
    const groupsForFile = active.filter((group) => group.extensions.has(ext));
    if (groupsForFile.length === 0) {
      stats.otherExtension += 1;
      continue;
    }
    if (TEST_FILE.test(basename(file.rel))) {
      stats.skipped['test-file'] += 1;
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      stats.skipped['too-large'] += 1;
      continue;
    }
    let bytes;
    try {
      bytes = readFileSync(file.abs);
    } catch {
      stats.skipped.unreadable += 1;
      continue;
    }
    if (bytes.includes(0)) {
      stats.skipped.binary += 1;
      continue;
    }
    stats.scanned += 1;
    const hintPath = `/${file.rel}`.toLowerCase();
    const lines = bytes.toString('utf-8').split('\n');
    lines.forEach((raw, index) => {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      for (const group of groupsForFile) {
        const entry = group.entries.find((e) => (e.pathHint === null || hintPath.includes(e.pathHint)) && e.regex.test(line));
        if (entry) {
          found.push({ kind: entry.kind, file: file.rel, line: index + 1, text: Array.from(line.trim()).slice(0, TEXT_CAP).join(''), framework: group.name });
          return;
        }
      }
    });
  }
  found.sort((a, b) => compare(a.file, b.file) || a.line - b.line);
  const items = found.map((item, index) => ({ id: `c${index + 1}`, ...item }));
  const byFramework = Object.fromEntries(covered.map((name) => [name, items.filter((item) => item.framework === name).length]));

  const residualAssumptions = [RESIDUAL.skips, RESIDUAL.size, RESIDUAL.oneLine, RESIDUAL.oneCandidate];
  if (covered.includes('react')) residualAssumptions.push(RESIDUAL.react);
  if (graph.state === 'absent') residualAssumptions.push(RESIDUAL.noGraph);
  if (graph.state === 'unreadable') {
    residualAssumptions.push(`The knowledge graph header could not be read (${graph.reason}); frameworks were detected from the build files instead.`);
  }

  return {
    format: ENTRYPOINTS_FORMAT,
    projectRoot,
    scope: scopeRel,
    detection: { source: graph.state === 'read' ? 'knowledge-graph' : 'build-files', graph: graph.state },
    frameworks,
    covered,
    uncovered,
    byFramework,
    items,
    files: { seen: stats.seen, scanned: stats.scanned, otherExtension: stats.otherExtension, skipped: stats.skipped },
    skippedDirectories: Object.fromEntries(Object.entries(stats.skippedDirectories).sort(([a], [b]) => compare(a, b))),
    residualAssumptions,
  };
}
