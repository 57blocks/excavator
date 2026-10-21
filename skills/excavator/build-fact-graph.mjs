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
 *     [--scan <scan-result.json>] [--structure <structure-all.jsonl>]
 *     [--import-map <import-map.json>] [--out <fact-graph.jsonl>]
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
import { createHash } from 'node:crypto';
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
  createGapCollector,
} from './fact-graph-resolve.mjs';
import { DEFAULT_LIMIT_CHARS, serializeJsonProduct } from './product-serialization.mjs';
import { STRUCTURE_ALL_FILE, readStructureAllPath } from './structure-all-store.mjs';
import { writeKnowledgeGraph } from './knowledge-graph-store.mjs';
import { assertCallConservation, createJavaCallResolver, createOtherJvmIndex, JAVA_CALL_OUTCOMES } from './java-call-resolution.mjs';
import {
  assertMentionConservation, createDeclaredJavaTypeIndex, indexJavaTypes, resolveMentions, TARGET_SKIP_REASONS,
} from './mention-resolution.mjs';
import {
  NAME_REFERENCE_GAP_KINDS, assertNameReferenceConservation, buildNameBindingTable, createAnnotationIdentity, resolveNameReferences,
} from './name-reference-resolution.mjs';
import {
  XML_INJECTION_GAP_KINDS, assertInjectionConservation, resolveXmlInjections,
} from './xml-injection-resolution.mjs';
import {
  ANNOTATION_INJECTION_GAP_KINDS, mergeInjectsEdges, resolveAnnotationInjections,
} from './annotation-injection-resolution.mjs';
import { ROUTE_GAP_KINDS, assertRouteConservation, resolveRoutes } from './route-resolution.mjs';
import { JSX_GAP_KINDS, JSX_GAP_REASONS, assertJsxConservation, resolveJsxElements } from './jsx-element-resolution.mjs';
import {
  BUSINESS_INTERFACE_GAP_KIND, TYPE_INJECTION_GAP_KINDS, TYPE_INJECTIONS_NOT_RUN, assertTypeInjectionConservation, resolveTypeInjections,
} from './type-injection-resolution.mjs';

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

/** The fact node of one declaration entry. */
function declarationNode(entry, id) {
  return {
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
  };
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
 * The deterministic projection. Pure function of its arguments; no I/O, no
 * model call, no source re-read.
 *
 * @param {{
 *   scan: object, structureAll: object, importMap?: object|null,
 *   mentionSites?: Array<{ file: string, language?: string, fqn: object[], path: object[] }>|null,
 *   mentionInputs?: { javaPackages: Array<{ file: string, package: string }>, skippedNonCode: Record<string, number> },
 *   mentionMutations?: object,
 *   nameReferenceSites?: object|null, nameBindingCatalog?: object|null, nameReferenceMutations?: object,
 *   routeCatalog?: object|null, routeMutations?: object,
 *   typeInjectionCatalog?: object|null, typeInjectionMutations?: object,
 *   serializationLimit?: number,
 *   headroomRecorder?: ReturnType<typeof import('./product-serialization.mjs').createHeadroomRecorder>,
 * }} args `mentionSites` is one row per scanned non-code file with the
 *   candidates text-mentions.mjs lexed from it (openspec: changes/
 *   name-mention-facts); omitted, the mention stage is recorded as
 *   not-run and adds no edge or gap. `mentionInputs` is required with it:
 *   the packages Java source files declare for the types the dictionary has no
 *   entry for, and the non-code files the scanner skipped by reason (both
 *   from mention-sites.mjs). `mentionMutations` is the test seam of
 *   mention-resolution.mjs's mutation tripwires; leave it unset.
 *   `nameReferenceSites` is the output of name-reference-sites.mjs: the root
 *   names of the expressions the expression files write, the name bindings
 *   XML descriptors declare, and the conditions that open a namespace to
 *   expressions, and the XML injection sites (`injections`,
 *   `injectionFiles`, `uncoveredReferences`; openspec: changes/
 *   xml-injection-references). `nameBindingCatalog` is the loaded catalog
 *   (name-binding-catalog.mjs) they were read with and are resolved by
 *   (openspec: changes/name-binding-references). The two go together; omitted,
 *   the stage is recorded as not-run (`coverage.nameReferences` and
 *   `coverage.injections` and `coverage.annotationInjections`) and adds no
 *   edge or gap. Annotation bindings, and the Java annotation injection sites
 *   (openspec: changes/annotation-injection-references; `memberAnnotations`),
 *   are read here from the structure rows. `nameReferenceMutations` is the
 *   test seam of the mutation tripwires of name-reference-resolution.mjs,
 *   xml-injection-resolution.mjs and annotation-injection-resolution.mjs;
 *   leave it unset.
 *   `routeCatalog` is the loaded route catalog (route-catalog.mjs; openspec:
 *   changes/jaxrs-route-facts): the Java methods that carry the annotations it
 *   lists become `endpoint` nodes, each with a `contains` edge from its file and
 *   a `routes` edge to the method that handles it, or land in a visible bucket
 *   (`coverage.routes`). Annotations are confirmed against the type dictionaries
 *   of the repository, so it needs `mentionInputs` (the packages of the Java types
 *   the dictionary has no entry for, an annotation type among them) and throws
 *   without. Omitted, the stage is recorded as not-run and adds no node, edge or
 *   gap. `routeMutations` is the test seam of the mutation tripwires of
 *   route-resolution.mjs; leave it unset.
 *   `typeInjectionCatalog` is the loaded type injection catalog (type-injection-
 *   catalog.mjs; openspec: changes/by-type-injection): the injection points a
 *   container fills by type become `injects` edges from the consumer's class to the
 *   one declaration that can satisfy them (a class, or a producer method), merged
 *   per pair with the edges of the two stages above, or land in a visible bucket
 *   (`coverage.typeInjections`); the business interfaces a class declares by
 *   annotation become `implements` edges, unless the hierarchy has drawn the pair.
 *   It reads the one call resolver of the Java rows, and confirms annotations like
 *   the route stage does, so it needs `mentionInputs` and throws without. Omitted,
 *   the stage is recorded as not-run and adds no edge or gap.
 *   `typeInjectionMutations` is the test seam of the mutation tripwires of
 *   type-injection-resolution.mjs; leave it unset.
 *   `serializationLimit`/`headroomRecorder` route the facts-digest
 *   input string through `serializeJsonProduct` (openspec: changes/product-
 *   serialization-ceiling, capability `product-serialization`) instead of a
 *   bare `JSON.stringify` — both optional so this pure function's existing
 *   callers (tests, the CLI) are unaffected; `serializationLimit` defaults
 *   to the runtime ceiling and `headroomRecorder`, when omitted, simply
 *   means no headroom entry is recorded for this call.
 * @returns {{ nodes: object[], edges: object[], coverage: object, gaps: object[], factsDigest: string }}
 */
export function buildFactGraph({ scan, structureAll, importMap, mentionSites, mentionInputs, mentionMutations, nameReferenceSites, nameBindingCatalog, nameReferenceMutations, routeCatalog, routeMutations, typeInjectionCatalog, typeInjectionMutations, serializationLimit = DEFAULT_LIMIT_CHARS, headroomRecorder = null }) {
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
  // path -> index of the row's first function entry in declEntries; the
  // row's function entries follow it in `row.functions` order, then its
  // class entries in `row.classes` order.
  const firstFunctionEntry = new Map();
  for (const row of fileRows) {
    firstFunctionEntry.set(row.path, declEntries.length);
    for (const fn of row.functions ?? []) {
      declEntries.push({
        path: row.path, type: 'function', name: fn.name, owner: fn.owner,
        params: fn.params ?? [], paramTypes: fn.paramTypes, returnType: fn.returnType,
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
    nodesById.set(id, declarationNode(entry, id));
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
  /** Adds the edge unless one of its type and ends is there already; says whether it was added. */
  function addEdge(edge) {
    const key = `${edge.type}|${edge.source}|${edge.target}`;
    if (edgeKeys.has(key)) return false;
    edgeKeys.add(key);
    edges.push(edge);
    return true;
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
  // one function/class declared in the SAME file. `local` is the
  // declaration's name where it differs from the exported one
  // (`export { X as Y }`, `export default X`).
  for (const row of fileRows) {
    for (const exp of row.exports ?? []) {
      const candidates = declByPathName.get(`${row.path}|${exp.local ?? exp.name}`) ?? [];
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
  //
  // Java rows resolve by the receiver's declared type instead (openspec:
  // changes/java-member-call-resolution, D7/D8/D11): every site becomes one
  // edge or one gap in JAVA_CALL_OUTCOMES, checked fail-closed below.
  const languageOfRow = (row) => languageOfPath.get(row.path) ?? row.language;
  const isJava = (row) => languageOfRow(row) === 'java';
  const javaRows = fileRows.filter(isJava);
  // Node id per function and class entry of a Java row, index for index with
  // `row.functions` / `row.classes`; null where the id is shared with another
  // declaration (an identity collision), so neither caller nor target can be
  // that node.
  const collided = new Set(collisions.map((c) => c.id));
  const uniqueId = (index) => {
    const id = idOf.get(withOrdinals[index]);
    return collided.has(id) ? null : id;
  };
  const functionIds = new Map();
  const classIds = new Map();
  for (const row of javaRows) {
    const first = firstFunctionEntry.get(row.path);
    const functionCount = (row.functions ?? []).length;
    functionIds.set(row.path, (row.functions ?? []).map((_, i) => uniqueId(first + i)));
    classIds.set(row.path, (row.classes ?? []).map((_, i) => uniqueId(first + functionCount + i)));
  }
  // Kotlin and Scala types are in the repository even though Java calls
  // into them are not resolved: never outside it.
  const otherJvmRows = fileRows.filter((row) => ['kotlin', 'scala'].includes(languageOfRow(row)));
  let javaSiteCount = 0;
  let javaEdgeSites = 0;
  // The one resolver of the Java rows: call resolution, the type hierarchy and the type queries of the by-type injection stage.
  const resolver = javaRows.length > 0 ? createJavaCallResolver({ rows: javaRows, functionIds, classIds, otherJvmRows }) : null;
  if (resolver !== null) {
    for (const row of javaRows) {
      const sites = row.callGraph ?? [];
      const outcomes = resolver.resolveFileCalls(row);
      javaSiteCount += sites.length;
      sites.forEach((site, i) => {
        const result = outcomes[i];
        if (result.outcome !== 'edge') {
          gapCollector.add(result.outcome, 'java', `${row.path}:${site.lineNumber} -> ${site.callee}`);
          return;
        }
        javaEdgeSites += 1;
        addEdge({
          source: result.callerId,
          target: result.targetId,
          type: 'calls',
          direction: 'forward',
          weight: 0.8,
          evidence: [{ file: row.path, line: site.lineNumber, source: 'tree-sitter' }],
          provenance: 'extracted',
        });
      });
    }

    // Type hierarchy (D10; dead-code-detection D8): supertypes inside the
    // repository, concrete methods to the abstract methods they implement
    // (inherited implementations included) and to the concrete methods they
    // override. Traversal follows these, so a call to an interface or base
    // method reaches its implementations and overrides.
    const { typeEdges, methodEdges, overrideEdges, uncertainPairs } = resolver.hierarchyEdges();
    const hierarchyFacts = [
      ...typeEdges,
      ...methodEdges.map((e) => ({ ...e, type: 'implements' })),
      ...overrideEdges.map((e) => ({ ...e, type: 'overrides' })),
    ];
    // A same-name, same-arity pair whose erased signatures cannot both be
    // determined is neither an edge nor dropped: one visible gap entry per pair.
    for (const pair of uncertainPairs) gapCollector.add('override-uncertain', 'java', `${pair.source} ~ ${pair.target}`);
    for (const edge of hierarchyFacts) {
      addEdge({
        source: edge.source,
        target: edge.target,
        type: edge.type,
        direction: 'forward',
        weight: 0.9,
        evidence: [{ file: edge.file, line: edge.line, source: 'tree-sitter' }],
        provenance: 'extracted',
      });
    }
  }

  for (const row of fileRows) {
    if (isJava(row)) continue;
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

  // JSX elements (openspec: changes/jsx-element-references): `<X>` renders
  // the function or class its tag resolves to through the file's import
  // bindings. Each element is one `calls` edge, whose evidence carries the
  // tag as written, or one `jsx-*` gap; checked fail-closed below.
  const functionsByPath = new Map();
  for (const entry of withOrdinals) {
    if (entry.type !== 'function') continue;
    if (!functionsByPath.has(entry.path)) functionsByPath.set(entry.path, []);
    functionsByPath.get(entry.path).push({ id: idOf.get(entry), lineRange: entry.lineRange });
  }
  const jsxResolved = resolveJsxElements({
    rows: fileRows,
    importMap: importMapSafe,
    topLevelDecls: (path, name) => (declByPathName.get(`${path}|${name}`) ?? []).filter((decl) => !decl.owner),
    functionsOf: (path) => functionsByPath.get(path) ?? [],
    languageOf: (path) => languageOfPath.get(path) ?? fileRowByPath.get(path)?.language ?? 'unknown',
  });
  for (const gap of jsxResolved.gaps) gapCollector.add(gap.kind, gap.scope, gap.sample);
  for (const edge of jsxResolved.edges) {
    addEdge({
      source: edge.source,
      target: edge.target,
      type: 'calls',
      direction: 'forward',
      weight: 0.8,
      evidence: [{ file: edge.file, line: edge.line, source: 'tree-sitter', token: edge.token }],
      provenance: 'extracted',
    });
  }
  const jsxCoverage = jsxResolved.coverage;

  // -------------------------------------------------------------------------
  // Name mentions (openspec: changes/name-mention-facts): a non-code file that
  // writes a repository class's name or a repository file's path. The lexer
  // ran before this projection; here each candidate becomes an edge or a
  // visible bucket. Without `mentionSites` the stage did not run, which the
  // coverage says in so many words.
  // -------------------------------------------------------------------------
  let mentionCoverage = { status: 'not-run' };
  if (Array.isArray(mentionSites) !== (mentionInputs !== undefined && mentionInputs !== null)) {
    throw new Error('buildFactGraph: mentionSites and mentionInputs go together');
  }
  // The route stage confirms annotations by the types the repository declares, an annotation type included
  // (a same-package type of a catalog annotation's name is not the catalog's): without the packages it cannot tell.
  if (routeCatalog && !Array.isArray(mentionInputs?.javaPackages)) {
    throw new Error('buildFactGraph: routeCatalog needs mentionInputs (the packages of the Java types that have no entry of their own)');
  }
  // The same for the by-type stage, which confirms the annotations of its catalog the same way.
  if (typeInjectionCatalog && !Array.isArray(mentionInputs?.javaPackages)) {
    throw new Error('buildFactGraph: typeInjectionCatalog needs mentionInputs (the packages of the Java types that have no entry of their own)');
  }
  // Every Java top-level type declaration with its class node id (null where
  // the id is shared): the dictionary both name stages resolve class names by.
  const javaTypes = [];
  for (const row of javaRows) {
    (row.classes ?? []).forEach((cls, i) => {
      if (typeof cls.qualifiedName !== 'string') return;
      javaTypes.push({ fqn: cls.qualifiedName, path: row.path, id: classIds.get(row.path)[i] });
    });
  }
  const otherJvm = createOtherJvmIndex(otherJvmRows);
  if (Array.isArray(mentionSites)) {
    const resolved = resolveMentions({
      sites: mentionSites,
      manifestPaths: fileRowByPath.keys(),
      javaTypes,
      otherJvm,
      declaredJavaTypes: createDeclaredJavaTypeIndex(mentionInputs.javaPackages),
      skippedFiles: (scan.skipped ?? []).filter((entry) => TARGET_SKIP_REASONS.includes(entry.reason)),
      skippedNonCode: mentionInputs.skippedNonCode,
      fileIdOf,
      languageOf: (path) => languageOfPath.get(path),
      mutations: mentionMutations ?? {},
    });
    for (const edge of resolved.edges) addEdge(edge);
    for (const gap of resolved.gaps) gapCollector.add(gap.kind, gap.scope, gap.sample);
    mentionCoverage = resolved.coverage;
  }

  // -------------------------------------------------------------------------
  // By-type injection (openspec: changes/by-type-injection, D13): the injection
  // points a container fills by type, and the business interfaces a class
  // declares by annotation. After the type hierarchy above - the declared
  // `implements` edges are added now, and the graph keeps the first edge of a
  // type and two ends, so a pair the hierarchy drew is not drawn twice - and
  // before the name stages below, whose `injects` edges the by-type edges are
  // merged with. It asks the one call resolver of the Java rows about types, and
  // confirms annotations as the route stage does. Without the catalog the stage
  // did not run, which the coverage says in so many words.
  // -------------------------------------------------------------------------
  let typeInjectionCoverage = TYPE_INJECTIONS_NOT_RUN;
  let typeInjected = null;
  if (typeInjectionCatalog) {
    const typesByFqn = indexJavaTypes(javaTypes);
    const declaredJavaTypes = createDeclaredJavaTypeIndex(mentionInputs.javaPackages);
    typeInjected = resolveTypeInjections({
      javaRows,
      catalog: typeInjectionCatalog,
      identity: ({ fqns, simpleNames }) => createAnnotationIdentity({ fqns, typesByFqn, otherJvm, declaredJavaTypes, simpleNames }),
      // A project with no Java row has no resolver: the stage then reads no type.
      types: resolver ?? createJavaCallResolver({ rows: [], functionIds, classIds, otherJvmRows }),
      functionIdOf: (path, index) => functionIds.get(path)?.[index] ?? null,
      // Their types carry no supertypes in the rows, so any of them may extend or implement what a point asks for.
      otherJvmTypeCount: otherJvmRows.reduce((count, row) => count + (row.classes ?? []).length, 0),
      mutations: typeInjectionMutations ?? {},
    });
    for (const edge of typeInjected.implementsEdges) addEdge(edge);
    for (const gap of typeInjected.gaps) gapCollector.add(gap.kind, gap.scope, gap.sample);
    typeInjectionCoverage = typeInjected.coverage;
  }
  // The injection entries of the evidence the `injects` edges of the graph carry, by family: what the conservation reads back.
  const injectionEntriesDrawn = {};
  function addInjectsEdge(edge) {
    if (!addEdge(edge)) return;
    for (const entry of edge.evidence) {
      if (entry.role === 'injection') injectionEntriesDrawn[entry.family] = (injectionEntriesDrawn[entry.family] ?? 0) + 1;
    }
  }

  // -------------------------------------------------------------------------
  // Name references (openspec: changes/name-binding-references): the names the
  // expressions of pages write (`#{orders.save}`), resolved through the name
  // bindings of descriptors and annotations, inside the deployment unit the
  // page is in. Each root name becomes an edge or a visible bucket. Without
  // `nameReferenceSites` and the catalog the stage did not run, which the
  // coverage says in so many words.
  //
  // XML injection sites (openspec: changes/xml-injection-references): the names
  // descriptors write where a bean is wired to another (Spring `ref="orderDao"`),
  // resolved over the same binding table, each becoming an `injects` edge from
  // the consumer's class or a visible bucket. Same inputs, same rule for a stage
  // that did not run.
  //
  // Java annotation injection sites (openspec: changes/annotation-injection-
  // references): the names annotations write where a member is wired to another
  // declaration (`@Qualifier("orderDao")`, Seam `@In`, `@EJB(beanName)`), read
  // from the structure rows and resolved over the same binding table, drawing the
  // same `injects` edges. The two sources' edges are merged BEFORE they go into
  // the graph: `addEdge` keeps the first edge of a type and two ends, and would
  // lose the second source's evidence for a pair both draw.
  // -------------------------------------------------------------------------
  let nameReferenceCoverage = { status: 'not-run' };
  let injectionCoverage = { status: 'not-run' };
  let annotationInjectionCoverage = { status: 'not-run' };
  if ((nameReferenceSites !== undefined && nameReferenceSites !== null) !== (nameBindingCatalog !== undefined && nameBindingCatalog !== null)) {
    throw new Error('buildFactGraph: nameReferenceSites and nameBindingCatalog go together');
  }
  if (nameReferenceSites) {
    const manifestPaths = [...fileRowByPath.keys()];
    // One table of every name binding, whatever reads it (openspec: changes/xml-injection-references, design D2, D9).
    const bindingTable = buildNameBindingTable({
      sites: nameReferenceSites,
      catalog: nameBindingCatalog,
      manifestPaths,
      javaRows,
      classIds,
      javaTypes,
      otherJvm,
      declaredJavaTypes: createDeclaredJavaTypeIndex(mentionInputs?.javaPackages ?? []),
      mutations: nameReferenceMutations ?? {},
    });
    const resolved = resolveNameReferences({
      sites: nameReferenceSites,
      catalog: nameBindingCatalog,
      table: bindingTable,
      manifestPaths,
      fileIdOf,
      languageOf: (path) => languageOfPath.get(path),
      mutations: nameReferenceMutations ?? {},
    });
    for (const edge of resolved.edges) addEdge(edge);
    for (const gap of resolved.gaps) gapCollector.add(gap.kind, gap.scope, gap.sample);
    nameReferenceCoverage = resolved.coverage;

    const injected = resolveXmlInjections({
      sites: nameReferenceSites,
      catalog: nameBindingCatalog,
      table: bindingTable,
      manifestPaths,
      languageOf: (path) => languageOfPath.get(path),
      mutations: nameReferenceMutations ?? {},
    });
    const annotated = resolveAnnotationInjections({
      javaRows,
      catalog: nameBindingCatalog,
      table: bindingTable,
      classIds,
      mutations: nameReferenceMutations ?? {},
    });
    for (const edge of mergeInjectsEdges({
      xmlEdges: injected.edges, annotationEdges: annotated.edges, typeEdges: typeInjected?.edges ?? [], mutations: nameReferenceMutations ?? {},
    })) addInjectsEdge(edge);
    for (const gap of [...injected.gaps, ...annotated.gaps]) gapCollector.add(gap.kind, gap.scope, gap.sample);
    injectionCoverage = injected.coverage;
    annotationInjectionCoverage = annotated.coverage;
  }
  // Without the name stages the by-type edges are the only `injects` edges to merge.
  if (!nameReferenceSites && typeInjected !== null) {
    for (const edge of mergeInjectsEdges({ xmlEdges: [], annotationEdges: [], typeEdges: typeInjected.edges, mutations: nameReferenceMutations ?? {} })) addInjectsEdge(edge);
  }

  // -------------------------------------------------------------------------
  // Java routes (openspec: changes/jaxrs-route-facts): a method that carries an
  // annotation the route catalog reads is where a container dispatches a
  // request. Each becomes an `endpoint` node (named by its route, owned by the
  // top-level type, in the file), a `contains` edge from the file and a `routes`
  // edge from the endpoint to the handler, or lands in a visible bucket. The
  // declarations of the structure rows have their ids, ordinals and collisions
  // above and are not touched: the resolution needs to know which handler has
  // a unique id, and the endpoints are added afterwards, as a group of their own
  // (path, owner, type) in the ordinal count. Without the catalog the stage did
  // not run, which the coverage says in so many words.
  // -------------------------------------------------------------------------
  let routeCoverage = { status: 'not-run' };
  const routeEdgesDrawn = {}; // family id -> routes edges the graph got
  if (routeCatalog) {
    const typesByFqn = indexJavaTypes(javaTypes);
    const declaredJavaTypes = createDeclaredJavaTypeIndex(mentionInputs.javaPackages);
    const routed = resolveRoutes({
      javaRows,
      catalog: routeCatalog,
      identity: ({ fqns, simpleNames }) => createAnnotationIdentity({ fqns, typesByFqn, otherJvm, declaredJavaTypes, simpleNames }),
      handlerIdOf: (path, index) => functionIds.get(path)?.[index] ?? null,
      mutations: routeMutations ?? {},
    });

    const endpointEntries = assignOrdinals(routed.endpoints.map((endpoint) => ({
      path: endpoint.file, type: 'endpoint', name: endpoint.route, owner: endpoint.owner, lineRange: endpoint.lineRange, __anchor: 'rule',
    })), ordinalGroupKey);
    const endpointIds = new Map(); // resolved endpoint -> node id
    routed.endpoints.forEach((endpoint, i) => {
      const entry = endpointEntries[i];
      const id = deriveNodeId(entry);
      // An endpoint is one per (file, type, route), and no declaration of a Java row has this type or shape of name.
      if (nodesById.has(id)) throw new Error(`buildFactGraph: the endpoint ${JSON.stringify(endpoint.route)} of ${endpoint.file} has the node id of another declaration: ${id}`);
      endpointIds.set(endpoint, id);
      nodesById.set(id, declarationNode(entry, id));
      addEdge({
        source: fileIdOf(endpoint.file),
        target: id,
        type: 'contains',
        direction: 'forward',
        weight: 1,
        // The line of the verb annotation, and what is written there: validation checks the token, not the route.
        evidence: endpoint.evidence,
        provenance: 'extracted',
      });
    });
    for (const edge of routed.edges) {
      const added = addEdge({
        source: endpointIds.get(edge.endpoint),
        target: edge.target,
        type: edge.type,
        direction: edge.direction,
        weight: edge.weight,
        evidence: edge.evidence,
        provenance: edge.provenance,
      });
      if (added) routeEdgesDrawn[edge.endpoint.family] = (routeEdgesDrawn[edge.endpoint.family] ?? 0) + 1;
    }
    for (const gap of routed.gaps) gapCollector.add(gap.kind, gap.scope, gap.sample);
    routeCoverage = routed.coverage;
  }

  // -------------------------------------------------------------------------
  // Coverage + gaps: reuse the existing conservation ledger (every scanned
  // input lands in exactly one bucket) and append the resolution gaps above.
  // -------------------------------------------------------------------------
  const ledger = buildCoverageLedger({ scan, structure: structureAll, importMap: importMapSafe });

  const resolutionGaps = gapCollector.toArray((kind, scope) =>
    (scope === 'java' ? JAVA_CALL_GAP_REASONS[kind] : undefined) ?? GAP_REASONS[kind] ?? `unrecognized gap kind ${kind}`);

  // Every Java call site is one edge or one gap: read the gap counts back
  // from what was recorded, so a dropped or misnamed bucket fails the build
  // instead of silently shrinking the call graph.
  if (javaSiteCount > 0) {
    const tally = { edge: javaEdgeSites };
    for (const gap of resolutionGaps) {
      if (gap.scope === 'java' && JAVA_CALL_OUTCOMES.includes(gap.kind)) tally[gap.kind] = gap.count;
    }
    assertCallConservation(javaSiteCount, tally);
  }
  const coverage = {
    ...ledger.coverage,
    mentions: mentionCoverage,
    nameReferences: nameReferenceCoverage,
    injections: injectionCoverage,
    annotationInjections: annotationInjectionCoverage,
    routes: routeCoverage,
    typeInjections: typeInjectionCoverage,
    jsxElements: jsxCoverage,
  };
  if (jsxCoverage.status === 'ran') {
    // Read back from what was recorded, as for Java calls.
    const recorded = (kind) => resolutionGaps.filter((gap) => gap.kind === kind).reduce((sum, gap) => sum + gap.count, 0);
    assertJsxConservation(jsxCoverage, Object.fromEntries(Object.values(JSX_GAP_KINDS).map((kind) => [kind, recorded(kind)])));
  }
  if (mentionCoverage.status === 'ran') {
    // The gap counts are read back from what was recorded, as for Java calls.
    const recorded = (kind) => resolutionGaps.filter((gap) => gap.kind === kind).reduce((sum, gap) => sum + gap.count, 0);
    assertMentionConservation(mentionCoverage, {
      ambiguous: recorded('mention-ambiguous'),
      unindexed: recorded('mention-target-unindexed'),
      unresolved: recorded('path-mention-unresolved'),
    });
  }
  if (nameReferenceCoverage.status === 'ran') {
    const recorded = (kind) => resolutionGaps.filter((gap) => gap.kind === kind).reduce((sum, gap) => sum + gap.count, 0);
    assertNameReferenceConservation(nameReferenceCoverage, Object.fromEntries(
      Object.entries(NAME_REFERENCE_GAP_KINDS).map(([bucket, kind]) => [bucket, recorded(kind)]),
    ));
  }
  if (injectionCoverage.status === 'ran') {
    // Read back from what was recorded into the graph, by gap kind, not from the
    // resolvers' own lists: the two sources record into the same kinds, so each
    // kind's count is checked against the buckets of both.
    const recorded = (kind) => resolutionGaps.filter((gap) => gap.kind === kind).reduce((sum, gap) => sum + gap.count, 0);
    assertInjectionConservation(injectionCoverage, Object.fromEntries(
      [...new Set([...Object.values(XML_INJECTION_GAP_KINDS), ...Object.values(ANNOTATION_INJECTION_GAP_KINDS)])].map((kind) => [kind, recorded(kind)]),
    ), annotationInjectionCoverage);
  }
  if (routeCoverage.status === 'ran') {
    // Read back from what was recorded into the graph, by family and gap kind, and from the edges the graph got.
    const recordedGaps = {};
    const routeGapKinds = new Set(Object.values(ROUTE_GAP_KINDS));
    for (const gap of resolutionGaps) {
      if (!routeGapKinds.has(gap.kind)) continue;
      recordedGaps[gap.scope] = { ...recordedGaps[gap.scope], [gap.kind]: (recordedGaps[gap.scope]?.[gap.kind] ?? 0) + gap.count };
    }
    assertRouteConservation(routeCoverage, { edges: routeEdgesDrawn, gaps: recordedGaps });
  }
  if (typeInjectionCoverage.status === 'ran') {
    // Read back from what was recorded into the graph, by scope and gap kind, and from the `injects` edges the graph got; the
    // declared interfaces are counted in what the stage drew, because the graph may have had the pair from the hierarchy already.
    const recordedGaps = {};
    const typeGapKinds = new Set([...Object.values(TYPE_INJECTION_GAP_KINDS), BUSINESS_INTERFACE_GAP_KIND]);
    for (const gap of resolutionGaps) {
      if (!typeGapKinds.has(gap.kind)) continue;
      recordedGaps[gap.scope] = { ...recordedGaps[gap.scope], [gap.kind]: (recordedGaps[gap.scope]?.[gap.kind] ?? 0) + gap.count };
    }
    const implementations = typeInjected.implementsEdges.reduce((sum, edge) => sum + edge.evidence.length, 0);
    assertTypeInjectionConservation(typeInjectionCoverage, { injections: injectionEntriesDrawn, implementations, gaps: recordedGaps });
  }
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
  const digestCoverage = JSON.parse(JSON.stringify(coverage));
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

  // Hashed record by record (openspec: changes/knowledge-graph-line-store,
  // design D3): the joined digest text was 66% of the runtime single-string
  // limit on a 3M-line Java repository's fact graph. The digest VALUE is unchanged —
  // computeFactsDigest feeds the hash exactly the bytes that
  // `JSON.stringify(canonicalizeForDigest({...}))` would have produced.
  const factsDigest = computeFactsDigest(
    { nodes, edges: sortedEdges, coverage: digestCoverage, gaps },
    { limit: serializationLimit, recorder: headroomRecorder },
  );

  return {
    nodes,
    edges: sortedEdges,
    coverage,
    gaps,
    factsDigest,
  };
}

/** Product name for one record of the facts digest input, in headroom
 *  entries and in a ProductTooLargeError. */
export const FACTS_DIGEST_RECORD = 'facts-digest-record';

/**
 * sha256 over the canonical compact JSON of `parts` — the same bytes as
 * `JSON.stringify(canonicalizeForDigest(parts))` — without ever building that
 * string. Top-level keys are visited in canonical order; a top-level array is
 * hashed one element at a time, any other top-level value in one piece. Each
 * piece is serialized through serializeJsonProduct, so a single record longer
 * than `limit` fails as a named ProductTooLargeError; the longest record is
 * reported to `recorder` as a `max-record` headroom entry.
 *
 * @param {Record<string, *>} parts
 * @param {{ limit?: number, recorder?: ReturnType<typeof import('./product-serialization.mjs').createHeadroomRecorder> | null }} [options]
 * @returns {string} lowercase hex sha256
 */
export function computeFactsDigest(parts, { limit = DEFAULT_LIMIT_CHARS, recorder = null } = {}) {
  const hash = createHash('sha256');
  let maxRecordChars = 0;
  const serialize = (value) => {
    const text = serializeJsonProduct(FACTS_DIGEST_RECORD, canonicalizeForDigest(value), { indent: 0, limit });
    if (text.length > maxRecordChars) maxRecordChars = text.length;
    return text;
  };

  // JSON.stringify drops an undefined-valued key and writes an undefined
  // array element as null; mirror both so the bytes stay identical.
  const keys = Object.keys(parts).filter((key) => parts[key] !== undefined).sort(compareStrings);
  hash.update('{');
  keys.forEach((key, i) => {
    hash.update(`${i > 0 ? ',' : ''}${JSON.stringify(key)}:`);
    const value = parts[key];
    if (Array.isArray(value)) {
      hash.update('[');
      value.forEach((item, j) => {
        if (j > 0) hash.update(',');
        hash.update(item === undefined ? 'null' : serialize(item));
      });
      hash.update(']');
    } else {
      hash.update(serialize(value));
    }
  });
  hash.update('}');
  recorder?.recordMaxRecord(FACTS_DIGEST_RECORD, maxRecordChars, limit);
  return hash.digest('hex');
}

/** Human-readable reason text per resolution-gap kind (`count` is a separate
 *  Gap field, so these are deliberately count-agnostic). */
const GAP_REASONS = Object.freeze({
  ...JSX_GAP_REASONS,
  'calls-unresolved': "call site(s) did not resolve to any declaration in the caller's file or its resolved imports",
  'calls-ambiguous': 'call site(s) resolved to more than one same-named declaration in scope',
  'calls-caller-unresolved': 'call site(s) could not be attributed to a unique calling declaration',
  'exports-unresolved': 'export(s) named no declaration structure-all found in the same file',
  'exports-ambiguous': 'export(s) matched more than one same-named declaration in the same file',
  'imports-target-missing': 'resolved import target(s) have no fact node (no matching scanned file)',
  'methods-name-only': 'class method(s) the extractor listed by name only (no line range) could not be projected as fact nodes',
  'identity-collision': 'declaration(s) mapped to the same node id as another distinguishable declaration',
  'mention-ambiguous': 'name mention(s) in non-code files that name more than one repository declaration or file (the same class name declared twice, or a path matching several files): no mentions edge is drawn',
  'mention-target-unindexed': 'name mention(s) in non-code files of something the repository has but the index has no node for (a Kotlin or Scala type, a Java annotation type, a file the scanner skipped as too large or binary): no mentions edge is drawn',
  'path-mention-unresolved': 'path mention(s) in non-code files that no resolution rule anchors to a known file (relative to the mentioning file, to its web root, or on the classpath); files excluded by ignore rules or default filters are not consulted, and a same-named file elsewhere is not guessed',
  'name-reference-target-unindexed': 'expression name(s) in view files whose binding in the page\'s deployment unit names a repository class the index has no node for (a Java annotation type, a Kotlin or Scala type, a class whose node id another declaration shares): no references edge is drawn',
  'name-reference-target-unknown': 'expression name(s) in view files whose binding in the page\'s deployment unit declares the name but no class that can be told (a bean definition whose parent or aliased name has no binding in the unit, a bean built by a factory method or another bean, a managed bean with no class element): no references edge is drawn',
  'name-reference-ambiguous': 'expression name(s) in view files that bind to more than one thing in the page\'s deployment unit (two classes, a class and a resource bundle, or a class name that several declarations carry): no references edge is drawn and none of the candidates is preferred',
  'name-reference-elsewhere': 'expression name(s) in view files that no binding of the page\'s deployment unit declares in a namespace its expression language sees, but another unit or an invisible namespace does (a Spring bean in a unit with no JSF bridge, a bean of another module): no references edge is drawn, since the name is only known to be bound where the page cannot see it',
  'name-reference-unbound': 'expression name(s) in view files that no binding this analysis reads declares: components of libraries, parameters the caller passes in, a page that includes this one statically, producer and factory methods, nested types, sources that are not Java, and values set at runtime are not read, so the name may well be bound there',
  'injection-target-unresolved': 'injection site(s), in an XML descriptor (a Spring ref and the like) or in a Java annotation (a Spring Qualifier or Resource, a Seam In, an EJB beanName), whose name is where a static read cannot look (a ref to a parent container, a name an annotation does not write as a string literal, a Seam expression), whose binding names a repository class the index has no node for, or declares the name but no class that can be told (a bean built by a factory method, a parent or an alias with no binding in the unit, a cycle): no injects edge is drawn',
  'injection-ambiguous': 'injection site(s), in an XML descriptor or in a Java annotation, whose name binds to more than one thing in the deployment unit(s) it is looked up in (two classes, or a class name that several declarations carry): no injects edge is drawn and none of the candidates is preferred',
  'injection-elsewhere': 'injection site(s), in an XML descriptor or in a Java annotation, whose name no binding of the deployment unit(s) it is looked up in declares in the family\'s namespace (for an XML ref local, in the site\'s own file; for a Seam In, among the Seam components), but another unit, namespace, file or kind of binding does (a bean of another module, a JSF or CDI bean that Seam does not inject, a component another framework\'s annotation declares): no injects edge is drawn, since the name is only known to be bound where the site cannot see it',
  'injection-unbound': 'injection site(s), in an XML descriptor or in a Java annotation, whose name no binding this analysis reads declares: beans of libraries or of a parent context, built-in Seam components and context variables, beans a factory or producer method declares, names set at runtime and components of sources that are not Java are not read, so the name may well be bound there',
  'route-handler-unresolved': 'Java route site(s) - a method that carries an annotation of the route catalog - whose handler has no method node an edge can point at: the method is in a nested, local or anonymous type (which have no method nodes), or its node id is shared with another declaration, or the structure row has no single entry for it: no endpoint and no routes edge is drawn',
  'route-verb-unresolved': 'Java route site(s) that do not name one HTTP method: the method writes none (a locator of a sub-resource, a path with no method, or a custom method the catalog does not know) or writes two or more different ones, and none of them is preferred: no endpoint is drawn',
  'route-root-unresolved': 'Java route site(s) whose top-level type writes no root path the catalog reads (a sub-resource, a resource that a descriptor or a configuration registers, a path an interface or a parent type gives): the root path is not completed from any other place, and no endpoint is drawn',
  'route-path-unresolved': 'Java route site(s) whose root path or method path is not written as a string literal (a constant, a concatenation, an array, no argument at all): a constant is not evaluated, and no endpoint is drawn',
  'type-injection-point-unresolved': 'Java injection point(s) filled by type that a static read cannot place: one that writes a JNDI name, one in a nested, local or anonymous type (which have no node an edge can start from), or a member the structure row has no single declaration, declared type or class node for: no injects edge is drawn',
  'type-injection-type-unresolved': 'Java injection point(s) filled by type whose type is a type variable, cannot be resolved, is a nested type, is declared more than once, or is restated by an argument that is not exactly one class literal: no injects edge is drawn',
  'type-injection-candidates-unresolved': 'Java injection point(s) filled by type whose candidates cannot be settled: a qualifier the catalog does not know, a declaration the rows cannot see that may satisfy the type (a nested, local or anonymous type, a producer or provider in one, a supertype or produced type that cannot be resolved, a type of another JVM language), an interface or abstract class that code binds by class literal, a single candidate whose being a bean depends on the deployment, or one that is no node (a producer field, a provider class): no injects edge is drawn',
  'type-injection-unbound': 'Java injection point(s) filled by type that no declaration of the repository can satisfy: beans of libraries, beans a container provides and beans created at runtime are not read, so the type may well be provided there: no injects edge is drawn',
  'type-injection-ambiguous': 'Java injection point(s) filled by type with two or more candidates (classes, producers and provider classes): how a deployment chooses among them (a qualifier, an alternative, a priority) is not read, and none of the candidates is preferred: no injects edge is drawn',
  'business-interface-unresolved': 'business interface declaration(s) of a class by annotation that cannot be read: a value that is no class literal (a constant), a type that cannot be resolved, is a nested type or is declared more than once, or a class or an interface with no node: no implements edge is drawn',
  'injection-consumer-unresolved': 'injection site(s) whose name is a repository class (an XML descriptor) or is written (a Java annotation) but whose consumer has no class that can be told: for XML, no enclosing bean element, a bean built by a factory method or with no class, one whose parent has no binding in the unit, an unindexed class or a class name that several declarations carry (a consumer whose class is outside the repository is no gap); for a Java annotation, a top-level type with no class node (an annotation type, or a name that several declarations carry): no injects edge is drawn',
});

/** Reasons for the Java call-site buckets (scope `java`), which resolve by
 *  the receiver's declared type rather than by name in scope, and for the
 *  Java method pairs the type hierarchy cannot decide. */
const JAVA_CALL_GAP_REASONS = Object.freeze({
  'calls-unresolved': 'Java call site(s) whose receiver type, type or method could not be determined from the repository\'s declarations',
  'calls-ambiguous': 'Java call site(s) with more than one candidate declaration (same-arity overloads, duplicate type names, or a source the repository cannot see)',
  'calls-external': 'Java call site(s) whose target type is outside the repository',
  'calls-generated': 'Java call site(s) to methods the source does not declare (accessors of declared fields, record members, Lombok builders and constructors, implicit constructors, enum values/valueOf)',
  'calls-caller-unresolved': 'Java call site(s) with no calling declaration node: calls in nested, anonymous and local types, and calls in field initializers, initializer blocks, enum constant arguments and record compact constructors (caller <clinit> or <init>)',
  'override-uncertain': 'Java method pair(s) with the same name and parameter count across a repository supertype where either side\'s erased parameter types cannot all be determined (a type variable, a nested or unresolvable type, an outside type from an on-demand import): no implements/overrides edge is drawn',
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
  const structurePath = args.structure ? resolve(args.structure) : join(intermediate, STRUCTURE_ALL_FILE);
  const importMapPath = args.importMap ? resolve(args.importMap) : join(intermediate, 'import-map.json');
  const outPath = args.out ? resolve(args.out) : join(intermediate, 'fact-graph.jsonl');

  const scan = readJson(scanPath, 'scan result');
  if (!existsSync(structurePath)) throw new Error(`build-fact-graph: structure-all result not found: ${structurePath}`);
  const structureAll = readStructureAllPath(structurePath);
  const importMap = existsSync(importMapPath) ? JSON.parse(readFileSync(importMapPath, 'utf-8')) : null;

  // This standalone entry reads the intermediate files only, so it runs no
  // mentions or name-reference stage (those read source content, which
  // lazy-analyze.mjs does from the materialized snapshot) and no route stage
  // (which needs the packages the mention stage reads): its product says
  // `mentions`, `nameReferences`, `injections`, `annotationInjections` and
  // `routes` are `not-run`.
  const projection = buildFactGraph({ scan, structureAll, importMap });

  mkdirSync(dirname(outPath), { recursive: true });
  if (outPath.endsWith('.jsonl')) {
    writeKnowledgeGraph(outPath, projection, { product: 'fact-graph.jsonl' });
  } else {
    writeFileSync(outPath, JSON.stringify(projection, null, 2), 'utf-8');
  }
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
