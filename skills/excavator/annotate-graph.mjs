#!/usr/bin/env node
/**
 * annotate-graph.mjs
 *
 * Analysis phase 2.3 (added, after the merge). The model is and stays the
 * author of the knowledge graph. This script reads the graph the model wrote
 * and the structural facts the readers extracted, and it:
 *
 *   - gives every model edge a `provenance` (`extracted` when an extractor
 *     record supports it, else `inferred`) and, where a record exists, the
 *     `evidence` line to check it against;
 *   - counts what disagrees: edges whose cited line is wrong, `extracted`
 *     edges no record supports, records with no edge, declarations with no
 *     node, nodes with no declaration, and declarations the model merged into
 *     one node (identity collisions);
 *   - adds the coverage ledger, the gap list and the source/facts digests;
 *   - marks the nodes of files an incremental run classified as COSMETIC and
 *     therefore did NOT re-analyse with `verification: "dirty"`, and records
 *     that file list under `meta.json`'s `excavator.dirtyFiles`, so "the
 *     source moved under this summary" is visible without changing the
 *     pipeline's own commit marker;
 *   - optionally appends the deterministic `imports`/`exports`/`contains`
 *     records the model omitted, marked `addedBy: "excavator-annotate"`.
 *
 * It NEVER removes or rewrites anything the model wrote — not a node, not an
 * edge, not a field, not an id. Every output is additive, and every
 * disagreement is a count, not a deletion.
 *
 * Usage:
 *   node annotate-graph.mjs <projectRoot>
 *     [--graph <assembled-graph.json>] [--structure <structure-all.json>]
 *     [--scan <scan-result.json>] [--import-map <import-map.json>]
 *     [--plan <incremental-plan.json>] [--fingerprints <fingerprints.json>]
 *     [--meta <meta.json>] [--no-meta] [--model <name>]
 *     [--out <annotated-graph.json>] [--audit-out <audit.json>]
 *     [--no-supplement] [--samples <n>]
 *
 * Determinism: no timestamps, all maps emitted in sorted key order, all
 * samples capped and ordered. Two runs on the same inputs produce
 * byte-identical `annotated-graph.json` and `audit.json`.
 *
 * Logging: stderr only. The printed totals equal the gap counts in the graph.
 */

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import {
  buildCoverageLedger,
  conservationViolations,
  compareGaps,
} from './coverage-ledger.mjs';
import { mergeVerification } from './verification-state.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '../..');
const require = createRequire(resolve(pluginRoot, 'package.json'));

let core;
try {
  core = await import(pathToFileURL(require.resolve('@excavator/core')).href);
} catch {
  core = await import(pathToFileURL(resolve(pluginRoot, 'packages/core/dist/index.js')).href);
}
const { resolveDataDir, auditGraphShape } = core;

/** Stamped into `project.pipelineVersion` so a graph says which audit produced it. */
export const PIPELINE_VERSION = 'excavator-annotate/1';

/** Structural edge types an extractor record can support. */
export const STRUCTURAL_EDGE_TYPES = Object.freeze(['imports', 'exports', 'contains', 'calls']);

/** Types the supplement pass may append. `calls` is never appended. */
export const SUPPLEMENTABLE_TYPES = Object.freeze(['imports', 'exports', 'contains']);

/** UA's per-type weight constants (SKILL.md "Edge Weight Conventions"). */
const WEIGHT_BY_TYPE = Object.freeze({ contains: 1.0, exports: 0.8, imports: 0.7 });

/**
 * Does `project.gitCommitHash` carry an identifier at all?
 *
 * A hex run of seven or more characters is the structural test, not a list of
 * accepted spellings: it matches a git commit, an abbreviated one, and the
 * pipeline's own `multi-repo:<digest>` marker for a parent directory whose
 * members are separate repositories. Those are version identities and are
 * KEPT — nulling the multi-repo marker would throw away the only record of
 * which member states the graph was built from, and would also rewrite a
 * value the pipeline itself wrote.
 *
 * What has no identifier in it — a missing field, `""`, whitespace,
 * `"unknown"`, `"HEAD"`, `"none"` — becomes `null`, so "this target has no
 * commit" is one visible value instead of five spellings of absence. The
 * count and a sample say what was replaced.
 */
const CARRIES_IDENTIFIER = /[0-9a-f]{7,}/i;

/**
 * Where the host's model name might be, most explicit first. None of these is
 * guaranteed to be set — the harness decides — so `unknown` is the honest
 * default rather than a guess assembled from a version string. A caller that
 * knows the model passes `--model`.
 */
export const HOST_MODEL_ENV_VARS = Object.freeze([
  'EXCAVATOR_MODEL', 'CLAUDE_MODEL', 'ANTHROPIC_MODEL', 'CLAUDE_CODE_MODEL',
]);

/** The model name to stamp into `project.model`, or `unknown`. */
export function hostModelName(env = process.env, override = null) {
  const explicit = typeof override === 'string' ? override.trim() : '';
  if (explicit.length > 0) return explicit;
  for (const name of HOST_MODEL_ENV_VARS) {
    const value = env?.[name];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return 'unknown';
}

/** Extraction statuses whose files can be compared against the graph. */
const COMPARABLE_STATUSES = Object.freeze(new Set(['parsed', 'zero-symbol']));

const CODE_NODE_TYPES = Object.freeze(new Set(['function', 'class']));
const FILE_NODE_TYPES = Object.freeze(new Set(['file', 'config', 'document']));

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Deep clone that keeps key order — the model's field order survives. */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Recursively sort object keys, for a canonical digest input. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort(compareStrings)) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function stripExtension(path) {
  const ext = extname(path);
  return ext ? path.slice(0, -ext.length) : path;
}

function lastSegment(specifier) {
  const cleaned = String(specifier).replace(/[\\/]+$/, '');
  const parts = cleaned.split(/[\\/]/);
  return stripExtension(parts[parts.length - 1] ?? '');
}

/**
 * Which import statement produced a resolved target, so the edge can cite a
 * line. Tiers, most specific first; every tier is a structural match, never a
 * guess about which line "probably" did it:
 *   1. the specifier's last segment is the target's file name
 *   2. the specifier's last segment is the target's directory name
 *      (package-style imports, where one statement resolves to many files)
 *   3. the file has exactly one import statement, so there is no ambiguity
 * Returns null when no tier applies — the caller counts that, and the edge
 * gets no evidence line rather than a fabricated one.
 */
export function matchImportLine(imports, targetPath) {
  if (!Array.isArray(imports) || imports.length === 0) return null;
  const fileName = stripExtension(basename(targetPath));
  const dirName = basename(dirname(targetPath));

  const byFile = imports.filter((imp) => lastSegment(imp.source) === fileName);
  if (byFile.length > 0) return Math.min(...byFile.map((imp) => imp.line));

  const byDir = imports.filter((imp) => lastSegment(imp.source) === dirName);
  if (byDir.length > 0) return Math.min(...byDir.map((imp) => imp.line));

  if (imports.length === 1) return imports[0].line;
  return null;
}

/**
 * Build every structural record the extractors support, keyed so a model edge
 * can be looked up by the endpoints' own `filePath`/`name` fields rather than
 * by any assumption about the model's id spelling.
 */
export function buildExpectedRecords({ structure, importMap }) {
  const byPath = new Map();
  for (const row of structure.results ?? []) byPath.set(row.path, row);

  const comparable = new Set(
    (structure.results ?? [])
      .filter((row) => COMPARABLE_STATUSES.has(row.status))
      .map((row) => row.path),
  );

  /** `imports|<from>|<to>` -> {line|null} */
  const imports = new Map();
  /** `exports|<file>|<name>` -> {line} */
  const exports = new Map();
  /** `contains|<file>|<name>` -> {line, kind} */
  const contains = new Map();
  /** `calls|<callerFile>|<callee>` -> {line, sites} */
  const calls = new Map();
  /** declarations per file, for the node audit */
  const declarations = new Map();

  let importLineUnmatched = 0;
  const importLineUnmatchedSamples = [];

  for (const [from, targets] of Object.entries(importMap?.importMap ?? {})) {
    if (!comparable.has(from)) continue;
    const row = byPath.get(from);
    for (const to of targets ?? []) {
      const line = matchImportLine(row?.imports ?? [], to);
      if (line === null) {
        importLineUnmatched += 1;
        if (importLineUnmatchedSamples.length < 50) importLineUnmatchedSamples.push(`${from} -> ${to}`);
      }
      imports.set(`imports|${from}|${to}`, { from, to, line });
    }
  }

  for (const path of comparable) {
    const row = byPath.get(path);
    if (!row) continue;

    for (const entry of row.exports ?? []) {
      const key = `exports|${path}|${entry.name}`;
      const existing = exports.get(key);
      if (!existing || entry.line < existing.line) {
        exports.set(key, { file: path, name: entry.name, line: entry.line });
      }
    }

    const decls = [];
    for (const fn of row.functions ?? []) {
      decls.push({ kind: 'function', name: fn.name, startLine: fn.startLine, endLine: fn.endLine, owner: fn.owner });
    }
    for (const cls of row.classes ?? []) {
      decls.push({ kind: 'class', name: cls.name, startLine: cls.startLine, endLine: cls.endLine, owner: cls.owner });
    }
    decls.sort((a, b) => a.startLine - b.startLine || compareStrings(a.name, b.name));
    declarations.set(path, decls);

    for (const decl of decls) {
      const key = `contains|${path}|${decl.name}`;
      const existing = contains.get(key);
      if (!existing || decl.startLine < existing.line) {
        contains.set(key, { file: path, name: decl.name, line: decl.startLine, kind: decl.kind });
      }
    }

    for (const site of row.callGraph ?? []) {
      const key = `calls|${path}|${site.callee}`;
      const existing = calls.get(key);
      if (!existing) {
        calls.set(key, { file: path, callee: site.callee, line: site.lineNumber, sites: 1 });
      } else {
        existing.sites += 1;
        if (site.lineNumber < existing.line) existing.line = site.lineNumber;
      }
    }
  }

  return {
    comparable,
    byPath,
    declarations,
    imports,
    exports,
    contains,
    calls,
    importLineUnmatched,
    importLineUnmatchedSamples,
  };
}

/**
 * Call sites that resolve to exactly one declaration among the caller's file
 * and the files it imports. Only these are eligible for `edge-missing`: an
 * ambiguous or unresolvable callee is a gap in the readers, not a hole in the
 * model's graph.
 */
export function resolveUniqueCallSites({ structure, importMap, expected }) {
  const declarationsByName = new Map();
  for (const [path, decls] of expected.declarations) {
    for (const decl of decls) {
      const key = `${path}|${decl.name}`;
      declarationsByName.set(key, decl);
    }
  }

  const unique = [];
  const ambiguous = [];
  const unresolved = [];
  for (const [path, decls] of expected.declarations) {
    void decls;
    const row = expected.byPath.get(path);
    const scope = [path, ...((importMap?.importMap ?? {})[path] ?? [])];
    for (const site of row?.callGraph ?? []) {
      const hits = scope.filter((candidate) => declarationsByName.has(`${candidate}|${site.callee}`));
      const record = { file: path, callee: site.callee, line: site.lineNumber, targets: hits };
      if (hits.length === 1) unique.push(record);
      else if (hits.length > 1) ambiguous.push(record);
      else unresolved.push(record);
    }
  }
  const order = (a, b) => compareStrings(a.file, b.file) || a.line - b.line || compareStrings(a.callee, b.callee);
  unique.sort(order);
  ambiguous.sort(order);
  unresolved.sort(order);
  void structure;
  return { unique, ambiguous, unresolved };
}

/**
 * Files whose analysis this run SKIPPED because the change was cosmetic.
 *
 * The authority is the incremental plan: `cosmeticFiles` is the pipeline's own
 * record of "content changed, structural fingerprint did not, so the old nodes
 * were kept". Their summaries therefore describe source that has since moved,
 * which is what `verification: "dirty"` says.
 *
 * With no plan there is nothing to report: a full analysis re-derived every
 * node from current source, so no node is stale, and deriving a dirty set from
 * the leftover fingerprint store would mark the whole freshly-analysed graph.
 *
 * The fingerprint store is the baseline that classification came from. A
 * cosmetic file with no entry in it is a bookkeeping hole, not a reason to
 * drop the file: it is still reported dirty AND counted separately.
 */
export function cosmeticDirtyFiles({ plan, fingerprints, scan }) {
  if (!plan || !Array.isArray(plan.cosmeticFiles)) {
    return { files: [], unfingerprinted: [], reanalysedOverlap: [] };
  }
  const scanned = new Set((scan?.files ?? []).map((file) => file?.path));
  const reanalysed = new Set(Array.isArray(plan.filesToReanalyze) ? plan.filesToReanalyze : []);
  const baseline = fingerprints?.files ?? {};

  const files = [];
  const unfingerprinted = [];
  const reanalysedOverlap = [];
  for (const path of plan.cosmeticFiles) {
    if (typeof path !== 'string' || path.length === 0) continue;
    if (!scanned.has(path)) continue;
    if (reanalysed.has(path)) {
      // Re-analysed after all, so its nodes are current. Counted, because a
      // file in both lists means the plan disagrees with itself.
      reanalysedOverlap.push(path);
      continue;
    }
    if (!Object.hasOwn(baseline, path)) unfingerprinted.push(path);
    files.push(path);
  }
  return {
    files: [...new Set(files)].sort(compareStrings),
    unfingerprinted: unfingerprinted.sort(compareStrings),
    reanalysedOverlap: reanalysedOverlap.sort(compareStrings),
  };
}

/** Index of the graph's nodes, by id and by the fields an audit matches on. */
function indexNodes(nodes) {
  const byId = new Map();
  const byFileAndName = new Map();
  const byFile = new Map();
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    byId.set(node.id, node);
    if (typeof node.filePath === 'string') {
      const key = `${node.filePath}|${node.name}`;
      if (!byFileAndName.has(key)) byFileAndName.set(key, []);
      byFileAndName.get(key).push(node);
      if (!byFile.has(node.filePath)) byFile.set(node.filePath, []);
      byFile.get(node.filePath).push(node);
    }
  }
  return { byId, byFileAndName, byFile };
}

function edgeKeyOf(edge) {
  return `${edge.type}|${edge.source}|${edge.target}`;
}

/** Bounded, ordered sample collector — samples are evidence, not a log. */
function sampler(limit) {
  const map = new Map();
  return {
    add(key, sample) {
      if (!map.has(key)) map.set(key, []);
      const list = map.get(key);
      if (list.length < limit) list.push(sample);
    },
    get(key) {
      return (map.get(key) ?? []).slice().sort(compareStrings);
    },
  };
}

/**
 * The whole audit. Pure over already-parsed inputs so it is testable without
 * touching disk, and so the CLI is a thin shell around it.
 */
export function annotate({
  graph, structure, scan, importMap, plan = null, fingerprints = null,
  model = 'unknown', supplement = true, sampleLimit = 5,
}) {
  const annotated = clone(graph);
  annotated.nodes = Array.isArray(annotated.nodes) ? annotated.nodes : [];
  annotated.edges = Array.isArray(annotated.edges) ? annotated.edges : [];

  const expected = buildExpectedRecords({ structure, importMap });
  const nodes = indexNodes(annotated.nodes);
  const samples = sampler(sampleLimit);

  const counts = {
    edgesTotal: annotated.edges.length,
    edgesExtracted: 0,
    edgesInferred: 0,
    edgesExtractedWithoutLine: 0,
    edgeAutoInferred: {},
    edgeContradicted: 0,
    edgeUnsupported: 0,
    evidenceVerified: 0,
    evidenceCorrected: 0,
    supplementAdded: {},
    nodesTotal: annotated.nodes.length,
    nodeMissing: 0,
    nodeUnsupported: 0,
    identityCollision: 0,
    ownerAnnotated: 0,
    anchorSourceAnnotated: 0,
    notComparableNodes: 0,
    importLineUnmatched: expected.importLineUnmatched,
    dirtyFiles: 0,
    dirtyNodes: 0,
    dirtyPreserved: 0,
    dirtyUnfingerprinted: 0,
    dirtyReanalysedOverlap: 0,
    gitCommitHashNormalized: 0,
    sourceDigestMissing: 0,
  };

  // ── edges the model wrote ────────────────────────────────────────────────
  const matchedRecordKeys = new Set();

  for (const edge of annotated.edges) {
    if (!edge || typeof edge !== 'object') continue;
    const source = nodes.byId.get(edge.source);
    const target = nodes.byId.get(edge.target);
    const record = findRecord(edge, source, target, expected);

    if (record) matchedRecordKeys.add(record.key);

    const modelEvidence = Array.isArray(edge.evidence) ? edge.evidence : null;

    if (record && record.line !== null && record.line !== undefined) {
      edge.provenance = 'extracted';
      const expectedEntry = {
        file: record.file,
        line: record.line,
        source: record.evidenceSource,
      };
      if (modelEvidence && modelEvidence.length > 0) {
        const agreeing = modelEvidence.filter(
          (entry) => entry && entry.file === record.file && entry.line === record.line,
        );
        for (const entry of agreeing) entry.verified = true;
        if (agreeing.length > 0) {
          counts.evidenceVerified += agreeing.length;
        } else {
          // The model cited a line the extractor does not support. Its own
          // entries stay (nothing the model wrote is removed); the extractor's
          // line is appended and both facts are counted: the claim was wrong,
          // and the citation has been repaired.
          counts.evidenceCorrected += 1;
          counts.edgeContradicted += 1;
          edge.verification = 'contradicted';
          samples.add('evidence-corrected', edgeKeyOf(edge));
          samples.add('edge-contradicted', edgeKeyOf(edge));
          modelEvidence.push(expectedEntry);
        }
      } else {
        edge.evidence = [expectedEntry];
      }
      counts.edgesExtracted += 1;
      continue;
    }

    if (record) {
      // A record supports the edge but no line could be attributed to it.
      // Claiming `extracted` without a citable line would be an unverifiable
      // claim, so the edge is left `extracted` with no evidence and counted —
      // the shape audit reports it too.
      edge.provenance = 'extracted';
      counts.edgesExtracted += 1;
      counts.edgesExtractedWithoutLine += 1;
      samples.add('evidence-line-unmatched', edgeKeyOf(edge));
      continue;
    }

    if (edge.provenance === 'extracted') {
      // The model claimed extraction; no extractor record supports it.
      edge.verification = 'unverified';
      counts.edgeUnsupported += 1;
      samples.add('edge-unsupported', edgeKeyOf(edge));
      counts.edgesExtracted += 1;
      continue;
    }

    const assigned = edge.provenance !== 'inferred';
    edge.provenance = 'inferred';
    counts.edgesInferred += 1;
    if (assigned) {
      counts.edgeAutoInferred[edge.type] = (counts.edgeAutoInferred[edge.type] ?? 0) + 1;
      samples.add(`edge-auto-inferred|${edge.type}`, edgeKeyOf(edge));
    }
  }

  // ── nodes: owner, anchorSource, identity collisions ─────────────────────
  for (const node of annotated.nodes) {
    if (!node || typeof node !== 'object') continue;
    if (FILE_NODE_TYPES.has(node.type) && typeof node.filePath === 'string') {
      node.anchorSource = 'census';
      counts.anchorSourceAnnotated += 1;
      continue;
    }
    if (!CODE_NODE_TYPES.has(node.type) || typeof node.filePath !== 'string') continue;
    if (!expected.comparable.has(node.filePath)) {
      counts.notComparableNodes += 1;
      continue;
    }
    const decls = (expected.declarations.get(node.filePath) ?? []).filter((d) => d.name === node.name);
    if (decls.length === 0) {
      counts.nodeUnsupported += 1;
      samples.add('node-unsupported', `${node.filePath}:${node.name}`);
      continue;
    }
    node.anchorSource = 'tree-sitter';
    counts.anchorSourceAnnotated += 1;

    const owners = [...new Set(decls.map((d) => d.owner).filter((o) => typeof o === 'string' && o.length > 0))].sort(compareStrings);
    if (decls.length === 1) {
      if (owners.length === 1) {
        node.owner = owners[0];
        counts.ownerAnnotated += 1;
      }
      continue;
    }

    // More than one declaration in this file answers to this node's name, so
    // the model's single node stands for all of them. The id is NOT rewritten
    // (the model owns ids); the loss is recorded on the node and counted.
    const siblings = nodes.byFileAndName.get(`${node.filePath}|${node.name}`) ?? [];
    if (siblings.length === 1) {
      if (owners.length > 1) node.owners = owners;
      counts.identityCollision += 1;
      samples.add(
        'identity-collision',
        `${node.filePath}:${node.name}@${decls.map((d) => d.startLine).join(',')}` +
        (owners.length > 0 ? ` owners=${owners.join('|')}` : ' owners=<none reported>'),
      );
    }
  }

  // ── freshness: nodes of files this run did not re-analyse ───────────────
  const dirty = cosmeticDirtyFiles({ plan, fingerprints, scan });
  counts.dirtyFiles = dirty.files.length;
  counts.dirtyUnfingerprinted = dirty.unfingerprinted.length;
  counts.dirtyReanalysedOverlap = dirty.reanalysedOverlap.length;
  const dirtySet = new Set(dirty.files);
  if (dirtySet.size > 0) {
    for (const node of annotated.nodes) {
      if (!node || typeof node !== 'object') continue;
      if (typeof node.filePath !== 'string' || !dirtySet.has(node.filePath)) continue;
      // `mergeVerification` keeps a `contradicted` marking: "the source says
      // otherwise" outranks "the source moved".
      const merged = mergeVerification(node.verification, 'dirty');
      if (merged.preserved) {
        counts.dirtyPreserved += 1;
        continue;
      }
      node.verification = merged.value;
      counts.dirtyNodes += 1;
    }
    for (const path of dirty.files) samples.add('cosmetic-dirty', path);
    for (const path of dirty.unfingerprinted) samples.add('dirty-unfingerprinted', path);
  }
  for (const path of dirty.reanalysedOverlap) samples.add('dirty-reanalysed-overlap', path);

  // ── records with no node / no edge ───────────────────────────────────────
  for (const [path, decls] of expected.declarations) {
    for (const decl of decls) {
      const hits = nodes.byFileAndName.get(`${path}|${decl.name}`) ?? [];
      if (hits.length === 0) {
        counts.nodeMissing += 1;
        samples.add('node-missing', `${path}:${decl.name}`);
      }
    }
  }

  const missingByType = {};
  const supplementCandidates = [];
  for (const [kind, map] of [
    ['imports', expected.imports],
    ['exports', expected.exports],
    ['contains', expected.contains],
  ]) {
    for (const [key, record] of map) {
      if (matchedRecordKeys.has(key)) continue;
      missingByType[kind] = (missingByType[kind] ?? 0) + 1;
      samples.add(`edge-missing|${kind}`, describeRecord(kind, record));
      if (record.line !== null && record.line !== undefined) {
        supplementCandidates.push({ kind, record });
      }
    }
  }

  const uniqueCalls = resolveUniqueCallSites({ structure, importMap, expected });
  for (const site of uniqueCalls.unique) {
    const key = `calls|${site.file}|${site.callee}`;
    if (matchedRecordKeys.has(key)) continue;
    missingByType.calls = (missingByType.calls ?? 0) + 1;
    samples.add('edge-missing|calls', `${site.file}:${site.line} -> ${site.callee}`);
  }

  // ── optional supplement edges ───────────────────────────────────────────
  const added = [];
  if (supplement) {
    const existing = new Set(annotated.edges.map((e) => `${e.type}|${e.source}|${e.target}`));
    for (const { kind, record } of supplementCandidates) {
      const endpoints = supplementEndpoints(kind, record, nodes);
      if (!endpoints) continue;
      const dedupe = `${kind}|${endpoints.source}|${endpoints.target}`;
      if (existing.has(dedupe)) continue;
      existing.add(dedupe);
      added.push({
        source: endpoints.source,
        target: endpoints.target,
        type: kind,
        direction: 'forward',
        weight: WEIGHT_BY_TYPE[kind] ?? 0.5,
        evidence: [{ file: record.file ?? record.from, line: record.line, source: kind === 'imports' ? 'import-map' : 'tree-sitter' }],
        provenance: 'extracted',
        addedBy: 'excavator-annotate',
      });
    }
    added.sort((a, b) => compareStrings(edgeKeyOf(a), edgeKeyOf(b)));
    for (const edge of added) {
      counts.supplementAdded[edge.type] = (counts.supplementAdded[edge.type] ?? 0) + 1;
      annotated.edges.push(edge);
    }
  }

  // ── ledger, gaps, digests ───────────────────────────────────────────────
  const ledger = buildCoverageLedger({ scan, structure, importMap, sampleLimit });
  const shape = auditGraphShape(annotated);
  const shapeByCode = {};
  for (const issue of shape.issues) {
    shapeByCode[issue.code] = (shapeByCode[issue.code] ?? 0) + 1;
    samples.add(`shape-issue|${issue.code}`, issue.nodeId ?? issue.edgeKey ?? issue.code);
  }

  // Digests and the project's version identity, before the gaps are built:
  // `sourceDigestMissing` is one of the facts the gap list has to carry.
  if (annotated.project && typeof annotated.project === 'object') {
    if (typeof scan?.contentDigest === 'string') {
      annotated.project.sourceDigest = scan.contentDigest;
    } else {
      counts.sourceDigestMissing = 1;
    }
    annotated.project.factsDigest = sha256(
      JSON.stringify(canonicalize({ structure, importMap: importMap ?? null })),
    );
    annotated.project.pipelineVersion = PIPELINE_VERSION;
    // Which model wrote the prose in this graph. `unknown` is a real answer:
    // the host does not always say, and a fabricated name would make the
    // graph unfalsifiable about its own authorship.
    annotated.project.model = typeof model === 'string' && model.trim().length > 0
      ? model.trim()
      : 'unknown';
    // A target with no git repository has no commit; `sourceDigest` carries
    // the version instead. The field is set to null rather than left absent
    // so a consumer reads "no commit" instead of "field missing, ask again".
    const commit = annotated.project.gitCommitHash;
    if (typeof commit !== 'string' || !CARRIES_IDENTIFIER.test(commit.trim())) {
      if (typeof commit === 'string' && commit.trim().length > 0) {
        counts.gitCommitHashNormalized = 1;
        samples.add('git-commit-hash-normalized', commit.trim());
      }
      annotated.project.gitCommitHash = null;
    }
  }

  const auditGaps = [];
  const gap = (kind, scope, reason, count, sampleKey) => {
    if (count <= 0) return;
    auditGaps.push({ kind, scope, reason, count, samples: samples.get(sampleKey ?? kind) });
  };

  for (const type of STRUCTURAL_EDGE_TYPES) {
    gap('edge-missing', type,
      `${missingByType[type] ?? 0} ${type} record(s) the extractors found have no edge in the graph`,
      missingByType[type] ?? 0, `edge-missing|${type}`);
  }
  for (const [type, count] of Object.entries(counts.edgeAutoInferred).sort((a, b) => compareStrings(a[0], b[0]))) {
    gap('edge-auto-inferred', type,
      `${count} ${type} edge(s) the model wrote are supported by no extractor record`,
      count, `edge-auto-inferred|${type}`);
  }
  gap('edge-contradicted', 'graph',
    `${counts.edgeContradicted} edge(s) cite a line the extractor record does not support`,
    counts.edgeContradicted);
  gap('edge-unsupported', 'graph',
    `${counts.edgeUnsupported} edge(s) claim provenance "extracted" with no extractor record`,
    counts.edgeUnsupported);
  gap('evidence-corrected', 'graph',
    `${counts.evidenceCorrected} edge(s) had the extractor's line appended beside a disagreeing citation`,
    counts.evidenceCorrected);
  gap('evidence-line-unmatched', 'graph',
    `${counts.edgesExtractedWithoutLine} supported edge(s) could not be attributed to a source line`,
    counts.edgesExtractedWithoutLine);
  gap('node-missing', 'graph',
    `${counts.nodeMissing} declaration(s) have no node in the graph`,
    counts.nodeMissing);
  gap('node-unsupported', 'graph',
    `${counts.nodeUnsupported} function/class node(s) match no declaration in a parsed file`,
    counts.nodeUnsupported);
  gap('identity-collision', 'graph',
    `${counts.identityCollision} node(s) stand for more than one declaration of the same name in one file`,
    counts.identityCollision);
  gap('cosmetic-dirty', 'graph',
    `${counts.dirtyFiles} file(s) changed without re-analysis; ${counts.dirtyNodes} node(s) marked dirty`,
    counts.dirtyFiles, 'cosmetic-dirty');
  gap('dirty-unfingerprinted', 'graph',
    `${counts.dirtyUnfingerprinted} cosmetic file(s) have no baseline fingerprint entry`,
    counts.dirtyUnfingerprinted, 'dirty-unfingerprinted');
  gap('dirty-reanalysed-overlap', 'graph',
    `${counts.dirtyReanalysedOverlap} file(s) appear as both cosmetic and re-analysed in the incremental plan`,
    counts.dirtyReanalysedOverlap, 'dirty-reanalysed-overlap');
  gap('git-commit-hash-normalized', 'graph',
    `${counts.gitCommitHashNormalized} project.gitCommitHash value(s) carried no identifier and were replaced with null`,
    counts.gitCommitHashNormalized, 'git-commit-hash-normalized');
  gap('source-digest-missing', 'graph',
    'the scan result carries no contentDigest, so project.sourceDigest cannot identify the analysed sources',
    counts.sourceDigestMissing);
  for (const [code, count] of Object.entries(shapeByCode).sort((a, b) => compareStrings(a[0], b[0]))) {
    gap('shape-issue', code, `${count} ${code}`, count, `shape-issue|${code}`);
  }
  gap('calls-ambiguous', 'graph',
    `${uniqueCalls.ambiguous.length} call site(s) resolve to more than one declaration`,
    uniqueCalls.ambiguous.length);
  gap('calls-unresolved', 'graph',
    `${uniqueCalls.unresolved.length} call site(s) resolve to no declaration in the caller's file or its imports`,
    uniqueCalls.unresolved.length);
  for (const site of uniqueCalls.ambiguous) samples.add('calls-ambiguous', `${site.file}:${site.line} -> ${site.callee}`);
  for (const site of uniqueCalls.unresolved) samples.add('calls-unresolved', `${site.file}:${site.line} -> ${site.callee}`);
  // Re-attach samples now that they exist (gap() copied an empty array for
  // the two call gaps above, which are collected after the fact).
  for (const entry of auditGaps) {
    if (entry.kind === 'calls-ambiguous' || entry.kind === 'calls-unresolved') {
      entry.samples = samples.get(entry.kind);
    }
  }

  const gaps = [...(Array.isArray(annotated.gaps) ? annotated.gaps : []), ...ledger.gaps, ...auditGaps];
  gaps.sort(compareGaps);

  annotated.coverage = ledger.coverage;
  annotated.gaps = gaps;

  const audit = {
    scriptCompleted: true,
    pipelineVersion: PIPELINE_VERSION,
    supplement,
    dirtyFiles: dirty.files,
    dirtyUnfingerprinted: dirty.unfingerprinted,
    counts: {
      ...counts,
      edgeAutoInferred: sortObject(counts.edgeAutoInferred),
      supplementAdded: sortObject(counts.supplementAdded),
      edgeMissing: sortObject(missingByType),
      shapeIssues: sortObject(shapeByCode),
      callSites: {
        unique: uniqueCalls.unique.length,
        ambiguous: uniqueCalls.ambiguous.length,
        unresolved: uniqueCalls.unresolved.length,
      },
    },
    conservationViolations: conservationViolations(ledger.coverage),
    gaps: auditGaps,
    importLineUnmatchedSamples: expected.importLineUnmatchedSamples.slice(0, sampleLimit),
  };

  return { annotated, audit, addedEdges: added, dirtyFiles: dirty.files };
}

function sortObject(obj) {
  const out = {};
  for (const key of Object.keys(obj).sort(compareStrings)) out[key] = obj[key];
  return out;
}

function describeRecord(kind, record) {
  if (kind === 'imports') return `${record.from} -> ${record.to}${record.line === null ? ' (no line)' : `:${record.line}`}`;
  return `${record.file}:${record.line} ${record.name}`;
}

/**
 * Find the extractor record a model edge corresponds to, using the endpoints'
 * own `filePath`/`name` fields — never the shape of the model's ids.
 */
function findRecord(edge, source, target, expected) {
  if (!STRUCTURAL_EDGE_TYPES.includes(edge.type)) return null;

  if (edge.type === 'imports') {
    const from = source?.filePath;
    const to = target?.filePath;
    if (!from || !to) return null;
    const key = `imports|${from}|${to}`;
    const record = expected.imports.get(key);
    return record ? { key, file: from, line: record.line, evidenceSource: 'import-map' } : null;
  }

  if (edge.type === 'exports') {
    const file = source?.filePath ?? target?.filePath;
    const name = target?.name;
    if (!file || !name) return null;
    const key = `exports|${file}|${name}`;
    const record = expected.exports.get(key);
    return record ? { key, file, line: record.line, evidenceSource: 'tree-sitter' } : null;
  }

  if (edge.type === 'contains') {
    const file = target?.filePath;
    const name = target?.name;
    if (!file || !name) return null;
    const key = `contains|${file}|${name}`;
    const record = expected.contains.get(key);
    return record ? { key, file, line: record.line, evidenceSource: 'tree-sitter' } : null;
  }

  // calls: the caller's file holds the call site; the callee is the target's name
  const file = source?.filePath;
  const callee = target?.name;
  if (!file || !callee) return null;
  const key = `calls|${file}|${callee}`;
  const record = expected.calls.get(key);
  return record ? { key, file, line: record.line, evidenceSource: 'tree-sitter' } : null;
}

/**
 * Endpoint node ids for a supplement edge. Both endpoints must already exist
 * as nodes: inventing a node would make this script an author, which it is
 * not. A missing endpoint is already counted under `node-missing`.
 */
function supplementEndpoints(kind, record, nodes) {
  const fileNode = (path) => (nodes.byFile.get(path) ?? []).find((n) => FILE_NODE_TYPES.has(n.type));
  if (kind === 'imports') {
    const from = fileNode(record.from);
    const to = fileNode(record.to);
    return from && to ? { source: from.id, target: to.id } : null;
  }
  const from = fileNode(record.file);
  const to = (nodes.byFileAndName.get(`${record.file}|${record.name}`) ?? [])[0];
  return from && to ? { source: from.id, target: to.id } : null;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    projectRoot: null, graph: null, structure: null, scan: null, importMap: null,
    plan: null, fingerprints: null, meta: null, model: null, writeMeta: true,
    out: null, auditOut: null, supplement: true, sampleLimit: 5,
  };
  const valueFlags = {
    '--graph': 'graph', '--structure': 'structure', '--scan': 'scan',
    '--import-map': 'importMap', '--plan': 'plan', '--fingerprints': 'fingerprints',
    '--meta': 'meta', '--model': 'model', '--out': 'out', '--audit-out': 'auditOut',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-supplement') { args.supplement = false; continue; }
    if (arg === '--no-meta') { args.writeMeta = false; continue; }
    if (arg === '--samples') {
      const value = Number.parseInt(argv[i + 1], 10);
      if (!Number.isInteger(value) || value < 0) throw new Error('annotate-graph: --samples requires a non-negative integer');
      args.sampleLimit = value;
      i++;
      continue;
    }
    if (valueFlags[arg]) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`annotate-graph: ${arg} requires a value`);
      args[valueFlags[arg]] = value;
      i++;
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`annotate-graph: unknown option: ${arg}`);
    if (!args.projectRoot) { args.projectRoot = arg; continue; }
    throw new Error(`annotate-graph: unexpected argument: ${arg}`);
  }
  if (!args.projectRoot) {
    throw new Error(
      'Usage: node annotate-graph.mjs <projectRoot> [--graph <path>] [--structure <path>] ' +
      '[--scan <path>] [--import-map <path>] [--plan <path>] [--fingerprints <path>] ' +
      '[--meta <path>] [--no-meta] [--model <name>] [--out <path>] [--audit-out <path>] ' +
      '[--no-supplement]',
    );
  }
  return args;
}

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`annotate-graph: ${label} not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = resolve(args.projectRoot);
  const intermediate = join(resolveDataDir(projectRoot), 'intermediate');
  const dataDir = resolveDataDir(projectRoot);
  const graphPath = resolve(args.graph ?? join(intermediate, 'assembled-graph.json'));
  const structurePath = resolve(args.structure ?? join(intermediate, 'structure-all.json'));
  const scanPath = resolve(args.scan ?? join(intermediate, 'scan-result.json'));
  const importMapPath = resolve(args.importMap ?? join(intermediate, 'import-map.json'));
  const planPath = resolve(args.plan ?? join(intermediate, 'incremental-plan.json'));
  const fingerprintPath = resolve(args.fingerprints ?? join(dataDir, 'fingerprints.json'));
  const metaPath = resolve(args.meta ?? join(dataDir, 'meta.json'));
  const outPath = resolve(args.out ?? join(intermediate, 'annotated-graph.json'));
  const auditPath = resolve(args.auditOut ?? join(intermediate, 'audit.json'));

  const graph = readJson(graphPath, 'graph');
  const structure = readJson(structurePath, 'structure-all');
  const scan = readJson(scanPath, 'scan result');
  const importMap = existsSync(importMapPath) ? JSON.parse(readFileSync(importMapPath, 'utf-8')) : null;
  if (!importMap) {
    process.stderr.write(
      `Warning: annotate-graph: no import map at ${importMapPath} — imports edges cannot be supported by a record\n`,
    );
  }

  // Both are absent on a full analysis, and both being absent means "nothing
  // was skipped, so nothing is dirty" — see cosmeticDirtyFiles.
  const plan = existsSync(planPath) ? JSON.parse(readFileSync(planPath, 'utf-8')) : null;
  const fingerprints = existsSync(fingerprintPath)
    ? JSON.parse(readFileSync(fingerprintPath, 'utf-8'))
    : null;

  const { annotated, audit, dirtyFiles } = annotate({
    graph, structure, scan, importMap, plan, fingerprints,
    model: hostModelName(process.env, args.model),
    supplement: args.supplement,
    sampleLimit: args.sampleLimit,
  });

  mkdirSync(dirname(outPath), { recursive: true });
  mkdirSync(dirname(auditPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(annotated, null, 2), 'utf-8');
  writeFileSync(auditPath, JSON.stringify(audit, null, 2), 'utf-8');

  if (args.writeMeta) {
    publishSupplementMeta(metaPath, {
      dirtyFiles,
      model: annotated.project?.model ?? 'unknown',
      pipelineVersion: PIPELINE_VERSION,
    });
  }

  const c = audit.counts;
  process.stderr.write(
    `annotate-graph: edges=${c.edgesTotal} extracted=${c.edgesExtracted} inferred=${c.edgesInferred} ` +
    `edge-auto-inferred=${sum(c.edgeAutoInferred)} edge-contradicted=${c.edgeContradicted} ` +
    `edge-unsupported=${c.edgeUnsupported} evidence-corrected=${c.evidenceCorrected} ` +
    `edge-missing=${sum(c.edgeMissing)} node-missing=${c.nodeMissing} ` +
    `node-unsupported=${c.nodeUnsupported} identity-collision=${c.identityCollision} ` +
    `supplement-added=${sum(c.supplementAdded)} dirty-files=${c.dirtyFiles} ` +
    `dirty-nodes=${c.dirtyNodes}\n`,
  );
  if (audit.conservationViolations.length > 0) {
    process.stderr.write(
      `Warning: annotate-graph: coverage does not conserve for ${audit.conservationViolations.length} language(s)\n`,
    );
  }
}

/**
 * Merge this layer's facts into `meta.json` under one `excavator` key: which
 * analysed files have since moved, which model wrote the prose, and which
 * audit produced it.
 *
 * Read-modify-write, never a replace: `meta.json` is the pipeline's own
 * metadata and its keys (`gitCommitHash`, `lastAnalyzedAt`, …) are UA's. The
 * commit marker is not touched here — that logic stays exactly where it is.
 * `dirtyFiles: []` is written rather than omitted, so "checked, nothing is
 * dirty" and "never checked" stay distinguishable.
 *
 * A missing `meta.json` means no graph has been published, so there is nothing
 * to annotate: warn only when a dirty list would otherwise be lost, and never
 * create the file.
 */
export function publishSupplementMeta(metaPath, { dirtyFiles, model, pipelineVersion }) {
  if (!existsSync(metaPath)) {
    if (dirtyFiles.length > 0) {
      process.stderr.write(
        `Warning: annotate-graph: ${dirtyFiles.length} dirty file(s) not published — no meta.json at ${metaPath}\n`,
      );
    }
    return;
  }
  let meta;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
  } catch (err) {
    process.stderr.write(`Warning: annotate-graph: meta.json is unreadable (${err.message}); dirty files not published\n`);
    return;
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    process.stderr.write('Warning: annotate-graph: meta.json is not an object; dirty files not published\n');
    return;
  }
  const excavator = meta.excavator && typeof meta.excavator === 'object' && !Array.isArray(meta.excavator)
    ? meta.excavator
    : {};
  meta.excavator = { ...excavator, dirtyFiles, model, pipelineVersion };
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf-8');
}

function sum(obj) {
  return Object.values(obj ?? {}).reduce((a, b) => a + b, 0);
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
    process.stderr.write(`annotate-graph.mjs failed: ${err.message}\n`);
    process.exit(1);
  }
}

export default {
  annotate, buildExpectedRecords, resolveUniqueCallSites, matchImportLine,
  cosmeticDirtyFiles, hostModelName, publishSupplementMeta, PIPELINE_VERSION,
};
