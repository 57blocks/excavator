// name-mention-facts, tasks 3.1-3.4: the `mentions` stage in the real Lazy
// driver, the traversal of `mentions` edges, and the graph validator on the
// product. The fixture is a purpose-built synthetic JSF / Java EE project
// (tests/fixtures/jsf-name-mentions); it is copied to a temp directory
// because a Lazy run writes `.excavator/` next to the source.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { buildFactGraph } from '../../skills/excavator/build-fact-graph.mjs';
import { createProjectService } from '../../skills/excavator/project-service.mjs';
import { KNOWLEDGE_GRAPH_FILE, readKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';
import { readStructureAll } from '../../skills/excavator/structure-all-store.mjs';
import { createSourceReader, validateAgainstSource } from '../../skills/excavator/validate-graph.mjs';
import { oneHop } from '../../skills/excavator/retrieve.mjs';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/jsf-name-mentions');
const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';
const APP = 'app/src/main/webapp';
const JAVA = 'app/src/main/java/com/acme';

function copyFixture() {
  const root = mkdtempSync(join(tmpdir(), 'excavator-mentions-'));
  cpSync(FIXTURE, root, { recursive: true });
  // Two files the scanner skips as too large. They are generated, not checked
  // in; the fixture mentions both (beans.xml and app.properties), so without
  // them those mentions would be unresolved.
  writeFileSync(join(root, APP, 'WEB-INF', 'catalog.xml'), `<catalog>\n${'<entry/>\n'.repeat(20_000)}</catalog>\n`); // more than 20,000 lines
  mkdirSync(join(root, JAVA, 'gen'), { recursive: true });
  writeFileSync(join(root, JAVA, 'gen', 'Huge.java'), `/*${'x'.repeat(2_200_000)}*/\npackage com.acme.gen;\n\npublic class Huge {\n}\n`); // more than 2 MB
  return root;
}

const readProduct = (root) => readKnowledgeGraph(join(root, '.excavator', KNOWLEDGE_GRAPH_FILE));

/** `source -> target` per mentions edge, files by path and classes by `path#Name`. */
function linksOf(graph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const label = (id) => {
    const node = byId.get(id);
    return node.type === 'file' ? node.filePath : `${node.filePath}#${node.name}`;
  };
  return graph.edges.filter((e) => e.type === 'mentions').map((e) => `${label(e.source)} -> ${label(e.target)}`).sort();
}

const EXPECTED_LINKS = [
  `app/src/main/resources/app.properties -> ${JAVA}/util/Limits.java#Limits`,
  `app/src/main/resources/spring/beans.xml -> ${JAVA}/service/OrderService.java#OrderService`,
  `${APP}/WEB-INF/faces-config.xml -> ${JAVA}/web/OrderBean.java#OrderBean`,
  `${APP}/WEB-INF/faces-config.xml -> ${APP}/orders/detail.xhtml`,
  `${APP}/WEB-INF/faces-config.xml -> ${APP}/orders/list.xhtml`,
  `${APP}/WEB-INF/web.xml -> ${APP}/WEB-INF/spring/extra-context.xml`,
  `${APP}/WEB-INF/web.xml -> ${APP}/index.jsp`,
  `${APP}/WEB-INF/web.xml -> ${JAVA}/web/OrderFilter.java#OrderFilter`,
  `${APP}/WEB-INF/web.xml -> ${JAVA}/web/OrderListener.java#OrderListener`,
  `${APP}/WEB-INF/web.xml -> ${JAVA}/web/OrderServlet.java#OrderServlet`,
  `${APP}/WEB-INF/web.xml -> app/src/main/resources/spring/beans.xml`,
  `${APP}/index.jsp -> ${APP}/header.jsp`,
  `${APP}/index.jsp -> ${JAVA}/util/Limits.java#Limits`,
  `${APP}/index.jsp -> ${JAVA}/web/OrderBean.java#OrderBean`,
  `${APP}/orders/detail.xhtml -> ${APP}/WEB-INF/templates/main.xhtml`,
  `${APP}/orders/detail.xhtml -> ${APP}/orders/row.xhtml`,
  `${APP}/orders/list.xhtml -> ${APP}/WEB-INF/templates/main.xhtml`,
  `${APP}/orders/list.xhtml -> ${APP}/orders/row.xhtml`,
  'legacy/src/main/webapp/old.xhtml -> legacy/src/main/webapp/WEB-INF/templates/main.xhtml',
].sort();

describe('the mentions stage in the real Lazy driver', () => {
  let root;
  let result;
  let graph;
  beforeAll(async () => {
    root = copyFixture();
    result = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    graph = readProduct(root);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('runs after the import map and before the fact graph, and is timed', () => {
    expect(result.saveError).toBeNull();
    const stages = Object.keys(result.timings);
    expect(stages.indexOf('mentions')).toBeGreaterThan(stages.indexOf('importMap'));
    expect(stages.indexOf('mentions')).toBeLessThan(stages.indexOf('factGraph'));
    expect(Number.isInteger(result.timings.mentions)).toBe(true);
  });

  it('prints mentions= on the CLI stages line', () => {
    const other = copyFixture();
    try {
      const run = spawnSync('node', [resolve(FIXTURE, '../../../skills/excavator/lazy-analyze.mjs'), other], { encoding: 'utf-8' });
      expect(run.status).toBe(0);
      expect(run.stderr).toMatch(/lazy-analyze: stages .*importMap=\d+ms mentions=\d+ms factGraph=\d+ms/);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('draws the expected mentions edges from descriptors, pages and properties', () => {
    expect(linksOf(graph)).toEqual(EXPECTED_LINKS);
    expect(graph.edges.filter((e) => e.type === 'mentions').every((e) => e.provenance === 'extracted' && e.evidence.length > 0)).toBe(true);
  });

  it('keeps a commented-out bean, a commented properties line and a commented include out', () => {
    const links = linksOf(graph);
    expect(links.some((l) => l.includes('Legacy.java'))).toBe(false);
    expect(links.some((l) => l.includes('retired.jsp'))).toBe(false);
  });

  it('resolves a nested type, a member suffix and a classpath pattern', () => {
    const edge = (from, to) => graph.edges.find((e) => e.type === 'mentions' && e.source.endsWith(from) && e.target.includes(to));
    expect(edge('beans.xml', 'OrderService').evidence.map((e) => e.token)).toEqual(['com.acme.service.OrderService', 'com.acme.service.OrderService$Handler']);
    expect(edge('app.properties', 'Limits').evidence[0].token).toBe('com.acme.util.Limits.MAX_SIZE');
    const toBeans = edge('web.xml', 'resources/spring/beans.xml');
    expect(toBeans.evidence).toEqual([expect.objectContaining({ token: 'classpath*:spring/*.xml', resolution: 'pattern', context: { element: 'param-value', attribute: null } })]);
    // the same file also named by its own path: both mentions on one edge
    const toExtra = edge('web.xml', 'WEB-INF/spring/extra-context.xml');
    expect(toExtra.evidence.map((e) => [e.token, e.resolution]).sort()).toEqual([
      ['/WEB-INF/spring/extra-context.xml', 'web-root'], ['classpath*:spring/*.xml', 'pattern'],
    ]);
  });

  it('resolves each web application to its own template', () => {
    const links = linksOf(graph);
    expect(links).toContain('legacy/src/main/webapp/old.xhtml -> legacy/src/main/webapp/WEB-INF/templates/main.xhtml');
    expect(links).not.toContain(`legacy/src/main/webapp/old.xhtml -> ${APP}/WEB-INF/templates/main.xhtml`);
  });

  it('makes what it could not resolve visible, by kind', () => {
    const gap = (kind, scope) => graph.gaps.find((g) => g.kind === kind && g.scope === scope);
    expect(gap('mention-ambiguous', 'xml')).toMatchObject({ count: 1 });
    expect(gap('mention-ambiguous', 'xml').samples).toEqual([
      'app/src/main/resources/spring/beans.xml:4 com.acme.Config -> [app/src/main/java/com/acme/Config.java, legacy/src/main/java/com/acme/Config.java]',
    ]);
    expect(gap('path-mention-unresolved', 'xhtml')).toMatchObject({ count: 1 });
    expect(gap('path-mention-unresolved', 'xhtml').samples).toEqual([`${APP}/orders/detail.xhtml:5 /WEB-INF/missing/footer.xhtml -> []`]);
    expect(linksOf(graph).some((l) => l.includes('Audited') || l.includes('Huge') || l.includes('catalog'))).toBe(false);
    expect(graph.nodes.some((n) => n.type === 'class' && ['Audited', 'Huge'].includes(n.name))).toBe(false); // the premise
  });

  it('calls what the repository has but the index has no node for unindexed, not outside', () => {
    const unindexed = (scope) => graph.gaps.find((g) => g.kind === 'mention-target-unindexed' && g.scope === scope);
    // an annotation type (Core makes no class node for it) and a Java file the scanner skipped as too large:
    // their packages are the ones the files declare, read from the snapshot
    expect(unindexed('xml')).toMatchObject({ count: 2 });
    expect(unindexed('xml').samples).toEqual([
      'app/src/main/resources/spring/beans.xml:7 com.acme.Audited -> [com.acme.Audited]',
      'app/src/main/resources/spring/beans.xml:8 com.acme.gen.Huge -> [com.acme.gen.Huge]',
    ]);
    // a path to a file the scanner skipped as too large exists: named with its reason, not "no such file"
    expect(unindexed('properties')).toMatchObject({ count: 1 });
    expect(unindexed('properties').samples).toEqual([`app/src/main/resources/app.properties:3 WEB-INF/catalog.xml -> [${APP}/WEB-INF/catalog.xml (too-large)]`]);
  });

  it('does not take a directory named like a package for a declaration', () => {
    // org/acme/ejb3/Foo.java is indexed, and app.properties says `ejb3.Foo`: that is no type of the repository
    const sample = graph.gaps.filter((g) => g.kind.startsWith('mention')).flatMap((g) => g.samples);
    expect(sample.some((line) => line.includes('ejb3.Foo'))).toBe(false);
    expect(graph.nodes.some((n) => n.type === 'class' && n.name === 'Foo')).toBe(true);
  });

  it('records the stage in coverage, with every candidate accounted for', () => {
    const mentions = graph.coverage.mentions;
    expect(mentions.status).toBe('ran');
    expect(mentions.files).toEqual({ properties: 1, xhtml: 6, xml: 4, jsp: 2 });
    // the generated too-large catalog.xml was not lexed; the too-large Java file is code and is not counted here
    expect(mentions.skipped).toEqual({ 'too-large': 1 });
    const { fqn, path } = mentions;
    expect(fqn.edge + fqn.ambiguous + fqn.unindexed + fqn.external).toBe(fqn.candidates);
    expect(path.edge + path.ambiguous + path.unresolved + path.self + path.unindexed).toBe(path.candidates);
    expect(fqn.unindexed).toBe(2);
    expect(path).toMatchObject({ unindexed: 1, unindexedHits: 0 });
    expect(result.coverage.mentions).toEqual(mentions);
  });

  it('adds nothing but mentions to the graph', () => {
    // the same run's own inputs, projected without the stage
    const intermediate = join(root, '.excavator', 'intermediate');
    const scan = JSON.parse(readFileSync(join(intermediate, 'scan-result.json'), 'utf-8'));
    const structureAll = readStructureAll(join(intermediate, 'structure-all.jsonl'));
    const importMap = JSON.parse(readFileSync(join(intermediate, 'import-map.json'), 'utf-8'));
    const without = buildFactGraph({ scan, structureAll, importMap });
    expect(without.coverage.mentions).toEqual({ status: 'not-run' });
    expect(graph.nodes.length).toBe(without.nodes.length);
    expect(graph.edges.filter((e) => e.type !== 'mentions').length).toBe(without.edges.length);
    const mentionKinds = new Set(['mention-ambiguous', 'mention-target-unindexed', 'path-mention-unresolved']);
    expect(graph.gaps.filter((g) => !mentionKinds.has(g.kind))).toEqual(without.gaps);
  });

  it('reaches the descriptor that wires a servlet class, from the class, in one hop', () => {
    const servlet = graph.nodes.find((n) => n.type === 'class' && n.name === 'OrderServlet');
    const webXml = graph.nodes.find((n) => n.type === 'file' && n.filePath === `${APP}/WEB-INF/web.xml`);
    const hop = oneHop(graph.edges, [servlet.id]);
    expect(hop.nodes).toContain(webXml.id);
    expect(hop.edges.some((e) => e.type === 'mentions' && e.source === webXml.id && e.target === servlet.id)).toBe(true);
  });

  it('serves that traversal through the project service', async () => {
    const servlet = graph.nodes.find((n) => n.type === 'class' && n.name === 'OrderServlet');
    const traversed = await createProjectService(root).traverse({ seedIds: [servlet.id], mode: 'one-hop' });
    expect(traversed.status).toBe('ok');
    expect(traversed.data.nodes.map((n) => n.filePath)).toContain(`${APP}/WEB-INF/web.xml`);
    expect(traversed.data.edges.map((e) => e.type)).toContain('mentions');
  });

  it('passes the graph validator: every mentions evidence line holds its token', () => {
    const { report } = validateAgainstSource({ graph, reader: createSourceReader(root) });
    const mentionsFindings = report.findings.edgeContradicted.filter((f) => f.type === 'mentions');
    expect(mentionsFindings).toEqual([]);
    expect(report.counts.edgeContradicted).toBe(0);
    expect(report.counts.edgeConfirmed).toBeGreaterThan(EXPECTED_LINKS.length - 1);
  });
});

describe('the mentions stage reads the snapshot, not the live tree', () => {
  it('ignores an uncommitted edit of a descriptor in a git target', async () => {
    const root = copyFixture();
    try {
      const git = (args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root, stdio: 'ignore' });
      git(['init', '-q']);
      git(['add', '-A']);
      git(['commit', '-q', '-m', 'fixture']);
      // HEAD does not mention Legacy; the working tree does
      appendFileSync(join(root, APP, 'WEB-INF', 'web.xml'), '<listener-class>com.acme.Legacy</listener-class>\n');
      writeFileSync(join(root, 'app/src/main/resources/extra.properties'), 'k=com.acme.Legacy\n');
      const result = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
      expect(result.saveError).toBeNull();
      const product = readProduct(root);
      expect(linksOf(product)).toEqual(EXPECTED_LINKS);
      // the same files, skipped as too large in the HEAD snapshot, are read from it too
      const unindexed = product.gaps.filter((g) => g.kind === 'mention-target-unindexed').flatMap((g) => g.samples);
      expect(unindexed).toContain('app/src/main/resources/spring/beans.xml:8 com.acme.gen.Huge -> [com.acme.gen.Huge]');
      expect(unindexed).toContain(`app/src/main/resources/app.properties:3 WEB-INF/catalog.xml -> [${APP}/WEB-INF/catalog.xml (too-large)]`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
