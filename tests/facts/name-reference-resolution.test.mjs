// name-binding-references, tasks 4.1-4.5: resolution of the root names of
// expressions into `references` edges, gaps and coverage, inside buildFactGraph.
//
// Every fixture is a small synthetic project built in memory. Java rows are what
// Core really emits for the source text (so the shape of `annotationArguments`
// is the real one); non-code files go through the real name-reference stage
// (name-reference-sites.mjs) and the mentions stage (mention-sites.mjs), which
// reads the package of annotation-type files, so these tests also pin the
// stage-to-resolver handoff.
import { beforeAll, describe, expect, it } from 'vitest';
import { extname } from 'node:path';
import { PluginRegistry, TreeSitterPlugin, builtinLanguageConfigs, registerAllParsers } from '@excavator/core';
import { analyzeFileWithOutcomes, buildResult } from '../../skills/excavator/extract-structure-result.mjs';
import { buildFactGraph } from '../../skills/excavator/build-fact-graph.mjs';
import { collectMentionSites } from '../../skills/excavator/mention-sites.mjs';
import { collectNameReferenceSites } from '../../skills/excavator/name-reference-sites.mjs';
import { loadNameBindingCatalog } from '../../skills/excavator/name-binding-catalog.mjs';
import {
  NAME_REFERENCE_BUCKETS,
  assertNameReferenceConservation,
  createUnitIndex,
} from '../../skills/excavator/name-reference-resolution.mjs';

let registry;
beforeAll(async () => {
  const tsPlugin = new TreeSitterPlugin(builtinLanguageConfigs.filter((c) => c.treeSitter));
  await tsPlugin.init();
  registry = new PluginRegistry();
  registry.register(tsPlugin);
  registerAllParsers(registry);
});

const CATALOG = loadNameBindingCatalog();
const LANGUAGE_OF_EXTENSION = { xml: 'xml', xhtml: 'xhtml', jsp: 'jsp', tag: 'tag', properties: 'properties', html: 'html', kt: 'kotlin' };
const lines = (text) => (Array.isArray(text) ? text.join('\n') : text);

/** A Java source file: package, imports, then the body. */
const javaSource = (pkg, imports, body) => [`package ${pkg};`, ...imports, '', ...[body].flat(), ''].join('\n');

/**
 * @param {{
 *   java?: Record<string, string|string[]>,   path -> source text
 *   files?: Record<string, string|string[]>,  path -> text of a non-code file
 *   catalog?: object,
 *   mutations?: object,                       resolution-stage tripwires (buildFactGraph)
 *   siteMutations?: object,                   reading-stage tripwires (collector)
 *   omit?: boolean,                           run buildFactGraph without the name-reference stage
 * }} spec
 */
function project({ java = {}, files = {}, catalog = CATALOG, mutations, siteMutations, omit = false } = {}) {
  const scanFiles = [];
  const results = [];
  const texts = {};
  for (const [path, source] of Object.entries(java)) {
    const text = lines(source);
    texts[path] = text;
    const file = { path, language: 'java', fileCategory: 'code' };
    const extracted = analyzeFileWithOutcomes(registry, file, text);
    expect(extracted.structureOutcome).toBe('succeeded');
    const split = text.split('\n');
    scanFiles.push({ ...file, sizeLines: split.length });
    results.push(buildResult(file, split.length, split.filter((l) => l.trim()).length, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome));
  }
  for (const [path, source] of Object.entries(files)) {
    const text = lines(source);
    texts[path] = text;
    const language = LANGUAGE_OF_EXTENSION[extname(path).slice(1)] ?? 'unknown';
    scanFiles.push({ path, language, sizeLines: text.split('\n').length, fileCategory: 'code' });
    results.push({ path, language, fileCategory: 'code', totalLines: text.split('\n').length, nonEmptyLines: 1, status: 'no-extractor', metrics: {} });
  }
  const scan = { files: scanFiles, skipped: [], coverage: { limits: { maxFileLines: 20000, maxFileBytes: 2097152 } } };
  const structureAll = { results };
  const importMap = { importMap: Object.fromEntries(scanFiles.map((f) => [f.path, []])), unresolved: {} };
  const readFile = (path) => {
    if (!(path in texts)) throw new Error(`the snapshot holds no ${path}`);
    return texts[path];
  };

  // what the Lazy driver does: both stages over the manifest and the snapshot
  const mentionStage = collectMentionSites({ scan, structureAll, readFile });
  const sites = omit ? undefined : collectNameReferenceSites({ scan, catalog, readFile, mutations: siteMutations });
  const graph = buildFactGraph({
    scan, structureAll, importMap,
    mentionSites: mentionStage.sites, mentionInputs: mentionStage.inputs,
    nameReferenceSites: sites, nameBindingCatalog: omit ? undefined : catalog, nameReferenceMutations: mutations,
  });
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const label = (id) => {
    const node = byId.get(id);
    return node.type === 'file' ? node.filePath : `${node.filePath}#${node.name}`;
  };
  const references = graph.edges.filter((e) => e.type === 'references');
  return {
    graph,
    texts,
    sites,
    references,
    /** `page -> class` per references edge, sorted. */
    links: references.map((e) => `${label(e.source)} -> ${label(e.target)}`).sort(),
    edge: (from, to) => references.find((e) => label(e.source) === from && label(e.target) === to),
    gaps: (kind) => graph.gaps.filter((g) => g.kind === kind),
    samples: (kind) => graph.gaps.filter((g) => g.kind === kind).flatMap((g) => g.samples),
    coverage: graph.coverage.nameReferences,
    roots: graph.coverage.nameReferences.roots,
  };
}

const POM = '<project/>';
const BEAN = (pkg, name, annotation = '@Named', imports = ['import javax.inject.Named;']) =>
  javaSource(pkg, imports, [annotation, `public class ${name} {}`]);

// ---------------------------------------------------------------------------
// Requirement: deployment units
// ---------------------------------------------------------------------------

describe('deployment units (design D5)', () => {
  const units = (paths, descriptors = CATALOG.unitDescriptors) => createUnitIndex(paths, descriptors);

  it('is the nearest ancestor directory that holds a descriptor', () => {
    const index = units(['a/pom.xml', 'a/b/pom.xml', 'a/b/x/y.xhtml', 'a/z.xhtml', 'a/b/c/build.gradle', 'a/b/c/d.xhtml']);
    expect(index.unitOf('a/b/x/y.xhtml')).toBe('a/b');
    expect(index.unitOf('a/z.xhtml')).toBe('a');
    expect(index.unitOf('a/b/c/d.xhtml')).toBe('a/b/c');
  });

  it('puts a descriptor, and a file beside it, in the unit of that directory', () => {
    const index = units(['m/pom.xml', 'm/page.xhtml']);
    expect(index.unitOf('m/pom.xml')).toBe('m');
    expect(index.unitOf('m/page.xhtml')).toBe('m');
  });

  it('puts a file with no descriptor above it in the repository unit, which is not the root unit', () => {
    const none = units(['a/pom.xml', 'loose/x.xhtml', 'top.xhtml']);
    expect(none.unitOf('loose/x.xhtml')).toBeNull();
    expect(none.unitOf('top.xhtml')).toBeNull();
    const rooted = units(['pom.xml', 'a/x.xhtml', 'top.xhtml']);
    expect(rooted.unitOf('a/x.xhtml')).toBe('');
    expect(rooted.unitOf('top.xhtml')).toBe('');
  });

  it('knows a descriptor by the names the catalog lists, whole', () => {
    const index = units(['a/build.gradle.kts', 'a/x.xhtml', 'b/pom.xml.bak', 'b/y.xhtml', 'c/Dockerfile', 'c/z.xhtml']);
    expect(index.unitOf('a/x.xhtml')).toBe('a');
    expect(index.unitOf('b/y.xhtml')).toBeNull();
    expect(units(['c/Dockerfile', 'c/z.xhtml'], ['Dockerfile']).unitOf('c/z.xhtml')).toBe('c');
  });

  it('counts the units and the expression files in the repository unit in the coverage', () => {
    const p = project({
      files: {
        'one/pom.xml': POM, 'one/a.xhtml': '<p>#{x.y}</p>',
        'two/pom.xml': POM, 'two/nested/pom.xml': POM, 'two/nested/b.xhtml': '<p>#{x.y}</p>',
        'loose/c.xhtml': '<p>#{x.y}</p>', 'loose/d.xhtml': '<p>no expression</p>',
      },
    });
    expect(p.coverage.units).toBe(3);
    expect(p.coverage.repositoryUnitFiles).toBe(2);
    expect(p.coverage.files).toEqual({ xhtml: 4 });
  });
});

// ---------------------------------------------------------------------------
// Requirement: annotation bindings
// ---------------------------------------------------------------------------

describe('annotation bindings (spec: name binding)', () => {
  const page = (...expressions) => ({ 'app/pom.xml': POM, 'app/web/p.xhtml': expressions.map((e) => `<p>${e}</p>`) });
  const BEAN_PATH = (name) => `app/src/com/acme/web/${name}.java`;
  const LINK = (name) => `app/web/p.xhtml -> ${BEAN_PATH(name)}#${name}`;

  it('names a @Named class with no argument by its class name, first character lowered (spec: CDI default name)', () => {
    const p = project({ java: { [BEAN_PATH('CustomerBean')]: BEAN('com.acme.web', 'CustomerBean') }, files: page('#{customerBean.name}') });
    expect(p.links).toEqual([LINK('CustomerBean')]);
    expect(p.coverage.bindings['cdi-annotation-named']).toBe(1);
    expect(p.edge('app/web/p.xhtml', `${BEAN_PATH('CustomerBean')}#CustomerBean`).evidence[0].bindings).toEqual([
      { file: BEAN_PATH('CustomerBean'), line: 4, binder: 'cdi-annotation-named' },
    ]);
  });

  it('takes an explicit name, and an empty string or empty parentheses as no name', () => {
    const p = project({
      java: {
        [BEAN_PATH('A')]: BEAN('com.acme.web', 'A', '@Named("orders")'),
        [BEAN_PATH('B')]: BEAN('com.acme.web', 'B', '@Named("")'),
        [BEAN_PATH('C')]: BEAN('com.acme.web', 'C', '@Named()'),
        [BEAN_PATH('D')]: BEAN('com.acme.web', 'D', '@Named(value = "dee")'),
      },
      files: page('#{orders.x} #{b.x} #{c.x} #{dee.x} #{a.x}'),
    });
    expect(p.links).toEqual([LINK('A'), LINK('B'), LINK('C'), LINK('D')]);
    expect(p.roots.unbound).toBe(1); // `a`: the class is A, the name is orders
  });

  it('names a @ManagedBean by name, or by its class name (JSF)', () => {
    const imports = ['import javax.faces.bean.ManagedBean;'];
    const p = project({
      java: {
        [BEAN_PATH('Cart')]: BEAN('com.acme.web', 'Cart', '@ManagedBean(name = "basket", eager = true)', imports),
        [BEAN_PATH('Order')]: BEAN('com.acme.web', 'Order', '@ManagedBean', imports),
      },
      files: page('#{basket.x} #{order.y} #{cart.z}'),
    });
    expect(p.links).toEqual([LINK('Cart'), LINK('Order')]);
    expect(p.roots).toMatchObject({ edge: 2, unbound: 1 });
  });

  it('names a @Model class by its class name, in either namespace of the annotation (CDI)', () => {
    const p = project({
      java: {
        [BEAN_PATH('Checkout')]: BEAN('com.acme.web', 'Checkout', '@Model', ['import javax.enterprise.inject.Model;']),
        [BEAN_PATH('Jakarta')]: BEAN('com.acme.web', 'Jakarta', '@jakarta.inject.Named', []),
      },
      files: page('#{checkout.x} #{jakarta.y}'),
    });
    expect(p.links).toEqual([LINK('Checkout'), LINK('Jakarta')]);
    expect(p.coverage.bindings).toMatchObject({ 'cdi-annotation-model': 1, 'cdi-annotation-named': 1 });
  });

  it('keeps a leading run of capitals for a Spring component, and lowers only one for the others (spec: Spring default name)', () => {
    const faces = '<faces-config><application><el-resolver>org.springframework.web.jsf.el.SpringBeanFacesELResolver</el-resolver></application></faces-config>';
    const p = project({
      java: {
        [BEAN_PATH('URLHelper')]: BEAN('com.acme.web', 'URLHelper', '@Component', ['import org.springframework.stereotype.Component;']),
        [BEAN_PATH('Plain')]: BEAN('com.acme.web', 'Plain', '@Service', ['import org.springframework.stereotype.Service;']),
        [BEAN_PATH('Cdi')]: BEAN('com.acme.web', 'Cdi', '@Named', ['import javax.inject.Named;']),
        [BEAN_PATH('UrlLower')]: BEAN('com.acme.web', 'UrlLower', '@Named'),
      },
      files: { ...page('#{URLHelper.a} #{uRLHelper.b} #{plain.c}'), 'app/WEB-INF/faces-config.xml': faces },
    });
    expect(p.links).toEqual([LINK('Plain'), LINK('URLHelper')]);
    expect(p.roots).toMatchObject({ edge: 2, unbound: 1 }); // uRLHelper is not a name anything has
  });

  it('keeps a Spring component\'s explicit name', () => {
    const faces = '<faces-config><application><el-resolver>org.springframework.web.jsf.el.SpringBeanFacesELResolver</el-resolver></application></faces-config>';
    const p = project({
      java: { [BEAN_PATH('Svc')]: BEAN('com.acme.web', 'Svc', '@Repository("store")', ['import org.springframework.stereotype.Repository;']) },
      files: { ...page('#{store.a}'), 'app/WEB-INF/faces-config.xml': faces },
    });
    expect(p.links).toEqual([LINK('Svc')]);
  });

  it('names a Seam component by @Name, and by every @Role as well', () => {
    const imports = ['import org.jboss.seam.annotations.Name;', 'import org.jboss.seam.annotations.Role;'];
    const p = project({
      java: { [BEAN_PATH('Home')]: BEAN('com.acme.web', 'Home', ['@Name("orderHome")', '@Role(name = "currentOrder")'].join('\n'), imports) },
      files: page('#{orderHome.a} #{currentOrder.b} #{home.c}'),
    });
    expect(p.links).toEqual([LINK('Home')]);
    expect(p.coverage.bindings).toMatchObject({ 'seam-annotation-name': 1, 'seam-annotation-role': 1 });
    expect(p.roots).toMatchObject({ edge: 2, unbound: 1 });
    // the Role is on line 6 of the file
    expect(p.edge('app/web/p.xhtml', `${BEAN_PATH('Home')}#Home`).evidence.find((e) => e.token === 'currentOrder').bindings)
      .toEqual([{ file: BEAN_PATH('Home'), line: 6, binder: 'seam-annotation-role' }]);
  });

  it('makes no binding of a Seam @Name with no value, and counts it', () => {
    const p = project({
      java: { [BEAN_PATH('Bare')]: BEAN('com.acme.web', 'Bare', '@Name', ['import org.jboss.seam.annotations.Name;']) },
      files: page('#{bare.a}'),
    });
    expect(p.links).toEqual([]);
    expect(p.coverage.missingNames['seam-annotation-name']).toBe(1);
    expect(Object.values(p.coverage.missingNames).reduce((a, b) => a + b, 0)).toBe(1);
    expect(p.roots.unbound).toBe(1);
  });

  it('makes no binding of a name that is not a constant string, and counts it (spec: non-literal name)', () => {
    const p = project({
      java: { [BEAN_PATH('Dyn')]: BEAN('com.acme.web', 'Dyn', '@Named(Names.ORDERS)') },
      files: page('#{dyn.a}'),
    });
    expect(p.links).toEqual([]);
    expect(p.coverage.nonLiteralNames).toBe(1);
    expect(p.coverage.bindings['cdi-annotation-named']).toBe(0);
  });

  it('keeps a name that is no EL identifier out of the table, and counts it', () => {
    const p = project({
      java: { [BEAN_PATH('Dotted')]: BEAN('com.acme.web', 'Dotted', '@Named("order-home")') },
      files: page('#{order.a}'),
    });
    expect(p.coverage.nonIdentifierNames).toBe(1);
    expect(p.coverage.bindings['cdi-annotation-named']).toBe(0);
    expect(p.links).toEqual([]);
  });

  it('is not fooled by an annotation of the same name declared in the class\'s own package (spec: a same-named custom annotation)', () => {
    const p = project({
      java: {
        'app/src/com/acme/web/Named.java': 'package com.acme.web;\n\npublic @interface Named { String value(); }\n',
        [BEAN_PATH('Mine')]: javaSource('com.acme.web', [], ['@Named("x")', 'public class Mine {}']),
      },
      files: page('#{x.a}'),
    });
    expect(p.links).toEqual([]);
    expect(p.coverage.bindings['cdi-annotation-named']).toBe(0);
    expect(p.coverage.unconfirmedAnnotations).toEqual({}); // it is the repository's own, not a failed confirmation
  });

  it('prefers a same-package declaration to an on-demand import, as Java does', () => {
    const p = project({
      java: {
        'app/src/com/acme/web/Named.java': 'package com.acme.web;\n\npublic @interface Named { String value(); }\n',
        [BEAN_PATH('Mine')]: javaSource('com.acme.web', ['import javax.inject.*;'], ['@Named("x")', 'public class Mine {}']),
      },
      files: page('#{x.a}'),
    });
    expect(p.links).toEqual([]);
    expect(p.coverage.unconfirmedAnnotations).toEqual({});
  });

  it('prefers a single-type import to a same-package declaration', () => {
    const p = project({
      java: {
        'app/src/com/acme/web/Named.java': 'package com.acme.web;\n\npublic @interface Named { String value(); }\n',
        [BEAN_PATH('Mine')]: javaSource('com.acme.web', ['import javax.inject.Named;'], ['@Named("x")', 'public class Mine {}']),
      },
      files: page('#{x.a}'),
    });
    expect(p.links).toEqual([LINK('Mine')]);
  });

  it('does not take a Guice @Named for CDI\'s, by single-type import (no binding, no count)', () => {
    const p = project({
      java: { [BEAN_PATH('Guice')]: BEAN('com.acme.web', 'Guice', '@Named("x")', ['import com.google.inject.name.Named;']) },
      files: page('#{x.a}'),
    });
    expect(p.links).toEqual([]);
    expect(p.coverage.unconfirmedAnnotations).toEqual({});
  });

  it('counts a @Named it cannot confirm: only an on-demand import of another package (spec: an annotation it cannot confirm)', () => {
    const p = project({
      java: { [BEAN_PATH('Guice')]: BEAN('com.acme.web', 'Guice', '@Named("x")', ['import com.google.inject.name.*;']) },
      files: page('#{x.a}'),
    });
    expect(p.links).toEqual([]);
    expect(p.coverage.unconfirmedAnnotations).toEqual({ Named: 1 });
    expect(p.coverage.bindings['cdi-annotation-named']).toBe(0);
  });

  it('counts a @Named that has no import at all, by the way it is written', () => {
    const p = project({
      java: { [BEAN_PATH('Lost')]: BEAN('com.acme.web', 'Lost', '@Named("x")', []) },
      files: page('#{x.a}'),
    });
    expect(p.coverage.unconfirmedAnnotations).toEqual({ Named: 1 });
  });

  it('confirms an annotation through the one on-demand import that provides it', () => {
    const p = project({
      java: { [BEAN_PATH('Wild')]: BEAN('com.acme.web', 'Wild', '@Named("x")', ['import javax.inject.*;', 'import java.util.*;']) },
      files: page('#{x.a}'),
    });
    expect(p.links).toEqual([LINK('Wild')]);
  });

  it('does not confirm through two on-demand imports that both provide it', () => {
    const p = project({
      java: { [BEAN_PATH('Two')]: BEAN('com.acme.web', 'Two', '@Named("x")', ['import javax.inject.*;', 'import jakarta.inject.*;']) },
      files: page('#{x.a}'),
    });
    expect(p.links).toEqual([]);
    expect(p.coverage.unconfirmedAnnotations).toEqual({ Named: 1 });
  });

  it('does not count an annotation the catalog has no simple name for', () => {
    const p = project({
      java: { [BEAN_PATH('Other')]: BEAN('com.acme.web', 'Other', '@Singleton', ['import javax.inject.Singleton;']) },
      files: page('#{other.a}'),
    });
    expect(p.coverage.unconfirmedAnnotations).toEqual({});
    expect(p.coverage.nonLiteralNames + p.coverage.nonIdentifierNames + Object.values(p.coverage.missingNames).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('gives a class with no node as the target "unindexed" (a duplicated declaration collides on one id)', () => {
    const p = project({
      java: { [BEAN_PATH('Twin')]: javaSource('com.acme.web', ['import javax.inject.Named;'], ['@Named', 'class Twin {}', '@Named("other")', 'class Twin {}']) },
      files: page('#{twin.a}'),
    });
    expect(p.links).toEqual([]);
    expect(p.roots.unindexed).toBe(1);
    expect(p.samples('name-reference-target-unindexed')).toEqual([`app/web/p.xhtml:1 twin -> [com.acme.web.Twin]`]);
  });

  it('reads annotations of Java files only: nothing of a Kotlin file', () => {
    const p = project({
      files: {
        ...page('#{kt.a}'),
        'app/src/com/acme/web/Kt.kt': 'package com.acme.web\n@Named("kt")\nclass Kt\n',
      },
    });
    expect(p.links).toEqual([]);
    expect(p.roots.unbound).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Requirement: EL names produce references edges
// ---------------------------------------------------------------------------

describe('references edges (spec: EL names produce references edges)', () => {
  const FACES = (...beans) => [
    '<faces-config>',
    ...beans.map(([name, cls]) => `  <managed-bean><managed-bean-name>${name}</managed-bean-name><managed-bean-class>${cls}</managed-bean-class></managed-bean>`),
    '</faces-config>',
  ];
  const ORDER = javaSource('com.acme.web', [], ['public class OrderBean {', '}']);
  const ORDER_PATH = 'app/src/com/acme/web/OrderBean.java';

  it('draws an edge from a page to the bean faces-config declares, with the line, the root, the chain and the binding (spec)', () => {
    const p = project({
      java: { [ORDER_PATH]: ORDER },
      files: {
        'app/pom.xml': POM,
        'app/web/orders/list.xhtml': ['<html>', '', '', '', '', '', '', '  <h:commandButton action="#{orders.save}"/>', '</html>'],
        'app/web/WEB-INF/faces-config.xml': FACES(['orders', 'com.acme.web.OrderBean']),
      },
    });
    expect(p.links).toEqual([`app/web/orders/list.xhtml -> ${ORDER_PATH}#OrderBean`]);
    const edge = p.references[0];
    expect(edge).toMatchObject({ type: 'references', direction: 'forward', weight: 0.5, provenance: 'extracted' });
    expect(edge.evidence).toEqual([{
      file: 'app/web/orders/list.xhtml',
      line: 8,
      source: 'lexical',
      token: 'orders',
      chain: 'orders.save',
      name: 'orders',
      bindings: [{ file: 'app/web/WEB-INF/faces-config.xml', line: 2, binder: 'jsf-xml-managed-bean' }],
    }]);
  });

  it('gives a bean nothing else calls an incoming edge from the page that uses it (spec: a bean only a page uses)', () => {
    const p = project({
      java: { 'app/src/com/acme/web/OnlyPage.java': BEAN('com.acme.web', 'OnlyPage') },
      files: { 'app/pom.xml': POM, 'app/web/p.xhtml': '<p>#{onlyPage.x}</p>' },
    });
    const bean = p.graph.nodes.find((n) => n.type === 'class' && n.name === 'OnlyPage');
    const page = p.graph.nodes.find((n) => n.filePath === 'app/web/p.xhtml');
    // nothing calls, imports or mentions it: the declaration edges aside, the page is its only way in
    expect(p.graph.edges.filter((e) => e.target === bean.id && !['contains', 'exports'].includes(e.type)).map((e) => [e.type, e.source])).toEqual([['references', page.id]]);
  });

  it('is one edge per page and class, with the evidence of every use, sorted and without repeats', () => {
    const p = project({
      java: { [ORDER_PATH]: ORDER },
      files: {
        'app/pom.xml': POM,
        'app/web/p.xhtml': ['<p>#{orders.b} #{orders.a} #{orders.b}</p>', '<p>#{orders.a}</p>', '<p>#{cart.x}</p>'],
        'app/web/WEB-INF/faces-config.xml': FACES(['orders', 'com.acme.web.OrderBean'], ['cart', 'com.acme.web.OrderBean']),
      },
    });
    expect(p.references).toHaveLength(1);
    expect(p.references[0].evidence.map((e) => [e.line, e.token, e.chain])).toEqual([
      [1, 'orders', 'orders.a'], [1, 'orders', 'orders.b'], [2, 'orders', 'orders.a'], [3, 'cart', 'cart.x'],
    ]);
  });

  it('draws one edge from each page that uses the bean', () => {
    const p = project({
      java: { [ORDER_PATH]: ORDER },
      files: {
        'app/pom.xml': POM, 'app/web/one.xhtml': '<p>#{orders.x}</p>', 'app/web/two.jsp': '<p>${orders.y}</p>',
        'app/web/WEB-INF/faces-config.xml': FACES(['orders', 'com.acme.web.OrderBean']),
      },
    });
    expect(p.links).toEqual([`app/web/one.xhtml -> ${ORDER_PATH}#OrderBean`, `app/web/two.jsp -> ${ORDER_PATH}#OrderBean`]);
  });

  it('keeps a references edge beside the mentions edge for the same page and class', () => {
    const p = project({
      java: { [ORDER_PATH]: ORDER },
      files: {
        'app/pom.xml': POM,
        'app/web/WEB-INF/faces-config.xml': [...FACES(['orders', 'com.acme.web.OrderBean']), '<!-- a page can also write com.acme.web.OrderBean -->'],
        'app/web/p.xhtml': ['<p>#{orders.x}</p>', '<p title="com.acme.web.OrderBean"/>'],
      },
    });
    const between = p.graph.edges.filter((e) => e.type === 'references' || e.type === 'mentions');
    expect(between.filter((e) => e.type === 'references')).toHaveLength(1);
    expect(between.filter((e) => e.type === 'mentions').some((e) => e.evidence.some((x) => x.file === 'app/web/p.xhtml'))).toBe(true);
  });

  it('does not make a name local that another file of the unit declares local (a local name is the file\'s own)', () => {
    const p = project({
      java: { [ORDER_PATH]: ORDER },
      files: {
        'app/pom.xml': POM,
        'app/web/a.xhtml': '<ui:repeat value="#{list}" var="orders">#{orders.x}</ui:repeat>',
        'app/web/b.xhtml': '<p>#{orders.y}</p>',
        'app/web/WEB-INF/faces-config.xml': FACES(['orders', 'com.acme.web.OrderBean']),
      },
    });
    expect(p.links).toEqual([`app/web/b.xhtml -> ${ORDER_PATH}#OrderBean`]);
  });

  it('keeps the same name in two units apart: each page reaches its own unit\'s class (identity)', () => {
    const faces = (cls) => FACES(['person', cls]);
    const p = project({
      java: {
        'one/src/com/one/Person.java': javaSource('com.one', [], 'public class Person {}'),
        'two/src/com/two/Person.java': javaSource('com.two', [], 'public class Person {}'),
      },
      files: {
        'one/pom.xml': POM, 'one/web/p.xhtml': '<p>#{person.x}</p>', 'one/web/WEB-INF/faces-config.xml': faces('com.one.Person'),
        'two/pom.xml': POM, 'two/web/p.xhtml': '<p>#{person.x}</p>', 'two/web/WEB-INF/faces-config.xml': faces('com.two.Person'),
      },
    });
    expect(p.links).toEqual([
      'one/web/p.xhtml -> one/src/com/one/Person.java#Person',
      'two/web/p.xhtml -> two/src/com/two/Person.java#Person',
    ]);
  });

  it('reads the references of a page whose edges the same text elsewhere does not share (identical pages, different units)', () => {
    const p = project({
      java: { [ORDER_PATH]: ORDER },
      files: {
        'app/pom.xml': POM, 'app/web/p.xhtml': '<p>#{orders.x}</p>',
        'app/web/WEB-INF/faces-config.xml': FACES(['orders', 'com.acme.web.OrderBean']),
        'other/pom.xml': POM, 'other/web/p.xhtml': '<p>#{orders.x}</p>',
      },
    });
    expect(p.links).toEqual([`app/web/p.xhtml -> ${ORDER_PATH}#OrderBean`]);
    expect(p.roots).toMatchObject({ edge: 1, elsewhere: 1 });
  });

  describe('the order of the buckets (spec: local, implicit, then bound names)', () => {
    const files = (page) => ({
      'app/pom.xml': POM, 'app/web/p.xhtml': page,
      'app/web/WEB-INF/faces-config.xml': FACES(['item', 'com.acme.web.OrderBean'], ['param', 'com.acme.web.OrderBean']),
    });

    it('is local for a loop variable, though the unit has a bean of that name (spec: a loop variable is not a bean)', () => {
      const p = project({ java: { [ORDER_PATH]: ORDER }, files: files('<ui:repeat value="#{orders.items}" var="item">#{item.price}</ui:repeat>') });
      expect(p.links).toEqual([]);
      expect(p.roots).toMatchObject({ local: 1, unbound: 1 }); // `orders` has no binding here
    });

    it('is implicit for #{param.id}, though the unit has a bean of that name (spec: implicit objects before beans)', () => {
      const p = project({ java: { [ORDER_PATH]: ORDER }, files: files('<p>#{param.id}</p>') });
      expect(p.links).toEqual([]);
      expect(p.roots).toMatchObject({ implicit: 1 });
    });
  });

  describe('visibility of the unit and of the namespace', () => {
    it('is "elsewhere" for a name only another unit declares, and the sample names that unit (spec)', () => {
      const p = project({
        java: { 'b/src/com/b/Remote.java': javaSource('com.b', [], 'public class Remote {}') },
        files: {
          'a/pom.xml': POM, 'a/web/p.xhtml': '<p>#{remote.x}</p>',
          'b/pom.xml': POM, 'b/web/WEB-INF/faces-config.xml': FACES(['remote', 'com.b.Remote']),
        },
      });
      expect(p.links).toEqual([]);
      expect(p.roots.elsewhere).toBe(1);
      expect(p.samples('name-reference-elsewhere')).toEqual(['a/web/p.xhtml:1 remote -> [b [el]]']);
    });

    const SPRING_BEAN = javaSource('com.acme.svc', ['import org.springframework.stereotype.Service;'], ['@Service("orderService")', 'public class OrderServiceImpl {}']);
    const SPRING_PATH = 'app/src/com/acme/svc/OrderServiceImpl.java';
    const faces = (resolver, element = 'el-resolver') => ['<faces-config>', '  <application>', `    <${element}>${resolver}</${element}>`, '  </application>', '</faces-config>'];

    it('does not see a Spring bean without the bridge: "elsewhere", the sample names the namespace (spec)', () => {
      const p = project({
        java: { [SPRING_PATH]: SPRING_BEAN },
        files: { 'app/pom.xml': POM, 'app/web/p.xhtml': '<p>#{orderService.count}</p>' },
      });
      expect(p.links).toEqual([]);
      expect(p.roots.elsewhere).toBe(1);
      expect(p.samples('name-reference-elsewhere')).toEqual(['app/web/p.xhtml:1 orderService -> [app [spring]]']);
    });

    it('sees it once the unit\'s faces-config declares the bridge (spec)', () => {
      const p = project({
        java: { [SPRING_PATH]: SPRING_BEAN },
        files: {
          'app/pom.xml': POM, 'app/web/p.xhtml': '<p>#{orderService.count}</p>',
          'app/web/WEB-INF/faces-config.xml': faces('org.springframework.web.jsf.el.SpringBeanFacesELResolver'),
        },
      });
      expect(p.links).toEqual([`app/web/p.xhtml -> ${SPRING_PATH}#OrderServiceImpl`]);
    });

    it('does not see it through the resolver that does not resolve Spring beans', () => {
      const p = project({
        java: { [SPRING_PATH]: SPRING_BEAN },
        files: {
          'app/pom.xml': POM, 'app/web/p.xhtml': '<p>#{orderService.count}</p>',
          'app/web/WEB-INF/faces-config.xml': faces('org.springframework.web.jsf.el.WebApplicationContextFacesELResolver'),
        },
      });
      expect(p.links).toEqual([]);
      expect(p.roots.elsewhere).toBe(1);
    });

    it('does not see it through a bridge declared in another unit', () => {
      const p = project({
        java: { [SPRING_PATH]: SPRING_BEAN },
        files: {
          'app/pom.xml': POM, 'app/web/p.xhtml': '<p>#{orderService.count}</p>',
          'other/pom.xml': POM, 'other/WEB-INF/faces-config.xml': faces('org.springframework.web.jsf.el.SpringBeanFacesELResolver'),
        },
      });
      expect(p.links).toEqual([]);
    });

    it('sees a Spring XML bean the same way, from the unit\'s own file', () => {
      const p = project({
        java: { 'app/src/com/acme/svc/Svc.java': javaSource('com.acme.svc', [], 'public class Svc {}') },
        files: {
          'app/pom.xml': POM, 'app/web/p.xhtml': '<p>#{svc.count}</p>',
          'app/web/WEB-INF/applicationContext.xml': '<beans><bean id="svc" class="com.acme.svc.Svc"/></beans>',
          'app/web/WEB-INF/faces-config.xml': faces('org.springframework.web.jsf.DelegatingVariableResolver', 'variable-resolver'),
        },
      });
      expect(p.links).toEqual([`app/web/p.xhtml -> app/src/com/acme/svc/Svc.java#Svc`]);
      expect(p.edge('app/web/p.xhtml', 'app/src/com/acme/svc/Svc.java#Svc').evidence[0].bindings).toEqual([
        { file: 'app/web/WEB-INF/applicationContext.xml', line: 1, binder: 'spring-xml-bean' },
      ]);
    });
  });

  describe('names that cannot be anchored are visible, not guessed', () => {
    const seam = (name, cls) => `@Name("${name}")\npublic class ${cls} {}`;
    const SEAM_IMPORT = ['import org.jboss.seam.annotations.Name;'];

    it('is "ambiguous" for one name bound to two classes of the unit, with both as candidates (spec: main and test source)', () => {
      const p = project({
        java: {
          'app/src/main/com/acme/PaymentHome.java': javaSource('com.acme', SEAM_IMPORT, seam('paymentHome', 'PaymentHome')),
          'app/src/test/com/acme/PaymentHomeTest.java': javaSource('com.acme.test', SEAM_IMPORT, seam('paymentHome', 'PaymentHomeTest')),
        },
        files: { 'app/pom.xml': POM, 'app/web/p.xhtml': '<p>#{paymentHome.pay}</p>' },
      });
      expect(p.links).toEqual([]);
      expect(p.roots.ambiguous).toBe(1);
      expect(p.samples('name-reference-ambiguous')).toEqual([
        'app/web/p.xhtml:1 paymentHome -> [app/src/main/com/acme/PaymentHome.java#PaymentHome, app/src/test/com/acme/PaymentHomeTest.java#PaymentHomeTest]',
      ]);
    });

    it('is "ambiguous" when the bindings differ in kind: a class and a bundle', () => {
      const p = project({
        java: { 'app/src/com/acme/Both.java': javaSource('com.acme', SEAM_IMPORT, seam('both', 'Both')) },
        files: {
          'app/pom.xml': POM, 'app/web/p.xhtml': '<p>#{both.x}</p>',
          'app/web/WEB-INF/faces-config.xml': '<faces-config><application><resource-bundle><base-name>b.M</base-name><var>both</var></resource-bundle></application></faces-config>',
        },
      });
      expect(p.roots.ambiguous).toBe(1);
    });

    it('is "ambiguous" when an XML class name matches two declarations of one name', () => {
      const p = project({
        java: {
          'app/src/com/acme/Dup.java': javaSource('com.acme', [], 'public class Dup {}'),
          'app/other/com/acme/Dup.java': javaSource('com.acme', [], 'public class Dup {}'),
        },
        files: {
          'app/pom.xml': POM, 'app/web/p.xhtml': '<p>#{dup.x}</p>',
          'app/web/WEB-INF/faces-config.xml': '<faces-config><managed-bean><managed-bean-name>dup</managed-bean-name><managed-bean-class>com.acme.Dup</managed-bean-class></managed-bean></faces-config>',
        },
      });
      expect(p.roots.ambiguous).toBe(1);
      expect(p.samples('name-reference-ambiguous')[0]).toContain('app/other/com/acme/Dup.java#Dup, app/src/com/acme/Dup.java#Dup');
    });

    it('is an edge when several bindings agree on one class (a name declared twice for the same class)', () => {
      const p = project({
        java: { 'app/src/com/acme/Same.java': javaSource('com.acme', ['import javax.inject.Named;'], ['@Named("same")', 'public class Same {}']) },
        files: {
          'app/pom.xml': POM, 'app/web/p.xhtml': '<p>#{same.x}</p>',
          'app/web/WEB-INF/faces-config.xml': '<faces-config><managed-bean><managed-bean-name>same</managed-bean-name><managed-bean-class>com.acme.Same</managed-bean-class></managed-bean></faces-config>',
        },
      });
      expect(p.links).toEqual(['app/web/p.xhtml -> app/src/com/acme/Same.java#Same']);
      // by file: the Java source sorts before the descriptor
      expect(p.references[0].evidence[0].bindings.map((b) => b.binder)).toEqual(['cdi-annotation-named', 'jsf-xml-managed-bean']);
    });

    it('is a bundle (no edge, no gap) for a name declared as a resource bundle', () => {
      const p = project({
        files: {
          'app/pom.xml': POM, 'app/web/p.xhtml': '<p>#{msgs.title}</p>',
          'app/web/WEB-INF/faces-config.xml': '<faces-config><application><resource-bundle><base-name>b.M</base-name><var>msgs</var></resource-bundle></application></faces-config>',
        },
      });
      expect(p.roots.bundle).toBe(1);
      expect(p.graph.gaps.filter((g) => g.kind.startsWith('name-reference'))).toEqual([]);
    });

    it('is "external" (no edge, no gap) for a class outside the repository', () => {
      const p = project({
        files: {
          'app/pom.xml': POM, 'app/web/p.xhtml': '<p>#{lib.x}</p>',
          'app/web/WEB-INF/faces-config.xml': '<faces-config><managed-bean><managed-bean-name>lib</managed-bean-name><managed-bean-class>org.other.Lib</managed-bean-class></managed-bean></faces-config>',
        },
      });
      expect(p.roots.external).toBe(1);
      expect(p.graph.gaps.filter((g) => g.kind.startsWith('name-reference'))).toEqual([]);
    });

    it('is "unindexed" for a class the repository declares that has no node (an annotation type)', () => {
      const p = project({
        java: { 'app/src/com/acme/Audited.java': 'package com.acme;\n\npublic @interface Audited {}\n' },
        files: {
          'app/pom.xml': POM, 'app/web/p.xhtml': '<p>#{audited.x}</p>',
          'app/web/WEB-INF/faces-config.xml': '<faces-config><managed-bean><managed-bean-name>audited</managed-bean-name><managed-bean-class>com.acme.Audited</managed-bean-class></managed-bean></faces-config>',
        },
      });
      expect(p.links).toEqual([]);
      expect(p.roots.unindexed).toBe(1);
      expect(p.samples('name-reference-target-unindexed')).toEqual(['app/web/p.xhtml:1 audited -> [com.acme.Audited]']);
    });

    it('is "unknown" for a binding that has a name and no target', () => {
      const p = project({
        files: {
          'app/pom.xml': POM, 'app/web/p.xhtml': '<p>#{child.x}</p>',
          'app/web/WEB-INF/faces-config.xml': '<faces-config><managed-bean><managed-bean-name>child</managed-bean-name></managed-bean></faces-config>',
        },
      });
      expect(p.roots.unknown).toBe(1);
      expect(p.samples('name-reference-target-unknown')).toEqual(['app/web/p.xhtml:1 child -> [app/web/WEB-INF/faces-config.xml:1]']);
    });

    it('is "unbound" for a name nothing declares, and the reason says what this step does not read', () => {
      const p = project({ files: { 'app/pom.xml': POM, 'app/web/p.xhtml': '<p>#{nothing.x}</p>' } });
      expect(p.roots.unbound).toBe(1);
      const [gap] = p.gaps('name-reference-unbound');
      expect(gap).toMatchObject({ scope: 'xhtml', count: 1, samples: ['app/web/p.xhtml:1 nothing -> []'] });
      expect(gap.reason).toMatch(/producer|factory/);
      expect(gap.reason).toMatch(/nested/);
      expect(gap.reason).toMatch(/includes this one statically/);
    });

    it('gives every gap the language of the page it is in as its scope', () => {
      const p = project({ files: { 'app/pom.xml': POM, 'app/web/a.xhtml': '<p>#{x.y}</p>', 'app/web/b.jsp': '<p>${x.y}</p>' } });
      expect(p.gaps('name-reference-unbound').map((g) => [g.scope, g.count]).sort()).toEqual([['jsp', 1], ['xhtml', 1]]);
    });
  });

  describe('what is not an expression is not resolved', () => {
    it('reads no root from a comment or an escape, and counts the escape (spec)', () => {
      const p = project({
        java: { [ORDER_PATH]: ORDER },
        files: {
          'app/pom.xml': POM, 'app/web/p.xhtml': ['<!-- #{orders.secret} -->', '\\#{orders.raw}'],
          'app/web/WEB-INF/faces-config.xml': FACES(['orders', 'com.acme.web.OrderBean']),
        },
      });
      expect(p.links).toEqual([]);
      expect(p.coverage).toMatchObject({ rootCount: 0, escaped: 1, unterminated: 0 });
    });
  });

  describe('the evidence can be checked against the source (spec: checkable evidence)', () => {
    it('has the token on the cited page line and the declaration on every cited binding line', () => {
      const p = project({
        java: {
          [ORDER_PATH]: ORDER,
          'app/src/com/acme/web/CustomerBean.java': BEAN('com.acme.web', 'CustomerBean'),
          'app/src/com/acme/web/Cart.java': BEAN('com.acme.web', 'Cart', '@Named("basket")'),
        },
        files: {
          'app/pom.xml': POM,
          'app/web/p.xhtml': ['<p>', '  #{orders.save} #{customerBean.x}', '</p>', '<p value="#{basket.total}"/>'],
          'app/web/WEB-INF/faces-config.xml': FACES(['orders', 'com.acme.web.OrderBean']),
        },
      });
      expect(p.references).toHaveLength(3);
      const annotationBinders = new Set(CATALOG.annotationBinders.map((b) => b.id));
      const simpleNames = new Set(CATALOG.annotationBinders.flatMap((b) => b.annotations.map((a) => a.slice(a.lastIndexOf('.') + 1))));
      for (const edge of p.references) {
        for (const evidence of edge.evidence) {
          expect(p.texts[evidence.file].split('\n')[evidence.line - 1]).toContain(evidence.token);
          for (const binding of evidence.bindings) {
            const line = p.texts[binding.file].split('\n')[binding.line - 1];
            if (annotationBinders.has(binding.binder)) expect([...simpleNames].some((n) => line.includes(`@${n}`))).toBe(true);
            else expect(line).toContain(evidence.token);
          }
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Dotted names, configuring components, implicit objects with a binding, and
// the scope of what a tag declares (the revisions to design D1, D4, D6, D7, D8)
// ---------------------------------------------------------------------------

describe('dotted names (spec: a dotted name matches by the prefixes of the member chain)', () => {
  const JAKARTA = ['import jakarta.inject.Named;'];
  const named = (name, cls) => BEAN('com.acme', cls, `@Named("${name}")`, JAKARTA);
  const page = (...expressions) => ({ 'app/pom.xml': POM, 'app/web/p.xhtml': expressions.map((e) => `<p>${e}</p>`) });
  const TRACK = 'app/src/com/acme/Track.java';
  const ADMIN = 'app/src/com/acme/Admin.java';

  it('reaches a bean named admin.track by #{admin.track.trackingId}, citing the root, the chain and the name that matched', () => {
    const p = project({ java: { [TRACK]: named('admin.track', 'Track') }, files: page('#{admin.track.trackingId}') });
    expect(p.links).toEqual([`app/web/p.xhtml -> ${TRACK}#Track`]);
    expect(p.references[0].evidence).toEqual([{
      file: 'app/web/p.xhtml', line: 1, source: 'lexical', token: 'admin', chain: 'admin.track.trackingId', name: 'admin.track',
      bindings: [{ file: TRACK, line: 4, binder: 'cdi-annotation-named' }],
    }]);
    expect(p.coverage.bindings['cdi-annotation-named']).toBe(1);
    expect(p.coverage.nonIdentifierNames).toBe(0);
  });

  it('takes every dotted prefix of the chain for a candidate, the whole chain included', () => {
    const p = project({ java: { [TRACK]: named('admin.track.id', 'Track') }, files: page('#{admin.track.id}', '#{admin.track.id.more}', '#{admin.track}') });
    expect(p.references[0].evidence.map((e) => [e.line, e.name])).toEqual([[1, 'admin.track.id'], [2, 'admin.track.id']]);
    expect(p.roots).toMatchObject({ edge: 2, unbound: 1 }); // #{admin.track} is a prefix of the name, not the name
  });

  it('is ambiguous when the root and a dotted prefix both name a binding, and the sample names both (spec)', () => {
    const p = project({ java: { [ADMIN]: named('admin', 'Admin'), [TRACK]: named('admin.track', 'Track') }, files: page('#{admin.track.trackingId}') });
    expect(p.links).toEqual([]);
    expect(p.roots.ambiguous).toBe(1);
    expect(p.samples('name-reference-ambiguous')).toEqual([`app/web/p.xhtml:1 admin -> [admin -> ${ADMIN}#Admin, admin.track -> ${TRACK}#Track]`]);
  });

  it('is an edge to the shortest name when the shortest-prefix switch is on (mutation tripwire)', () => {
    const spec = { java: { [ADMIN]: named('admin', 'Admin'), [TRACK]: named('admin.track', 'Track') }, files: page('#{admin.track.trackingId}') };
    expect(project(spec).roots.ambiguous).toBe(1);
    const mutated = project({ ...spec, mutations: { shortestPrefix: true } });
    expect(mutated.links).toEqual([`app/web/p.xhtml -> ${ADMIN}#Admin`]);
    expect(mutated.references[0].evidence[0]).toMatchObject({ token: 'admin', name: 'admin' });
  });

  it('is still the plain name when the chain never reaches the dotted one', () => {
    const p = project({ java: { [ADMIN]: named('admin', 'Admin'), [TRACK]: named('admin.track', 'Track') }, files: page('#{admin.other}', '#{admin}') });
    expect(p.links).toEqual([`app/web/p.xhtml -> ${ADMIN}#Admin`]);
    expect(p.roots.edge).toBe(2);
  });

  it('does not reach a dotted name that Spring registers: its EL bridge looks a name up whole (spec)', () => {
    const faces = '<faces-config><application><el-resolver>org.springframework.web.jsf.el.SpringBeanFacesELResolver</el-resolver></application></faces-config>';
    const p = project({
      java: { [TRACK]: javaSource('com.acme', [], 'public class Track {}') },
      files: {
        ...page('#{admin.track.x}'),
        'app/WEB-INF/ctx.xml': '<beans><bean id="admin.track" class="com.acme.Track"/></beans>',
        'app/WEB-INF/faces-config.xml': faces,
      },
    });
    expect(p.links).toEqual([]);
    expect(p.coverage.nonIdentifierNames).toBe(1);
    expect(p.coverage.bindings['spring-xml-bean']).toBe(0);
    expect(p.roots.unbound).toBe(1);
  });

  it('does not reach a dotted name of a JSF managed bean or a @ManagedBean either', () => {
    const p = project({
      java: { [TRACK]: BEAN('com.acme', 'Track', '@ManagedBean(name = "admin.track")', ['import javax.faces.bean.ManagedBean;']) },
      files: {
        ...page('#{admin.track.x} #{a.b.c}'),
        'app/web/WEB-INF/faces-config.xml': '<faces-config><managed-bean><managed-bean-name>a.b</managed-bean-name><managed-bean-class>com.acme.Track</managed-bean-class></managed-bean></faces-config>',
      },
    });
    expect(p.links).toEqual([]);
    expect(p.coverage.nonIdentifierNames).toBe(2);
  });

  it('accepts a dotted name only when every segment is an identifier', () => {
    const p = project({
      java: {
        [TRACK]: named('admin.track-id', 'Track'),
        [ADMIN]: named('.admin', 'Admin'),
        'app/src/com/acme/Seg.java': named('a..b', 'Seg'),
      },
      files: page('#{admin.x}'),
    });
    expect(p.coverage.nonIdentifierNames).toBe(3);
    expect(p.coverage.bindings['cdi-annotation-named']).toBe(0);
  });

  it('knows a dotted name of another unit as "elsewhere", by the same candidates', () => {
    const p = project({
      java: { 'b/src/com/b/Track.java': named('admin.track', 'Track') },
      files: { 'a/pom.xml': POM, 'a/web/p.xhtml': '<p>#{admin.track.x}</p>', 'b/pom.xml': POM },
    });
    expect(p.links).toEqual([]);
    expect(p.roots.elsewhere).toBe(1);
    expect(p.samples('name-reference-elsewhere')).toEqual(['a/web/p.xhtml:1 admin -> [b [el]]']);
  });

  it('reaches a Seam component whose name is dotted, as Seam\'s own components are', () => {
    const p = project({
      java: { 'app/src/com/acme/Mgr.java': javaSource('com.acme', ['import org.jboss.seam.annotations.Name;'], ['@Name("org.jboss.seam.core.manager")', 'public class Mgr {}']) },
      files: page('#{org.jboss.seam.core.manager.conversationId}'),
    });
    expect(p.links).toEqual(['app/web/p.xhtml -> app/src/com/acme/Mgr.java#Mgr']);
  });
});

describe('a component that only configures another (spec: Seam components.xml without a class)', () => {
  const SEAM = 'http://jboss.com/products/seam/components';
  const NUMBER = 'app/src/com/acme/NumberGuess.java';
  const NUMBER_SRC = javaSource('com.acme', ['import org.jboss.seam.annotations.Name;'], ['@Name("numberGuess")', 'public class NumberGuess {}']);
  const components = (...elements) => [`<components xmlns="${SEAM}">`, ...elements, '</components>'];
  const page = { 'app/pom.xml': POM, 'app/web/p.xhtml': '<p>#{numberGuess.guess}</p>' };

  it('gives way to the annotated component of the same name, and still cites its own line', () => {
    const p = project({ java: { [NUMBER]: NUMBER_SRC }, files: { ...page, 'app/res/components.xml': components('  <component name="numberGuess"/>') } });
    expect(p.links).toEqual([`app/web/p.xhtml -> ${NUMBER}#NumberGuess`]);
    expect(p.references[0].evidence[0].bindings).toEqual([
      { file: 'app/res/components.xml', line: 2, binder: 'seam-xml-component' },
      { file: NUMBER, line: 4, binder: 'seam-annotation-name' },
    ]);
  });

  it('is a binding with no target, "unknown", when nothing else declares the name', () => {
    const p = project({ files: { ...page, 'app/res/components.xml': components('  <component name="numberGuess"/>') } });
    expect(p.roots.unknown).toBe(1);
    expect(p.samples('name-reference-target-unknown')).toEqual(['app/web/p.xhtml:1 numberGuess -> [app/res/components.xml:2]']);
  });

  it('does not give way to a class a component names itself: a different class is an ambiguity', () => {
    const p = project({
      java: { [NUMBER]: NUMBER_SRC, 'app/src/com/acme/Other.java': javaSource('com.acme', [], 'public class Other {}') },
      files: { ...page, 'app/res/components.xml': components('  <component name="numberGuess" class="com.acme.Other"/>') },
    });
    expect(p.roots.ambiguous).toBe(1);
  });

  it('makes a Spring bean with only a parent and a same-named annotation an ambiguity (spec)', () => {
    const faces = '<faces-config><application><el-resolver>org.springframework.web.jsf.el.SpringBeanFacesELResolver</el-resolver></application></faces-config>';
    const p = project({
      java: { 'app/src/com/acme/Report.java': BEAN('com.acme', 'Report', '@Component("report")', ['import org.springframework.stereotype.Component;']) },
      files: {
        'app/pom.xml': POM, 'app/web/p.xhtml': '<p>#{report.run}</p>',
        'app/WEB-INF/ctx.xml': '<beans><bean id="report" parent="base"/></beans>',
        'app/WEB-INF/faces-config.xml': faces,
      },
    });
    expect(p.links).toEqual([]);
    expect(p.roots.ambiguous).toBe(1);
    expect(p.samples('name-reference-ambiguous')[0]).toContain('(no target)');
  });

  it('binds the alias names of a Spring bean, but not its id cut at the separators (spec: an id is not split)', () => {
    const faces = '<faces-config><application><el-resolver>org.springframework.web.jsf.el.SpringBeanFacesELResolver</el-resolver></application></faces-config>';
    const p = project({
      java: { 'app/src/com/acme/X.java': javaSource('com.acme', [], 'public class X {}') },
      files: {
        'app/pom.xml': POM, 'app/web/p.xhtml': '<p>#{c.x} #{d.x} #{a.x} #{b.x}</p>',
        'app/WEB-INF/ctx.xml': '<beans><bean id="a;b" name="c d" class="com.acme.X"/></beans>',
        'app/WEB-INF/faces-config.xml': faces,
      },
    });
    expect(p.links).toEqual(['app/web/p.xhtml -> app/src/com/acme/X.java#X']);
    expect(p.references[0].evidence.map((e) => e.token)).toEqual(['c', 'd']);
    expect(p.coverage.nonIdentifierNames).toBe(1); // a;b
    expect(p.coverage.bindings['spring-xml-bean']).toBe(2);
    expect(p.roots).toMatchObject({ edge: 2, unbound: 2 });
  });

  it('counts a component with only a class, and an anonymous Spring bean, as missing a name, for their binders', () => {
    const p = project({
      files: {
        ...page,
        'app/res/components.xml': components('  <component class="com.acme.Mailer"/>'),
        'app/res/ctx.xml': '<beans><bean class="com.acme.Audit"/></beans>',
      },
    });
    expect(p.coverage.missingNames).toMatchObject({ 'seam-xml-component': 1, 'spring-xml-bean': 1 });
    expect(p.coverage.bindings['seam-xml-component'] + p.coverage.bindings['spring-xml-bean']).toBe(0);
  });
});

describe('implicit objects with a binding of the same name (spec)', () => {
  const FACES = (name) => `<faces-config><managed-bean><managed-bean-name>${name}</managed-bean-name><managed-bean-class>com.acme.Param</managed-bean-class></managed-bean></faces-config>`;
  const PARAM = { 'app/src/com/acme/Param.java': javaSource('com.acme', [], 'public class Param {}') };

  it('counts an implicit name the unit also binds, and draws no edge (spec)', () => {
    const p = project({ java: PARAM, files: { 'app/pom.xml': POM, 'app/web/p.xhtml': '<p>#{param.id}</p>', 'app/web/WEB-INF/faces-config.xml': FACES('param') } });
    expect(p.links).toEqual([]);
    expect(p.roots.implicit).toBe(1);
    expect(p.coverage.implicitWithBinding).toBe(1);
  });

  it('does not count an implicit name no visible binding shares, nor one another unit binds, nor one in an invisible namespace', () => {
    const faces = '<faces-config><application><el-resolver>org.springframework.web.jsf.el.SpringBeanFacesELResolver</el-resolver></application></faces-config>';
    const spring = (extra) => ({
      java: { 'b/src/com/acme/Svc.java': BEAN('com.acme', 'Svc', '@Service("session")', ['import org.springframework.stereotype.Service;']) },
      files: { 'a/pom.xml': POM, 'a/p.xhtml': '<p>#{session.x} #{param.y}</p>', 'b/pom.xml': POM, ...extra },
    });
    expect(project(spring({})).coverage).toMatchObject({ implicitWithBinding: 0, roots: { implicit: 2 } });
    // the same bean in a's own unit, with no bridge: invisible there
    const own = project({
      java: { 'a/src/com/acme/Svc.java': BEAN('com.acme', 'Svc', '@Service("session")', ['import org.springframework.stereotype.Service;']) },
      files: { 'a/pom.xml': POM, 'a/p.xhtml': '<p>#{session.x}</p>' },
    });
    expect(own.coverage.implicitWithBinding).toBe(0);
    const bridged = project({
      java: { 'a/src/com/acme/Svc.java': BEAN('com.acme', 'Svc', '@Service("session")', ['import org.springframework.stereotype.Service;']) },
      files: { 'a/pom.xml': POM, 'a/p.xhtml': '<p>#{session.x}</p>', 'a/faces-config.xml': faces },
    });
    expect(bridged.coverage.implicitWithBinding).toBe(1);
  });

  it('counts externalContext among the implicit names', () => {
    const p = project({ java: PARAM, files: { 'app/pom.xml': POM, 'app/web/p.xhtml': '<p>#{externalContext.x}</p>', 'app/web/WEB-INF/faces-config.xml': FACES('externalContext') } });
    expect(p.roots.implicit).toBe(1);
    expect(p.coverage.implicitWithBinding).toBe(1);
    expect(p.links).toEqual([]);
  });
});

describe('what a tag declares is local only where the catalog says (spec: request parameter names, alias tags)', () => {
  const CART = 'app/src/com/acme/Cart.java';
  const BEANS = { [CART]: BEAN('com.acme', 'Cart') };
  const CART_LINK = `app/web/p.xhtml -> ${CART}#Cart`;

  it('does not make the request parameter name of f:param local: the bean of that name is reached (spec)', () => {
    const p = project({
      java: BEANS,
      files: { 'app/pom.xml': POM, 'app/web/p.xhtml': ['<html xmlns:f="http://xmlns.jcp.org/jsf/core">', '<f:param name="cart" value="#{orderId}"/>', '<p>#{cart.total}</p>', '</html>'] },
    });
    expect(p.links).toEqual([CART_LINK]);
    expect(p.roots.local).toBe(0);
  });

  it('makes the name of ui:param local, whatever Facelets namespace the page binds it to', () => {
    const p = project({
      java: BEANS,
      files: { 'app/pom.xml': POM, 'app/web/p.xhtml': ['<html xmlns:ui="http://xmlns.jcp.org/jsf/facelets">', '<ui:param name="cart" value="#{orderId}"/>', '<p>#{cart.total}</p>', '</html>'] },
    });
    expect(p.links).toEqual([]);
    expect(p.roots.local).toBe(1);
  });

  it('makes the roots of an aliasBean alias local, the alias too, and resolves the value by binding (spec)', () => {
    const p = project({
      java: { ...BEANS, 'app/src/com/acme/Orders.java': BEAN('com.acme', 'Orders', '@Named("orders")') },
      files: {
        'app/pom.xml': POM,
        'app/web/p.jsp': [
          '<%@ taglib prefix="t" uri="http://myfaces.apache.org/tomahawk" %>',
          '<t:aliasBean alias="#{cart}" value="#{orders}">',
          '  ${cart.save}',
          '</t:aliasBean>',
        ],
      },
    });
    expect(p.links).toEqual(['app/web/p.jsp -> app/src/com/acme/Orders.java#Orders']);
    expect(p.roots).toMatchObject({ local: 2, edge: 1 });
  });

  it('reaches the bean of the alias name when the expression-root switch is on (mutation tripwire)', () => {
    const spec = {
      java: BEANS,
      files: {
        'app/pom.xml': POM,
        'app/web/p.jsp': ['<%@ taglib prefix="t" uri="http://myfaces.apache.org/tomahawk" %>', '<t:aliasBean alias="#{cart}" value="#{x}">${cart.save}</t:aliasBean>'],
      },
    };
    expect(project(spec).links).toEqual([]);
    expect(project({ ...spec, siteMutations: { noExpressionLocals: true } }).links).toEqual(['app/web/p.jsp -> app/src/com/acme/Cart.java#Cart']);
  });
});

describe('an unterminated expression does not swallow the page after it (spec)', () => {
  it('counts it and still reads a later expression of the same text', () => {
    const p = project({
      java: { 'app/src/com/acme/Cart.java': BEAN('com.acme', 'Cart') },
      files: { 'app/pom.xml': POM, 'app/web/p.xhtml': ['<p>', '', '#{orders.title', '', '', '', '', '', '#{cart.total}', '</p>'] },
    });
    expect(p.coverage).toMatchObject({ unterminated: 1, rootCount: 1 });
    expect(p.links).toEqual(['app/web/p.xhtml -> app/src/com/acme/Cart.java#Cart']);
    expect(p.references[0].evidence[0].line).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// Requirement: coverage, gaps and conservation
// ---------------------------------------------------------------------------

describe('coverage, gaps and conservation (design D10)', () => {
  const mixed = () => project({
    java: {
      'a/src/com/a/One.java': BEAN('com.a', 'One'),
      'b/src/com/b/Far.java': BEAN('com.b', 'Far'),
      'a/src/com/a/Dyn.java': BEAN('com.a', 'Dyn', '@Named(Names.X)'),
    },
    files: {
      'a/pom.xml': POM, 'b/pom.xml': POM,
      'a/web/p.xhtml': ['<p>#{one.x} #{far.y} #{nothing.z} #{param.q}</p>', '<ui:repeat var="v">#{v.w}</ui:repeat>', '<!-- #{c.d} -->'],
      'a/web/WEB-INF/faces-config.xml': '<faces-config><application><resource-bundle><base-name>b</base-name><var>msgs</var></resource-bundle></application></faces-config>',
      'a/web/q.jsp': '${msgs.title} ${one.again}',
    },
  });

  it('writes the whole coverage section: every field, zeros included', () => {
    const { coverage } = mixed();
    expect(Object.keys(coverage).sort()).toEqual([
      'bindings', 'escaped', 'files', 'implicitWithBinding', 'missingNames', 'nonIdentifierNames', 'nonLiteralNames', 'outsideFiles',
      'repositoryUnitFiles', 'rootCount', 'roots', 'status', 'unconfirmedAnnotations', 'units', 'unscanned', 'unterminated',
    ]);
    expect(coverage.status).toBe('ran');
    const binderIds = [
      'cdi-annotation-model', 'cdi-annotation-named', 'jsf-annotation-managed-bean', 'jsf-xml-managed-bean', 'jsf-xml-resource-bundle',
      'seam-annotation-name', 'seam-annotation-role', 'seam-xml-component', 'spring-annotation-stereotype', 'spring-xml-bean',
    ];
    expect(Object.keys(coverage.bindings).sort()).toEqual(binderIds);
    expect(Object.keys(coverage.missingNames).sort()).toEqual(binderIds);
    expect(Object.keys(coverage.roots).sort()).toEqual([...NAME_REFERENCE_BUCKETS].sort());
    expect(NAME_REFERENCE_BUCKETS).toHaveLength(10);
  });

  it('counts every root in exactly one of the ten buckets', () => {
    const { coverage } = mixed();
    expect(coverage.roots).toEqual({
      local: 1, implicit: 1, edge: 2, bundle: 1, external: 0, unindexed: 0, unknown: 0, ambiguous: 0, elsewhere: 1, unbound: 1,
    });
    expect(coverage.rootCount).toBe(7);
    expect(Object.values(coverage.roots).reduce((a, b) => a + b, 0)).toBe(coverage.rootCount);
    expect(coverage).toMatchObject({ files: { xhtml: 1, jsp: 1, xml: 1 }, units: 2, repositoryUnitFiles: 0, nonLiteralNames: 1, implicitWithBinding: 0 });
    expect(coverage.bindings).toMatchObject({ 'cdi-annotation-named': 2, 'jsf-xml-resource-bundle': 1 });
  });

  it('records each of the five gap kinds with its bucket\'s count', () => {
    const p = mixed();
    const count = (kind) => p.gaps(kind).reduce((sum, g) => sum + g.count, 0);
    expect(count('name-reference-elsewhere')).toBe(p.roots.elsewhere);
    expect(count('name-reference-unbound')).toBe(p.roots.unbound);
    expect(count('name-reference-ambiguous')).toBe(0);
    expect(count('name-reference-target-unindexed')).toBe(0);
    expect(count('name-reference-target-unknown')).toBe(0);
    for (const kind of ['elsewhere', 'unbound']) expect(p.gaps(`name-reference-${kind}`)[0].reason.length).toBeGreaterThan(30);
  });

  it('records the files outside the expression files, from the collector', () => {
    const p = project({ files: { 'a/pom.xml': POM, 'a/web.xml': '<web-app>#{x.y}</web-app>', 'a/x.html': '#{h.t}', 'a/p.xhtml': '#{x.y}' } });
    expect(p.coverage.outsideFiles).toEqual({ html: 1, 'xml:web-app': 1 });
    expect(p.coverage.roots.unbound).toBe(1); // only the xhtml file is read
  });

  it('is not run without sites and catalog: the coverage says so, nothing is drawn (spec: stage not run)', () => {
    const p = project({ java: { 'a/src/com/a/One.java': BEAN('com.a', 'One') }, files: { 'a/pom.xml': POM, 'a/p.xhtml': '#{one.x}' }, omit: true });
    expect(p.coverage).toEqual({ status: 'not-run' });
    expect(p.references).toEqual([]);
    expect(p.graph.gaps.filter((g) => g.kind.startsWith('name-reference'))).toEqual([]);
  });

  it('refuses sites without a catalog and a catalog without sites', () => {
    const scan = { files: [], skipped: [] };
    const structureAll = { results: [] };
    const sites = { files: [], bindings: [], conditions: [], outsideFiles: {} };
    expect(() => buildFactGraph({ scan, structureAll, nameReferenceSites: sites })).toThrow(/nameReferenceSites and nameBindingCatalog go together/);
    expect(() => buildFactGraph({ scan, structureAll, nameBindingCatalog: CATALOG })).toThrow(/nameReferenceSites and nameBindingCatalog go together/);
    expect(buildFactGraph({ scan, structureAll, nameReferenceSites: sites, nameBindingCatalog: CATALOG }).coverage.nameReferences)
      .toMatchObject({ status: 'ran', rootCount: 0, files: {}, units: 0 });
  });

  it('fails on a site it cannot place: a file outside the manifest, a repeated row, a language or binder the catalog does not have', () => {
    const base = project({ files: { 'a/pom.xml': POM, 'a/p.xhtml': '#{x.y}' } });
    const rerun = (edit) => {
      const sites = structuredClone(base.sites);
      edit(sites);
      const scan = { files: [{ path: 'a/pom.xml', language: 'xml' }, { path: 'a/p.xhtml', language: 'xhtml' }], skipped: [] };
      const structureAll = { results: scan.files.map((f) => ({ path: f.path, language: f.language, status: 'no-extractor', metrics: {} })) };
      return () => buildFactGraph({ scan, structureAll, nameReferenceSites: sites, nameBindingCatalog: CATALOG });
    };
    expect(rerun(() => {})).not.toThrow();
    expect(rerun((s) => { s.files[0].file = 'gone.xhtml'; })).toThrow(/outside the manifest: gone\.xhtml/);
    expect(rerun((s) => { s.files.push(structuredClone(s.files[0])); })).toThrow(/more than one row for a\/p\.xhtml/);
    expect(rerun((s) => { s.files[0].expressionLanguage = 'other-el'; })).toThrow(/expression language "other-el"/);
    expect(rerun((s) => { s.bindings.push({ file: 'a/p.xhtml', binder: 'nope', name: 'x', line: 1, target: null }); })).toThrow(/binder "nope"/);
  });

  describe('the conservation equations', () => {
    const ran = () => structuredClone(mixed().coverage);
    const gapCounts = (coverage) => ({
      unindexed: coverage.roots.unindexed, unknown: coverage.roots.unknown, ambiguous: coverage.roots.ambiguous,
      elsewhere: coverage.roots.elsewhere, unbound: coverage.roots.unbound,
    });

    it('holds for a real run', () => {
      const coverage = ran();
      expect(() => assertNameReferenceConservation(coverage, gapCounts(coverage))).not.toThrow();
    });

    it('fails when the ten buckets do not add up to the roots', () => {
      const coverage = ran();
      coverage.roots.local += 1;
      expect(() => assertNameReferenceConservation(coverage, gapCounts(coverage))).toThrow(/7 root name\(s\) but 8 outcome\(s\)/);
    });

    it('fails when a gap kind read back differs from its bucket, for each of the five kinds', () => {
      for (const kind of ['unindexed', 'unknown', 'ambiguous', 'elsewhere', 'unbound']) {
        const coverage = ran();
        const counts = gapCounts(coverage);
        counts[kind] += 1;
        expect(() => assertNameReferenceConservation(coverage, counts), kind).toThrow(new RegExp(`name-reference-.*${kind === 'unindexed' ? 'target-unindexed' : kind === 'unknown' ? 'target-unknown' : kind}`));
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Mutation tripwires (design D12): each switch must change a result a test reads
// ---------------------------------------------------------------------------

describe('mutation tripwires', () => {
  const FACES = (name, cls = 'com.acme.web.OrderBean') =>
    `<faces-config><managed-bean><managed-bean-name>${name}</managed-bean-name><managed-bean-class>${cls}</managed-bean-class></managed-bean></faces-config>`;
  const ORDER = { 'app/src/com/acme/web/OrderBean.java': javaSource('com.acme.web', [], 'public class OrderBean {}') };
  const ORDER_LINK = 'app/web/p.xhtml -> app/src/com/acme/web/OrderBean.java#OrderBean';

  it('ignoreUnits: a name another unit declares reaches the page', () => {
    const spec = { java: ORDER, files: { 'a/pom.xml': POM, 'a/web/p.xhtml': '#{orders.x}', 'app/pom.xml': POM, 'app/web/WEB-INF/faces-config.xml': FACES('orders') } };
    expect(project(spec).links).toEqual([]);
    expect(project({ ...spec, mutations: { ignoreUnits: true } }).links).toEqual(['a/web/p.xhtml -> app/src/com/acme/web/OrderBean.java#OrderBean']);
  });

  it('noLocals: a loop variable is taken for the bean of that name', () => {
    const spec = { java: ORDER, files: { 'app/pom.xml': POM, 'app/web/p.xhtml': '<ui:repeat value="#{l}" var="item">#{item.x}</ui:repeat>', 'app/web/WEB-INF/faces-config.xml': FACES('item') } };
    expect(project(spec).links).toEqual([]);
    expect(project({ ...spec, mutations: { noLocals: true } }).links).toEqual([ORDER_LINK]);
  });

  it('bindingsBeforeImplicit: a bean named like an implicit object wins', () => {
    const spec = { java: ORDER, files: { 'app/pom.xml': POM, 'app/web/p.xhtml': '#{param.x}', 'app/web/WEB-INF/faces-config.xml': FACES('param') } };
    expect(project(spec).links).toEqual([]);
    expect(project({ ...spec, mutations: { bindingsBeforeImplicit: true } }).links).toEqual([ORDER_LINK]);
  });

  it('bindingsBeforeImplicit: an implicit name with no bean is still implicit', () => {
    const spec = { files: { 'app/pom.xml': POM, 'app/web/p.xhtml': '#{param.x}' }, mutations: { bindingsBeforeImplicit: true } };
    expect(project(spec).roots.implicit).toBe(1);
  });

  it('firstBinding: an ambiguous name resolves to the first of its bindings', () => {
    const imports = ['import org.jboss.seam.annotations.Name;'];
    const spec = {
      java: {
        'app/src/com/acme/A.java': javaSource('com.acme', imports, ['@Name("dup")', 'public class A {}']),
        'app/src/com/acme/B.java': javaSource('com.acme', imports, ['@Name("dup")', 'public class B {}']),
      },
      files: { 'app/pom.xml': POM, 'app/web/p.xhtml': '#{dup.x}' },
    };
    expect(project(spec).roots.ambiguous).toBe(1);
    const mutated = project({ ...spec, mutations: { firstBinding: true } });
    expect(mutated.roots.ambiguous).toBe(0);
    expect(mutated.links).toHaveLength(1);
  });

  it('simpleNameAnnotations: a same-package @Named is taken for CDI\'s', () => {
    const spec = {
      java: {
        'app/src/com/acme/web/Named.java': 'package com.acme.web;\n\npublic @interface Named { String value(); }\n',
        'app/src/com/acme/web/Mine.java': javaSource('com.acme.web', [], ['@Named("x")', 'public class Mine {}']),
      },
      files: { 'app/pom.xml': POM, 'app/web/p.xhtml': '#{x.a}' },
    };
    expect(project(spec).links).toEqual([]);
    expect(project({ ...spec, mutations: { simpleNameAnnotations: true } }).links).toEqual(['app/web/p.xhtml -> app/src/com/acme/web/Mine.java#Mine']);
  });

  it('simpleNameAnnotations: an on-demand import of another package is no obstacle', () => {
    const spec = {
      java: { 'app/src/com/acme/web/Guice.java': BEAN('com.acme.web', 'Guice', '@Named("x")', ['import com.google.inject.name.*;']) },
      files: { 'app/pom.xml': POM, 'app/web/p.xhtml': '#{x.a}' },
    };
    expect(project(spec).coverage.unconfirmedAnnotations).toEqual({ Named: 1 });
    expect(project({ ...spec, mutations: { simpleNameAnnotations: true } }).links).toHaveLength(1);
  });

  it('ignoreSeesConditions: a Spring bean is visible with no bridge', () => {
    const spec = {
      java: { 'app/src/com/acme/web/Svc.java': BEAN('com.acme.web', 'Svc', '@Service("svc")', ['import org.springframework.stereotype.Service;']) },
      files: { 'app/pom.xml': POM, 'app/web/p.xhtml': '#{svc.a}' },
    };
    expect(project(spec).roots.elsewhere).toBe(1);
    expect(project({ ...spec, mutations: { ignoreSeesConditions: true } }).links).toHaveLength(1);
  });

  it('anyParent: an inner bean\'s id becomes a name (the reading stage)', () => {
    const spring = [
      '<beans><bean id="outer" class="com.acme.web.OrderBean"><property name="p"><bean id="inner" class="com.acme.web.OrderBean"/></property></bean></beans>',
    ];
    const faces = '<faces-config><application><el-resolver>org.springframework.web.jsf.el.SpringBeanFacesELResolver</el-resolver></application></faces-config>';
    const spec = { java: ORDER, files: { 'app/pom.xml': POM, 'app/web/p.xhtml': '#{inner.x}', 'app/WEB-INF/ctx.xml': spring, 'app/WEB-INF/faces-config.xml': faces } };
    expect(project(spec).links).toEqual([]);
    expect(project({ ...spec, siteMutations: { anyParent: true } }).links).toEqual([ORDER_LINK]);
  });

  it('noCommentMask: a commented-out expression and a commented-out bean are read (the reading stage)', () => {
    const spec = {
      java: ORDER,
      files: {
        'app/pom.xml': POM, 'app/web/p.xhtml': '<!-- #{orders.x} -->',
        'app/web/WEB-INF/faces-config.xml': FACES('orders'),
      },
    };
    expect(project(spec).links).toEqual([]);
    expect(project({ ...spec, siteMutations: { noCommentMask: true } }).links).toEqual([ORDER_LINK]);
  });
});
