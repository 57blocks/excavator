// javaee-jsf-framework-knowledge, tasks 4.1-4.2: the detected framework ids in the
// graph header, and the Java EE descriptor mentions, in the real Lazy driver. The
// fixture is a purpose-built synthetic project (tests/fixtures/javaee-jsf-app): two
// Maven modules, an EJB descriptor with a 3.x and a 2.x style session bean, a
// persistence unit, a web descriptor with a servlet, a filter and a listener, and JSF
// views. It is copied to a temp directory because a Lazy run writes `.excavator/`
// next to the source.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PIPELINE_VERSION, defaultRunScript, runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { createProjectService } from '../../skills/excavator/project-service.mjs';
import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraph, writeKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/javaee-jsf-app');
const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';

const copyFixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'excavator-javaee-jsf-'));
  cpSync(FIXTURE, root, { recursive: true });
  return root;
};
const graphPathOf = (root) => join(root, '.excavator', KNOWLEDGE_GRAPH_FILE);
const readProduct = (root) => readKnowledgeGraph(graphPathOf(root));
const readScan = (root) => JSON.parse(readFileSync(join(root, '.excavator', 'intermediate', 'scan-result.json'), 'utf-8'));

/** `file path` or `path#Name` for a node id. */
function labeller(graph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return (id) => {
    const node = byId.get(id);
    return node.type === 'file' ? node.filePath : `${node.filePath}#${node.name}`;
  };
}

describe('the detected frameworks in the graph header (task 4.1)', () => {
  let root;
  let result;
  let graph;
  beforeAll(async () => {
    root = copyFixture();
    result = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    graph = readProduct(root);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('writes the detected ids on a first run, with the evidence kept in the intermediate scan result', () => {
    expect(result.saveError).toBeNull();
    expect(graph.project.frameworks).toEqual(['javaee', 'jsf']);
    expect(readScan(root).detectedFrameworks.map((d) => d.id)).toEqual(['javaee', 'jsf']);
  });

  it('stamps the product with the new pipeline version', () => {
    expect(PIPELINE_VERSION).toBe('lazy-fact-graph/15');
    expect(graph.project.pipelineVersion).toBe('lazy-fact-graph/15');
  });

  it('replaces a framework name an older graph carried with the detected ids, and changes no fact', async () => {
    const before = readProduct(root);
    const old = readProduct(root);
    old.project.frameworks = ['Spring Boot'];
    writeKnowledgeGraph(graphPathOf(root), old);
    expect(readProduct(root).project.frameworks).toEqual(['Spring Boot']);

    const rerun = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    expect(rerun.saveError).toBeNull();
    const after = readProduct(root);
    expect(after.project.frameworks).toEqual(['javaee', 'jsf']);
    expect(after.project.factsDigest).toBe(before.project.factsDigest);
    expect(after.nodes).toEqual(before.nodes);
    expect(after.edges).toEqual(before.edges);
    expect(after.gaps).toEqual(before.gaps);
  });

  it('reads a product of the previous pipeline version as stale, and the next sync writes the ids into its header', async () => {
    const stale = readProduct(root);
    stale.project.frameworks = [];
    stale.project.pipelineVersion = 'lazy-fact-graph/9';
    writeKnowledgeGraph(graphPathOf(root), stale);
    const manifestPath = join(root, '.excavator', 'source-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, pipelineVersion: 'lazy-fact-graph/9' }, null, 2));

    const service = createProjectService(root);
    expect(service.projectStatus().snapshot.freshness).toBe('stale');
    const synced = await service.syncFacts();
    expect(synced.status).toBe('ok');
    expect(synced.data.kind).toBe('synced');
    expect(readProduct(root).project.frameworks).toEqual(['javaee', 'jsf']);
    expect(service.projectStatus().snapshot.freshness).toBe('fresh');
  });
});

describe('a project that declares no framework keyword (task 4.1)', () => {
  it('has an empty list, also over a graph that named a framework', async () => {
    const root = copyFixture();
    try {
      // The keywords of the two configs that appear in the fixture's manifests, spring's excluded one aside.
      const keywords = /jakarta\.jakartaee-api|primefaces|myfaces|ejb-jar|faces-config|javax\.faces/gi;
      const manifests = readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && ['pom.xml', 'ejb-jar.xml', 'faces-config.xml', 'web.xml'].includes(e.name))
        .map((e) => join(e.parentPath, e.name));
      // five poms (the parent and the four modules, orders-rest being the one of jaxrs-route-facts and orders-inject the one of
      // by-type-injection), ejb-jar.xml, faces-config.xml and web.xml
      expect(manifests.length).toBe(8);
      for (const file of manifests) writeFileSync(file, readFileSync(file, 'utf-8').replace(keywords, 'removed'));

      const first = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
      expect(first.saveError).toBeNull();
      expect(readScan(root).detectedFrameworks).toEqual([]);
      expect(readProduct(root).project.frameworks).toEqual([]);

      const old = readProduct(root);
      old.project.frameworks = ['Spring Boot'];
      writeKnowledgeGraph(graphPathOf(root), old);
      await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
      expect(readProduct(root).project.frameworks).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('a scan result without detectedFrameworks (task 4.1)', () => {
  // The production path: the driver spawns scan-project.mjs and reads its JSON back. This
  // wrapper runs the real script, then deletes (or breaks) the field from the file it wrote,
  // which is what a scan script and a driver of different versions would hand over.
  const scanWith = (change) => (name, args) => {
    const out = defaultRunScript(name, args);
    if (name === 'scan-project.mjs') {
      const scanPath = args[1];
      const scan = JSON.parse(readFileSync(scanPath, 'utf-8'));
      change(scan);
      writeFileSync(scanPath, JSON.stringify(scan));
    }
    return out;
  };

  it.each([
    ['absent', (scan) => { delete scan.detectedFrameworks; }],
    ['not a list', (scan) => { scan.detectedFrameworks = 'javaee,jsf'; }],
    ['null', (scan) => { scan.detectedFrameworks = null; }],
  ])('throws when the field is %s, and publishes nothing', async (_label, change) => {
    const root = copyFixture();
    try {
      await expect(runLazyAnalysis({ projectRoot: root, now: FIXED_NOW, runScript: scanWith(change) }))
        .rejects.toThrow(/detectedFrameworks/);
      expect(() => readFileSync(graphPathOf(root))).toThrow(/ENOENT/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Java EE descriptor class names in the real Lazy driver (task 4.2)', () => {
  const EJB = 'orders-ejb/src/main/resources/META-INF/ejb-jar.xml';
  const PERSISTENCE = 'orders-ejb/src/main/resources/META-INF/persistence.xml';
  const WEB = 'orders-web/src/main/webapp/WEB-INF/web.xml';
  const EJB_JAVA = 'orders-ejb/src/main/java/com/acme/orders';
  const WEB_JAVA = 'orders-web/src/main/java/com/acme/orders/web';

  let root;
  let graph;
  beforeAll(async () => {
    root = copyFixture();
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    graph = readProduct(root);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  /** Every mentions edge out of a descriptor: `target @ line token (element)`, sorted. */
  const mentionsOf = (descriptor) => {
    const label = labeller(graph);
    return graph.edges
      .filter((e) => e.type === 'mentions' && label(e.source) === descriptor)
      .flatMap((e) => e.evidence.map((x) => `${label(e.target)} @ ${x.line} ${x.token} (${x.context.element})`))
      .sort();
  };

  it('draws the ejb-jar.xml edges: bean classes, home, remote, local-home, local, business interfaces and the interceptor', () => {
    expect(mentionsOf(EJB)).toEqual([
      `${EJB_JAVA}/AuditInterceptor.java#AuditInterceptor @ 23 com.acme.orders.AuditInterceptor (interceptor-class)`,
      `${EJB_JAVA}/LegacyOrderBean.java#LegacyOrderBean @ 17 com.acme.orders.LegacyOrderBean (ejb-class)`,
      `${EJB_JAVA}/LegacyOrderHome.java#LegacyOrderHome @ 13 com.acme.orders.LegacyOrderHome (home)`,
      `${EJB_JAVA}/LegacyOrderLocal.java#LegacyOrderLocal @ 16 com.acme.orders.LegacyOrderLocal (local)`,
      `${EJB_JAVA}/LegacyOrderLocalHome.java#LegacyOrderLocalHome @ 15 com.acme.orders.LegacyOrderLocalHome (local-home)`,
      `${EJB_JAVA}/LegacyOrderRemote.java#LegacyOrderRemote @ 14 com.acme.orders.LegacyOrderRemote (remote)`,
      `${EJB_JAVA}/OrderProcessorBean.java#OrderProcessorBean @ 8 com.acme.orders.OrderProcessorBean (ejb-class)`,
      `${EJB_JAVA}/OrderProcessorLocal.java#OrderProcessorLocal @ 6 com.acme.orders.OrderProcessorLocal (business-local)`,
      `${EJB_JAVA}/OrderProcessorRemote.java#OrderProcessorRemote @ 7 com.acme.orders.OrderProcessorRemote (business-remote)`,
    ]);
  });

  it('draws the persistence.xml edge to the entity, and none to the provider', () => {
    expect(mentionsOf(PERSISTENCE)).toEqual([
      `${EJB_JAVA}/Order.java#Order @ 5 com.acme.orders.Order (class)`,
    ]);
  });

  it('draws the web.xml edges to the servlet, the filter and the listener in the repository, and to the welcome page', () => {
    // The other servlet, FacesServlet, is outside the repository: no edge, one more name counted below.
    expect(mentionsOf(WEB)).toEqual([
      `${WEB_JAVA}/AuditFilter.java#AuditFilter @ 8 com.acme.orders.web.AuditFilter (filter-class)`,
      `${WEB_JAVA}/OrderListener.java#OrderListener @ 4 com.acme.orders.web.OrderListener (listener-class)`,
      `${WEB_JAVA}/OrderServlet.java#OrderServlet @ 24 com.acme.orders.web.OrderServlet (servlet-class)`,
      'orders-web/src/main/webapp/orders/list.xhtml @ 31 orders/list.xhtml (welcome-file)',
    ]);
  });

  it('locks every element the spec lists, each with at least one edge', () => {
    const label = labeller(graph);
    const elementsOf = (descriptor) => [...new Set(graph.edges
      .filter((e) => e.type === 'mentions' && label(e.source) === descriptor)
      .flatMap((e) => e.evidence.filter((x) => x.resolution === 'fqn').map((x) => x.context.element)))].sort();
    expect(elementsOf(EJB)).toEqual(
      ['business-local', 'business-remote', 'ejb-class', 'home', 'interceptor-class', 'local', 'local-home', 'remote'],
    );
    expect(elementsOf(PERSISTENCE)).toEqual(['class']);
    expect(elementsOf(WEB)).toEqual(['filter-class', 'listener-class', 'servlet-class']);
  });

  it('draws every one of them as an extracted, forward edge whose evidence is the descriptor line', () => {
    const label = labeller(graph);
    const edges = graph.edges.filter((e) => e.type === 'mentions' && [EJB, PERSISTENCE, WEB].includes(label(e.source)));
    expect(edges).toHaveLength(14);
    for (const edge of edges) {
      expect(edge.provenance).toBe('extracted');
      expect(edge.direction).toBe('forward');
      expect(edge.evidence.every((x) => x.file === label(edge.source) && x.source === 'lexical')).toBe(true);
    }
    const lines = (file) => readFileSync(join(root, file), 'utf-8').split('\n');
    for (const edge of edges) {
      for (const x of edge.evidence) expect(lines(x.file)[x.line - 1]).toContain(x.token);
    }
  });

  it('counts a name outside the repository where the class-name rule counts them, and draws no edge for it', async () => {
    const fqn = graph.coverage.mentions.fqn;
    // Fifteen names resolve to a type of the repository: the thirteen class names of the descriptors above, the
    // converter of faces-config.xml and the page-bean import of legacy.jsp. The 50 others are the provider,
    // FacesServlet and every other dotted name the non-code files carry - among them the four of the pom of the
    // orders-rest module (the namespace host, the group of the parent, the group and the artifact prefix of the
    // platform API), which the module of jaxrs-route-facts added to the 42 there were, and the same four of the pom of the
    // orders-inject module (by-type-injection), which has the same dependency.
    expect(fqn).toEqual({ candidates: 65, edge: 15, ambiguous: 0, unindexed: 0, external: 50 });
    expect(fqn.edge + fqn.ambiguous + fqn.unindexed + fqn.external).toBe(fqn.candidates);

    // The provider is one of the 50: without its line there is one fewer, and nothing else moves.
    const other = copyFixture();
    try {
      const file = join(other, PERSISTENCE);
      writeFileSync(file, readFileSync(file, 'utf-8').split('\n').filter((line) => !line.includes('<provider>')).join('\n'));
      await runLazyAnalysis({ projectRoot: other, now: FIXED_NOW });
      expect(readProduct(other).coverage.mentions.fqn).toEqual({ candidates: 64, edge: 15, ambiguous: 0, unindexed: 0, external: 49 });
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
