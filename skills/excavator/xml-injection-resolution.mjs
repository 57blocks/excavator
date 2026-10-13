/**
 * xml-injection-resolution.mjs
 *
 * Resolution of the XML injection sites (openspec: changes/xml-injection-
 * references, capability `fact-graph`, design D5-D8, D11): an attribute in a
 * descriptor that writes the name of another declaration (Spring `ref="orderDao"`)
 * becomes an `injects` edge from the class of the element it is injected into
 * (the consumer) to the class the name comes to, or lands in a visible bucket
 * that says why it did not. The reading stage (xml-name-bindings.mjs,
 * name-reference-sites.mjs) records the sites and their consumers; the binding
 * table (name-reference-resolution.mjs) holds every name binding with the class
 * it comes to, through aliases, parents and factories. This module only decides.
 *
 * Pure and build-free: it reads the catalog, the stage's sites and the table. It
 * never reads a file, and nothing here is about a framework: which attributes are
 * sites, which element consumes them and what each site's scope is, are the
 * catalog's.
 *
 * Every site has exactly one fate, in this order (D6):
 *   outside     the site's scope says the name is where a static read cannot look
 *               (a parent container)
 *   then, over the bindings of the site's unit and the family's namespace
 *   whose name is the written name - names match as written, whether or not an
 *   expression could reach them - and, for scope `file`, of the site's own file:
 *   bundle      all are resource bundles
 *   external    all bind the same class outside the repository
 *   unindexed   all bind the same repository class that has no node
 *   unknown     all have no target (a factory, a parent with no binding, a cycle)
 *   ambiguous   anything else
 *   elsewhere   no such binding, but another unit, namespace or (scope `file`)
 *               file has the name
 *   unbound     no binding anywhere
 *   and when they all bind one repository class, the consumer:
 *   consumerMissing     no consumer element around the site
 *   consumerExternal    the consumer's class is outside the repository
 *   consumerUnindexed   a repository class that has no node
 *   consumerUnknown     the consumer has no class that can be told
 *   consumerAmbiguous   a class name several declarations carry
 *   edge                a repository class: one `injects` edge
 * The target is decided first because it says whether the name reached the
 * repository's code at all; the consumer is the other end of the edge.
 *
 * `scope: file` limits only the bindings the name hits directly: where their
 * target is declared (an alias, a parent) is the unit's business, as for any name.
 *
 * `assertInjectionConservation` checks that the fourteen buckets add up to the
 * sites, and that the gaps recorded for each of the five gap kinds add up to
 * their buckets - those of the XML sites and, when the annotation stage
 * (annotation-injection-resolution.mjs) ran as well, those of its fifteen
 * buckets: the two sources record into the same five kinds.
 */

import { unitLabel } from './name-reference-resolution.mjs';
import { ANNOTATION_INJECTION_BUCKETS, ANNOTATION_INJECTION_GAP_KINDS } from './annotation-injection-resolution.mjs';

/** Same weight as `references` and `mentions`: every edge is extracted from cited lines. */
const INJECTS_EDGE_WEIGHT = 0.5;

const SITE_SCOPES = Object.freeze(['unit', 'file', 'outside']);

/** The fourteen fates of a site, the target's first, then the consumer's. */
export const XML_INJECTION_BUCKETS = Object.freeze([
  'outside', 'bundle', 'external', 'unindexed', 'unknown', 'ambiguous', 'elsewhere', 'unbound',
  'edge', 'consumerExternal', 'consumerMissing', 'consumerUnknown', 'consumerUnindexed', 'consumerAmbiguous',
]);

/** The buckets that are gaps, and the gap kind each one records. */
export const XML_INJECTION_GAP_KINDS = Object.freeze({
  outside: 'injection-target-unresolved',
  unindexed: 'injection-target-unresolved',
  unknown: 'injection-target-unresolved',
  ambiguous: 'injection-ambiguous',
  elsewhere: 'injection-elsewhere',
  unbound: 'injection-unbound',
  consumerMissing: 'injection-consumer-unresolved',
  consumerUnknown: 'injection-consumer-unresolved',
  consumerUnindexed: 'injection-consumer-unresolved',
  consumerAmbiguous: 'injection-consumer-unresolved',
});

/** The gap kinds, each with the buckets whose sites it records. */
const bucketsOfGapKind = (gapKinds) => Object.entries(gapKinds).reduce((kinds, [bucket, kind]) => {
  (kinds[kind] ??= []).push(bucket);
  return kinds;
}, {});
const XML_BUCKETS_OF_GAP_KIND = Object.freeze(bucketsOfGapKind(XML_INJECTION_GAP_KINDS));
const ANNOTATION_BUCKETS_OF_GAP_KIND = Object.freeze(bucketsOfGapKind(ANNOTATION_INJECTION_GAP_KINDS));

const TARGET_BUCKET = Object.freeze({ bundle: 'bundle', external: 'external', unindexed: 'unindexed', unknown: 'unknown', ambiguous: 'ambiguous' });
const CONSUMER_BUCKET = Object.freeze({ external: 'consumerExternal', unindexed: 'consumerUnindexed', unknown: 'consumerUnknown', ambiguous: 'consumerAmbiguous' });

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sum = (values) => values.reduce((total, value) => total + value, 0);

/**
 * Fail-closed check that every site landed in exactly one bucket, and that the
 * gaps recorded for each gap kind add up to the buckets that kind covers - the
 * XML sites' and the annotation sites' together, as both record into the same
 * five kinds.
 *
 * @param {{ buckets: Record<string, number>, siteCount: number }} coverage
 *   the `coverage.injections` section of a run
 * @param {Record<string, number>} gapCounts the counts read back from the
 *   recorded gaps, by gap kind (`injection-target-unresolved` and the others)
 * @param {{ status: string, buckets?: Record<string, number>, siteCount?: number }} [annotationCoverage]
 *   the `coverage.annotationInjections` section of the run. Left out, or when the
 *   stage did not run (`not-run`), the gaps are checked against the XML sites alone.
 */
export function assertInjectionConservation(coverage, gapCounts, annotationCoverage = undefined) {
  const { buckets, siteCount } = coverage;
  const total = sum(XML_INJECTION_BUCKETS.map((bucket) => buckets[bucket]));
  if (total !== siteCount) {
    throw new Error(`xml-injection-resolution: ${siteCount} injection site(s) but ${total} outcome(s)`);
  }

  let annotation = null;
  if (annotationCoverage !== undefined && annotationCoverage !== null && annotationCoverage.status !== 'not-run') {
    if (annotationCoverage.status !== 'ran') {
      throw new Error(`xml-injection-resolution: the annotation injection coverage says status ${JSON.stringify(annotationCoverage.status)}`);
    }
    annotation = annotationCoverage;
    const annotationTotal = sum(ANNOTATION_INJECTION_BUCKETS.map((bucket) => annotation.buckets[bucket]));
    if (annotationTotal !== annotation.siteCount) {
      throw new Error(`annotation-injection-resolution: ${annotation.siteCount} annotation injection site(s) but ${annotationTotal} outcome(s)`);
    }
  }

  for (const kind of new Set([...Object.keys(XML_BUCKETS_OF_GAP_KIND), ...Object.keys(ANNOTATION_BUCKETS_OF_GAP_KIND)])) {
    const xml = (XML_BUCKETS_OF_GAP_KIND[kind] ?? []).map((bucket) => buckets[bucket]);
    const annotated = annotation === null ? [] : (ANNOTATION_BUCKETS_OF_GAP_KIND[kind] ?? []).map((bucket) => annotation.buckets[bucket]);
    const expected = sum(xml) + sum(annotated);
    if (expected !== gapCounts[kind]) {
      throw new Error(`xml-injection-resolution: ${expected} ${kind} outcome(s) but ${gapCounts[kind]} recorded gap occurrence(s)`);
    }
  }
}

/** Where a binding is, as evidence cites it. */
const siteOf = ({ file, line, binder }) => ({ file, line, binder });

function evidenceOrder(a, b) {
  return compareText(a.file, b.file) || a.line - b.line || compareText(a.token, b.token) || compareText(a.site, b.site);
}

/**
 * @param {{
 *   sites: { injections: object[], injectionFiles: Record<string, number>, uncoveredReferences: Record<string, number> },
 *   catalog: object,
 *   table: ReturnType<typeof import('./name-reference-resolution.mjs').buildNameBindingTable>,
 *   manifestPaths: Iterable<string>,
 *   languageOf?: (path: string) => string|undefined,
 *   mutations?: { injectionIgnoreUnits?: boolean, injectionFirstBinding?: boolean, ignoreFileScope?: boolean },
 * }} args
 *   `sites` is the output of name-reference-sites.mjs and `table` the binding
 *   table built from it. `mutations` is the test seam of the mutation tripwires
 *   (design D11; the table's own seams - `noAliases`, `noInheritance`,
 *   `ignoreUnknownWhen` - act on consumers as on targets, because they live
 *   there); production callers leave it empty.
 * @returns {{
 *   edges: object[],
 *   gaps: Array<{ kind: string, scope: string, sample: string }>,
 *   coverage: object,
 * }}
 *   `edges` are `injects` edges between class node ids, one per (consumer class,
 *   target class), each with the evidence of every site that drew it. `gaps` are
 *   one occurrence per site in a gap bucket, `sample` being
 *   `<file>:<line> <name> -> [<candidates or reason>]`. `coverage` is
 *   `{ status, files, sites, buckets, siteCount, uncovered }`.
 */
export function resolveXmlInjections({
  sites, catalog, table, manifestPaths, languageOf = () => undefined, mutations = {},
}) {
  if (!Array.isArray(sites.injections)) {
    throw new Error('xml-injection-resolution: the name-reference sites have no injections (an output of an older stage?)');
  }
  const manifest = new Set(manifestPaths);
  const families = new Map(catalog.xmlInjections.map((family) => [family.id, family]));

  const buckets = Object.fromEntries(XML_INJECTION_BUCKETS.map((bucket) => [bucket, 0]));
  const siteCounts = Object.fromEntries(catalog.xmlInjections.flatMap((family) => family.sites.map((site) => [site.id, 0])));
  const edges = new Map(); // consumer node id, target node id -> the edge
  const gaps = [];

  for (const row of sites.injections) {
    if (!manifest.has(row.file)) throw new Error(`xml-injection-resolution: injection site in a file outside the manifest: ${row.file}`);
    const family = families.get(row.family);
    if (!family) throw new Error(`xml-injection-resolution: injection site of the family ${JSON.stringify(row.family)}, which the catalog does not have`);
    if (!family.sites.some((site) => site.id === row.site)) {
      throw new Error(`xml-injection-resolution: injection site ${JSON.stringify(row.site)}, which the family ${JSON.stringify(family.id)} does not have`);
    }
    if (!SITE_SCOPES.includes(row.scope)) {
      throw new Error(`xml-injection-resolution: injection site in ${row.file} says scope ${JSON.stringify(row.scope)}`);
    }
    siteCounts[row.site] += 1;

    const unit = table.unitOf(row.file);
    const gap = (bucket, candidates) => {
      gaps.push({
        kind: XML_INJECTION_GAP_KINDS[bucket],
        scope: languageOf(row.file) ?? 'xml',
        sample: `${row.file}:${row.line} ${row.name} -> [${candidates.join(', ')}]`,
      });
    };
    const place = (bucket, candidates) => {
      buckets[bucket] += 1;
      if (XML_INJECTION_GAP_KINDS[bucket] !== undefined) gap(bucket, candidates);
    };

    // The static read cannot see where this name is: nothing else is looked at.
    if (row.scope === 'outside') {
      place('outside', ['outside']);
      continue;
    }

    // The bindings the name hits: the unit's, in the family's namespace, and for
    // a name of this file alone, this file's. Tripwire seams: any unit's; the
    // file's scope is the unit's.
    const fileScoped = row.scope === 'file' && !mutations.ignoreFileScope;
    const hits = mutations.injectionIgnoreUnits
      ? table.named(row.name).filter((binding) => binding.namespace === family.namespace && (!fileScoped || binding.file === row.file))
      : table.bindingsNamed(row.name, { unit, namespace: family.namespace, file: fileScoped ? row.file : undefined });

    if (hits.length === 0) {
      const elsewhere = table.named(row.name);
      if (elsewhere.length === 0) {
        place('unbound', []);
      } else {
        const where = (binding) => {
          const label = `${unitLabel(binding.unit)} [${binding.namespace}]`;
          // another file of the unit, for a name that is the file's own
          return fileScoped && binding.unit === unit && binding.namespace === family.namespace ? `${label} in ${binding.file}` : label;
        };
        place('elsewhere', [...new Set(elsewhere.map(where))].sort(compareText));
      }
      continue;
    }

    let resolved = table.resolveHits(hits);
    // Tripwire seam: an ambiguous name resolves to its first binding.
    if (resolved.target.kind === 'ambiguous' && mutations.injectionFirstBinding) resolved = table.resolveHits([hits[0]]);
    const { target } = resolved;
    if (target.kind !== 'node') {
      const bucket = TARGET_BUCKET[target.kind];
      if (bucket === undefined) throw new Error(`xml-injection-resolution: a name resolved to a target of kind ${JSON.stringify(target.kind)}`);
      // Where the bindings are and why each has no target, for an unknown one; what the target is, for the others.
      const candidates = bucket === 'unknown'
        ? [...new Set(hits.map((binding) => `${binding.file}:${binding.line}${binding.target.reason === undefined ? '' : ` (${binding.target.reason})`}`))].sort(compareText)
        : target.labels;
      place(bucket, candidates);
      continue;
    }

    // The name reached a class of the repository: the other end of the edge.
    if (row.consumer === null) {
      place('consumerMissing', [`consumerMissing: no enclosing ${family.consumer.element} element`]);
      continue;
    }
    const consumer = table.resolveDeclared({
      declared: row.consumer.target,
      unknownBecause: row.consumer.unknownBecause,
      inherits: row.consumer.inherits,
      unit,
      namespace: family.namespace,
    });
    if (consumer.kind === 'bundle') {
      throw new Error(`xml-injection-resolution: the consumer of a site in ${row.file}:${row.line} resolved to a resource bundle`);
    }
    if (consumer.kind !== 'node') {
      const bucket = CONSUMER_BUCKET[consumer.kind];
      if (bucket === undefined) throw new Error(`xml-injection-resolution: a consumer resolved to a target of kind ${JSON.stringify(consumer.kind)}`);
      const detail = bucket === 'consumerUnknown' ? (consumer.reason ?? '(no target)') : consumer.labels.join(', ');
      place(bucket, [`${bucket}: ${detail}`]);
      // An outside class is no gap, which `place` knows from the gap kinds.
      continue;
    }

    buckets.edge += 1;
    const key = JSON.stringify([consumer.id, target.id]);
    if (!edges.has(key)) {
      edges.set(key, {
        source: consumer.id,
        target: target.id,
        type: 'injects',
        direction: 'forward',
        weight: INJECTS_EDGE_WEIGHT,
        evidence: [],
        provenance: 'extracted',
      });
    }
    edges.get(key).evidence.push({
      file: row.file,
      line: row.line,
      source: 'lexical',
      token: row.name,
      site: row.site,
      // How the consumer's class was found: nothing when it wrote its own, the bindings of the parent it named otherwise.
      consumer: { line: row.consumer.line, bindings: consumer.via.map(siteOf) },
      // How the name's class was found: the bindings it hit, and those an alias or a parent sent it on to.
      bindings: resolved.via.map(siteOf),
    });
  }

  const drawn = [...edges.values()].map((edge) => {
    const unique = new Map(edge.evidence.map((entry) => [JSON.stringify([entry.file, entry.line, entry.token, entry.site]), entry]));
    return { ...edge, evidence: [...unique.values()].sort(evidenceOrder) };
  });

  const coverage = {
    status: 'ran',
    files: { ...sites.injectionFiles },
    sites: siteCounts,
    buckets,
    siteCount: sites.injections.length,
    uncovered: { ...sites.uncoveredReferences },
  };
  return { edges: drawn, gaps, coverage };
}
