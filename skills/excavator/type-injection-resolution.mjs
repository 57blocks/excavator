/**
 * type-injection-resolution.mjs
 *
 * Resolution of the Java injection points that a container fills by type
 * (openspec: changes/by-type-injection, capability `fact-graph`, design D2 and
 * D5-D9, D11, D12): a field, or a parameter of a method or constructor, that
 * carries an injection annotation of the catalog and names no bean is given the
 * bean whose type is the declared one. Each point becomes an `injects` edge from
 * the class that declares it (the consumer) to the one repository declaration
 * that can satisfy it, or lands in a visible bucket that says why it did not.
 * Core records the annotations of the members with the type each member declares
 * (`memberAnnotations`), every type declared below top level and every anonymous
 * class body (`nestedTypes`), the class literals of a file and the type facts of
 * the top-level types; the Java call resolver reads them into the types this
 * module asks about (java-type-queries.mjs). This module only decides.
 *
 * Pure and build-free: it reads the catalog, the structure rows and the type
 * queries. It never reads a file, and nothing here is about a framework: which
 * annotations are injection annotations, which of them name a bean or a JNDI name
 * and which argument restates the type, which annotations qualify a point, give a
 * bean its name, produce a bean, make being a bean depend on the deployment,
 * declare business interfaces, and which types provide beans, are the catalog's
 * (type-injection-catalog.mjs).
 *
 * The candidates of a point of type T are a superset of the beans that can
 * satisfy it (D2): the non-abstract classes and records that are T or have T as
 * a supertype, the producers whose declared type is T or one of its subtypes, and
 * the classes that provide T or one of its subtypes. An edge is drawn only when
 * the set is complete and holds exactly one candidate. Everything that could make
 * it incomplete - a subtype written in a nested, local or anonymous type, a
 * producer in a nested type, a supertype or a produced type the types cannot
 * resolve whose simple name may be T or one of its subtypes, a class literal of T
 * in code when T cannot be instantiated by a container - stops the edge instead.
 * "Is T or a subtype of T" is always a question about resolved declarations; a
 * simple name is compared only for what could not be resolved.
 *
 * Every point has exactly one fate, in this order (D9):
 *   byName               the point names a bean, or carries an annotation that
 *                        does, with a value that is not the empty string: the
 *                        by-name stage resolves it (no gap)
 *   jndi                 the point names a JNDI name
 *   position             the member is of a kind the family does not read, or
 *                        the family wants a method with one parameter and the
 *                        method has not (no gap)
 *   nested               the member is in a nested, local or anonymous type
 *   memberUnindexed      a field with no declared type, a method or constructor
 *                        no declaration of the row is, or a consumer with no node
 *   outsideType          T is outside the repository, a primitive or an array (no gap)
 *   typeVariable         T is a type variable in scope
 *   typeUndetermined     T cannot be resolved, is a nested type, is declared more
 *                        than once, or the argument that restates it is not one
 *                        class literal
 *   qualifierUnresolved  the family reads qualifiers and the point carries one
 *                        that is not known, or a name qualifier with no name
 *   hiddenCandidate      the candidates may be incomplete: a type that cannot be
 *                        seen is, or may be, a subtype, a producer or a provider
 *                        of the type (nested types, names that cannot be resolved,
 *                        a generic provider base, sources of other JVM languages)
 *   dynamicCandidate     T cannot be instantiated and code writes its class literal
 *   noCandidate          none
 *   ambiguous            two or more
 *   deploymentDecided    the one candidate may not be a bean, by the deployment
 *   noTargetNode         the one candidate has no node to point at
 *   edge                 the rest
 * A method or constructor annotation that is settled by one of the first five
 * counts one point; otherwise each parameter is a point.
 *
 * The business interfaces a session class declares by annotation (design D10) are
 * read first, because an interface it declares and Java does not say is a
 * supertype of the class in the sense of the candidates above. Each class literal
 * in the value of such an annotation of a top-level class has exactly one fate:
 *   notListed       the annotation writes no value (once per annotation, no gap)
 *   unreadable      it writes a value with no class literal in it (once per
 *                   annotation)
 *   outsideType     the type is outside the repository (no gap)
 *   typeUndetermined  the type cannot be resolved, is a nested type, or is declared
 *                   more than once
 *   notInterface    the type is a repository type that is no interface (no gap)
 *   alreadySupertype  the class already has the interface as a supertype in Java
 *                   (no gap)
 *   unindexed       the class, or the interface, has no node for an edge to end at
 *   declared        the rest: an `implements` edge from the class to the interface
 * The interfaces of the last three are supertypes of the class for the candidates;
 * the name of one that could not be resolved may be a subtype's.
 *
 * `assertTypeInjectionConservation` checks that the buckets of each family add up
 * to its points, that the points that became edges are the injection entries of
 * the evidence, and that the gaps recorded add up to the buckets that are gaps; and
 * that the buckets of the business interfaces add up to their declarations, that the
 * declared ones are the entries of the `implements` evidence, and that their gaps add up.
 */

import { DEFAULT_NAME_RULES } from './name-binding-catalog.mjs';
import { stripTypeText } from './java-call-resolution.mjs';
import { packageOf } from './name-reference-resolution.mjs';

/** Same weight as the other annotation facts: every edge is extracted from cited lines. */
const TYPE_INJECTS_EDGE_WEIGHT = 0.5;

/** The sixteen fates of an injection point, in the order D9 decides them. */
export const TYPE_INJECTION_BUCKETS = Object.freeze([
  'byName', 'jndi', 'position', 'nested', 'memberUnindexed',
  'outsideType', 'typeVariable', 'typeUndetermined',
  'qualifierUnresolved', 'hiddenCandidate', 'dynamicCandidate',
  'noCandidate', 'ambiguous',
  'deploymentDecided', 'noTargetNode',
  'edge',
]);

/** The buckets that are gaps, and the gap kind each one records (D12). The others are right not to draw an edge, or are one. */
export const TYPE_INJECTION_GAP_KINDS = Object.freeze({
  jndi: 'type-injection-point-unresolved',
  nested: 'type-injection-point-unresolved',
  memberUnindexed: 'type-injection-point-unresolved',
  typeVariable: 'type-injection-type-unresolved',
  typeUndetermined: 'type-injection-type-unresolved',
  qualifierUnresolved: 'type-injection-candidates-unresolved',
  hiddenCandidate: 'type-injection-candidates-unresolved',
  dynamicCandidate: 'type-injection-candidates-unresolved',
  deploymentDecided: 'type-injection-candidates-unresolved',
  noTargetNode: 'type-injection-candidates-unresolved',
  noCandidate: 'type-injection-unbound',
  ambiguous: 'type-injection-ambiguous',
});

/** The eight fates of a business interface declaration, in the order the design decides them. */
export const BUSINESS_INTERFACE_BUCKETS = Object.freeze([
  'notListed', 'unreadable', 'outsideType', 'typeUndetermined', 'notInterface', 'alreadySupertype', 'unindexed', 'declared',
]);

/** The gap kind of a business interface declaration that cannot be read, and the buckets that record it. */
export const BUSINESS_INTERFACE_GAP_KIND = 'business-interface-unresolved';
export const BUSINESS_INTERFACE_GAP_BUCKETS = Object.freeze(['unreadable', 'typeUndetermined', 'unindexed']);

/** Same weight as the other `implements` edges between repository types. */
const BUSINESS_INTERFACE_EDGE_WEIGHT = 0.9;

/** The coverage of a run that had no catalog. */
export const TYPE_INJECTIONS_NOT_RUN = Object.freeze({ status: 'not-run' });

/** A candidate list in a sample shows this many, then how many more there are. */
const SAMPLE_CANDIDATES = 5;

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const argumentOf = (use, key) => use.arguments.find((argument) => argument.key === key);

/** An argument written as the empty string says what leaving it out says. */
const isEmptyLiteral = (argument) => typeof argument.value === 'string' && argument.value === '';

const emptyBuckets = () => Object.fromEntries(TYPE_INJECTION_BUCKETS.map((bucket) => [bucket, 0]));
const emptyBusinessBuckets = () => Object.fromEntries(BUSINESS_INTERFACE_BUCKETS.map((bucket) => [bucket, 0]));

const IDENTIFIER_PATTERN = /^[\p{ID_Start}_$][\p{ID_Continue}$]*$/u;

/** The last segment of the name a type text writes, or null for an array or text that is no name. */
function simpleNameOf(text) {
  if (typeof text !== 'string') return null;
  const { base, dims } = stripTypeText(text);
  if (dims > 0) return null;
  const simple = base.slice(base.lastIndexOf('.') + 1);
  return IDENTIFIER_PATTERN.test(simple) ? simple : null;
}

/** The first type argument a type text writes (`Map<K, V>` is `K`), or null when it writes none. */
function firstTypeArgument(text) {
  const open = text.indexOf('<');
  if (open < 0) return null;
  let depth = 0;
  const start = open + 1;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '<') {
      depth += 1;
    } else if (ch === '>') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i).trim() || null;
    } else if (ch === ',' && depth === 1) {
      return text.slice(start, i).trim() || null;
    }
  }
  return null;
}

/**
 * The simple names of every type argument a written type has, nested generics
 * included: `Map<String, List<Foo>>` is String, List and Foo. A wildcard says its
 * bound (`? extends Foo` is Foo).
 */
function typeArgumentNames(text) {
  const names = [];
  const take = (argument) => {
    const written = argument.trim().replace(/^\?\s*(?:extends|super)?\s*/, '');
    if (written === '') return;
    const name = simpleNameOf(written);
    if (name !== null) names.push(name);
    visit(written);
  };
  function visit(written) {
    const open = written.indexOf('<');
    if (open < 0) return;
    let depth = 0;
    let start = open + 1;
    for (let i = open; i < written.length; i += 1) {
      const ch = written[i];
      if (ch === '<') {
        depth += 1;
      } else if (ch === '>') {
        depth -= 1;
        if (depth === 0) {
          take(written.slice(start, i));
          return;
        }
      } else if (ch === ',' && depth === 1) {
        take(written.slice(start, i));
        start = i + 1;
      }
    }
  }
  visit(text);
  return names;
}

/** Evidence of one edge, without repeats, in the order of (file, line, token, role, family, member, parameter). */
function uniqueSortedEvidence(evidence) {
  const unique = new Map(evidence.map((entry) => [JSON.stringify([entry.file, entry.line, entry.token, entry.role, entry.family, entry.member, entry.parameter ?? null]), entry]));
  return [...unique.values()].sort((a, b) => compareText(a.file, b.file)
    || a.line - b.line
    || compareText(a.token, b.token)
    || compareText(a.role, b.role)
    || compareText(a.family, b.family)
    || compareText(a.member, b.member)
    || (a.parameter ?? -1) - (b.parameter ?? -1));
}

/** The catalog's families and roles, with the lookups the resolution reads. */
function indexCatalog(catalog) {
  const families = catalog.injectionFamilies.map((family) => ({
    ...family,
    nameAnnotationSet: new Set(family.nameAnnotations),
  }));
  const familyOfFqn = new Map(families.flatMap((family) => family.annotations.map((fqn) => [fqn, family])));
  const roleOfFqn = new Map();
  const claim = (role, fqns) => { for (const fqn of fqns) roleOfFqn.set(fqn, role); };
  for (const family of families) {
    claim('injection', family.annotations);
    claim('nameInjection', family.nameAnnotations);
  }
  claim('namedQualifier', catalog.namedQualifier.annotations);
  claim('defaultNameStereotype', catalog.namedQualifier.defaultNameStereotypes);
  claim('producer', catalog.producers.annotations);
  claim('providerType', catalog.providerTypes.types);
  claim('deploymentDependent', catalog.deploymentDependent.annotations);
  claim('notQualifier', catalog.notQualifiers.annotations);
  claim('businessInterface', catalog.businessInterfaces.annotations);
  return { families, familyOfFqn, roleOfFqn, namedArgument: catalog.namedQualifier.argument, businessArgument: catalog.businessInterfaces.argument };
}

/**
 * The repository types and, for each, the types it has as supertypes and the
 * types that have it (D7). A type's supertypes are the resolver's, and the types
 * that `extraSupertypes` adds to a declaration, followed through everything they
 * reach: a declared supertype of a type is as good as a written one.
 *
 * @param {{ types: object, extraSupertypes?: Map<object, object[]> }} args
 *   `types` the Java call resolver (its type queries), `extraSupertypes` type
 *   view to further supertype views of it
 * @returns {{
 *   views: readonly object[],
 *   ancestorsOf: (view: object) => object[],
 *   subtypesOf: (view: object) => object[],
 *   closureOf: (view: object) => object[],
 * }} `ancestorsOf` nearest first and never the view itself, `subtypesOf` in the
 *   order of the views, `closureOf` the view then its subtypes
 */
export function buildSubtypeIndex({ types, extraSupertypes = new Map() }) {
  const views = types.declaredTypes();
  const ancestorCache = new Map();
  function ancestorsOf(view) {
    let result = ancestorCache.get(view);
    if (result) return result;
    result = [];
    const seen = new Set([view]);
    let level = [view];
    while (level.length > 0) {
      const next = [];
      for (const reached of level) {
        for (const ancestor of [...types.ancestors(reached).ancestors, ...(extraSupertypes.get(reached) ?? [])]) {
          if (seen.has(ancestor)) continue;
          seen.add(ancestor);
          result.push(ancestor);
          next.push(ancestor);
        }
      }
      level = next;
    }
    ancestorCache.set(view, result);
    return result;
  }

  const subtypes = new Map();
  for (const view of views) {
    for (const ancestor of ancestorsOf(view)) {
      if (!subtypes.has(ancestor)) subtypes.set(ancestor, []);
      subtypes.get(ancestor).push(view);
    }
  }
  const subtypesOf = (view) => subtypes.get(view) ?? [];
  const closureCache = new Map();
  const closureOf = (view) => {
    if (!closureCache.has(view)) closureCache.set(view, [view, ...subtypesOf(view)]);
    return closureCache.get(view);
  };
  return { views, ancestorsOf, subtypesOf, closureOf };
}

/**
 * Fail-closed check of the balance of a run (D12): in each family the buckets add
 * up to the points, the points that became edges are the entries of the evidence
 * with the role `injection`, and the gaps recorded of each kind add up to the
 * buckets that are gaps of that kind.
 *
 * @param {{ status: string, families?: Record<string, { points: number, buckets: Record<string, number>, edges: number }> }} coverage
 *   the `coverage.typeInjections` section of a run; one that did not run has nothing to balance
 * @param {{ injections: Record<string, number>, gaps: Record<string, Record<string, number>> }} recorded
 *   what was read back, by family id: the evidence entries with the role
 *   `injection` the edges carry, and the gap occurrences recorded by kind (a
 *   family or a kind with none may be missing); `measureTypeInjections` reads them from a run
 */
export function assertTypeInjectionConservation(coverage, recorded) {
  if (coverage.status !== 'ran') return;
  assertBusinessInterfaceConservation(coverage.businessInterfaces, recorded);
  for (const [id, family] of Object.entries(coverage.families)) {
    const total = TYPE_INJECTION_BUCKETS.reduce((sum, bucket) => sum + family.buckets[bucket], 0);
    if (total !== family.points) {
      throw new Error(`type-injection-resolution: family ${JSON.stringify(id)}: ${family.points} injection point(s) but ${total} outcome(s)`);
    }
    if (family.buckets.edge !== family.edges) {
      throw new Error(`type-injection-resolution: family ${JSON.stringify(id)}: ${family.buckets.edge} point(s) became an edge but ${family.edges} edge point(s) were counted`);
    }
    const injections = recorded.injections[id] ?? 0;
    if (family.edges !== injections) {
      throw new Error(`type-injection-resolution: family ${JSON.stringify(id)}: ${family.edges} point(s) became an edge but ${injections} injection entr(ies) in the evidence`);
    }
    for (const kind of new Set(Object.values(TYPE_INJECTION_GAP_KINDS))) {
      const expected = Object.entries(TYPE_INJECTION_GAP_KINDS)
        .filter(([, gapKind]) => gapKind === kind)
        .reduce((sum, [bucket]) => sum + family.buckets[bucket], 0);
      const seen = recorded.gaps[id]?.[kind] ?? 0;
      if (expected !== seen) {
        throw new Error(`type-injection-resolution: family ${JSON.stringify(id)}: ${expected} ${kind} outcome(s) but ${seen} recorded gap occurrence(s)`);
      }
    }
  }
}

/**
 * The balance of the business interface section: its buckets add up to its
 * declarations, the declared ones are the `implements` edges the run drew (each
 * is one entry of the evidence), and the gaps recorded add up to the buckets that
 * are gaps.
 */
function assertBusinessInterfaceConservation(business, recorded) {
  if (business === undefined) throw new Error('type-injection-resolution: a run has no business interface coverage');
  const total = BUSINESS_INTERFACE_BUCKETS.reduce((sum, bucket) => sum + business.buckets[bucket], 0);
  if (total !== business.declarations) {
    throw new Error(`type-injection-resolution: business interfaces: ${business.declarations} declaration(s) but ${total} outcome(s)`);
  }
  if (business.buckets.declared !== business.edges) {
    throw new Error(`type-injection-resolution: business interfaces: ${business.buckets.declared} declaration(s) became an implements edge but ${business.edges} edge(s) were counted`);
  }
  const implementations = recorded.implementations ?? 0;
  if (business.edges !== implementations) {
    throw new Error(`type-injection-resolution: business interfaces: ${business.edges} implements edge(s) drawn but ${implementations} entr(ies) in the evidence`);
  }
  const expected = BUSINESS_INTERFACE_GAP_BUCKETS.reduce((sum, bucket) => sum + business.buckets[bucket], 0);
  const seen = Object.values(recorded.gaps).reduce((sum, kinds) => sum + (kinds[BUSINESS_INTERFACE_GAP_KIND] ?? 0), 0);
  if (expected !== seen) {
    throw new Error(`type-injection-resolution: business interfaces: ${expected} ${BUSINESS_INTERFACE_GAP_KIND} outcome(s) but ${seen} recorded gap occurrence(s)`);
  }
}

/**
 * What `assertTypeInjectionConservation` compares a run's coverage with, read
 * from the edges and the gaps a run returned.
 *
 * @param {{ edges: object[], gaps: Array<{ kind: string, scope: string }>, implementsEdges?: object[] }} run
 * @returns {{ injections: Record<string, number>, implementations: number, gaps: Record<string, Record<string, number>> }}
 *   `implementations` the evidence entries of the `implements` edges of business interfaces
 */
export function measureTypeInjections({ edges, gaps, implementsEdges = [] }) {
  const injections = {};
  for (const edge of edges) {
    for (const entry of edge.evidence) {
      if (entry.role === 'injection') injections[entry.family] = (injections[entry.family] ?? 0) + 1;
    }
  }
  const implementations = implementsEdges.reduce((sum, edge) => sum + edge.evidence.filter((entry) => entry.role === 'businessInterface').length, 0);
  const recorded = {};
  for (const gap of gaps) {
    recorded[gap.scope] ??= {};
    recorded[gap.scope][gap.kind] = (recorded[gap.scope][gap.kind] ?? 0) + 1;
  }
  return { injections, implementations, gaps: recorded };
}

const lazy = (make) => {
  let made = false;
  let value;
  return () => {
    if (!made) {
      value = make();
      made = true;
    }
    return value;
  };
};

/**
 * @param {{
 *   javaRows: object[],
 *   catalog: object | null,
 *   identity: (args: { fqns: Iterable<string>, simpleNames?: boolean }) => (row: object, written: string, pkg: string) => { kind: 'catalog', fqn: string } | { kind: 'other' } | { kind: 'unconfirmed' },
 *   types: ReturnType<typeof import('./java-call-resolution.mjs').createJavaCallResolver>,
 *   functionIdOf: (path: string, index: number) => string|null,
 *   otherJvmTypeCount?: number,
 *   mutations?: {
 *     simpleNameAnnotations?: boolean, abstractCandidates?: boolean, noHiddenCandidates?: boolean,
 *     noDynamicGuard?: boolean, ignoreUnknownQualifiers?: boolean, noNamedFilter?: boolean, firstCandidate?: boolean,
 *     noBusinessInterfaces?: boolean,
 *   },
 * }} args
 *   `javaRows` are the structure rows of the Java files (their `classes`,
 *   `functions`, `memberAnnotations`, `nestedTypes` and `classLiterals` are read),
 *   `catalog` the loaded type injection catalog (none: the stage did not run),
 *   `identity` the annotation identity function over the repository's type
 *   dictionaries - called once with every qualified name of the catalog, whatever
 *   its role - `types` the Java call resolver over the same rows (the class node
 *   id of a type is its view's `id`, null where it is shared with another
 *   declaration) and `functionIdOf` the node id of a function entry of a row (null
 *   where it is shared). `otherJvmTypeCount` is the number of types the
 *   repository's Kotlin and Scala rows declare, which carry no supertypes (the
 *   caller counts them; none by default). `mutations` is the test seam of the
 *   mutation tripwires (design D14); production callers leave it empty.
 * @returns {{
 *   edges: object[],
 *   implementsEdges: object[],
 *   gaps: Array<{ kind: string, scope: string, sample: string }>,
 *   coverage: object,
 * }}
 *   `implementsEdges` are the `implements` edges of the business interfaces a class declares by
 *   annotation, one per (class, interface): `{ source, target, type, direction, weight, evidence,
 *   provenance }`, the evidence `{ file, line, source, token, role: 'businessInterface' }` for each
 *   class literal, at its line, `token` the type as written; the caller adds them to the graph
 *   unless the hierarchy has drawn the pair. A gap of a business interface has the kind
 *   `business-interface-unresolved`, the scope the qualified name of the annotation, and the sample
 *   `<file>:<line> <Class> <type as written>` (an unreadable one: `@<annotation>(<argument>)`, at the
 *   line of the annotation). `edges` are `injects` edges, one per (consumer class, target) with the
 *   evidence of every point that drew it, `{ file, line, source, token, role,
 *   family, member, parameter?, type?, name? }`: the role `injection` (the
 *   annotation as written), `member` (the member's name, with the declared type
 *   as written), `qualifier` (a name qualifier that filtered the candidates,
 *   with the name) and `producer` (the producer's annotation, at its line in its
 *   file). `gaps` are one occurrence per point in a gap bucket, scope the family
 *   id and `sample` `<file>:<line> <Owner>.<member>[#<parameter>] : <type>`, the
 *   line being that of the member's name and the type left out where the point
 *   has none; an ambiguous one lists its candidates after ` -> `. `coverage` is
 *   `{ status, families, unconfirmed, qualifiers, businessInterfaces }`, each family `{ annotations,
 *   points, buckets, edges }` and the business interfaces `{ annotations, declarations, buckets, edges }`
 *   (a class literal is a declaration, and so is an annotation that is not listed or not readable;
 *   `edges` the declared ones, each an entry of the evidence).
 */
export function resolveTypeInjections({ javaRows, catalog, identity, types, functionIdOf, otherJvmTypeCount = 0, mutations = {} }) {
  if (!catalog) return { edges: [], implementsEdges: [], gaps: [], coverage: TYPE_INJECTIONS_NOT_RUN };
  if (!Number.isInteger(otherJvmTypeCount) || otherJvmTypeCount < 0) {
    throw new TypeError(`type-injection-resolution: otherJvmTypeCount must be a count, got ${JSON.stringify(otherJvmTypeCount)}`);
  }

  const { families, familyOfFqn, roleOfFqn, namedArgument, businessArgument } = indexCatalog(catalog);
  const confirm = identity({ fqns: roleOfFqn.keys(), simpleNames: Boolean(mutations.simpleNameAnnotations) });
  const roleOf = (found) => (found.kind === 'catalog' ? roleOfFqn.get(found.fqn) : null);

  const stats = Object.fromEntries(families.map((family) => [family.id, { annotations: 0, points: 0, buckets: emptyBuckets(), edges: 0 }]));
  const unconfirmed = {};
  const qualifiers = {};
  const gaps = [];
  const edges = new Map(); // consumer node id, target node id -> the edge

  // -------------------------------------------------------------------------
  // The rows, the types they declare and what each annotation is
  // -------------------------------------------------------------------------
  const views = types.declaredTypes();
  const viewOfClass = new Map(views.map((view) => [view.cls, view]));
  const declarations = new Map(); // fqn -> how many declarations
  for (const view of views) declarations.set(view.fqn, (declarations.get(view.fqn) ?? 0) + 1);
  const isDeclaredOnce = (view) => declarations.get(view.fqn) === 1;

  const infos = javaRows.map((row) => {
    const classes = row.classes ?? [];
    if (classes.length > 0) {
      // A row that was extracted has these lists, empty ones included: a row with types and no list is an older extraction's.
      for (const field of ['memberAnnotations', 'nestedTypes', 'classLiterals']) {
        if (!Array.isArray(row[field])) {
          throw new Error(`type-injection-resolution: the structure row of ${row.path} has no ${field} (an output of an older extraction?)`);
        }
      }
      if (classes.some((cls) => !Array.isArray(cls.modifiers))) {
        throw new Error(`type-injection-resolution: the structure row of ${row.path} has a class with no modifiers (an output of an older extraction?)`);
      }
    }
    const first = classes.find((cls) => typeof cls.qualifiedName === 'string');
    const pkg = first === undefined ? '' : packageOf(first);
    const classViews = classes.map((cls) => viewOfClass.get(cls) ?? null);
    // The view of each top-level type by its simple name: null for a name with no node, or one declared twice.
    const byName = new Map();
    classes.forEach((cls, i) => byName.set(cls.name, byName.has(cls.name) ? null : classViews[i]));

    const functionsByKey = new Map();
    (row.functions ?? []).forEach((fn, index) => {
      const key = JSON.stringify([fn.owner, fn.name]);
      if (!functionsByKey.has(key)) functionsByKey.set(key, []);
      functionsByKey.get(key).push(index);
    });

    // The annotations of one member (or of one parameter of it), as Core records them.
    const memberUses = row.memberAnnotations ?? [];
    const groups = new Map();
    for (const use of memberUses) {
      const key = JSON.stringify([use.owner, use.on, use.member.name, use.member.line, use.parameter?.index ?? null]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(use);
    }

    // What each annotation is: counted by spelling when it could be one of the catalog's and the imports cannot say.
    const found = new Map();
    const identify = (use) => {
      const result = confirm(row, use.name, pkg);
      if (result.kind === 'unconfirmed') unconfirmed[use.name] = (unconfirmed[use.name] ?? 0) + 1;
      return result;
    };
    for (const use of memberUses) found.set(use, identify(use));
    const classFound = classes.map((cls) => (cls.annotationArguments ?? []).map((use) => ({ use, found: identify(use) })));

    return { row, pkg, classViews, classes, ownerView: (name) => byName.get(name) ?? null, functionsByKey, groups, found, classFound };
  });
  const infoOfPath = new Map(infos.map((info) => [info.row.path, info]));

  /** The index of the function entry a member annotation is on, or -1: type and name match, its lines hold the line of the name, and there is one. */
  function functionIndexOf(info, use) {
    const entries = (info.functionsByKey.get(JSON.stringify([use.owner, use.member.name])) ?? [])
      .filter((index) => info.row.functions[index].startLine <= use.member.line && use.member.line <= info.row.functions[index].endLine);
    return entries.length === 1 ? entries[0] : -1;
  }

  const resolveCache = new Map();
  /** A type text written in a file, in the scope of its top-level type (null: file scope), in the types' public form. */
  function resolveIn(info, ownerView, text, methodTypeParameters = []) {
    const key = JSON.stringify([info.row.path, ownerView === null ? null : ownerView.name, text, methodTypeParameters.map((p) => [p.name, p.bound ?? null])]);
    let resolution = resolveCache.get(key);
    if (!resolution) {
      resolution = types.resolveTypeText({ path: info.row.path, text, owner: ownerView, methodTypeParameters });
      resolveCache.set(key, resolution);
    }
    return resolution;
  }

  /** A resolution that does not say which declaration: a name the types cannot resolve, or one that several declarations have. */
  const isUnresolved = (resolution) => resolution.status === 'unknown' || resolution.status === 'ambiguous'
    || (resolution.status === 'repo' && !isDeclaredOnce(resolution.type));

  // -------------------------------------------------------------------------
  // The subtypes (D7)
  // -------------------------------------------------------------------------
  // Declared supertypes of a type, beside the ones it writes: the business interfaces its annotations declare, read below.
  const extraSupertypes = new Map();
  const subtypeIndex = lazy(() => buildSubtypeIndex({ types, extraSupertypes }));

  // -------------------------------------------------------------------------
  // The business interfaces a class declares (D10), before anything asks for a subtype
  // -------------------------------------------------------------------------
  const business = { annotations: 0, declarations: 0, buckets: emptyBusinessBuckets(), edges: 0 };
  const businessNames = new Set(); // simple names of the interfaces that could not be resolved
  const implementsEdges = new Map(); // class node id, interface node id -> the edge

  /** Only the annotations of a top-level class are read: a nested type is no session bean, and neither is an interface, an enum or a record. */
  function readBusinessInterfaces() {
    for (const info of infos) {
      info.classes.forEach((cls, index) => {
        if (cls.kind !== 'class') return;
        const view = info.classViews[index];
        const written = new Set(); // a class literal written twice at one line is one declaration
        for (const { use, found } of info.classFound[index]) {
          if (roleOf(found) !== 'businessInterface') continue;
          business.annotations += 1;
          const place = (bucket, text, line) => {
            business.declarations += 1;
            business.buckets[bucket] += 1;
            if (BUSINESS_INTERFACE_GAP_BUCKETS.includes(bucket)) {
              gaps.push({ kind: BUSINESS_INTERFACE_GAP_KIND, scope: found.fqn, sample: `${info.row.path}:${line} ${cls.name} ${text}` });
            }
          };

          const argument = argumentOf(use, businessArgument);
          if (argument === undefined) {
            place('notListed');
            continue;
          }
          const literals = argument.classLiterals ?? [];
          if (literals.length === 0) {
            place('unreadable', `@${use.name}(${argument.key})`, use.line);
            continue;
          }
          for (const literal of literals) {
            const key = JSON.stringify([literal.line, literal.type]);
            if (written.has(key)) continue;
            written.add(key);

            // Written in the scope of the class that declares it.
            const resolution = resolveIn(info, view, literal.type);
            if (resolution.status === 'external' || resolution.status === 'primitive' || resolution.status === 'array') {
              place('outsideType', literal.type, literal.line);
              continue;
            }
            if (resolution.status !== 'repo' || !isDeclaredOnce(resolution.type)) {
              const name = simpleNameOf(literal.type);
              if (name !== null) businessNames.add(name);
              place('typeUndetermined', literal.type, literal.line);
              continue;
            }
            const target = resolution.type;
            if (target.kind !== 'interface') {
              place('notInterface', literal.type, literal.line);
              continue;
            }

            // An interface of the repository the class declares: a supertype of it for the candidates, whatever becomes of the edge.
            if (view !== null) {
              if (!extraSupertypes.has(view)) extraSupertypes.set(view, []);
              extraSupertypes.get(view).push(target);
            }
            if (view !== null && types.ancestors(view).ancestors.includes(target)) {
              place('alreadySupertype', literal.type, literal.line);
              continue;
            }
            // The edge needs a node at each end.
            if (view === null || view.id == null || target.id == null) {
              place('unindexed', literal.type, literal.line);
              continue;
            }
            place('declared', literal.type, literal.line);
            business.edges += 1;
            const edgeKey = JSON.stringify([view.id, target.id]);
            if (!implementsEdges.has(edgeKey)) {
              implementsEdges.set(edgeKey, {
                source: view.id,
                target: target.id,
                type: 'implements',
                direction: 'forward',
                weight: BUSINESS_INTERFACE_EDGE_WEIGHT,
                evidence: [],
                provenance: 'extracted',
              });
            }
            implementsEdges.get(edgeKey).evidence.push({ file: info.row.path, line: literal.line, source: 'tree-sitter', token: literal.type, role: 'businessInterface' });
          }
        }
      });
    }
  }
  if (!mutations.noBusinessInterfaces) readBusinessInterfaces();

  const isInstantiable = (view) => (view.kind === 'class' || view.kind === 'record')
    && (Boolean(mutations.abstractCandidates) || !view.cls.modifiers.includes('abstract'));

  // -------------------------------------------------------------------------
  // What could be a candidate, and what could hide one - found once for the run
  // -------------------------------------------------------------------------
  /** The first type argument of a written supertype that is one of the catalog's provider types: `{ text, resolution }`, or null. */
  function providerArgument(info, ownerView, supertypeText) {
    const written = stripTypeText(supertypeText).base;
    const found = written === '' ? { kind: 'other' } : confirm(info.row, written, info.pkg);
    const unconfirmedProvider = found.kind === 'unconfirmed';
    if (!unconfirmedProvider && roleOf(found) !== 'providerType') return null;
    const text = firstTypeArgument(supertypeText);
    if (text === null) return { text: null, resolution: null };
    // A provider whose type is not known to be one is no provider that is read; what it may provide is hidden.
    return { text, resolution: unconfirmedProvider ? { status: 'unknown' } : resolveIn(info, ownerView, text) };
  }

  const directProviderArgs = new Map();
  /** What the provider types a top-level type writes directly provide: `[{ text, resolution }]`. */
  function providedDirectly(view) {
    let list = directProviderArgs.get(view);
    if (list) return list;
    const info = infoOfPath.get(view.path);
    list = [];
    for (const supertype of types.directSupertypes(view)) {
      const provided = providerArgument(info, view, supertype.text);
      if (provided !== null && provided.text !== null) list.push(provided);
    }
    directProviderArgs.set(view, list);
    return list;
  }

  /** What a top-level type provides: what it and every ancestor write directly. */
  function provided(view) {
    return [view, ...subtypeIndex().ancestorsOf(view)].flatMap(providedDirectly);
  }

  const facts = lazy(() => {
    const nestedSupertypeViews = new Set();
    const nestedProducedViews = new Set();
    const nestedProvidedViews = new Set();
    const unresolvedNames = new Set();
    const producersByType = new Map(); // type view -> producers of it
    const providersByType = new Map(); // type view -> classes that provide it
    const literalViews = new Set();
    const literalNames = new Set();
    for (const name of businessNames) unresolvedNames.add(name);
    const addName = (text) => {
      const name = simpleNameOf(text);
      if (name !== null) unresolvedNames.add(name);
    };
    const push = (map, key, value) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(value);
    };
    // A provider whose provided type is a type variable of an ancestor (`BaseProvider<X> implements Provider<X>`, `FooProvider
    // extends BaseProvider<Foo>`) provides what the variable stands for, which this stage does not substitute: every type
    // argument the type and its ancestors write may be what it provides.
    const providesThroughTypeVariable = (chain) => chain.some((view) => providedDirectly(view).some(({ resolution }) => resolution.status === 'typeVariable'));
    const blockTypeArguments = (chain) => {
      for (const view of chain) {
        for (const supertype of types.directSupertypes(view)) for (const name of typeArgumentNames(supertype.text)) unresolvedNames.add(name);
      }
    };

    for (const view of views) {
      for (const supertype of types.directSupertypes(view)) {
        if (isUnresolved(supertype.resolution)) addName(supertype.text);
      }
      // A class that provides what it cannot name hides what it provides.
      for (const { text, resolution } of providedDirectly(view)) {
        if (isUnresolved(resolution)) addName(text);
      }
      if (isInstantiable(view)) {
        for (const { text, resolution } of provided(view)) {
          if (resolution.status === 'repo' && isDeclaredOnce(resolution.type)) push(providersByType, resolution.type, view);
          else if (isUnresolved(resolution)) addName(text);
        }
        const chain = [view, ...subtypeIndex().ancestorsOf(view)];
        if (providesThroughTypeVariable(chain)) blockTypeArguments(chain);
      }
    }

    for (const info of infos) {
      // Types below top level: what each extends or implements (an anonymous class, what it instantiates).
      for (const nested of info.row.nestedTypes ?? []) {
        const ownerView = info.ownerView(nested.owner);
        const written = nested.instantiates === undefined ? nested.supertypes.map((supertype) => supertype.type) : [nested.instantiates.type];
        const reached = []; // the repository types it writes as supertypes
        let throughTypeVariable = false;
        for (const text of written) {
          const providedType = providerArgument(info, ownerView, text);
          if (providedType !== null) {
            if (providedType.text === null) continue;
            if (providedType.resolution.status === 'typeVariable') throughTypeVariable = true;
            if (providedType.resolution.status === 'repo' && isDeclaredOnce(providedType.resolution.type)) nestedProvidedViews.add(providedType.resolution.type);
            else if (isUnresolved(providedType.resolution)) addName(providedType.text);
            continue;
          }
          const resolution = resolveIn(info, ownerView, text);
          if (resolution.status === 'repo' && isDeclaredOnce(resolution.type)) {
            nestedSupertypeViews.add(resolution.type);
            reached.push(resolution.type);
            // What a type below top level provides through a supertype it writes.
            for (const { text: argumentText, resolution: argument } of provided(resolution.type)) {
              if (argument.status === 'repo' && isDeclaredOnce(argument.type)) nestedProvidedViews.add(argument.type);
              else if (isUnresolved(argument)) addName(argumentText);
            }
            if (providesThroughTypeVariable([resolution.type, ...subtypeIndex().ancestorsOf(resolution.type)])) throughTypeVariable = true;
          } else if (isUnresolved(resolution)) {
            addName(text);
          }
        }
        if (throughTypeVariable) {
          for (const text of written) for (const name of typeArgumentNames(text)) unresolvedNames.add(name);
          for (const view of reached) blockTypeArguments([view, ...subtypeIndex().ancestorsOf(view)]);
        }
      }

      // Producers: by the type they declare.
      (info.row.memberAnnotations ?? []).forEach((use) => {
        if (roleOf(info.found.get(use)) !== 'producer' || (use.on !== 'field' && use.on !== 'method')) return;
        const ownerView = info.ownerView(use.owner);
        const fnIndex = use.on === 'method' && !use.nested ? functionIndexOf(info, use) : -1;
        const declared = use.member.type;
        // A method of a top-level type is read with its own type variables; one no declaration of the row is cannot be.
        const readable = typeof declared === 'string' && (use.on === 'field' || use.nested || fnIndex >= 0);
        const resolution = readable
          ? resolveIn(info, ownerView, declared, fnIndex >= 0 ? info.row.functions[fnIndex].typeParameters ?? [] : [])
          : { status: 'unknown' };
        if (resolution.status === 'external' || resolution.status === 'array' || resolution.status === 'primitive') return;
        if (resolution.status === 'repo' && isDeclaredOnce(resolution.type)) {
          if (use.nested) {
            nestedProducedViews.add(resolution.type);
          } else if (ownerView !== null) {
            push(producersByType, resolution.type, { info, use, ownerView, fnIndex, nodeId: fnIndex >= 0 ? functionIdOf(info.row.path, fnIndex) : null });
          }
        } else if (typeof declared === 'string') {
          addName(declared);
        }
      });

      // Class literals written in code (an annotation's are the annotation's own).
      for (const literal of info.row.classLiterals ?? []) {
        if (literal.context !== 'code') continue;
        const resolution = resolveIn(info, null, literal.type);
        if (resolution.status === 'repo') literalViews.add(resolution.type);
        // A name that is none declaration's for certain may be the type's, whatever its alternatives are.
        if (isUnresolved(resolution)) {
          const name = simpleNameOf(literal.type);
          if (name !== null) literalNames.add(name);
        }
      }
    }
    return { nestedSupertypeViews, nestedProducedViews, nestedProvidedViews, unresolvedNames, producersByType, providersByType, literalViews, literalNames };
  });

  // -------------------------------------------------------------------------
  // Bean names (D8)
  // -------------------------------------------------------------------------
  /** The value an annotation's name argument writes: `{ name }`, `{ name: null }` for none written, `{ unknown: true }` for one that is no string literal. */
  function writtenBeanName(use) {
    const argument = argumentOf(use, namedArgument);
    if (argument === undefined || isEmptyLiteral(argument)) return { name: null };
    return typeof argument.value === 'string' ? { name: argument.value } : { unknown: true };
  }

  /**
   * The name a candidate has, `{ name }`, `{ unknown: true }` when its name qualifier
   * writes one that cannot be read (the candidate is kept), or `{ none: true }`.
   */
  function beanNameOfClass(view) {
    const info = infoOfPath.get(view.path);
    const entries = info.classFound[info.classes.indexOf(view.cls)] ?? [];
    const defaultName = DEFAULT_NAME_RULES['lowercase-first'](view.name);
    const named = entries.find(({ found }) => roleOf(found) === 'namedQualifier');
    if (named !== undefined) {
      const written = writtenBeanName(named.use);
      if (written.unknown) return written;
      return { name: written.name ?? defaultName };
    }
    return entries.some(({ found }) => roleOf(found) === 'defaultNameStereotype') ? { name: defaultName } : { none: true };
  }

  function beanNameOfProducer(producer) {
    const group = producer.info.groups.get(JSON.stringify([producer.use.owner, producer.use.on, producer.use.member.name, producer.use.member.line, null])) ?? [];
    const named = group.find((use) => roleOf(producer.info.found.get(use)) === 'namedQualifier');
    if (named === undefined) return { none: true };
    const written = writtenBeanName(named);
    if (written.unknown) return written;
    if (written.name !== null) return { name: written.name };
    const member = producer.use.member.name;
    if (producer.use.on === 'field') return { name: member };
    // A getter is the property it reads, as java.beans.Introspector names it; any other method is its own name.
    const property = /^(get|is)(.+)$/.exec(member);
    return { name: property === null ? member : DEFAULT_NAME_RULES['java-beans-decapitalize'](property[2]) };
  }

  const beanNameOf = (candidate) => {
    if (candidate.kind === 'class') return beanNameOfClass(candidate.view);
    if (candidate.kind === 'producer') return beanNameOfProducer(candidate);
    // What a provider's beans are called is not said by the provider class.
    return { unknown: true };
  };

  // -------------------------------------------------------------------------
  // The candidates of a type
  // -------------------------------------------------------------------------
  const candidateCache = new Map();
  /** Every declaration of the repository that can satisfy a point of type `type`, as `{ kind, ... }`. */
  function candidatesOf(type) {
    let candidates = candidateCache.get(type);
    if (candidates) return candidates;
    const { producersByType, providersByType } = facts();
    candidates = [];
    const closure = subtypeIndex().closureOf(type);
    for (const view of closure) {
      if (isInstantiable(view)) candidates.push({ kind: 'class', view, label: view.fqn, nodeId: view.id });
    }
    for (const view of closure) {
      for (const producer of producersByType.get(view) ?? []) {
        candidates.push({
          kind: 'producer',
          ...producer,
          label: `${producer.ownerView.fqn}#${producer.use.member.name}`,
          // A field is no node; a method is one when its declaration is.
          nodeId: producer.use.on === 'method' ? producer.nodeId : null,
        });
      }
    }
    for (const view of closure) {
      for (const provider of providersByType.get(view) ?? []) {
        if (!candidates.some((candidate) => candidate.kind === 'provider' && candidate.view === provider)) {
          candidates.push({ kind: 'provider', view: provider, label: provider.fqn, nodeId: null });
        }
      }
    }
    candidateCache.set(type, candidates);
    return candidates;
  }

  const hiddenCache = new Map();
  /** Whether the candidates of `type` may be incomplete (bucket hiddenCandidate). */
  function mayBeHidden(type) {
    if (!hiddenCache.has(type)) {
      const { nestedSupertypeViews, nestedProducedViews, nestedProvidedViews, unresolvedNames } = facts();
      hiddenCache.set(type, subtypeIndex().closureOf(type).some((view) => nestedSupertypeViews.has(view)
        || nestedProducedViews.has(view) || nestedProvidedViews.has(view) || unresolvedNames.has(view.name)));
    }
    return hiddenCache.get(type);
  }

  /** A type nothing can extend: a `final` class, a record or an enum. */
  const isFinal = (type) => type.kind === 'record' || type.kind === 'enum' || (type.kind === 'class' && type.cls.modifiers.includes('final'));

  /** Whether code writes the class literal of `type`, which a container cannot instantiate (bucket dynamicCandidate). */
  function isProvidedDynamically(type) {
    const cannotInstantiate = type.kind === 'interface' || (type.kind === 'class' && type.cls.modifiers.includes('abstract'));
    if (!cannotInstantiate) return false;
    const { literalViews, literalNames } = facts();
    return literalViews.has(type) || literalNames.has(type.name);
  }

  /** The annotations of a candidate that make its being a bean depend on the deployment. */
  function isDeploymentDependent(candidate) {
    const depends = (found) => roleOf(found) === 'deploymentDependent';
    const classEntries = (view) => {
      const info = infoOfPath.get(view.path);
      return info.classFound[info.classes.indexOf(view.cls)] ?? [];
    };
    if (candidate.kind !== 'producer') return classEntries(candidate.view).some(({ found }) => depends(found));
    const group = candidate.info.groups.get(JSON.stringify([candidate.use.owner, candidate.use.on, candidate.use.member.name, candidate.use.member.line, null])) ?? [];
    return group.some((use) => depends(candidate.info.found.get(use))) || classEntries(candidate.ownerView).some(({ found }) => depends(found));
  }

  // -------------------------------------------------------------------------
  // The points
  // -------------------------------------------------------------------------
  function resolveAnnotation(info, use, family) {
    const { row } = info;
    const familyStats = stats[family.id];
    familyStats.annotations += 1;

    const where = (parameter) => `${row.path}:${use.member.line} ${use.owner}.${use.member.name}${parameter === null ? '' : `#${parameter}`}`;
    const settle = (bucket, parameter, typeText, candidates) => {
      familyStats.points += 1;
      familyStats.buckets[bucket] += 1;
      const kind = TYPE_INJECTION_GAP_KINDS[bucket];
      if (kind === undefined) return;
      let sample = typeText === null ? where(parameter) : `${where(parameter)} : ${typeText}`;
      if (candidates !== undefined) {
        const labels = candidates.map((candidate) => candidate.label).sort(compareText);
        const shown = labels.slice(0, SAMPLE_CANDIDATES).join(', ');
        sample += ` -> ${labels.length > SAMPLE_CANDIDATES ? `${shown}, …+${labels.length - SAMPLE_CANDIDATES}` : shown}`;
      }
      gaps.push({ kind, scope: family.id, sample });
    };

    // What a sample says the member declares: a field's type; a method or constructor has none that is its point's.
    const declared = use.on === 'field' && typeof use.member.type === 'string' ? use.member.type : null;
    const carriersOf = (parameter) => info.groups.get(JSON.stringify([use.owner, parameter === null ? use.on : 'parameter', use.member.name, use.member.line, parameter])) ?? [];
    // The catalog lists the annotations that name a bean, not the argument that holds the name: a name annotation names one when it
    // writes an argument that is not the empty string (a constant counts). One that writes none is an annotation like any other.
    const namesABean = (carrier) => carrier.arguments.some((argument) => !isEmptyLiteral(argument));
    const hasNameAnnotation = (carriers) => carriers.some((carrier) => family.nameAnnotationSet.has(info.found.get(carrier).fqn) && namesABean(carrier));

    // 1. A name written: the first of the name arguments that is written, left empty it is as if it were not.
    const writtenName = family.nameArguments.map((key) => argumentOf(use, key)).find(Boolean);
    if ((writtenName !== undefined && !isEmptyLiteral(writtenName)) || (use.on === 'field' && hasNameAnnotation(carriersOf(null)))) {
      settle('byName', null, declared);
      return;
    }
    // 2. A JNDI name written.
    if (family.lookupArguments.some((key) => { const argument = argumentOf(use, key); return argument !== undefined && !isEmptyLiteral(argument); })) {
      settle('jndi', null, declared);
      return;
    }

    const callable = use.on === 'method' || use.on === 'constructor';
    const fnIndex = callable && !use.nested ? functionIndexOf(info, use) : -1;
    const fn = fnIndex >= 0 ? row.functions[fnIndex] : null;
    // 3. A kind of member the family does not read, or a method that is not one parameter's setter where the family wants one.
    if (!family.on.includes(use.on) || (use.on === 'method' && family.singleParameterMethods && fn !== null && (fn.paramTypes ?? []).length !== 1)) {
      settle('position', null, declared);
      return;
    }
    // 4. A member of a nested, local or anonymous type.
    if (use.nested) {
      settle('nested', null, declared);
      return;
    }
    // 5. A member the row cannot say: no declared type, no declaration, or a consumer with no node.
    const consumer = info.ownerView(use.owner);
    const memberIndexed = callable ? fn !== null && functionIdOf(row.path, fnIndex) != null : declared !== null;
    if (consumer === null || consumer.id == null || !memberIndexed) {
      settle('memberUnindexed', null, declared);
      return;
    }

    if (!callable) {
      resolvePoint({ parameter: null, written: declared, carriers: carriersOf(null), methodTypeParameters: [] });
    } else {
      (fn.paramTypes ?? []).forEach((paramType, index) => {
        const carriers = carriersOf(index);
        // The name annotation of a parameter names the bean of that parameter.
        if (hasNameAnnotation(carriers)) settle('byName', index, paramType);
        else resolvePoint({ parameter: index, written: paramType, carriers, methodTypeParameters: fn.typeParameters ?? [] });
      });
    }

    /** Steps 6-16 for one point: `written` is the type the member declares. */
    function resolvePoint({ parameter, written, carriers, methodTypeParameters }) {
      // The type to satisfy: the declared one, or the class literal the family's argument restates it with.
      let typeText = written;
      const restated = family.typeArgument === null ? undefined : argumentOf(use, family.typeArgument);
      if (restated !== undefined) {
        const literals = restated.classLiterals ?? [];
        if (literals.length !== 1) {
          settle('typeUndetermined', parameter, written);
          return;
        }
        typeText = literals[0].type;
      }

      // 6-8. What the type is. Core writes a method's own type variables in `paramTypes` as their bound, so a parameter point never reads
      // one as a type variable; the containers do not inject into a generic method, so this makes no edge that is not the parameter's.
      const resolution = resolveIn(info, consumer, typeText, methodTypeParameters);
      if (resolution.status === 'external' || resolution.status === 'primitive' || resolution.status === 'array') {
        settle('outsideType', parameter, typeText);
        return;
      }
      if (resolution.status === 'typeVariable') {
        settle('typeVariable', parameter, typeText);
        return;
      }
      if (resolution.status !== 'repo' || !isDeclaredOnce(resolution.type)) {
        settle('typeUndetermined', parameter, typeText);
        return;
      }
      const type = resolution.type;

      // 9. A qualifier the family reads and this stage cannot: any annotation beside the injection that is not known to be no qualifier.
      const names = [];
      if (family.readsQualifiers) {
        const unresolved = [];
        for (const carrier of carriers) {
          if (carrier === use) continue;
          const found = info.found.get(carrier);
          const role = roleOf(found);
          if (role === 'injection' || role === 'notQualifier') continue;
          if (role === 'namedQualifier') {
            const writtenQualifier = writtenBeanName(carrier);
            // A name left out is the field's own; a parameter has none to default to.
            const name = writtenQualifier.name === null && parameter === null ? use.member.name : writtenQualifier.name;
            if (writtenQualifier.unknown || name === null) unresolved.push(carrier.name);
            else names.push({ name, carrier });
            continue;
          }
          if (!mutations.ignoreUnknownQualifiers) unresolved.push(carrier.name);
        }
        if (unresolved.length > 0) {
          for (const spelling of unresolved) qualifiers[spelling] = (qualifiers[spelling] ?? 0) + 1;
          settle('qualifierUnresolved', parameter, typeText);
          return;
        }
      }

      // 10. Candidates that may be missing: what the rows say, and the types of other JVM languages, which write no supertypes.
      if (!mutations.noHiddenCandidates && (mayBeHidden(type) || (otherJvmTypeCount > 0 && !isFinal(type)))) {
        settle('hiddenCandidate', parameter, typeText);
        return;
      }
      // 11. An instance that no declaration of the repository makes.
      if (!mutations.noDynamicGuard && isProvidedDynamically(type)) {
        settle('dynamicCandidate', parameter, typeText);
        return;
      }

      // 12-13. The candidates, kept by the name a name qualifier asks for.
      let candidates = candidatesOf(type);
      if (!mutations.noNamedFilter) {
        for (const { name } of names) {
          candidates = candidates.filter((candidate) => {
            const has = beanNameOf(candidate);
            return has.unknown === true || has.name === name;
          });
        }
      }
      if (candidates.length === 0) {
        settle('noCandidate', parameter, typeText);
        return;
      }
      if (candidates.length > 1 && !mutations.firstCandidate) {
        settle('ambiguous', parameter, typeText, candidates);
        return;
      }

      // 14-15. The one candidate.
      const [candidate] = candidates;
      if (isDeploymentDependent(candidate)) {
        settle('deploymentDecided', parameter, typeText);
        return;
      }
      if (candidate.nodeId == null) {
        settle('noTargetNode', parameter, typeText);
        return;
      }

      // 16. An edge: one for the pair, whatever points draw it.
      settle('edge', parameter, typeText);
      familyStats.edges += 1;
      const key = JSON.stringify([consumer.id, candidate.nodeId]);
      if (!edges.has(key)) {
        edges.set(key, {
          source: consumer.id,
          target: candidate.nodeId,
          type: 'injects',
          direction: 'forward',
          weight: TYPE_INJECTS_EDGE_WEIGHT,
          evidence: [],
          provenance: 'extracted',
        });
      }
      // `parameterOf` is the consumer's parameter the entry is about; none for what a producer's line says.
      const entry = (file, line, token, role, member, extra = {}, parameterOf = parameter) => ({
        file, line, source: 'tree-sitter', token, role, family: family.id, member, ...(parameterOf === null ? {} : { parameter: parameterOf }), ...extra,
      });
      const evidence = edges.get(key).evidence;
      evidence.push(entry(row.path, use.line, use.name, 'injection', use.member.name));
      evidence.push(entry(row.path, use.member.line, use.member.name, 'member', use.member.name, { type: written }));
      for (const { name, carrier } of names) {
        evidence.push(entry(row.path, carrier.line, carrier.name, 'qualifier', use.member.name, { name }));
      }
      if (candidate.kind === 'producer') {
        evidence.push(entry(candidate.info.row.path, candidate.use.line, candidate.use.name, 'producer', candidate.use.member.name, {}, null));
      }
    }
  }

  for (const info of infos) {
    for (const use of info.row.memberAnnotations ?? []) {
      const found = info.found.get(use);
      if (found.kind !== 'catalog') continue;
      const family = familyOfFqn.get(found.fqn);
      if (family !== undefined) resolveAnnotation(info, use, family);
    }
  }

  const coverage = {
    status: 'ran',
    families: stats,
    unconfirmed: Object.fromEntries(Object.entries(unconfirmed).sort(([a], [b]) => compareText(a, b))),
    qualifiers: Object.fromEntries(Object.entries(qualifiers).sort(([a], [b]) => compareText(a, b))),
    businessInterfaces: business,
  };
  const businessEvidenceOrder = (a, b) => compareText(a.file, b.file) || a.line - b.line || compareText(a.token, b.token);
  return {
    edges: [...edges.values()].map((edge) => ({ ...edge, evidence: uniqueSortedEvidence(edge.evidence) })),
    implementsEdges: [...implementsEdges.values()].map((edge) => ({ ...edge, evidence: [...edge.evidence].sort(businessEvidenceOrder) })),
    gaps,
    coverage,
  };
}
