/**
 * annotation-injection-resolution.mjs
 *
 * Resolution of the Java annotation injection sites (openspec: changes/
 * annotation-injection-references, capability `fact-graph`, design D2 and D4-D9,
 * D11): an annotation on a field, a method, a constructor, a parameter or a
 * record component that writes the name of another declaration (Spring
 * `@Qualifier("orderDao")`, Seam `@In`, EJB `@EJB(beanName = ...)`) becomes an
 * `injects` edge from the class that declares it (the consumer) to the class the
 * name comes to, or lands in a visible bucket that says why it did not. Core
 * records the annotations (`memberAnnotations` of the structure rows); the binding
 * table (name-reference-resolution.mjs) holds every name binding with the class it
 * comes to, through aliases, parents and factories. This module only decides.
 *
 * Pure and build-free: it reads the catalog, the structure rows and the table. It
 * never reads a file, and nothing here is about a framework: which annotations are
 * sites, on which members, where they write a name, how a member that writes none
 * is named, which bindings manage a consumer and which bindings a name may come
 * to, are the catalog's.
 *
 * What a site is (D2, D4): a member annotation whose identity - by Java's scope
 * rules, one function shared with the annotation bindings - is a site annotation
 * of the catalog. A spelling that matches the simple name of one and cannot be
 * confirmed is counted by spelling (`unconfirmed`) and is no site. A name is the
 * string literal of the first of the site's name arguments that is written, at the
 * line of that argument; one left out or written empty is the member's default
 * name by the site's rule, at the line of the member's name.
 *
 * Every site has exactly one fate, in this order (D6):
 *   position           the member is of a kind the site does not read
 *   nonLiteral         the name argument is written, and is not a string literal
 *   unnamed            no name written, and this member has no default name: the
 *                      container injects by type
 *   expression         the name starts with the site's expression prefix
 *   consumerUnindexed  the top-level type the member is in has no class node
 *   unmanaged          the family wants a managed consumer, and no binding of a
 *                      managing binder comes to the consumer's class
 *   then, over the bindings whose name is the name, in the family's namespace
 *   (and, when the family limits them, of its binders), in the deployment units
 *   of the managing bindings - or, for a family that wants no managing, in the
 *   unit of the class file:
 *   edge       all bind the same repository class node
 *   bundle     all are resource bundles
 *   external   all bind the same class outside the repository
 *   unindexed  all bind the same repository class that has no node
 *   unknown    all have no target
 *   ambiguous  anything else
 *   and with none of them:
 *   byType     the name was the member's default and the site falls back to the
 *              type when no bean has it
 *   elsewhere  another unit, namespace or binder has the name
 *   unbound    no binding anywhere
 * The consumer is decided before the target because a consumer in an annotation
 * is the class that declares it, which needs no resolution, and whether the
 * container manages it says where its names are looked for.
 *
 * Nothing falls through to a wider match: no other unit, no other namespace, no
 * binder the family does not list, no first candidate.
 *
 * `mergeInjectsEdges` joins the edges of this stage and of the XML stage: two
 * sources that draw the same (consumer, target) make one edge, with both sources'
 * evidence. `assertInjectionConservation` (xml-injection-resolution.mjs) checks
 * the buckets and the gaps of both stages together.
 */

import { DEFAULT_NAME_RULES } from './name-binding-catalog.mjs';
import { packageOf, unitLabel } from './name-reference-resolution.mjs';

/** Same weight as the XML injections: every edge is extracted from cited lines. */
const INJECTS_EDGE_WEIGHT = 0.5;

/** The fifteen fates of a site, in the order D6 decides them. */
export const ANNOTATION_INJECTION_BUCKETS = Object.freeze([
  'position', 'nonLiteral', 'unnamed', 'expression', 'consumerUnindexed', 'unmanaged',
  'edge', 'bundle', 'external', 'unindexed', 'unknown', 'ambiguous',
  'byType', 'elsewhere', 'unbound',
]);

/**
 * The buckets that are gaps, and the gap kind each one records: the five kinds
 * the XML injections record, with the buckets of this source. The others are
 * right not to draw an edge (D8).
 */
export const ANNOTATION_INJECTION_GAP_KINDS = Object.freeze({
  nonLiteral: 'injection-target-unresolved',
  expression: 'injection-target-unresolved',
  unindexed: 'injection-target-unresolved',
  unknown: 'injection-target-unresolved',
  ambiguous: 'injection-ambiguous',
  elsewhere: 'injection-elsewhere',
  unbound: 'injection-unbound',
  consumerUnindexed: 'injection-consumer-unresolved',
});

const TARGET_BUCKET = Object.freeze({ bundle: 'bundle', external: 'external', unindexed: 'unindexed', unknown: 'unknown', ambiguous: 'ambiguous' });

const isSetter = (methodName) => methodName.startsWith('set') && methodName.length > 3;

/**
 * The rules an annotation injection site's `defaultName` may select (the names
 * are the catalog's `MEMBER_DEFAULT_NAME_RULES`): the name of what a member that
 * writes none stands for, or `undefined` where the member has none. They are
 * about what a field, a setter and a method are; no framework is in them.
 */
export const MEMBER_NAME_RULES = Object.freeze({
  /** A field is its own name; a setter is the property it sets, decapitalized as `java.beans.Introspector` does; any other method is its own name. */
  'member-java-beans': (use) => {
    if (use.on === 'field') return use.member.name;
    if (use.on !== 'method') return undefined;
    return isSetter(use.member.name) ? DEFAULT_NAME_RULES['java-beans-decapitalize'](use.member.name.slice(3)) : use.member.name;
  },
  /** A field is its own name; a setter is the property it sets, first letter lower case; no other method has one. */
  'member-seam': (use) => {
    if (use.on === 'field') return use.member.name;
    return use.on === 'method' && isSetter(use.member.name) ? DEFAULT_NAME_RULES['lowercase-first'](use.member.name.slice(3)) : undefined;
  },
});

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function evidenceOrder(a, b) {
  return compareText(a.file, b.file) || a.line - b.line || compareText(a.token, b.token) || compareText(a.site, b.site);
}

/** Evidence of one edge, without repeats of (file, line, token, site), in the order of `evidenceOrder`. */
function uniqueSortedEvidence(evidence) {
  const unique = new Map(evidence.map((entry) => [JSON.stringify([entry.file, entry.line, entry.token, entry.site]), entry]));
  return [...unique.values()].sort(evidenceOrder);
}

/** Where a binding is, as evidence cites it. */
const siteOf = ({ file, line, binder }) => ({ file, line, binder });

/** The places of some bindings, by file, line and binder, each once. */
function sortedSites(bindings) {
  const unique = new Map(bindings.map((binding) => [JSON.stringify([binding.file, binding.line, binding.binder]), siteOf(binding)]));
  return [...unique.values()].sort((a, b) => compareText(a.file, b.file) || a.line - b.line || compareText(a.binder, b.binder));
}

/**
 * The name a site writes (D4): `{ kind: 'written', name, token, line }` for the
 * string literal of the first of the site's name arguments that is written and
 * not empty, `{ kind: 'default', ... }` for the member's name by the site's rule
 * when none is, `{ kind: 'nonLiteral', key, line }` when the argument is written
 * and is no string literal, `{ kind: 'unnamed' }` when there is no name and no
 * default. `token` is what the line writes.
 */
function readName(site, rule, use) {
  const written = site.nameArguments.map((key) => use.arguments.find((argument) => argument.key === key)).find(Boolean);
  if (written !== undefined && typeof written.value !== 'string') return { kind: 'nonLiteral', key: written.key, line: written.line };
  if (written !== undefined && written.value !== '') return { kind: 'written', name: written.value, token: written.value, line: written.line };
  const name = rule === null ? undefined : rule(use);
  if (name === undefined) return { kind: 'unnamed' };
  return { kind: 'default', name, token: use.member.name, line: use.member.line };
}

/**
 * @param {{
 *   javaRows: object[],
 *   catalog: object,
 *   table: ReturnType<typeof import('./name-reference-resolution.mjs').buildNameBindingTable>,
 *   classIds: Map<string, Array<string|null>>,
 *   mutations?: {
 *     annotationSimpleNames?: boolean, annotationIgnoreManaged?: boolean, annotationIgnoreBinders?: boolean,
 *     annotationNoFallback?: boolean, annotationTokenIsName?: boolean,
 *   },
 * }} args
 *   `javaRows` are the structure rows of the Java files (their `memberAnnotations`
 *   and `classes` are read), `classIds` the node ids of their `classes` entries
 *   index for index (null where an id is shared with another declaration and so
 *   names no node), `table` the binding table built from the same rows.
 *   `mutations` is the test seam of the mutation tripwires (design D11; the
 *   table's own seams act on the bindings and the consumers' management, because
 *   they live there); production callers leave it empty.
 * @returns {{
 *   edges: object[],
 *   gaps: Array<{ kind: string, scope: string, sample: string }>,
 *   coverage: object,
 * }}
 *   `edges` are `injects` edges between class node ids, one per (consumer class,
 *   target class), each with the evidence of every site that drew it:
 *   `{ file, line, source, token, name, site, consumer: { bindings }, bindings }`,
 *   the bindings being `{ file, line, binder }` - those that manage the consumer
 *   and those the name came to. `gaps` are one occurrence per site in a gap
 *   bucket, `sample` being `<file>:<line> <name> -> [<candidates or reason>]`,
 *   scope `java`. `coverage` is
 *   `{ status, sites, buckets, siteCount, nested, unconfirmed }`.
 */
export function resolveAnnotationInjections({ javaRows, catalog, table, classIds, mutations = {} }) {
  const families = catalog.annotationInjections.map((family) => ({
    ...family,
    binders: family.binders === undefined ? null : new Set(family.binders),
    managedBy: new Set(family.consumer.managedBy),
  }));
  const siteOfAnnotation = new Map(); // annotation fqn -> { family, site, rule }
  for (const family of families) {
    for (const site of family.sites) {
      if (site.defaultName !== null && !Object.hasOwn(MEMBER_NAME_RULES, site.defaultName)) {
        throw new Error(`annotation-injection-resolution: the site ${JSON.stringify(site.id)} says the default-name rule ${JSON.stringify(site.defaultName)}, which this stage does not have`);
      }
      const rule = site.defaultName === null ? null : MEMBER_NAME_RULES[site.defaultName];
      for (const fqn of site.annotations) siteOfAnnotation.set(fqn, { family, site, rule });
    }
  }
  const confirm = table.annotationIdentity({ fqns: siteOfAnnotation.keys(), simpleNames: Boolean(mutations.annotationSimpleNames) });

  const buckets = Object.fromEntries(ANNOTATION_INJECTION_BUCKETS.map((bucket) => [bucket, 0]));
  const siteCounts = Object.fromEntries(families.flatMap((family) => family.sites.map((site) => [site.id, 0])));
  const unconfirmed = {};
  const edges = new Map(); // consumer node id, target node id -> the edge
  const gaps = [];
  let siteCount = 0;
  let nested = 0;

  for (const row of javaRows) {
    if (!Array.isArray(row.memberAnnotations)) {
      // A row that was extracted has the list, an empty one included: a row with types and no list is an older extraction's.
      if ((row.classes ?? []).length > 0) {
        throw new Error(`annotation-injection-resolution: the structure row of ${row.path} has no memberAnnotations (an output of an older extraction?)`);
      }
      continue;
    }
    if (row.memberAnnotations.length === 0) continue;

    // One package for the file; the top-level types of a file share it.
    const firstClass = (row.classes ?? []).find((cls) => typeof cls.qualifiedName === 'string');
    const pkg = firstClass === undefined ? '' : packageOf(firstClass);
    const unit = table.unitOf(row.path);
    // The class node of each top-level type by its simple name: null for a name with no node, or one declared twice.
    const consumers = new Map();
    (row.classes ?? []).forEach((cls, index) => {
      consumers.set(cls.name, consumers.has(cls.name) ? null : (classIds.get(row.path)?.[index] ?? null));
    });

    for (const use of row.memberAnnotations) {
      const identity = confirm(row, use.name, pkg);
      if (identity.kind === 'other') continue;
      if (identity.kind === 'unconfirmed') {
        unconfirmed[use.name] = (unconfirmed[use.name] ?? 0) + 1;
        continue;
      }
      const { family, site, rule } = siteOfAnnotation.get(identity.fqn);
      siteCount += 1;
      siteCounts[site.id] += 1;
      if (use.nested) nested += 1;

      const place = (bucket, label, line, candidates) => {
        buckets[bucket] += 1;
        const kind = ANNOTATION_INJECTION_GAP_KINDS[bucket];
        if (kind !== undefined) gaps.push({ kind, scope: 'java', sample: `${row.path}:${line} ${label} -> [${candidates.join(', ')}]` });
      };

      if (!site.on.includes(use.on)) {
        place('position');
        continue;
      }
      const written = readName(site, rule, use);
      if (written.kind === 'nonLiteral') {
        place('nonLiteral', `@${use.name}(${written.key})`, written.line, [`nonLiteral: the ${written.key} argument is not a string literal`]);
        continue;
      }
      if (written.kind === 'unnamed') {
        place('unnamed');
        continue;
      }
      const { name, line } = written;
      if (site.expressionPrefix !== null && name.startsWith(site.expressionPrefix)) {
        place('expression', name, line, [`expression: starts with ${JSON.stringify(site.expressionPrefix)}`]);
        continue;
      }

      const consumerId = consumers.get(use.owner) ?? null;
      if (consumerId === null) {
        place('consumerUnindexed', name, line, [`consumerUnindexed: no class node for ${use.owner}`]);
        continue;
      }

      // Where the name is looked for: the units that manage the consumer, or its own unit when the family asks for no management.
      let managing = [];
      let units = [unit];
      if (family.managedBy.size > 0 && !mutations.annotationIgnoreManaged) {
        managing = table.bindingsOfClass(consumerId).filter((binding) => family.managedBy.has(binding.binder));
        if (managing.length === 0) {
          place('unmanaged');
          continue;
        }
        units = [...new Set(managing.map((binding) => binding.unit))];
      }

      // The bindings the name hits: the scope's units, the family's namespace and, when it limits them, its binders.
      const limited = family.binders !== null && !mutations.annotationIgnoreBinders;
      const hits = units
        .flatMap((scopeUnit) => table.bindingsNamed(name, { unit: scopeUnit, namespace: family.namespace }))
        .filter((binding) => !limited || family.binders.has(binding.binder));

      if (hits.length === 0) {
        if (written.kind === 'default' && site.fallbackToType && !mutations.annotationNoFallback) {
          place('byType');
          continue;
        }
        const elsewhere = table.named(name);
        if (elsewhere.length === 0) {
          place('unbound', name, line, []);
        } else {
          place('elsewhere', name, line, [...new Set(elsewhere.map((binding) => `${unitLabel(binding.unit)} [${binding.namespace}]`))].sort(compareText));
        }
        continue;
      }

      const resolved = table.resolveHits(hits);
      const { target } = resolved;
      if (target.kind !== 'node') {
        const bucket = TARGET_BUCKET[target.kind];
        if (bucket === undefined) throw new Error(`annotation-injection-resolution: a name resolved to a target of kind ${JSON.stringify(target.kind)}`);
        // Where the bindings are and why each has no target, for an unknown one; what the target is, for the others.
        const candidates = bucket === 'unknown'
          ? [...new Set(hits.map((binding) => `${binding.file}:${binding.line}${binding.target.reason === undefined ? '' : ` (${binding.target.reason})`}`))].sort(compareText)
          : target.labels;
        place(bucket, name, line, candidates);
        continue;
      }

      // The name reached a class of the repository: one edge for the pair, whatever sites draw it.
      buckets.edge += 1;
      const key = JSON.stringify([consumerId, target.id]);
      if (!edges.has(key)) {
        edges.set(key, {
          source: consumerId,
          target: target.id,
          type: 'injects',
          direction: 'forward',
          weight: INJECTS_EDGE_WEIGHT,
          evidence: [],
          provenance: 'extracted',
        });
      }
      edges.get(key).evidence.push({
        file: row.path,
        line,
        source: 'lexical',
        // What the line writes: the name, or - for a default - the member's own spelling (`setOrderDao`). Tripwire seam: the name resolved with.
        token: mutations.annotationTokenIsName ? name : written.token,
        name,
        site: site.id,
        // How the consumer's class is known to be the container's: the bindings that declare it a component.
        consumer: { bindings: sortedSites(managing) },
        // How the name's class was found: the bindings it hit, and those an alias or a parent sent it on to.
        bindings: resolved.via.map(siteOf),
      });
    }
  }

  const drawn = [...edges.values()].map((edge) => ({ ...edge, evidence: uniqueSortedEvidence(edge.evidence) }));
  const coverage = {
    status: 'ran',
    sites: siteCounts,
    buckets,
    siteCount,
    nested,
    unconfirmed: Object.fromEntries(Object.entries(unconfirmed).sort(([a], [b]) => compareText(a, b))),
  };
  return { edges: drawn, gaps, coverage };
}

/**
 * The `injects` edges of the XML stage and of this one, as one edge per
 * (consumer class, target class) with the evidence of both, by file, line, token
 * and site, without repeats (D7). A pair either source draws alone comes through
 * as it is. Done before the edges go into the graph: the graph keeps the first
 * edge of a type and two ends and drops a second, so the second source's evidence
 * would be lost there without a word.
 *
 * @param {{ xmlEdges: object[], annotationEdges: object[], mutations?: { noInjectsMerge?: boolean } }} args
 *   `mutations` is the test seam of the mutation tripwires (design D11): the edge
 *   of the second source is dropped, as the graph would; production callers leave it empty.
 * @returns {object[]} new edges in the order each pair is first met, the XML stage's first; the inputs are not changed
 */
export function mergeInjectsEdges({ xmlEdges, annotationEdges, mutations = {} }) {
  const merged = new Map();
  for (const edge of [...xmlEdges, ...annotationEdges]) {
    if (edge.type !== 'injects') throw new Error(`annotation-injection-resolution: an edge of the type ${JSON.stringify(edge.type)} among the injects edges to merge`);
    const key = JSON.stringify([edge.source, edge.target]);
    if (!merged.has(key)) merged.set(key, { ...edge, evidence: [...edge.evidence] });
    else if (!mutations.noInjectsMerge) merged.get(key).evidence.push(...edge.evidence);
  }
  return [...merged.values()].map((edge) => ({ ...edge, evidence: uniqueSortedEvidence(edge.evidence) }));
}
