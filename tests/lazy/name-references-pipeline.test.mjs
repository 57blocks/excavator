// name-binding-references, tasks 5.1-5.4: the name-reference stage in the real
// Lazy driver, the traversal of `references` edges, the graph validator and the
// project status on the product. The fixture is a purpose-built synthetic
// project (tests/fixtures/jsf-name-references): four deployment units (a JSF /
// CDI shop, a Seam and Spring XML legacy module, a Spring-bridged admin, and a
// Spring-bridged module of factory-method, parent-only and alias definitions)
// and a page that belongs to none. It is copied to a temp directory because a Lazy
// run writes `.excavator/` next to the source.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { PIPELINE_VERSION, runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { buildFactGraph } from '../../skills/excavator/build-fact-graph.mjs';
import { createProjectService } from '../../skills/excavator/project-service.mjs';
import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';
import { readStructureAll } from '../../skills/excavator/structure-all-store.mjs';
import { loadNameBindingCatalog } from '../../skills/excavator/name-binding-catalog.mjs';
import { collectNameReferenceSites } from '../../skills/excavator/name-reference-sites.mjs';
import { createSourceReader, validateAgainstSource } from '../../skills/excavator/validate-graph.mjs';
import { boundedBFS, oneHop } from '../../skills/excavator/retrieve.mjs';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/jsf-name-references');
const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';

const copyFixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'excavator-name-references-'));
  cpSync(FIXTURE, root, { recursive: true });
  return root;
};
const readProduct = (root) => readKnowledgeGraph(join(root, '.excavator', KNOWLEDGE_GRAPH_FILE));

/** Files by path and classes by `path#Name`. */
function labeller(graph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return (id) => {
    const node = byId.get(id);
    return node.type === 'file' ? node.filePath : `${node.filePath}#${node.name}`;
  };
}
const linksOf = (graph) => {
  const label = labeller(graph);
  return graph.edges.filter((e) => e.type === 'references').map((e) => `${label(e.source)} -> ${label(e.target)}`).sort();
};

const SHOP = 'shop/src/main/java/com/acme/shop';
const WEB = 'shop/src/main/webapp';
const LEGACY = 'legacy/src/main/java/com/acme/legacy';
const ADMIN = 'admin/src/main/java/com/acme/admin';
const BRIDGE = 'bridge/src/main/java/com/acme/bridge';
const BRIDGE_CTX = 'bridge/src/main/resources/ctx.xml';
const BRIDGE_PAGE = 'bridge/src/main/webapp/index.xhtml';

// Every edge the fixture's pages draw, written out: what each page writes in
// its expressions, resolved inside the page's own deployment unit.
const EARLIER_LINKS = [
  `admin/src/main/webapp/index.xhtml -> ${ADMIN}/AdminService.java#AdminService`,
  `admin/src/main/webapp/index.xhtml -> ${ADMIN}/URLHelper.java#URLHelper`,
  `legacy/view/home.xhtml -> ${LEGACY}/Mailer.java#Mailer`,
  `legacy/view/home.xhtml -> ${LEGACY}/NumberGuess.java#NumberGuess`,
  `legacy/view/home.xhtml -> ${LEGACY}/OrderHome.java#OrderHome`,
  `legacy/view/page.jsp -> ${LEGACY}/Mailer.java#Mailer`,
  `legacy/view/pages.xml -> ${LEGACY}/OrderHome.java#OrderHome`,
  `${WEB}/WEB-INF/faces-config.xml -> ${SHOP}/CustomerBean.java#CustomerBean`,
  `${WEB}/alias.jsp -> ${SHOP}/OrderBean.java#OrderBean`,
  `${WEB}/legacy.jsp -> ${SHOP}/CheckoutBean.java#CheckoutBean`,
  `${WEB}/legacy.jsp -> ${SHOP}/OrderBean.java#OrderBean`,
  `${WEB}/orders/broken.xhtml -> ${SHOP}/CustomerBean.java#CustomerBean`,
  `${WEB}/orders/detail.xhtml -> ${SHOP}/CustomerBean.java#CustomerBean`,
  `${WEB}/orders/list.xhtml -> ${SHOP}/CartBean.java#CartBean`,
  `${WEB}/orders/list.xhtml -> ${SHOP}/CheckoutBean.java#CheckoutBean`,
  `${WEB}/orders/list.xhtml -> ${SHOP}/CustomerBean.java#CustomerBean`,
  `${WEB}/orders/list.xhtml -> ${SHOP}/InvoiceBean.java#InvoiceBean`,
  `${WEB}/orders/list.xhtml -> ${SHOP}/OrderBean.java#OrderBean`,
  `${WEB}/orders/list.xhtml -> ${SHOP}/PaymentBean.java#PaymentBean`,
  `${WEB}/orders/list.xhtml -> ${SHOP}/ReportBean.java#ReportBean`,
  `${WEB}/orders/names.xhtml -> ${SHOP}/BillingBean.java#BillingBean`,
  `${WEB}/orders/names.xhtml -> ${SHOP}/TrackBean.java#TrackBean`,
  `${WEB}/orders/params.xhtml -> ${SHOP}/CartBean.java#CartBean`,
  `${WEB}/orders/params.xhtml -> ${SHOP}/CheckoutBean.java#CheckoutBean`,
  `${WEB}/orders/params.xhtml -> ${SHOP}/CustomerBean.java#CustomerBean`,
  `${WEB}/orders/params.xhtml -> ${SHOP}/OrderBean.java#OrderBean`,
];
// The bridge unit: `childDao` has only a parent, `bridgedOrders` is an alias, and `locatedService` is built by a
// factory method, so it is no edge to the factory's class.
const BRIDGE_LINKS = [
  `${BRIDGE_PAGE} -> ${BRIDGE}/BaseDao.java#BaseDao`,
  `${BRIDGE_PAGE} -> ${BRIDGE}/OrderDaoImpl.java#OrderDaoImpl`,
];
const EXPECTED_LINKS = [...EARLIER_LINKS, ...BRIDGE_LINKS].sort();

describe('the name-reference stage in the real Lazy driver', () => {
  let root;
  let result;
  let graph;
  beforeAll(async () => {
    root = copyFixture();
    result = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    graph = readProduct(root);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('runs after the mentions stage and before the fact graph, and is timed', () => {
    expect(result.saveError).toBeNull();
    const stages = Object.keys(result.timings);
    expect(stages.indexOf('nameReferences')).toBeGreaterThan(stages.indexOf('mentions'));
    expect(stages.indexOf('nameReferences')).toBeLessThan(stages.indexOf('factGraph'));
    expect(Number.isInteger(result.timings.nameReferences)).toBe(true);
  });

  it('prints nameReferences= on the CLI stages line', () => {
    const other = copyFixture();
    try {
      const run = spawnSync('node', [resolve(FIXTURE, '../../../skills/excavator/lazy-analyze.mjs'), other], { encoding: 'utf-8' });
      expect(run.status).toBe(0);
      expect(run.stderr).toMatch(/lazy-analyze: stages .*mentions=\d+ms nameReferences=\d+ms factGraph=\d+ms/);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('stamps the product with the new pipeline version', () => {
    expect(PIPELINE_VERSION).toBe('lazy-fact-graph/14');
    expect(graph.project.pipelineVersion).toBe('lazy-fact-graph/14');
  });

  it('records the framework its faces-config descriptors declare in the header', () => {
    // Before /10 the header carried the previous graph's value, `[]` here.
    expect(graph.project.frameworks).toEqual(['jsf']);
  });

  it('draws exactly the expected references edges, resolved inside each page\'s own unit', () => {
    expect(linksOf(graph)).toEqual(EXPECTED_LINKS);
    expect(graph.edges.filter((e) => e.type === 'references')
      .every((e) => e.provenance === 'extracted' && e.weight === 0.5 && e.direction === 'forward' && e.evidence.length > 0)).toBe(true);
  });

  it('gives a bean no Java code calls an incoming edge from the page that uses it (spec)', () => {
    const invoices = graph.nodes.find((n) => n.type === 'class' && n.name === 'InvoiceBean');
    const page = graph.nodes.find((n) => n.filePath === `${WEB}/orders/list.xhtml`);
    // the declaration edges aside, the page is the bean's only way in
    expect(graph.edges.filter((e) => e.target === invoices.id && !['contains', 'exports'].includes(e.type)).map((e) => [e.type, e.source]))
      .toEqual([['references', page.id]]);
  });

  it('records the evidence of a page that writes one bean several times, sorted, with the binding site', () => {
    const label = labeller(graph);
    const edge = graph.edges.find((e) => e.type === 'references' && label(e.source) === `${WEB}/orders/list.xhtml` && label(e.target) === `${SHOP}/OrderBean.java#OrderBean`);
    expect(edge.evidence.map((x) => [x.line, x.token, x.chain])).toEqual([
      [9, 'orders', 'orders.save'], [11, 'orders', 'orders.items'], [16, 'orders', 'orders.open'], [18, 'orders', 'orders.items.stream'],
    ]);
    expect(edge.evidence[0]).toMatchObject({
      file: `${WEB}/orders/list.xhtml`,
      source: 'lexical',
      name: 'orders',
      bindings: [{ file: `${SHOP}/OrderBean.java`, line: 5, binder: 'cdi-annotation-named' }],
    });
  });

  it('reads a managed bean the descriptor declares, and an expression inside a faces-config', () => {
    const label = labeller(graph);
    const reports = graph.edges.find((e) => e.type === 'references' && label(e.target) === `${SHOP}/ReportBean.java#ReportBean`);
    expect(reports.evidence[0].bindings).toEqual([{ file: `${WEB}/WEB-INF/faces-config.xml`, line: 5, binder: 'jsf-xml-managed-bean' }]);
    const fromConfig = graph.edges.find((e) => e.type === 'references' && label(e.source) === `${WEB}/WEB-INF/faces-config.xml`);
    expect(fromConfig.evidence).toEqual([expect.objectContaining({ line: 9, token: 'customerBean', chain: 'customerBean' })]);
  });

  it('keeps the same name of another unit apart: legacy\'s `orders` is shop\'s, which legacy cannot see', () => {
    expect(linksOf(graph).some((l) => l.startsWith('legacy/view/home.xhtml -> shop'))).toBe(false);
    expect(graph.gaps.find((g) => g.kind === 'name-reference-elsewhere').samples).toContain('legacy/view/home.xhtml:3 orders -> [shop [el]]');
  });

  it('reads a classic JSP page whole: an action nested in an HTML attribute value still references its bean', () => {
    const label = labeller(graph);
    const edge = graph.edges.find((e) => e.type === 'references' && label(e.source) === 'legacy/view/page.jsp');
    expect(edge.evidence.map((e) => [e.line, e.token, e.chain])).toEqual([[3, 'mailer', 'mailer.name'], [4, 'mailer', 'mailer.subject']]);
  });

  it('reads a loop variable an action declares inside a classic JSP page\'s script block as local, though legacy binds the same name', () => {
    expect(linksOf(graph).some((l) => l.startsWith('legacy/view/script.jsp'))).toBe(false);
  });

  it('counts the ten buckets, and every root lands in exactly one', () => {
    const { nameReferences } = graph.coverage;
    expect(nameReferences.roots).toEqual({
      // the bridge unit's three roots: two edges and one unknown
      local: 9, implicit: 4, edge: 36, bundle: 2, external: 1, unindexed: 1, unknown: 2, ambiguous: 3, elsewhere: 8, unbound: 10,
    });
    expect(nameReferences.rootCount).toBe(76);
    expect(Object.values(nameReferences.roots).reduce((a, b) => a + b, 0)).toBe(nameReferences.rootCount);
  });

  it('records the rest of the coverage: files, units, bindings by binder, and what was not a binding', () => {
    const { nameReferences } = graph.coverage;
    expect(nameReferences).toMatchObject({
      status: 'ran',
      files: { xhtml: 10, jsp: 4, xml: 4 },
      units: 5,
      repositoryUnitFiles: 1,
      nonLiteralNames: 1,
      nonIdentifierNames: 2, // bad-name, and the Spring bean legacy.service: Spring's resolver does not read a dotted name
      unconfirmedAnnotations: { Named: 1 },
      implicitWithBinding: 1, // externalContext, which shop also binds
      escaped: 1,
      unterminated: 1,
      // page.jsp nests an action in an HTML attribute value; a classic JSP page is read whole, so nothing is left unscanned
      unscanned: 0,
      // about.html counts by its extension even though it starts with a tag; admin's web.xml holds one in a param-value
      outsideFiles: { html: 1, 'xml:web-app': 1 },
    });
    expect(nameReferences.bindings).toEqual({
      'jsf-xml-managed-bean': 4,
      'jsf-xml-resource-bundle': 1,
      'seam-xml-component': 2,
      'spring-xml-bean': 9,
      'spring-xml-alias': 1,
      'jsf-annotation-managed-bean': 2,
      'cdi-annotation-named': 9,
      'cdi-annotation-model': 1,
      'seam-annotation-name': 2,
      'seam-annotation-role': 1,
      'spring-annotation-stereotype': 4,
      'ejb-annotation-session': 0,
      'spring-annotation-advice': 0,
    });
    // an anonymous Spring bean, and a Seam component with only a class
    expect(nameReferences.missingNames).toEqual({
      'jsf-xml-managed-bean': 0,
      'jsf-xml-resource-bundle': 0,
      'seam-xml-component': 1,
      'spring-xml-bean': 1,
      'spring-xml-alias': 0,
      'jsf-annotation-managed-bean': 0,
      'cdi-annotation-named': 0,
      'cdi-annotation-model': 0,
      'seam-annotation-name': 0,
      'seam-annotation-role': 0,
      'spring-annotation-stereotype': 0,
      'ejb-annotation-session': 0,
      'spring-annotation-advice': 0,
    });
    expect(result.coverage.nameReferences).toEqual(nameReferences);
  });

  it('makes what it could not resolve visible, by kind, and the page a gap is in gives its scope', () => {
    const gap = (kind) => graph.gaps.find((g) => g.kind === kind);
    for (const kind of ['target-unindexed', 'target-unknown', 'ambiguous', 'elsewhere', 'unbound']) {
      expect(gap(`name-reference-${kind}`), kind).toMatchObject({ scope: 'xhtml' });
    }
    expect(gap('name-reference-ambiguous')).toMatchObject({ count: 3 });
    expect(gap('name-reference-ambiguous').samples).toEqual([
      // a Spring bean that only has a parent, and a component of the same name
      'admin/src/main/webapp/index.xhtml:3 report -> [(no target), admin/src/main/java/com/acme/admin/ReportService.java#ReportService]',
      // two classes of one name, main and test source
      `${WEB}/orders/list.xhtml:18 payments -> [${SHOP}/PaymentsBean.java#PaymentsBean, shop/src/test/java/com/acme/shop/PaymentsStub.java#PaymentsStub]`,
      // the root and a dotted prefix of the chain both name a bean
      `${WEB}/orders/names.xhtml:3 billing -> [billing -> ${SHOP}/BillingBean.java#BillingBean, billing.invoice -> ${SHOP}/InvoiceLineBean.java#InvoiceLineBean]`,
    ]);
    expect(gap('name-reference-target-unindexed').samples).toEqual([`${WEB}/orders/list.xhtml:19 kotlinBean -> [com.acme.shop.kt.KotlinBean]`]);
    expect(gap('name-reference-target-unknown')).toMatchObject({ count: 2 });
    expect(gap('name-reference-target-unknown').samples).toEqual([
      // a bean built by a factory method: the class it writes is the factory's, and the sample says which attribute
      `${BRIDGE_PAGE}:2 locatedService -> [${BRIDGE_CTX}:2 (factory-method)]`,
      `${WEB}/orders/list.xhtml:19 classless -> [${WEB}/WEB-INF/faces-config.xml:21]`,
    ]);
    expect(gap('name-reference-elsewhere')).toMatchObject({ count: 8 });
    expect(gap('name-reference-elsewhere').samples).toEqual([
      'admin/src/main/webapp/index.xhtml:2 customerBean -> [shop [el]]',
      'legacy/view/home.xhtml:3 orders -> [shop [el]]',
      'legacy/view/home.xhtml:3 orderService -> [legacy [spring]]',
      'legacy/view/home.xhtml:3 svc -> [legacy [spring]]',
      'legacy/view/home.xhtml:3 childService -> [legacy [spring]]',
    ]);
    expect(gap('name-reference-unbound')).toMatchObject({ count: 10 });
    // a Spring inner bean's id, a dotted name Spring's resolver cannot reach and a bean named in a library bind nothing
    const unbound = graph.gaps.filter((g) => g.kind === 'name-reference-unbound').flatMap((g) => g.samples).join('\n');
    expect(unbound).toContain('innerHelper');
    expect(unbound).toContain('admin/src/main/webapp/index.xhtml:3 legacy -> []');
  });

  it('is not fooled by the other bindings a Spring bridge or a test source brings', () => {
    // admin's faces-config declares the bridge: its Spring beans are visible there, and only there
    expect(linksOf(graph)).toContain(`admin/src/main/webapp/index.xhtml -> ${ADMIN}/URLHelper.java#URLHelper`);
    expect(linksOf(graph).some((l) => l.includes('CatalogService'))).toBe(false);
    // `\\#{escaped.expr}`, a comment and a string that holds #{ yield no root
    const references = graph.edges.filter((e) => e.type === 'references').flatMap((e) => e.evidence);
    expect(references.some((e) => ['escaped', 'commented', 'not'].includes(e.token))).toBe(false);
  });

  describe('the Spring definitions of the bridged unit (xml-injection-references, design D3)', () => {
    const label = (id) => labeller(graph)(id);
    const edgesOf = (page) => graph.edges.filter((e) => e.type === 'references' && label(e.source) === page);

    it('reads a bean that only has a parent as the class of the definition it names', () => {
      const edge = edgesOf(BRIDGE_PAGE).find((e) => label(e.target) === `${BRIDGE}/BaseDao.java#BaseDao`);
      expect(edge.evidence).toEqual([expect.objectContaining({
        line: 2, token: 'childDao', name: 'childDao', bindings: [{ file: BRIDGE_CTX, line: 4, binder: 'spring-xml-bean' }],
      })]);
    });

    it('reads an alias as the class of the bean it names, citing the alias', () => {
      const edge = edgesOf(BRIDGE_PAGE).find((e) => label(e.target) === `${BRIDGE}/OrderDaoImpl.java#OrderDaoImpl`);
      expect(edge.evidence).toEqual([expect.objectContaining({
        line: 2, token: 'bridgedOrders', name: 'bridgedOrders', bindings: [{ file: BRIDGE_CTX, line: 6, binder: 'spring-xml-alias' }],
      })]);
    });

    it('draws no edge to the class a factory-method bean writes: that class is the factory', () => {
      expect(linksOf(graph).some((l) => l.endsWith('Locator.java#Locator'))).toBe(false);
      expect(edgesOf(BRIDGE_PAGE).map((e) => label(e.target)).sort()).toEqual([`${BRIDGE}/BaseDao.java#BaseDao`, `${BRIDGE}/OrderDaoImpl.java#OrderDaoImpl`]);
    });

    it('leaves what the other units draw as it was: the edges of the earlier units are the earlier list, and the bridge adds exactly its own', () => {
      const links = linksOf(graph);
      expect(links.filter((l) => !l.startsWith('bridge/'))).toEqual([...EARLIER_LINKS].sort());
      expect(links.filter((l) => l.startsWith('bridge/'))).toEqual([...BRIDGE_LINKS].sort());
    });

    // The three target rules each change what the bridge's page reaches: with the rule off, its edges differ.
    it('depends on each target rule: without aliases, parents or the factory attributes the bridge\'s edges change', () => {
      const intermediate = join(root, '.excavator', 'intermediate');
      const scan = JSON.parse(readFileSync(join(intermediate, 'scan-result.json'), 'utf-8'));
      const structureAll = readStructureAll(join(intermediate, 'structure-all.jsonl'));
      const importMap = JSON.parse(readFileSync(join(intermediate, 'import-map.json'), 'utf-8'));
      const catalog = loadNameBindingCatalog();
      const nameReferenceSites = collectNameReferenceSites({ scan, catalog, readFile: (path) => readFileSync(join(root, path), 'utf-8') });
      const bridgeLinks = (mutations) => {
        const built = buildFactGraph({ scan, structureAll, importMap, nameReferenceSites, nameBindingCatalog: catalog, nameReferenceMutations: mutations });
        const name = labeller(built);
        return built.edges.filter((e) => e.type === 'references' && name(e.source) === BRIDGE_PAGE).map((e) => name(e.target)).sort();
      };
      const plain = [`${BRIDGE}/BaseDao.java#BaseDao`, `${BRIDGE}/OrderDaoImpl.java#OrderDaoImpl`];
      expect(bridgeLinks({})).toEqual(plain);
      expect(bridgeLinks({ noAliases: true })).toEqual([`${BRIDGE}/BaseDao.java#BaseDao`]);
      expect(bridgeLinks({ noInheritance: true })).toEqual([`${BRIDGE}/OrderDaoImpl.java#OrderDaoImpl`]);
      expect(bridgeLinks({ ignoreUnknownWhen: true })).toEqual([...plain, `${BRIDGE}/Locator.java#Locator`].sort());
    });
  });

  it('reaches a bean named with a dot by the prefix of the chain, and cites the name that matched (spec: dotted names)', () => {
    const label = labeller(graph);
    const edge = graph.edges.find((e) => e.type === 'references' && label(e.target) === `${SHOP}/TrackBean.java#TrackBean`);
    expect(label(edge.source)).toBe(`${WEB}/orders/names.xhtml`);
    expect(edge.evidence).toEqual([expect.objectContaining({
      line: 2, token: 'admin', chain: 'admin.track.trackingId', name: 'admin.track',
      bindings: [{ file: `${SHOP}/TrackBean.java`, line: 5, binder: 'cdi-annotation-named' }],
    })]);
    // the root alone also names a bean in that unit's `billing`: a plain-name reference, by its own name
    const billing = graph.edges.find((e) => e.type === 'references' && label(e.target) === `${SHOP}/BillingBean.java#BillingBean`);
    expect(billing.evidence.map((x) => [x.line, x.token, x.name])).toEqual([[4, 'billing', 'billing']]);
  });

  it('lets a component that only configures another give way to the annotated one, and cites both lines (spec)', () => {
    const label = labeller(graph);
    const edge = graph.edges.find((e) => e.type === 'references' && label(e.target) === `${LEGACY}/NumberGuess.java#NumberGuess`);
    expect(edge.evidence[0].bindings).toEqual([
      { file: `${LEGACY}/NumberGuess.java`, line: 5, binder: 'seam-annotation-name' },
      { file: 'legacy/src/main/resources/components.xml', line: 3, binder: 'seam-xml-component' },
    ]);
  });

  it('does not take the request parameter names of f:param and c:param for local names, but a ui:param\'s (spec)', () => {
    const label = labeller(graph);
    const params = graph.edges.filter((e) => e.type === 'references' && label(e.source) === `${WEB}/orders/params.xhtml`);
    expect(params.map((e) => label(e.target)).sort()).toEqual([
      `${SHOP}/CartBean.java#CartBean`, `${SHOP}/CheckoutBean.java#CheckoutBean`, `${SHOP}/CustomerBean.java#CustomerBean`, `${SHOP}/OrderBean.java#OrderBean`,
    ]);
    // `invoices` is a bean of the unit and a ui:param of the page: local, so no edge to InvoiceBean
    expect(params.some((e) => label(e.target).endsWith('InvoiceBean'))).toBe(false);
  });

  it('makes the alias of a Tomahawk aliasBean local, and resolves its value by binding (spec)', () => {
    const label = labeller(graph);
    const alias = graph.edges.filter((e) => e.type === 'references' && label(e.source) === `${WEB}/alias.jsp`);
    expect(alias.map((e) => label(e.target))).toEqual([`${SHOP}/OrderBean.java#OrderBean`]); // customerBean is the alias, not the bean
  });

  it('goes on after an unterminated expression and reads the one after it (spec)', () => {
    const label = labeller(graph);
    const broken = graph.edges.filter((e) => e.type === 'references' && label(e.source) === `${WEB}/orders/broken.xhtml`);
    expect(broken.map((e) => [label(e.target), e.evidence.map((x) => x.line)])).toEqual([[`${SHOP}/CustomerBean.java#CustomerBean`, [5]]]);
    expect(graph.coverage.nameReferences.unterminated).toBe(1);
  });

  it('adds nothing but references to the graph', () => {
    // the same run's own inputs, projected without the stage
    const intermediate = join(root, '.excavator', 'intermediate');
    const scan = JSON.parse(readFileSync(join(intermediate, 'scan-result.json'), 'utf-8'));
    const structureAll = readStructureAll(join(intermediate, 'structure-all.jsonl'));
    const importMap = JSON.parse(readFileSync(join(intermediate, 'import-map.json'), 'utf-8'));
    const without = buildFactGraph({ scan, structureAll, importMap });
    expect(without.coverage.nameReferences).toEqual({ status: 'not-run' });
    expect(graph.nodes.length).toBe(without.nodes.length);
    // `without` has no mentions stage either: those edges and gaps are the previous step's
    expect(graph.edges.filter((e) => e.type !== 'references' && e.type !== 'mentions').length).toBe(without.edges.length);
    const added = new Set([
      'name-reference-target-unindexed', 'name-reference-target-unknown', 'name-reference-ambiguous', 'name-reference-elsewhere', 'name-reference-unbound',
      'mention-ambiguous', 'mention-target-unindexed', 'path-mention-unresolved',
    ]);
    expect(graph.gaps.filter((g) => !added.has(g.kind))).toEqual(without.gaps);
  });

  it('serves a bean class to the page that uses it, in one hop, through the project service (spec: from a bean class to a page)', async () => {
    const bean = graph.nodes.find((n) => n.type === 'class' && n.name === 'OrderBean');
    const page = graph.nodes.find((n) => n.type === 'file' && n.filePath === `${WEB}/orders/list.xhtml`);
    const hop = oneHop(graph.edges, [bean.id]);
    expect(hop.nodes).toContain(page.id);
    expect(hop.edges.some((e) => e.type === 'references' && e.source === page.id && e.target === bean.id)).toBe(true);
    expect(boundedBFS(graph.edges, [bean.id], { maxHops: 1 }).nodes).toContain(page.id);

    const traversed = await createProjectService(root).traverse({ seedIds: [bean.id], mode: 'one-hop' });
    expect(traversed.status).toBe('ok');
    expect(traversed.data.nodes.map((n) => n.filePath)).toContain(`${WEB}/orders/list.xhtml`);
    expect(traversed.data.edges.map((e) => e.type)).toContain('references');
  });

  it('reports the name-reference coverage and its gaps through project_status', () => {
    const status = createProjectService(root).projectStatus();
    expect(status.status).toBe('ok');
    expect(status.data.factCoverage.nameReferences).toMatchObject({ status: 'ran', rootCount: 76, roots: { edge: 36, unbound: 10 } });
    expect(status.gaps.map((g) => g.kind)).toEqual(expect.arrayContaining([
      'name-reference-ambiguous', 'name-reference-elsewhere', 'name-reference-target-unindexed', 'name-reference-target-unknown', 'name-reference-unbound',
    ]));
  });

  it('passes the graph validator: every references evidence line holds its token, and nothing else is new', () => {
    const { report } = validateAgainstSource({ graph, reader: createSourceReader(root) });
    expect(report.findings.edgeContradicted.filter((f) => f.type === 'references')).toEqual([]);
    // the graph without the references edges reads the same, apart from how many edges were checked and confirmed.
    // (Its `contains` and `exports` edges of annotated classes are contradicted either way: a class's line range
    // starts at its first annotation, a line that does not hold the class's name. That is not this change's.)
    const plain = { ...graph, edges: graph.edges.filter((e) => e.type !== 'references') };
    const { report: baseline } = validateAgainstSource({ graph: plain, reader: createSourceReader(root) });
    expect(report.issues).toEqual(baseline.issues);
    // no new warning; the only ones that go are the orphan warnings of the pages a references edge now reaches
    expect(report.warnings.filter((w) => !baseline.warnings.includes(w))).toEqual([]);
    const reached = new Set(graph.edges.filter((e) => e.type === 'references').flatMap((e) => [e.source, e.target]));
    expect(baseline.warnings.filter((w) => !report.warnings.includes(w)).sort())
      .toEqual([...reached].map((id) => `Node '${id}' has no edges (orphan)`).filter((w) => baseline.warnings.includes(w)).sort());
    // the nine of the earlier units, and the bridge unit's page, which no other edge reached
    expect(baseline.warnings.length - report.warnings.length).toBe(10);
    expect(report.counts).toEqual({
      ...baseline.counts,
      edgesChecked: baseline.counts.edgesChecked + linksOf(graph).length,
      edgeConfirmed: baseline.counts.edgeConfirmed + linksOf(graph).length,
    });
    expect(new Set(report.findings.edgeContradicted.map((f) => f.type))).toEqual(new Set(['contains', 'exports']));
  });

  it('cites lines a reader can check: the page line holds the root, the binding line the name or its annotation (spec: checkable evidence)', () => {
    const catalog = loadNameBindingCatalog();
    const annotationBinders = new Set(catalog.annotationBinders.map((b) => b.id));
    const simpleNames = catalog.annotationBinders.flatMap((b) => b.annotations.map((a) => a.slice(a.lastIndexOf('.') + 1)));
    const lineOf = (file, line) => readFileSync(join(root, file), 'utf-8').split('\n')[line - 1];
    let checked = 0;
    for (const edge of graph.edges.filter((e) => e.type === 'references')) {
      for (const evidence of edge.evidence) {
        expect(lineOf(evidence.file, evidence.line)).toContain(evidence.token);
        for (const binding of evidence.bindings) {
          const text = lineOf(binding.file, binding.line);
          if (annotationBinders.has(binding.binder)) expect(simpleNames.some((n) => text.includes(`@${n}`))).toBe(true);
          else expect(text).toContain(evidence.token);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(24);
  });
});

describe('the name-reference stage uses the catalog it is given', () => {
  it('draws nothing from a catalog whose expression language has no files', async () => {
    const root = copyFixture();
    try {
      const catalog = JSON.parse(JSON.stringify(loadNameBindingCatalog()));
      catalog.expressionLanguages[0].files = { extensions: ['nothing'], xmlRoots: [] };
      const result = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW, nameBindingCatalog: catalog });
      expect(result.saveError).toBeNull();
      const product = readProduct(root);
      expect(linksOf(product)).toEqual([]);
      expect(product.coverage.nameReferences).toMatchObject({ status: 'ran', rootCount: 0, files: {} });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the name-reference stage reads the snapshot, not the live tree', () => {
  it('ignores an uncommitted edit of a page and of a descriptor in a git target', async () => {
    const root = copyFixture();
    try {
      const git = (args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root, stdio: 'ignore' });
      git(['init', '-q']);
      git(['add', '-A']);
      git(['commit', '-q', '-m', 'fixture']);
      // the working tree has a page HEAD lacks, a page HEAD has empty of expressions, and a descriptor touched
      appendFileSync(join(root, WEB, 'WEB-INF', 'faces-config.xml'), '\n');
      writeFileSync(join(root, WEB, 'orders', 'row.xhtml'), '<ui:composition>#{customerBean.name}</ui:composition>\n');
      writeFileSync(join(root, WEB, 'extra.xhtml'), '<p>#{customerBean.name}</p>\n');
      const result = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
      expect(result.saveError).toBeNull();
      expect(linksOf(readProduct(root))).toEqual(EXPECTED_LINKS);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
