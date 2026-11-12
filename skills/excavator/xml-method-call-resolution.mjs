/**
 * xml-method-call-resolution.mjs
 *
 * Resolution of the XML method call sites (openspec: changes/spring-xml-method-
 * calls, capability `fact-graph`, design D1-D3): an attribute in a descriptor
 * that names a method the container calls (Spring `init-method="start"`, the
 * setter a `<property name="dao">` stands for) becomes an `invokes` edge from
 * the descriptor's file node to the method node, or lands in a visible bucket
 * that says why it did not. The reading stage (xml-name-bindings.mjs,
 * name-reference-sites.mjs) records the sites; the binding table
 * (name-reference-resolution.mjs) gives the class a name or a bean element comes
 * to; the Java type queries give a class's repository ancestors. This module
 * only decides.
 *
 * Pure and build-free: it never reads a file, and nothing here is about a
 * framework: which attributes name a method, how the name is got, which class
 * the method belongs to, how many arguments it takes and whether a missing
 * method is no gap, are the catalog's.
 *
 * Every call has exactly one fate, the class first, then the method:
 *   the class the method belongs to (the site's `owner`)
 *     consumer   the class of the bean element the site is in, by the consumer
 *                rules of an injection site (a factory-built bean has none)
 *     declared   the class the bean element writes, whether or not a factory
 *                builds it (a static factory method is on that class)
 *     named      the class the bean named by an attribute of the element (or of
 *                a listed ancestor) comes to, by the target rules of an
 *                injection site in the unit and namespace of the file
 *   and when that is no repository class:
 *     ownerMissing    no consumer element, or the named attribute is not written
 *     ownerExternal   the class is outside the repository (no gap)
 *     ownerBundle     the name is a resource bundle (no gap)
 *     ownerUnindexed  a repository class that has no node
 *     ownerUnknown    no class that can be told
 *     ownerAmbiguous  several classes, or a class name several declarations carry
 *     ownerElsewhere  (named) another unit or namespace has the name
 *     ownerUnbound    (named) no binding anywhere
 *   the method, by name and argument count on the first type that has one, in
 *   dispatch order: the class, then its repository ancestors, nearest first
 *   (constructors do not count):
 *     edge            exactly one: an `invokes` edge
 *     methodAmbiguous several on that type (overloads), or one whose node id another
 *                     declaration shares and so is no node
 *     methodNotModeled a setter for a nested property path (`a.b`): not looked up
 *     methodExternal  none, and a supertype is outside the repository or cannot
 *                     be resolved: the method may be the library's
 *     optionalInactive none, for an optional site: the container skips it (no gap)
 *     methodMissing   none, otherwise
 *
 * `assertMethodCallConservation` checks that the buckets add up to the calls and
 * that the gaps recorded for each gap kind add up to their buckets.
 */

/** Same weight as `injects`: every edge is extracted from cited lines. */
const INVOKES_EDGE_WEIGHT = 0.5;

/** The fourteen fates of a call, the class's first, then the method's. */
export const XML_METHOD_CALL_BUCKETS = Object.freeze([
  'ownerMissing', 'ownerExternal', 'ownerBundle', 'ownerUnindexed', 'ownerUnknown', 'ownerAmbiguous', 'ownerElsewhere', 'ownerUnbound',
  'edge', 'methodMissing', 'methodExternal', 'methodNotModeled', 'methodAmbiguous', 'optionalInactive',
]);

/** The buckets that are gaps, and the gap kind each one records. */
export const XML_METHOD_CALL_GAP_KINDS = Object.freeze({
  ownerMissing: 'method-call-owner-unresolved',
  ownerUnknown: 'method-call-owner-unresolved',
  ownerUnindexed: 'method-call-owner-unresolved',
  ownerAmbiguous: 'method-call-owner-unresolved',
  ownerElsewhere: 'method-call-owner-unresolved',
  ownerUnbound: 'method-call-owner-unresolved',
  methodMissing: 'method-call-method-unresolved',
  methodExternal: 'method-call-method-unresolved',
  methodNotModeled: 'method-call-method-unresolved',
  methodAmbiguous: 'method-call-ambiguous',
});

const BUCKETS_OF_GAP_KIND = Object.freeze(Object.entries(XML_METHOD_CALL_GAP_KINDS).reduce((kinds, [bucket, kind]) => {
  (kinds[kind] ??= []).push(bucket);
  return kinds;
}, {}));

const OWNER_BUCKET = Object.freeze({
  bundle: 'ownerBundle', external: 'ownerExternal', unindexed: 'ownerUnindexed', unknown: 'ownerUnknown', ambiguous: 'ownerAmbiguous',
});

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sum = (values) => values.reduce((total, value) => total + value, 0);

/**
 * Fail-closed check that every call landed in exactly one bucket, and that the
 * gaps recorded for each gap kind add up to the buckets that kind covers.
 *
 * @param {{ buckets: Record<string, number>, siteCount: number }} coverage the `coverage.methodCalls` section of a run
 * @param {Record<string, number>} gapCounts the counts read back from the recorded gaps, by gap kind
 */
export function assertMethodCallConservation(coverage, gapCounts) {
  const { buckets, siteCount } = coverage;
  const total = sum(XML_METHOD_CALL_BUCKETS.map((bucket) => buckets[bucket]));
  if (total !== siteCount) {
    throw new Error(`xml-method-call-resolution: ${siteCount} method call site(s) but ${total} outcome(s)`);
  }
  for (const [kind, kindBuckets] of Object.entries(BUCKETS_OF_GAP_KIND)) {
    const expected = sum(kindBuckets.map((bucket) => buckets[bucket]));
    if (expected !== gapCounts[kind]) {
      throw new Error(`xml-method-call-resolution: ${expected} ${kind} outcome(s) but ${gapCounts[kind]} recorded gap occurrence(s)`);
    }
  }
}

/** Where a binding is, as evidence cites it. */
const siteOf = ({ file, line, binder }) => ({ file, line, binder });

function evidenceOrder(a, b) {
  return compareText(a.file, b.file) || a.line - b.line || compareText(a.token, b.token) || compareText(a.site, b.site);
}

/**
 * The methods with a name and an argument count on the first type that has any, the class
 * or then its repository ancestors, nearest first: `{ candidates, hasOutside }`. A candidate is a
 * declaration, once however many paths reach it, with its node id (null when
 * another declaration shares it).
 */
function createMethodFinder({ types, javaRows, functionIds }) {
  const rowByPath = new Map(javaRows.map((row) => [row.path, row]));
  const viewById = new Map();
  for (const view of types.declaredTypes()) {
    // A type whose id is shared names no node: nothing an edge could start from or lead to.
    if (view.id !== null && !viewById.has(view.id)) viewById.set(view.id, view);
  }

  const declarationsOf = (view, name) => {
    const row = rowByPath.get(view.path);
    const found = [];
    (row?.functions ?? []).forEach((fn, index) => {
      if (fn.owner !== view.cls.name || fn.name !== name) return;
      // A constructor is no method a name calls.
      if (fn.name === view.cls.name && fn.declaredReturnType === undefined) return;
      found.push({ key: `${view.path}\u0000${index}`, id: functionIds.get(view.path)?.[index] ?? null, arity: (fn.paramTypes ?? []).length, signature: (fn.paramTypes ?? []).join(','), owner: view });
    });
    return found;
  };

  return {
    /** The type view of a class node id, or null for a node the type index has no view of. */
    typeOf: (classId) => viewById.get(classId) ?? null,
    find(view, name, arity) {
      const hierarchy = types.ancestors(view);
      // Runtime dispatch order: the class, then its ancestors, nearest first. The first type with a match is the
      // one the container calls; an overridden declaration further up is reached through `overrides`.
      const outside = hierarchy.hasExternal || hierarchy.hasUnknown;
      for (const type of [view, ...hierarchy.ancestors]) {
        const candidates = declarationsOf(type, name).filter((declaration) => arity === null || declaration.arity === arity);
        if (candidates.length > 0) return { candidates, hasOutside: outside };
      }
      return { candidates: [], hasOutside: outside };
    },
  };
}

/**
 * @param {{
 *   sites: { methodCalls: object[], methodCallFiles: Record<string, number>, methodCallsEmpty: number },
 *   catalog: object,
 *   table: ReturnType<typeof import('./name-reference-resolution.mjs').buildNameBindingTable>,
 *   manifestPaths: Iterable<string>,
 *   types: ReturnType<typeof import('./java-call-resolution.mjs').createJavaCallResolver>,
 *   javaRows: object[],
 *   functionIds: Map<string, (string|null)[]>,
 *   languageOf?: (path: string) => string|undefined,
 * }} args
 *   `sites` is the output of name-reference-sites.mjs and `table` the binding
 *   table built from it; `types` is the call resolver of the Java rows (its type
 *   queries are read), `functionIds` the node ids of the rows' functions.
 * @returns {{
 *   edges: Array<{ file: string, target: string, evidence: object[] }>,
 *   gaps: Array<{ kind: string, scope: string, sample: string }>,
 *   coverage: object,
 * }}
 *   `edges` are one per (descriptor file, method node), each with the evidence of
 *   every call that drew it; the caller draws them from the file's node. `gaps`
 *   are one occurrence per call in a gap bucket. `coverage` is `{ status, files,
 *   sites, buckets, siteCount, emptyValues }`.
 */
export function resolveXmlMethodCalls({
  sites, catalog, table, manifestPaths, types, javaRows, functionIds, languageOf = () => undefined,
}) {
  if (!Array.isArray(sites.methodCalls)) {
    throw new Error('xml-method-call-resolution: the name-reference sites have no methodCalls (an output of an older stage?)');
  }
  const manifest = new Set(manifestPaths);
  const families = new Map(catalog.xmlMethodCalls.map((family) => [family.id, family]));
  // Site id -> its definition; a default is its `like` site's, optional.
  const definitions = new Map();
  for (const family of catalog.xmlMethodCalls) {
    for (const site of family.sites) definitions.set(site.id, { family, site });
    for (const entry of family.defaults) {
      const like = family.sites.find((site) => site.id === entry.like);
      definitions.set(entry.id, { family, site: { ...like, id: entry.id, optional: true } });
    }
  }
  const finder = createMethodFinder({ types, javaRows, functionIds });

  const buckets = Object.fromEntries(XML_METHOD_CALL_BUCKETS.map((bucket) => [bucket, 0]));
  const siteCounts = Object.fromEntries([...definitions.keys()].map((id) => [id, 0]));
  const edges = new Map(); // file, method node id -> the edge
  const gaps = [];

  for (const row of sites.methodCalls) {
    if (!manifest.has(row.file)) throw new Error(`xml-method-call-resolution: method call site in a file outside the manifest: ${row.file}`);
    const definition = definitions.get(row.site);
    if (!definition || !families.has(row.family) || definition.family.id !== row.family) {
      throw new Error(`xml-method-call-resolution: method call site ${JSON.stringify(row.site)} of the family ${JSON.stringify(row.family)}, which the catalog does not have`);
    }
    const { family, site } = definition;
    siteCounts[row.site] += 1;

    const place = (bucket, candidates) => {
      buckets[bucket] += 1;
      if (XML_METHOD_CALL_GAP_KINDS[bucket] !== undefined) {
        gaps.push({
          kind: XML_METHOD_CALL_GAP_KINDS[bucket],
          scope: languageOf(row.file) ?? 'xml',
          sample: `${row.file}:${row.line} ${row.token} -> [${candidates.join(', ')}]`,
        });
      }
    };

    // ---- the class the method belongs to ----
    const unit = table.unitOf(row.file);
    let owner; // { kind, ... } as the table gives a target
    if (site.owner.from === 'named') {
      if (row.named === null) {
        place('ownerMissing', [`no ${site.owner.attribute} written`]);
        continue;
      }
      const hits = table.bindingsNamed(row.named.name, { unit, namespace: family.namespace });
      if (hits.length === 0) {
        const elsewhere = table.named(row.named.name);
        if (elsewhere.length === 0) place('ownerUnbound', [row.named.name]);
        else place('ownerElsewhere', [...new Set(elsewhere.map((binding) => binding.namespace))].sort(compareText));
        continue;
      }
      owner = table.resolveHits(hits).target;
    } else {
      if (row.consumer === null) {
        place('ownerMissing', [`no enclosing ${family.consumer.element} element`]);
        continue;
      }
      owner = table.resolveDeclared({
        declared: row.consumer.target,
        // A factory builds what the bean stands for, but its own class is where a static factory method is.
        unknownBecause: site.owner.from === 'declared' ? null : row.consumer.unknownBecause,
        inherits: row.consumer.inherits,
        unit,
        namespace: family.namespace,
      });
    }
    if (owner.kind !== 'node') {
      const bucket = OWNER_BUCKET[owner.kind];
      if (bucket === undefined) throw new Error(`xml-method-call-resolution: an owner resolved to a target of kind ${JSON.stringify(owner.kind)}`);
      place(bucket, [owner.reason ?? owner.labels?.join(', ') ?? '(no class)']);
      continue;
    }
    const view = finder.typeOf(owner.id);
    if (view === null) {
      place('ownerUnindexed', [owner.id]);
      continue;
    }

    // ---- the method ----
    // A nested property path (`a.b`) is the container calling `getA().setB`: not modeled.
    if (row.nested) {
      place('methodNotModeled', [`${view.fqn}: ${row.token}`]);
      continue;
    }
    const { candidates, hasOutside } = finder.find(view, row.method, site.arity);
    const what = `${view.fqn}#${row.method}`;
    if (candidates.length > 1 || (candidates.length === 1 && candidates[0].id === null)) {
      place('methodAmbiguous', candidates.map((c) => `${c.owner.fqn}#${row.method}(${c.signature})`).sort(compareText));
      continue;
    }
    if (candidates.length === 0) {
      // A default applies only where the method exists; where it does not, no repository method is in question.
      if (site.optional) buckets.optionalInactive += 1;
      else if (hasOutside) place('methodExternal', [what]);
      else place('methodMissing', [what]);
      continue;
    }

    buckets.edge += 1;
    const [{ id: methodId }] = candidates;
    const key = JSON.stringify([row.file, methodId]);
    if (!edges.has(key)) edges.set(key, { file: row.file, target: methodId, evidence: [] });
    edges.get(key).evidence.push({
      file: row.file,
      line: row.line,
      source: 'lexical',
      token: row.token,
      site: row.site,
      // How the class was found: nothing when the bean wrote it, the bindings of the parent or the name otherwise.
      bindings: owner.via.map(siteOf),
    });
  }

  const drawn = [...edges.values()].map((edge) => {
    const unique = new Map(edge.evidence.map((entry) => [JSON.stringify([entry.file, entry.line, entry.token, entry.site]), entry]));
    return { ...edge, weight: INVOKES_EDGE_WEIGHT, evidence: [...unique.values()].sort(evidenceOrder) };
  });

  const coverage = {
    status: 'ran',
    files: { ...sites.methodCallFiles },
    sites: siteCounts,
    buckets,
    siteCount: sites.methodCalls.length,
    emptyValues: sites.methodCallsEmpty,
  };
  return { edges: drawn, gaps, coverage };
}
