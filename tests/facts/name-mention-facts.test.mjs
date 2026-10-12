// name-mention-facts, tasks 2.1-2.7: cross-file resolution of name mentions
// into `mentions` edges, gaps and coverage, inside buildFactGraph.
//
// Every fixture is a small synthetic project built in memory: Java rows with
// top-level types, plus non-code files whose text goes through the real
// mentions stage (mention-sites.mjs, which lexes them and reads the package
// of Java files the dictionary has no type for), so these tests also pin the
// stage-to-resolver handoff.
import { describe, expect, it } from 'vitest';
import { extname } from 'node:path';
import { buildFactGraph } from '../../skills/excavator/build-fact-graph.mjs';
import { assertMentionConservation, createDeclaredJavaTypeIndex, resolveMentions } from '../../skills/excavator/mention-resolution.mjs';
import { collectMentionSites } from '../../skills/excavator/mention-sites.mjs';
import { lexMentions } from '../../skills/excavator/text-mentions.mjs';

const LANGUAGE_OF_EXTENSION = {
  xml: 'xml', xhtml: 'xhtml', jsp: 'jsp', jspx: 'jspx', properties: 'properties', yaml: 'yaml', html: 'html', ftl: 'ftl',
};

/**
 * @param {{
 *   java?: Record<string, string|string[]>,     path -> top-level type(s) it declares, as qualified names
 *   javaMembers?: Record<string, string[]>,     qualified name -> member type names
 *   annotations?: Record<string, string|null>, path -> declared package of a Java file whose only top-level type is an annotation (null: none)
 *   skipped?: Array<{ path, reason, language?, text? }>, files the scanner skipped; `text` is what the snapshot holds
 *   reads?: string[],                           collects the paths the stage reads
 *   kotlin?: Record<string, string[]>,          path -> top-level type names
 *   files?: Record<string, string|string[]>,    path -> text of a non-code file
 *   sites?: (default: object[]) => object[],    adjust the lexed mention sites
 *   omitSites?: boolean,
 *   mutations?: object,
 * }} spec
 */
function project({ java = {}, javaMembers = {}, annotations = {}, kotlin = {}, files = {}, skipped = [], reads = [], sites, omitSites = false, mutations } = {}) {
  const scanFiles = [];
  const results = [];
  const texts = {};
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
    const stem = path.slice(path.lastIndexOf('/') + 1).replace(/\.java$/, '');
    texts[path] = `package ${classes[0].qualifiedName.replace(/\.[^.]+$/, '')};\n\nclass ${stem} {}\n`;
  }
  for (const [path, pkg] of Object.entries(annotations)) {
    // The row Core really emits for such a file: parsed, and no `classes`,
    // `functions` or `exports` at all (an annotation type is not a class entry).
    scanFiles.push({ path, language: 'java', sizeLines: 9, fileCategory: 'code' });
    results.push({
      path, language: 'java', fileCategory: 'code', totalLines: 9, nonEmptyLines: 7, status: 'parsed',
      imports: [{ source: 'java.lang.annotation.Retention', specifiers: ['Retention'], line: 3 }],
      classLiterals: [],
      metrics: { importCount: 0, exportCount: 0, functionCount: 0, classCount: 0 },
    });
    const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.java$/, '');
    texts[path] = `${pkg ? `package ${pkg};\n\n` : ''}public @interface ${name} {}\n`;
  }
  for (const [path, names] of Object.entries(kotlin)) {
    row(path, 'kotlin', { status: 'parsed', classes: names.map((name) => ({ name, startLine: 1, endLine: 3 })) });
  }
  for (const [path, text] of Object.entries(files)) {
    texts[path] = Array.isArray(text) ? text.join('\n') : text;
    row(path, LANGUAGE_OF_EXTENSION[extname(path).slice(1)] ?? 'unknown', { status: 'no-extractor' });
  }
  const skippedEntries = skipped.map(({ path, reason, language, text }) => {
    if (text !== undefined) texts[path] = text;
    const ext = extname(path).slice(1);
    return { path, reason, language: language ?? (ext === 'java' ? 'java' : ext === 'h' ? 'c' : LANGUAGE_OF_EXTENSION[ext] ?? (ext || 'unknown')) };
  });
  const scan = { files: scanFiles, skipped: skippedEntries, coverage: { limits: { maxFileLines: 20000, maxFileBytes: 2097152 } } };
  const structureAll = { results };
  const importMap = { importMap: Object.fromEntries(scanFiles.map((f) => [f.path, []])), unresolved: {} };

  // what the Lazy driver does: the mentions stage over the manifest and what
  // the snapshot holds
  const readFile = (path) => {
    reads.push(path);
    if (!(path in texts)) throw new Error(`the snapshot holds no ${path}`);
    return texts[path];
  };
  const stage = collectMentionSites({ scan, structureAll, readFile });
  const mentionSites = omitSites ? undefined : sites ? sites(stage.sites) : stage.sites;
  const mentionInputs = omitSites ? undefined : stage.inputs;

  const graph = buildFactGraph({ scan, structureAll, importMap, mentionSites, mentionInputs, mentionMutations: mutations });
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
    stage,
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
    // the directory is a module's source root; the file declares the package
    const audited = { 'module/src/main/java/com/acme/Audited.java': 'com.acme' };

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
        annotations: { 'src/Marker.java': null },
        files: { 'x.properties': ['a=Marker.value', 'b=com.acme.UtilKt', 'c=src.Marker'] },
      });
      expect(p.mentions).toEqual([]);
      expect(p.gaps('mention-target-unindexed')).toEqual([]);
      expect(p.coverage.fqn).toMatchObject({ candidates: 3, unindexed: 0, external: 3 });
    });

    it('does not take a directory named like a package for a declaration', () => {
      // `ejb3.Foo` is a servlet name; org/acme/ejb3/ holds Foo.java declaring org.acme.ejb3
      const p = project({
        java: { 'src/main/java/org/acme/ejb3/Foo.java': 'org.acme.ejb3.Foo' },
        annotations: { 'src/main/java/org/acme/ejb3/Marker.java': 'org.acme.ejb3' },
        files: { 'WEB-INF/web.xml': ['<servlet-name>ejb3.Foo</servlet-name>', '<servlet-name>ejb3.Marker</servlet-name>', '<a class="org.acme.ejb3.Marker"/>'] },
      });
      expect(p.mentions).toEqual([]);
      const [gap] = p.gaps('mention-target-unindexed');
      expect(gap.samples).toEqual(['WEB-INF/web.xml:3 org.acme.ejb3.Marker -> [org.acme.ejb3.Marker]']);
      expect(p.coverage.fqn).toEqual({ candidates: 3, edge: 0, ambiguous: 0, unindexed: 1, external: 2 });
    });

    it('takes the package the file declares, not the one its directory suggests', () => {
      const p = project({
        annotations: { 'src/legacy/Audited.java': 'com.acme' },
        files: { 'x.xml': '<a e="com.acme.Audited" f="legacy.Audited"/>' },
      });
      expect(p.gaps('mention-target-unindexed')[0].samples).toEqual(['x.xml:1 com.acme.Audited -> [com.acme.Audited]']);
      expect(p.coverage.fqn).toMatchObject({ candidates: 2, unindexed: 1, external: 1 });
    });

    it('reads the package only of Java files the dictionary has no type for', () => {
      const reads = [];
      project({
        java: { 'src/com/acme/Svc.java': 'com.acme.Svc' },
        annotations: audited,
        files: { 'x.xml': '<a/>' },
        reads,
      });
      expect(reads.sort()).toEqual(['module/src/main/java/com/acme/Audited.java', 'x.xml']);
    });

    it('takes a type declared in a Java file the scanner skipped as too large', () => {
      const reads = [];
      const p = project({
        skipped: [
          { path: 'gen/com/acme/Huge.java', reason: 'too-large', text: '/* ... */\npackage com.acme;\npublic class Huge {}\n' },
          // the snapshot does not hold, or must not be read for, these
          { path: 'gen/com/acme/Link.java', reason: 'symlink' },
          { path: 'gen/com/acme/Broken.java', reason: 'read-failed' },
          { path: 'gen/com/acme/Blob.java', reason: 'binary' },
        ],
        files: { 'x.xml': '<a a="com.acme.Huge" b="com.acme.Link" c="com.acme.Broken" d="com.acme.Blob"/>' },
        reads,
      });
      expect(p.gaps('mention-target-unindexed')[0].samples).toEqual(['x.xml:1 com.acme.Huge -> [com.acme.Huge]']);
      expect(p.coverage.fqn).toMatchObject({ candidates: 4, unindexed: 1, external: 3 });
      expect(reads.sort()).toEqual(['gen/com/acme/Huge.java', 'x.xml']);
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

  it('does not expand a build descriptor pattern into another module', () => {
    // modA's `java/` does not exist; modB has Java files in a directory of the same shape
    const p = project({
      java: { 'modB/src/main/java/x/Foo.java': 'x.Foo' },
      files: { 'modA/pom.xml': '<includes><include>java/**/*.java</include></includes>' },
    });
    expect(p.mentions).toEqual([]);
    const [gap] = p.gaps('path-mention-unresolved');
    expect(gap).toMatchObject({ scope: 'xml', count: 1 });
    expect(gap.samples).toEqual(['modA/pom.xml:1 java/**/*.java -> []']);
    expect(p.coverage.path).toMatchObject({ candidates: 1, edge: 0, unresolved: 1 });
  });

  it('does not match a bare file name by suffix', () => {
    const p = project({
      files: { 'CHANGELOG.txt': 'fixes unistd.h on the build', 'native/os/windows/unistd.h': '/* header */' },
    });
    expect(p.mentions).toEqual([]);
    expect(p.gaps('path-mention-unresolved')[0].samples).toEqual(['CHANGELOG.txt:1 unistd.h -> []']);
  });

  it('still matches a classpath token by suffix, bare name and pattern alike', () => {
    const p = project({
      files: {
        'a/app.xml': ['<p r="classpath:app.properties"/>', '<p r="classpath*:conf/*.xml"/>'],
        'lib/conf/app.properties': 'k=v',
        'lib/conf/one.xml': '<a/>',
        'other/conf/two.xml': '<a/>',
      },
    });
    expect(p.links).toEqual(['a/app.xml -> lib/conf/app.properties', 'a/app.xml -> lib/conf/one.xml', 'a/app.xml -> other/conf/two.xml']);
    expect(p.mentions.flatMap((e) => e.evidence.map((x) => x.resolution)).sort()).toEqual(['pattern', 'pattern', 'suffix']);
  });

  it('still matches a path with a directory of its own by suffix', () => {
    const p = project({ files: { 'a/x.xml': '<i src="views/footer.xhtml"/>', 'lib/views/footer.xhtml': '<f/>' } });
    expect(p.links).toEqual(['a/x.xml -> lib/views/footer.xhtml']);
    expect(p.mentions[0].evidence[0].resolution).toBe('suffix');
  });

  it('takes a ./ prefix as the same directory when the relative rule has a hit', () => {
    const p = project({ files: { 'a/x.xml': '<i resource="./row.xml"/>', 'a/row.xml': '<r/>', 'z/row.xml': '<r/>' } });
    expect(p.links).toEqual(['a/x.xml -> a/row.xml']);
    expect(p.mentions[0].evidence[0].resolution).toBe('relative');
  });

  it('does not resolve a token with a . or .. segment after its leading run', () => {
    const p = project({
      files: {
        '.github/ci.yaml': ['run: $GITHUB_ACTION_PATH/../../scripts/x.sh', 'run: curl -d@../../api/x.json', 'run: shared/../common.yaml'],
        'scripts/x.sh': 'echo',
        'api/x.json': '{}',
        '.github/common.yaml': 'k: v',
      },
    });
    expect(p.mentions).toEqual([]);
    expect(p.gaps('path-mention-unresolved')[0].samples).toEqual([
      '.github/ci.yaml:1 $GITHUB_ACTION_PATH/../../scripts/x.sh -> []',
      '.github/ci.yaml:2 -d@../../api/x.json -> []',
      '.github/ci.yaml:3 shared/../common.yaml -> []',
    ]);
  });

  it('still joins a leading ../ run onto the mentioning file directory', () => {
    const p = project({ files: { 'a/b/x.xml': '<i resource="../../common.xml"/>', 'common.xml': '<c/>' } });
    expect(p.links).toEqual(['a/b/x.xml -> common.xml']);
    expect(p.mentions[0].evidence[0].resolution).toBe('relative');
  });

  it('draws no edge for a file that mentions itself', () => {
    const p = project({ files: { 'pages/a.xhtml': '<ui:include src="a.xhtml"/>' } });
    expect(p.mentions).toEqual([]);
    expect(mentionGaps(p)).toEqual([]);
    expect(p.coverage.path).toEqual({ candidates: 1, edge: 0, ambiguous: 0, unresolved: 0, self: 1, unindexed: 0, unindexedHits: 0 });
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

describe('files the scanner skipped', () => {
  const header = (extra = {}) => ({
    skipped: [{ path: 'native/gtest/gtest.h', reason: 'too-large' }],
    files: { 'LICENSE.txt': 'see native/gtest/gtest.h for the test header', 'native/other.h': '/* header */', ...extra },
  });

  it('does not call an existing but skipped file missing: the mention is unindexed', () => {
    const p = project(header());
    expect(p.mentions).toEqual([]);
    expect(p.gaps('path-mention-unresolved')).toEqual([]);
    const [gap] = p.gaps('mention-target-unindexed');
    expect(gap).toMatchObject({ scope: 'unknown', count: 1 });
    expect(gap.samples).toEqual(['LICENSE.txt:1 native/gtest/gtest.h -> [native/gtest/gtest.h (too-large)]']);
    expect(p.coverage.path).toEqual({ candidates: 1, edge: 0, ambiguous: 0, unresolved: 0, self: 0, unindexed: 1, unindexedHits: 0 });
  });

  it('counts every per-file skip reason as a file that exists', () => {
    for (const reason of ['too-large', 'binary', 'unknown-language', 'read-failed', 'symlink']) {
      const p = project({ skipped: [{ path: 'native/x.h', reason }], files: { 'a.xml': '<i src="native/x.h"/>', 'native/y.h': '' } });
      expect(p.gaps('mention-target-unindexed')[0].samples, reason).toEqual([`a.xml:1 native/x.h -> [native/x.h (${reason})]`]);
    }
  });

  it('does not count a file a policy excluded: it was never looked at', () => {
    for (const reason of ['filtered-by-ignore', 'filtered-by-defaults', 'sensitive', 'ignored']) {
      const p = project({ skipped: [{ path: 'native/x.h', reason }], files: { 'a.xml': '<i src="native/x.h"/>', 'native/y.h': '' } });
      expect(p.gaps('path-mention-unresolved'), reason).toHaveLength(1);
      expect(p.gaps('mention-target-unindexed'), reason).toEqual([]);
    }
  });

  it('resolves a node first: a skipped file elsewhere with another name is no competitor', () => {
    const p = project({ skipped: [{ path: 'big/other.xml', reason: 'too-large' }], files: { 'a/x.xml': '<i r="row.xml"/>', 'a/row.xml': '<r/>' } });
    expect(p.links).toEqual(['a/x.xml -> a/row.xml']);
  });

  it('counts a skipped file and a node alike when deciding what is ambiguous', () => {
    const p = project({
      skipped: [{ path: 'b/spring/beans.xml', reason: 'too-large' }],
      files: { 'a/app.xml': '<import resource="classpath:spring/beans.xml"/>', 'a/spring/beans.xml': '<beans/>' },
    });
    expect(p.mentions).toEqual([]);
    expect(p.gaps('mention-ambiguous')[0].samples).toEqual([
      'a/app.xml:1 classpath:spring/beans.xml -> [a/spring/beans.xml, b/spring/beans.xml (too-large)]',
    ]);
    expect(p.gaps('mention-target-unindexed')).toEqual([]);
  });

  it('draws the edges to a pattern\'s nodes and counts its skipped matches', () => {
    const p = project({
      skipped: [{ path: 'lib/conf/big.xml', reason: 'too-large' }, { path: 'lib/conf/blob.xml', reason: 'binary' }],
      files: { 'a/app.xml': '<i r="classpath*:conf/*.xml"/>', 'lib/conf/one.xml': '<a/>' },
    });
    expect(p.links).toEqual(['a/app.xml -> lib/conf/one.xml']);
    expect(p.gaps('mention-target-unindexed')).toEqual([]);
    expect(p.coverage.path).toEqual({ candidates: 1, edge: 1, ambiguous: 0, unresolved: 0, self: 0, unindexed: 0, unindexedHits: 2 });
  });

  it('records a pattern that matched only skipped files as unindexed, naming a few', () => {
    const skipped = Array.from({ length: 7 }, (_, i) => ({ path: `lib/conf/big${i}.xml`, reason: 'too-large' }));
    const p = project({ skipped, files: { 'a/app.xml': '<i r="classpath*:conf/*.xml"/>' } });
    expect(p.mentions).toEqual([]);
    expect(p.gaps('path-mention-unresolved')).toEqual([]);
    const [gap] = p.gaps('mention-target-unindexed');
    expect(gap.count).toBe(1);
    expect(gap.samples[0]).toBe(
      'a/app.xml:1 classpath*:conf/*.xml -> [lib/conf/big0.xml (too-large), lib/conf/big1.xml (too-large), lib/conf/big2.xml (too-large), '
      + 'lib/conf/big3.xml (too-large), lib/conf/big4.xml (too-large), +2 more]',
    );
    expect(p.coverage.path).toMatchObject({ candidates: 1, edge: 0, unindexed: 1, unindexedHits: 7 });
  });

  it('does not let a skipped file make a web root', () => {
    // only a jar is under WEB-INF: `webapp` is no web root, so index.jsp is not looked up there
    const p = project({
      skipped: [{ path: 'webapp/WEB-INF/lib/x.jar', reason: 'binary' }],
      files: { 'webapp/pages/p.xhtml': '<a src="index.jsp"/>', 'webapp/index.jsp': '<h/>' },
    });
    expect(p.mentions).toEqual([]);
    expect(p.gaps('path-mention-unresolved')).toHaveLength(1);
  });

  it('counts the non-code files it skipped, by reason, in the coverage', () => {
    const p = project({
      skipped: [
        { path: 'a/big1.xml', reason: 'too-large' },
        { path: 'a/big2.xml', reason: 'too-large' },
        { path: 'a/blob.bin', reason: 'binary', language: 'unknown' },
        { path: 'a/noext', reason: 'unknown-language', language: 'unknown' },
        { path: 'a/big.java', reason: 'too-large', text: 'package a;\nclass big {}\n' }, // code: not lexed either way, not counted here
        { path: 'a/ignored.xml', reason: 'filtered-by-ignore' },
        { path: 'a/secret.xml', reason: 'sensitive' },
      ],
      files: { 'x.xml': '<a/>' },
    });
    expect(p.coverage.skipped).toEqual({ 'too-large': 2, binary: 1, 'unknown-language': 1 });
    expect(p.coverage.files).toEqual({ xml: 1 });
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
      files: { 'a/x.xml': '<i resource="nothing/*.xml"/>', 'b/y.xml': '<i resource="*/*.xml"/>', 'c/z.xml': '<i resource="../c/*.xml"/>' },
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
    // `../web.xml` (welcome-file) names a file nothing shows to be at that place: unresolved, no longer
    // matched to web.xml by suffix
    expect(path).toEqual({ candidates: 5, edge: 2, ambiguous: 1, unresolved: 2, self: 0, unindexed: 0, unindexedHits: 0 });
  });

  it('reads the gap counts back from what was recorded', () => {
    const p = full();
    const count = (kind) => p.gaps(kind).reduce((sum, g) => sum + g.count, 0);
    expect(count('mention-ambiguous')).toBe(p.coverage.fqn.ambiguous + p.coverage.path.ambiguous);
    expect(count('mention-target-unindexed')).toBe(p.coverage.fqn.unindexed + p.coverage.path.unindexed);
    expect(count('path-mention-unresolved')).toBe(p.coverage.path.unresolved);
  });

  it('throws when a class-name candidate has no outcome', () => {
    const run = (fqnEdge) => assertMentionConservation(
      { fqn: { candidates: 4, edge: fqnEdge, ambiguous: 1, unindexed: 1, external: 1 }, path: { candidates: 0, edge: 0, ambiguous: 0, unresolved: 0, self: 0, unindexed: 0 } },
      { ambiguous: 1, unindexed: 1, unresolved: 0 },
    );
    expect(() => run(1)).not.toThrow();
    expect(() => run(0)).toThrow(/4 class-name candidate\(s\) but 3 outcome\(s\)/);
  });

  it('throws when a path candidate has no outcome', () => {
    const run = (self) => assertMentionConservation(
      { fqn: { candidates: 0, edge: 0, ambiguous: 0, unindexed: 0, external: 0 }, path: { candidates: 5, edge: 1, ambiguous: 1, unresolved: 1, self, unindexed: 1 } },
      { ambiguous: 1, unindexed: 1, unresolved: 1 },
    );
    expect(() => run(1)).not.toThrow();
    expect(() => run(2)).toThrow(/5 path candidate\(s\) but 6 outcome\(s\)/);
    expect(() => run(0)).toThrow(/5 path candidate\(s\) but 4 outcome\(s\)/);
  });

  it('counts a path candidate that matched a skipped file in the unindexed gaps', () => {
    const mentions = {
      fqn: { candidates: 1, edge: 0, ambiguous: 0, unindexed: 1, external: 0 },
      path: { candidates: 1, edge: 0, ambiguous: 0, unresolved: 0, self: 0, unindexed: 1 },
    };
    expect(() => assertMentionConservation(mentions, { ambiguous: 0, unindexed: 2, unresolved: 0 })).not.toThrow();
    expect(() => assertMentionConservation(mentions, { ambiguous: 0, unindexed: 1, unresolved: 0 })).toThrow(/mention-target-unindexed/);
  });

  it('wants every input it is given a stage for', () => {
    const base = {
      sites: [], manifestPaths: [], javaTypes: [], otherJvm: { isType: () => false }, fileIdOf: (p) => p,
      declaredJavaTypes: createDeclaredJavaTypeIndex([]), skippedFiles: [], skippedNonCode: {},
    };
    expect(() => resolveMentions(base)).not.toThrow();
    for (const missing of ['declaredJavaTypes', 'skippedFiles', 'skippedNonCode']) {
      expect(() => resolveMentions({ ...base, [missing]: undefined }), missing).toThrow(new RegExp(`${missing} is required`));
    }
    expect(() => resolveMentions({ ...base, skippedFiles: [{ path: 'a', reason: 'filtered-by-ignore' }] })).toThrow(/names no repository file/);
    // buildFactGraph: sites and the inputs the stage computed with them go together
    const scan = { files: [], skipped: [], coverage: {} };
    expect(() => buildFactGraph({ scan, structureAll: { results: [] }, mentionSites: [] })).toThrow(/go together/);
    expect(() => buildFactGraph({ scan, structureAll: { results: [] }, mentionInputs: { javaPackages: [], skippedNonCode: {} } })).toThrow(/go together/);
  });

  it('throws when a recorded gap disagrees with the outcome it came from', () => {
    const mentions = {
      fqn: { candidates: 2, edge: 0, ambiguous: 1, unindexed: 1, external: 0 },
      path: { candidates: 2, edge: 0, ambiguous: 1, unresolved: 1, self: 0, unindexed: 0 },
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
      skipped: {},
      fqn: { candidates: 0, edge: 0, ambiguous: 0, unindexed: 0, external: 0 },
      path: { candidates: 0, edge: 0, ambiguous: 0, unresolved: 0, self: 0, unindexed: 0, unindexedHits: 0 },
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
        annotations: { 'src/com/acme/Audited.java': 'com.acme' },
        files: { 'beans.xml': '<include-filter expression="com.acme.Audited"/>' },
      }),
      holds: (p) => p.mentions.length === 0 && p.gaps('mention-target-unindexed').length === 1 && p.coverage.fqn.external === 0,
    },
    noSuffixForPatternsOrBareNames: {
      mutation: { suffixForPatterns: true },
      spec: () => ({
        java: { 'modB/src/main/java/x/Foo.java': 'x.Foo' },
        files: {
          'modA/pom.xml': '<include>java/**/*.java</include>',
          'CHANGELOG.txt': 'fixes unistd.h',
          'native/os/windows/unistd.h': '/* header */',
        },
      }),
      holds: (p) => p.mentions.length === 0 && p.coverage.path.unresolved === 2 && p.coverage.path.edge === 0,
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

  // Task 2.7: the Java declarations the resolver trusts are the ones a file
  // makes by its own `package`. Decided by directory suffix (what 2.5 did) it
  // calls a servlet name like `ejb3.Foo` a declaration. The index is an input of
  // the resolver, so this tripwire swaps in that older rule.
  describe('declaredJavaTypes: a directory suffix is not a declaration', () => {
    const javaFiles = ['src/main/java/org/acme/ejb3/Foo.java', 'src/main/java/org/acme/ejb3/Marker.java'];
    const directorySuffixIndex = {
      isType: (pkg, name) => javaFiles.some((file) => {
        const dir = file.slice(0, file.lastIndexOf('/'));
        const stem = file.slice(file.lastIndexOf('/') + 1).replace(/\.java$/, '');
        return stem === name && pkg !== '' && (dir === pkg.replace(/\./g, '/') || dir.endsWith(`/${pkg.replace(/\./g, '/')}`));
      }),
    };
    const run = (declaredJavaTypes) => resolveMentions({
      sites: [{ file: 'WEB-INF/web.xml', language: 'xml', fqn: [{ token: 'ejb3.Marker', line: 1, context: null }], path: [] }],
      manifestPaths: ['WEB-INF/web.xml'],
      javaTypes: [],
      otherJvm: { isType: () => false },
      declaredJavaTypes,
      skippedFiles: [],
      skippedNonCode: {},
      fileIdOf: (path) => path,
    });

    it('holds as shipped: a servlet name the directory resembles is outside the repository', () => {
      const result = run(createDeclaredJavaTypeIndex([{ file: javaFiles[1], package: 'org.acme.ejb3' }]));
      expect(result.gaps).toEqual([]);
      expect(result.coverage.fqn).toMatchObject({ unindexed: 0, external: 1 });
    });

    it('breaks when decided by directory suffix', () => {
      const result = run(directorySuffixIndex);
      expect(result.gaps.map((g) => g.kind)).toEqual(['mention-target-unindexed']);
      expect(result.coverage.fqn).toMatchObject({ unindexed: 1, external: 0 });
    });
  });

  for (const [name, scenario] of Object.entries(scenarios)) {
    it(`${name}: holds as shipped`, () => {
      expect(scenario.holds(project(scenario.spec()))).toBe(true);
    });
    it(`${name}: breaks under ${Object.keys(scenario.mutation)[0]}`, () => {
      expect(scenario.holds(project({ ...scenario.spec(), mutations: scenario.mutation }))).toBe(false);
    });
  }
});
