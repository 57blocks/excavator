#!/usr/bin/env node
/**
 * build-fact-graph.mjs
 *
 * Lazy-first-run deterministic Fact Builder (openspec: changes/lazy-first-run,
 * capability `fact-graph`). This is a PROJECTION (design D1), not a new
 * extractor: it reads the outputs of `scan-project.mjs`, `structure-all.mjs`
 * (which itself only wraps `extract-structure.mjs`) and
 * `extract-import-map.mjs`, and folds them into the deterministic fact layer —
 * fact nodes, fact edges, a coverage ledger and a gap list, plus a
 * `factsDigest` over that projection alone.
 *
 * MUST NOT call any model. MUST NOT re-parse source (no file reads besides the
 * three JSON inputs below) — every fact is already sitting in those JSON
 * documents; this script only normalizes and cross-references them. Two runs
 * over the same three inputs produce a byte-identical projection.
 *
 * Node identity: every node id is derived via `deriveNodeId` from
 * node-identity.mjs — the single shared authority also used by the chat cache
 * lookup (Slice A / Task 1). Identity collisions are detected via
 * `collectNodeIds` and surfaced as a gap, never silently merged.
 *
 * Contract: openspec/changes/lazy-first-run/specs/fact-graph/spec.md
 *
 * Usage (CLI):
 *   node build-fact-graph.mjs <projectRoot>
 *     [--scan <scan-result.json>] [--structure <structure-all.json>]
 *     [--import-map <import-map.json>] [--out <fact-graph.json>]
 *
 * Programmatic:
 *   import { buildFactGraph } from './build-fact-graph.mjs';
 *   const projection = buildFactGraph({ scan, structureAll, importMap });
 *
 * The programmatic path takes plain, already-parsed JSON objects and does no
 * I/O — it is what tests call with small synthetic in-memory fixtures. Only
 * the CLI entry (`main()`) touches disk, and only there does the script
 * resolve `@excavator/core` (for `resolveDataDir`, to find the default
 * `.excavator/intermediate/*.json` paths) — the programmatic export never
 * requires @excavator/core to be installed or built.
 *
 * Logging: stderr only.
 */

import { basename, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname } from 'node:path';
import { existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { deriveNodeId, collectNodeIds } from './node-identity.mjs';
import { buildCoverageLedger, compareGaps } from './coverage-ledger.mjs';
import {
  compareStrings,
  complexityFromLoc,
  matchImportLine,
  mapDeclarationKind,
  assignOrdinals,
  lookupCandidates,
  canonicalizeForDigest,
  sha256Hex,
  createGapCollector,
} from './fact-graph-resolve.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Build one raw declaration entry per non-code array item (definitions,
 *  services, endpoints, steps, resources — the optional structure-all
 *  fields). Kept separate
 *  from the main loop below only for readability — each field's shape is
 *  slightly different (see extract-structure-result.mjs's per-field mapping). */
function nonCodeEntries(row) {
  const out = [];
  for (const def of row.definitions ?? []) {
    out.push({
      path: row.path, type: mapDeclarationKind(def.kind), name: def.name,
      lineRange: [def.startLine, def.endLine], __anchor: 'rule',
    });
  }
  for (const svc of row.services ?? []) {
    out.push({
      path: row.path, type: 'service', name: svc.name,
      lineRange: svc.startLine != null ? [svc.startLine, svc.endLine] : null, __anchor: 'rule',
    });
  }
  for (const ep of row.endpoints ?? []) {
    out.push({
      path: row.path, type: 'endpoint', name: `${ep.method ?? ''} ${ep.path}`.trim(),
      lineRange: [ep.startLine, ep.endLine], __anchor: 'rule',
    });
  }
  for (const step of row.steps ?? []) {
    out.push({
      path: row.path, type: 'pipeline', name: step.name,
      lineRange: [step.startLine, step.endLine], __anchor: 'rule',
    });
  }
  for (const res of row.resources ?? []) {
    out.push({
      path: row.path, type: mapDeclarationKind(res.kind), name: res.name,
      lineRange: [res.startLine, res.endLine], __anchor: 'rule',
    });
  }
  return out;
}

// A separator that cannot appear in a path/owner/type segment, built via
// fromCharCode (not a literal escape in this source file) so nothing in the
// authoring/transport path can turn it into a stray control byte.
const ORDINAL_KEY_SEP = String.fromCharCode(31); // ASCII unit separator

/** Group key for ordinal assignment: same (path, owner, kind). */
function ordinalGroupKey(entry) {
  return [entry.path, entry.owner ?? '', entry.type].join(ORDINAL_KEY_SEP);
}

/**
 * The deterministic projection. Pure function of its three arguments; no I/O,
 * no model call, no source re-read.
 *
 * @param {{ scan: object, structureAll: object, importMap?: object|null }} args
 * @returns {{ nodes: object[], edges: object[], coverage: object, gaps: object[], factsDigest: string }}
 */
export function buildFactGraph({ scan, structureAll, importMap }) {
  if (!scan || !Array.isArray(scan.files)) {
    throw new Error('buildFactGraph: scan.files must be an array');
  }
  if (!structureAll || !Array.isArray(structureAll.results)) {
    throw new Error('buildFactGraph: structureAll.results must be an array');
  }
  const importMapSafe = importMap && typeof importMap === 'object'
    ? importMap
    : { importMap: {}, unresolved: {} };

  const languageOfPath = new Map(scan.files.map((f) => [f.path, f.language]));
  // structure-all.mjs guarantees one row per scanned file, sorted by path.
  const fileRows = [...structureAll.results].sort((a, b) => compareStrings(a.path, b.path));
  const fileRowByPath = new Map(fileRows.map((r) => [r.path, r]));

  // -------------------------------------------------------------------------
  // Pass 1: collect every declaration, in source order, across all files.
  // -------------------------------------------------------------------------
  const declEntries = [];
  for (const row of fileRows) {
    for (const fn of row.functions ?? []) {
      declEntries.push({
        path: row.path, type: 'function', name: fn.name, owner: fn.owner,
        params: fn.params ?? [], returnType: fn.returnType,
        lineRange: [fn.startLine, fn.endLine], __anchor: 'tree-sitter',
      });
    }
    for (const cls of row.classes ?? []) {
      declEntries.push({
        path: row.path, type: 'class', name: cls.name,
        lineRange: [cls.startLine, cls.endLine], __anchor: 'tree-sitter',
      });
    }
    for (const entry of nonCodeEntries(row)) declEntries.push(entry);
  }

  const withOrdinals = assignOrdinals(declEntries, ordinalGroupKey);

  // -------------------------------------------------------------------------
  // Identity collisions — detected globally via the shared authority, never
  // silently merged. Reported as a gap; the graph still gets exactly one node
  // per id (first declaration in source order wins), so node ids stay unique.
  // -------------------------------------------------------------------------
  const { collisions } = collectNodeIds(withOrdinals);

  const gapCollector = createGapCollector(5);
  for (const collision of collisions) {
    // One gap bucket per colliding id (scope = the id itself, since a
    // collision is inherently id-scoped, not language-scoped); `count` is the
    // number of distinguishable declarations that collapsed onto it, and
    // `.add` bounds the sample list on its own — call it once per decl so the
    // count is exact even when a group has more members than the sample cap.
    for (const decl of collision.decls) {
      const [start, end] = decl.lineRange ?? ['?', '?'];
      gapCollector.add('identity-collision', collision.id, `${decl.path}:${start}-${end}`);
    }
  }

  // -------------------------------------------------------------------------
  // Pass 2: nodes. First declaration to claim an id wins; later ones with the
  // same id are the collisions just recorded above and are not double-added.
  // -------------------------------------------------------------------------
  const nodesById = new Map();
  const idOf = new Map(); // declEntry -> id (keyed by reference; entries are never reused)
  for (const entry of withOrdinals) {
    const id = deriveNodeId(entry);
    idOf.set(entry, id);
    if (nodesById.has(id)) continue;
    nodesById.set(id, {
      id,
      type: entry.type,
      name: entry.name,
      filePath: entry.path,
      ...(entry.lineRange ? { lineRange: entry.lineRange } : {}),
      ...(entry.owner ? { owner: entry.owner } : {}),
      anchorSource: entry.__anchor,
      summary: '',
      tags: [],
      // Per-declaration complexity uses the line-SPAN as its non-blank-line
      // proxy: build-fact-graph reads only scan/structure-all/import-map JSON
      // and never re-opens source files, so it has no way to count actual
      // blank lines inside a declaration's range. The FILE node below uses
      // structure-all's exact `nonEmptyLines` instead, because that count is
      // already computed there without a re-read. Documented assumption —
      // see the task report.
      complexity: complexityFromLoc(
        entry.lineRange ? entry.lineRange[1] - entry.lineRange[0] + 1 : 0,
      ),
    });
  }

  for (const row of fileRows) {
    const id = deriveNodeId({ type: 'file', path: row.path });
    nodesById.set(id, {
      id,
      type: 'file',
      name: basename(row.path),
      filePath: row.path,
      anchorSource: 'census',
      summary: '',
      tags: [],
      complexity: complexityFromLoc(row.nonEmptyLines ?? 0),
    });
  }

  // Index of function/class nodes by (path, bare name) -> nodeRef[], for
  // exports/calls resolution. Deduped by id so an identity-collision pair
  // (same final node, different source decl) counts once, not as an
  // ambiguity. Owner is preserved (never collapsed) so two distinguishable
  // same-named declarations remain two distinguishable candidates.
  const declByPathName = new Map();
  for (const entry of withOrdinals) {
    if (entry.type !== 'function' && entry.type !== 'class') continue;
    const id = idOf.get(entry);
    const key = `${entry.path}|${entry.name}`;
    if (!declByPathName.has(key)) declByPathName.set(key, []);
    const list = declByPathName.get(key);
    if (!list.some((x) => x.id === id)) {
      list.push({ id, owner: entry.owner ?? null, lineRange: entry.lineRange, type: entry.type });
    }
  }
  const classIdByPathName = new Map();
  for (const entry of withOrdinals) {
    if (entry.type !== 'class') continue;
    classIdByPathName.set(`${entry.path}|${entry.name}`, idOf.get(entry));
  }

  // -------------------------------------------------------------------------
  // Edges: contains (file -> decl, class -> method by owner), exports,
  // imports, calls.
  // -------------------------------------------------------------------------
  const edges = [];
  const edgeKeys = new Set();
  function addEdge(edge) {
    const key = `${edge.type}|${edge.source}|${edge.target}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(edge);
  }

  const fileIdOf = (path) => deriveNodeId({ type: 'file', path });

  for (const entry of withOrdinals) {
    const id = idOf.get(entry);
    addEdge({
      source: fileIdOf(entry.path),
      target: id,
      type: 'contains',
      direction: 'forward',
      weight: 1,
      evidence: entry.lineRange
        ? [{ file: entry.path, line: entry.lineRange[0], endLine: entry.lineRange[1], source: entry.__anchor }]
        : [],
      provenance: entry.lineRange ? 'extracted' : 'inferred',
    });
  }

  // class -> method, only when a function's owner names a class in the SAME
  // file (Go receivers, Rust impl blocks, C++ qualifiers — structure-all
  // carries `owner` for these; TypeScript/JS methods are not in `functions`
  // at all, see build-fact-graph's design notes, so they get no method node
  // and therefore no class -> method edge here — file -> class still holds).
  for (const entry of withOrdinals) {
    if (entry.type !== 'function' || !entry.owner) continue;
    const classId = classIdByPathName.get(`${entry.path}|${entry.owner}`);
    if (!classId) continue;
    addEdge({
      source: classId,
      target: idOf.get(entry),
      type: 'contains',
      direction: 'forward',
      weight: 1,
      evidence: [{ file: entry.path, line: entry.lineRange[0], endLine: entry.lineRange[1], source: entry.__anchor }],
      provenance: 'extracted',
    });
  }

  // Class methods the extractor lists by NAME only (TypeScript/JS put methods
  // in classes[].methods with no line range, so they cannot become fact nodes).
  // Rather than let them vanish, record a visible gap for any method not already
  // projected as an owner-carrying function node (Go/Rust/C++ methods ARE in
  // functions[] with owner, so they are found here and skipped — no false gap).
  for (const row of fileRows) {
    const lang = languageOfPath.get(row.path) ?? row.language ?? 'unknown';
    for (const cls of row.classes ?? []) {
      for (const methodName of cls.methods ?? []) {
        const candidates = declByPathName.get(`${row.path}|${methodName}`) ?? [];
        const projected = candidates.some((c) => c.type === 'function' && c.owner === cls.name);
        if (!projected) {
          gapCollector.add('methods-name-only', lang, `${row.path}:${cls.name}.${methodName}`);
        }
      }
    }
  }

  // imports: file -> file, from import-map's already-resolved internal
  // targets. A target with no fact file-node (should not normally happen,
  // since import-map and structure-all are built from the same scan) is a
  // named gap rather than a dropped edge.
  for (const [fromPath, targets] of Object.entries(importMapSafe.importMap ?? {})) {
    if (!fileRowByPath.has(fromPath)) continue;
    for (const to of targets ?? []) {
      if (!fileRowByPath.has(to)) {
        gapCollector.add('imports-target-missing', languageOfPath.get(fromPath) ?? 'unknown', `${fromPath} -> ${to}`);
        continue;
      }
      const line = matchImportLine(fileRowByPath.get(fromPath).imports ?? [], to);
      addEdge({
        source: fileIdOf(fromPath),
        target: fileIdOf(to),
        type: 'imports',
        direction: 'forward',
        weight: 0.7,
        evidence: line != null ? [{ file: fromPath, line, source: 'import-map' }] : [],
        provenance: 'extracted',
      });
    }
  }

  // exports: file -> decl, only when the exported name resolves to exactly
  // one function/class declared in the SAME file.
  for (const row of fileRows) {
    for (const exp of row.exports ?? []) {
      const candidates = declByPathName.get(`${row.path}|${exp.name}`) ?? [];
      const lang = languageOfPath.get(row.path) ?? row.language ?? 'unknown';
      if (candidates.length === 1) {
        addEdge({
          source: fileIdOf(row.path),
          target: candidates[0].id,
          type: 'exports',
          direction: 'forward',
          weight: 1,
          evidence: [{ file: row.path, line: exp.line, source: 'tree-sitter' }],
          provenance: 'extracted',
        });
      } else if (candidates.length === 0) {
        gapCollector.add('exports-unresolved', lang, `${row.path}:${exp.line} -> ${exp.name}`);
      } else {
        gapCollector.add('exports-ambiguous', lang, `${row.path}:${exp.line} -> ${exp.name}`);
      }
    }
  }

  // calls: source (caller) and target (callee) must EACH resolve to exactly
  // one declaration, or the call site is a gap — never a guessed edge (D3).
  // Scope for the callee is the caller's own file plus its import-map-
  // resolved internal targets; scope for the caller is its own file only
  // (a call graph entry's `caller` is always a function declared in that
  // file). `callee`/`caller` text is matched verbatim (no receiver/dot
  // splitting) — the same conservative rule already used by
  // annotate-graph.mjs's resolveUniqueCallSites, so a dotted/member call
  // (`this.save`, `repo.Save`) does not spuriously match a bare declaration
  // name; it is an honest gap instead.
  for (const row of fileRows) {
    const scope = [row.path, ...(importMapSafe.importMap?.[row.path] ?? [])];
    const lang = languageOfPath.get(row.path) ?? row.language ?? 'unknown';
    for (const site of row.callGraph ?? []) {
      const targets = lookupCandidates(declByPathName, scope, site.callee);
      if (targets.length === 0) {
        gapCollector.add('calls-unresolved', lang, `${row.path}:${site.lineNumber} -> ${site.callee}`);
        continue;
      }
      if (targets.length > 1) {
        gapCollector.add('calls-ambiguous', lang, `${row.path}:${site.lineNumber} -> ${site.callee}`);
        continue;
      }

      const callerCandidates = (declByPathName.get(`${row.path}|${site.caller}`) ?? [])
        .filter((c) => c.type === 'function');
      let callerId = null;
      if (callerCandidates.length === 1) {
        callerId = callerCandidates[0].id;
      } else if (callerCandidates.length > 1) {
        const containing = callerCandidates.filter(
          (c) => c.lineRange && site.lineNumber >= c.lineRange[0] && site.lineNumber <= c.lineRange[1],
        );
        if (containing.length === 1) callerId = containing[0].id;
      }
      if (!callerId) {
        gapCollector.add('calls-caller-unresolved', lang, `${row.path}:${site.lineNumber} -> ${site.callee}`);
        continue;
      }

      addEdge({
        source: callerId,
        target: targets[0].id,
        type: 'calls',
        direction: 'forward',
        weight: 0.8,
        evidence: [{ file: row.path, line: site.lineNumber, source: 'tree-sitter' }],
        provenance: 'extracted',
      });
    }
  }

  // -------------------------------------------------------------------------
  // Coverage + gaps: reuse the existing conservation ledger (every scanned
  // input lands in exactly one bucket) and append the resolution gaps above.
  // -------------------------------------------------------------------------
  const ledger = buildCoverageLedger({ scan, structure: structureAll, importMap: importMapSafe });

  const resolutionGaps = gapCollector.toArray((kind) => GAP_REASONS[kind] ?? `unrecognized gap kind ${kind}`);
  const gaps = [...ledger.gaps, ...resolutionGaps].sort(compareGaps);

  // -------------------------------------------------------------------------
  // Deterministic ordering + factsDigest. The digest covers ONLY this
  // projection (nodes/edges/coverage/gaps) — no sourceRevision, timestamp, or
  // model name ever enters it, because none of those fields exist on this
  // return value at all. See build-fact-graph's header doc / the task report
  // for how this compares to the existing `annotate-graph.mjs`-computed
  // `project.factsDigest`.
  // -------------------------------------------------------------------------
  const nodes = [...nodesById.values()].sort((a, b) => compareStrings(a.id, b.id));
  const sortedEdges = [...edges].sort(
    (a, b) => compareStrings(a.type, b.type) || compareStrings(a.source, b.source) || compareStrings(a.target, b.target),
  );

  // Pre-extraction exclusions are persisted in the safe selection ledger but
  // are not source facts. Keep them visible in `coverage` while excluding
  // them from facts identity, so adding an archive or rotating an excluded
  // secret cannot invalidate an otherwise identical fact graph.
  const digestCoverage = JSON.parse(JSON.stringify(ledger.coverage));
  delete digestCoverage.selection;
  let preExtractionFiles = 0;
  let preExtractionIgnored = 0;
  for (const [language, row] of Object.entries(digestCoverage.byLanguage ?? {})) {
    for (const reason of ['filtered-by-defaults', 'filtered-by-ignore', 'sensitive']) {
      const count = row.skipped?.[reason] ?? 0;
      preExtractionFiles += count;
      if (reason !== 'sensitive') preExtractionIgnored += count;
      if (row.skipped) delete row.skipped[reason];
      row.files -= count;
    }
    if (row.files === 0) delete digestCoverage.byLanguage[language];
  }
  digestCoverage.files -= preExtractionFiles;
  digestCoverage.ignored = Math.max(0, (digestCoverage.ignored ?? 0) - preExtractionIgnored);

  const factsDigest = sha256Hex(
    JSON.stringify(canonicalizeForDigest({ nodes, edges: sortedEdges, coverage: digestCoverage, gaps })),
  );

  return {
    nodes,
    edges: sortedEdges,
    coverage: ledger.coverage,
    gaps,
    factsDigest,
  };
}

/** Human-readable reason text per resolution-gap kind (`count` is a separate
 *  Gap field, so these are deliberately count-agnostic). */
const GAP_REASONS = Object.freeze({
  'calls-unresolved': "call site(s) did not resolve to any declaration in the caller's file or its resolved imports",
  'calls-ambiguous': 'call site(s) resolved to more than one same-named declaration in scope',
  'calls-caller-unresolved': 'call site(s) could not be attributed to a unique calling declaration',
  'exports-unresolved': 'export(s) named no declaration structure-all found in the same file',
  'exports-ambiguous': 'export(s) matched more than one same-named declaration in the same file',
  'imports-target-missing': 'resolved import target(s) have no fact node (no matching scanned file)',
  'methods-name-only': 'class method(s) the extractor listed by name only (no line range) could not be projected as fact nodes',
  'identity-collision': 'declaration(s) mapped to the same node id as another distinguishable declaration',
});

// -----------------------------------------------------------------------------
// CLI entry. Only this path touches disk or @excavator/core.
// -----------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { projectRoot: null, scan: null, structure: null, importMap: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const flag = { '--scan': 'scan', '--structure': 'structure', '--import-map': 'importMap', '--out': 'out' }[arg];
    if (flag) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`build-fact-graph: ${arg} requires a value`);
      args[flag] = value;
      i++;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`build-fact-graph: unknown option: ${arg}`);
    if (!args.projectRoot) {
      args.projectRoot = arg;
      continue;
    }
    throw new Error(`build-fact-graph: unexpected argument: ${arg}`);
  }
  if (!args.projectRoot) {
    throw new Error(
      'Usage: node build-fact-graph.mjs <projectRoot> [--scan <path>] ' +
      '[--structure <path>] [--import-map <path>] [--out <path>]',
    );
  }
  return args;
}

async function resolveCore(pluginRoot) {
  const require = createRequire(resolve(pluginRoot, 'package.json'));
  try {
    return await import(pathToFileURL(require.resolve('@excavator/core')).href);
  } catch {
    return await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
  }
}

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`build-fact-graph: ${label} not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(args.projectRoot);
  const pluginRoot = resolve(__dirname, '../..');
  const { resolveDataDir } = await resolveCore(pluginRoot);
  const dataDir = resolveDataDir(projectRoot);
  const intermediate = join(dataDir, 'intermediate');

  const scanPath = args.scan ? resolve(args.scan) : join(intermediate, 'scan-result.json');
  const structurePath = args.structure ? resolve(args.structure) : join(intermediate, 'structure-all.json');
  const importMapPath = args.importMap ? resolve(args.importMap) : join(intermediate, 'import-map.json');
  const outPath = args.out ? resolve(args.out) : join(intermediate, 'fact-graph.json');

  const scan = readJson(scanPath, 'scan result');
  const structureAll = readJson(structurePath, 'structure-all result');
  const importMap = existsSync(importMapPath) ? JSON.parse(readFileSync(importMapPath, 'utf-8')) : null;

  const projection = buildFactGraph({ scan, structureAll, importMap });

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(projection, null, 2), 'utf-8');
  if (!existsSync(outPath)) throw new Error(`output file missing after write: ${outPath}`);

  process.stderr.write(
    `build-fact-graph: nodes=${projection.nodes.length} edges=${projection.edges.length} ` +
    `gaps=${projection.gaps.length} factsDigest=${projection.factsDigest.slice(0, 12)}…\n`,
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
    process.stderr.write(`build-fact-graph.mjs failed: ${err.message}\n${err.stack}\n`);
    process.exit(1);
  }
}
