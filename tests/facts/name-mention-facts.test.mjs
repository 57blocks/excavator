// name-mention-facts, tasks 2.1-2.4: cross-file resolution of name mentions
// into `mentions` edges, gaps and coverage, inside buildFactGraph.
//
// Every fixture is a small synthetic project built in memory: Java rows with
// top-level types, plus non-code files whose text goes through the real lexer
// (text-mentions.mjs) so these tests also pin the lexer-to-resolver handoff.
import { describe, expect, it } from 'vitest';
import { extname } from 'node:path';
import { buildFactGraph } from '../../skills/excavator/build-fact-graph.mjs';
import { assertMentionConservation } from '../../skills/excavator/mention-resolution.mjs';
import { lexMentions } from '../../skills/excavator/text-mentions.mjs';

const LANGUAGE_OF_EXTENSION = {
  xml: 'xml', xhtml: 'xhtml', jsp: 'jsp', jspx: 'jspx', properties: 'properties', yaml: 'yaml', html: 'html', ftl: 'ftl',
};

/**
 * @param {{
 *   java?: Record<string, string|string[]>,     path -> top-level type(s) it declares, as qualified names
 *   javaMembers?: Record<string, string[]>,     qualified name -> member type names
 *   annotations?: string[],                     paths of Java files whose only top-level type is an annotation
 *   kotlin?: Record<string, string[]>,          path -> top-level type names
 *   files?: Record<string, string|string[]>,    path -> text of a non-code file
 *   sites?: (default: object[]) => object[],    adjust the lexed mention sites
 *   omitSites?: boolean,
 *   mutations?: object,
 * }} spec
 */
function project({ java = {}, javaMembers = {}, annotations = [], kotlin = {}, files = {}, sites, omitSites = false, mutations } = {}) {
  const scanFiles = [];
  const results = [];
  const row = (path, language, extra) => {
    scanFiles.push({ path, language, sizeLines: 5, fileCategory: 'code' });
    results.push({ path, language, fileCategory: 'code', totalLines: 5, nonEmptyLines: 5, functions: [], metrics: {}, ...extra });
  };
  for (const [path, declared] of Object.entries(java)) {
    const classes = [declared].flat().map((qualifiedName, i) => ({
      name: qualifiedName.slice(qualifiedName.lastIndexOf('.') + 1),
      qualifiedName,
      kind: 'class',
      startLine: 1 + i * 10,
      endLine: 9 + i * 10,
      memberTypes: javaMembers[qualifiedName] ?? [],
    }));
    row(path, 'java', { status: 'parsed', classes });
  }
  for (const path of annotations) {
    // The row Core really emits for such a file: parsed, and no `classes`,
    // `functions` or `exports` at all (an annotation type is not a class entry).
    scanFiles.push({ path, language: 'java', sizeLines: 9, fileCategory: 'code' });
    results.push({
      path, language: 'java', fileCategory: 'code', totalLines: 9, nonEmptyLines: 7, status: 'parsed',
      imports: [{ source: 'java.lang.annotation.Retention', specifiers: ['Retention'], line: 3 }],
      classLiterals: [],
      metrics: { importCount: 0, exportCount: 0, functionCount: 0, classCount: 0 },
    });
  }
  for (const [path, names] of Object.entries(kotlin)) {
    row(path, 'kotlin', { status: 'parsed', classes: names.map((name) => ({ name, startLine: 1, endLine: 3 })) });
  }
  const texts = {};
  for (const [path, text] of Object.entries(files)) {
    texts[path] = Array.isArray(text) ? text.join('\n') : text;
    row(path, LANGUAGE_OF_EXTENSION[extname(path).slice(1)] ?? 'unknown', { status: 'no-extractor' });
  }
  const scan = { files: scanFiles, skipped: [], coverage: { limits: { maxFileLines: 20000, maxFileBytes: 2097152 } } };
  const structureAll = { results };
  const importMap = { importMap: Object.fromEntries(scanFiles.map((f) => [f.path, []])), unresolved: {} };

  // what the Lazy driver will do: every non-code file through the lexer, with
  // the extensions the manifest has
  const extensions = new Set(scanFiles.map((f) => extname(f.path).slice(1).toLowerCase()).filter(Boolean));
  const lexed = Object.entries(texts).map(([file, text]) => {
    const language = LANGUAGE_OF_EXTENSION[extname(file).slice(1)] ?? 'unknown';
    return { file, language, ...lexMentions(file, language, text, { extensions }) };
  });
  const mentionSites = omitSites ? undefined : sites ? sites(lexed) : lexed;

  const graph = buildFactGraph({ scan, structureAll, importMap, mentionSites, mentionMutations: mutations });
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const label = (id) => {
    const node = byId.get(id);
    return node.type === 'file' ? node.filePath : `${node.filePath}#${node.name}`;
  };
  const mentions = graph.edges.filter((e) => e.type === 'mentions');
  return {
    graph,
    mentions,
    /** `source -> target` per mentions edge, sorted. */
    links: mentions.map((e) => `${label(e.source)} -> ${label(e.target)}`).sort(),
    edge: (from, to) => mentions.find((e) => label(e.source) === from && label(e.target) === to),
    gaps: (kind) => graph.gaps.filter((g) => g.kind === kind),
    coverage: graph.coverage.mentions,
  };
}

const NO_GAPS = ['mention-ambiguous', 'mention-target-unindexed', 'path-mention-unresolved'];
const mentionGaps = (p) => p.graph.gaps.filter((g) => NO_GAPS.includes(g.kind));

// ---------------------------------------------------------------------------
// Requirement: class names
// ---------------------------------------------------------------------------

describe('class-name mentions', () => {
  it('draws a mentions edge from web.xml to the servlet class it names', () => {
    const lines = ['<web-app>'];
    for (let i = 0; i < 10; i++) lines.push('');
    lines.push('<servlet-class>com.acme.web.OrderServlet</servlet-class>');
    const p = project({
      java: { 'src/com/acme/web/OrderServlet.java': 'com.acme.web.OrderServlet' },
      files: { 'webapp/WEB-INF/web.xml': lines },
    });
    expect(p.links).toEqual(['webapp/WEB-INF/web.xml -> src/com/acme/web/OrderServlet.java#OrderServlet']);
    const edge = p.mentions[0];
    expect(edge).toMatchObject({ type: 'mentions', direction: 'forward', weight: 0.5, provenance: 'extracted' });
    expect(edge.evidence).toEqual([{
      file: 'webapp/WEB-INF/web.xml',
      line: 12,
      source: 'lexical',
      token: 'com.acme.web.OrderServlet',
      context: { element: 'servlet-class', attribute: null },
      resolution: 'fqn',
    }]);
    expect(mentionGaps(p)).toEqual([]);
  });

  it('resolves a nested type written as a binary name to its top-level type', () => {
    const p = project({
      java: { 'src/com/acme/Outer.java': 'com.acme.Outer' },
      javaMembers: { 'com.acme.Outer': ['Handler'] },
      files: { 'beans.xml': ['<beans>', '  <bean class="com.acme.Outer$Handler"/>', '</beans>'] },
    });
    expect(p.links).toEqual(['beans.xml -> src/com/acme/Outer.java#Outer']);
    expect(p.mentions[0].evidence[0]).toMatchObject({ line: 2, token: 'com.acme.Outer$Handler', resolution: 'fqn' });
  });

  it('takes the type prefix of a member reference', () => {
    const p = project({
      java: { 'src/com/acme/Limits.java': 'com.acme.Limits' },
      files: { 'app.properties': 'max.size=com.acme.Limits.MAX_SIZE' },
    });
    expect(p.links).toEqual(['app.properties -> src/com/acme/Limits.java#Limits']);
    expect(p.mentions[0].evidence[0].context).toBeNull();
  });

  it('does not guess between two modules that declare the same name', () => {
    const p = project({
      java: { 'a/src/com/acme/Config.java': 'com.acme.Config', 'b/src/com/acme/Config.java': 'com.acme.Config' },
      files: { 'beans.xml': ['<beans>', '  <bean class="com.acme.Config"/>', '</beans>'] },
    });
    expect(p.mentions).toEqual([]);
    const [gap] = p.gaps('mention-ambiguous');
    expect(gap).toMatchObject({ scope: 'xml', count: 1 });
    expect(gap.samples).toEqual(['beans.xml:2 com.acme.Config -> [a/src/com/acme/Config.java, b/src/com/acme/Config.java]']);
  });

  it('treats a declaration whose node id is shared as ambiguous too', () => {
    // two entries of the same name in one file collide on id: neither is an endpoint
    const p = project({
      java: { 'src/com/acme/Dup.java': ['com.acme.Dup', 'com.acme.Dup'] },
      files: { 'beans.xml': '<bean class="com.acme.Dup"/>' },
    });
    expect(p.graph.gaps.some((g) => g.kind === 'identity-collision')).toBe(true);
    expect(p.mentions).toEqual([]);
    expect(p.gaps('mention-ambiguous')).toHaveLength(1);
  });

  it('keeps same-named types in different packages apart', () => {
    const p = project({
      java: { 'src/a/Util.java': 'com.a.Util', 'src/b/Util.java': 'com.b.Util' },
      files: { 'x.xml': '<x class="com.b.Util"/>' },
    });
    expect(p.links).toEqual(['x.xml -> src/b/Util.java#Util']);
  });

  it('does not match a type in the default package', () => {
    const p = project({
      java: { 'src/Util.java': 'Util' },
      files: { 'x.properties': ['a=Util.class', 'b=Util.helper', 'c=Util'] },
    });
    expect(p.mentions).toEqual([]);
    expect(mentionGaps(p)).toEqual([]);
    expect(p.coverage.fqn).toMatchObject({ candidates: 2, external: 2 }); // `Util` alone is not a candidate
  });

  it('reads .class and member suffixes and every level of $ nesting', () => {
    const p = project({
      java: { 'src/com/acme/Foo.java': 'com.acme.Foo' },
      files: { 'x.properties': ['a=com.acme.Foo.class', 'b=com.acme.Foo.BAR', 'c=com.acme.Foo$A$B$1'] },
    });
    expect(p.links).toEqual(['x.properties -> src/com/acme/Foo.java#Foo']);
    expect(p.mentions[0].evidence.map((e) => [e.line, e.token])).toEqual([
      [1, 'com.acme.Foo.class'], [2, 'com.acme.Foo.BAR'], [3, 'com.acme.Foo$A$B$1'],
    ]);
  });

  it('takes the longest prefix that names a type', () => {
    // `com.acme.Foo` is a type, and so is `com.acme.Foo.Bar` (package com.acme.Foo)
    const p = project({
      java: { 'src/com/acme/Foo.java': 'com.acme.Foo', 'src/com/acme/Foo/Bar.java': 'com.acme.Foo.Bar' },
      files: { 'x.properties': 'k=com.acme.Foo.Bar.LIMIT' },
    });
    expect(p.links).toEqual(['x.properties -> src/com/acme/Foo/Bar.java#Bar']);
  });

  it('records a Kotlin or Scala type as unindexed, and a Java hit wins over it', () => {
    const p = project({
      java: { 'src/com/acme/J.java': 'com.acme.J' },
      kotlin: { 'src/com/acme/K.kt': ['K'] },
      files: { 'x.xml': ['<a class="com.acme.K"/>', '<a class="com.acme.J"/>'] },
    });
    expect(p.links).toEqual(['x.xml -> src/com/acme/J.java#J']);
    const [gap] = p.gaps('mention-target-unindexed');
    expect(gap).toMatchObject({ scope: 'xml', count: 1 });
    expect(gap.samples).toEqual(['x.xml:1 com.acme.K -> [com.acme.K]']);
  });

  describe('a repository declaration that is not a class node is not outside the repository', () => {
    const audited = ['module/src/main/java/com/acme/Audited.java'];

    it('records an annotation type as unindexed, not external', () => {
      const p = project({
        annotations: audited,
        files: { 'beans.xml': '<include-filter type="annotation" expression="com.acme.Audited"/>' },
      });
      expect(p.mentions).toEqual([]);
      const [gap] = p.gaps('mention-target-unindexed');
      expect(gap).toMatchObject({ scope: 'xml', count: 1 });
      expect(gap.samples).toEqual(['beans.xml:1 com.acme.Audited -> [com.acme.Audited]']);
      expect(p.coverage.fqn).toEqual({ candidates: 1, edge: 0, ambiguous: 0, unindexed: 1, external: 0 });
    });

    it('takes the type from a member-suffixed or nested name', () => {
      const p = project({
        annotations: audited,
        files: { 'x.properties': ['a=com.acme.Audited.value', 'b=com.acme.Audited$Marker', 'c=com.acme.Audited.class'] },
      });
      expect(p.mentions).toEqual([]);
      const [gap] = p.gaps('mention-target-unindexed');
      expect(gap.count).toBe(3);
      expect(gap.samples.map((s) => s.split(' -> ')[1])).toEqual(['[com.acme.Audited]', '[com.acme.Audited]', '[com.acme.Audited]']);
      expect(p.coverage.fqn.external).toBe(0);
    });

    it('leaves a type that is a node alone: it resolves to an edge', () => {
      const p = project({
        java: { 'module/src/main/java/com/acme/Svc.java': 'com.acme.Svc' },
        annotations: audited,
        files: { 'x.xml': '<a class="com.acme.Svc" expr="com.acme.Audited"/>' },
      });
      expect(p.links).toEqual(['x.xml -> module/src/main/java/com/acme/Svc.java#Svc']);
      expect(p.coverage.fqn).toEqual({ candidates: 2, edge: 1, ambiguous: 0, unindexed: 1, external: 0 });
    });

    it('keeps a name outside the repository external when only its package directory exists', () => {
      const p = project({
        java: { 'src/com/acme/Svc.java': 'com.acme.Svc' },
        annotations: audited,
        files: { 'x.xml': '<a class="com.acme.Missing" expr="com.other.Audited"/>' },
      });
      expect(p.mentions).toEqual([]);
      expect(p.gaps('mention-target-unindexed')).toEqual([]);
      expect(p.coverage.fqn).toMatchObject({ candidates: 2, unindexed: 0, external: 2 });
    });

    it('never matches the default package, and gives a Java file no Kotlin file-class name', () => {
      const p = project({
        java: { 'src/com/acme/Util.java': 'com.acme.Util' },
        annotations: ['src/Marker.java'],
        files: { 'x.properties': ['a=Marker.value', 'b=com.acme.UtilKt'] },
      });
      expect(p.mentions).toEqual([]);
      expect(p.gaps('mention-target-unindexed')).toEqual([]);
      expect(p.coverage.fqn).toMatchObject({ candidates: 2, unindexed: 0, external: 2 });
    });
  });

  it('counts a class name outside the repository as external, with no edge and no gap', () => {
    const p = project({
      java: { 'src/com/acme/J.java': 'com.acme.J' },
      files: { 'x.xml': '<a class="org.other.Lib"/>' },
    });
    expect(p.mentions).toEqual([]);
    expect(mentionGaps(p)).toEqual([]);
    expect(p.coverage.fqn).toEqual({ candidates: 1, edge: 0, ambiguous: 0, unindexed: 0, external: 1 });
  });
});

// ---------------------------------------------------------------------------
// Requirement: path mentions
// ---------------------------------------------------------------------------

describe('path mentions', () => {
  it('resolves a template path against the web root', () => {
    const p = project({
      files: {
        'webapp/order/list.xhtml': '<ui:composition template="/WEB-INF/templates/main.xhtml"/>',
        'webapp/WEB-INF/templates/main.xhtml': '<html/>',
      },
    });
    expect(p.links).toEqual(['webapp/order/list.xhtml -> webapp/WEB-INF/templates/main.xhtml']);
    expect(p.mentions[0].evidence).toEqual([{
      file: 'webapp/order/list.xhtml',
      line: 1,
      source: 'lexical',
      token: '/WEB-INF/templates/main.xhtml',
      context: { element: 'ui:composition', attribute: 'template' },
      resolution: 'web-root',
    }]);
  });

  it('resolves each web application to its own template', () => {
    const p = project({
      files: {
        'a/src/main/webapp/pages/p.xhtml': '<ui:composition template="/WEB-INF/templates/main.xhtml"/>',
        'a/src/main/webapp/WEB-INF/templates/main.xhtml': '<html/>',
        'b/src/main/webapp/WEB-INF/templates/main.xhtml': '<html/>',
      },
    });
    expect(p.links).toEqual(['a/src/main/webapp/pages/p.xhtml -> a/src/main/webapp/WEB-INF/templates/main.xhtml']);
    expect(mentionGaps(p)).toEqual([]);
  });

  it('resolves an include relative to the mentioning file', () => {
    const p = project({
      files: {
        'pages/order.jsp': '<jsp:include page="header.jsp"/>',
        'pages/header.jsp': '<h1/>',
        'other/header.jsp': '<h1/>',
      },
    });
    expect(p.links).toEqual(['pages/order.jsp -> pages/header.jsp']);
    expect(p.mentions[0].evidence[0].resolution).toBe('relative');
  });

  it('does not guess when a classpath suffix matches files in two modules', () => {
    const p = project({
      files: {
        'a/app.xml': '<import resource="classpath:spring/beans.xml"/>',
        'a/src/main/resources/spring/beans.xml': '<beans/>',
        'b/src/main/resources/spring/beans.xml': '<beans/>',
      },
    });
    expect(p.mentions).toEqual([]);
    const [gap] = p.gaps('mention-ambiguous');
    expect(gap.samples).toEqual([
      'a/app.xml:1 classpath:spring/beans.xml -> [a/src/main/resources/spring/beans.xml, b/src/main/resources/spring/beans.xml]',
    ]);
  });

  it('reads a classpath token against the classpath, not against the mentioning file', () => {
    // relative to a/app.xml, `spring/beans.xml` would be a/spring/beans.xml: a classpath reference is not
    const p = project({
      files: {
        'a/app.xml': ['<import resource="classpath:spring/beans.xml"/>', '<import resource="spring/beans.xml"/>'],
        'a/spring/beans.xml': '<beans/>',
        'b/spring/beans.xml': '<beans/>',
      },
    });
    expect(p.links).toEqual(['a/app.xml -> a/spring/beans.xml']);
    expect(p.mentions[0].evidence.map((e) => [e.line, e.resolution])).toEqual([[2, 'relative']]);
    expect(p.gaps('mention-ambiguous')[0].samples[0]).toMatch(/^a\/app\.xml:1 classpath:spring\/beans\.xml -> \[a\/spring/);
  });

  it('resolves a descriptor value against the web root, not against WEB-INF', () => {
    const p = project({
      files: {
        'webapp/WEB-INF/web.xml': '<welcome-file>index.jsp</welcome-file>',
        'webapp/index.jsp': '<html/>',
        'other/index.jsp': '<html/>',
      },
    });
    expect(p.links).toEqual(['webapp/WEB-INF/web.xml -> webapp/index.jsp']);
    expect(p.mentions[0].evidence[0]).toMatchObject({ resolution: 'web-root', context: { element: 'welcome-file', attribute: null } });
    expect(mentionGaps(p)).toEqual([]);
  });

  it('takes a url-pattern for no path at all', () => {
    const p = project({
      files: {
        'webapp/WEB-INF/web.xml': ['<url-pattern>*.xhtml</url-pattern>', '<url-pattern>/faces/*</url-pattern>', '<url-pattern>**/*.xml</url-pattern>'],
        'webapp/index.xhtml': '<html/>',
      },
    });
    expect(p.mentions).toEqual([]);
    expect(mentionGaps(p)).toEqual([]);
    expect(p.coverage.path.candidates).toBe(0);
  });

  it('makes a path that matches nothing visible', () => {
    const p = project({
      files: {
        'webapp/pages/a.xhtml': ['<h:form>', '  <ui:include src="/WEB-INF/missing.xhtml"/>', '</h:form>'],
        'webapp/WEB-INF/web.xml': '<web-app/>',
      },
    });
    expect(p.mentions).toEqual([]);
    const [gap] = p.gaps('path-mention-unresolved');
    expect(gap).toMatchObject({ scope: 'xhtml', count: 1 });
    expect(gap.samples).toEqual(['webapp/pages/a.xhtml:2 /WEB-INF/missing.xhtml -> []']);
  });

  it('falls back to the suffix rule when the web-root path has no file', () => {
    const p = project({
      files: {
        'webapp/pages/a.xhtml': '<ui:include src="/shared/footer.xhtml"/>',
        'webapp/WEB-INF/web.xml': '<web-app/>',
        'lib/shared/footer.xhtml': '<f/>',
      },
    });
    expect(p.links).toEqual(['webapp/pages/a.xhtml -> lib/shared/footer.xhtml']);
    expect(p.mentions[0].evidence[0].resolution).toBe('suffix');
  });

  it('matches a suffix only at a segment boundary', () => {
    const p = project({
      files: {
        'x.xml': '<import resource="classpath:spring/beans.xml"/>',
        'a/xspring/beans.xml': '<beans/>',
        'b/spring/beans.xml': '<beans/>',
      },
    });
    expect(p.links).toEqual(['x.xml -> b/spring/beans.xml']);
  });

  it('strips leading ./ and ../ segments before a suffix match', () => {
    const p = project({
      files: {
        'a/b/x.xml': '<import resource="../../shared/common.xml"/>',
        'lib/shared/common.xml': '<c/>',
      },
    });
    // a/b/../../shared/common.xml would leave the project root's `a`: no direct hit, suffix wins
    expect(p.links).toEqual(['a/b/x.xml -> lib/shared/common.xml']);
    expect(p.mentions[0].evidence[0].resolution).toBe('suffix');
  });

  it('prefers a direct ../ hit over the suffix rule', () => {
    const p = project({
      files: {
        'a/b/x.xml': '<import resource="../common.xml"/>',
        'a/common.xml': '<c/>',
        'z/a/common.xml': '<c/>',
      },
    });
    expect(p.links).toEqual(['a/b/x.xml -> a/common.xml']);
    expect(p.mentions[0].evidence[0].resolution).toBe('relative');
  });

  it('never resolves outside the manifest, however many ../ it climbs', () => {
    const p = project({ files: { 'a/x.xml': '<import resource="../../../../etc/passwd.xml"/>' } });
    expect(p.mentions).toEqual([]);
    expect(p.gaps('path-mention-unresolved')).toHaveLength(1);
  });

  it('draws no edge for a file that mentions itself', () => {
    const p = project({ files: { 'pages/a.xhtml': '<ui:include src="a.xhtml"/>' } });
    expect(p.mentions).toEqual([]);
    expect(mentionGaps(p)).toEqual([]);
    expect(p.coverage.path).toEqual({ candidates: 1, edge: 0, ambiguous: 0, unresolved: 0, self: 1 });
  });

  it('does not take a path in a URL or an expression', () => {
    const p = project({
      files: {
        'a.xhtml': '<a href="http://h/b.xhtml" src="#{x.page}.xhtml" page="${base}/b.xhtml"/>',
        'b.xhtml': '<b/>',
      },
    });
    expect(p.mentions).toEqual([]);
    expect(p.coverage.path.candidates).toBe(0);
  });

  it('only counts an extension the manifest has', () => {
    const p = project({ files: { 'a.xml': '<a src="logo.gif" other="b.xml"/>', 'b.xml': '<b/>' } });
    expect(p.links).toEqual(['a.xml -> b.xml']);
    expect(p.coverage.path.candidates).toBe(1);
  });
});

describe('path patterns', () => {
  const tree = {
    'app/ctx.xml': [
      '<import resource="classpath*:META-INF/spring/*.xml"/>',
      '<import resource="spring/*.xml"/>',
      '<import resource="classpath*:config/**/*.xml"/>',
      '<import resource="/WEB-INF/spring/*-context.xml"/>',
    ],
    'app/WEB-INF/web.xml': '<web-app/>',
    'app/spring/one.xml': '<a/>',
    'app/spring/two.xml': '<a/>',
    'app/spring/deep/three.xml': '<a/>',
    'lib-a/META-INF/spring/a.xml': '<a/>',
    'lib-b/META-INF/spring/b.xml': '<a/>',
    'lib-b/META-INF/spring/sub/not.xml': '<a/>',
    'lib-a/config/x.xml': '<a/>',
    'lib-a/config/deep/y.xml': '<a/>',
    'app/WEB-INF/spring/web-context.xml': '<a/>',
    'app/WEB-INF/spring/other.xml': '<a/>',
  };

  it('takes every match of a pattern, each marked as a pattern hit', () => {
    const p = project({ files: tree });
    expect(p.links.filter((l) => l.startsWith('app/ctx.xml'))).toEqual([
      'app/ctx.xml -> app/WEB-INF/spring/web-context.xml',
      'app/ctx.xml -> app/spring/one.xml',
      'app/ctx.xml -> app/spring/two.xml',
      'app/ctx.xml -> lib-a/META-INF/spring/a.xml',
      'app/ctx.xml -> lib-a/config/deep/y.xml',
      'app/ctx.xml -> lib-a/config/x.xml',
      'app/ctx.xml -> lib-b/META-INF/spring/b.xml',
    ]);
    for (const edge of p.mentions.filter((e) => e.evidence[0].file === 'app/ctx.xml')) {
      expect(edge.evidence.every((e) => e.resolution === 'pattern')).toBe(true);
    }
  });

  it('counts a pattern as one edge site however many files it matches', () => {
    const p = project({ files: tree });
    expect(p.mentions.length).toBeGreaterThan(p.coverage.path.edge);
    expect(p.coverage.path).toMatchObject({ edge: 4, ambiguous: 0, unresolved: 0, self: 0 });
    expect(mentionGaps(p)).toEqual([]);
  });

  it('keeps * inside one segment and lets ** span segments', () => {
    const p = project({ files: tree });
    const target = (to) => p.links.includes(`app/ctx.xml -> ${to}`);
    expect(target('app/spring/two.xml')).toBe(true);
    expect(target('app/spring/deep/three.xml')).toBe(false);          // `spring/*.xml` does not cross a segment
    expect(target('lib-b/META-INF/spring/sub/not.xml')).toBe(false);  // neither does the classpath one
    expect(target('lib-a/config/deep/y.xml')).toBe(true);             // `**` does
  });

  it('expands a relative pattern inside the mentioning file directory only', () => {
    const p = project({ files: { 'a/x.xml': '<i resource="conf/*.xml"/>', 'a/conf/1.xml': '<c/>', 'b/conf/2.xml': '<c/>' } });
    expect(p.links).toEqual(['a/x.xml -> a/conf/1.xml']);
  });

  it('is unresolved when a pattern matches nothing, and self when it matches only itself', () => {
    const p = project({
      files: { 'a/x.xml': '<i resource="nothing/*.xml"/>', 'b/y.xml': '<i resource="*/*.xml"/>', 'c/conf/z.xml': '<i resource="conf/*.xml"/>' },
    });
    expect(p.coverage.path).toMatchObject({ candidates: 2, edge: 0, unresolved: 1, self: 1 });
  });
});

// ---------------------------------------------------------------------------
// Requirement: edges, evidence, gaps, coverage
// ---------------------------------------------------------------------------

describe('mentions edges', () => {
  it('merges mentions of one target in one file into one edge, evidence by line', () => {
    const p = project({
      java: { 'src/com/acme/Svc.java': 'com.acme.Svc' },
      files: {
        'beans.xml': [
          '<beans>', '', '', '', '', '', '', '', '',
          '  <bean id="a" class="com.acme.Svc"/>', // 10
          ...Array.from({ length: 29 }, () => ''),
          '  <bean id="b" class="com.acme.Svc"/>', // 40
          '  <bean id="c" parent="com.acme.Svc"/>', // 41
          '</beans>',
        ],
      },
    });
    expect(p.mentions).toHaveLength(1);
    expect(p.mentions[0].evidence.map((e) => [e.line, e.context])).toEqual([
      [10, { element: 'bean', attribute: 'class' }],
      [40, { element: 'bean', attribute: 'class' }],
      [41, { element: 'bean', attribute: 'parent' }],
    ]);
    expect(p.coverage.fqn).toMatchObject({ candidates: 3, edge: 3 });
  });

  it('dedupes identical evidence but still counts every occurrence', () => {
    const p = project({
      java: { 'src/com/acme/Svc.java': 'com.acme.Svc' },
      files: { 'a.xml': '<x>com.acme.Svc com.acme.Svc</x>' },
    });
    expect(p.mentions[0].evidence).toHaveLength(1);
    expect(p.coverage.fqn).toMatchObject({ candidates: 2, edge: 2 });
  });

  it('draws one edge per (file, target) for several targets and files', () => {
    const p = project({
      java: { 'src/com/acme/A.java': 'com.acme.A', 'src/com/acme/B.java': 'com.acme.B' },
      files: { 'one.xml': '<x a="com.acme.A" b="com.acme.B" c="com.acme.A"/>', 'two.xml': '<x a="com.acme.A"/>' },
    });
    expect(p.links).toEqual([
      'one.xml -> src/com/acme/A.java#A',
      'one.xml -> src/com/acme/B.java#B',
      'two.xml -> src/com/acme/A.java#A',
    ]);
    expect(p.edge('one.xml', 'src/com/acme/A.java#A').evidence.map((e) => e.line)).toEqual([1, 1]);
  });

  it('records the kind of every gap against the language of the mentioning file', () => {
    const p = project({
      java: { 'a/C.java': 'com.acme.C', 'b/C.java': 'com.acme.C' },
      files: { 'x.xhtml': '<a b="com.acme.C" c="/gone.xhtml"/>', 'y.properties': 'k=com.acme.C' },
    });
    const scopes = p.graph.gaps.filter((g) => g.kind.includes('mention')).map((g) => `${g.kind}@${g.scope}=${g.count}`).sort();
    expect(scopes).toEqual(['mention-ambiguous@properties=1', 'mention-ambiguous@xhtml=1', 'path-mention-unresolved@xhtml=1']);
    for (const gap of p.graph.gaps.filter((g) => g.kind.includes('mention'))) expect(gap.reason).not.toMatch(/unrecognized/);
  });
});

describe('coverage and conservation', () => {
  const full = () => project({
    java: {
      'src/com/acme/Svc.java': 'com.acme.Svc',
      'a/Config.java': 'com.acme.Config',
      'b/Config.java': 'com.acme.Config',
    },
    kotlin: { 'src/com/acme/K.kt': ['K'] },
    files: {
      'webapp/WEB-INF/web.xml': [
        '<web-app>',
        '  <servlet-class>com.acme.Svc</servlet-class>',
        '  <servlet-class>com.acme.Svc</servlet-class>',
        '  <filter-class>com.acme.Config</filter-class>',
        '  <filter-class>com.acme.K</filter-class>',
        '  <filter-class>org.other.Lib</filter-class>',
        '  <welcome-file>index.jsp</welcome-file>',
        '  <welcome-file>missing.jsp</welcome-file>',
        '  <welcome-file>../web.xml</welcome-file>',
        '  <url-pattern>*.xhtml</url-pattern>',
        '</web-app>',
      ],
      'webapp/index.jsp': ['<jsp:include page="WEB-INF/web.xml"/>', '<jsp:include page="shared/x.xml"/>'],
      'a/shared/x.xml': '<x/>',
      'b/shared/x.xml': '<x/>',
      'conf/app.properties': ['# comment com.acme.Svc', 'svc=com.acme.Svc'],
    },
  });

  it('accounts for every candidate in exactly one bucket', () => {
    const p = full();
    const { fqn, path } = p.coverage;
    expect(fqn.edge + fqn.ambiguous + fqn.unindexed + fqn.external).toBe(fqn.candidates);
    expect(path.edge + path.ambiguous + path.unresolved + path.self).toBe(path.candidates);
    expect(p.coverage.status).toBe('ran');
    expect(p.coverage.files).toEqual({ xml: 3, jsp: 1, properties: 1 });
    // the exact counts on this fixture
    expect(fqn).toEqual({ candidates: 11, edge: 3, ambiguous: 1, unindexed: 1, external: 6 });
    expect(path).toEqual({ candidates: 5, edge: 2, ambiguous: 1, unresolved: 1, self: 1 });
  });

  it('reads the gap counts back from what was recorded', () => {
    const p = full();
    const count = (kind) => p.gaps(kind).reduce((sum, g) => sum + g.count, 0);
    expect(count('mention-ambiguous')).toBe(p.coverage.fqn.ambiguous + p.coverage.path.ambiguous);
    expect(count('mention-target-unindexed')).toBe(p.coverage.fqn.unindexed);
    expect(count('path-mention-unresolved')).toBe(p.coverage.path.unresolved);
  });

  it('throws when a class-name candidate has no outcome', () => {
    const run = (fqnEdge) => assertMentionConservation(
      { fqn: { candidates: 4, edge: fqnEdge, ambiguous: 1, unindexed: 1, external: 1 }, path: { candidates: 0, edge: 0, ambiguous: 0, unresolved: 0, self: 0 } },
      { ambiguous: 1, unindexed: 1, unresolved: 0 },
    );
    expect(() => run(1)).not.toThrow();
    expect(() => run(0)).toThrow(/4 class-name candidate\(s\) but 3 outcome\(s\)/);
  });

  it('throws when a path candidate has no outcome', () => {
    const run = (self) => assertMentionConservation(
      { fqn: { candidates: 0, edge: 0, ambiguous: 0, unindexed: 0, external: 0 }, path: { candidates: 4, edge: 1, ambiguous: 1, unresolved: 1, self } },
      { ambiguous: 1, unindexed: 0, unresolved: 1 },
    );
    expect(() => run(1)).not.toThrow();
    expect(() => run(2)).toThrow(/4 path candidate\(s\) but 5 outcome\(s\)/);
  });

  it('throws when a recorded gap disagrees with the outcome it came from', () => {
    const mentions = {
      fqn: { candidates: 2, edge: 0, ambiguous: 1, unindexed: 1, external: 0 },
      path: { candidates: 2, edge: 0, ambiguous: 1, unresolved: 1, self: 0 },
    };
    expect(() => assertMentionConservation(mentions, { ambiguous: 2, unindexed: 1, unresolved: 1 })).not.toThrow();
    expect(() => assertMentionConservation(mentions, { ambiguous: 1, unindexed: 1, unresolved: 1 })).toThrow(/mention-ambiguous/);
    expect(() => assertMentionConservation(mentions, { ambiguous: 2, unindexed: 0, unresolved: 1 })).toThrow(/mention-target-unindexed/);
    expect(() => assertMentionConservation(mentions, { ambiguous: 2, unindexed: 1, unresolved: 0 })).toThrow(/path-mention-unresolved/);
  });

  it('says the stage did not run when no mention sites are given', () => {
    const files = { 'beans.xml': '<bean class="com.acme.Svc"/>' };
    const java = { 'src/com/acme/Svc.java': 'com.acme.Svc' };
    const off = project({ java, files, omitSites: true });
    expect(off.coverage).toEqual({ status: 'not-run' });
    expect(off.mentions).toEqual([]);
    expect(mentionGaps(off)).toEqual([]);

    // ran over nothing is not the same thing as not run
    const empty = project({ java, files, sites: () => [] });
    expect(empty.coverage).toEqual({
      status: 'ran',
      files: {},
      fqn: { candidates: 0, edge: 0, ambiguous: 0, unindexed: 0, external: 0 },
      path: { candidates: 0, edge: 0, ambiguous: 0, unresolved: 0, self: 0 },
    });
  });

  it('does not change the graph it is not asked to change', () => {
    const files = { 'beans.xml': '<bean class="com.acme.Svc"/>' };
    const java = { 'src/com/acme/Svc.java': 'com.acme.Svc' };
    const off = project({ java, files, omitSites: true }).graph;
    const on = project({ java, files }).graph;
    expect(on.nodes).toEqual(off.nodes);
    expect(on.edges.filter((e) => e.type !== 'mentions')).toEqual(off.edges);
    expect(on.gaps).toEqual(off.gaps);
    expect(on.factsDigest).not.toBe(off.factsDigest);
  });

  it('puts no candidate from a code file into the scan', () => {
    const p = project({
      java: { 'src/com/acme/Svc.java': 'com.acme.Svc' },
      files: { 'beans.xml': '<x/>' },
      sites: (lexed) => [
        ...lexed,
        // what the lexer says about a Java file, handed to the resolver as a site
        { file: 'src/com/acme/Svc.java', language: 'java', ...lexMentions('src/com/acme/Svc.java', 'java', 'String s = "com.acme.Svc";', { extensions: new Set(['xml']) }) },
      ],
    });
    expect(p.coverage.fqn.candidates).toBe(0);
    expect(p.mentions).toEqual([]);
  });

  it('refuses a site for a file outside the manifest or a file given twice', () => {
    const files = { 'a.xml': '<x/>' };
    expect(() => project({ files, sites: () => [{ file: 'nowhere.xml', fqn: [], path: [] }] })).toThrow(/outside the manifest/);
    expect(() => project({
      files,
      sites: () => [{ file: 'a.xml', fqn: [], path: [] }, { file: 'a.xml', fqn: [], path: [] }],
    })).toThrow(/more than one mention site row/);
  });
});

describe('determinism', () => {
  const spec = () => ({
    java: { 'src/com/acme/Svc.java': 'com.acme.Svc', 'a/C.java': 'com.acme.C', 'b/C.java': 'com.acme.C' },
    files: {
      'z/app.xml': ['<a class="com.acme.Svc"/>', '<i resource="classpath*:spring/*.xml"/>'],
      'y/app.xml': ['<a class="com.acme.C"/>', '<i resource="spring/one.xml"/>'],
      'y/spring/one.xml': '<a/>',
      'z/spring/two.xml': '<a/>',
    },
  });

  it('gives the same projection for the same input, whatever the row order', () => {
    const first = project(spec());
    const second = project({ ...spec(), sites: (lexed) => [...lexed].reverse() });
    expect(second.graph.edges).toEqual(first.graph.edges);
    expect(second.graph.gaps).toEqual(first.graph.gaps);
    expect(second.graph.factsDigest).toBe(first.graph.factsDigest);
  });

  it('sorts mentions edges with the others, by type, source and target', () => {
    const { graph } = project(spec());
    const order = graph.edges.map((e) => `${e.type}|${e.source}|${e.target}`);
    expect(order).toEqual([...order].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(graph.edges.some((e) => e.type === 'mentions')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 2.4: mutation tripwires. Each mutation below breaks one rule of the
// resolver; the scenario that pins that rule must then fail. The mutations are
// switched on through a test seam that production callers never use.
// ---------------------------------------------------------------------------

describe('tripwires: a broken rule turns a scenario red', () => {
  const scenarios = {
    ambiguity: {
      mutation: { firstDeclaration: true },
      spec: () => ({
        java: { 'a/src/com/acme/Config.java': 'com.acme.Config', 'b/src/com/acme/Config.java': 'com.acme.Config' },
        files: { 'beans.xml': '<bean class="com.acme.Config"/>' },
      }),
      holds: (p) => p.mentions.length === 0 && p.gaps('mention-ambiguous').length === 1,
    },
    webRootTemplate: {
      mutation: { noWebRootRule: true },
      spec: () => ({
        files: {
          'a/src/main/webapp/pages/p.xhtml': '<ui:composition template="/WEB-INF/templates/main.xhtml"/>',
          'a/src/main/webapp/WEB-INF/templates/main.xhtml': '<html/>',
          'b/src/main/webapp/WEB-INF/templates/main.xhtml': '<html/>',
        },
      }),
      holds: (p) => p.links.join() === 'a/src/main/webapp/pages/p.xhtml -> a/src/main/webapp/WEB-INF/templates/main.xhtml'
        && p.gaps('mention-ambiguous').length === 0,
    },
    webRootWelcomeFile: {
      mutation: { noWebRootRule: true },
      spec: () => ({
        files: {
          'webapp/WEB-INF/web.xml': '<welcome-file>index.jsp</welcome-file>',
          'webapp/index.jsp': '<html/>',
          'other/index.jsp': '<html/>',
        },
      }),
      holds: (p) => p.links.join() === 'webapp/WEB-INF/web.xml -> webapp/index.jsp',
    },
    annotationType: {
      mutation: { noJavaFileIndex: true },
      spec: () => ({
        annotations: ['src/com/acme/Audited.java'],
        files: { 'beans.xml': '<include-filter expression="com.acme.Audited"/>' },
      }),
      holds: (p) => p.mentions.length === 0 && p.gaps('mention-target-unindexed').length === 1 && p.coverage.fqn.external === 0,
    },
    longestPrefix: {
      mutation: { shortestPrefix: true },
      spec: () => ({
        java: { 'src/com/acme/Foo.java': 'com.acme.Foo', 'src/com/acme/Foo/Bar.java': 'com.acme.Foo.Bar' },
        files: { 'x.properties': 'k=com.acme.Foo.Bar.LIMIT' },
      }),
      holds: (p) => p.links.join() === 'x.properties -> src/com/acme/Foo/Bar.java#Bar',
    },
  };

  for (const [name, scenario] of Object.entries(scenarios)) {
    it(`${name}: holds as shipped`, () => {
      expect(scenario.holds(project(scenario.spec()))).toBe(true);
    });
    it(`${name}: breaks under ${Object.keys(scenario.mutation)[0]}`, () => {
      expect(scenario.holds(project({ ...scenario.spec(), mutations: scenario.mutation }))).toBe(false);
    });
  }
});
