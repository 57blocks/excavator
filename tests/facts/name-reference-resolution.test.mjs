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
  buildNameBindingTable,
  createAnnotationIdentity,
  createUnitIndex,
  packageOf,
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

  it('keeps a name that is no EL identifier away from expressions, and counts it', () => {
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
// annotation-injection-references, tasks 2.2 and 3.1: the binders catalog
// version 3 adds - EJB session beans, and the Spring stereotypes that carry
// Component as a meta-annotation - produce bindings through the annotation
// binder code that was already there.
// ---------------------------------------------------------------------------

describe('annotation bindings the version 3 catalog adds (annotation-injection-references design D3)', () => {
  const NO_TYPES = { isType: () => false };
  const SRC = (name) => `app/src/com/acme/${name}.java`;

  /** The binding table of Java sources, as buildFactGraph builds it for them, with ids that name the class. */
  function javaTable(java) {
    const rows = Object.entries(java).map(([path, source]) => {
      const text = lines(source);
      const file = { path, language: 'java', fileCategory: 'code' };
      const extracted = analyzeFileWithOutcomes(registry, file, text);
      expect(extracted.structureOutcome).toBe('succeeded');
      const split = text.split('\n');
      return buildResult(file, split.length, split.filter((l) => l.trim()).length, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome);
    });
    const classIds = new Map(rows.map((row) => [row.path, (row.classes ?? []).map((cls) => `class:${row.path}:${cls.name}`)]));
    const javaTypes = rows.flatMap((row) => (row.classes ?? []).map((cls, i) => ({ fqn: cls.qualifiedName, path: row.path, id: classIds.get(row.path)[i] })));
    return buildNameBindingTable({
      sites: { bindings: [], missingNames: {} },
      catalog: CATALOG,
      manifestPaths: [...rows.map((row) => row.path), 'app/pom.xml'],
      javaRows: rows,
      classIds,
      javaTypes,
      otherJvm: NO_TYPES,
      declaredJavaTypes: NO_TYPES,
    });
  }
  /** `[name, namespace, binder, line]` of each binding of the table. */
  const summary = (table) => table.bindings.map((b) => [b.name, b.namespace, b.binder, b.line]);
  const EJB = ['import javax.ejb.Stateless;'];

  it('names a @Stateless class with no name by its simple name, unchanged, in the ejb namespace', () => {
    const table = javaTable({ [SRC('OrderBean')]: BEAN('com.acme', 'OrderBean', '@Stateless', EJB) });
    expect(summary(table)).toEqual([['OrderBean', 'ejb', 'ejb-annotation-session', 4]]);
    expect(table.bindings[0]).toMatchObject({ unit: 'app', target: { kind: 'node', id: `class:${SRC('OrderBean')}:OrderBean` } });
    // the rule is the class name as written, not a decapitalized one
    expect(table.named('orderBean')).toEqual([]);
  });

  it('leaves the case of the class name alone, leading capitals and a lower-case first letter included', () => {
    const table = javaTable({
      [SRC('URLBean')]: BEAN('com.acme', 'URLBean', '@Stateless', EJB),
      [SRC('lowerBean')]: BEAN('com.acme', 'lowerBean', '@Stateless', EJB),
    });
    expect(summary(table).map(([name]) => name).sort()).toEqual(['URLBean', 'lowerBean']);
  });

  it('takes the name of @Stateless(name = ...), and an empty one, or an element other than name, as no name', () => {
    const table = javaTable({
      [SRC('A')]: BEAN('com.acme', 'A', '@Stateless(name = "x")', EJB),
      [SRC('B')]: BEAN('com.acme', 'B', '@Stateless(name = "")', EJB),
      [SRC('C')]: BEAN('com.acme', 'C', '@Stateless(mappedName = "m")', EJB),
    });
    expect(summary(table).map(([name, , , line]) => [name, line]).sort()).toEqual([['B', 4], ['C', 4], ['x', 4]]);
    expect(table.named('A')).toEqual([]);
  });

  it('binds @Stateful and @Singleton, javax and jakarta, written imported or qualified, all as ejb-annotation-session', () => {
    const table = javaTable({
      [SRC('Cart')]: BEAN('com.acme', 'Cart', '@Stateful', ['import javax.ejb.Stateful;']),
      [SRC('Registry')]: BEAN('com.acme', 'Registry', '@Singleton', ['import jakarta.ejb.Singleton;']),
      [SRC('Quote')]: BEAN('com.acme', 'Quote', '@jakarta.ejb.Stateless(name = "quotes")', []),
      [SRC('Bill')]: BEAN('com.acme', 'Bill', '@javax.ejb.Singleton', []),
    });
    expect(summary(table).map(([name, namespace, binder]) => [name, namespace, binder]).sort()).toEqual([
      ['Bill', 'ejb', 'ejb-annotation-session'],
      ['Cart', 'ejb', 'ejb-annotation-session'],
      ['Registry', 'ejb', 'ejb-annotation-session'],
      ['quotes', 'ejb', 'ejb-annotation-session'],
    ]);
  });

  it('counts a @Stateless name that is not a string literal, and makes no binding of it', () => {
    const table = javaTable({ [SRC('Dyn')]: BEAN('com.acme', 'Dyn', '@Stateless(name = Names.X)', EJB) });
    expect(table.bindings).toEqual([]);
    expect(table.tally.nonLiteralNames).toBe(1);
  });

  it('does not take a @Stateless it cannot confirm: one the repository declares in the class\'s own package is not the catalog\'s', () => {
    const table = javaTable({
      [SRC('Stateless')]: javaSource('com.acme', [], ['public @interface Stateless {}']),
      [SRC('Own')]: BEAN('com.acme', 'Own', '@Stateless', []),
    });
    expect(table.bindings).toEqual([]);
  });

  it('names a @Configuration class by its class name decapitalized, in the spring namespace', () => {
    const table = javaTable({
      [SRC('AppConfig')]: BEAN('com.acme', 'AppConfig', '@Configuration', ['import org.springframework.context.annotation.Configuration;']),
    });
    expect(summary(table)).toEqual([['appConfig', 'spring', 'spring-annotation-stereotype', 4]]);
    expect(table.bindings[0].target).toMatchObject({ kind: 'node', id: `class:${SRC('AppConfig')}:AppConfig` });
  });

  it('gives the added stereotypes and the controller advice binder the Spring rules: an explicit name wins, a leading run of capitals is kept', () => {
    const web = (name) => `import org.springframework.web.bind.annotation.${name};`;
    const table = javaTable({
      [SRC('Settings')]: BEAN('com.acme', 'Settings', '@Configuration("cfg")', ['import org.springframework.context.annotation.Configuration;']),
      [SRC('OrdersApi')]: BEAN('com.acme', 'OrdersApi', '@RestController', [web('RestController')]),
      [SRC('Named')]: BEAN('com.acme', 'Named', '@RestController("namedApi")', [web('RestController')]),
      [SRC('Faults')]: BEAN('com.acme', 'Faults', '@ControllerAdvice', [web('ControllerAdvice')]),
      [SRC('RestFaults')]: BEAN('com.acme', 'RestFaults', '@RestControllerAdvice', [web('RestControllerAdvice')]),
      [SRC('URLConfig')]: BEAN('com.acme', 'URLConfig', '@Configuration', ['import org.springframework.context.annotation.Configuration;']),
    });
    expect(summary(table).map(([name, namespace]) => [name, namespace]).sort()).toEqual([
      ['URLConfig', 'spring'], ['cfg', 'spring'], ['faults', 'spring'], ['namedApi', 'spring'], ['ordersApi', 'spring'], ['restFaults', 'spring'],
    ]);
    expect(Object.fromEntries(summary(table).map(([name, , binder]) => [name, binder]))).toMatchObject({
      cfg: 'spring-annotation-stereotype', ordersApi: 'spring-annotation-stereotype', namedApi: 'spring-annotation-stereotype',
      URLConfig: 'spring-annotation-stereotype', faults: 'spring-annotation-advice', restFaults: 'spring-annotation-advice',
    });
  });

  it('never reads the value of a controller advice as its name: it is the base packages, and name is the bean name', () => {
    const web = (name) => `import org.springframework.web.bind.annotation.${name};`;
    const table = javaTable({
      [SRC('Faults')]: BEAN('com.acme', 'Faults', '@ControllerAdvice("com.acme.web")', [web('ControllerAdvice')]),
      [SRC('RestFaults')]: BEAN('com.acme', 'RestFaults', '@RestControllerAdvice(basePackages = "com.acme.api")', [web('RestControllerAdvice')]),
      [SRC('Handler')]: BEAN('com.acme', 'Handler', '@ControllerAdvice(name = "errors", value = "com.acme")', [web('ControllerAdvice')]),
    });
    expect(summary(table).map(([name, namespace, binder]) => [name, namespace, binder]).sort()).toEqual([
      ['errors', 'spring', 'spring-annotation-advice'],
      ['faults', 'spring', 'spring-annotation-advice'],
      ['restFaults', 'spring', 'spring-annotation-advice'],
    ]);
  });

  it('keeps EJB names out of expressions: the ejb namespace is not one the expression language sees', () => {
    const p = project({
      java: { [SRC('OrderBean')]: BEAN('com.acme', 'OrderBean', '@Stateless', EJB) },
      files: { 'app/pom.xml': POM, 'app/web/p.xhtml': '<p>#{OrderBean.total}</p>' },
    });
    expect(p.links).toEqual([]);
    expect(p.roots.elsewhere).toBe(1);
    expect(p.samples('name-reference-elsewhere')).toEqual(['app/web/p.xhtml:1 OrderBean -> [app [ejb]]']);
  });

  it('counts the EJB binder in the coverage like any binder, with a missing-names key of its own', () => {
    const p = project({
      java: {
        [SRC('OrderBean')]: BEAN('com.acme', 'OrderBean', '@Stateless', EJB),
        [SRC('Quote')]: BEAN('com.acme', 'Quote', '@Stateless(name = "quotes")', EJB),
        [SRC('Plain')]: javaSource('com.acme', [], ['public class Plain {}']),
      },
      files: { 'app/pom.xml': POM },
    });
    expect(p.coverage.bindings['ejb-annotation-session']).toBe(2);
    expect(p.coverage.missingNames['ejb-annotation-session']).toBe(0);
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

// ---------------------------------------------------------------------------
// xml-injection-references, design D2 and D3: one binding table, targets
// resolved through aliases, parents and factories
// ---------------------------------------------------------------------------

describe('Spring definitions: parent, factory method and alias (design D3; spec: name binding)', () => {
  const BRIDGE = '<faces-config><application><el-resolver>org.springframework.web.jsf.el.SpringBeanFacesELResolver</el-resolver></application></faces-config>';
  const BEANS_OPEN = '<beans xmlns="http://www.springframework.org/schema/beans">';
  const CTX = 'app/WEB-INF/ctx.xml';
  const javaOf = (...names) => Object.fromEntries(names.map((n) => [`app/src/com/acme/${n}.java`, javaSource('com.acme', [], `public class ${n} {}`)]));
  const CLASS = (n) => `app/src/com/acme/${n}.java#${n}`;
  /** One unit with a page, the Spring bridge and a context whose first bean is on line 2. */
  const unit = (definitions, expressions, extra = {}) => ({
    'app/pom.xml': POM,
    'app/web/p.xhtml': `<p>${expressions}</p>`,
    'app/web/WEB-INF/faces-config.xml': BRIDGE,
    [CTX]: [BEANS_OPEN, ...[definitions].flat(), '</beans>'].join('\n'),
    ...extra,
  });
  const unknownSamples = (p) => p.samples('name-reference-target-unknown');

  describe('a bean with only a parent', () => {
    it('is the class of the definition its parent names (spec)', () => {
      const p = project({ java: javaOf('BaseDao'), files: unit(['  <bean id="base" class="com.acme.BaseDao"/>', '  <bean id="child" parent="base"/>'], '#{child.run}') });
      expect(p.links).toEqual([`app/web/p.xhtml -> ${CLASS('BaseDao')}`]);
      // the evidence cites the binding the page's name hit, not the ones its resolution went through
      expect(p.edge('app/web/p.xhtml', CLASS('BaseDao')).evidence[0].bindings).toEqual([{ file: CTX, line: 3, binder: 'spring-xml-bean' }]);
      expect(p.roots.edge).toBe(1);
    });

    it('follows a chain of parents', () => {
      const p = project({
        java: javaOf('BaseDao'),
        files: unit(['  <bean id="base" class="com.acme.BaseDao"/>', '  <bean id="mid" parent="base"/>', '  <bean id="leaf" parent="mid"/>'], '#{leaf.run}'),
      });
      expect(p.links).toEqual([`app/web/p.xhtml -> ${CLASS('BaseDao')}`]);
    });

    it('is "unknown" when no bean of the unit has the parent\'s name, and says so (spec)', () => {
      const p = project({ files: unit('  <bean id="child" parent="base"/>', '#{child.run}') });
      expect(p.links).toEqual([]);
      expect(p.roots.unknown).toBe(1);
      expect(unknownSamples(p)).toEqual([`app/web/p.xhtml:1 child -> [${CTX}:2 (base has no binding in this unit)]`]);
    });

    it('does not look for the parent in another unit', () => {
      const p = project({
        java: javaOf('BaseDao'),
        files: unit('  <bean id="child" parent="base"/>', '#{child.run}', {
          'other/pom.xml': POM,
          'other/ctx.xml': `${BEANS_OPEN}\n  <bean id="base" class="com.acme.BaseDao"/>\n</beans>`,
        }),
      });
      expect(p.links).toEqual([]);
      expect(p.roots.unknown).toBe(1);
    });

    it('keeps the class it writes itself: the parent is for a bean with no class', () => {
      const p = project({
        java: javaOf('BaseDao', 'OwnDao'),
        files: unit(['  <bean id="base" class="com.acme.BaseDao"/>', '  <bean id="child" class="com.acme.OwnDao" parent="base"/>'], '#{child.run}'),
      });
      expect(p.links).toEqual([`app/web/p.xhtml -> ${CLASS('OwnDao')}`]);
    });

    it('takes the class of an annotated parent, which XML and annotations both declare names for', () => {
      const p = project({
        java: { 'app/src/com/acme/Repo.java': BEAN('com.acme', 'Repo', '@Repository("baseDao")', ['import org.springframework.stereotype.Repository;']) },
        files: unit('  <bean id="child" parent="baseDao"/>', '#{child.run}'),
      });
      expect(p.links).toEqual([`app/web/p.xhtml -> ${CLASS('Repo')}`]);
    });

    it('is ambiguous when its parent\'s name is declared for two classes', () => {
      const p = project({
        java: javaOf('OneDao', 'TwoDao'),
        files: unit(['  <bean id="base" class="com.acme.OneDao"/>', '  <bean id="base" class="com.acme.TwoDao"/>', '  <bean id="child" parent="base"/>'], '#{child.run}'),
      });
      expect(p.links).toEqual([]);
      expect(p.roots.ambiguous).toBe(1);
      expect(p.samples('name-reference-ambiguous')[0]).toContain(CLASS('OneDao'));
      expect(p.samples('name-reference-ambiguous')[0]).toContain(CLASS('TwoDao'));
    });

    it('is "unknown" when its parent is a factory-method bean, and passes the reason on', () => {
      const p = project({ java: javaOf('Locator'), files: unit(['  <bean id="svc" class="com.acme.Locator" factory-method="lookup"/>', '  <bean id="child" parent="svc"/>'], '#{child.run}') });
      expect(p.links).toEqual([]);
      expect(unknownSamples(p)).toEqual([`app/web/p.xhtml:1 child -> [${CTX}:3 (factory-method)]`]);
    });
  });

  describe('a bean built by a factory', () => {
    it('is "unknown", not the factory\'s class: the class a factory-method bean writes is the factory (spec)', () => {
      const p = project({ java: javaOf('ServiceLocator'), files: unit('  <bean id="svc" class="com.acme.ServiceLocator" factory-method="lookup"/>', '#{svc.run}') });
      expect(p.links).toEqual([]);
      expect(p.roots).toMatchObject({ unknown: 1, edge: 0 });
      expect(unknownSamples(p)).toEqual([`app/web/p.xhtml:1 svc -> [${CTX}:2 (factory-method)]`]);
    });

    it('is "unknown" when the factory is another bean and no class is written', () => {
      const p = project({ files: unit('  <bean id="made" factory-bean="locator" factory-method="make"/>', '#{made.run}') });
      expect(p.roots.unknown).toBe(1);
      expect(unknownSamples(p)).toEqual([`app/web/p.xhtml:1 made -> [${CTX}:2 (factory-method)]`]);
      const other = project({ files: unit('  <bean id="made" factory-bean="locator"/>', '#{made.run}') });
      expect(unknownSamples(other)).toEqual([`app/web/p.xhtml:1 made -> [${CTX}:2 (factory-bean)]`]);
    });

    it('makes a same-named annotated component an ambiguity: unknown and a class do not agree', () => {
      const p = project({
        java: { 'app/src/com/acme/Svc.java': BEAN('com.acme', 'Svc', '@Service("svc")', ['import org.springframework.stereotype.Service;']), ...javaOf('Locator') },
        files: unit('  <bean id="svc" class="com.acme.Locator" factory-method="lookup"/>', '#{svc.run}'),
      });
      expect(p.links).toEqual([]);
      expect(p.roots.ambiguous).toBe(1);
    });
  });

  describe('an alias', () => {
    it('is the class of the bean it names (spec)', () => {
      const p = project({ java: javaOf('OrderDaoImpl'), files: unit(['  <bean id="orderDao" class="com.acme.OrderDaoImpl"/>', '  <alias name="orderDao" alias="orders"/>'], '#{orders.save}') });
      expect(p.links).toEqual([`app/web/p.xhtml -> ${CLASS('OrderDaoImpl')}`]);
      expect(p.edge('app/web/p.xhtml', CLASS('OrderDaoImpl')).evidence[0]).toMatchObject({
        token: 'orders', name: 'orders', bindings: [{ file: CTX, line: 3, binder: 'spring-xml-alias' }],
      });
      expect(p.coverage.bindings).toMatchObject({ 'spring-xml-bean': 1, 'spring-xml-alias': 1 });
    });

    it('leaves the bean\'s own name working', () => {
      const p = project({ java: javaOf('OrderDaoImpl'), files: unit(['  <bean id="orderDao" class="com.acme.OrderDaoImpl"/>', '  <alias name="orderDao" alias="orders"/>'], '#{orderDao.save} #{orders.save}') });
      expect(p.roots.edge).toBe(2);
      expect(p.references).toHaveLength(1);
    });

    it('follows an alias of an alias', () => {
      const p = project({
        java: javaOf('OrderDaoImpl'),
        files: unit(['  <alias name="orders" alias="purchases"/>', '  <alias name="orderDao" alias="orders"/>', '  <bean id="orderDao" class="com.acme.OrderDaoImpl"/>'], '#{purchases.save}'),
      });
      expect(p.links).toEqual([`app/web/p.xhtml -> ${CLASS('OrderDaoImpl')}`]);
    });

    it('names a component an annotation declares', () => {
      const p = project({
        java: { 'app/src/com/acme/JdbcDao.java': BEAN('com.acme', 'JdbcDao', '@Repository("orderDao")', ['import org.springframework.stereotype.Repository;']) },
        files: unit('  <alias name="orderDao" alias="orders"/>', '#{orders.save}'),
      });
      expect(p.links).toEqual([`app/web/p.xhtml -> ${CLASS('JdbcDao')}`]);
    });

    it('names a bean whose own name no expression can reach (a dotted id)', () => {
      const p = project({
        java: javaOf('OrderDaoImpl'),
        files: unit(['  <bean id="com.acme.OrderDao" class="com.acme.OrderDaoImpl"/>', '  <alias name="com.acme.OrderDao" alias="orders"/>'], '#{orders.save} #{com.acme.OrderDao.save}'),
      });
      expect(p.links).toEqual([`app/web/p.xhtml -> ${CLASS('OrderDaoImpl')}`]);
      expect(p.coverage.nonIdentifierNames).toBe(1); // the dotted id, as before
      expect(p.coverage.bindings).toMatchObject({ 'spring-xml-bean': 0, 'spring-xml-alias': 1 });
      expect(p.roots).toMatchObject({ edge: 1, unbound: 1 }); // `com` names nothing
    });

    it('is itself out of reach of expressions when its own name is dotted, and counted so', () => {
      const p = project({ java: javaOf('OrderDaoImpl'), files: unit(['  <bean id="orderDao" class="com.acme.OrderDaoImpl"/>', '  <alias name="orderDao" alias="orders.v2"/>'], '#{orders.v2.save}') });
      expect(p.links).toEqual([]);
      expect(p.coverage.nonIdentifierNames).toBe(1);
      expect(p.coverage.bindings['spring-xml-alias']).toBe(0);
    });

    it('is "unknown" when the name it gives has no binding in the unit, and says so (spec)', () => {
      const p = project({ files: unit('  <alias name="orderDao" alias="orders"/>', '#{orders.save}') });
      expect(p.roots.unknown).toBe(1);
      expect(unknownSamples(p)).toEqual([`app/web/p.xhtml:1 orders -> [${CTX}:2 (orderDao has no binding in this unit)]`]);
    });

    it('does not name a bean of another unit', () => {
      const p = project({
        java: javaOf('OrderDaoImpl'),
        files: unit('  <alias name="orderDao" alias="orders"/>', '#{orders.save}', {
          'other/pom.xml': POM,
          'other/ctx.xml': `${BEANS_OPEN}\n  <bean id="orderDao" class="com.acme.OrderDaoImpl"/>\n</beans>`,
        }),
      });
      expect(p.links).toEqual([]);
      expect(p.roots.unknown).toBe(1);
    });

    it('does not name a binding of another namespace: Spring aliases name Spring beans', () => {
      const p = project({
        java: javaOf('OrderBean'),
        files: unit('  <alias name="orderBean" alias="orders"/>', '#{orders.save}', {
          'app/web/WEB-INF/faces-config.xml': `<faces-config><application><el-resolver>org.springframework.web.jsf.el.SpringBeanFacesELResolver</el-resolver></application><managed-bean><managed-bean-name>orderBean</managed-bean-name><managed-bean-class>com.acme.OrderBean</managed-bean-class></managed-bean></faces-config>`,
        }),
      });
      expect(p.links).toEqual([]);
      expect(p.roots.unknown).toBe(1);
    });

    it('is "unknown" in a cycle, for both names, and stops (spec)', () => {
      const p = project({ files: unit(['  <alias name="a" alias="b"/>', '  <alias name="b" alias="a"/>'], '#{a.x} #{b.x}') });
      expect(p.links).toEqual([]);
      expect(p.roots.unknown).toBe(2);
      expect(unknownSamples(p)).toEqual([`app/web/p.xhtml:1 a -> [${CTX}:3 (cycle)]`, `app/web/p.xhtml:1 b -> [${CTX}:2 (cycle)]`]);
    });

    it('is "unknown" when a bean names itself as parent', () => {
      const p = project({ files: unit('  <bean id="loop" parent="loop"/>', '#{loop.x}') });
      expect(p.roots.unknown).toBe(1);
      expect(unknownSamples(p)).toEqual([`app/web/p.xhtml:1 loop -> [${CTX}:2 (cycle)]`]);
    });

    it('is one edge with both bindings\' evidence when the bean and its alias are used on one page', () => {
      const p = project({ java: javaOf('OrderDaoImpl'), files: unit(['  <bean id="orderDao" class="com.acme.OrderDaoImpl"/>', '  <alias name="orderDao" alias="orders"/>'], '#{orderDao.a}\n#{orders.b}') });
      expect(p.references).toHaveLength(1);
      expect(p.references[0].evidence.map((e) => [e.token, e.bindings.map((b) => b.binder)])).toEqual([['orderDao', ['spring-xml-bean']], ['orders', ['spring-xml-alias']]]);
    });
  });

  it('does not make a name another unit declares as a dotted Spring id an "elsewhere": EL cannot reach it, so it is not there (D2)', () => {
    const p = project({
      java: javaOf('OrderDaoImpl'),
      files: {
        'a/pom.xml': POM, 'a/web/p.xhtml': '<p>#{admin.track.x}</p>',
        'b/pom.xml': POM, 'b/ctx.xml': `${BEANS_OPEN}\n  <bean id="admin.track" class="com.acme.OrderDaoImpl"/>\n</beans>`,
      },
    });
    expect(p.roots).toMatchObject({ elsewhere: 0, unbound: 1 });
    // the same name as a binding EL can reach (a CDI Named bean's dotted name is a namespace) in another unit is "elsewhere", as before
    const q = project({
      java: { 'b/src/com/b/Track.java': BEAN('com.b', 'Track', '@Named("admin.track")') },
      files: { 'a/pom.xml': POM, 'a/web/p.xhtml': '<p>#{admin.track.x}</p>', 'b/pom.xml': POM },
    });
    expect(q.roots.elsewhere).toBe(1);
  });
});

describe('the binding table (design D2, D3)', () => {
  const BEANS_OPEN = '<beans xmlns="http://www.springframework.org/schema/beans">';
  const TYPES = [
    { fqn: 'com.acme.OrderDaoImpl', path: 'app/src/OrderDaoImpl.java', id: 'class:app/src/OrderDaoImpl.java:OrderDaoImpl' },
    { fqn: 'com.acme.Locator', path: 'app/src/Locator.java', id: 'class:app/src/Locator.java:Locator' },
  ];
  const NO_TYPES = { isType: () => false };

  /** The table of in-memory descriptors, built the way buildFactGraph builds it, with no Java rows. */
  function tableOf(files, { javaTypes = TYPES, mutations } = {}) {
    const scanFiles = Object.keys(files).map((path) => ({ path, language: LANGUAGE_OF_EXTENSION[extname(path).slice(1)] ?? 'unknown' }));
    const sites = collectNameReferenceSites({ scan: { files: scanFiles }, catalog: CATALOG, readFile: (path) => files[path] });
    return buildNameBindingTable({
      sites, catalog: CATALOG, manifestPaths: Object.keys(files), javaRows: [], classIds: new Map(), javaTypes, otherJvm: NO_TYPES, declaredJavaTypes: NO_TYPES, mutations,
    });
  }
  const ctx = (...lines) => [BEANS_OPEN, ...lines, '</beans>'].join('\n');
  const FILES = {
    'app/pom.xml': POM,
    'app/ctx.xml': ctx(
      '  <bean id="orderDao" class="com.acme.OrderDaoImpl"/>',
      '  <alias name="orderDao" alias="orders"/>',
      '  <bean id="com.acme.api.OrderDao" class="com.acme.OrderDaoImpl"/>',
      '  <bean id="a/b" class="com.acme.OrderDaoImpl"/>',
      '  <bean id="svc" class="com.acme.Locator" factory-method="make"/>',
    ),
  };
  const SPRING_APP = { unit: 'app', namespace: 'spring' };
  const sitesOf = (via) => via.map((s) => [s.file, s.line, s.binder]);

  it('holds every name, dotted and slashed ones included, each flagged by whether an expression can reach it', () => {
    const table = tableOf(FILES);
    expect(table.bindings.map((b) => [b.name, b.binder, b.el])).toEqual([
      ['orderDao', 'spring-xml-bean', true],
      ['com.acme.api.OrderDao', 'spring-xml-bean', false],
      ['a/b', 'spring-xml-bean', false],
      ['svc', 'spring-xml-bean', true],
      ['orders', 'spring-xml-alias', true],
    ]);
  });

  it('counts the names an expression cannot reach in the tally, as it counted the names it dropped', () => {
    expect(tableOf(FILES).tally.nonIdentifierNames).toBe(2);
    expect(tableOf(FILES).tally.nonLiteralNames).toBe(0);
  });

  it('finds the bindings of a name by unit and namespace, and by file', () => {
    const table = tableOf({
      ...FILES,
      'app/more.xml': ctx('  <bean id="orderDao" class="com.acme.Locator"/>'),
      'other/pom.xml': POM,
      'other/ctx.xml': ctx('  <bean id="orderDao" class="com.acme.OrderDaoImpl"/>'),
    });
    expect(table.bindingsNamed('orderDao', SPRING_APP).map((b) => b.file).sort()).toEqual(['app/ctx.xml', 'app/more.xml']);
    expect(table.bindingsNamed('orderDao', { ...SPRING_APP, file: 'app/more.xml' }).map((b) => b.file)).toEqual(['app/more.xml']);
    expect(table.bindingsNamed('orderDao', { unit: 'app', namespace: 'el' })).toEqual([]);
    expect(table.bindingsNamed('orderDao', { unit: 'other', namespace: 'spring' }).map((b) => b.file)).toEqual(['other/ctx.xml']);
    expect(table.named('orderDao')).toHaveLength(3); // anywhere
    expect(table.named('nothing')).toEqual([]);
  });

  it('resolves a name to the class its bindings come to, and lists every binding it went through', () => {
    const table = tableOf(FILES);
    const direct = table.resolveName('orderDao', SPRING_APP);
    expect(direct.target).toMatchObject({ kind: 'node', id: 'class:app/src/OrderDaoImpl.java:OrderDaoImpl' });
    expect(sitesOf(direct.via)).toEqual([['app/ctx.xml', 2, 'spring-xml-bean']]);

    const alias = table.resolveName('orders', SPRING_APP);
    expect(alias.hits.map((b) => b.binder)).toEqual(['spring-xml-alias']);
    expect(alias.target).toMatchObject({ kind: 'node', id: 'class:app/src/OrderDaoImpl.java:OrderDaoImpl' });
    // the name's own binding, and the binding it names
    expect(sitesOf(alias.via)).toEqual([['app/ctx.xml', 2, 'spring-xml-bean'], ['app/ctx.xml', 3, 'spring-xml-alias']]);
  });

  it('resolves a dotted or slashed name, which the table holds though expressions cannot reach it', () => {
    const table = tableOf(FILES);
    for (const name of ['com.acme.api.OrderDao', 'a/b']) {
      expect(table.resolveName(name, SPRING_APP).target).toMatchObject({ kind: 'node', id: 'class:app/src/OrderDaoImpl.java:OrderDaoImpl' });
    }
  });

  it('resolves a name with no binding in the unit as unknown, with the reason and no bindings', () => {
    const table = tableOf(FILES);
    const none = table.resolveName('missing', SPRING_APP);
    expect(none.hits).toEqual([]);
    expect(none.target).toMatchObject({ kind: 'unknown', key: 'unknown', reason: 'missing has no binding in this unit' });
    expect(none.via).toEqual([]);
    expect(table.resolveName('orderDao', { unit: 'elsewhere', namespace: 'spring' }).target.reason).toBe('orderDao has no binding in this unit');
  });

  it('limits the hits of a name to one file and still resolves their targets in the unit', () => {
    const table = tableOf({
      'app/pom.xml': POM,
      'app/a.xml': ctx('  <alias name="orderDao" alias="orders"/>'),
      'app/b.xml': ctx('  <bean id="orderDao" class="com.acme.OrderDaoImpl"/>'),
    });
    expect(table.resolveName('orders', { ...SPRING_APP, file: 'app/a.xml' }).target.kind).toBe('node');
    expect(table.resolveName('orderDao', { ...SPRING_APP, file: 'app/a.xml' }).hits).toEqual([]);
    expect(table.resolveName('orderDao', { ...SPRING_APP, file: 'app/a.xml' }).target.reason).toBe('orderDao has no binding in this unit');
  });

  it('gives a factory-method bean the unknown target with the attribute as the reason, though it writes a class', () => {
    const [svc] = tableOf(FILES).bindingsNamed('svc', SPRING_APP);
    expect(svc.target).toMatchObject({ kind: 'unknown', key: 'unknown', reason: 'factory-method', via: [] });
  });

  it('resolves each binding once: the target of a binding is the same object each time it is asked for', () => {
    const table = tableOf(FILES);
    const [a] = table.bindingsNamed('orders', SPRING_APP);
    expect(table.resolveName('orders', SPRING_APP).hits[0].target).toBe(a.target);
  });

  it('ends a cycle in unknown, with the reason "cycle", whichever binding it starts from', () => {
    for (const lines of [['  <alias name="a" alias="b"/>', '  <alias name="b" alias="a"/>'], ['  <alias name="b" alias="a"/>', '  <alias name="a" alias="b"/>']]) {
      const table = tableOf({ 'app/pom.xml': POM, 'app/ctx.xml': ctx(...lines) });
      for (const name of ['a', 'b']) expect(table.resolveName(name, SPRING_APP).target).toMatchObject({ kind: 'unknown', reason: 'cycle' });
    }
  });

  it('classifies several bindings of one name as the expression stage does: agreeing, ambiguous or unknown', () => {
    const agree = tableOf({ 'app/pom.xml': POM, 'app/ctx.xml': ctx('  <bean id="x" class="com.acme.OrderDaoImpl"/>', '  <bean id="x" class="com.acme.OrderDaoImpl"/>') });
    expect(agree.resolveName('x', SPRING_APP).target.kind).toBe('node');
    const differ = tableOf({ 'app/pom.xml': POM, 'app/ctx.xml': ctx('  <bean id="x" class="com.acme.OrderDaoImpl"/>', '  <bean id="x" class="com.acme.Locator"/>') });
    expect(differ.resolveName('x', SPRING_APP).target).toMatchObject({ kind: 'ambiguous' });
    expect(differ.resolveName('x', SPRING_APP).target.labels).toEqual(['app/src/Locator.java#Locator', 'app/src/OrderDaoImpl.java#OrderDaoImpl']);
    const unknown = tableOf({ 'app/pom.xml': POM, 'app/ctx.xml': ctx('  <bean id="x" parent="p"/>', '  <bean id="x" factory-bean="f"/>') });
    expect(unknown.resolveName('x', SPRING_APP).target).toMatchObject({ kind: 'unknown', reason: 'factory-bean; p has no binding in this unit' });
  });

  it('follows no alias when the mutation noAliases says so, and no parent for noInheritance, and honours factory attributes unless ignoreUnknownWhen', () => {
    const files = {
      'app/pom.xml': POM,
      'app/ctx.xml': ctx('  <bean id="orderDao" class="com.acme.OrderDaoImpl"/>', '  <alias name="orderDao" alias="orders"/>', '  <bean id="child" parent="orderDao"/>', '  <bean id="svc" class="com.acme.Locator" factory-method="make"/>'),
    };
    const kinds = (mutations) => {
      const table = tableOf(files, { mutations });
      return Object.fromEntries(['orders', 'child', 'svc'].map((name) => [name, table.resolveName(name, SPRING_APP).target.kind]));
    };
    expect(kinds({})).toEqual({ orders: 'node', child: 'node', svc: 'unknown' });
    expect(kinds({ noAliases: true })).toEqual({ orders: 'unknown', child: 'node', svc: 'unknown' });
    expect(kinds({ noInheritance: true })).toEqual({ orders: 'node', child: 'unknown', svc: 'unknown' });
    expect(kinds({ ignoreUnknownWhen: true })).toEqual({ orders: 'node', child: 'node', svc: 'node' });
  });

  it('resolves what an element declared without a binding of its own, as a binding is resolved: resolveDeclared (design D5)', () => {
    const table = tableOf({ 'app/pom.xml': POM, 'app/ctx.xml': ctx('  <bean id="orderDao" class="com.acme.OrderDaoImpl"/>', '  <bean id="svc" class="com.acme.Locator" factory-method="make"/>') });
    const resolve = (rules) => table.resolveDeclared({ declared: null, unknownBecause: null, inherits: null, ...SPRING_APP, ...rules });
    // its own class
    expect(resolve({ declared: { kind: 'class', text: 'com.acme.OrderDaoImpl' } })).toMatchObject({ kind: 'node', id: 'class:app/src/OrderDaoImpl.java:OrderDaoImpl', via: [] });
    expect(resolve({ declared: { kind: 'class', text: 'org.other.Outside' } })).toMatchObject({ kind: 'external' });
    // a factory attribute wins over the class it writes
    expect(resolve({ declared: { kind: 'class', text: 'com.acme.OrderDaoImpl' }, unknownBecause: 'factory-method' })).toMatchObject({ kind: 'unknown', reason: 'factory-method' });
    // no class: the parent's, with the bindings gone through
    const inherited = resolve({ inherits: 'orderDao' });
    expect(inherited).toMatchObject({ kind: 'node', id: 'class:app/src/OrderDaoImpl.java:OrderDaoImpl' });
    expect(sitesOf(inherited.via)).toEqual([['app/ctx.xml', 2, 'spring-xml-bean']]);
    expect(resolve({ inherits: 'svc' })).toMatchObject({ kind: 'unknown', reason: 'factory-method' });
    expect(resolve({ inherits: 'missing' })).toMatchObject({ kind: 'unknown', reason: 'missing has no binding in this unit' });
    // nothing to go on
    expect(resolve({})).toMatchObject({ kind: 'unknown', key: 'unknown', via: [] });
    expect(resolve({}).reason).toBeUndefined();
    // the name is looked up in the unit and namespace it is given
    expect(resolve({ inherits: 'orderDao', unit: 'other' })).toMatchObject({ kind: 'unknown', reason: 'orderDao has no binding in this unit' });
    expect(resolve({ inherits: 'orderDao', namespace: 'el' })).toMatchObject({ kind: 'unknown' });
  });

  it('acts on what is declared without a binding the way it acts on a binding: the seams noInheritance, ignoreUnknownWhen and noAliases', () => {
    const files = { 'app/pom.xml': POM, 'app/ctx.xml': ctx('  <bean id="orderDao" class="com.acme.OrderDaoImpl"/>') };
    const resolve = (mutations, rules) => tableOf(files, { mutations }).resolveDeclared({ declared: null, unknownBecause: null, inherits: null, ...SPRING_APP, ...rules });
    expect(resolve({}, { inherits: 'orderDao' }).kind).toBe('node');
    expect(resolve({ noInheritance: true }, { inherits: 'orderDao' }).kind).toBe('unknown');
    const factory = { declared: { kind: 'class', text: 'com.acme.Locator' }, unknownBecause: 'factory-bean' };
    expect(resolve({}, factory).kind).toBe('unknown');
    expect(resolve({ ignoreUnknownWhen: true }, factory).kind).toBe('node');
    const alias = { declared: { kind: 'name', text: 'orderDao' } };
    expect(resolve({}, alias).kind).toBe('node');
    expect(resolve({ noAliases: true }, alias).kind).toBe('unknown');
  });

  it('classifies any list of bindings: resolveHits, which resolveName is over the bindings of one name', () => {
    const table = tableOf({
      'app/pom.xml': POM,
      'app/ctx.xml': ctx('  <bean id="x" class="com.acme.OrderDaoImpl"/>', '  <bean id="y" class="com.acme.Locator"/>', '  <bean id="z" class="com.acme.OrderDaoImpl"/>'),
    });
    const [x, y, z] = ['x', 'y', 'z'].map((name) => table.bindingsNamed(name, SPRING_APP)[0]);
    expect(table.resolveHits([x, z]).target.kind).toBe('node');
    expect(table.resolveHits([x, y]).target.kind).toBe('ambiguous');
    expect(sitesOf(table.resolveHits([x, y]).via)).toEqual([['app/ctx.xml', 2, 'spring-xml-bean'], ['app/ctx.xml', 3, 'spring-xml-bean']]);
    expect(table.resolveHits([x]).hits).toEqual([x]);
    expect(table.resolveName('x', SPRING_APP)).toEqual(table.resolveHits([x]));
  });

  it('fails on a binding of a binder the catalog does not have, or in a file outside the manifest', () => {
    const files = { 'app/pom.xml': POM, 'app/ctx.xml': ctx('  <bean id="x" class="com.acme.OrderDaoImpl"/>') };
    const scanFiles = Object.keys(files).map((path) => ({ path, language: 'xml' }));
    const sites = collectNameReferenceSites({ scan: { files: scanFiles }, catalog: CATALOG, readFile: (path) => files[path] });
    const build = (edit) => () => buildNameBindingTable({
      sites: edit(structuredClone(sites)), catalog: CATALOG, manifestPaths: Object.keys(files), javaRows: [], classIds: new Map(), javaTypes: TYPES, otherJvm: NO_TYPES, declaredJavaTypes: NO_TYPES,
    });
    expect(build((x) => x)).not.toThrow();
    expect(build((x) => { x.bindings[0].binder = 'nope'; return x; })).toThrow(/binder "nope", which the catalog does not have/);
    expect(build((x) => { x.bindings[0].file = 'elsewhere.xml'; return x; })).toThrow(/outside the manifest: elsewhere\.xml/);
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
      'cdi-annotation-model', 'cdi-annotation-named', 'ejb-annotation-session', 'jsf-annotation-managed-bean', 'jsf-xml-managed-bean', 'jsf-xml-resource-bundle',
      'seam-annotation-name', 'seam-annotation-role', 'seam-xml-component', 'spring-annotation-advice', 'spring-annotation-stereotype', 'spring-xml-alias',
      'spring-xml-bean',
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
    // what the name-reference stage returns for a project with nothing in it (the injection keys are xml-injection-references')
    const sites = { files: [], bindings: [], injections: [], injectionFiles: { 'spring-xml-injection': 0 }, uncoveredReferences: {}, conditions: [], outsideFiles: {} };
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

  describe('the target rules of Spring definitions (xml-injection-references)', () => {
    const BRIDGE = '<faces-config><application><el-resolver>org.springframework.web.jsf.el.SpringBeanFacesELResolver</el-resolver></application></faces-config>';
    const spec = (definitions, expressions) => ({
      java: {
        'app/src/com/acme/OrderDaoImpl.java': javaSource('com.acme', [], 'public class OrderDaoImpl {}'),
        'app/src/com/acme/Locator.java': javaSource('com.acme', [], 'public class Locator {}'),
      },
      files: {
        'app/pom.xml': POM, 'app/web/p.xhtml': `<p>${expressions}</p>`, 'app/web/WEB-INF/faces-config.xml': BRIDGE,
        'app/WEB-INF/ctx.xml': ['<beans xmlns="http://www.springframework.org/schema/beans">', ...definitions, '</beans>'].join('\n'),
      },
    });
    const DAO = '  <bean id="orderDao" class="com.acme.OrderDaoImpl"/>';

    it('noAliases: an alias is not followed to the bean it names', () => {
      const alias = spec([DAO, '  <alias name="orderDao" alias="orders"/>'], '#{orders.x}');
      expect(project(alias).links).toEqual(['app/web/p.xhtml -> app/src/com/acme/OrderDaoImpl.java#OrderDaoImpl']);
      const mutated = project({ ...alias, mutations: { noAliases: true } });
      expect(mutated.links).toEqual([]);
      expect(mutated.roots.unknown).toBe(1);
    });

    it('noInheritance: a bean with only a parent does not take the parent\'s class', () => {
      const child = spec([DAO, '  <bean id="child" parent="orderDao"/>'], '#{child.x}');
      expect(project(child).links).toEqual(['app/web/p.xhtml -> app/src/com/acme/OrderDaoImpl.java#OrderDaoImpl']);
      const mutated = project({ ...child, mutations: { noInheritance: true } });
      expect(mutated.links).toEqual([]);
      expect(mutated.roots.unknown).toBe(1);
    });

    it('ignoreUnknownWhen: a factory-method bean is taken for an instance of the class it writes', () => {
      const factory = spec(['  <bean id="svc" class="com.acme.Locator" factory-method="make"/>'], '#{svc.x}');
      expect(project(factory).links).toEqual([]);
      expect(project({ ...factory, mutations: { ignoreUnknownWhen: true } }).links).toEqual(['app/web/p.xhtml -> app/src/com/acme/Locator.java#Locator']);
    });
  });

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

// ---------------------------------------------------------------------------
// annotation-injection-references, task 3.1: one annotation identity function,
// and the bindings that come to a class
// ---------------------------------------------------------------------------

describe('the annotation identity function the annotation bindings and the annotation injection sites share (annotation-injection-references design D2)', () => {
  const NO_TYPES = { isType: () => false };
  const RESOURCE = 'javax.annotation.Resource';
  const FQNS = [RESOURCE, 'jakarta.annotation.Resource', 'org.springframework.beans.factory.annotation.Qualifier'];

  /** The structure row of a Java source, as Core emits it. */
  function rowOf(path, source) {
    const text = lines(source);
    const file = { path, language: 'java', fileCategory: 'code' };
    const extracted = analyzeFileWithOutcomes(registry, file, text);
    expect(extracted.structureOutcome).toBe('succeeded');
    const split = text.split('\n');
    return buildResult(file, split.length, split.filter((l) => l.trim()).length, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome);
  }
  const confirmerOf = ({ fqns = FQNS, types = [], declared = NO_TYPES, otherJvm = NO_TYPES, simpleNames } = {}) =>
    createAnnotationIdentity({ fqns, typesByFqn: new Map(types.map((fqn) => [fqn, [{ fqn }]])), otherJvm, declaredJavaTypes: declared, simpleNames });
  /** What the function says of `written` in a file that has these imports. */
  const confirm = (imports, written, options) => {
    const row = rowOf('app/src/com/acme/A.java', javaSource('com.acme', imports, ['public class A {}']));
    return confirmerOf(options)(row, written, 'com.acme');
  };

  it('says "catalog", with the qualified name, for an annotation written qualified, for the single-type import and for the one on-demand import that provides it', () => {
    expect(confirm([], RESOURCE)).toEqual({ kind: 'catalog', fqn: RESOURCE });
    expect(confirm([`import ${RESOURCE};`], 'Resource')).toEqual({ kind: 'catalog', fqn: RESOURCE });
    expect(confirm(['import jakarta.annotation.Resource;'], 'Resource')).toEqual({ kind: 'catalog', fqn: 'jakarta.annotation.Resource' });
    expect(confirm(['import javax.annotation.*;'], 'Resource')).toEqual({ kind: 'catalog', fqn: RESOURCE });
    // an on-demand import of another package changes nothing for the one that provides it
    expect(confirm(['import javax.annotation.*;', 'import java.util.*;'], 'Resource')).toEqual({ kind: 'catalog', fqn: RESOURCE });
  });

  it('says "other" for what is confirmed not to be the catalog\'s: another qualified name, another package\'s import, a name no catalog annotation has', () => {
    expect(confirm([], 'org.acme.Resource')).toEqual({ kind: 'other' });
    expect(confirm(['import org.springframework.core.io.Resource;'], 'Resource')).toEqual({ kind: 'other' });
    // the simple name is none of the catalog's: not looked at, not counted, whatever the imports
    expect(confirm(['import javax.annotation.*;'], 'Autowired')).toEqual({ kind: 'other' });
  });

  it('says "other" for a type of the same package of that name, which shadows an on-demand import: by the class nodes, and by the declarations that have none', () => {
    expect(confirm(['import javax.annotation.*;'], 'Resource', { types: ['com.acme.Resource'] })).toEqual({ kind: 'other' });
    expect(confirm(['import javax.annotation.*;'], 'Resource', { declared: { isType: (pkg, name) => `${pkg}.${name}` === 'com.acme.Resource' } })).toEqual({ kind: 'other' });
    expect(confirm([], 'Resource', { otherJvm: { isType: (pkg, name) => pkg === 'com.acme' && name === 'Resource' } })).toEqual({ kind: 'other' });
    // a type of another package is no shadow
    expect(confirm(['import javax.annotation.*;'], 'Resource', { types: ['org.other.Resource'] })).toEqual({ kind: 'catalog', fqn: RESOURCE });
  });

  it('lets the single-type import win over a type of the same package, as Java does', () => {
    expect(confirm([`import ${RESOURCE};`], 'Resource', { types: ['com.acme.Resource'] })).toEqual({ kind: 'catalog', fqn: RESOURCE });
  });

  it('says "unconfirmed" for a spelling the imports cannot settle: no import, two single-type imports, on-demand imports that provide none or several', () => {
    expect(confirm([], 'Resource')).toEqual({ kind: 'unconfirmed' });
    expect(confirm([`import ${RESOURCE};`, 'import jakarta.annotation.Resource;'], 'Resource')).toEqual({ kind: 'unconfirmed' });
    expect(confirm(['import com.google.inject.name.*;'], 'Resource')).toEqual({ kind: 'unconfirmed' });
    expect(confirm(['import javax.annotation.*;', 'import jakarta.annotation.*;'], 'Resource')).toEqual({ kind: 'unconfirmed' });
  });

  it('ignores a static import and an import that is not a name, as the annotation bindings always did', () => {
    expect(confirm(['import static javax.annotation.Resource.*;'], 'Resource')).toEqual({ kind: 'unconfirmed' });
  });

  it('asks the catalog the caller gives it, not the whole catalog: an annotation of another set is "other"', () => {
    expect(confirm(['import javax.annotation.*;'], 'Resource', { fqns: ['org.springframework.beans.factory.annotation.Qualifier'] })).toEqual({ kind: 'other' });
    expect(confirm([], RESOURCE, { fqns: ['org.springframework.beans.factory.annotation.Qualifier'] })).toEqual({ kind: 'other' });
  });

  it('takes the simple name for the first annotation of that name, shadowing or not, when the simple-name switch is on (mutation tripwire)', () => {
    expect(confirm([], 'Resource', { simpleNames: true })).toEqual({ kind: 'catalog', fqn: RESOURCE });
    expect(confirm(['import javax.annotation.*;'], 'Resource', { types: ['com.acme.Resource'], simpleNames: true })).toEqual({ kind: 'catalog', fqn: RESOURCE });
    // a name that is not the catalog's stays not the catalog's
    expect(confirm([], 'Autowired', { simpleNames: true })).toEqual({ kind: 'other' });
  });

  it('reads the imports of a file once, however many annotations ask', () => {
    const row = rowOf('app/src/com/acme/A.java', javaSource('com.acme', ['import javax.annotation.*;'], ['public class A {}']));
    const confirmer = confirmerOf();
    const first = confirmer(row, 'Resource', 'com.acme');
    row.imports = []; // a later read of the row would see no import at all
    expect(confirmer(row, 'Resource', 'com.acme')).toEqual(first);
  });

  it('is offered by the binding table over its own type dictionaries: the same answers the annotation bindings were given', () => {
    const rows = [
      rowOf('app/src/com/acme/Named.java', 'package com.acme;\n\npublic @interface Named {\n}\n'),
      rowOf('app/src/com/acme/Mine.java', javaSource('com.acme', [], ['@Named("x")', 'public class Mine {}'])),
      rowOf('app/src/com/acme/Other.java', javaSource('com.acme', ['import javax.inject.Named;'], ['@Named("x")', 'public class Other {}'])),
    ];
    const classIds = new Map(rows.map((row) => [row.path, (row.classes ?? []).map((cls) => `class:${row.path}:${cls.name}`)]));
    const javaTypes = rows.flatMap((row) => (row.classes ?? []).map((cls, i) => ({ fqn: cls.qualifiedName, path: row.path, id: classIds.get(row.path)[i] })));
    const table = buildNameBindingTable({
      sites: { bindings: [], missingNames: {} }, catalog: CATALOG, manifestPaths: rows.map((row) => row.path), javaRows: rows, classIds, javaTypes, otherJvm: NO_TYPES,
      // the annotation type is in the repository by its package and file name, though it has no class entry
      declaredJavaTypes: { isType: (pkg, name) => `${pkg}.${name}` === 'com.acme.Named' },
    });
    const confirmer = table.annotationIdentity({ fqns: ['javax.inject.Named'] });
    expect(confirmer(rows[1], 'Named', 'com.acme')).toEqual({ kind: 'other' });
    expect(confirmer(rows[2], 'Named', 'com.acme')).toEqual({ kind: 'catalog', fqn: 'javax.inject.Named' });
    // and the bindings the table holds agree: only the second file's Named is one
    expect(table.bindings.filter((b) => b.binder === 'cdi-annotation-named').map((b) => b.file)).toEqual(['app/src/com/acme/Other.java']);
    expect(table.annotationIdentity({ fqns: ['javax.inject.Named'], simpleNames: true })(rows[1], 'Named', 'com.acme')).toEqual({ kind: 'catalog', fqn: 'javax.inject.Named' });
  });

  it('names the package of a type from its qualified name: empty for the default package and for a spelling that is not the type\'s own', () => {
    expect(packageOf({ name: 'A', qualifiedName: 'com.acme.A' })).toBe('com.acme');
    expect(packageOf({ name: 'A', qualifiedName: 'A' })).toBe('');
    expect(packageOf({ name: 'A', qualifiedName: 'com.acme.B' })).toBe('');
  });
});

describe('the bindings that come to a class (annotation-injection-references design D5)', () => {
  const NO_TYPES = { isType: () => false };
  const SRC = (name, pkg = 'com.acme') => `app/src/${pkg.replaceAll('.', '/')}/${name}.java`;
  const BEANS_OPEN = '<beans xmlns="http://www.springframework.org/schema/beans">';
  const CTX = 'app/WEB-INF/ctx.xml';
  const SERVICE = 'import org.springframework.stereotype.Service;';
  const plain = (name, pkg = 'com.acme') => [SRC(name, pkg), `package ${pkg};\n\npublic class ${name} {\n}\n`];

  /** The binding table of Java sources and descriptors, as buildFactGraph builds it; `nullIds` are `path#Name` of classes whose id is shared. */
  function tableOf({ java = {}, files = {}, mutations, nullIds = [] }) {
    const rows = Object.entries(java).map(([path, source]) => {
      const text = lines(source);
      const file = { path, language: 'java', fileCategory: 'code' };
      const extracted = analyzeFileWithOutcomes(registry, file, text);
      expect(extracted.structureOutcome).toBe('succeeded');
      const split = text.split('\n');
      return buildResult(file, split.length, split.filter((l) => l.trim()).length, extracted.analysis, extracted.callGraph, null, extracted.structureOutcome);
    });
    const classIds = new Map(rows.map((row) => [row.path, (row.classes ?? []).map((cls) => (nullIds.includes(`${row.path}#${cls.name}`) ? null : `class:${row.path}:${cls.name}`))]));
    const javaTypes = rows.flatMap((row) => (row.classes ?? []).map((cls, i) => ({ fqn: cls.qualifiedName, path: row.path, id: classIds.get(row.path)[i] })));
    const manifestPaths = [...rows.map((row) => row.path), ...Object.keys(files)];
    const scanFiles = Object.keys(files).map((path) => ({ path, language: LANGUAGE_OF_EXTENSION[extname(path).slice(1)] ?? 'unknown' }));
    const sites = collectNameReferenceSites({ scan: { files: scanFiles }, catalog: CATALOG, readFile: (path) => files[path] });
    const table = buildNameBindingTable({ sites, catalog: CATALOG, manifestPaths, javaRows: rows, classIds, javaTypes, otherJvm: NO_TYPES, declaredJavaTypes: NO_TYPES, mutations });
    const id = (path, name) => `class:${path}:${name}`;
    return { table, id };
  }
  const ctx = (...definitions) => [BEANS_OPEN, ...definitions, '</beans>'].join('\n');
  const sitesOf = (bindings) => bindings.map((b) => [b.file, b.line, b.binder]);

  it('holds the annotation binding of a class: the binding whose target is that class', () => {
    const { table, id } = tableOf({ java: { [SRC('Owner')]: javaSource('com.acme', [SERVICE], ['@Service', 'public class Owner {}']) }, files: { 'app/pom.xml': '<project/>' } });
    expect(sitesOf(table.bindingsOfClass(id(SRC('Owner'), 'Owner')))).toEqual([[SRC('Owner'), 4, 'spring-annotation-stereotype']]);
  });

  it('holds every binding that comes to the class once the targets are resolved: its definition, an alias of it, a bean that inherits its class', () => {
    const { table, id } = tableOf({
      java: Object.fromEntries([plain('Owner')]),
      files: {
        'app/pom.xml': '<project/>',
        [CTX]: ctx('  <bean id="owner" class="com.acme.Owner"/>', '  <bean id="child" parent="owner"/>', '  <alias name="owner" alias="orders"/>', '  <alias name="child" alias="kid"/>'),
      },
    });
    // the definition, the bean that only names a parent, and the aliases of both: none of them writes the class, all come to it
    expect(sitesOf(table.bindingsOfClass(id(SRC('Owner'), 'Owner')))).toEqual([
      [CTX, 2, 'spring-xml-bean'], [CTX, 3, 'spring-xml-bean'], [CTX, 4, 'spring-xml-alias'], [CTX, 5, 'spring-xml-alias'],
    ]);
    expect(table.bindingsOfClass(id(SRC('Owner'), 'Owner')).map((b) => b.name)).toEqual(['owner', 'child', 'orders', 'kid']);
  });

  it('keeps the classes apart, and holds every namespace and unit: the query is by the class, whatever the binding is of', () => {
    const { table, id } = tableOf({
      java: {
        ...Object.fromEntries([plain('A'), plain('B')]),
        [SRC('Cdi')]: javaSource('com.acme', ['import javax.inject.Named;'], ['@Named("cdi")', 'public class Cdi {}']),
      },
      files: {
        'a/pom.xml': '<project/>', 'b/pom.xml': '<project/>',
        'a/ctx.xml': ctx('  <bean id="x" class="com.acme.A"/>'), 'b/ctx.xml': ctx('  <bean id="y" class="com.acme.A"/>', '  <bean id="z" class="com.acme.B"/>'),
      },
    });
    expect(sitesOf(table.bindingsOfClass(id(SRC('A'), 'A')))).toEqual([['a/ctx.xml', 2, 'spring-xml-bean'], ['b/ctx.xml', 2, 'spring-xml-bean']]);
    expect(sitesOf(table.bindingsOfClass(id(SRC('B'), 'B')))).toEqual([['b/ctx.xml', 3, 'spring-xml-bean']]);
    expect(table.bindingsOfClass(id(SRC('Cdi'), 'Cdi')).map((b) => [b.namespace, b.unit])).toEqual([['el', null]]);
  });

  it('holds nothing for a binding that comes to no class: a factory bean, an alias cycle, a name two declarations carry, a class that has no node', () => {
    const { table, id } = tableOf({
      java: { ...Object.fromEntries([plain('Locator'), plain('Dup')]), 'app/src/other/Dup.java': 'package com.acme;\n\npublic class Dup {\n}\n', ...Object.fromEntries([plain('Shared')]) },
      files: {
        'app/pom.xml': '<project/>',
        [CTX]: ctx(
          '  <bean id="svc" class="com.acme.Locator" factory-method="make"/>',
          '  <alias name="a" alias="b"/>', '  <alias name="b" alias="a"/>',
          '  <bean id="dup" class="com.acme.Dup"/>',
          '  <bean id="shared" class="com.acme.Shared"/>',
          '  <bean id="outside" class="org.acme.Outside"/>',
        ),
      },
      nullIds: [`${SRC('Shared')}#Shared`],
    });
    expect(table.bindingsOfClass(id(SRC('Locator'), 'Locator'))).toEqual([]);
    expect(table.bindingsOfClass(id(SRC('Dup'), 'Dup'))).toEqual([]);
    expect(table.bindingsOfClass(id('app/src/other/Dup.java', 'Dup'))).toEqual([]);
    expect(table.bindingsOfClass(id(SRC('Shared'), 'Shared'))).toEqual([]);
  });

  it('is empty, and read-only, for a class nothing names and for an id the table has never seen', () => {
    const { table, id } = tableOf({ java: Object.fromEntries([plain('Lonely')]), files: { 'app/pom.xml': '<project/>' } });
    expect(table.bindingsOfClass(id(SRC('Lonely'), 'Lonely'))).toEqual([]);
    expect(table.bindingsOfClass('class:nowhere')).toEqual([]);
    expect(Object.isFrozen(table.bindingsOfClass('class:nowhere'))).toBe(true);
  });

  it('is worked out once: the same list answers every later question about a class', () => {
    const { table, id } = tableOf({ java: Object.fromEntries([plain('Owner')]), files: { 'app/pom.xml': '<project/>', [CTX]: ctx('  <bean id="owner" class="com.acme.Owner"/>') } });
    expect(table.bindingsOfClass(id(SRC('Owner'), 'Owner'))).toBe(table.bindingsOfClass(id(SRC('Owner'), 'Owner')));
  });

  it('follows the targets the tripwires change: with no inheritance and no alias the bean that only names a parent, and the alias, are not the class\'s', () => {
    const spec = {
      java: Object.fromEntries([plain('Owner')]),
      files: { 'app/pom.xml': '<project/>', [CTX]: ctx('  <bean id="owner" class="com.acme.Owner"/>', '  <bean id="child" parent="owner"/>', '  <alias name="owner" alias="orders"/>') },
    };
    const names = (mutations) => {
      const { table, id } = tableOf({ ...spec, mutations });
      return table.bindingsOfClass(id(SRC('Owner'), 'Owner')).map((b) => b.name);
    };
    expect(names(undefined)).toEqual(['owner', 'child', 'orders']);
    expect(names({ noInheritance: true })).toEqual(['owner', 'orders']);
    expect(names({ noAliases: true })).toEqual(['owner', 'child']);
  });

  it('holds a factory bean\'s class for it when the factory switch says so (mutation tripwire)', () => {
    const spec = { java: Object.fromEntries([plain('Locator')]), files: { 'app/pom.xml': '<project/>', [CTX]: ctx('  <bean id="svc" class="com.acme.Locator" factory-method="make"/>') } };
    const { table, id } = tableOf({ ...spec, mutations: { ignoreUnknownWhen: true } });
    expect(sitesOf(table.bindingsOfClass(id(SRC('Locator'), 'Locator')))).toEqual([[CTX, 2, 'spring-xml-bean']]);
  });
});
