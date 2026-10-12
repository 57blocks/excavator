// name-mention-facts, tasks 3.1 and 2.7: the driver's mentions stage as a
// function of the manifest, the structure rows and an injected `readFile` (the
// driver binds it to the materialized snapshot, the live tree is never read
// here).
import { describe, expect, it } from 'vitest';
import { collectMentionSites } from '../../skills/excavator/mention-sites.mjs';
import { TARGET_SKIP_REASONS } from '../../skills/excavator/mention-resolution.mjs';

const scanOf = (files, skipped = []) => ({
  files: files.map(([path, language]) => ({ path, language })),
  skipped,
});
const noRows = { results: [] };

describe('collectMentionSites', () => {
  const contents = {
    'a/web.xml': '<servlet-class>com.acme.Svc</servlet-class>\n<welcome-file>index.jsp</welcome-file>',
    'a/index.jsp': '<h1/>',
    'a/Svc.java': 'class Svc { String s = "com.acme.Other"; String p = "x.xml"; }',
    'a/notes.ftl': 'plain com.acme.Plain',
    'a/empty.properties': '',
  };
  const scan = scanOf([
    ['a/web.xml', 'xml'], ['a/index.jsp', 'jsp'], ['a/Svc.java', 'java'], ['a/notes.ftl', 'ftl'], ['a/empty.properties', 'properties'],
  ]);
  const structureAll = { results: [{ path: 'a/Svc.java', classes: [{ name: 'Svc', qualifiedName: 'com.acme.Svc' }] }] };

  it('lexes every non-code file and skips code languages without reading them', () => {
    const reads = [];
    const { sites } = collectMentionSites({ scan, structureAll, readFile: (path) => (reads.push(path), contents[path]) });
    expect(sites.map((s) => [s.file, s.language])).toEqual([
      ['a/web.xml', 'xml'], ['a/index.jsp', 'jsp'], ['a/notes.ftl', 'ftl'], ['a/empty.properties', 'properties'],
    ]);
    expect(reads).not.toContain('a/Svc.java'); // a code file whose own type the dictionary has
    expect(sites[0].fqn.find((c) => c.token === 'com.acme.Svc')).toMatchObject({ line: 1, context: { element: 'servlet-class', attribute: null } });
  });

  it('keeps a row for a file with no mention: the row is what coverage counts', () => {
    const { sites } = collectMentionSites({ scan, structureAll, readFile: (path) => contents[path] });
    expect(sites.find((s) => s.file === 'a/empty.properties')).toEqual({ file: 'a/empty.properties', language: 'properties', fqn: [], path: [] });
  });

  it('takes the extensions of the whole manifest, code files included', () => {
    // `.java` is only in the manifest through the Java file; the xml mentions it
    const { sites } = collectMentionSites({
      scan: scanOf([['a/web.xml', 'xml'], ['a/Svc.java', 'java']]),
      structureAll,
      readFile: (path) => (path === 'a/web.xml' ? '<a src="Svc.java" other="x.png"/>' : 'package com.acme;'),
    });
    expect(sites[0].path.map((c) => c.token)).toEqual(['Svc.java']);
  });

  it('fails visibly when a manifest file cannot be read, never an empty row', () => {
    expect(() => collectMentionSites({
      scan: scanOf([['gone.xml', 'xml']]),
      structureAll: noRows,
      readFile: () => {
        throw new Error('ENOENT');
      },
    })).toThrow(/mentions: cannot read gone\.xml from the snapshot: ENOENT/);
  });

  describe('the packages Java files declare (task 2.7a)', () => {
    const javaScan = scanOf([['m/src/com/acme/Audited.java', 'java'], ['m/src/com/acme/Svc.java', 'java'], ['m/src/Plain.java', 'java']]);
    const rows = {
      results: [
        { path: 'm/src/com/acme/Svc.java', classes: [{ name: 'Svc', qualifiedName: 'com.acme.Svc' }] },
        // the real shape of a file whose only type is an annotation: no `classes`
        { path: 'm/src/com/acme/Audited.java', imports: [], metrics: { classCount: 0 } },
        { path: 'm/src/Plain.java', classes: [{ name: 'Plain', qualifiedName: 'Plain' }] },
      ],
    };
    const texts = {
      'm/src/com/acme/Audited.java': '// licence\npackage org.other.pkg;\n@interface Audited {}',
      'm/src/com/acme/Svc.java': 'package com.acme;\nclass Svc {}',
    };

    it('reads the package of a Java file the dictionary has no type for, from the file, not its directory', () => {
      const reads = [];
      const { inputs } = collectMentionSites({ scan: javaScan, structureAll: rows, readFile: (path) => (reads.push(path), texts[path]) });
      expect(inputs.javaPackages).toEqual([{ file: 'm/src/com/acme/Audited.java', package: 'org.other.pkg' }]);
      expect(reads).toEqual(['m/src/com/acme/Audited.java']);
    });

    it('records nothing for a file in the default package', () => {
      const { inputs } = collectMentionSites({
        scan: scanOf([['m/Marker.java', 'java']]), structureAll: noRows, readFile: () => '@interface Marker {}',
      });
      expect(inputs.javaPackages).toEqual([]);
    });

    it('asks for a class entry named like the file, not any class entry', () => {
      // Foo.java holds only class Bar: no entry for the type its name says
      const { inputs } = collectMentionSites({
        scan: scanOf([['a/Foo.java', 'java']]),
        structureAll: { results: [{ path: 'a/Foo.java', classes: [{ name: 'Bar', qualifiedName: 'a.Bar' }] }] },
        readFile: () => 'package a;\nclass Bar {}',
      });
      expect(inputs.javaPackages).toEqual([{ file: 'a/Foo.java', package: 'a' }]);
    });

    it('reads a Java file the scanner skipped as too large, and no other skipped Java file', () => {
      const reads = [];
      const { inputs } = collectMentionSites({
        scan: scanOf([], [
          { path: 'g/Huge.java', reason: 'too-large', language: 'java' },
          { path: 'g/Link.java', reason: 'symlink', language: 'java' },
          { path: 'g/Broken.java', reason: 'read-failed', language: 'java' },
          { path: 'g/Blob.java', reason: 'binary', language: 'java' },
          { path: 'g/Ignored.java', reason: 'filtered-by-ignore', language: 'java' },
        ]),
        structureAll: noRows,
        readFile: (path) => (reads.push(path), 'package g;\nclass X {}'),
      });
      expect(reads).toEqual(['g/Huge.java']);
      expect(inputs.javaPackages).toEqual([{ file: 'g/Huge.java', package: 'g' }]);
    });
  });

  describe('the non-code files it could not lex (task 2.7c)', () => {
    it('counts them by reason, code files and policy exclusions apart', () => {
      const { inputs, sites } = collectMentionSites({
        scan: scanOf([['a.xml', 'xml']], [
          { path: 'big1.xml', reason: 'too-large', language: 'xml' },
          { path: 'big2.xml', reason: 'too-large', language: 'xml' },
          { path: 'x.bin', reason: 'binary', language: 'bin' },
          { path: 'noext', reason: 'unknown-language', language: 'unknown' },
          { path: 'lnk.txt', reason: 'symlink', language: 'txt' },
          { path: 'gone.sh', reason: 'read-failed', language: 'shell' },
          { path: 'Big.ts', reason: 'too-large', language: 'typescript' },
          { path: 'ign.xml', reason: 'filtered-by-ignore', language: 'xml' },
          { path: 'def.xml', reason: 'filtered-by-defaults', language: 'xml' },
          { path: 'sec.xml', reason: 'sensitive', language: 'xml' },
        ]),
        structureAll: noRows,
        readFile: () => '<a/>',
      });
      expect(inputs.skippedNonCode).toEqual({ 'too-large': 2, binary: 1, 'unknown-language': 1, symlink: 1, 'read-failed': 1 });
      expect(sites.map((s) => s.file)).toEqual(['a.xml']);
    });

    it('names the reasons that mean the file is in the repository, policy exclusions apart', () => {
      expect([...TARGET_SKIP_REASONS].sort()).toEqual(['binary', 'read-failed', 'symlink', 'too-large', 'unknown-language']);
    });
  });
});
