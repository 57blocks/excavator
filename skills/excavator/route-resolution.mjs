/**
 * route-resolution.mjs
 *
 * Resolution of the Java route sites (openspec: the route-facts change,
 * capability `fact-graph`, design D4-D9 and D11): a method that carries an
 * annotation naming an HTTP method, or one giving it a path of its own, is where
 * a container dispatches a request, and becomes an `endpoint` - named by the
 * route, `<verb> <path>`, with a `routes` edge from it to the method that
 * handles it - or lands in a visible bucket that says why it did not. Core
 * records the annotations (`classes[].annotationArguments` of the top-level
 * types, `memberAnnotations` of the structure rows) and the visibility of each
 * method; this module only decides.
 *
 * Pure and build-free: it reads the catalog and the structure rows. It never
 * reads a file, and nothing here is about a framework: which annotations name a
 * verb, give a type its root path, a method its own, or declare a client of a
 * remote service rather than an entry point, and whether only `public` methods
 * are exposed, are the catalog's (route-catalog.mjs).
 *
 * What a route site is (D4): a method with at least one annotation of a family
 * that is - by Java's scope rules, one function shared with the name bindings
 * and the injection sites - a verb or a method path annotation of its catalog
 * family. A spelling that matches the simple name of a catalog annotation and
 * cannot be confirmed is counted by spelling (`unconfirmed`) and makes nothing a
 * site. An annotation confirmed to be another type is not read.
 *
 * Every site has exactly one fate, in this order (D5):
 *   nested            the method is in a nested, local or anonymous type: Core
 *                     gives such a method no node for an edge to point at
 *   client            the top-level type declares a client of a remote service,
 *                     which is no entry point of this application (no gap)
 *   handlerUnindexed  no method of the structure row is the one the annotations
 *                     are on, or its node id is shared with another declaration
 *   nonPublic         the family exposes public methods only, and this is not
 *                     one (no gap)
 *   conflict          two or more different verbs are written
 *   noVerb            no verb is written: a locator of a sub-resource, or a
 *                     custom verb the catalog does not know
 *   noRoot            the top-level type has no confirmed root path annotation:
 *                     a sub-resource, or a resource that deployment registers
 *   nonLiteral        the root path or the method path is written without its
 *                     argument, or the argument is not a string literal
 *   endpoint          the rest
 * The first three say whether the method can be the target of an edge at all,
 * the fourth that the container does not expose it, the others that the route
 * cannot be put together - the earlier the reason, the more basic it is.
 *
 * The route is the verb and the path (D6): the two values each lose all
 * leading and trailing `/`, the non-empty ones are joined with `/`, and a `/`
 * goes first. What is inside a value stays as it is, a template and the pattern
 * in it included. The path is relative to the application's root: where the
 * application is mounted is written elsewhere (a class, a descriptor) and is not
 * read here.
 *
 * Nothing is made up to get an endpoint: no root path from a parent type, an
 * interface or a descriptor, no constant evaluated, no first of several verbs.
 *
 * `assertRouteConservation` checks that the buckets add up to the sites, that
 * the sites that became endpoints are the edges the graph got, and that the gaps
 * recorded add up to the buckets that are gaps.
 */

import { packageOf } from './name-reference-resolution.mjs';

/** Same weight as the other annotation facts: every edge is extracted from cited lines. */
const ROUTES_EDGE_WEIGHT = 0.5;

/** The nine fates of a route site, in the order D5 decides them. */
export const ROUTE_BUCKETS = Object.freeze([
  'nested', 'client', 'handlerUnindexed', 'nonPublic', 'conflict', 'noVerb', 'noRoot', 'nonLiteral', 'endpoint',
]);

/**
 * The buckets that are gaps, and the gap kind each one records (D9). The others
 * are right not to make an endpoint, or are one.
 */
export const ROUTE_GAP_KINDS = Object.freeze({
  nested: 'route-handler-unresolved',
  handlerUnindexed: 'route-handler-unresolved',
  conflict: 'route-verb-unresolved',
  noVerb: 'route-verb-unresolved',
  noRoot: 'route-root-unresolved',
  nonLiteral: 'route-path-unresolved',
});

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The value of an annotation's argument when it is a string literal, `null` when it is written as anything else or not at all. */
function literalOf(use, key) {
  const written = use.arguments.find((argument) => argument.key === key);
  return written !== undefined && typeof written.value === 'string' ? written.value : null;
}

const trimSlashes = (value) => value.replace(/^\/+|\/+$/g, '');

/**
 * The route of a verb and the two path values (D6). `trim: false` is the test
 * seam of a mutation tripwire: the values keep their slashes.
 *
 * @param {string} verb
 * @param {string} root the value of the root path
 * @param {string} method the value of the method path, empty when the method writes none
 * @param {{ trim?: boolean }} [options]
 * @returns {string}
 */
export function formatRoute(verb, root, method, { trim = true } = {}) {
  const segment = trim ? trimSlashes : (value) => value;
  const path = `/${[segment(root), segment(method)].filter((part) => part !== '').join('/')}`;
  return `${verb} ${path}`;
}

/** Evidence of one edge, in the order of (file, line, role), without repeats of that triple. */
function uniqueSortedEvidence(evidence) {
  const unique = new Map(evidence.map((entry) => [JSON.stringify([entry.file, entry.line, entry.role]), entry]));
  return [...unique.values()].sort((a, b) => compareText(a.file, b.file) || a.line - b.line || compareText(a.role, b.role));
}

/** The catalog's families, each with the lookups the resolution reads. */
function indexFamilies(catalog) {
  const families = catalog.routeFamilies.map((family) => ({
    id: family.id,
    publicOnly: family.publicOnly,
    verbOf: new Map(family.verbs.flatMap((entry) => entry.annotations.map((fqn) => [fqn, entry.verb]))),
    rootPath: { fqns: new Set(family.rootPath.annotations), argument: family.rootPath.argument },
    methodPath: { fqns: new Set(family.methodPath.annotations), argument: family.methodPath.argument },
    client: new Set(family.clientAnnotations),
  }));
  const fqns = new Set(catalog.routeFamilies.flatMap((family) => [
    ...family.rootPath.annotations, ...family.methodPath.annotations, ...family.clientAnnotations, ...family.verbs.flatMap((entry) => entry.annotations),
  ]));
  return { families, fqns };
}

const emptyBuckets = () => Object.fromEntries(ROUTE_BUCKETS.map((bucket) => [bucket, 0]));

/**
 * Fail-closed check of the balance of a run (D9): in each family the buckets add
 * up to the sites, the sites that became endpoints are the edges the run drew and
 * the edges the graph got, and the gaps recorded of each kind add up to the
 * buckets that are gaps of that kind.
 *
 * @param {{ families: Record<string, { sites: number, buckets: Record<string, number>, endpoints: number, edges: number }> }} coverage
 *   the `coverage.routes` section of a run
 * @param {{ edges: Record<string, number>, gaps: Record<string, Record<string, number>> }} recorded
 *   what was read back from the graph, by family id: the `routes` edges it got, and
 *   the gap occurrences recorded for it by kind (a family or a kind with none may be missing)
 */
export function assertRouteConservation(coverage, recorded) {
  for (const [id, family] of Object.entries(coverage.families)) {
    const total = ROUTE_BUCKETS.reduce((sum, bucket) => sum + family.buckets[bucket], 0);
    if (total !== family.sites) {
      throw new Error(`route-resolution: family ${JSON.stringify(id)}: ${family.sites} route site(s) but ${total} outcome(s)`);
    }
    if (family.buckets.endpoint !== family.edges) {
      throw new Error(`route-resolution: family ${JSON.stringify(id)}: ${family.buckets.endpoint} site(s) became an endpoint but ${family.edges} routes edge(s) were drawn`);
    }
    const inGraph = recorded.edges[id] ?? 0;
    if (family.edges !== inGraph) {
      throw new Error(`route-resolution: family ${JSON.stringify(id)}: ${family.edges} routes edge(s) drawn but ${inGraph} in the graph`);
    }
    for (const kind of new Set(Object.values(ROUTE_GAP_KINDS))) {
      const expected = Object.entries(ROUTE_GAP_KINDS)
        .filter(([, gapKind]) => gapKind === kind)
        .reduce((sum, [bucket]) => sum + family.buckets[bucket], 0);
      const seen = recorded.gaps[id]?.[kind] ?? 0;
      if (expected !== seen) {
        throw new Error(`route-resolution: family ${JSON.stringify(id)}: ${expected} ${kind} outcome(s) but ${seen} recorded gap occurrence(s)`);
      }
    }
  }
}

/**
 * @param {{
 *   javaRows: object[],
 *   catalog: object,
 *   identity: (args: { fqns: Iterable<string>, simpleNames?: boolean }) => (row: object, written: string, pkg: string) => { kind: 'catalog', fqn: string } | { kind: 'other' } | { kind: 'unconfirmed' },
 *   handlerIdOf: (path: string, index: number) => string|null,
 *   mutations?: {
 *     simpleNameAnnotations?: boolean, noSlashTrim?: boolean, rootFromMethod?: boolean,
 *     firstVerb?: boolean, containsWithoutToken?: boolean,
 *   },
 * }} args
 *   `javaRows` are the structure rows of the Java files (their `classes`,
 *   `functions` and `memberAnnotations` are read), `catalog` the loaded route
 *   catalog, `identity` the annotation identity function over the repository's
 *   type dictionaries - called once with every annotation of the catalog - and
 *   `handlerIdOf` the node id of a function entry of a row (null where it is
 *   shared with another declaration and so names no node). `mutations` is the
 *   test seam of the mutation tripwires (design D11); production callers leave it empty.
 * @returns {{
 *   endpoints: object[],
 *   edges: object[],
 *   gaps: Array<{ kind: string, scope: string, sample: string }>,
 *   coverage: object,
 * }}
 *   `endpoints` are one per (file, top-level type, route), in the order of the
 *   rows and then of the first handler: `{ family, file, owner, route, lineRange,
 *   evidence }`, `lineRange` that of the first handler in the source and `evidence`
 *   what the contains edge from the file cites - the line of that handler's verb
 *   annotation, `[{ file, line, source, token }]`. `edges` are `routes` edges, one
 *   per handler, from `endpoint` - an entry of `endpoints` - to the handler's node
 *   `target`: `{ endpoint, target, type, direction, weight, evidence, provenance }`,
 *   the evidence being `{ file, line, source, token, role, value? }`. `gaps` are one
 *   occurrence per site in a gap bucket, scope the family id and `sample`
 *   `<file>:<line> <Owner>.<method>`, the line being that of the method's name.
 *   `coverage` is `{ status, families, unconfirmed }`, each family
 *   `{ sites, buckets, endpoints, edges }`.
 */
export function resolveRoutes({ javaRows, catalog, identity, handlerIdOf, mutations = {} }) {
  const { families, fqns } = indexFamilies(catalog);
  const confirm = identity({ fqns, simpleNames: Boolean(mutations.simpleNameAnnotations) });

  const stats = Object.fromEntries(families.map((family) => [family.id, { sites: 0, buckets: emptyBuckets(), endpoints: 0, edges: 0 }]));
  const unconfirmed = {};
  const endpoints = new Map(); // file, top-level type, route -> the endpoint with its handlers so far
  const gaps = [];

  javaRows.forEach((row, rowIndex) => {
    const classes = row.classes ?? [];
    if (!Array.isArray(row.memberAnnotations)) {
      // A row that was extracted has the list, an empty one included: a row with types and no list is an older extraction's.
      if (classes.length > 0) {
        throw new Error(`route-resolution: the structure row of ${row.path} has no memberAnnotations (an output of an older extraction?)`);
      }
      return;
    }

    // One package for the file; the top-level types of a file share it.
    const firstClass = classes.find((cls) => typeof cls.qualifiedName === 'string');
    const pkg = firstClass === undefined ? '' : packageOf(firstClass);

    /** The uses of an annotation list that are annotations of the catalog; the spellings that could be one and cannot be told are counted. */
    const confirmedUses = (uses) => {
      const confirmed = [];
      for (const use of uses) {
        const found = confirm(row, use.name, pkg);
        if (found.kind === 'other') continue;
        if (found.kind === 'unconfirmed') {
          unconfirmed[use.name] = (unconfirmed[use.name] ?? 0) + 1;
          continue;
        }
        confirmed.push({ use, fqn: found.fqn });
      }
      return confirmed;
    };

    const typeUses = classes.map((cls) => confirmedUses(cls.annotationArguments ?? []));

    // The methods the annotations are on: (top-level type, name, line of the name) is one method.
    const methods = new Map();
    for (const { use, fqn } of confirmedUses(row.memberAnnotations.filter((candidate) => candidate.on === 'method'))) {
      const key = JSON.stringify([use.owner, use.member.name, use.member.line]);
      if (!methods.has(key)) methods.set(key, { owner: use.owner, name: use.member.name, line: use.member.line, nested: use.nested, annotations: [] });
      methods.get(key).annotations.push({ use, fqn });
    }
    if (methods.size === 0) return;

    // The function entries of the row by (type, name), for the lookup of the handler of a site.
    const functionsByName = new Map();
    (row.functions ?? []).forEach((fn, index) => {
      const key = JSON.stringify([fn.owner, fn.name]);
      if (!functionsByName.has(key)) functionsByName.set(key, []);
      functionsByName.get(key).push(index);
    });

    for (const method of methods.values()) {
      const classIndex = classes.findIndex((cls) => cls.name === method.owner && cls.startLine <= method.line && method.line <= cls.endLine);

      for (const family of families) {
        const verbUses = method.annotations.filter(({ fqn }) => family.verbOf.has(fqn));
        const pathUses = method.annotations.filter(({ fqn }) => family.methodPath.fqns.has(fqn));
        if (verbUses.length === 0 && pathUses.length === 0) continue;

        const familyStats = stats[family.id];
        familyStats.sites += 1;
        const place = (bucket) => {
          familyStats.buckets[bucket] += 1;
          const kind = ROUTE_GAP_KINDS[bucket];
          if (kind !== undefined) gaps.push({ kind, scope: family.id, sample: `${row.path}:${method.line} ${method.owner}.${method.name}` });
        };

        if (method.nested) {
          place('nested');
          continue;
        }
        if (classIndex >= 0 && typeUses[classIndex].some(({ fqn }) => family.client.has(fqn))) {
          place('client');
          continue;
        }

        // The method entry the annotations are on: the type and name match and its lines hold the line of the name.
        const entries = (functionsByName.get(JSON.stringify([method.owner, method.name])) ?? [])
          .filter((index) => row.functions[index].startLine <= method.line && method.line <= row.functions[index].endLine);
        const handlerIndex = entries.length === 1 ? entries[0] : -1;
        const target = handlerIndex < 0 ? null : handlerIdOf(row.path, handlerIndex);
        if (target === null) {
          place('handlerUnindexed');
          continue;
        }
        const handler = row.functions[handlerIndex];
        if (family.publicOnly && handler.visibility !== 'public') {
          place('nonPublic');
          continue;
        }

        // Several different verbs are no verb to pick; tripwire seam: the first one written is.
        const verbs = [...new Set(verbUses.map(({ fqn }) => family.verbOf.get(fqn)))];
        if (verbs.length > 1 && !mutations.firstVerb) {
          place('conflict');
          continue;
        }
        if (verbs.length === 0) {
          place('noVerb');
          continue;
        }
        const [verb] = verbs;

        const rootUse = classIndex < 0 ? undefined : typeUses[classIndex].find(({ fqn }) => family.rootPath.fqns.has(fqn));
        // Tripwire seam: a type with no root path has an empty one, and the method's own path stands alone.
        if (rootUse === undefined && !mutations.rootFromMethod) {
          place('noRoot');
          continue;
        }
        const rootValue = rootUse === undefined ? '' : literalOf(rootUse.use, family.rootPath.argument);
        const methodUse = pathUses[0];
        const methodValue = methodUse === undefined ? '' : literalOf(methodUse.use, family.methodPath.argument);
        if (rootValue === null || methodValue === null) {
          place('nonLiteral');
          continue;
        }

        // An endpoint: the route, and one `routes` edge to this handler.
        familyStats.buckets.endpoint += 1;
        familyStats.edges += 1;
        const route = formatRoute(verb, rootValue, methodValue, { trim: !mutations.noSlashTrim });
        const key = JSON.stringify([row.path, method.owner, route]);
        if (!endpoints.has(key)) endpoints.set(key, { family: family.id, rowIndex, file: row.path, owner: method.owner, route, handlers: [] });

        const verbAnnotations = verbUses.filter(({ fqn }) => family.verbOf.get(fqn) === verb);
        const evidence = (use, role, value) => ({
          file: row.path, line: use.line, source: 'tree-sitter', token: use.name, role, ...(value === undefined ? {} : { value }),
        });
        endpoints.get(key).handlers.push({
          target,
          start: handler.startLine,
          end: handler.endLine,
          line: method.line,
          verbAnnotation: verbAnnotations[0].use,
          evidence: uniqueSortedEvidence([
            ...verbAnnotations.map(({ use }) => evidence(use, 'verb')),
            ...(methodUse === undefined ? [] : [evidence(methodUse.use, 'method-path', methodValue)]),
            ...(rootUse === undefined ? [] : [evidence(rootUse.use, 'root-path', rootValue)]),
          ]),
        });
      }
    }
  });

  // The first handler in the source is the one a node anchors to; the nodes are in the order of the rows, then of that handler.
  const groups = [...endpoints.values()].map((group) => ({ ...group, handlers: [...group.handlers].sort((a, b) => a.start - b.start || a.line - b.line) }));
  groups.sort((a, b) => a.rowIndex - b.rowIndex || a.handlers[0].start - b.handlers[0].start || a.handlers[0].line - b.handlers[0].line);

  const resolved = [];
  const edges = [];
  for (const group of groups) {
    const { handlers } = group;
    const [first] = handlers;
    const contains = { file: group.file, line: first.verbAnnotation.line, source: 'tree-sitter', token: first.verbAnnotation.name };
    const endpoint = {
      family: group.family,
      file: group.file,
      owner: group.owner,
      route: group.route,
      lineRange: [first.start, first.end],
      // Tripwire seam: the contains edge to the endpoint cites its line without saying what is on it.
      evidence: [mutations.containsWithoutToken ? { file: contains.file, line: contains.line, source: contains.source } : contains],
    };
    resolved.push(endpoint);
    stats[group.family].endpoints += 1;
    for (const handler of handlers) {
      edges.push({
        endpoint,
        target: handler.target,
        type: 'routes',
        direction: 'forward',
        weight: ROUTES_EDGE_WEIGHT,
        evidence: handler.evidence,
        provenance: 'extracted',
      });
    }
  }

  const coverage = {
    status: 'ran',
    families: stats,
    unconfirmed: Object.fromEntries(Object.entries(unconfirmed).sort(([a], [b]) => compareText(a, b))),
  };
  return { endpoints: resolved, edges, gaps, coverage };
}
