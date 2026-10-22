// jaxrs-route-facts, tasks 3.1, 3.3 and 3.4: Java routes in the real Lazy driver -
// the `endpoint` nodes, the `contains` edges to them, the `routes` edges to the
// handlers, the visible buckets, the gaps and the coverage section - and what
// reads them: the graph validator, the traversal, the project service and the MCP
// server. The fixture is the `orders-rest` module of the purpose-built synthetic
// project tests/fixtures/javaee-jsf-app: a resource with a class path written with
// slashes at both ends, templates and regular-expression templates, two methods
// that share a route, a private handler, a method with two HTTP methods, a locator
// of a sub-resource and its resource class, a path constant, a handler in a nested
// class, an interface with a path and its implementation, a client interface, the
// jakarta namespace by an on-demand import, annotations written qualified, a
// same-package type that shadows an imported annotation, two on-demand imports
// that both provide one, and the same class name in two packages. It is copied to
// a temp directory because a Lazy run writes `.excavator/` next to the source.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { auditGraphShape } from '@excavator/core';

import { PIPELINE_VERSION, runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { buildFactGraph } from '../../skills/excavator/build-fact-graph.mjs';
import { createProjectService } from '../../skills/excavator/project-service.mjs';
import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraph, writeKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';
import { readStructureAll } from '../../skills/excavator/structure-all-store.mjs';
import { loadNameBindingCatalog } from '../../skills/excavator/name-binding-catalog.mjs';
import { collectNameReferenceSites } from '../../skills/excavator/name-reference-sites.mjs';
import { collectMentionSites } from '../../skills/excavator/mention-sites.mjs';
import { loadRouteCatalog, parseRouteCatalog } from '../../skills/excavator/route-catalog.mjs';
import { loadTypeInjectionCatalog } from '../../skills/excavator/type-injection-catalog.mjs';
import { ROUTE_BUCKETS, ROUTE_GAP_KINDS } from '../../skills/excavator/route-resolution.mjs';
import { createSourceReader, validateAgainstSource } from '../../skills/excavator/validate-graph.mjs';
import { DETERMINISTIC_EDGE_TYPES, boundedBFS, oneHop } from '../../skills/excavator/retrieve.mjs';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/javaee-jsf-app');
const SERVER_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../skills/excavator/mcp-server.mjs');
const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';

const copyFixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'excavator-route-facts-'));
  cpSync(FIXTURE, root, { recursive: true });
  return root;
};
const readProduct = (root) => readKnowledgeGraph(join(root, '.excavator', KNOWLEDGE_GRAPH_FILE));

/**
 * The inputs buildFactGraph was given by a run of the driver on `root`, read back from its intermediate products. The driver also
 * gives it the type injection catalog (openspec: changes/by-type-injection), so these do: the graphs these tests build without
 * the route stage still have the by-type edges the product has, and the comparisons stay about the routes.
 */
function inputsOfRun(root) {
  const intermediate = join(root, '.excavator', 'intermediate');
  const scan = JSON.parse(readFileSync(join(intermediate, 'scan-result.json'), 'utf-8'));
  const structureAll = readStructureAll(join(intermediate, 'structure-all.jsonl'));
  const importMap = JSON.parse(readFileSync(join(intermediate, 'import-map.json'), 'utf-8'));
  const readFile = (path) => readFileSync(join(root, path), 'utf-8');
  const catalog = loadNameBindingCatalog();
  const mention = collectMentionSites({ scan, structureAll, readFile });
  return {
    scan, structureAll, importMap, mentionSites: mention.sites, mentionInputs: mention.inputs,
    nameReferenceSites: collectNameReferenceSites({ scan, catalog, readFile }), nameBindingCatalog: catalog,
    typeInjectionCatalog: loadTypeInjectionCatalog(),
  };
}

const R = 'orders-rest/src/main/java/com/acme/orders/rest';
const ORDER = `${R}/OrderResource.java`;
const V1 = `${R}/v1/OrderResource.java`;
const API = `${R}/OrderApi.java`;
const FEED = `${R}/ItemFeedResource.java`;
const QUALIFIED = `${R}/QualifiedResource.java`;
const ITEM = `${R}/ItemResource.java`;

/**
 * Every endpoint of the fixture, in the order of the node ids: the node (route,
 * owner, file, line range) and, per handler, the entries of the routes edge as
 * `[line, role, token, value?]`, and the line and token the contains edge cites.
 */
const ENDPOINTS = [
  {
    route: 'DELETE /items/{id}', owner: 'ItemFeedResource', file: FEED, range: [13, 16], contains: [13, 'DELETE'],
    handlers: { remove: [[5, 'root-path', 'Path', 'items'], [13, 'verb', 'DELETE'], [14, 'method-path', 'Path', '{id}']] },
  },
  {
    route: 'GET /items', owner: 'ItemFeedResource', file: FEED, range: [8, 11], contains: [8, 'GET'],
    handlers: { feed: [[5, 'root-path', 'Path', 'items'], [8, 'verb', 'GET']] },
  },
  {
    route: 'GET /v2/orders', owner: 'OrderApi', file: API, range: [10, 11], contains: [10, 'GET'],
    handlers: { list: [[7, 'root-path', 'Path', '/v2/orders'], [10, 'verb', 'GET']] },
  },
  {
    route: 'POST /v2/orders', owner: 'OrderApi', file: API, range: [13, 14], contains: [13, 'POST'],
    handlers: { create: [[7, 'root-path', 'Path', '/v2/orders'], [13, 'verb', 'POST']] },
  },
  {
    route: 'DELETE /orders/{id}', owner: 'OrderResource', file: ORDER, range: [44, 47], contains: [44, 'DELETE'],
    handlers: { remove: [[6, 'root-path', 'Path', '/orders/'], [44, 'verb', 'DELETE'], [45, 'method-path', 'Path', '/{id}/']] },
  },
  {
    route: 'GET /orders', owner: 'OrderResource', file: ORDER, range: [9, 12], contains: [9, 'GET'],
    handlers: { list: [[6, 'root-path', 'Path', '/orders/'], [9, 'verb', 'GET']] },
  },
  {
    route: 'GET /orders/files/{path: .+/[^/]*}', owner: 'OrderResource', file: ORDER, range: [34, 38], contains: [34, 'GET'],
    handlers: { file: [[6, 'root-path', 'Path', '/orders/'], [34, 'verb', 'GET'], [35, 'method-path', 'Path', '/files/{path: .+/[^/]*}/']] },
  },
  {
    route: 'GET /orders/{code: [A-Z]{3}-[0-9]+}', owner: 'OrderResource', file: ORDER, range: [28, 32], contains: [28, 'GET'],
    handlers: { byCode: [[6, 'root-path', 'Path', '/orders/'], [28, 'verb', 'GET'], [29, 'method-path', 'Path', '{code: [A-Z]{3}-[0-9]+}/']] },
  },
  {
    route: 'GET /orders/{id}', owner: 'OrderResource', file: ORDER, range: [14, 19], contains: [14, 'GET'],
    handlers: {
      findJson: [[6, 'root-path', 'Path', '/orders/'], [14, 'verb', 'GET'], [15, 'method-path', 'Path', '{id}']],
      findText: [[6, 'root-path', 'Path', '/orders/'], [21, 'verb', 'GET'], [22, 'method-path', 'Path', '{id}']],
    },
  },
  {
    route: 'POST /orders', owner: 'OrderResource', file: ORDER, range: [40, 42], contains: [40, 'POST'],
    handlers: { create: [[6, 'root-path', 'Path', '/orders/'], [40, 'verb', 'POST']] },
  },
  {
    route: 'PUT /qualified/{id}', owner: 'QualifiedResource', file: QUALIFIED, range: [6, 9], contains: [6, 'javax.ws.rs.PUT'],
    handlers: { replace: [[3, 'root-path', 'javax.ws.rs.Path', '/qualified'], [6, 'verb', 'javax.ws.rs.PUT'], [7, 'method-path', 'javax.ws.rs.Path', '{id}']] },
  },
  {
    route: 'GET /orders', owner: 'OrderResource', file: V1, range: [9, 12], contains: [9, 'GET'],
    handlers: { list: [[6, 'root-path', 'Path', '/orders'], [9, 'verb', 'GET']] },
  },
];

describe('the route stage in the real Lazy driver (tasks 3.1 and 3.3)', () => {
  let root;
  let result;
  let graph;
  let byId;
  beforeAll(async () => {
    root = copyFixture();
    result = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    graph = readProduct(root);
    byId = new Map(graph.nodes.map((n) => [n.id, n]));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const linesOf = (file) => readFileSync(join(root, file), 'utf-8').split('\n');
  const endpointNodes = () => graph.nodes.filter((n) => n.type === 'endpoint');
  const routesEdges = () => graph.edges.filter((e) => e.type === 'routes');
  const containsEndpoint = () => graph.edges.filter((e) => e.type === 'contains' && byId.get(e.target).type === 'endpoint');
  const handlerOf = (edge) => `${byId.get(edge.target).owner}.${byId.get(edge.target).name}`;

  it('stamps the product with the new pipeline version, and keeps the detected frameworks', () => {
    expect(result.saveError).toBeNull();
    expect(PIPELINE_VERSION).toBe('lazy-fact-graph/14');
    expect(graph.project.pipelineVersion).toBe('lazy-fact-graph/14');
    expect(graph.project.frameworks).toEqual(['javaee', 'jsf']);
  });

  it('has exactly the endpoints of the list: name, owner, file and line range, with the id the identity function derives', () => {
    expect(endpointNodes().map((n) => n.id)).toEqual(ENDPOINTS.map((e) => `endpoint:${e.file}:${e.owner}#${e.route}`));
    expect(endpointNodes().map((n) => ({ name: n.name, owner: n.owner, filePath: n.filePath, lineRange: n.lineRange }))).toEqual(
      ENDPOINTS.map((e) => ({ name: e.route, owner: e.owner, filePath: e.file, lineRange: e.range })),
    );
    for (const node of endpointNodes()) expect(node).toMatchObject({ type: 'endpoint', anchorSource: 'rule', summary: '', tags: [] });
    expect(endpointNodes()).toHaveLength(12);
  });

  it('anchors each endpoint on its first handler: the line range starts at the first annotation of that handler', () => {
    for (const endpoint of ENDPOINTS) {
      const text = linesOf(endpoint.file);
      expect(text[endpoint.range[0] - 1], endpoint.route).toMatch(/@(?:javax\.ws\.rs\.)?(GET|POST|PUT|DELETE)\b/);
      expect(text[endpoint.range[1] - 1].trim(), endpoint.route).toMatch(/^(\}|String .*;|void .*;)$/);
    }
  });

  it('draws exactly the routes edges of the list: from the endpoint to each handler, with the cited lines, tokens, roles and values', () => {
    const expected = ENDPOINTS.flatMap((e) => Object.entries(e.handlers).map(([handler, evidence]) => ({
      from: `endpoint:${e.file}:${e.owner}#${e.route}`, handler: `${e.owner}.${handler}`, file: e.file,
      evidence: evidence.map(([line, role, token, value]) => ({ file: e.file, line, source: 'tree-sitter', token, role, ...(value === undefined ? {} : { value }) })),
    })));
    expect(routesEdges()).toHaveLength(13);
    expect(routesEdges().map((e) => ({ from: e.source, handler: handlerOf(e), file: byId.get(e.target).filePath, evidence: e.evidence })).sort((a, b) => (a.from + a.handler < b.from + b.handler ? -1 : 1)))
      .toEqual(expected.sort((a, b) => (a.from + a.handler < b.from + b.handler ? -1 : 1)));
    for (const edge of routesEdges()) {
      expect(edge).toMatchObject({ type: 'routes', direction: 'forward', weight: 0.5, provenance: 'extracted' });
      expect(byId.get(edge.target).type).toBe('function');
    }
  });

  it('draws the two handlers of a shared route as two edges of one endpoint, and the interface route to the interface method', () => {
    const shared = routesEdges().filter((e) => byId.get(e.source).name === 'GET /orders/{id}' && byId.get(e.source).filePath === ORDER);
    expect(shared.map(handlerOf).sort()).toEqual(['OrderResource.findJson', 'OrderResource.findText']);
    expect(new Set(shared.map((e) => e.source)).size).toBe(1);
    const apiEdges = routesEdges().filter((e) => byId.get(e.source).filePath === API);
    expect(apiEdges.map((e) => byId.get(e.target).filePath)).toEqual([API, API]);
    // the implementation writes no annotation: no endpoint, no routes edge to it
    expect(routesEdges().some((e) => byId.get(e.target).filePath === `${R}/OrderApiImpl.java`)).toBe(false);
  });

  it('draws the contains edge from the file to each endpoint, citing the line and the spelling of the verb annotation of its first handler', () => {
    expect(containsEndpoint()).toHaveLength(12);
    const expected = ENDPOINTS.map((e) => ({
      from: `file:${e.file}`, to: `endpoint:${e.file}:${e.owner}#${e.route}`, evidence: [{ file: e.file, line: e.contains[0], source: 'tree-sitter', token: e.contains[1] }],
    }));
    expect(containsEndpoint().map((e) => ({ from: e.source, to: e.target, evidence: e.evidence })).sort((a, b) => (a.to < b.to ? -1 : 1)))
      .toEqual(expected.sort((a, b) => (a.to < b.to ? -1 : 1)));
    for (const edge of containsEndpoint()) expect(edge).toMatchObject({ type: 'contains', direction: 'forward', weight: 1, provenance: 'extracted' });
  });

  it('is checkable: every cited line holds its token, a path line holds the value it reads, and a verb token is a verb', () => {
    let checked = 0;
    for (const edge of [...routesEdges(), ...containsEndpoint()]) {
      for (const evidence of edge.evidence) {
        const text = linesOf(evidence.file)[evidence.line - 1];
        expect(text, `${evidence.file}:${evidence.line}`).toContain(evidence.token);
        if (evidence.value !== undefined) expect(text, `${evidence.file}:${evidence.line}`).toContain(evidence.value);
        if (evidence.role === 'verb') expect(evidence.token).toMatch(/^(?:javax\.ws\.rs\.)?(?:GET|POST|PUT|DELETE)$/);
        checked += 1;
      }
    }
    // the 13 routes edges cite 33 lines between them (a verb, a class path and, for 7 of them, a method path), and the 12 contains edges one each
    expect(checked).toBe(33 + 12);
  });

  it('counts every route site of the fixture in one of the nine buckets, and says what no catalog annotation shares a name with', () => {
    expect(graph.coverage.routes).toEqual({
      status: 'ran',
      families: {
        jaxrs: {
          sites: 21,
          buckets: { nested: 1, client: 1, handlerUnindexed: 0, nonPublic: 1, conflict: 1, noVerb: 1, noRoot: 2, nonLiteral: 1, endpoint: 13 },
          endpoints: 12,
          edges: 13,
        },
      },
      // the file that imports both namespaces; the annotation type of the same package is not counted at all
      unconfirmed: { GET: 1, Path: 1 },
    });
    const { buckets } = graph.coverage.routes.families.jaxrs;
    expect(Object.keys(buckets)).toEqual([...ROUTE_BUCKETS]);
    expect(Object.values(buckets).reduce((a, b) => a + b, 0)).toBe(21);
    expect(result.coverage.routes).toEqual(graph.coverage.routes);
  });

  it('records the gaps of the buckets that are gaps, one occurrence per site, with the file, the line and the method', () => {
    const route = graph.gaps.filter((g) => g.kind.startsWith('route-')).map((g) => ({ kind: g.kind, scope: g.scope, count: g.count, samples: g.samples }));
    expect(route).toEqual([
      { kind: 'route-handler-unresolved', scope: 'jaxrs', count: 1, samples: [`${ORDER}:75 OrderResource.summary`] },
      { kind: 'route-path-unresolved', scope: 'jaxrs', count: 1, samples: [`${ORDER}:51 OrderResource.history`] },
      { kind: 'route-root-unresolved', scope: 'jaxrs', count: 2, samples: [`${ITEM}:8 ItemResource.list`, `${ITEM}:14 ItemResource.one`] },
      { kind: 'route-verb-unresolved', scope: 'jaxrs', count: 2, samples: [`${ORDER}:58 OrderResource.sync`, `${ORDER}:62 OrderResource.items`] },
    ]);
    for (const [kind, ...buckets] of [
      ['route-handler-unresolved', 'nested', 'handlerUnindexed'], ['route-verb-unresolved', 'conflict', 'noVerb'],
      ['route-root-unresolved', 'noRoot'], ['route-path-unresolved', 'nonLiteral'],
    ]) {
      const count = graph.gaps.filter((g) => g.kind === kind).reduce((sum, g) => sum + g.count, 0);
      expect(count, kind).toBe(buckets.reduce((sum, bucket) => sum + graph.coverage.routes.families.jaxrs.buckets[bucket], 0));
      expect(buckets.every((bucket) => ROUTE_GAP_KINDS[bucket] === kind)).toBe(true);
    }
    // each sample names a line that holds the method
    for (const gap of graph.gaps.filter((g) => g.kind.startsWith('route-'))) {
      for (const sample of gap.samples) {
        const [, file, line, method] = /^(\S+):(\d+) \S+\.(\w+)$/.exec(sample);
        expect(linesOf(file)[Number(line) - 1]).toContain(`${method}(`);
      }
    }
  });

  it('records no gap, and no endpoint, for a private handler, for a client interface and for a name that a same-package type owns', () => {
    expect(linesOf(ORDER).join('\n')).toContain('private String secret()');
    expect(graph.gaps.filter((g) => g.kind.startsWith('route-')).flatMap((g) => g.samples).some((s) => s.includes('secret') || s.includes('LibraryClient') || s.includes('LegacyResource'))).toBe(false);
    expect(endpointNodes().some((n) => n.filePath.endsWith('LibraryClient.java') || n.filePath.includes('/legacy/'))).toBe(false);
    expect(graph.coverage.routes.families.jaxrs.buckets).toMatchObject({ client: 1, nonPublic: 1 });
  });

  it('keeps the same route and the same class name of two files as two endpoints with two ids', () => {
    const same = endpointNodes().filter((n) => n.name === 'GET /orders' && n.owner === 'OrderResource');
    expect(same.map((n) => n.filePath).sort()).toEqual([ORDER, V1]);
    expect(new Set(same.map((n) => n.id)).size).toBe(2);
  });

  it('keeps the route relative to the application root: the prefix of the activation class is not in any endpoint', () => {
    expect(linesOf(`${R}/OrdersApplication.java`).join('\n')).toContain('@ApplicationPath("api")');
    expect(endpointNodes().some((n) => /\/api\b/.test(n.name))).toBe(false);
  });

  it('adds nothing to the graph of the rows but the endpoints, their contains edges, the routes edges and the route gaps', () => {
    // the same run's own inputs, projected without the stage
    const inputs = inputsOfRun(root);
    const without = buildFactGraph(inputs);
    expect(without.coverage.routes).toEqual({ status: 'not-run' });
    expect(graph.nodes.filter((n) => n.type !== 'endpoint')).toEqual(without.nodes);
    expect(graph.edges.filter((e) => e.type !== 'routes' && byId.get(e.target).type !== 'endpoint')).toEqual(without.edges);
    expect(graph.gaps.filter((g) => !g.kind.startsWith('route-'))).toEqual(without.gaps);
    const { routes, ...rest } = graph.coverage;
    const { routes: notRun, ...restWithout } = without.coverage;
    expect(rest).toEqual(restWithout);
    expect(routes.status).toBe('ran');
    // the run is the same as one given the same inputs and the catalog
    const again = buildFactGraph({ ...inputs, routeCatalog: loadRouteCatalog() });
    expect(again.factsDigest).toBe(graph.project.factsDigest);
    expect(again.nodes).toEqual(graph.nodes);
    expect(again.edges.filter((e) => e.type === 'routes')).toEqual(routesEdges());
  });

  it('is not run by the standalone build-fact-graph entry, which reads only the intermediate files: the section says so and no endpoint is projected', () => {
    const out = join(root, 'standalone-fact-graph.json');
    const run = spawnSync('node', [resolve(FIXTURE, '../../../skills/excavator/build-fact-graph.mjs'), root, '--out', out], { encoding: 'utf-8' });
    expect(run.status).toBe(0);
    const product = JSON.parse(readFileSync(out, 'utf-8'));
    expect(product.coverage.routes).toEqual({ status: 'not-run' });
    expect(product.nodes.some((n) => n.type === 'endpoint')).toBe(false);
    expect(product.edges.some((e) => e.type === 'routes')).toBe(false);
    expect(product.gaps.some((g) => g.kind.startsWith('route-'))).toBe(false);
  });

  it('passes the integrity check of the driver, and the shape audit of the graph schema', () => {
    expect(result.validation).toEqual({ ok: true, issues: [] });
    const audit = auditGraphShape(graph);
    expect(audit.issues.filter((issue) => issue.edgeKey?.startsWith('routes|') || issue.nodeId?.startsWith('endpoint:'))).toEqual([]);
    expect(audit.issues.filter((issue) => issue.edgeKey?.startsWith('contains|endpoint:') || issue.edgeKey?.includes('|endpoint:'))).toEqual([]);
  });

  it('writes the same coverage into the result of the run and the product, and runs the stage after the catalogs are read and before the fact graph', () => {
    const stages = Object.keys(result.timings);
    expect(stages.indexOf('nameReferences')).toBeLessThan(stages.indexOf('factGraph'));
    expect(result.coverage.routes).toEqual(graph.coverage.routes);
    expect(stages).not.toContain('routes');
  });
});

describe('what reads the endpoints and the routes edges (design D8, D10, tasks 3.4 and 3.5)', () => {
  let root;
  let graph;
  beforeAll(async () => {
    root = copyFixture();
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    graph = readProduct(root);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const label = (id) => {
    const node = graph.nodes.find((n) => n.id === id);
    return node.type === 'file' ? node.filePath : `${node.filePath}#${node.owner ? `${node.owner}.` : ''}${node.name}`;
  };
  const method = (owner, name, file) => graph.nodes.find((n) => n.type === 'function' && n.owner === owner && n.name === name && n.filePath === file);
  const endpoint = (route, file) => graph.nodes.find((n) => n.type === 'endpoint' && n.name === route && n.filePath === file);
  const linesOf = (file) => readFileSync(join(root, file), 'utf-8').split('\n');

  it('is one of the deterministic edge types', () => {
    expect(DETERMINISTIC_EDGE_TYPES).toContain('routes');
  });

  it('takes a handler to its endpoint in one hop, along the edge backwards (spec: from a handler to its endpoint)', () => {
    const find = method('OrderResource', 'findJson', ORDER);
    const hop = oneHop(graph.edges, [find.id]);
    const target = endpoint('GET /orders/{id}', ORDER);
    expect(hop.nodes).toContain(target.id);
    expect(hop.edges.filter((e) => e.type === 'routes').map((e) => [e.source, e.target])).toEqual([[target.id, find.id]]);
    // the endpoint of the interface method, reached by the interface method
    const list = method('OrderApi', 'list', API);
    expect(oneHop(graph.edges, [list.id]).nodes).toContain(endpoint('GET /v2/orders', API).id);
  });

  it('takes an endpoint to its handlers in one hop, along the edge, and to the file that contains it', () => {
    const target = endpoint('GET /orders/{id}', ORDER);
    const hop = oneHop(graph.edges, [target.id]);
    expect(hop.nodes).toEqual(expect.arrayContaining([method('OrderResource', 'findJson', ORDER).id, method('OrderResource', 'findText', ORDER).id]));
    expect(hop.edges.filter((e) => e.type === 'routes')).toHaveLength(2);
    expect(hop.nodes.some((id) => label(id) === ORDER)).toBe(true);
    expect(boundedBFS(graph.edges, [target.id], { maxHops: 1 }).nodes).toEqual(expect.arrayContaining(hop.nodes));
  });

  it('reaches the endpoint of an interface route from the implementation, within the bounded search: through implements, then routes', () => {
    const impl = method('OrderApiImpl', 'list', `${R}/OrderApiImpl.java`);
    expect(graph.edges.some((e) => e.type === 'implements' && e.source === impl.id && e.target === method('OrderApi', 'list', API).id)).toBe(true);
    expect(oneHop(graph.edges, [impl.id]).nodes).not.toContain(endpoint('GET /v2/orders', API).id);
    expect(boundedBFS(graph.edges, [impl.id], { maxHops: 2 }).nodes).toContain(endpoint('GET /v2/orders', API).id);
  });

  it('serves the traversal through the project service, both ways, with the evidence of the routes edge', async () => {
    const service = createProjectService(root);
    const find = method('OrderResource', 'findJson', ORDER);
    const target = endpoint('GET /orders/{id}', ORDER);
    const fromHandler = await service.traverse({ seedIds: [find.id], mode: 'one-hop' });
    expect(fromHandler.status).toBe('ok');
    expect(fromHandler.data.nodes.map((n) => n.name)).toContain('GET /orders/{id}');
    const edge = fromHandler.data.edges.find((e) => e.type === 'routes');
    expect(edge.evidence.map((x) => [x.line, x.role, x.token])).toEqual([[6, 'root-path', 'Path'], [14, 'verb', 'GET'], [15, 'method-path', 'Path']]);

    const fromEndpoint = await service.traverse({ seedIds: [target.id], mode: 'one-hop' });
    expect(fromEndpoint.data.nodes.map((n) => n.name)).toEqual(expect.arrayContaining(['findJson', 'findText']));
    expect(fromEndpoint.data.edges.filter((e) => e.type === 'routes')).toHaveLength(2);
  });

  it('finds an endpoint by its route through recall, and the handlers by the words of the route, without error (the endpoint is no chunk of the source index)', async () => {
    const service = createProjectService(root);
    const target = endpoint('GET /orders/{id}', ORDER);
    const byName = await service.recall({ terms: ['GET /orders/{id}'] });
    expect(byName.status).toBe('ok');
    expect(byName.data.candidates[0]).toMatchObject({ nodeId: target.id, path: ORDER, symbol: 'GET /orders/{id}' });
    const byWords = await service.recall({ terms: ['/orders/{id}'], limit: 20 });
    expect(byWords.status).toBe('ok');
    expect(byWords.data.candidates.map((c) => c.nodeId)).toEqual(expect.arrayContaining([method('OrderResource', 'findJson', ORDER).id, method('OrderResource', 'findText', ORDER).id]));
    // the endpoint is a node of the graph and no chunk of the index: the index is the one the rows made
    const index = readFileSync(join(root, '.excavator', 'source-index.jsonl'), 'utf-8');
    expect(index).not.toContain('endpoint:orders-rest');
  });

  it('passes the graph validator: every routes evidence line and every endpoint contains line holds its token, and nothing else is new', () => {
    const { report } = validateAgainstSource({ graph: structuredClone(graph), reader: createSourceReader(root) });
    expect(report.findings.edgeContradicted.filter((f) => f.type === 'routes')).toEqual([]);
    expect(report.findings.edgeContradicted.filter((f) => f.edgeKey.includes('|endpoint:'))).toEqual([]);
    // the graph without the route facts reads the same, apart from how many edges were checked and confirmed
    const isEndpoint = new Set(graph.nodes.filter((n) => n.type === 'endpoint').map((n) => n.id));
    const routeEdges = graph.edges.filter((e) => e.type === 'routes' || isEndpoint.has(e.source) || isEndpoint.has(e.target));
    expect(routeEdges).toHaveLength(13 + 12);
    const plain = structuredClone({
      ...graph,
      nodes: graph.nodes.filter((n) => !isEndpoint.has(n.id)),
      edges: graph.edges.filter((e) => !routeEdges.includes(e)),
    });
    const { report: baseline } = validateAgainstSource({ graph: plain, reader: createSourceReader(root) });
    // no new warning: an endpoint has edges, so it is no orphan, and the edges only add edges to methods that already have them
    expect(report.warnings.filter((w) => !baseline.warnings.includes(w))).toEqual([]);
    expect(baseline.warnings.filter((w) => !report.warnings.includes(w))).toEqual([]);
    // an endpoint is a file-level node, which the Lazy graph has no layer for - as it has none for any file node
    expect(report.issues.filter((i) => !baseline.issues.includes(i)).every((i) => /^File node 'endpoint:.*' not in any layer$/.test(i))).toBe(true);
    expect(report.issues.filter((i) => !baseline.issues.includes(i))).toHaveLength(12);
    expect(baseline.issues.filter((i) => !report.issues.includes(i))).toEqual([]);
    expect(report.counts).toEqual({
      ...baseline.counts,
      edgesChecked: baseline.counts.edgesChecked + 25,
      edgeConfirmed: baseline.counts.edgeConfirmed + 25,
    });
  });

  it('reports a routes edge whose cited lines hold none of its tokens (spec: a line without the token)', () => {
    const corrupted = structuredClone(graph);
    const edge = corrupted.edges.find((e) => e.type === 'routes' && label(e.target).endsWith('OrderResource.create') && label(e.source).includes(ORDER));
    expect(edge.evidence).toHaveLength(2);
    for (const entry of edge.evidence) entry.line = 1; // `package com.acme.orders.rest;`: no Path and no POST on it
    const { report } = validateAgainstSource({ graph: corrupted, reader: createSourceReader(root) });
    expect(report.findings.edgeContradicted.filter((f) => f.type === 'routes').map((f) => f.edgeKey)).toEqual([`routes|${edge.source}|${edge.target}`]);
    const { report: intact } = validateAgainstSource({ graph: structuredClone(graph), reader: createSourceReader(root) });
    expect(report.counts.edgeContradicted).toBe(intact.counts.edgeContradicted + 1);
  });

  it('reports the contains edge of an endpoint whose cited line is not the annotation (spec: the contains evidence is checked)', () => {
    const target = endpoint('GET /orders/{id}', ORDER);
    const corrupted = structuredClone(graph);
    const edge = corrupted.edges.find((e) => e.type === 'contains' && e.target === target.id);
    expect(edge.evidence).toHaveLength(1);
    expect(linesOf(ORDER)[edge.evidence[0].line - 1]).toContain('GET');
    edge.evidence[0].line = 1;
    const { report } = validateAgainstSource({ graph: corrupted, reader: createSourceReader(root) });
    expect(report.findings.edgeContradicted.map((f) => f.edgeKey)).toContain(`contains|${edge.source}|${edge.target}`);
    const { report: intact } = validateAgainstSource({ graph: structuredClone(graph), reader: createSourceReader(root) });
    expect(intact.findings.edgeContradicted.map((f) => f.edgeKey)).not.toContain(`contains|${edge.source}|${edge.target}`);
  });

  it('contradicts the contains edges of the endpoints when they cite their lines with no token: the validator falls back to the endpoint\'s name, which no annotation line holds', () => {
    const mutated = buildFactGraph({ ...inputsOfRun(root), routeCatalog: loadRouteCatalog(), routeMutations: { containsWithoutToken: true } });
    const { report } = validateAgainstSource({ graph: structuredClone(mutated), reader: createSourceReader(root) });
    const intact = validateAgainstSource({ graph: structuredClone(graph), reader: createSourceReader(root) }).report;
    const endpointContains = (r) => r.findings.edgeContradicted.filter((f) => f.type === 'contains' && f.edgeKey.includes('|endpoint:'));
    expect(endpointContains(intact)).toEqual([]);
    expect(endpointContains(report)).toHaveLength(12);
    // the tokens it looked for are the routes
    expect(endpointContains(report).map((f) => f.reason).every((reason) => /no cited line contains \["(?:GET|POST|PUT|DELETE) \//.test(reason))).toBe(true);
    // nothing else changes: the routes edges are still confirmed by their own tokens
    expect(report.findings.edgeContradicted.filter((f) => f.type === 'routes')).toEqual([]);
    expect(report.counts.edgeContradicted).toBe(intact.counts.edgeContradicted + 12);
  });

  it('reports the route coverage and its gaps through project_status', () => {
    const status = createProjectService(root).projectStatus();
    expect(status.status).toBe('ok');
    expect(status.data.factCoverage.routes).toMatchObject({
      status: 'ran', families: { jaxrs: { sites: 21, endpoints: 12, edges: 13, buckets: { endpoint: 13, noRoot: 2, client: 1 } } }, unconfirmed: { GET: 1, Path: 1 },
    });
    expect(status.gaps.filter((g) => g.scope === 'jaxrs').map((g) => g.kind).sort()).toEqual([
      'route-handler-unresolved', 'route-path-unresolved', 'route-root-unresolved', 'route-verb-unresolved',
    ]);
  });

  it('serves the same through the real stdio MCP server: project_status, a traversal both ways and the annotation line of the evidence', async () => {
    const client = new Client({ name: 'excavator-route-facts-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath, args: [SERVER_PATH, '--project-root', root], cwd: process.cwd(), stderr: 'pipe',
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', TMPDIR: process.env.TMPDIR ?? '/tmp' },
    });
    await client.connect(transport);
    try {
      const status = await client.callTool({ name: 'project_status', arguments: {} });
      expect(status.structuredContent.status).toBe('ok');
      expect(status.structuredContent.data.factCoverage.routes.families.jaxrs).toMatchObject({ sites: 21, endpoints: 12, edges: 13 });
      expect(status.structuredContent.gaps.filter((g) => g.kind.startsWith('route-')).map((g) => g.kind).sort()).toEqual([
        'route-handler-unresolved', 'route-path-unresolved', 'route-root-unresolved', 'route-verb-unresolved',
      ]);

      const find = method('OrderResource', 'findJson', ORDER);
      const target = endpoint('GET /orders/{id}', ORDER);
      const inbound = await client.callTool({ name: 'traverse', arguments: { seedIds: [find.id], mode: 'one-hop' } });
      expect(inbound.structuredContent.data.edges.filter((e) => e.type === 'routes').map((e) => e.source)).toEqual([target.id]);
      expect(inbound.structuredContent.data.nodes.map((n) => n.name)).toContain('GET /orders/{id}');
      const outbound = await client.callTool({ name: 'traverse', arguments: { seedIds: [target.id], mode: 'one-hop' } });
      expect(outbound.structuredContent.data.edges.filter((e) => e.type === 'routes').map((e) => e.target).sort()).toEqual(
        [find.id, method('OrderResource', 'findText', ORDER).id].sort(),
      );

      const [edge] = inbound.structuredContent.data.edges.filter((e) => e.type === 'routes');
      const verb = edge.evidence.find((x) => x.role === 'verb');
      const evidence = await client.callTool({ name: 'read_evidence', arguments: { path: verb.file, startLine: verb.line, endLine: verb.line } });
      expect(evidence.structuredContent.data.text).toContain('@GET');
    } finally {
      await client.close();
    }
  }, 60_000);
});

describe('the route catalog of a run, and a product of the previous pipeline version (design D10)', () => {
  it('is the one a test passes in: a catalog that exposes every method turns the private handler into an endpoint', async () => {
    const root = copyFixture();
    try {
      const raw = JSON.parse(JSON.stringify(loadRouteCatalog()));
      raw.routeFamilies[0].publicOnly = false;
      const result = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW, routeCatalog: parseRouteCatalog(raw) });
      expect(result.saveError).toBeNull();
      const graph = readProduct(root);
      expect(graph.coverage.routes.families.jaxrs).toMatchObject({ sites: 21, endpoints: 13, edges: 14, buckets: { nonPublic: 0, endpoint: 14 } });
      expect(graph.nodes.some((n) => n.type === 'endpoint' && n.name === 'GET /orders/secret')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads as stale, and the next sync projects it again whole: the endpoints, the routes edges and the coverage come back', async () => {
    const root = copyFixture();
    try {
      await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
      const graphPath = join(root, '.excavator', KNOWLEDGE_GRAPH_FILE);
      const manifestPath = join(root, '.excavator', 'source-manifest.json');
      // what a /10 run left: no route coverage, no endpoint in a Java file, no routes edge
      const old = readKnowledgeGraph(graphPath);
      const isEndpoint = new Set(old.nodes.filter((n) => n.type === 'endpoint').map((n) => n.id));
      delete old.coverage.routes;
      old.nodes = old.nodes.filter((n) => !isEndpoint.has(n.id));
      old.edges = old.edges.filter((e) => e.type !== 'routes' && !isEndpoint.has(e.source) && !isEndpoint.has(e.target));
      old.gaps = old.gaps.filter((g) => !g.kind.startsWith('route-'));
      old.project.pipelineVersion = 'lazy-fact-graph/10';
      writeKnowledgeGraph(graphPath, old);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, pipelineVersion: 'lazy-fact-graph/10' }, null, 2));

      const service = createProjectService(root);
      const before = service.projectStatus();
      expect(before.status).toBe('unavailable');
      expect(before.snapshot.freshness).toBe('stale');
      expect(before.data.factCoverage.routes).toBeUndefined();

      const synced = await service.syncFacts();
      expect(synced.status).toBe('ok');
      expect(synced.data.kind).toBe('synced');
      expect(synced.data.factCoverage.routes.families.jaxrs).toMatchObject({ sites: 21, endpoints: 12, edges: 13 });
      const graph = readProduct(root);
      expect(graph.project.pipelineVersion).toBe('lazy-fact-graph/14');
      expect(graph.nodes.filter((n) => n.type === 'endpoint')).toHaveLength(12);
      expect(graph.edges.filter((e) => e.type === 'routes')).toHaveLength(13);
      expect(service.projectStatus().snapshot.freshness).toBe('fresh');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('follows an edit of a Java file on the next sync: the endpoint of the old route is gone and the one of the new route is there', async () => {
    const root = copyFixture();
    try {
      await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
      const file = join(root, ORDER);
      writeFileSync(file, readFileSync(file, 'utf-8').replace('@Path("/orders/")', '@Path("/orders/v3/")'));
      const synced = await createProjectService(root).syncFacts();
      expect(synced.status).toBe('ok');
      const graph = readProduct(root);
      const names = graph.nodes.filter((n) => n.type === 'endpoint' && n.filePath === ORDER).map((n) => n.name);
      expect(names).toContain('GET /orders/v3/{id}');
      expect(names).not.toContain('GET /orders/{id}');
      // the other file of the same route is not touched
      expect(graph.nodes.some((n) => n.type === 'endpoint' && n.filePath === V1 && n.name === 'GET /orders')).toBe(true);
      expect(graph.coverage.routes.families.jaxrs).toMatchObject({ sites: 21, endpoints: 12, edges: 13 });
      expect(graph.edges.filter((e) => e.type === 'routes')).toHaveLength(13);
      expect(createProjectService(root).projectStatus().snapshot.freshness).toBe('fresh');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
