/**
 * doc-map.py (openspec: changes/doc-map-read, capability `doc-map`).
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
    expect(product.counts).toEqual({ files: 4, read: 1, empty: 1, noConverter: 0, unsupported: 1, failed: 1, units: null });
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
    write(docs, 'a.md', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# 用例\r\nline two\r\n')]));
    write(docs, 'latin.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    run(['read', docs, project]);
    const product = readProduct(project);
    expect(textOf(project, 'a.md')).toBe('# 用例\nline two\n');
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
    expect(Object.keys(product)).toEqual(['format', 'docsRoot', 'converters', 'counts', 'residualAssumptions', 'documents', 'units']);
    expect(product.format).toBe('excavator-doc-map/1');
    expect(product.docsRoot).toBe(docs);
    expect(product.units).toBeNull();
    expect(product.residualAssumptions.join(' ')).toContain("Which passages are units is the model's judgement");
    expect(product.residualAssumptions.join(' ')).toContain('are not in the text, so a unit numbered that way has no id');
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
  it('gives each unit its line, its page in a PDF and its occurrences, and counts units per document', () => {
    const project = readFolder({
      'uc.md': '# Use cases\nUC-01 Export Medications\nThe provider exports.\nUC-02 Generate hash\nExport Medications again\n',
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
      { document: 'uc.md', id: 'UC-01', title: 'Export medications', quote: 'Export Medications', line: 2, page: null, occurrences: 2 },
      { document: 'uc.md', id: 'UC-02', title: 'UC-02 Generate hash', quote: 'UC-02 Generate hash', line: 4, page: null, occurrences: 1 },
      { document: 'srs.pdf', id: 'UC1', title: 'Complete Assessment', quote: 'Complete Assessment', line: 1, page: 2, occurrences: 1 },
      { document: 'srs.pdf', id: 'UC2', title: 'UC2: Manage', quote: 'UC2: Manage', line: 2, page: 3, occurrences: 1 },
    ]);
    expect(product.counts.units).toBe(4);
    expect(product.documents.map((row) => [row.path, row.units])).toEqual([
      ['logo.png', null], ['other.md', 0], ['srs.pdf', 2], ['uc.md', 2],
    ]);
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
  const text = 'The provider’s “action\nplan” — re­view…  ﬁnal ＡＢＣ café zero​width';

  it('matches across line breaks, curly quotes, dashes, soft hyphens, ligatures, full-width letters and accents', () => {
    const project = readFolder({ 'a.md': text });
    const result = runUnits(project, { units: [
      unit('a.md', 'The provider\'s "action plan" - review... final ABC café zerowidth'),
    ] });
    expect(result.status, result.stderr).toBe(0);
    expect(readProduct(project).units[0]).toMatchObject({ line: 1, occurrences: 1 });
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
