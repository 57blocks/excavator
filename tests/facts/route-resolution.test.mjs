// jaxrs-route-facts, tasks 2.1-2.4: the resolution of Java route sites into
// endpoints and `routes` edges, visible buckets, gaps and coverage
// (skills/excavator/route-resolution.mjs), over the shipped route catalog.
//
// Every input is real: small synthetic Java sources are read by the built Core
// (`classes[].annotationArguments`, `memberAnnotations`, `functions[].visibility`)
// and annotations are confirmed by the shared identity function
// (createAnnotationIdentity) over the type dictionaries of the sources. Nothing
// here goes through buildFactGraph: wiring it in is task 3.2.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginRegistry, TreeSitterPlugin, builtinLanguageConfigs, registerAllParsers } from '@excavator/core';
import { analyzeFileWithOutcomes, buildResult } from '../../skills/excavator/extract-structure-result.mjs';
import { indexJavaTypes } from '../../skills/excavator/mention-resolution.mjs';
import { createAnnotationIdentity } from '../../skills/excavator/name-reference-resolution.mjs';
import { loadRouteCatalog, parseRouteCatalog } from '../../skills/excavator/route-catalog.mjs';
import {
  ROUTE_BUCKETS, ROUTE_GAP_KINDS, assertRouteConservation, formatRoute, resolveRoutes,
} from '../../skills/excavator/route-resolution.mjs';

let registry;
beforeAll(async () => {
  const tsPlugin = new TreeSitterPlugin(builtinLanguageConfigs.filter((c) => c.treeSitter));
  await tsPlugin.init();
  registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);
});

const CATALOG = loadRouteCatalog();
const lines = (text) => (Array.isArray(text) ? text.join('\n') : text);

/** A Java file: the package line, the imports, a blank line, the body. */
const javaSource = (pkg, imports, body) => [`package ${pkg};`, ...imports, '', ...[body].flat(), ''].join('\n');
const RS = 'import javax.ws.rs.*;';
const JRS = 'import jakarta.ws.rs.*;';
const CLIENT = 'import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;';

const SRC = (name, pkg = 'com.acme.rest') => `app/src/${pkg.replaceAll('.', '/')}/${name}.java`;
/** A resource class of package com.acme.rest, importing javax.ws.rs.*. */
const resource = (name, body, { imports = [RS], pkg = 'com.acme.rest' } = {}) => [SRC(name, pkg), javaSource(pkg, imports, body)];

/**
 * Read a synthetic project the way the Lazy driver does, up to the route
 * resolution: Core's structure row of each Java source, the dictionaries the
 * annotation identity reads, then `resolveRoutes`.
 *
 * @param {{
 *   java?: Record<string, string|string[]>, catalog?: object, mutations?: object,
 *   declaredTypes?: string[], nullIds?: string[],
 * }} spec `declaredTypes` are classes the repository declares that no row here
 *   has a type for (an annotation type); `nullIds` are `path#Owner.method` of
 *   handlers whose node id is shared with another declaration (so names no node).
 */
function project({ java = {}, catalog = CATALOG, mutations, declaredTypes = [], nullIds = [] } = {}) {
  const texts = {};
  const javaRows = [];
  for (const [path, source] of Object.entries(java)) {
    texts[path] = lines(source);
    const file = { path, language: 'java', fileCategory: 'code' };
    const extracted = analyzeFileWithOutcomes(registry, file, texts[path]);
    expect(extracted.structureOutcome).toBe('succeeded');
    const split = texts[path].split('\n');
    javaRows.push(buildResult(file, split.length, split.filter((l) => l.trim()).length, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome));
  }
  const javaTypes = javaRows.flatMap((row) => (row.classes ?? []).map((cls) => ({ fqn: cls.qualifiedName, path: row.path, id: `class:${row.path}#${cls.name}` })));
  const declared = new Set(declaredTypes);
  const identity = ({ fqns, simpleNames }) => createAnnotationIdentity({
    fqns,
    typesByFqn: indexJavaTypes(javaTypes),
    otherJvm: { isType: () => false },
    declaredJavaTypes: { isType: (pkg, name) => declared.has(`${pkg}.${name}`) },
    simpleNames,
  });
  const handlerIdOf = (path, index) => {
    const fn = javaRows.find((row) => row.path === path).functions[index];
    return nullIds.includes(`${path}#${fn.owner}.${fn.name}`) ? null : `function:${path}#${fn.owner}.${fn.name}@${fn.startLine}`;
  };
  const run = (rows, extra) => resolveRoutes({ javaRows: rows, catalog, identity, handlerIdOf, mutations, ...extra });
  const result = run(javaRows);
  const handler = (id) => id.replace(/^function:.*#/, '').replace(/@\d+$/, '');
  return {
    texts, javaRows, result, run,
    coverage: result.coverage,
    family: result.coverage.families.jaxrs,
    buckets: result.coverage.families.jaxrs?.buckets,
    /** `route [Owner]` of every endpoint, in order. */
    endpoints: result.endpoints.map((e) => `${e.route} [${e.owner}]`),
    /** `route -> Owner.method` of every edge, in order. */
    links: result.edges.map((e) => `${e.endpoint.route} -> ${handler(e.target)}`),
    gaps: (kind) => result.gaps.filter((g) => g.kind === kind),
    samples: (kind) => result.gaps.filter((g) => g.kind === kind).map((g) => g.sample),
    /** `file:line` of the first line of a source that holds `needle`. */
    at: (path, needle, nth = 0) => `${path}:${texts[path].split('\n').map((l, i) => [l, i + 1]).filter(([l]) => l.includes(needle))[nth][1]}`,
    lineOf: (path, needle, nth = 0) => texts[path].split('\n').map((l, i) => [l, i + 1]).filter(([l]) => l.includes(needle))[nth][1],
  };
}

/** One resource class of the usual shape: a root path and the given methods. */
const orders = (methods, root = '@Path("/orders/")') => project({ java: Object.fromEntries([resource('OrderResource', [root, 'public class OrderResource {', ...[methods].flat(), '}'])]) });

// ---------------------------------------------------------------------------
// The route: verb, then the path of the type and of the method (D6)
// ---------------------------------------------------------------------------

describe('the route of an endpoint (design D6)', () => {
  it('joins the class path and the method path: both lose the slashes at their ends, a template stays as written', () => {
    const p = orders(['  @GET', '  @Path("{id}")', '  public String find() { return null; }']);
    expect(p.endpoints).toEqual(['GET /orders/{id} [OrderResource]']);
    expect(p.links).toEqual(['GET /orders/{id} -> OrderResource.find']);
  });

  it('has the path of the class alone when the method writes none', () => {
    const p = orders(['  @POST', '  public void create() {}'], '@Path("orders")');
    expect(p.endpoints).toEqual(['POST /orders [OrderResource]']);
  });

  it('is the slash alone for a class path of a slash', () => {
    const p = orders(['  @GET', '  public String index() { return null; }'], '@Path("/")');
    expect(p.endpoints).toEqual(['GET / [OrderResource]']);
  });

  it('is the slash alone for an empty class path and no method path, and the method path alone for an empty class path', () => {
    expect(orders(['  @GET', '  public String index() { return null; }'], '@Path("")').endpoints).toEqual(['GET / [OrderResource]']);
    expect(orders(['  @GET', '  @Path("list")', '  public String list() { return null; }'], '@Path("")').endpoints).toEqual(['GET /list [OrderResource]']);
    expect(orders(['  @GET', '  @Path("/")', '  public String index() { return null; }'], '@Path("/a/")').endpoints).toEqual(['GET /a [OrderResource]']);
  });

  it('removes every slash at the ends of a value, and none inside it', () => {
    const p = orders(['  @GET', '  @Path("///{id}//items///")', '  public String items() { return null; }'], '@Path("//orders//v1//")');
    expect(p.endpoints).toEqual(['GET /orders//v1/{id}//items [OrderResource]']);
  });

  it('keeps a regular expression in a template as written, the slashes in it too', () => {
    const p = orders([
      '  @GET',
      '  @Path("{id: [0-9]+}")',
      '  public String byNumber() { return null; }',
      '',
      '  @GET',
      '  @Path("/files/{path: .+/[^/]*}/")',
      '  public String file() { return null; }',
    ]);
    expect(p.endpoints).toEqual(['GET /orders/{id: [0-9]+} [OrderResource]', 'GET /orders/files/{path: .+/[^/]*} [OrderResource]']);
  });

  it('keeps white space and other characters inside a value as written', () => {
    const p = orders(['  @GET', '  @Path(" a b ")', '  public String x() { return null; }']);
    expect(p.endpoints).toEqual(['GET /orders/ a b  [OrderResource]']);
  });

  it('reads the path from the value argument, written by name or by position', () => {
    const p = orders([
      '  @GET', '  @Path(value = "named")', '  public String named() { return null; }',
      '',
      '  @GET', '  @Path("positional")', '  public String positional() { return null; }',
    ]);
    expect(p.endpoints).toEqual(['GET /orders/named [OrderResource]', 'GET /orders/positional [OrderResource]']);
  });

  it('is `formatRoute`: the verb, a space, a slash and the non-empty segments joined by slashes', () => {
    expect(formatRoute('GET', '/orders/', '{id}')).toBe('GET /orders/{id}');
    expect(formatRoute('DELETE', '', '')).toBe('DELETE /');
    expect(formatRoute('PUT', '/', '/')).toBe('PUT /');
    expect(formatRoute('POST', 'a//b', '//c//')).toBe('POST /a//b/c');
    expect(formatRoute('GET', '/orders/', '{id}', { trim: false })).toBe('GET //orders//{id}');
  });
});

// ---------------------------------------------------------------------------
// What an endpoint is, and what it is not: the scenarios of the spec
// ---------------------------------------------------------------------------

describe('endpoints and routes edges (spec: Java annotation routes)', () => {
  it('names the endpoint by the route, with the top-level type as owner, and draws one routes edge from it to the handler', () => {
    const p = orders(['  @GET', '  @Path("{id}")', '  public String find() { return null; }']);
    const [endpoint] = p.result.endpoints;
    expect(endpoint).toMatchObject({ family: 'jaxrs', file: SRC('OrderResource'), owner: 'OrderResource', route: 'GET /orders/{id}' });
    expect(p.result.edges).toHaveLength(1);
    const [edge] = p.result.edges;
    expect(edge).toMatchObject({
      type: 'routes', direction: 'forward', weight: 0.5, provenance: 'extracted',
      target: `function:${SRC('OrderResource')}#OrderResource.find@${p.lineOf(SRC('OrderResource'), '@GET')}`,
    });
    expect(edge.endpoint).toBe(endpoint);
  });

  it('takes the line range of the first handler in the source, the annotation lines included', () => {
    const path = SRC('OrderResource');
    const p = orders(['  @GET', '  @Path("{id}")', '  public String find() {', '    return null;', '  }']);
    expect(p.result.endpoints[0].lineRange).toEqual([p.lineOf(path, '@GET'), p.lineOf(path, '  }')]);
  });

  it('gives one endpoint and two edges to two methods that share a route: the first in the source anchors it', () => {
    const path = SRC('OrderResource');
    const p = orders([
      '  @GET', '  @Path("{id}")', '  @Produces("application/json")', '  public String json() { return null; }',
      '',
      '  @GET', '  @Path("{id}")', '  @Produces("text/plain")', '  public String text() { return null; }',
    ]);
    expect(p.endpoints).toEqual(['GET /orders/{id} [OrderResource]']);
    expect(p.links).toEqual(['GET /orders/{id} -> OrderResource.json', 'GET /orders/{id} -> OrderResource.text']);
    expect(p.result.endpoints[0].lineRange).toEqual([p.lineOf(path, '@GET', 0), p.lineOf(path, 'public String json')]);
    expect(p.family).toMatchObject({ sites: 2, endpoints: 1, edges: 2 });
    expect(p.buckets.endpoint).toBe(2);
  });

  it('keeps routes apart: different verbs and different paths are different endpoints, in the order of the source', () => {
    const p = orders([
      '  @GET', '  public String list() { return null; }',
      '',
      '  @POST', '  public void create() {}',
      '',
      '  @GET', '  @Path("{id}")', '  public String find() { return null; }',
    ]);
    expect(p.endpoints).toEqual(['GET /orders [OrderResource]', 'POST /orders [OrderResource]', 'GET /orders/{id} [OrderResource]']);
    expect(p.family).toMatchObject({ sites: 3, endpoints: 3, edges: 3 });
  });

  it('knows all seven verbs, and a verb of the catalog written qualified', () => {
    const verbs = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH'];
    const p = orders(verbs.flatMap((verb) => [`  @${verb}`, `  public void ${verb.toLowerCase()}() {}`, '']));
    expect(p.endpoints).toEqual(verbs.map((verb) => `${verb} /orders [OrderResource]`));
    const qualified = orders(['  @javax.ws.rs.PUT', '  @javax.ws.rs.Path("x")', '  public void put() {}'], '@javax.ws.rs.Path("/q/")');
    expect(qualified.endpoints).toEqual(['PUT /q/x [OrderResource]']);
  });

  it('reads the jakarta namespace as the javax one, over an on-demand import', () => {
    const body = (root) => [root, 'public class ItemResource {', '  @DELETE', '  @Path("{id}")', '  public void remove() {}', '}'];
    const javax = project({ java: Object.fromEntries([resource('ItemResource', body('@Path("items")'), { imports: [RS] })]) });
    const jakarta = project({ java: Object.fromEntries([resource('ItemResource', body('@Path("items")'), { imports: [JRS] })]) });
    expect(jakarta.endpoints).toEqual(['DELETE /items/{id} [ItemResource]']);
    expect(jakarta.endpoints).toEqual(javax.endpoints);
    expect(jakarta.links).toEqual(javax.links);
    expect(jakarta.buckets).toEqual(javax.buckets);
    expect(jakarta.coverage.unconfirmed).toEqual({});
  });

  it('confirms an annotation by a single-type import, and by the qualified name it is written with', () => {
    const p = project({
      java: Object.fromEntries([
        resource('ByImport', ['@Path("a")', 'public class ByImport {', '  @GET public String m() { return null; }', '}'], { imports: ['import javax.ws.rs.Path;', 'import javax.ws.rs.GET;'] }),
        resource('ByName', ['@javax.ws.rs.Path("b")', 'public class ByName {', '  @jakarta.ws.rs.GET public String m() { return null; }', '}'], { imports: [] }),
      ]),
    });
    expect(p.endpoints).toEqual(['GET /a [ByImport]', 'GET /b [ByName]']);
  });

  it('draws the edge to the method of an interface, and none for the implementation that writes no annotation', () => {
    const p = project({
      java: Object.fromEntries([
        resource('OrderApi', ['@Path("/v2/orders")', 'public interface OrderApi {', '  @GET', '  String list();', '}']),
        resource('OrderApiImpl', ['public class OrderApiImpl implements OrderApi {', '  public String list() { return null; }', '}']),
      ]),
    });
    expect(p.endpoints).toEqual(['GET /v2/orders [OrderApi]']);
    expect(p.links).toEqual(['GET /v2/orders -> OrderApi.list']);
    expect(p.family.sites).toBe(1);
  });

  it('keeps the same route of two types, and of two files, apart: an endpoint is one per file, type and route', () => {
    const p = project({
      java: Object.fromEntries([
        resource('Same', ['@Path("/x")', 'public class Same {', '  @GET public String a() { return null; }', '}'], { pkg: 'com.acme.one' }),
        resource('Same', ['@Path("/x")', 'public class Same {', '  @GET public String a() { return null; }', '}'], { pkg: 'com.acme.two' }),
        resource('Twin', ['@Path("/x")', 'public class Twin {', '  @GET public String a() { return null; }', '}', '', '@Path("/x")', 'class Other {', '  @GET public String a() { return null; }', '}'], { pkg: 'com.acme.two' }),
      ]),
    });
    expect(p.endpoints).toEqual(['GET /x [Same]', 'GET /x [Same]', 'GET /x [Twin]', 'GET /x [Other]']);
    expect(new Set(p.result.endpoints.map((e) => `${e.file}|${e.owner}`)).size).toBe(4);
    expect(p.family).toMatchObject({ sites: 4, endpoints: 4, edges: 4 });
  });

  it('tells overloaded methods apart: each is a site of its own, by the line of its name', () => {
    const p = orders([
      '  @GET', '  public String find() { return null; }',
      '',
      '  @GET', '  @Path("{id}")', '  public String find(String id) { return null; }',
    ]);
    expect(p.endpoints).toEqual(['GET /orders [OrderResource]', 'GET /orders/{id} [OrderResource]']);
    const [one, two] = p.result.edges.map((e) => e.target);
    expect(one).not.toBe(two);
  });

  it('reads a method that carries a method path and no verb as a site: it is a locator', () => {
    const p = orders(['  @Path("{id}/items")', '  public Object items() { return null; }']);
    expect(p.family.sites).toBe(1);
    expect(p.buckets).toMatchObject({ noVerb: 1, endpoint: 0 });
  });

  it('reads no method that carries neither a verb nor a method path of the catalog as a site', () => {
    const p = orders(['  @Produces("text/plain")', '  public String x() { return null; }', '', '  @Deprecated', '  public String y() { return null; }']);
    expect(p.family.sites).toBe(0);
    expect(p.result.endpoints).toEqual([]);
  });
});

describe('what is no endpoint, and the bucket it lands in (spec scenarios)', () => {
  it('a locator of a sub-resource has no verb: route-verb-unresolved', () => {
    const path = SRC('OrderResource');
    const p = orders(['  @Path("{id}/items")', '  public Object items() { return null; }']);
    expect(p.result.endpoints).toEqual([]);
    expect(p.buckets).toMatchObject({ noVerb: 1 });
    expect(p.result.gaps).toEqual([{ kind: 'route-verb-unresolved', scope: 'jaxrs', sample: `${path}:${p.lineOf(path, 'public Object items')} OrderResource.items` }]);
  });

  it('a type with no root path is no root resource: route-root-unresolved', () => {
    const path = SRC('ItemsResource');
    const p = project({ java: Object.fromEntries([resource('ItemsResource', ['public class ItemsResource {', '  @GET', '  public String list() { return null; }', '}'])]) });
    expect(p.result.endpoints).toEqual([]);
    expect(p.buckets).toMatchObject({ noRoot: 1, endpoint: 0 });
    expect(p.result.gaps).toEqual([{ kind: 'route-root-unresolved', scope: 'jaxrs', sample: `${path}:${p.lineOf(path, 'public String list')} ItemsResource.list` }]);
  });

  it('a path written as a constant is not read: route-path-unresolved, for the method path and for the class path', () => {
    const path = SRC('OrderResource');
    const method = orders(['  @GET', '  @Path(Paths.HISTORY)', '  public String history() { return null; }']);
    expect(method.result.endpoints).toEqual([]);
    expect(method.buckets).toMatchObject({ nonLiteral: 1 });
    expect(method.result.gaps).toEqual([{ kind: 'route-path-unresolved', scope: 'jaxrs', sample: `${path}:${method.lineOf(path, 'public String history')} OrderResource.history` }]);

    const type = orders(['  @GET', '  public String list() { return null; }'], '@Path(Paths.ORDERS)');
    expect(type.buckets).toMatchObject({ nonLiteral: 1, endpoint: 0 });
    expect(type.gaps('route-path-unresolved')).toHaveLength(1);
  });

  it('a path that is no string literal is not read, however it is written: a concatenation, an array, no argument at all', () => {
    const p = orders([
      '  @GET', '  @Path("a" + "b")', '  public String concatenated() { return null; }',
      '  @GET', '  @Path({"a", "b"})', '  public String listed() { return null; }',
      '  @GET', '  @Path', '  public String bare() { return null; }',
      '  @GET', '  @Path(other = "a")', '  public String otherKey() { return null; }',
    ]);
    expect(p.buckets).toMatchObject({ nonLiteral: 4, endpoint: 0 });
    expect(p.gaps('route-path-unresolved')).toHaveLength(4);
  });

  it('two different verbs are no verb to pick: route-verb-unresolved', () => {
    const path = SRC('OrderResource');
    const p = orders(['  @GET', '  @POST', '  public String both() { return null; }']);
    expect(p.result.endpoints).toEqual([]);
    expect(p.buckets).toMatchObject({ conflict: 1 });
    expect(p.result.gaps).toEqual([{ kind: 'route-verb-unresolved', scope: 'jaxrs', sample: `${path}:${p.lineOf(path, 'public String both')} OrderResource.both` }]);
  });

  it('the same verb written twice is one verb', () => {
    const p = project({ java: Object.fromEntries([resource('OrderResource', ['@javax.ws.rs.Path("/o")', 'public class OrderResource {', '  @javax.ws.rs.GET @jakarta.ws.rs.GET', '  public String m() { return null; }', '}'], { imports: [] })]) });
    expect(p.endpoints).toEqual(['GET /o [OrderResource]']);
    expect(p.buckets.conflict).toBe(0);
    // both annotations are on the one line: the evidence of the verb is the line, once
    expect(p.result.edges[0].evidence.filter((e) => e.role === 'verb')).toHaveLength(1);
  });

  it('a method that is not public is not exposed: no endpoint and no gap', () => {
    const p = orders([
      '  @GET', '  private String hidden() { return null; }',
      '  @GET', '  String packagePrivate() { return null; }',
      '  @GET', '  protected String guarded() { return null; }',
      '  @GET', '  public String open() { return null; }',
    ]);
    expect(p.endpoints).toEqual(['GET /orders [OrderResource]']);
    expect(p.links).toEqual(['GET /orders -> OrderResource.open']);
    expect(p.buckets).toMatchObject({ nonPublic: 3, endpoint: 1 });
    expect(p.result.gaps).toEqual([]);
  });

  it('a method of an interface is public without writing it', () => {
    const p = project({ java: Object.fromEntries([resource('OrderApi', ['@Path("/api")', 'public interface OrderApi {', '  @GET', '  String list();', '}'])]) });
    expect(p.buckets).toMatchObject({ nonPublic: 0, endpoint: 1 });
  });

  it('a family that is not public-only exposes every method', () => {
    const catalog = JSON.parse(JSON.stringify(CATALOG));
    catalog.routeFamilies[0].publicOnly = false;
    const p = project({
      catalog: parseRouteCatalog(catalog),
      java: Object.fromEntries([resource('OrderResource', ['@Path("/o")', 'public class OrderResource {', '  @GET', '  private String hidden() { return null; }', '}'])]),
    });
    expect(p.buckets).toMatchObject({ nonPublic: 0, endpoint: 1 });
  });

  it('a type that declares a client of a remote service is no entry point: no endpoint and no gap', () => {
    const p = project({
      java: Object.fromEntries([resource('LibraryClient', ['@RegisterRestClient', '@Path("/library")', 'public interface LibraryClient {', '  @GET', '  String books();', '}'], { imports: [RS, CLIENT] })]),
    });
    expect(p.result.endpoints).toEqual([]);
    expect(p.buckets).toMatchObject({ client: 1, endpoint: 0 });
    expect(p.result.gaps).toEqual([]);
  });

  it('a client annotation is confirmed like any other: one the file does not import, or another package\'s, declares nothing', () => {
    const body = ['@RegisterRestClient', '@Path("/library")', 'public interface LibraryClient {', '  @GET', '  String books();', '}'];
    // no import: the repository's own, by the package, or nothing the imports settle
    const unimported = project({ java: Object.fromEntries([resource('LibraryClient', body, { imports: [RS] })]) });
    expect(unimported.buckets).toMatchObject({ client: 0, endpoint: 1 });
    const other = project({ java: Object.fromEntries([resource('LibraryClient', body, { imports: [RS, 'import com.acme.other.RegisterRestClient;'] })]) });
    expect(other.buckets).toMatchObject({ client: 0, endpoint: 1 });
    const qualified = project({
      java: Object.fromEntries([resource('LibraryClient', ['@org.eclipse.microprofile.rest.client.inject.RegisterRestClient', ...body.slice(1)], { imports: [RS] })]),
    });
    expect(qualified.buckets).toMatchObject({ client: 1, endpoint: 0 });
  });

  it('a method in a nested type has no node for an edge: route-handler-unresolved', () => {
    const path = SRC('OrderResource');
    const p = orders(['  public static class Inner {', '    @GET', '    public String nested() { return null; }', '  }']);
    expect(p.result.endpoints).toEqual([]);
    expect(p.buckets).toMatchObject({ nested: 1, endpoint: 0 });
    expect(p.result.gaps).toEqual([{ kind: 'route-handler-unresolved', scope: 'jaxrs', sample: `${path}:${p.lineOf(path, 'public String nested')} OrderResource.nested` }]);
  });

  it('a method in an anonymous or a local type is nested too', () => {
    const p = orders([
      '  public Object make() {',
      '    return new Object() {',
      '      @GET public String anonymous() { return null; }',
      '    };',
      '  }',
    ]);
    expect(p.buckets).toMatchObject({ nested: 1, endpoint: 0 });
  });

  it('a method whose node id is shared with another declaration is no handler: route-handler-unresolved', () => {
    const path = SRC('OrderResource');
    const spec = Object.fromEntries([resource('OrderResource', ['@Path("/o")', 'public class OrderResource {', '  @GET public String clash() { return null; }', '  @GET @Path("ok") public String fine() { return null; }', '}'])]);
    const p = project({ java: spec, nullIds: [`${path}#OrderResource.clash`] });
    expect(p.endpoints).toEqual(['GET /o/ok [OrderResource]']);
    expect(p.buckets).toMatchObject({ handlerUnindexed: 1, endpoint: 1 });
    expect(p.samples('route-handler-unresolved')).toEqual([`${path}:${p.lineOf(path, 'clash')} OrderResource.clash`]);
  });

  it('a method the structure row has no entry for is no handler either', () => {
    const p = orders(['  @GET', '  public String find() { return null; }']);
    const rows = p.javaRows.map((row) => ({ ...row, functions: [] }));
    const run = p.run(rows);
    expect(run.coverage.families.jaxrs.buckets).toMatchObject({ handlerUnindexed: 1, endpoint: 0 });
    expect(run.gaps.map((g) => g.kind)).toEqual(['route-handler-unresolved']);
  });

  it('an entry of the same name that does not hold the line of the annotated method is not the handler', () => {
    const p = orders(['  @GET', '  public String find() { return null; }']);
    const rows = p.javaRows.map((row) => ({ ...row, functions: row.functions.map((fn) => ({ ...fn, startLine: fn.endLine + 1, endLine: fn.endLine + 3 })) }));
    expect(p.run(rows).coverage.families.jaxrs.buckets).toMatchObject({ handlerUnindexed: 1, endpoint: 0 });
    const otherOwner = p.javaRows.map((row) => ({ ...row, functions: row.functions.map((fn) => ({ ...fn, owner: 'Else' })) }));
    expect(p.run(otherOwner).coverage.families.jaxrs.buckets).toMatchObject({ handlerUnindexed: 1, endpoint: 0 });
  });

  it('two entries that both hold the line cannot be told apart: no handler is picked', () => {
    const p = orders(['  @GET', '  public String find() { return null; }']);
    const rows = p.javaRows.map((row) => ({ ...row, functions: [...row.functions, ...row.functions] }));
    expect(p.run(rows).coverage.families.jaxrs.buckets).toMatchObject({ handlerUnindexed: 1, endpoint: 0 });
  });

  it('a method of a type the row has no entry for has no root path to read: no root path', () => {
    const p = orders(['  @GET', '  public String find() { return null; }']);
    const rows = p.javaRows.map((row) => ({ ...row, classes: [] }));
    const run = p.run(rows);
    expect(run.coverage.families.jaxrs.buckets).toMatchObject({ noRoot: 1, endpoint: 0 });
    expect(run.gaps.map((g) => g.kind)).toEqual(['route-root-unresolved']);
  });
});

describe('the annotation a spelling stands for follows the scope rules of Java (spec scenarios)', () => {
  it('a type the repository declares itself with the name of a catalog annotation is not the catalog\'s, and is not counted either', () => {
    // an annotation type declared by a file, single-type imported by another
    const own = project({
      java: Object.fromEntries([
        resource('Mine', ['@Path("/x")', 'public class Mine {', '  @GET public String m() { return null; }', '}'], { imports: ['import javax.ws.rs.Path;', 'import com.acme.annotations.GET;'] }),
      ]),
      declaredTypes: ['com.acme.annotations.GET'],
    });
    expect(own.family.sites).toBe(0);
    expect(own.coverage.unconfirmed).toEqual({});
    expect(own.result.endpoints).toEqual([]);

    // the same package declares it, so it shadows the on-demand import
    const samePackage = project({
      java: Object.fromEntries([resource('Mine', ['@Path("/x")', 'public class Mine {', '  @GET public String m() { return null; }', '}'])]),
      declaredTypes: ['com.acme.rest.GET'],
    });
    expect(samePackage.family.sites).toBe(0);
    expect(samePackage.coverage.unconfirmed).toEqual({});

    // declared as an interface the rows have a type for
    const asType = project({
      java: Object.fromEntries([
        resource('GET', ['public interface GET {', '}']),
        resource('Mine', ['@Path("/x")', 'public class Mine {', '  @GET public String m() { return null; }', '}']),
      ]),
    });
    expect(asType.family.sites).toBe(0);
    expect(asType.coverage.unconfirmed).toEqual({});
  });

  it('two on-demand imports that both provide the name leave it unconfirmed: counted by spelling, no site', () => {
    const p = project({
      java: Object.fromEntries([
        resource('Both', ['public class Both {', '  @GET public String m() { return null; }', '}'], { imports: [RS, JRS] }),
      ]),
    });
    expect(p.family.sites).toBe(0);
    expect(p.result.endpoints).toEqual([]);
    expect(p.coverage.unconfirmed).toEqual({ GET: 1 });
    expect(p.result.gaps).toEqual([]);
  });

  it('counts an unconfirmed spelling wherever it is read: on a type, on a method, in every file', () => {
    const p = project({
      java: Object.fromEntries([
        resource('A', ['@Path("/a")', 'public class A {', '  @GET @Path("m") public String m() { return null; }', '}'], { imports: [RS, JRS] }),
        resource('B', ['public class B {', '  @POST public String m() { return null; }', '  @GET public String n() { return null; }', '}'], { imports: [RS, JRS] }),
      ]),
    });
    // sorted by spelling
    expect(p.coverage.unconfirmed).toEqual({ GET: 2, POST: 1, Path: 2 });
    expect(Object.keys(p.coverage.unconfirmed)).toEqual(['GET', 'POST', 'Path']);
    expect(p.family.sites).toBe(0);
  });

  it('a spelling no catalog annotation shares a simple name with is not counted, whatever it is', () => {
    const p = orders(['  @Produces("a")', '  @Consumes("b")', '  @Deprecated', '  public String x() { return null; }']);
    expect(p.coverage.unconfirmed).toEqual({});
  });

  it('a site needs only one confirmed annotation: an unconfirmed verb beside a confirmed method path is a locator', () => {
    const p = project({
      java: Object.fromEntries([
        resource('Mixed', ['@Path("/m")', 'public class Mixed {', '  @GET @javax.ws.rs.Path("x") public String m() { return null; }', '}'], { imports: [RS, JRS] }),
      ]),
    });
    // `Path` of the class is unconfirmed as well: the type has no root path
    expect(p.coverage.unconfirmed).toEqual({ GET: 1, Path: 1 });
    expect(p.buckets).toMatchObject({ noVerb: 1, endpoint: 0 });
  });
});

// ---------------------------------------------------------------------------
// The order of the buckets (design D5)
// ---------------------------------------------------------------------------

describe('the order of the buckets (design D5)', () => {
  const only = (p) => Object.entries(p.buckets).filter(([, count]) => count > 0).map(([bucket]) => bucket);
  const typed = (annotations, member, { imports = [RS, CLIENT] } = {}) => project({
    java: Object.fromEntries([resource('Subject', [...annotations, 'public class Subject {', ...[member].flat(), '}'], { imports })]),
  });

  it('has the nine buckets, in the order of the design, and a gap kind only for the buckets that are gaps', () => {
    expect([...ROUTE_BUCKETS]).toEqual(['nested', 'client', 'handlerUnindexed', 'nonPublic', 'conflict', 'noVerb', 'noRoot', 'nonLiteral', 'endpoint']);
    expect(Object.isFrozen(ROUTE_BUCKETS)).toBe(true);
    expect(ROUTE_GAP_KINDS).toEqual({
      nested: 'route-handler-unresolved',
      handlerUnindexed: 'route-handler-unresolved',
      conflict: 'route-verb-unresolved',
      noVerb: 'route-verb-unresolved',
      noRoot: 'route-root-unresolved',
      nonLiteral: 'route-path-unresolved',
    });
    expect(Object.isFrozen(ROUTE_GAP_KINDS)).toBe(true);
    for (const bucket of ['client', 'nonPublic', 'endpoint']) expect(ROUTE_GAP_KINDS[bucket]).toBeUndefined();
  });

  it('nested comes before client: a nested method of a client type is nested', () => {
    expect(only(typed(['@RegisterRestClient', '@Path("/c")'], ['  static class Inner {', '    @GET public String m() { return null; }', '  }']))).toEqual(['nested']);
  });

  it('client comes before the handler: a client type\'s method with no node is a client declaration', () => {
    const spec = ['@RegisterRestClient', '@Path("/c")'];
    const p = project({
      java: Object.fromEntries([resource('Subject', [...spec, 'public interface Subject {', '  @GET String m();', '}'], { imports: [RS, CLIENT] })]),
      nullIds: [`${SRC('Subject')}#Subject.m`],
    });
    expect(only(p)).toEqual(['client']);
  });

  it('the handler comes before public: a private method with no node is unindexed', () => {
    const p = project({
      java: Object.fromEntries([resource('Subject', ['@Path("/s")', 'public class Subject {', '  @GET private String m() { return null; }', '}'])]),
      nullIds: [`${SRC('Subject')}#Subject.m`],
    });
    expect(only(p)).toEqual(['handlerUnindexed']);
  });

  it('public comes before the verbs: a private method with two verbs is not exposed', () => {
    expect(only(typed(['@Path("/s")'], ['  @GET @POST private String m() { return null; }']))).toEqual(['nonPublic']);
  });

  it('several verbs come before the root: a type with no root path and a method with two verbs is a conflict', () => {
    expect(only(typed([], ['  @GET @PUT public String m() { return null; }']))).toEqual(['conflict']);
  });

  it('no verb comes before the root and before the path: a locator is a locator, whatever else is wrong', () => {
    expect(only(typed([], ['  @Path("x") public Object m() { return null; }']))).toEqual(['noVerb']);
    expect(only(typed(['@Path("/s")'], ['  @Path(Paths.X) public Object m() { return null; }']))).toEqual(['noVerb']);
  });

  it('the root comes before the path: a type with no root path and a constant method path has no root', () => {
    expect(only(typed([], ['  @GET @Path(Paths.X) public String m() { return null; }']))).toEqual(['noRoot']);
  });

  it('a constant in the class path and a constant in the method path are the same bucket, when the rest is right', () => {
    expect(only(typed(['@Path(Paths.ROOT)'], ['  @GET @Path("x") public String m() { return null; }']))).toEqual(['nonLiteral']);
    expect(only(typed(['@Path("/s")'], ['  @GET @Path(Paths.X) public String m() { return null; }']))).toEqual(['nonLiteral']);
  });

  it('every site has exactly one fate: the buckets of a mixed file add up to its sites', () => {
    const p = typed(['@Path("/s")'], [
      '  @GET public String endpoint() { return null; }',
      '  @GET private String hidden() { return null; }',
      '  @Path("l") public Object locator() { return null; }',
      '  @GET @POST public String both() { return null; }',
      '  @GET @Path(Paths.X) public String constant() { return null; }',
      '  static class Inner { @GET public String nested() { return null; } }',
    ]);
    expect(p.buckets).toEqual({ nested: 1, client: 0, handlerUnindexed: 0, nonPublic: 1, conflict: 1, noVerb: 1, noRoot: 0, nonLiteral: 1, endpoint: 1 });
    expect(p.family.sites).toBe(6);
    expect(Object.values(p.buckets).reduce((a, b) => a + b, 0)).toBe(p.family.sites);
  });
});

// ---------------------------------------------------------------------------
// Evidence (design D8), coverage and gaps (D9)
// ---------------------------------------------------------------------------

describe('the evidence of a routes edge (design D8)', () => {
  const path = SRC('OrderResource');

  it('cites the verb, the method path and the class path, each by the line it is written on, with the spelling and the value read', () => {
    const p = orders(['  @GET', '  @Path("{id}")', '  public String find() { return null; }']);
    const [edge] = p.result.edges;
    expect(edge.evidence).toEqual([
      { file: path, line: p.lineOf(path, '@Path("/orders/")'), source: 'tree-sitter', token: 'Path', role: 'root-path', value: '/orders/' },
      { file: path, line: p.lineOf(path, '@GET'), source: 'tree-sitter', token: 'GET', role: 'verb' },
      { file: path, line: p.lineOf(path, '@Path("{id}")'), source: 'tree-sitter', token: 'Path', role: 'method-path', value: '{id}' },
    ]);
    // every line holds its token, and a path line holds the value
    for (const entry of edge.evidence) {
      const text = p.texts[path].split('\n')[entry.line - 1];
      expect(text).toContain(entry.token);
      if (entry.value !== undefined) expect(text).toContain(entry.value);
    }
  });

  it('has no method path entry when the method writes none, and no value on a verb', () => {
    const p = orders(['  @POST', '  public void create() {}']);
    const roles = p.result.edges[0].evidence.map((e) => e.role);
    expect(roles).toEqual(['root-path', 'verb']);
    expect('value' in p.result.edges[0].evidence[1]).toBe(false);
  });

  it('writes the token as the line writes it: a qualified name stays qualified', () => {
    const q = orders(['  @javax.ws.rs.GET', '  @javax.ws.rs.Path("x")', '  public String m() { return null; }'], '@jakarta.ws.rs.Path("/q")');
    expect(q.result.edges[0].evidence.map((e) => [e.role, e.token])).toEqual([
      ['root-path', 'jakarta.ws.rs.Path'], ['verb', 'javax.ws.rs.GET'], ['method-path', 'javax.ws.rs.Path'],
    ]);
  });

  it('puts the verb and the method path in the order of the file, and the same line once per role', () => {
    // the verb and the method path on one line: two entries, one per role, in the order of the roles
    const p = orders(['  @GET @Path("x") public String m() { return null; }']);
    const lineOfMethod = p.lineOf(path, '@GET');
    expect(p.result.edges[0].evidence.filter((e) => e.line === lineOfMethod).map((e) => e.role)).toEqual(['method-path', 'verb']);
  });

  it('keeps the value as written, whitespace and slashes included: it is what the annotation says', () => {
    const p = orders(['  @GET', '  @Path("/ {x} /")', '  public String m() { return null; }']);
    expect(p.result.edges[0].evidence.find((e) => e.role === 'method-path').value).toBe('/ {x} /');
  });

  it('gives each handler its own evidence when two methods share a route', () => {
    const p = orders(['  @GET @Path("a") public String one() { return null; }', '', '  @GET @Path("a") public String two() { return null; }']);
    const [one, two] = p.result.edges;
    expect(one.evidence.find((e) => e.role === 'verb').line).toBe(p.lineOf(path, '@GET', 0));
    expect(two.evidence.find((e) => e.role === 'verb').line).toBe(p.lineOf(path, '@GET', 1));
  });
});

describe('the evidence of the contains edge to the endpoint (design D8)', () => {
  const path = SRC('OrderResource');

  it('is the line of the verb annotation of the first handler, with the spelling', () => {
    const p = orders([
      '  @GET', '  @Path("{id}")', '  public String json() { return null; }',
      '',
      '  @GET', '  @Path("{id}")', '  public String text() { return null; }',
    ]);
    expect(p.result.endpoints[0].evidence).toEqual([{ file: path, line: p.lineOf(path, '@GET', 0), source: 'tree-sitter', token: 'GET' }]);
  });

  it('writes the spelling of that handler when a qualified verb is written', () => {
    const p = orders(['  @javax.ws.rs.DELETE', '  public void remove() {}']);
    expect(p.result.endpoints[0].evidence).toEqual([{ file: path, line: p.lineOf(path, '@javax.ws.rs.DELETE'), source: 'tree-sitter', token: 'javax.ws.rs.DELETE' }]);
  });
});

describe('coverage, gaps and conservation (design D9)', () => {
  it('counts the sites, the nine buckets, the endpoints and the edges of the family, and the unconfirmed spellings', () => {
    const p = project({
      java: Object.fromEntries([
        resource('Mixed', [
          '@Path("/m")', 'public class Mixed {',
          '  @GET public String a() { return null; }',
          '  @GET @Path("b") public String b() { return null; }',
          '  @GET @Path("b") public String c() { return null; }',
          '  @Path("l") public Object l() { return null; }',
          '}',
        ]),
        resource('Amb', ['public class Amb {', '  @PUT public void p() {}', '}'], { imports: [RS, JRS] }),
      ]),
    });
    expect(p.coverage).toEqual({
      status: 'ran',
      families: {
        jaxrs: {
          sites: 4,
          buckets: { nested: 0, client: 0, handlerUnindexed: 0, nonPublic: 0, conflict: 0, noVerb: 1, noRoot: 0, nonLiteral: 0, endpoint: 3 },
          endpoints: 2,
          edges: 3,
        },
      },
      unconfirmed: { PUT: 1 },
    });
  });

  it('has an entry for every family of the catalog, with every bucket, also when nothing is a site', () => {
    const p = project({ java: Object.fromEntries([['app/src/Plain.java', 'package app.src;\n\npublic class Plain {\n}\n']]) });
    expect(p.coverage).toEqual({
      status: 'ran',
      families: { jaxrs: { sites: 0, buckets: Object.fromEntries(ROUTE_BUCKETS.map((bucket) => [bucket, 0])), endpoints: 0, edges: 0 } },
      unconfirmed: {},
    });
    expect(p.result).toMatchObject({ endpoints: [], edges: [], gaps: [] });
    expect(project({ java: {} }).coverage.families.jaxrs.sites).toBe(0);
  });

  it('records one gap occurrence per site in a gap bucket, with the family as scope and `<file>:<line> <Owner>.<method>` as sample', () => {
    const path = SRC('Gappy');
    const p = project({
      java: Object.fromEntries([resource('Gappy', [
        '@Path("/g")', 'public class Gappy {',
        '  @GET @POST public String both() { return null; }',
        '  @Path("l") public Object locator() { return null; }',
        '  @GET @Path(Paths.X) public String constant() { return null; }',
        '  static class In { @GET public String nested() { return null; } }',
        '  @GET private String hidden() { return null; }',
        '}',
        'class NoRoot {', '  @GET public String m() { return null; }', '}',
      ])]),
    });
    expect(p.result.gaps).toEqual([
      { kind: 'route-verb-unresolved', scope: 'jaxrs', sample: `${path}:${p.lineOf(path, 'both')} Gappy.both` },
      { kind: 'route-verb-unresolved', scope: 'jaxrs', sample: `${path}:${p.lineOf(path, 'locator')} Gappy.locator` },
      { kind: 'route-path-unresolved', scope: 'jaxrs', sample: `${path}:${p.lineOf(path, 'constant')} Gappy.constant` },
      { kind: 'route-handler-unresolved', scope: 'jaxrs', sample: `${path}:${p.lineOf(path, 'nested')} Gappy.nested` },
      { kind: 'route-root-unresolved', scope: 'jaxrs', sample: `${path}:${p.lineOf(path, 'public String m')} NoRoot.m` },
    ]);
    expect(p.buckets).toMatchObject({ conflict: 1, noVerb: 1, nonLiteral: 1, nested: 1, nonPublic: 1, noRoot: 1, endpoint: 0 });
  });

  it('uses the line of the method\'s name for a method whose annotations span several lines', () => {
    const path = SRC('Gappy');
    const p = project({
      java: Object.fromEntries([resource('Gappy', ['public class Gappy {', '  @GET', '  @Produces("a")', '  public String m() { return null; }', '}'])]),
    });
    expect(p.result.gaps).toEqual([{ kind: 'route-root-unresolved', scope: 'jaxrs', sample: `${path}:${p.lineOf(path, 'public String m')} Gappy.m` }]);
  });

  it('is balanced: the check passes for the counts a run has, read back from its own results', () => {
    const p = project({
      java: Object.fromEntries([resource('Gappy', [
        '@Path("/g")', 'public class Gappy {',
        '  @GET public String ok() { return null; }',
        '  @GET @POST public String both() { return null; }',
        '  @Path("l") public Object locator() { return null; }',
        '  @GET @Path(Paths.X) public String constant() { return null; }',
        '  static class In { @GET public String nested() { return null; } }',
        '}',
      ])]),
    });
    const recorded = { edges: { jaxrs: p.result.edges.length }, gaps: { jaxrs: {} } };
    for (const gap of p.result.gaps) recorded.gaps.jaxrs[gap.kind] = (recorded.gaps.jaxrs[gap.kind] ?? 0) + 1;
    expect(() => assertRouteConservation(p.coverage, recorded)).not.toThrow();
    expect(recorded.gaps.jaxrs).toEqual({ 'route-verb-unresolved': 2, 'route-path-unresolved': 1, 'route-handler-unresolved': 1 });
  });

  describe('fails when the counts do not balance, naming the family (spec: unbalanced conservation)', () => {
    const balanced = () => {
      const p = orders(['  @GET public String a() { return null; }', '  @GET @Path("b") public String b() { return null; }', '  @Path("c") public Object c() { return null; }']);
      return { coverage: structuredClone(p.coverage), recorded: { edges: { jaxrs: 2 }, gaps: { jaxrs: { 'route-verb-unresolved': 1 } } } };
    };

    it('starts balanced', () => {
      const { coverage, recorded } = balanced();
      expect(() => assertRouteConservation(coverage, recorded)).not.toThrow();
    });

    it('fails when the buckets do not add up to the sites, in either direction', () => {
      const up = balanced();
      up.coverage.families.jaxrs.sites += 1;
      expect(() => assertRouteConservation(up.coverage, up.recorded)).toThrow('route-resolution: family "jaxrs": 4 route site(s) but 3 outcome(s)');
      const down = balanced();
      down.coverage.families.jaxrs.buckets.noRoot += 1;
      expect(() => assertRouteConservation(down.coverage, down.recorded)).toThrow('route-resolution: family "jaxrs": 3 route site(s) but 4 outcome(s)');
    });

    it('fails when the sites that became endpoints are not the edges drawn', () => {
      const { coverage, recorded } = balanced();
      coverage.families.jaxrs.edges += 1;
      expect(() => assertRouteConservation(coverage, recorded)).toThrow('route-resolution: family "jaxrs": 2 site(s) became an endpoint but 3 routes edge(s) were drawn');
    });

    it('fails when the graph has more or fewer routes edges than the run drew', () => {
      const less = balanced();
      less.recorded.edges.jaxrs = 1;
      expect(() => assertRouteConservation(less.coverage, less.recorded)).toThrow('route-resolution: family "jaxrs": 2 routes edge(s) drawn but 1 in the graph');
      const none = balanced();
      none.recorded.edges = {};
      expect(() => assertRouteConservation(none.coverage, none.recorded)).toThrow('route-resolution: family "jaxrs": 2 routes edge(s) drawn but 0 in the graph');
    });

    it.each([
      ['route-handler-unresolved', 'nested'],
      ['route-handler-unresolved', 'handlerUnindexed'],
      ['route-verb-unresolved', 'conflict'],
      ['route-root-unresolved', 'noRoot'],
      ['route-path-unresolved', 'nonLiteral'],
    ])('fails when the gaps of %s do not add up to the buckets behind it (%s)', (kind, bucket) => {
      const { coverage, recorded } = balanced();
      // one more site in the bucket and one more outcome taken from the endpoints: the sum of the buckets still is the sites
      coverage.families.jaxrs.buckets[bucket] += 1;
      coverage.families.jaxrs.sites += 1;
      expect(() => assertRouteConservation(coverage, recorded)).toThrow(new RegExp(`family "jaxrs": \\d+ ${kind} outcome\\(s\\) but \\d+ recorded gap occurrence\\(s\\)`));
    });

    it('fails when a gap is recorded for a bucket that is no gap, or lost', () => {
      const extra = balanced();
      extra.recorded.gaps.jaxrs['route-verb-unresolved'] = 2;
      expect(() => assertRouteConservation(extra.coverage, extra.recorded)).toThrow('route-resolution: family "jaxrs": 1 route-verb-unresolved outcome(s) but 2 recorded gap occurrence(s)');
      const lost = balanced();
      lost.recorded.gaps = {};
      expect(() => assertRouteConservation(lost.coverage, lost.recorded)).toThrow('route-resolution: family "jaxrs": 1 route-verb-unresolved outcome(s) but 0 recorded gap occurrence(s)');
    });

    it('reads each family by itself', () => {
      const { coverage, recorded } = balanced();
      coverage.families.other = { sites: 0, buckets: Object.fromEntries(ROUTE_BUCKETS.map((bucket) => [bucket, 0])), endpoints: 0, edges: 0 };
      expect(() => assertRouteConservation(coverage, recorded)).not.toThrow();
      recorded.gaps.other = { 'route-root-unresolved': 1 };
      expect(() => assertRouteConservation(coverage, recorded)).toThrow('family "other": 0 route-root-unresolved outcome(s) but 1 recorded gap occurrence(s)');
    });
  });
});

describe('what resolveRoutes asks of its inputs', () => {
  it('throws for a row that has types and no memberAnnotations: it is an older extraction\'s', () => {
    const p = orders(['  @GET public String a() { return null; }']);
    const rows = p.javaRows.map(({ memberAnnotations, ...row }) => row);
    expect(() => p.run(rows)).toThrow(/route-resolution: the structure row of app\/src\/com\/acme\/rest\/OrderResource\.java has no memberAnnotations/);
  });

  it('skips a row that has neither types nor memberAnnotations: a file the extraction could not read', () => {
    const p = orders(['  @GET public String a() { return null; }']);
    const run = p.run([{ path: 'app/Broken.java', language: 'java' }, ...p.javaRows]);
    expect(run.coverage.families.jaxrs.sites).toBe(1);
  });

  it('is pure: it changes none of its inputs, and the same inputs give the same result', () => {
    const p = orders(['  @GET @Path("{id}") public String find() { return null; }', '  @POST public void create() {}']);
    const before = structuredClone(p.javaRows);
    const again = p.run(p.javaRows);
    expect(p.javaRows).toEqual(before);
    expect(again.endpoints.map((e) => e.route)).toEqual(p.result.endpoints.map((e) => e.route));
    expect(again.coverage).toEqual(p.result.coverage);
    expect(again.gaps).toEqual(p.result.gaps);
  });

  it('puts the endpoints in the order of the rows, then of the source', () => {
    const p = project({
      java: Object.fromEntries([
        resource('Second', ['@Path("/s")', 'public class Second {', '  @GET public String b() { return null; }', '  @POST public String a() { return null; }', '}']),
        resource('First', ['@Path("/f")', 'public class First {', '  @PUT public String c() { return null; }', '}']),
      ]),
    });
    // the rows are in the order given
    expect(p.endpoints).toEqual(['GET /s [Second]', 'POST /s [Second]', 'PUT /f [First]']);
  });

  it('reads every family of the catalog: a second family with its own annotations has its own coverage and scope', () => {
    const catalog = JSON.parse(JSON.stringify(CATALOG));
    catalog.routeFamilies.push({
      id: 'acme',
      basis: 'A test family: Acme routes are written Mapping("/x") and Fetch on a method.',
      rootPath: { annotations: ['com.acme.web.Mapping'], argument: 'path' },
      methodPath: { annotations: ['com.acme.web.Mapping'], argument: 'path' },
      verbs: [{ verb: 'FETCH', annotations: ['com.acme.web.Fetch'] }],
      clientAnnotations: [],
      publicOnly: false,
    });
    const p = project({
      catalog: parseRouteCatalog(catalog),
      java: {
        ...Object.fromEntries([resource('Plain', ['@Path("/p")', 'public class Plain {', '  @GET public String m() { return null; }', '}'])]),
        ...Object.fromEntries([resource('Acme', ['@Mapping(path = "/a/")', 'class Acme {', '  @Fetch @Mapping(path = "{id}") String m() { return null; }', '  @Fetch String hidden() { return null; }', '}'], { imports: ['import com.acme.web.Mapping;', 'import com.acme.web.Fetch;'] })]),
      },
    });
    expect(p.endpoints).toEqual(['GET /p [Plain]', 'FETCH /a/{id} [Acme]', 'FETCH /a [Acme]']);
    expect(p.coverage.families.jaxrs).toMatchObject({ sites: 1, endpoints: 1, edges: 1 });
    expect(p.coverage.families.acme).toMatchObject({ sites: 2, endpoints: 2, edges: 2 });
    expect(p.result.endpoints.map((e) => e.family)).toEqual(['jaxrs', 'acme', 'acme']);
  });
});

// ---------------------------------------------------------------------------
// The resolution holds no framework knowledge (design D3, D4)
// ---------------------------------------------------------------------------

describe('route-resolution.mjs holds no framework knowledge', () => {
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../skills/excavator/route-resolution.mjs'), 'utf-8');

  it('names no framework, no namespace, no annotation and no verb: all of that is the catalog\'s', () => {
    for (const word of [/jax-?rs/i, /javax/i, /jakarta/i, /microprofile/i, /spring/i, /\bws\.rs\b/, /@Path\b/, /@GET\b/, /\bGET\b/, /\bPOST\b/, /\bPUT\b/, /\bDELETE\b/, /\bPATCH\b/, /\bHEAD\b/, /\bOPTIONS\b/]) {
      expect(source, String(word)).not.toMatch(word);
    }
  });
});

// ---------------------------------------------------------------------------
// Mutation tripwires (design D11)
// ---------------------------------------------------------------------------

describe('mutation tripwires (design D11)', () => {
  it('simpleNameAnnotations: a type the package declares itself, or a name no import settles, is taken for the catalog\'s', () => {
    const own = {
      java: Object.fromEntries([resource('Mine', ['@Path("/x")', 'public class Mine {', '  @GET public String m() { return null; }', '}'])]),
      declaredTypes: ['com.acme.rest.GET'],
    };
    expect(project(own).family.sites).toBe(0);
    const mutated = project({ ...own, mutations: { simpleNameAnnotations: true } });
    expect(mutated.family.sites).toBe(1);
    expect(mutated.endpoints).toEqual(['GET /x [Mine]']);

    const twice = { java: Object.fromEntries([resource('Both', ['@Path("/b")', 'public class Both {', '  @GET public String m() { return null; }', '}'], { imports: [RS, JRS] })]) };
    expect(project(twice).coverage).toMatchObject({ unconfirmed: { GET: 1, Path: 1 } });
    expect(project(twice).family.sites).toBe(0);
    const taken = project({ ...twice, mutations: { simpleNameAnnotations: true } });
    expect(taken.coverage.unconfirmed).toEqual({});
    expect(taken.endpoints).toEqual(['GET /b [Both]']);
  });

  it('noSlashTrim: the slashes at the ends of the values stay, and the route has doubled and trailing slashes', () => {
    const methods = ['  @GET', '  @Path("{id}/")', '  public String find() { return null; }'];
    expect(orders(methods).endpoints).toEqual(['GET /orders/{id} [OrderResource]']);
    const mutated = project({
      mutations: { noSlashTrim: true },
      java: Object.fromEntries([resource('OrderResource', ['@Path("/orders/")', 'public class OrderResource {', ...methods, '}'])]),
    });
    expect(mutated.endpoints).toEqual(['GET //orders//{id}/ [OrderResource]']);
  });

  it('rootFromMethod: a type with no root path has an empty one, and the method path stands alone', () => {
    const java = Object.fromEntries([resource('ItemsResource', ['public class ItemsResource {', '  @GET @Path("list") public String list() { return null; }', '  @GET public String all() { return null; }', '}'])]);
    const plain = project({ java });
    expect(plain.buckets).toMatchObject({ noRoot: 2, endpoint: 0 });
    const mutated = project({ java, mutations: { rootFromMethod: true } });
    expect(mutated.endpoints).toEqual(['GET /list [ItemsResource]', 'GET / [ItemsResource]']);
    expect(mutated.buckets).toMatchObject({ noRoot: 0, endpoint: 2 });
    // no root path entry in the evidence: there is none to cite
    expect(mutated.result.edges[0].evidence.map((e) => e.role)).toEqual(['method-path', 'verb']);
  });

  it('firstVerb: of several verbs the first written is the verb', () => {
    const java = Object.fromEntries([resource('OrderResource', ['@Path("/o")', 'public class OrderResource {', '  @POST @GET public String both() { return null; }', '}'])]);
    expect(project({ java }).buckets).toMatchObject({ conflict: 1, endpoint: 0 });
    const mutated = project({ java, mutations: { firstVerb: true } });
    expect(mutated.endpoints).toEqual(['POST /o [OrderResource]']);
    expect(mutated.buckets).toMatchObject({ conflict: 0, endpoint: 1 });
    expect(mutated.result.edges[0].evidence.filter((e) => e.role === 'verb').map((e) => e.token)).toEqual(['POST']);
  });

  it('containsWithoutToken: the contains edge to the endpoint cites its line without saying what is on it', () => {
    const p = orders(['  @GET', '  public String find() { return null; }']);
    expect(p.result.endpoints[0].evidence[0]).toHaveProperty('token', 'GET');
    const mutated = project({
      mutations: { containsWithoutToken: true },
      java: Object.fromEntries([resource('OrderResource', ['@Path("/orders/")', 'public class OrderResource {', '  @GET', '  public String find() { return null; }', '}'])]),
    });
    expect(mutated.result.endpoints[0].evidence).toEqual([{ file: SRC('OrderResource'), line: p.lineOf(SRC('OrderResource'), '@GET'), source: 'tree-sitter' }]);
    // the routes edge is untouched
    expect(mutated.result.edges[0].evidence.every((e) => typeof e.token === 'string')).toBe(true);
  });

  it('has every switch off by default: no mutations and empty mutations are the same run', () => {
    const methods = ['  @GET @Path("{id}/") public String find() { return null; }', '  @GET @POST public String both() { return null; }', '  @Path("l") public Object l() { return null; }'];
    const spec = { java: Object.fromEntries([resource('OrderResource', ['@Path("/orders/")', 'public class OrderResource {', ...methods, '}'])] ) };
    const a = project(spec);
    const b = project({ ...spec, mutations: {} });
    expect(b.result.coverage).toEqual(a.result.coverage);
    expect(b.result.gaps).toEqual(a.result.gaps);
    expect(b.result.endpoints.map(({ route, evidence }) => [route, evidence])).toEqual(a.result.endpoints.map(({ route, evidence }) => [route, evidence]));
    expect(b.result.edges.map(({ target, evidence }) => [target, evidence])).toEqual(a.result.edges.map(({ target, evidence }) => [target, evidence]));
  });
});
