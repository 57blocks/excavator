// name-mention-facts, task 3.1: the driver's mentions stage as a function of
// the manifest and an injected `readFile` (the driver binds it to the
// materialized snapshot, the live tree is never read here).
import { describe, expect, it } from 'vitest';
import { collectMentionSites } from '../../skills/excavator/mention-sites.mjs';

const scanOf = (files) => ({ files: files.map(([path, language]) => ({ path, language })) });

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
  const reads = [];
  const readFile = (path) => {
    reads.push(path);
    return contents[path];
  };

  it('lexes every non-code file and skips code languages without reading them', () => {
    const sites = collectMentionSites({ scan, readFile });
    expect(sites.map((s) => [s.file, s.language])).toEqual([
      ['a/web.xml', 'xml'], ['a/index.jsp', 'jsp'], ['a/notes.ftl', 'ftl'], ['a/empty.properties', 'properties'],
    ]);
    expect(reads).not.toContain('a/Svc.java');
    expect(sites[0].fqn.find((c) => c.token === 'com.acme.Svc')).toMatchObject({ line: 1, context: { element: 'servlet-class', attribute: null } });
  });

  it('keeps a row for a file with no mention: the row is what coverage counts', () => {
    const sites = collectMentionSites({ scan, readFile });
    expect(sites.find((s) => s.file === 'a/empty.properties')).toEqual({ file: 'a/empty.properties', language: 'properties', fqn: [], path: [] });
  });

  it('takes the extensions of the whole manifest, code files included', () => {
    // `.java` is only in the manifest through the Java file; the xml mentions it
    const sites = collectMentionSites({
      scan: scanOf([['a/web.xml', 'xml'], ['a/Svc.java', 'java']]),
      readFile: (path) => (path === 'a/web.xml' ? '<a src="Svc.java" other="x.png"/>' : ''),
    });
    expect(sites[0].path.map((c) => c.token)).toEqual(['Svc.java']);
  });

  it('fails visibly when a manifest file cannot be read, never an empty row', () => {
    expect(() => collectMentionSites({
      scan: scanOf([['gone.xml', 'xml']]),
      readFile: () => {
        throw new Error('ENOENT');
      },
    })).toThrow(/mentions: cannot read gone\.xml from the snapshot: ENOENT/);
  });
});
