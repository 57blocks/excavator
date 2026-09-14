// fact-graph-resolve.mjs
//
// Pure, dependency-free helpers for build-fact-graph.mjs. Split out so the
// orchestration file (node/edge construction, coverage/gap merge, digest) is
// not also carrying the resolution/formatting details — single responsibility
// per the repo's "new logic, new file" rule.
//
// Nothing here touches disk, spawns a process, or imports @excavator/core:
// build-fact-graph.mjs's whole point is a zero-model, zero-parse projection,
// and these helpers must stay importable in a plain unit test with no build
// step.

import { createHash } from 'node:crypto';
import { basename, dirname, extname } from 'node:path';

/** Locale-independent string order (UTF-16 code units), matching the other
 *  deterministic skill scripts. */
export function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Complexity — fixed, reproducible thresholds by non-blank line count
// (fact-graph spec: <50 simple, 50-200 moderate, >200 complex). No model call.
// ---------------------------------------------------------------------------

/** @param {number} loc non-blank line count (or a line-span proxy — see
 *  build-fact-graph.mjs's per-declaration note). @returns {'simple'|'moderate'|'complex'} */
export function complexityFromLoc(loc) {
  const n = Number.isFinite(loc) && loc > 0 ? loc : 0;
  if (n < 50) return 'simple';
  if (n <= 200) return 'moderate';
  return 'complex';
}

// ---------------------------------------------------------------------------
// Import-line attribution.
//
// Deliberate mirror of `matchImportLine` in annotate-graph.mjs (same tiers,
// same behavior). NOT imported from there: annotate-graph.mjs does a
// top-level-await dynamic import of @excavator/core to load its tree-sitter
// dependents, which would make importing this pure helper drag in the whole
// core runtime — exactly what build-fact-graph must not require for its
// programmatic/test surface. If annotate-graph.mjs's version changes, this
// copy needs a matching update (there is no third module worth the
// indirection for ~15 lines of pure string logic).
// ---------------------------------------------------------------------------

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
 * line. Tiers, most specific first — see annotate-graph.mjs's matchImportLine
 * for the full rationale. Returns null when no tier applies.
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

// ---------------------------------------------------------------------------
// Non-code declaration kind -> NodeType mapping.
//
// Deliberate mirror of KIND_TO_NODE_TYPE in
// packages/core/src/analyzer/graph-builder.ts (not exported there, and not
// worth exporting a TS-only constant into a core-free .mjs projection for).
// Drift here only changes which NodeType a non-code fact node gets, never
// whether the declaration is projected at all.
// ---------------------------------------------------------------------------
export const KIND_TO_NODE_TYPE = Object.freeze({
  table: 'table', view: 'table', index: 'table',
  message: 'schema', type: 'schema', enum: 'schema',
  resource: 'resource', module: 'resource',
  service: 'service', deployment: 'service',
  job: 'pipeline', stage: 'pipeline', target: 'pipeline',
  route: 'endpoint', query: 'endpoint', mutation: 'endpoint',
  variable: 'config', output: 'config',
});

/** Map a definition/resource `kind` string to a fact NodeType. Unknown kinds
 *  fall back to `concept` (same fallback graph-builder.ts uses) rather than
 *  being dropped — an unrecognised kind is still a real declaration. */
export function mapDeclarationKind(kind) {
  return KIND_TO_NODE_TYPE[kind] ?? 'concept';
}

// ---------------------------------------------------------------------------
// Ordinal assignment — the node-identity anonymous-declaration fallback.
//
// node-identity.mjs's deriveNodeId accepts an `ordinal` field but does not
// compute it: the caller must say "this is the Nth declaration among same
// (path, owner, kind) in source order". This counts EVERY entry in a group
// (named or not) so inserting any same-kind sibling earlier in source order
// shifts every later sibling's ordinal — matching the documented fallback
// contract ("insert a same-kind declaration before it -> ordinal changes").
// ---------------------------------------------------------------------------

/**
 * @param {Array<object>} entries in source order
 * @param {(entry: object) => string} groupKeyOf groups entries that share
 *   (path, owner, kind) for ordinal purposes
 * @returns {Array<object>} new array, each entry spread with an `ordinal`
 */
export function assignOrdinals(entries, groupKeyOf) {
  const counters = new Map();
  return entries.map((entry) => {
    const key = groupKeyOf(entry);
    const next = counters.get(key) ?? 0;
    counters.set(key, next + 1);
    return { ...entry, ordinal: next };
  });
}

// ---------------------------------------------------------------------------
// Scope lookup for calls/exports resolution.
// ---------------------------------------------------------------------------

/**
 * Collect every declaration named `name` across the given scope of file
 * paths, from an index built as `Map<"path|name", declRef[]>`. Order:
 * scope-path order, then insertion order within each path's bucket.
 */
export function lookupCandidates(index, scopePaths, name) {
  const out = [];
  for (const path of scopePaths) {
    const hits = index.get(`${path}|${name}`);
    if (hits) out.push(...hits);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Digest — canonical (key-sorted) JSON, sha256. Mirrors annotate-graph.mjs's
// canonicalize/sha256 (same reasoning as matchImportLine above: a deliberate,
// documented duplication so this module stays core-free and independently
// testable).
// ---------------------------------------------------------------------------

export function canonicalizeForDigest(value) {
  if (Array.isArray(value)) return value.map(canonicalizeForDigest);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort(compareStrings)) {
      out[key] = canonicalizeForDigest(value[key]);
    }
    return out;
  }
  return value;
}

export function sha256Hex(text) {
  return createHash('sha256').update(text).digest('hex');
}

// ---------------------------------------------------------------------------
// Gap aggregation — bounded, ordered sample collector keyed by (kind, scope),
// matching the {kind, scope, reason, count, samples} shape coverage-ledger.mjs
// already uses (packages/core/src/types.ts Gap).
// ---------------------------------------------------------------------------

export function createGapCollector(sampleLimit = 5) {
  const byKey = new Map();
  return {
    add(kind, scope, sample) {
      const key = `${kind}|${scope}`;
      if (!byKey.has(key)) byKey.set(key, { kind, scope, count: 0, samples: [] });
      const entry = byKey.get(key);
      entry.count += 1;
      if (entry.samples.length < sampleLimit) entry.samples.push(sample);
    },
    /** @param {(kind: string, scope: string, count: number) => string} reasonFor */
    toArray(reasonFor) {
      return [...byKey.values()]
        .map((g) => ({ kind: g.kind, scope: g.scope, reason: reasonFor(g.kind, g.scope, g.count), count: g.count, samples: g.samples }));
    },
  };
}
