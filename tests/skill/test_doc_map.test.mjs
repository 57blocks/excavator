/**
 * doc-map.py (openspec: specs/doc-map).
 *
 * The script runs under the host's python3 with PATH set to a directory of
 * stand-in tools, so whether pdftotext, textutil or antiword "exist" is up
 * to each test, never to the machine. The .docx and .odt fixtures are zip
 * archives written on the spot by Python's zipfile; the repository holds no
 * binary fixture.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '../../skills/excavator/doc-map.py');
const PYTHON = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf-8' }).trim();

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

function tempDir(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(dir);
  return dir;
}

function write(root, path, content) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return full;
}

/** A directory of stand-in tools: `{ name: shell body }`. */
function toolDir(tools = {}) {
  const dir = tempDir('doc-map-bin-');
  for (const [name, body] of Object.entries(tools)) {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
  }
  return dir;
}

function run(args, { bin = toolDir() } = {}) {
  return spawnSync(PYTHON, ['-I', SCRIPT, ...args], { encoding: 'utf-8', env: { PATH: bin, LANG: 'C.UTF-8' } });
}

const ZIP = `
import json, sys, zipfile
spec = json.load(sys.stdin)
with zipfile.ZipFile(spec["path"], "w") as archive:
    for name, content in spec["members"].items():
        archive.writestr(name, content)
`;

function writeZip(root, path, members) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  execFileSync(PYTHON, ['-I', '-c', ZIP], { input: JSON.stringify({ path: full, members }) });
  return full;
}

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
  + 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const docx = (body) => ({ 'word/document.xml': `<?xml version="1.0"?><w:document ${W_NS}><w:body>${body}</w:body></w:document>` });
const odt = (body) => ({
  'content.xml': '<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
    + `xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>${body}</office:text></office:body></office:document-content>`,
});

function readProduct(project) {
  return JSON.parse(readFileSync(join(project, '.excavator', 'doc-map.json'), 'utf-8'));
}

function textOf(project, path) {
  return readFileSync(join(project, '.excavator', 'doc-map', 'text', `${path}.txt`), 'utf-8');
}

const rowOf = (product, path) => product.documents.find((row) => row.path === path);

describe('read: every file gets one status', () => {
  it('adds the statuses up to the files, with a reason for each one not read', () => {
    const docs = tempDir('doc-map-docs-');
    const project = tempDir('doc-map-project-');
    write(docs, 'guide.md', '# Guide\n');
    write(docs, 'img/logo.png', 'not text');
    write(docs, 'broken.docx', 'not a zip');
    write(docs, 'scan.pdf', '%PDF');
    const result = run(['read', docs, project], { bin: toolDir({ pdftotext: "printf '  \\n\\f'" }) });
    expect(result.status, result.stderr).toBe(0);
    const product = readProduct(project);
    expect(product.counts).toEqual({
      files: 4, read: 1, empty: 1, noConverter: 0, unsupported: 1, failed: 1, units: null, found: null, notFound: null, notChecked: null,
    });
    expect(product.documents.map((row) => [row.path, row.status])).toEqual([
      ['broken.docx', 'failed'], ['guide.md', 'read'], ['img/logo.png', 'unsupported'], ['scan.pdf', 'empty'],
    ]);
    expect(rowOf(product, 'img/logo.png').reason).toBe('extension .png');
    expect(rowOf(product, 'broken.docx').reason).toMatch(/^cannot read word\/document\.xml: /);
    expect(rowOf(product, 'scan.pdf').reason).toBe('no text layer; the pages may be images');
    expect(result.stdout).toBe('doc-map: 4 files: 1 read, 1 empty, 0 no-converter, 1 unsupported, 1 failed\n');
  });

  it('names the missing tool when there is no converter for PDF or .doc', () => {
    const docs = tempDir('doc-map-docs-');
    const project = tempDir('doc-map-project-');
    write(docs, 'spec.pdf', '%PDF');
    write(docs, 'old.doc', 'binary');
    expect(run(['read', docs, project]).status).toBe(0);
    const product = readProduct(project);
    expect(product.converters).toEqual({ pdf: null, doc: null });
    expect(rowOf(product, 'spec.pdf')).toMatchObject({ status: 'no-converter', reason: 'pdftotext (poppler-utils) is not installed', format: 'pdf' });
    expect(rowOf(product, 'old.doc')).toMatchObject({ status: 'no-converter', reason: 'neither textutil nor antiword is installed' });
    expect(product.counts.noConverter).toBe(2);
  });

  it('records a failing tool as failed with its message', () => {
    const docs = tempDir('doc-map-docs-');
    const project = tempDir('doc-map-project-');
    write(docs, 'spec.pdf', '%PDF');
    run(['read', docs, project], { bin: toolDir({ pdftotext: "echo 'Syntax Error: broken xref' >&2; exit 3" }) });
    expect(rowOf(readProduct(project), 'spec.pdf')).toMatchObject({ status: 'failed', reason: 'pdftotext exited 3: Syntax Error: broken xref' });
  });

  it('never enters .git or .excavator and never follows a symbolic link', () => {
    const docs = tempDir('doc-map-docs-');
    const outside = tempDir('doc-map-outside-');
    const project = tempDir('doc-map-project-');
    write(docs, 'a.md', 'A');
    write(docs, '.git/config', 'x');
    write(docs, '.excavator/doc-map/text/a.md.txt', 'old');
    write(outside, 'secret.md', 'outside text');
    mkdirSync(join(outside, 'dir'));
    write(outside, 'dir/inner.md', 'inner');
    symlinkSync(join(outside, 'secret.md'), join(docs, 'link.md'));
    symlinkSync(join(outside, 'dir'), join(docs, 'linked-dir'));
    run(['read', docs, project]);
    const product = readProduct(project);
    expect(product.documents.map((row) => [row.path, row.status, row.reason])).toEqual([
      ['a.md', 'read', null], ['link.md', 'unsupported', 'symbolic link'], ['linked-dir', 'unsupported', 'symbolic link'],
    ]);
    expect(existsSync(join(project, '.excavator', 'doc-map', 'text', 'link.md.txt'))).toBe(false);
    expect(rowOf(product, 'link.md').sha256).toBeNull();
  });

  it('counts a file with a blank text as empty and an upper-case extension as its format', () => {
    const docs = tempDir('doc-map-docs-');
    const project = tempDir('doc-map-project-');
    write(docs, 'blank.txt', ' \n\t\n');
    write(docs, 'NOTES.MD', 'Notes');
    run(['read', docs, project]);
    const product = readProduct(project);
    expect(rowOf(product, 'blank.txt')).toMatchObject({ status: 'empty', reason: 'no text', text: null });
    expect(rowOf(product, 'NOTES.MD')).toMatchObject({ status: 'read', format: 'text' });
  });
});

describe('read: text of each format', () => {
  it('reads UTF-8 text as it is, without a BOM, and fails text that is not UTF-8', () => {
    const docs = tempDir('doc-map-docs-');
    const project = tempDir('doc-map-project-');
    write(docs, 'a.md', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# \u7528\u4f8b\r\nline two\r\n')]));
    write(docs, 'latin.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    run(['read', docs, project]);
    const product = readProduct(project);
    expect(textOf(project, 'a.md')).toBe('# \u7528\u4f8b\nline two\n');
    expect(rowOf(product, 'a.md')).toMatchObject({
      status: 'read', format: 'text', text: 'doc-map/text/a.md.txt', chars: 14, lines: 3, pages: null, units: null,
    });
    expect(rowOf(product, 'latin.txt')).toMatchObject({ status: 'failed', reason: 'not UTF-8 text: unexpected end of data at byte 3' });
  });

  it('decodes HTML by its declared charset, drops script and style, and puts blocks on their own lines', () => {
    const docs = tempDir('doc-map-docs-');
    const project = tempDir('doc-map-project-');
    write(docs, 'spec.htm', Buffer.concat([
      Buffer.from('<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><title>Spec</title>'
        + '<style>p { color: red }</style><script>var x = "<p>no</p>";</script></head><body>'
        + '<p>Fish &amp; chips\n   and  more</p><p>Caf'),
      Buffer.from([0xe9, 0x93]),
      Buffer.from(' quoted</p><table><tr><td>UC1</td><td>Complete</td></tr></table><pre>a\n  b</pre></body></html>'),
    ]));
    write(docs, 'bad.html', '<meta charset="no-such-charset"><p>x</p>');
    write(docs, 'plain.html', '<p>no charset &lt;here&gt;</p>');
    run(['read', docs, project]);
    expect(textOf(project, 'spec.htm')).toBe('Spec\nFish & chips and more\nCafé“ quoted\nUC1\tComplete\na\nb');
    expect(textOf(project, 'plain.html')).toBe('no charset <here>');
    expect(rowOf(readProduct(project), 'bad.html')).toMatchObject({ status: 'failed', reason: 'unknown charset no-such-charset' });
  });

  it('reads .docx paragraphs one per line with tabs and breaks, leaves out deleted text and fallbacks', () => {
    const docs = tempDir('doc-map-docs-');
    const project = tempDir('doc-map-project-');
    writeZip(docs, 'uc.docx', docx(
      '<w:p><w:r><w:t>UC-01</w:t><w:tab/><w:t xml:space="preserve">Export </w:t></w:r><w:r><w:t>Medications</w:t></w:r></w:p>'
      + '<w:p/>'
      + '<w:p><w:r><w:t>kept</w:t></w:r><w:del><w:r><w:delText>gone</w:delText></w:r></w:del><w:r><w:br/><w:t>after</w:t><w:noBreakHyphen/><w:t>break</w:t></w:r></w:p>'
      + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
      + '<w:p><w:r><mc:AlternateContent><mc:Choice><w:txbxContent><w:p><w:r><w:t>box</w:t></w:r></w:p></w:txbxContent></mc:Choice>'
      + '<mc:Fallback><w:txbxContent><w:p><w:r><w:t>box copy</w:t></w:r></w:p></w:txbxContent></mc:Fallback></mc:AlternateContent><w:t>outer</w:t></w:r></w:p>',
    ));
    run(['read', docs, project]);
    expect(textOf(project, 'uc.docx')).toBe('UC-01\tExport Medications\n\nkept\nafter-break\ncell\nouter\nbox');
    expect(rowOf(readProduct(project), 'uc.docx')).toMatchObject({ format: 'docx', lines: 7 });
  });

  it('reads .odt paragraphs and headings with spaces, tabs, spans and nested notes', () => {
    const docs = tempDir('doc-map-docs-');
    const project = tempDir('doc-map-project-');
    writeZip(docs, 'spec.odt', odt(
      '<text:h>Use cases</text:h>'
      + '<text:p>A<text:s text:c="3"/>B<text:s/>C<text:tab/>D <text:span>bold</text:span> tail<text:line-break/>next'
      + '<text:note><text:note-body><text:p>note</text:p></text:note-body></text:note> end</text:p>',
    ));
    run(['read', docs, project]);
    expect(textOf(project, 'spec.odt')).toBe('Use cases\nA   B C\tD bold tail\nnext end\nnote');
  });

  it('reads PDF through pdftotext, keeping the form feed between pages and counting the pages', () => {
    const docs = tempDir('doc-map-docs-');
    const project = tempDir('doc-map-project-');
    write(docs, 'srs.pdf', '%PDF');
    const bin = toolDir({ pdftotext: '[ "$1 $2 $4" = "-enc UTF-8 -" ] || exit 9\nprintf \'one\\ftwo\\nmore\\fthree\\f\'' });
    run(['read', docs, project], { bin });
    const product = readProduct(project);
    expect(product.converters.pdf).toBe('pdftotext');
    expect(textOf(project, 'srs.pdf')).toBe('one\ftwo\nmore\fthree');
    expect(rowOf(product, 'srs.pdf')).toMatchObject({ status: 'read', pages: 3, lines: 2 });
  });

  it('reads .doc with textutil, or with antiword when there is no textutil', () => {
    const docs = tempDir('doc-map-docs-');
    const project = tempDir('doc-map-project-');
    write(docs, 'old.doc', 'binary');
    run(['read', docs, project], { bin: toolDir({ textutil: 'printf "from textutil"', antiword: 'printf "from antiword"' }) });
    expect(readProduct(project).converters.doc).toBe('textutil');
    expect(textOf(project, 'old.doc')).toBe('from textutil');
    run(['read', docs, project], { bin: toolDir({ antiword: '[ "$1 $2" = "-m UTF-8.txt" ] || exit 9\nprintf "from antiword"' }) });
    expect(readProduct(project).converters.doc).toBe('antiword');
    expect(textOf(project, 'old.doc')).toBe('from antiword');
  });
});

describe('read: product and reruns', () => {
  it('writes the keys in order, sorts rows by path and leaves the units unlisted', () => {
    const docs = tempDir('doc-map-docs-');
    const project = tempDir('doc-map-project-');
    write(docs, 'b.md', 'b');
    write(docs, 'a/z.md', 'z');
    run(['read', docs, project]);
    const product = readProduct(project);
    expect(Object.keys(product)).toEqual(['format', 'docsRoot', 'converters', 'code', 'counts', 'residualAssumptions', 'documents', 'units', 'coverage']);
    expect(product.format).toBe('excavator-doc-map/1');
    expect(product.docsRoot).toBe(docs);
    expect(product.units).toBeNull();
    expect(product.code).toBeNull();
    expect(product.coverage).toBeNull();
    expect(product.counts).toEqual({
      files: 2, read: 2, empty: 0, noConverter: 0, unsupported: 0, failed: 0, units: null, found: null, notFound: null, notChecked: null,
    });
    expect(product.residualAssumptions.join(' ')).toContain("Which passages are units is the model's judgement");
    expect(product.residualAssumptions.join(' ')).toContain('are not in the text, so a unit numbered that way has no id');
    expect(product.residualAssumptions.join(' ')).toContain("Which code a unit is tied to is the model's judgement");
    expect(product.residualAssumptions.join(' ')).toContain('A unit with no code found means only that the searches listed with it found none');
    expect(product.residualAssumptions.join(' ')).toContain("only that no unit's evidence is in it: each unit lists at most 5 places");
    expect(product.documents.map((row) => row.path)).toEqual(['a/z.md', 'b.md']);
    expect(Object.keys(product.documents[0])).toEqual([
      'path', 'format', 'bytes', 'sha256', 'status', 'reason', 'text', 'chars', 'lines', 'pages', 'units',
    ]);
    expect(product.documents[1]).toMatchObject({ bytes: 1, sha256: '3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d' });
  });

  it('replaces the text directory on a rerun, so a removed file leaves no text behind', () => {
    const docs = tempDir('doc-map-docs-');
    const project = tempDir('doc-map-project-');
    write(docs, 'keep.md', 'keep');
    write(docs, 'old/gone.md', 'gone');
    run(['read', docs, project]);
    expect(existsSync(join(project, '.excavator/doc-map/text/old/gone.md.txt'))).toBe(true);
    rmSync(join(docs, 'old'), { recursive: true });
    run(['read', docs, project]);
    expect(existsSync(join(project, '.excavator/doc-map/text/old'))).toBe(false);
    expect(textOf(project, 'keep.md')).toBe('keep');
    expect(readFileSync(join(project, '.excavator/doc-map/text/keep.md.txt'), 'utf-8')).toBe('keep');
    const left = execFileSync('find', [join(project, '.excavator')], { encoding: 'utf-8' }).trim().split('\n').map((p) => p.slice(project.length));
    expect(left.sort()).toEqual(['/.excavator', '/.excavator/doc-map', '/.excavator/doc-map.json', '/.excavator/doc-map/text', '/.excavator/doc-map/text/keep.md.txt']);
  });

  it('rejects bad arguments and a missing folder without writing a product', () => {
    const project = tempDir('doc-map-project-');
    expect(run(['read', project]).status).toBe(2);
    expect(run(['scan', project, project]).status).toBe(2);
    const missing = run(['read', join(project, 'nope'), project]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('doc-map: not a directory:');
    expect(existsSync(join(project, '.excavator'))).toBe(false);
  });
});

/** Runs `read` on `files` ({ path: content }), with a pdftotext stand-in printing `pdf` for every PDF. */
function readFolder(files, { pdf = '' } = {}) {
  const docs = tempDir('doc-map-docs-');
  const project = tempDir('doc-map-project-');
  for (const [path, content] of Object.entries(files)) write(docs, path, content);
  const bin = toolDir({ pdftotext: `printf '%s' '${pdf.replace(/'/g, "'\\''")}'` });
  const result = run(['read', docs, project], { bin });
  expect(result.status, result.stderr).toBe(0);
  return project;
}

function runUnits(project, listing) {
  const file = join(tempDir('doc-map-units-'), 'units.json');
  writeFileSync(file, typeof listing === 'string' ? listing : JSON.stringify(listing));
  return run(['units', file, project]);
}

const unit = (document, quote, extra = {}) => ({ document, id: null, title: quote, quote, ...extra });

describe('units: recorded with their place in the document', () => {
  it('gives each unit its line and its page in a PDF, and counts units per document', () => {
    const project = readFolder({
      'uc.md': '# Use cases\nUC-01 Export Medications\nThe provider exports.\nUC-02 Generate hash\nExport medications again\n',
      'srs.pdf': '%PDF',
      'other.md': 'Background only.',
      'logo.png': 'png',
    }, { pdf: 'intro\fUC1: Complete Assessment\nsteps\fUC2: Manage' });
    const result = runUnits(project, { units: [
      unit('uc.md', 'Export Medications', { id: 'UC-01', title: 'Export medications' }),
      unit('uc.md', 'UC-02 Generate hash', { id: 'UC-02' }),
      unit('srs.pdf', 'Complete Assessment', { id: 'UC1' }),
      unit('srs.pdf', 'UC2: Manage', { id: 'UC2' }),
    ] });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('doc-map: 4 units from 2 documents; 1 read documents have none\n');
    const product = readProduct(project);
    expect(product.units).toEqual([
      { document: 'uc.md', id: 'UC-01', title: 'Export medications', quote: 'Export Medications', line: 2, page: null, code: null },
      { document: 'uc.md', id: 'UC-02', title: 'UC-02 Generate hash', quote: 'UC-02 Generate hash', line: 4, page: null, code: null },
      { document: 'srs.pdf', id: 'UC1', title: 'Complete Assessment', quote: 'Complete Assessment', line: 1, page: 2, code: null },
      { document: 'srs.pdf', id: 'UC2', title: 'UC2: Manage', quote: 'UC2: Manage', line: 2, page: 3, code: null },
    ]);
    expect(product.counts.units).toBe(4);
    expect(product.documents.map((row) => [row.path, row.units])).toEqual([
      ['logo.png', null], ['other.md', 0], ['srs.pdf', 2], ['uc.md', 2],
    ]);
  });

  it('refuses a quote that occurs more than once, and places it once carried on into the unit\'s own text', () => {
    const project = readFolder({ 'uc.md': [
      'Contents', 'UC-01 Export Medications\t2', 'A. Instructor', 'UC-01 Export Medications', 'The provider exports.',
      'Roster', 'View the roster.', 'Options', 'B. Assistant', 'Roster', 'View the roster.', 'Assign Students', '',
    ].join('\n') });
    const before = readFileSync(join(project, '.excavator', 'doc-map.json'), 'utf-8');
    const repeated = runUnits(project, { units: [
      unit('uc.md', 'UC-01 Export Medications'), unit('uc.md', 'Roster\nView the roster.'),
    ] });
    expect(repeated.status).toBe(1);
    expect(repeated.stderr.split('\n').slice(1).filter(Boolean)).toEqual([
      '  units[0]: quote occurs 2 times in "uc.md"; carry it on into the unit\'s own text until it occurs once',
      '  units[1]: quote occurs 2 times in "uc.md"; carry it on into the unit\'s own text until it occurs once',
    ]);
    expect(readFileSync(join(project, '.excavator', 'doc-map.json'), 'utf-8')).toBe(before);
    const carried = runUnits(project, { units: [
      unit('uc.md', 'UC-01 Export Medications The provider exports.'),
      unit('uc.md', 'Roster View the roster. Options'),
      unit('uc.md', 'Roster View the roster. Assign Students'),
    ] });
    expect(carried.status, carried.stderr).toBe(0);
    expect(readProduct(project).units.map((recorded) => recorded.line)).toEqual([4, 6, 10]);
  });

  it('records an empty listing as zero units, and a new read leaves the units unlisted again', () => {
    const docs = tempDir('doc-map-docs-');
    const project = tempDir('doc-map-project-');
    write(docs, 'a.md', 'text');
    run(['read', docs, project]);
    expect(runUnits(project, { units: [] }).status).toBe(0);
    expect(readProduct(project)).toMatchObject({ units: [], counts: { units: 0 }, documents: [{ units: 0 }] });
    run(['read', docs, project]);
    expect(readProduct(project)).toMatchObject({ units: null, counts: { units: null }, documents: [{ units: null }] });
  });
});

describe('units: the fixed normalization', () => {
  const text = 'The provider\u2019s \u201caction\nplan\u201d \u2014 re\u00adview\u2026  \ufb01nal \uff21\uff22\uff23 cafe\u0301 zero\u200bwidth';

  it('matches across line breaks, curly quotes, dashes, soft hyphens, ligatures, full-width letters and accents', () => {
    const project = readFolder({ 'a.md': text });
    const result = runUnits(project, { units: [
      unit('a.md', 'The provider\'s "action plan" - review... final ABC caf\u00e9 zerowidth'),
    ] });
    expect(result.status, result.stderr).toBe(0);
    expect(readProduct(project).units[0]).toMatchObject({ line: 1 });
  });

  it('keeps case, and does not match a quote with a word changed', () => {
    const project = readFolder({ 'a.md': text });
    const result = runUnits(project, { units: [unit('a.md', 'the provider'), unit('a.md', 'The provider\'s "action list"')] });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('units[0]: quote not in "a.md": "the provider"');
    expect(result.stderr).toContain('units[1]: quote not in "a.md"');
  });

  it('places a quote that starts after a line break on the line where it starts', () => {
    const project = readFolder({ 'a.md': 'one\n\n  two three\nfour' });
    runUnits(project, { units: [unit('a.md', 'two three four')] });
    expect(readProduct(project).units[0].line).toBe(3);
  });
});

describe('units: every problem at once, and nothing recorded', () => {
  it('lists each failing unit with its reason and leaves the product as it was', () => {
    const project = readFolder({ 'uc.md': 'UC-01 Export\nUC10 Other\nUC-03 Hash\n', 'logo.png': 'png' });
    const before = readFileSync(join(project, '.excavator', 'doc-map.json'), 'utf-8');
    const result = runUnits(project, { units: [
      unit('uc.md', 'Import'),
      unit('uc.md', 'UC10 Other', { id: 'UC1' }),
      unit('missing.md', 'x'),
      unit('logo.png', 'x'),
      unit('uc.md', 'UC-01 Export', { title: ' ' }),
      unit('uc.md', 'UC-03', { id: '' }),
      { ...unit('uc.md', 'Hash'), kind: 'use case' },
      { document: 'uc.md', title: 't', quote: 'Export' },
      'UC-01',
      unit('uc.md', 'Export', { id: 'UC-03' }),
      unit('uc.md', 'UC-03 Hash', { id: 'UC-03' }),
      unit('uc.md', 'UC-01  Export'),
      unit('uc.md', ''),
    ] });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.split('\n').slice(1).filter(Boolean)).toEqual([
      '  units[0]: quote not in "uc.md": "Import"',
      '  units[1]: id "UC1" is not in "uc.md"',
      '  units[2]: document "missing.md" is not in the product',
      '  units[3]: document "logo.png" is unsupported, not read',
      '  units[4]: title must be a non-empty string',
      '  units[5]: id must be a non-empty string or null',
      '  units[6]: unknown keys kind',
      '  units[7]: missing keys id',
      '  units[8]: not an object',
      '  units[9]: quote repeats units[7]',
      '  units[10]: id "UC-03" repeats units[9]',
      '  units[11]: quote repeats units[4]',
      '  units[12]: title must be a non-empty string',
      '  units[12]: quote must be a non-empty string',
    ]);
    expect(result.stderr.split('\n')[0]).toMatch(/^doc-map: 14 problems in .*units\.json; nothing was recorded:$/);
    expect(readFileSync(join(project, '.excavator', 'doc-map.json'), 'utf-8')).toBe(before);
  });

  it('accepts an id that stands apart from the text around it, such as the end of a longer code', () => {
    const project = readFolder({ 'uc.md': 'EAAPS-UC-01 Export Medications' });
    expect(runUnits(project, { units: [unit('uc.md', 'Export Medications', { id: 'UC-01' })] }).status).toBe(0);
  });

  it('refuses a document whose text changed after read', () => {
    const project = readFolder({ 'a.md': 'original text' });
    writeFileSync(join(project, '.excavator/doc-map/text/a.md.txt'), 'edited text, longer');
    const result = runUnits(project, { units: [unit('a.md', 'original text')] });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('units[0]: document "a.md": its text changed after read; run read again');
  });

  it('refuses a units file that is not JSON or not the expected shape, and a project with no product', () => {
    const project = readFolder({ 'a.md': 'text' });
    const before = readFileSync(join(project, '.excavator', 'doc-map.json'), 'utf-8');
    expect(runUnits(project, '{ units: ').stderr).toContain('doc-map: the units file is not readable JSON');
    for (const listing of [[], { units: {} }, { units: [], extra: 1 }]) {
      const result = runUnits(project, listing);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('the units file must be an object with one key, "units", holding an array');
    }
    expect(readFileSync(join(project, '.excavator', 'doc-map.json'), 'utf-8')).toBe(before);
    const empty = tempDir('doc-map-project-');
    const none = runUnits(empty, { units: [] });
    expect(none.status).toBe(1);
    expect(none.stderr).toContain('run read first');
  });
});

const GIT_BINARY = join(execFileSync('git', ['--exec-path'], { encoding: 'utf-8' }).trim(), 'git');

/**
 * A project holding `code` ({ path: content }) and, in its docs/ folder, `docs`,
 * with `units` read and recorded.
 */
function linkProject({ docs = {}, code = {}, units = [] } = {}) {
  const project = tempDir('doc-map-project-');
  for (const [path, content] of Object.entries(docs)) write(project, `docs/${path}`, content);
  for (const [path, content] of Object.entries(code)) write(project, path, content);
  expect(run(['read', join(project, 'docs'), project]).status).toBe(0);
  const result = runUnits(project, { units });
  expect(result.status, result.stderr).toBe(0);
  return project;
}

function runLink(project, listing, options) {
  const file = join(tempDir('doc-map-links-'), 'links.json');
  writeFileSync(file, typeof listing === 'string' ? listing : JSON.stringify(listing));
  return run(['link', file, project], options);
}

const found = (number, ...evidence) => ({
  unit: number, status: 'found', evidence: evidence.map(([file, code]) => ({ file, code })), searched: [],
});
const notFound = (number, ...searched) => ({ unit: number, status: 'not-found', evidence: [], searched });

const USE_CASES = 'UC-01 Add prescription\nThe doctor adds one.\nUC-02 Print\nPrints it.\nUC-03 Fax\nFaxes it.\n';
const THREE_UNITS = [
  unit('uc.md', 'UC-01 Add prescription', { id: 'UC-01' }),
  unit('uc.md', 'UC-02 Print', { id: 'UC-02' }),
  unit('uc.md', 'UC-03 Fax', { id: 'UC-03' }),
];
const RX = 'class Rx {\n  @Override public void addPrescription(String drug,\n      int days) {\n    save(drug);\n  }\n}\n';

describe('link: recorded with the line the script finds', () => {
  it('gives each piece of evidence its line, marks a unit left out not-checked, and counts the statuses', () => {
    const project = linkProject({
      docs: { 'uc.md': USE_CASES },
      code: { 'src/Rx.java': RX },
      units: THREE_UNITS,
    });
    const result = runLink(project, { links: [
      found(1, ['src/Rx.java', 'public void addPrescription(String drug, int days)'], ['./src/Rx.java', 'save(drug);']),
      notFound(2, 'grep -ri "print" web/', 'PrintAction'),
    ] });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('doc-map: 3 units: 1 found, 1 not found, 1 not checked\n');
    const product = readProduct(project);
    expect(product.units.map((recorded) => recorded.code)).toEqual([
      {
        status: 'found',
        evidence: [
          { file: 'src/Rx.java', code: 'public void addPrescription(String drug, int days)', line: 2 },
          { file: './src/Rx.java', code: 'save(drug);', line: 4 },
        ],
        searched: [],
      },
      { status: 'not-found', evidence: [], searched: ['grep -ri "print" web/', 'PrintAction'] },
      { status: 'not-checked', evidence: [], searched: [] },
    ]);
    expect(product.counts).toMatchObject({ units: 3, found: 1, notFound: 1, notChecked: 1 });
    expect(product.code).toEqual({ root: project, revision: null });
    expect(Object.keys(product)).toEqual(['format', 'docsRoot', 'converters', 'code', 'counts', 'residualAssumptions', 'documents', 'units', 'coverage']);
  });

  it('reads a file that is not UTF-8 as Latin-1, and matches code across line breaks and spacing', () => {
    const project = linkProject({
      docs: { 'uc.md': USE_CASES },
      code: { 'legacy/Fax.java': Buffer.from('// caf\u00e9 fax\nclass  Fax\n{ }\n', 'latin1') },
      units: THREE_UNITS,
    });
    const result = runLink(project, { links: [found(3, ['legacy/Fax.java', 'caf\u00e9 fax class Fax'])] });
    expect(result.status, result.stderr).toBe(0);
    expect(readProduct(project).units[2].code.evidence).toEqual([{ file: 'legacy/Fax.java', code: 'caf\u00e9 fax class Fax', line: 1 }]);
  });

  it('records the commit at HEAD of a Git project, and null for a folder that is not one', () => {
    const bin = toolDir();
    symlinkSync(GIT_BINARY, join(bin, 'git'));
    const project = linkProject({ docs: { 'uc.md': USE_CASES }, code: { 'src/Rx.java': RX }, units: THREE_UNITS });
    expect(runLink(project, { links: [] }, { bin }).status).toBe(0);
    expect(readProduct(project).code.revision).toBeNull();
    const env = { PATH: bin, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    execFileSync('git', ['init', '-q'], { cwd: project, env });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'x'], { cwd: project, env });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, env, encoding: 'utf-8' }).trim();
    expect(runLink(project, { links: [] }, { bin }).status).toBe(0);
    expect(readProduct(project).code.revision).toBe(head);
    expect(readProduct(project).counts).toMatchObject({ found: 0, notFound: 0, notChecked: 3 });
  });

  it('clears the code when the units are recorded again or the documents are read again', () => {
    const project = linkProject({ docs: { 'uc.md': USE_CASES }, code: { 'src/Rx.java': RX }, units: THREE_UNITS });
    expect(runLink(project, { links: [found(1, ['src/Rx.java', 'class Rx'])] }).status).toBe(0);
    expect(runUnits(project, { units: THREE_UNITS }).status).toBe(0);
    let product = readProduct(project);
    expect(product.code).toBeNull();
    expect(product.units.map((recorded) => recorded.code)).toEqual([null, null, null]);
    expect(product.counts).toMatchObject({ units: 3, found: null, notFound: null, notChecked: null });
    expect(runLink(project, { links: [found(1, ['src/Rx.java', 'class Rx'])] }).status).toBe(0);
    expect(run(['read', join(project, 'docs'), project]).status).toBe(0);
    product = readProduct(project);
    expect(product).toMatchObject({ code: null, units: null, counts: { units: null, found: null, notFound: null, notChecked: null } });
  });
});

describe('link: every problem at once, and nothing recorded', () => {
  it('refuses evidence that is not a code file of the project, and code that is not there exactly once', () => {
    const outside = tempDir('doc-map-outside-');
    write(outside, 'app.js', 'function outside() {}\n');
    const spec = '<html><body><h1>UC-01 Add prescription</h1></body></html>\n';
    const project = linkProject({
      docs: { 'uc.md': USE_CASES, 'spec.html': spec },
      code: {
        'src/Rx.java': RX,
        'src/eq.js': 'if (a === b) { go(); }\n',
        'README.md': 'class Rx\n',
        'notes.TXT': 'class Rx\n',
        'site/spec.html': spec,
        '.git/config': '[core]\n',
        'sub/.git/HEAD': 'ref\n',
      },
      units: [...THREE_UNITS, unit('spec.html', 'UC-01 Add prescription', { id: 'UC-01' })],
    });
    symlinkSync(join(outside, 'app.js'), join(project, 'src', 'linked.js'));
    const before = readFileSync(join(project, '.excavator', 'doc-map.json'), 'utf-8');
    const evidence = (...pairs) => ({ unit: 1, status: 'found', evidence: pairs.map(([file, code]) => ({ file, code })), searched: [] });
    const result = runLink(project, { links: [
      evidence(
        [join(project, 'src/Rx.java'), 'class Rx'],
        ['../outside/app.js', 'function outside'],
        ['src/linked.js', 'function outside'],
        ['src', 'class Rx'],
        ['.git/config', '[core]'],
        ['sub/.git/HEAD', 'ref'],
        ['.excavator/doc-map/text/uc.md.txt', 'UC-01'],
        ['docs/spec.html', 'UC-01'],
        ['README.md', 'class Rx'],
        ['notes.TXT', 'class Rx'],
        ['site/spec.html', 'UC-01 Add prescription'],
        ['src/missing.java', 'class Rx'],
        ['src/Rx.java', 'class Rx {  void remove'],
        ['src/Rx.java', 'drug'],
        ['src/eq.js', '=='],
      ),
    ] });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.split('\n').slice(1).filter(Boolean)).toEqual([
      `  links[0].evidence[0]: file ${JSON.stringify(join(project, 'src/Rx.java').slice(0, 80) + '...')} is not a path relative to the project`,
      '  links[0].evidence[1]: file "../outside/app.js" is outside the project',
      '  links[0].evidence[2]: file "src/linked.js" is outside the project',
      '  links[0].evidence[3]: file "src" is not a file',
      '  links[0].evidence[4]: file ".git/config" is in .git',
      '  links[0].evidence[5]: file "sub/.git/HEAD" is in .git',
      '  links[0].evidence[6]: file ".excavator/doc-map/text/uc.md.txt" is in .excavator',
      '  links[0].evidence[7]: file "docs/spec.html" is in the documents folder',
      '  links[0].evidence[8]: file "README.md" is a document (.md), not code',
      '  links[0].evidence[9]: file "notes.TXT" is a document (.txt), not code',
      '  links[0].evidence[10]: file "site/spec.html" has the same content as a document in the documents folder',
      '  links[0].evidence[11]: file "src/missing.java" is not a file',
      '  links[0].evidence[12]: code not in "src/Rx.java": "class Rx {  void remove"',
      '  links[0].evidence[13]: code occurs 2 times in "src/Rx.java"; copy a passage that occurs once',
      '  links[0].evidence[14]: code occurs 2 times in "src/eq.js"; copy a passage that occurs once',
    ]);
    expect(result.stderr.split('\n')[0]).toMatch(/^doc-map: 15 problems in .*links\.json; nothing was recorded:$/);
    expect(readFileSync(join(project, '.excavator', 'doc-map.json'), 'utf-8')).toBe(before);
  });

  it('refuses entries whose unit, status, evidence or searches do not fit', () => {
    const numbers = Array.from({ length: 15 }, (_, at) => `F${String(at + 1).padStart(2, '0')}`);
    const project = linkProject({
      docs: { 'f.md': numbers.map((id) => `${id} step\n`).join('') },
      code: { 'src/Rx.java': RX },
      units: numbers.map((id) => unit('f.md', `${id} step`, { id })),
    });
    const before = readFileSync(join(project, '.excavator', 'doc-map.json'), 'utf-8');
    const rx = ['src/Rx.java', 'class Rx'];
    const result = runLink(project, { links: [
      'UC-01',
      { unit: 1, status: 'found', evidence: [{ file: 'src/Rx.java', code: 'class Rx' }] },
      { ...found(2, rx), why: 'name' },
      found(0, rx),
      found(16, rx),
      found('3', rx),
      found(true, rx),
      found(4, rx),
      found(4, rx),
      { unit: 5, status: 'implemented', evidence: [], searched: [] },
      { unit: 6, status: 'found', evidence: [], searched: ['x'] },
      { unit: 7, status: 'not-found', evidence: [{ file: 'src/Rx.java', code: 'class Rx' }], searched: ['x'] },
      notFound(8, ' '),
      { unit: 9, status: 'not-found', evidence: {}, searched: 'x' },
      { unit: 10, status: 'found', evidence: ['src/Rx.java', { file: 'src/Rx.java' }, { file: '', code: 'class Rx', line: 1 }, { file: 'src/Rx.java', code: ' ' }], searched: [] },
    ] });
    expect(result.status).toBe(1);
    expect(result.stderr.split('\n').slice(1).filter(Boolean)).toEqual([
      '  links[0]: not an object',
      '  links[1]: missing keys searched',
      '  links[1]: searched must be an array of strings',
      '  links[2]: unknown keys why',
      '  links[3]: unit must be a unit number from 1 to 15',
      '  links[4]: unit must be a unit number from 1 to 15',
      '  links[5]: unit must be a unit number from 1 to 15',
      '  links[6]: unit must be a unit number from 1 to 15',
      '  links[8]: unit 4 repeats links[7]',
      '  links[9]: status must be "found" or "not-found"',
      '  links[10]: found needs at least one piece of evidence',
      '  links[11]: not-found takes no evidence',
      '  links[12]: not-found needs the searches that were run',
      '  links[13]: evidence must be an array',
      '  links[13]: searched must be an array of strings',
      '  links[13]: not-found needs the searches that were run',
      '  links[14].evidence[0]: not an object',
      '  links[14].evidence[1]: missing keys code',
      '  links[14].evidence[1]: code must be a non-empty string',
      '  links[14].evidence[2]: unknown keys line',
      '  links[14].evidence[2]: file must be a non-empty string',
      '  links[14].evidence[3]: code must be a non-empty string',
    ]);
    expect(readFileSync(join(project, '.excavator', 'doc-map.json'), 'utf-8')).toBe(before);
  });

  it('refuses a links file of the wrong shape, and a product whose units are not recorded yet', () => {
    const project = linkProject({ docs: { 'uc.md': USE_CASES }, units: THREE_UNITS });
    expect(runLink(project, '{ links: ').stderr).toContain('doc-map: the links file is not readable JSON');
    for (const listing of [[], { links: {} }, { links: [], units: [] }]) {
      const result = runLink(project, listing);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('the links file must be an object with one key, "links", holding an array');
    }
    expect(run(['read', join(project, 'docs'), project]).status).toBe(0);
    const early = runLink(project, { links: [] });
    expect(early.status).toBe(1);
    expect(early.stderr).toContain('no units are recorded yet; run units first');
    expect(run(['link', project]).status).toBe(2);
  });
});

/**
 * The facts /excavator writes, as `coverage` reads them: a fact graph whose
 * first line is the header and whose file nodes are `files`, with a function
 * node and an edge around them, and a source manifest.
 */
function writeFacts(project, files, { format = 'excavator-knowledge-graph-lines/1', nodes, digest = 'digest-1', revision = 'git:abc', manifest = true } = {}) {
  const records = [
    ...files.map((filePath) => ({ record: 'node', node: { id: `file:${filePath}`, type: 'file', name: filePath, filePath } })),
    { record: 'node', node: { id: 'function:Main.java:main', type: 'function', name: 'main', filePath: 'Main.java', lineRange: [1, 2] } },
    { record: 'edge', edge: { source: 'file:Main.java', target: 'function:Main.java:main', type: 'contains' } },
  ];
  const header = {
    record: 'header', format, keys: ['nodes', 'edges', 'factsDigest'], fields: { factsDigest: digest },
    counts: { nodes: nodes ?? files.length + 1, edges: 1 },
  };
  write(project, '.excavator/intermediate/fact-graph.jsonl', `${[header, ...records].map((record) => JSON.stringify(record)).join('\n')}\n`);
  if (manifest) write(project, '.excavator/source-manifest.json', JSON.stringify({ sourceRevision: revision, entries: [] }));
}

const SPEC = '<html><body><h1>Prescriptions</h1></body></html>\n';
const COVERED = {
  docs: { 'uc.md': USE_CASES, 'spec.html': SPEC },
  code: {
    'README.md': '# Rx\n',
    'web/spec.html': SPEC,
    'web/page.html': '<html><body>page</body></html>\n',
    'src/rx/Rx.java': RX,
    'src/rx/RxPrint.java': 'class RxPrint {\n  void print() {}\n}\n',
    'src/billing/Bill.java': 'class Bill {}\n',
    'src/billing/tax/Tax.java': 'class Tax {}\n',
    'Main.java': 'class Main {}\n',
    'gen/Generated.java': 'class Generated { void fax() {} }\n',
  },
  units: THREE_UNITS,
};
const FACT_FILES = [
  'docs/uc.md', 'docs/spec.html', 'README.md', 'web/spec.html', 'web/page.html', 'src/rx/Rx.java', 'src/rx/RxPrint.java',
  'src/billing/Bill.java', 'src/billing/tax/Tax.java', 'Main.java',
];

/** A project of `COVERED` with three units tied to code: unit 3's only evidence is in a file the facts leave out. */
function coveredProject() {
  const project = linkProject(COVERED);
  const result = runLink(project, { links: [
    found(1, ['src/rx/Rx.java', 'public void addPrescription(String drug, int days)'], ['./src/rx/Rx.java', 'save(drug);']),
    found(2, ['src//rx/RxPrint.java', 'void print()']),
    found(3, ['gen/Generated.java', 'void fax()']),
  ] });
  expect(result.status, result.stderr).toBe(0);
  writeFacts(project, FACT_FILES);
  return project;
}

describe('coverage: every file the facts list is in one place', () => {
  it('splits documents from code files with and without evidence, lists evidence outside them, and counts each directory', () => {
    const project = coveredProject();
    const result = run(['coverage', project]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('doc-map: 10 files analysed: 4 documents, 6 code files, 2 with evidence, 4 without; '
      + '4 pieces of evidence, 1 not in a code file\n');
    const product = readProduct(project);
    expect(Object.keys(product)).toEqual(['format', 'docsRoot', 'converters', 'code', 'counts', 'residualAssumptions', 'documents', 'units', 'coverage']);
    expect(product.coverage).toEqual({
      sourceRevision: 'git:abc',
      factsDigest: 'digest-1',
      counts: { files: 10, documents: 4, code: 6, withEvidence: 2, withoutEvidence: 4, evidence: 4, outside: 1 },
      documents: ['README.md', 'docs/spec.html', 'docs/uc.md', 'web/spec.html'],
      outside: [{ unit: 3, file: 'gen/Generated.java', line: 1 }],
      directories: [
        { path: '.', files: 6, withEvidence: 2, units: [1, 2] },
        { path: 'src', files: 4, withEvidence: 2, units: [1, 2] },
        { path: 'src/billing', files: 2, withEvidence: 0, units: [] },
        { path: 'src/billing/tax', files: 1, withEvidence: 0, units: [] },
        { path: 'src/rx', files: 2, withEvidence: 2, units: [1, 2] },
        { path: 'web', files: 1, withEvidence: 0, units: [] },
      ],
      files: [
        { path: 'Main.java', units: [] },
        { path: 'src/billing/Bill.java', units: [] },
        { path: 'src/billing/tax/Tax.java', units: [] },
        { path: 'src/rx/Rx.java', units: [1] },
        { path: 'src/rx/RxPrint.java', units: [2] },
        { path: 'web/page.html', units: [] },
      ],
    });
  });

  it('counts a file whose size matches a document but whose content differs as code', () => {
    const project = linkProject({ docs: { 'uc.md': USE_CASES }, code: { 'web/same-size.js': 'x'.repeat(Buffer.byteLength(USE_CASES)) }, units: THREE_UNITS });
    expect(runLink(project, { links: [] }).status).toBe(0);
    writeFacts(project, ['web/same-size.js']);
    expect(run(['coverage', project]).status).toBe(0);
    expect(readProduct(project).coverage.counts).toMatchObject({ files: 1, documents: 0, code: 1, withoutEvidence: 1 });
  });

  it('clears the coverage when the code is linked again, the units recorded again or the documents read again', () => {
    const project = coveredProject();
    const countThen = (step) => {
      expect(runLink(project, { links: [] }).status).toBe(0);
      expect(run(['coverage', project]).status).toBe(0);
      expect(readProduct(project).coverage).not.toBeNull();
      expect(step().status).toBe(0);
      expect(readProduct(project).coverage).toBeNull();
    };
    countThen(() => runLink(project, { links: [] }));
    countThen(() => runUnits(project, { units: THREE_UNITS }));
    countThen(() => run(['read', join(project, 'docs'), project]));
  });
});

describe('coverage: refused with a reason, and nothing written', () => {
  it('refuses before the code is linked, without facts, and with facts it cannot trust', () => {
    const project = linkProject(COVERED);
    const refused = (message) => {
      const before = readFileSync(join(project, '.excavator', 'doc-map.json'));
      const result = run(['coverage', project]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(message);
      expect(readFileSync(join(project, '.excavator', 'doc-map.json'))).toEqual(before);
    };
    writeFacts(project, FACT_FILES);
    refused('no code is recorded yet; run link first');
    expect(runLink(project, { links: [] }).status).toBe(0);
    rmSync(join(project, '.excavator', 'intermediate'), { recursive: true });
    refused('fact-graph.jsonl is missing; run /excavator --mode=lazy on the project first');
    writeFacts(project, FACT_FILES, { manifest: false });
    rmSync(join(project, '.excavator', 'source-manifest.json'));
    refused('source-manifest.json is missing; run /excavator --mode=lazy on the project first');
    writeFacts(project, FACT_FILES, { revision: '' });
    refused('source-manifest.json has no sourceRevision');
    writeFacts(project, FACT_FILES, { format: 'excavator-knowledge-graph/0' });
    refused('does not start with a "excavator-knowledge-graph-lines/1" header');
    writeFacts(project, FACT_FILES, { nodes: 12 });
    refused('has 11 node records, its header says 12');
    writeFacts(project, FACT_FILES, { digest: '' });
    refused('has no factsDigest');
    writeFacts(project, [...FACT_FILES, './src//rx/Rx.java']);
    refused('has two file nodes for src/rx/Rx.java');
    writeFacts(project, [...FACT_FILES, '../outside.java']);
    refused("has a file node with the path '../outside.java'");
    write(project, '.excavator/intermediate/fact-graph.jsonl', '');
    refused('fact-graph.jsonl is empty');
    expect(run(['coverage', project, 'extra']).status).toBe(2);
  });
});
