// jaxrs-route-facts, task 3.2: the route stage inside buildFactGraph - `endpoint`
// nodes in Java files, the `contains` edge from the file and the `routes` edge to
// the handler, the route gaps, `coverage.routes` and its conservation, and the
// order of the build (the declarations of the structure rows keep their ids and
// ordinals). Every input is real: small synthetic Java sources read by the built
// Core, the real mention stage for the packages of the types that have no entry of
// their own, and the shipped route catalog. The resolver is the real one, wrapped
// so a test can make it lose a gap or miscount: buildFactGraph reads the counts
// back from what it recorded into the graph and must refuse a product whose counts
// do not add up.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PluginRegistry, TreeSitterPlugin, builtinLanguageConfigs, registerAllParsers } from '@excavator/core';
import { analyzeFileWithOutcomes, buildResult } from '../../skills/excavator/extract-structure-result.mjs';
import { collectMentionSites } from '../../skills/excavator/mention-sites.mjs';
import { buildFactGraph } from '../../skills/excavator/build-fact-graph.mjs';
import { validateFactGraphIntegrity } from '../../skills/excavator/lazy-analyze.mjs';
import { loadRouteCatalog } from '../../skills/excavator/route-catalog.mjs';
import { ROUTE_BUCKETS } from '../../skills/excavator/route-resolution.mjs';

let tamper = null;
vi.mock('../../skills/excavator/route-resolution.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveRoutes: (args) => {
      const resolved = actual.resolveRoutes(args);
      return tamper === null ? resolved : tamper(resolved);
    },
  };
});

let registry;
beforeAll(async () => {
  const tsPlugin = new TreeSitterPlugin(builtinLanguageConfigs.filter((c) => c.treeSitter));
  await tsPlugin.init();
  registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);
});

const CATALOG = loadRouteCatalog();
const FAMILY = 'jaxrs';

const javaSource = (pkg, imports, body) => [`package ${pkg};`, ...imports, '', ...[body].flat(), ''].join('\n');
const RS = 'import javax.ws.rs.*;';
const SRC = (name, pkg = 'com.acme.rest') => `src/${pkg.replaceAll('.', '/')}/${name}.java`;
const resource = (name, body, { imports = [RS], pkg = 'com.acme.rest' } = {}) => [SRC(name, pkg), javaSource(pkg, imports, body)];

/**
 * The inputs buildFactGraph reads, for a project of Java sources: the structure
 * rows Core makes, the scan and import map around them, and the mention stage's
 * output (the packages of the types that have no entry of their own).
 */
function inputsOf(java) {
  const files = [];
  const results = [];
  const texts = Object.fromEntries(Object.entries(java).map(([path, text]) => [path, Array.isArray(text) ? text.join('\n') : text]));
  for (const [path, text] of Object.entries(texts)) {
    const file = { path, language: 'java', fileCategory: 'code', sizeLines: text.split('\n').length };
    const extracted = analyzeFileWithOutcomes(registry, file, text);
    expect(extracted.structureOutcome).toBe('succeeded');
    const lines = text.split('\n');
    files.push(file);
    results.push(buildResult(file, lines.length, lines.filter((l) => l.trim()).length, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome));
  }
  const scan = { files, skipped: [], coverage: { limits: { maxFileLines: 20000, maxFileBytes: 2097152 } } };
  const structureAll = { results };
  const mention = collectMentionSites({ scan, structureAll, readFile: (path) => texts[path] });
  return {
    texts,
    inputs: {
      scan, structureAll, importMap: { importMap: Object.fromEntries(files.map((f) => [f.path, []])), unresolved: {} },
      mentionSites: mention.sites, mentionInputs: mention.inputs,
    },
  };
}

function project(java, { catalog = CATALOG, routeMutations, wrap = null } = {}) {
  const { inputs, texts } = inputsOf(java);
  tamper = wrap;
  try {
    const graph = buildFactGraph({ ...inputs, ...(catalog === null ? {} : { routeCatalog: catalog }), routeMutations });
    return { graph, inputs, texts, ...helpers(graph) };
  } finally {
    tamper = null;
  }
}

function helpers(graph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const endpoints = graph.nodes.filter((n) => n.type === 'endpoint');
  const routesEdges = graph.edges.filter((e) => e.type === 'routes');
  const handlerName = (id) => `${byId.get(id).owner}.${byId.get(id).name}`;
  return {
    byId,
    endpoints,
    routesEdges,
    /** `route [Owner] file` of every endpoint node. */
    endpointLabels: endpoints.map((n) => `${n.name} [${n.owner}] ${n.filePath}`),
    /** `route -> Owner.method` of every routes edge. */
    links: routesEdges.map((e) => `${byId.get(e.source).name} -> ${handlerName(e.target)}`).sort(),
    containsEndpoint: graph.edges.filter((e) => e.type === 'contains' && byId.get(e.target).type === 'endpoint'),
    gaps: (kind) => graph.gaps.filter((g) => g.kind === kind),
    gapOfKind: (kind) => graph.gaps.find((g) => g.kind === kind && g.scope === FAMILY),
  };
}

/** The project of the usual shape: a resource, an interface with its implementation, and what else a spec adds. */
const ORDER = resource('OrderResource', [
  '@Path("/orders/")', // 4
  'public class OrderResource {', // 5
  '  @GET', // 6
  '  public String list() { return null; }', // 7
  '',
  '  @GET', // 9
  '  @Path("{id}")', // 10
  '  public String find() { return null; }', // 11
  '}',
]);
const BASE = Object.fromEntries([
  ORDER,
  resource('OrderApi', ['@Path("/v2/orders")', 'public interface OrderApi {', '  @GET', '  String list();', '}']),
  resource('OrderApiImpl', ['public class OrderApiImpl implements OrderApi {', '  public String list() { return null; }', '}']),
]);

// ---------------------------------------------------------------------------
// The nodes and edges
// ---------------------------------------------------------------------------

describe('endpoint nodes and routes edges in the fact graph (design D7, D8)', () => {
  let p;
  beforeAll(() => { p = project(BASE); });

  it('gives each route an endpoint node: named by the route, owned by the top-level type, in the file of the type', () => {
    // in the order of the node ids
    expect(p.endpointLabels).toEqual([
      `GET /v2/orders [OrderApi] ${SRC('OrderApi')}`,
      `GET /orders [OrderResource] ${SRC('OrderResource')}`,
      `GET /orders/{id} [OrderResource] ${SRC('OrderResource')}`,
    ]);
    for (const node of p.endpoints) {
      expect(node).toMatchObject({ type: 'endpoint', anchorSource: 'rule', summary: '', tags: [], complexity: 'simple' });
      expect(Object.keys(node).sort()).toEqual(['anchorSource', 'complexity', 'filePath', 'id', 'lineRange', 'name', 'owner', 'summary', 'tags', 'type']);
    }
  });

  it('derives the id of an endpoint from the shared identity function: type, file, owner and route', () => {
    expect(p.endpoints.map((n) => n.id)).toEqual([
      `endpoint:${SRC('OrderApi')}:OrderApi#GET /v2/orders`,
      `endpoint:${SRC('OrderResource')}:OrderResource#GET /orders`,
      `endpoint:${SRC('OrderResource')}:OrderResource#GET /orders/{id}`,
    ]);
  });

  it('takes the line range of the first handler, annotations included', () => {
    const range = (route) => p.endpoints.find((n) => n.name === route).lineRange;
    const path = SRC('OrderResource');
    expect(range('GET /orders')).toEqual([6, 7]);
    expect(range('GET /orders/{id}')).toEqual([9, 11]);
    expect(p.texts[path].split('\n')[range('GET /orders')[0] - 1]).toContain('@GET');
  });

  it('draws one routes edge from each endpoint to its handler, and a contains edge to the endpoint from its file', () => {
    expect(p.links).toEqual(['GET /orders -> OrderResource.list', 'GET /orders/{id} -> OrderResource.find', 'GET /v2/orders -> OrderApi.list'].sort());
    for (const edge of p.routesEdges) {
      expect(edge).toMatchObject({ type: 'routes', direction: 'forward', weight: 0.5, provenance: 'extracted' });
      expect(p.byId.get(edge.source).type).toBe('endpoint');
      expect(p.byId.get(edge.target).type).toBe('function');
    }
    expect(p.containsEndpoint).toHaveLength(3);
    for (const edge of p.containsEndpoint) {
      expect(edge).toMatchObject({ type: 'contains', direction: 'forward', weight: 1, provenance: 'extracted' });
      expect(p.byId.get(edge.source)).toMatchObject({ type: 'file', filePath: p.byId.get(edge.target).filePath });
    }
  });

  it('points the edge for an interface route at the interface method: the implementation is reached by the existing implements edge', () => {
    const interfaceMethod = p.graph.nodes.find((n) => n.type === 'function' && n.owner === 'OrderApi' && n.name === 'list');
    const edge = p.routesEdges.find((e) => e.target === interfaceMethod.id);
    expect(p.byId.get(edge.source).name).toBe('GET /v2/orders');
    const implementation = p.graph.nodes.find((n) => n.type === 'function' && n.owner === 'OrderApiImpl' && n.name === 'list');
    expect(p.graph.edges.some((e) => e.type === 'implements' && e.source === implementation.id && e.target === interfaceMethod.id)).toBe(true);
    expect(p.routesEdges.some((e) => e.target === implementation.id)).toBe(false);
  });

  it('cites on the routes edge the verb, the method path and the class path, by line, token and role', () => {
    const path = SRC('OrderResource');
    const edge = p.routesEdges.find((e) => p.byId.get(e.source).name === 'GET /orders/{id}');
    expect(edge.evidence).toEqual([
      { file: path, line: 4, source: 'tree-sitter', token: 'Path', role: 'root-path', value: '/orders/' },
      { file: path, line: 9, source: 'tree-sitter', token: 'GET', role: 'verb' },
      { file: path, line: 10, source: 'tree-sitter', token: 'Path', role: 'method-path', value: '{id}' },
    ]);
    for (const entry of edge.evidence) expect(p.texts[path].split('\n')[entry.line - 1]).toContain(entry.token);
  });

  it('cites on the contains edge the line of the verb annotation of the first handler, with its spelling', () => {
    const path = SRC('OrderResource');
    const edge = p.containsEndpoint.find((e) => p.byId.get(e.target).name === 'GET /orders/{id}');
    expect(edge.evidence).toEqual([{ file: path, line: 9, source: 'tree-sitter', token: 'GET' }]);
  });

  it('passes the integrity check of the Lazy driver: no dangling edge, no repeated id', () => {
    expect(validateFactGraphIntegrity(p.graph)).toEqual({ ok: true, issues: [] });
    expect(new Set(p.graph.nodes.map((n) => n.id)).size).toBe(p.graph.nodes.length);
  });

  it('reports the coverage of the stage, and no gap for a project in which everything became an endpoint', () => {
    expect(p.graph.coverage.routes).toEqual({
      status: 'ran',
      families: {
        [FAMILY]: {
          sites: 3,
          buckets: { nested: 0, client: 0, handlerUnindexed: 0, nonPublic: 0, conflict: 0, noVerb: 0, noRoot: 0, nonLiteral: 0, endpoint: 3 },
          endpoints: 3,
          edges: 3,
        },
      },
      unconfirmed: {},
    });
    expect(p.graph.gaps.filter((g) => g.kind.startsWith('route-'))).toEqual([]);
  });

  it('keeps the same route of two files and of two types in one file apart: one endpoint per file, type and route', () => {
    const two = project(Object.fromEntries([
      resource('Same', ['@Path("/x")', 'public class Same {', '  @GET public String a() { return null; }', '}'], { pkg: 'com.acme.one' }),
      resource('Same', ['@Path("/x")', 'public class Same {', '  @GET public String a() { return null; }', '}', '', '@Path("/x")', 'class Twin {', '  @GET public String a() { return null; }', '}'], { pkg: 'com.acme.two' }),
    ]));
    expect(two.endpoints.map((n) => n.id)).toEqual([
      `endpoint:${SRC('Same', 'com.acme.one')}:Same#GET /x`,
      `endpoint:${SRC('Same', 'com.acme.two')}:Same#GET /x`,
      `endpoint:${SRC('Same', 'com.acme.two')}:Twin#GET /x`,
    ]);
    expect(two.links).toEqual(['GET /x -> Same.a', 'GET /x -> Same.a', 'GET /x -> Twin.a']);
    expect(two.graph.coverage.routes.families[FAMILY]).toMatchObject({ sites: 3, endpoints: 3, edges: 3 });
  });

  it('draws two routes edges from one endpoint for two methods that share the route, and one contains edge', () => {
    const shared = project(Object.fromEntries([resource('OrderResource', [
      '@Path("/o")', 'public class OrderResource {',
      '  @GET @Path("{id}") @Produces("a/b") public String one() { return null; }',
      '  @GET @Path("{id}") @Produces("c/d") public String two() { return null; }',
      '}',
    ])]));
    expect(shared.endpoints).toHaveLength(1);
    expect(shared.links).toEqual(['GET /o/{id} -> OrderResource.one', 'GET /o/{id} -> OrderResource.two']);
    expect(shared.containsEndpoint).toHaveLength(1);
    expect(shared.graph.coverage.routes.families[FAMILY]).toMatchObject({ sites: 2, endpoints: 1, edges: 2, buckets: { endpoint: 2 } });
    expect(shared.endpoints[0].lineRange[0]).toBe(shared.byId.get(shared.routesEdges[0].target).lineRange[0]);
  });
});

// ---------------------------------------------------------------------------
// Gaps
// ---------------------------------------------------------------------------

describe('the route gaps and their buckets in the fact graph (design D9)', () => {
  const GAPPY = resource('Gappy', [
    '@Path("/g")', // 4
    'public class Gappy {', // 5
    '  @GET public String ok() { return null; }', // 6
    '  @GET @POST public String both() { return null; }', // 7
    '  @Path("l") public Object locator() { return null; }', // 8
    '  @GET @Path(Paths.X) public String constant() { return null; }', // 9
    '  @GET private String hidden() { return null; }', // 10
    '  static class In { @GET public String nested() { return null; } }', // 11
    '}',
    'class NoRoot {', // 13
    '  @GET public String m() { return null; }', // 14
    '}',
  ]);
  let p;
  beforeAll(() => { p = project(Object.fromEntries([GAPPY])); });
  const path = SRC('Gappy');

  it('records one gap per kind, with the family as scope, a reason and the samples of the sites', () => {
    const kinds = p.graph.gaps.filter((g) => g.kind.startsWith('route-')).map((g) => [g.kind, g.scope, g.count, g.samples]);
    expect(kinds).toEqual([
      ['route-handler-unresolved', FAMILY, 1, [`${path}:11 Gappy.nested`]],
      ['route-path-unresolved', FAMILY, 1, [`${path}:9 Gappy.constant`]],
      ['route-root-unresolved', FAMILY, 1, [`${path}:14 NoRoot.m`]],
      ['route-verb-unresolved', FAMILY, 2, [`${path}:7 Gappy.both`, `${path}:8 Gappy.locator`]],
    ]);
    for (const gap of p.graph.gaps.filter((g) => g.kind.startsWith('route-'))) {
      expect(gap.reason).not.toMatch(/unrecognized gap kind/);
      expect(gap.reason.length).toBeGreaterThan(40);
    }
  });

  it('counts a bucket that is no gap without recording one: not public, and a client declaration', () => {
    expect(p.graph.coverage.routes.families[FAMILY].buckets).toEqual({
      nested: 1, client: 0, handlerUnindexed: 0, nonPublic: 1, conflict: 1, noVerb: 1, noRoot: 1, nonLiteral: 1, endpoint: 1,
    });
    expect(p.graph.coverage.routes.families[FAMILY].sites).toBe(7);
    const client = project(Object.fromEntries([resource('Client', ['@RegisterRestClient', '@Path("/c")', 'public interface Client {', '  @GET String m();', '}'], { imports: [RS, 'import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;'] })]));
    expect(client.graph.coverage.routes.families[FAMILY].buckets.client).toBe(1);
    expect(client.graph.gaps.filter((g) => g.kind.startsWith('route-'))).toEqual([]);
    expect(client.endpoints).toEqual([]);
  });

  it('draws only the endpoint of the one site that is one', () => {
    expect(p.endpointLabels).toEqual([`GET /g [Gappy] ${path}`]);
    expect(p.links).toEqual(['GET /g -> Gappy.ok']);
  });

  it('records the unconfirmed spellings of annotations the imports cannot settle', () => {
    const both = project(Object.fromEntries([resource('Both', ['@Path("/b")', 'public class Both {', '  @GET public String m() { return null; }', '}'], { imports: [RS, 'import jakarta.ws.rs.*;'] })]));
    expect(both.graph.coverage.routes.unconfirmed).toEqual({ GET: 1, Path: 1 });
    expect(both.graph.coverage.routes.families[FAMILY].sites).toBe(0);
    expect(both.endpoints).toEqual([]);
  });

  it('has a handler whose node id is shared with another declaration in handlerUnindexed, not in the graph as an edge target', () => {
    // two methods with the same signature in one class: invalid Java that the extractor still reads, and one id for both
    const clash = project(Object.fromEntries([resource('Clash', [
      '@Path("/c")', 'public class Clash {',
      '  @GET @Path("one") public String same() { return null; }',
      '  @GET @Path("two") public String same() { return null; }',
      '  @GET @Path("fine") public String other() { return null; }',
      '}',
    ])]));
    expect(clash.gaps('identity-collision')).toHaveLength(1);
    expect(clash.graph.coverage.routes.families[FAMILY].buckets).toMatchObject({ handlerUnindexed: 2, endpoint: 1 });
    expect(clash.links).toEqual(['GET /c/fine -> Clash.other']);
    expect(clash.gapOfKind('route-handler-unresolved').count).toBe(2);
    expect(clash.gapOfKind('route-handler-unresolved').samples).toEqual([`${SRC('Clash')}:6 Clash.same`, `${SRC('Clash')}:7 Clash.same`]);
    expect(validateFactGraphIntegrity(clash.graph).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The order of the build (design D7): what the stage must not touch
// ---------------------------------------------------------------------------

describe('the declarations of the structure rows are not touched by the endpoints (design D7)', () => {
  const java = Object.fromEntries([
    ORDER,
    resource('OrderApi', ['@Path("/v2/orders")', 'public interface OrderApi {', '  @GET', '  String list();', '}']),
    resource('OrderApiImpl', ['public class OrderApiImpl implements OrderApi {', '  public String list() { return null; }', '}']),
    // a collision of the structure rows' own, and an anonymous declaration: ordinals and collisions are the rows'
    resource('Dup', ['public class Dup {', '  public void same() {}', '  public void same() {}', '}']),
  ]);
  let withStage;
  let without;
  beforeAll(() => {
    withStage = project(java);
    without = project(java, { catalog: null });
  });

  it('keeps every node of the rows, with the same id, ordinal-derived names and fields', () => {
    const rowNodes = withStage.graph.nodes.filter((n) => n.type !== 'endpoint');
    expect(rowNodes).toEqual(without.graph.nodes);
    expect(withStage.graph.nodes.length).toBe(without.graph.nodes.length + withStage.endpoints.length);
  });

  it('keeps every edge of the rows, and adds only routes edges and the contains edges to endpoints', () => {
    const rowEdges = withStage.graph.edges.filter((e) => e.type !== 'routes' && withStage.byId.get(e.target).type !== 'endpoint');
    expect(rowEdges).toEqual(without.graph.edges);
    expect(withStage.graph.edges.length).toBe(without.graph.edges.length + withStage.routesEdges.length + withStage.containsEndpoint.length);
  });

  it('keeps the gaps of the rows, an identity collision included, and adds only route gaps', () => {
    expect(withStage.gaps('identity-collision')).toHaveLength(1);
    expect(withStage.graph.gaps.filter((g) => !g.kind.startsWith('route-'))).toEqual(without.graph.gaps);
  });

  it('adds only the routes section to the coverage, and changes the digest of the facts', () => {
    const { routes, ...rest } = withStage.graph.coverage;
    const { routes: notRun, ...restWithout } = without.graph.coverage;
    expect(rest).toEqual(restWithout);
    expect(routes.status).toBe('ran');
    expect(notRun).toEqual({ status: 'not-run' });
    expect(withStage.graph.factsDigest).not.toBe(without.graph.factsDigest);
  });

  it('is deterministic: the same inputs give the same nodes, edges, coverage, gaps and digest', () => {
    const again = project(java);
    expect(again.graph).toEqual(withStage.graph);
    expect(again.graph.factsDigest).toBe(withStage.graph.factsDigest);
  });

  it('puts the endpoints of a file in a group of their own for the ordinal: they do not move the ordinals of the file\'s other declarations', () => {
    // anonymous declarations get their id from the ordinal: the groups of the rows are counted by (path, owner, type) as before
    const one = project(Object.fromEntries([ORDER]));
    const none = project(Object.fromEntries([ORDER]), { catalog: null });
    expect(one.graph.nodes.filter((n) => n.type !== 'endpoint').map((n) => n.id)).toEqual(none.graph.nodes.map((n) => n.id));
  });
});

// ---------------------------------------------------------------------------
// Not run, and what the stage asks of its inputs
// ---------------------------------------------------------------------------

describe('a build without the route catalog and its inputs (spec: stage not run)', () => {
  it('records the stage as not-run, and has no endpoint, no routes edge and no route gap', () => {
    const p = project(BASE, { catalog: null });
    expect(p.graph.coverage.routes).toEqual({ status: 'not-run' });
    expect(p.endpoints).toEqual([]);
    expect(p.routesEdges).toEqual([]);
    expect(p.graph.gaps.some((g) => g.kind.startsWith('route-'))).toBe(false);
    expect(p.graph.nodes.some((n) => n.type === 'endpoint')).toBe(false);
  });

  it('records the stage as not-run for a null catalog as for an omitted one', () => {
    const { inputs } = inputsOf(BASE);
    expect(buildFactGraph({ ...inputs, routeCatalog: null }).coverage.routes).toEqual({ status: 'not-run' });
    expect(buildFactGraph({ ...inputs, routeCatalog: undefined }).coverage.routes).toEqual({ status: 'not-run' });
  });

  it('throws when a catalog is given without mentionInputs: the packages of the types without an entry are needed', () => {
    const { inputs } = inputsOf(BASE);
    const { mentionSites, mentionInputs, ...bare } = inputs;
    expect(mentionSites).toBeDefined();
    expect(mentionInputs).toBeDefined();
    expect(() => buildFactGraph({ ...bare, routeCatalog: CATALOG })).toThrow(/routeCatalog needs mentionInputs/);
    expect(() => buildFactGraph({ ...bare, mentionSites, routeCatalog: CATALOG })).toThrow(/mentionSites and mentionInputs go together/);
    expect(() => buildFactGraph({ ...bare, mentionSites, mentionInputs: { skippedNonCode: {} }, routeCatalog: CATALOG })).toThrow(/routeCatalog needs mentionInputs/);
    // the pairing is the catalog's: without one the stage does not look at them
    expect(() => buildFactGraph({ ...bare })).not.toThrow();
  });

  it('runs for a project with no Java file, and reads zero: the section is there, with every bucket', () => {
    const p = project({});
    expect(p.graph.coverage.routes).toEqual({
      status: 'ran',
      families: { [FAMILY]: { sites: 0, buckets: Object.fromEntries(ROUTE_BUCKETS.map((b) => [b, 0])), endpoints: 0, edges: 0 } },
      unconfirmed: {},
    });
  });

  it('reads an annotation type of the repository that has no entry of its own: a same-package type of a catalog annotation\'s name is not the catalog\'s', () => {
    const p = project(Object.fromEntries([
      [SRC('GET'), 'package com.acme.rest;\n\npublic @interface GET {\n}\n'],
      resource('Mine', ['@Path("/x")', 'public class Mine {', '  @GET public String m() { return null; }', '}']),
    ]));
    expect(p.graph.coverage.routes.families[FAMILY].sites).toBe(0);
    expect(p.graph.coverage.routes.unconfirmed).toEqual({});
    // without the package of that type, the stage would take the spelling for the catalog's
    const { inputs } = inputsOf(Object.fromEntries([
      [SRC('GET'), 'package com.acme.rest;\n\npublic @interface GET {\n}\n'],
      resource('Mine', ['@Path("/x")', 'public class Mine {', '  @GET public String m() { return null; }', '}']),
    ]));
    const blind = buildFactGraph({ ...inputs, mentionInputs: { ...inputs.mentionInputs, javaPackages: [] }, routeCatalog: CATALOG });
    expect(blind.coverage.routes.families[FAMILY].sites).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Conservation (design D9)
// ---------------------------------------------------------------------------

describe('the conservation of the route stage in buildFactGraph (spec: unbalanced conservation fails the build)', () => {
  const MIXED = Object.fromEntries([resource('Gappy', [
    '@Path("/g")', 'public class Gappy {',
    '  @GET public String ok() { return null; }',
    '  @GET @POST public String both() { return null; }',
    '  @Path("l") public Object locator() { return null; }',
    '  @GET @Path(Paths.X) public String constant() { return null; }',
    '  static class In { @GET public String nested() { return null; } }',
    '}',
    'class NoRoot {', '  @GET public String m() { return null; }', '}',
  ])]);

  it('builds when the buckets add up, and the recorded gaps and edges read back to them', () => {
    const p = project(MIXED);
    expect(p.graph.coverage.routes.families[FAMILY]).toMatchObject({ sites: 6, endpoints: 1, edges: 1 });
    expect(p.graph.gaps.filter((g) => g.kind.startsWith('route-')).reduce((sum, g) => sum + g.count, 0)).toBe(5);
  });

  it('fails when a gap of a kind is missing from what was recorded: the read-back is not the bucket sum', () => {
    const lose = (kind) => (resolved) => {
      const index = resolved.gaps.findIndex((g) => g.kind === kind);
      return { ...resolved, gaps: resolved.gaps.filter((_, i) => i !== index) };
    };
    for (const kind of ['route-handler-unresolved', 'route-verb-unresolved', 'route-root-unresolved', 'route-path-unresolved']) {
      expect(() => project(MIXED, { wrap: lose(kind) }), kind).toThrow(new RegExp(`family "jaxrs": \\d+ ${kind} outcome\\(s\\) but \\d+ recorded gap occurrence\\(s\\)`));
    }
  });

  it('fails when a gap is recorded for a site that is in no gap bucket', () => {
    const extra = (resolved) => ({ ...resolved, gaps: [...resolved.gaps, { kind: 'route-root-unresolved', scope: FAMILY, sample: 'extra' }] });
    expect(() => project(MIXED, { wrap: extra })).toThrow(/family "jaxrs": 1 route-root-unresolved outcome\(s\) but 2 recorded gap occurrence\(s\)/);
  });

  it('fails when the buckets do not add up to the sites', () => {
    const miscount = (resolved) => ({
      ...resolved,
      coverage: { ...resolved.coverage, families: { [FAMILY]: { ...resolved.coverage.families[FAMILY], sites: resolved.coverage.families[FAMILY].sites + 1 } } },
    });
    expect(() => project(MIXED, { wrap: miscount })).toThrow(/family "jaxrs": 7 route site\(s\) but 6 outcome\(s\)/);
  });

  it('fails when an edge is lost on the way into the graph: the sites that became endpoints are not the edges it got', () => {
    const lose = (resolved) => ({ ...resolved, edges: resolved.edges.slice(1) });
    expect(() => project(MIXED, { wrap: lose })).toThrow(/family "jaxrs": 1 routes edge\(s\) drawn but 0 in the graph/);
  });

  it('fails when two edges are one in the graph: the graph keeps the first edge of a type and two ends', () => {
    const repeat = (resolved) => ({
      ...resolved,
      edges: [...resolved.edges, ...resolved.edges],
      coverage: {
        ...resolved.coverage,
        families: { [FAMILY]: { ...resolved.coverage.families[FAMILY], edges: 2, buckets: { ...resolved.coverage.families[FAMILY].buckets, endpoint: 2 }, sites: 7 } },
      },
    });
    expect(() => project(MIXED, { wrap: repeat })).toThrow(/family "jaxrs": 2 routes edge\(s\) drawn but 1 in the graph/);
  });

  it('fails when an endpoint has the id of another node', () => {
    // a resolved endpoint with the shape of an id the rows already hold
    const clash = (resolved) => {
      const [first] = resolved.endpoints;
      const twin = { ...first, evidence: [...first.evidence] };
      return { ...resolved, endpoints: [first, twin] };
    };
    expect(() => project(MIXED, { wrap: clash })).toThrow(/the endpoint "GET \/g" of .* has the node id of another declaration/);
  });
});

// ---------------------------------------------------------------------------
// Mutation tripwires (design D11), reached through buildFactGraph
// ---------------------------------------------------------------------------

describe('the mutation tripwires of the route stage, reached through buildFactGraph (design D11)', () => {
  it('has every switch off by default', () => {
    const plain = project(BASE);
    expect(project(BASE, { routeMutations: {} }).graph).toEqual(plain.graph);
  });

  it('hands the routeMutations object to the resolution', () => {
    const slashes = Object.fromEntries([resource('R', ['@Path("/o/")', 'public class R {', '  @GET @Path("{id}/") public String m() { return null; }', '}'])]);
    expect(project(slashes).endpoints.map((n) => n.name)).toEqual(['GET /o/{id}']);
    expect(project(slashes, { routeMutations: { noSlashTrim: true } }).endpoints.map((n) => n.name)).toEqual(['GET //o//{id}/']);

    const noRoot = Object.fromEntries([resource('R', ['public class R {', '  @GET @Path("m") public String m() { return null; }', '}'])]);
    expect(project(noRoot).endpoints).toEqual([]);
    expect(project(noRoot, { routeMutations: { rootFromMethod: true } }).endpoints.map((n) => n.name)).toEqual(['GET /m']);

    const verbs = Object.fromEntries([resource('R', ['@Path("/r")', 'public class R {', '  @DELETE @PUT public String m() { return null; }', '}'])]);
    expect(project(verbs).endpoints).toEqual([]);
    expect(project(verbs, { routeMutations: { firstVerb: true } }).endpoints.map((n) => n.name)).toEqual(['DELETE /r']);
  });

  it('containsWithoutToken: the contains edge to an endpoint cites its line with no token', () => {
    const plain = project(BASE);
    expect(plain.containsEndpoint.every((e) => typeof e.evidence[0].token === 'string')).toBe(true);
    const mutated = project(BASE, { routeMutations: { containsWithoutToken: true } });
    expect(mutated.containsEndpoint).toHaveLength(3);
    expect(mutated.containsEndpoint.every((e) => !('token' in e.evidence[0]))).toBe(true);
    // the routes edges are untouched
    expect(mutated.routesEdges).toEqual(plain.routesEdges);
  });
});
