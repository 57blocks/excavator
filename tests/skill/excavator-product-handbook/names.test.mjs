// O1 (candidates) of openspec change handbook-system-name: `names` lists the
// system names the code and the configuration write, each with its value, its
// source and its file and line, found only in the application roots and their
// public directories. The expectations are written by hand from the fixture.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { runHandbook } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

/** A throwaway project from `{ path: text }`; returns its real path. */
function project(files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'xhb-names-')));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const lines = (...rows) => `${rows.join('\n')}\n`;

/** One application root per kind of source, laid out so every expected line number can be read off the text. */
const FIXTURE = {
  // A Go module: a commented module line is not the module.
  'api/go.mod': lines('// module example.com/acme/old-name', '', 'module example.com/acme/portal-api', '', 'go 1.22'),
  // A package.json that is not JSON: listed as not read, no candidate.
  'bad/package.json': '{ "name": \n',
  // Empty values are no candidates.
  'empty/package.json': lines('{', '  "name": "",', '  "productName": "   "', '}'),
  'empty/index.html': '<html><head><title></title></head></html>\n',
  'empty/public/manifest.json': '{ "name": "", "short_name": "" }\n',
  // Gradle, and an HTML title on several lines after a commented one.
  'jvm/build.gradle': "plugins { id 'java' }\n",
  'jvm/settings.gradle': lines("// rootProject.name = 'commented'", "rootProject.name = 'acme-jvm'"),
  'jvm/settings.gradle.kts': lines('rootProject.name = "acme-jvm-kts"'),
  'jvm/index.html': lines('<!doctype html>', '<!-- <title>Old Title</title> -->', '<title>', '  Acme Admin', '</title>'),
  // Titles that refer to variables: each of the three forms, found in .env.production and .env.development, quoted and exported.
  'site/package.json': '{ "private": true }\n',
  'site/.env': 'OTHER=1\n',
  'site/.env.production': lines('# production', 'OTHER=2', 'PUB_TITLE="Acme Public Site"  # shown in the tab'),
  'site/.env.development': lines('PUB_TITLE=Dev Site', "export SITE_TITLE='Acme Site'"),
  'site/index.html': lines('<!doctype html>', '<title>import.meta.env.SITE_TITLE</title>'),
  'site/public/index.html': '<title>${PUB_TITLE}</title>\n',
  // Maven: the top-level name and artifact id only, not the parent's, a dependency's, a comment's or a CDATA text's.
  'svc/pom.xml': lines(
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<project xmlns="http://maven.apache.org/POM/4.0.0">',
    '  <modelVersion>4.0.0</modelVersion>',
    '  <parent>',
    '    <groupId>org.acme</groupId>',
    '    <artifactId>acme-parent</artifactId>',
    '    <name>Parent Name</name>',
    '  </parent>',
    '  <!-- <name>Hidden Name</name> -->',
    '  <artifactId>billing-svc</artifactId>',
    '  <name>Acme Billing</name>',
    '  <dependencies>',
    '    <dependency>',
    '      <artifactId>junit</artifactId>',
    '      <name>Dep Name</name>',
    '    </dependency>',
    '  </dependencies>',
    '  <description><![CDATA[<name>Fake</name>]]></description>',
    '</project>',
  ),
  // The web application: package.json, manifests in the root and in public/, an HTML title with a variable, and files that are not read.
  'web/package.json': lines('{', '  "name": "acme-ui",', '  "productName": "Acme Portal",', '  "displayName": "Acme",', '  "author": { "name": "Acme Inc" },', '  "version": "1.0.0"', '}'),
  'web/index.html': lines('<!doctype html>', '<html>', '<head>', '  <title>%VITE_TITLE%</title>'),
  'web/.env': lines('# app settings', 'VITE_TITLE=Acme Portal', 'VITE_OTHER=x'),
  'web/public/manifest.json': lines('{', '  "name": "Acme Portal",', '  "short_name": "Acme",', '  "icons": [{ "name": "icon", "src": "a.png" }],', '  "related": { "name": "Nested" }', '}'),
  'web/public/site.webmanifest': '{ "name": "Acme Web", "short_name": "AW" }\n',
  'web/public/dup.webmanifest': '{ "name": "Same", "short_name": "Same" }\n',
  'web/public/index.html': '<title>%MISSING_VAR%</title>\n',
  // Not in an application root or its public directory: never listed.
  'web/tools/package.json': '{ "name": "acme-tools" }\n',
  'web/src/index.html': '<title>Deep</title>\n',
  'web/README.md': 'name: Readme Name\n',
};

const EXPECTED = [
  'Name candidates: 21',
  'portal-api\tgo-module\tapi/go.mod:3\tresolved',
  'Acme Admin\thtml-title\tjvm/index.html:4\tresolved',
  'acme-jvm\tgradle-root\tjvm/settings.gradle:2\tresolved',
  'acme-jvm-kts\tgradle-root\tjvm/settings.gradle.kts:1\tresolved',
  'Acme Site\thtml-title\tsite/.env.development:2\tresolved',
  'Acme Public Site\thtml-title\tsite/.env.production:3\tresolved',
  'import.meta.env.SITE_TITLE\thtml-title\tsite/index.html:2\tunresolved',
  '${PUB_TITLE}\thtml-title\tsite/public/index.html:1\tunresolved',
  'billing-svc\tmaven-artifact\tsvc/pom.xml:10\tresolved',
  'Acme Billing\tmaven-name\tsvc/pom.xml:11\tresolved',
  'Acme Portal\thtml-title\tweb/.env:2\tresolved',
  '%VITE_TITLE%\thtml-title\tweb/index.html:4\tunresolved',
  'acme-ui\tpackage-name\tweb/package.json:2\tresolved',
  'Acme Portal\tpackage-product-name\tweb/package.json:3\tresolved',
  'Acme\tpackage-display-name\tweb/package.json:4\tresolved',
  'Same\tweb-manifest-name\tweb/public/dup.webmanifest:1\tresolved',
  '%MISSING_VAR%\thtml-title\tweb/public/index.html:1\tunresolved',
  'Acme Portal\tweb-manifest-name\tweb/public/manifest.json:2\tresolved',
  'Acme\tweb-manifest-short-name\tweb/public/manifest.json:3\tresolved',
  'Acme Web\tweb-manifest-name\tweb/public/site.webmanifest:1\tresolved',
  'AW\tweb-manifest-short-name\tweb/public/site.webmanifest:1\tresolved',
  'Files not read: 1',
  'bad/package.json\tnot valid JSON',
];

const names = (root) => {
  const result = runHandbook(['names', root]);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return result;
};

describe('names: the candidates of a project', () => {
  it('lists every source with its value, source, file and line, in application root, file and line order', () => {
    const root = project(FIXTURE);
    expect(names(root).lines).toEqual(EXPECTED);
  });

  it('prints the same bytes on a second run and never the project path', () => {
    const root = project(FIXTURE);
    const first = names(root).stdout;
    expect(names(root).stdout).toBe(first);
    expect(first).not.toContain(root);
  });

  it('lists a title that refers to a variable twice: the variable value as resolved, the title as written as unresolved', () => {
    const rows = names(project(FIXTURE)).lines.filter((line) => line.includes('web/'));
    expect(rows).toContain('Acme Portal\thtml-title\tweb/.env:2\tresolved');
    expect(rows).toContain('%VITE_TITLE%\thtml-title\tweb/index.html:4\tunresolved');
  });

  it('lists a title whose variable no .env file defines only as written, marked unresolved', () => {
    const rows = names(project(FIXTURE)).lines;
    expect(rows.filter((line) => line.includes('MISSING_VAR'))).toEqual(['%MISSING_VAR%\thtml-title\tweb/public/index.html:1\tunresolved']);
  });

  it('lists nothing from a package.json below the root, an HTML file outside the root and public/, or a document', () => {
    const text = names(project(FIXTURE)).stdout;
    for (const unwanted of ['acme-tools', 'Deep', 'Readme Name', 'Nested', 'Acme Inc', 'icon', 'Parent Name', 'acme-parent', 'Hidden Name', 'Dep Name', 'junit', 'Fake', 'old-name', 'commented', 'Old Title']) {
      expect(text, unwanted).not.toContain(unwanted);
    }
  });

  it('lists no empty value', () => {
    expect(names(project(FIXTURE)).stdout).not.toContain('empty/');
  });

  it('a project with no root says so with counts of zero and no row', () => {
    expect(names(project({ 'src/a.js': 'x\n' })).lines).toEqual(['Name candidates: 0', 'Files not read: 0']);
  });

  it('a root with sources that name nothing lists no candidate', () => {
    expect(names(project({ 'go.mod': 'go 1.22\n', 'package.json': '{}\n' })).lines).toEqual(['Name candidates: 0', 'Files not read: 0']);
  });

  it('puts a file over the size cap and a file with a NUL byte in the not-read list instead of dropping them', () => {
    const root = project({
      'a/package.json': `{ "name": "kept" }${' '.repeat(2 * 1024 * 1024)}\n`,
      'b/package.json': '{ "name": "ok-b" }\n',
      'b/index.html': `<title>nul${String.fromCharCode(0)}</title>\n`,
    });
    const rows = names(root).lines;
    expect(rows).toEqual([
      'Name candidates: 1',
      'ok-b\tpackage-name\tb/package.json:1\tresolved',
      'Files not read: 2',
      'a/package.json\tlarger than 2097152 bytes',
      'b/index.html\tholds a NUL byte',
    ]);
  });

  it('does not follow a link: a manifest behind a link is not read and is listed as not read', () => {
    const root = project({ 'app/package.json': '{ "name": "real" }\n', 'elsewhere/manifest.json': '{ "name": "Linked" }\n' });
    mkdirSync(join(root, 'app', 'public'), { recursive: true });
    symlinkSync(join(root, 'elsewhere', 'manifest.json'), join(root, 'app', 'public', 'manifest.json'));
    expect(names(root).lines).toEqual(['Name candidates: 1', 'real\tpackage-name\tapp/package.json:1\tresolved', 'Files not read: 1', 'app/public/manifest.json\tis a link, not followed']);
  });

  it('takes the last segment of a quoted module path and ignores a Go module line that has no path', () => {
    const root = project({ 'go.mod': 'module "example.com/acme/quoted-svc"\n' });
    expect(names(root).lines).toEqual(['Name candidates: 1', 'quoted-svc\tgo-module\tgo.mod:1\tresolved', 'Files not read: 0']);
  });

  it('a manifest in the project root makes the project root the root: its public directory is read, a nested one is not', () => {
    const root = project({
      'package.json': '{ "name": "top" }\n',
      'public/manifest.json': '{ "name": "Top Product" }\n',
      'pkg/package.json': '{ "name": "inner" }\n',
      'pkg/public/manifest.json': '{ "name": "Inner Product" }\n',
    });
    expect(names(root).lines).toEqual([
      'Name candidates: 2',
      'top\tpackage-name\tpackage.json:1\tresolved',
      'Top Product\tweb-manifest-name\tpublic/manifest.json:1\tresolved',
      'Files not read: 0',
    ]);
  });

  it('takes exactly one project root and exits 2 otherwise', () => {
    expect(runHandbook(['names']).status).toBe(2);
    expect(runHandbook(['names', 'a', 'b']).status).toBe(2);
  });
});
