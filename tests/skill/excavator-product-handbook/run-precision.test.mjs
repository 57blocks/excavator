// O1 of openspec change handbook-run-precision: each decision has a positive and a negative case.
// D1 advice words, D2 JavaScript workspaces, D3 entity-decoded quotes, D4 quote locations,
// D6 feature numbers in headings, D7 comment lines are no candidates.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { checkChapter } from '../../../skills/excavator-product-handbook/lib/chapter-check.mjs';
import { listEntrypoints } from '../../../skills/excavator-product-handbook/lib/entrypoints.mjs';
import { projectFiles } from '../../../skills/excavator-product-handbook/lib/project-files.mjs';
import { decodeEntities, labelOccurs } from '../../../skills/excavator-product-handbook/lib/values.mjs';
import { adviceWordsOf, wordsIn } from '../../../skills/excavator-product-handbook/lib/word-lists.mjs';
import { runHandbook } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

function project(files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'xhb-prec-')));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const shipped = JSON.parse(readFileSync(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url), 'utf-8')).strings;

describe('D1: the advice words', () => {
  const words = adviceWordsOf(shipped);
  it('no longer flag the words of a rule statement', () => {
    expect(wordsIn('The password must be 8 characters; a sign-in needs to happen first; you need to log in.', words)).toEqual([]);
  });
  it('still flag a recommendation', () => {
    expect(wordsIn('The team should check the role.', words)).toEqual(['should']);
    expect(wordsIn('We recommend a second check.', words)).toEqual(['recommend']);
  });
});

describe('D2: JavaScript workspaces', () => {
  const roots = (root) => {
    const result = runHandbook(['applications', root]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    return result.lines.slice(1).map((line) => line.split('\t')[0]);
  };
  const members = { 'frontend/package.json': '{}\n', 'backend/package.json': '{}\n', 'packages/contracts/package.json': '{}\n', 'packages/contracts/sub/package.json': '{}\n' };

  it('pnpm-workspace.yaml: the members are the applications, the root is not', () => {
    const root = project({ 'package.json': '{}\n', 'pnpm-workspace.yaml': 'packages:\n  - "*"\n', ...members });
    expect(roots(root)).toEqual(['backend', 'frontend', 'packages/contracts']);
  });
  it('package.json workspaces as an array', () => {
    const root = project({ 'package.json': '{"workspaces":["frontend","backend","packages/*"]}\n', ...members });
    expect(roots(root)).toEqual(['backend', 'frontend', 'packages/contracts']);
  });
  it('package.json workspaces as an object with packages', () => {
    const root = project({ 'package.json': '{"workspaces":{"packages":["frontend"]}}\n', ...members });
    expect(roots(root)).toEqual(['backend', 'frontend', 'packages/contracts']);
  });
  it('a workspace root without members stays an application', () => {
    expect(roots(project({ 'package.json': '{"workspaces":["x"]}\n', 'src/a.js': 'x\n' }))).toEqual(['.']);
    expect(roots(project({ 'package.json': '{}\n', 'pnpm-workspace.yaml': 'packages: []\n' }))).toEqual(['.']);
  });
  it('without a declaration the topmost manifest directory is the application, as before', () => {
    expect(roots(project({ 'package.json': '{"workspaces":"no"}\n', ...members }))).toEqual(['.']);
    expect(roots(project({ 'package.json': '{ not json', ...members }))).toEqual(['.']);
  });
});

describe('D3: entities and white space in quotes', () => {
  it('decodes named and numeric references', () => {
    expect(decodeEntities('A &amp; B &#39;x&#39; &#x41; &unknown; &#0;')).toBe("A & B 'x' A &unknown; &#0;");
  });
  it('matches across entities and line breaks; case still counts', () => {
    expect(labelOccurs('Privacy & Terms', ['<a>Privacy &amp; Terms</a>'])).toBe(true);
    expect(labelOccurs("it's here", ['it&#39;s   here'])).toBe(true);
    expect(labelOccurs('Privacy & Terms', ['Privacy &\n   Terms'])).toBe(true);
    expect(labelOccurs('privacy & terms', ['Privacy &amp; Terms'])).toBe(false);
  });
});

describe('D4, D6: the notes of a chapter', () => {
  const root = () => project({
    'src/a.js': 'const a = 1;\nconst title = "Privacy &amp; Terms";\n',
    'src/b.js': 'one\ntwo\nconst label = "Cancel order";\nlast\n',
    'src/c.js': 'first\nlater: Cancel order again\n',
  });
  const chapter = (heading, sentence) => `# ${heading}\n\n${sentence}\n\n<!-- no-diagram: none -->\n`;
  const notesOf = (dir, source) => checkChapter(source, { files: projectFiles(dir) }).notes;

  it('a quote with an entity in its cited line gives no note', () => {
    expect(notesOf(root(), chapter('Terms', 'The page shows "Privacy & Terms" (`src/a.js:2`).'))).toEqual([]);
  });
  it('a quote that is in another line of the cited file says where, the cited file first', () => {
    const [note] = notesOf(root(), chapter('Terms', 'The button reads "Cancel order" (`src/a.js:1`).'));
    expect(note.kind).toBe('quote');
    expect(note.detail).toContain('it first occurs at src/b.js:3');
    const [own] = notesOf(root(), chapter('Terms', 'The button reads "Cancel order" (`src/c.js:1`).'));
    expect(own.detail).toContain('it first occurs at src/c.js:2');
  });
  it('a document is never named, and source code comes before other files', () => {
    const dir = project({
      'README.md': 'Say Hello world here\n',
      'notes.txt': 'Hello world\n',
      'a-mock.json': '{"t": "Hello world"}\n',
      'src/z.js': 'x\nconst t = "Hello world";\n',
      'src/a.js': 'const a = 1;\n',
    });
    const [note] = notesOf(dir, chapter('Terms', 'It reads "Hello world" (`src/a.js:1`).'));
    expect(note.detail).toContain('it first occurs at src/z.js:2');
    const docOnly = project({ 'README.md': 'Only here\n', 'src/a.js': 'const a = 1;\n' });
    const [none] = notesOf(docOnly, chapter('Terms', 'It reads "Only here" (`src/a.js:1`).'));
    expect(none.detail).toContain('that text does not occur in any file of the project');
  });
  it('a quote that is nowhere says so with the fixed text', () => {
    const [note] = notesOf(root(), chapter('Terms', 'The button reads "Nothing like it" (`src/a.js:1`).'));
    expect(note.detail).toContain('that text does not occur in any file of the project');
  });
  it('a feature number in a level-1 heading is no number; 12 in the text still is', () => {
    const dir = root();
    expect(notesOf(dir, chapter('F12 Orders', 'It shows "Cancel order" (`src/b.js:3`).'))).toEqual([]);
    const [note] = notesOf(dir, chapter('F12 Orders', 'It shows 12 orders and "Cancel order" (`src/b.js:3`).'));
    expect(note.kind).toBe('number');
    expect(note.detail).toContain('number 12');
  });
  it('a number in a level-2 heading is still checked', () => {
    const source = '# Orders\n\n## F12 part\n\nIt shows "Cancel order" (`src/b.js:3`).\n\n<!-- no-diagram: none -->\n';
    expect(notesOf(root(), source).some((note) => note.kind === 'number')).toBe(true);
  });
});

describe('D7: comment lines are no entrypoint candidates', () => {
  const listed = async (code) => {
    const root = project({ 'package.json': '{"dependencies":{"express":"4"}}\n', 'src/app.js': code });
    const listing = await listEntrypoints(root, { useGraph: false });
    return listing.items.map((item) => `${item.line}`);
  };
  it('a real route is a candidate; the same text after //, /* or * is not', async () => {
    const code = [
      "app.get('/real', handler);",
      "// app.get('/line', handler);",
      "  /* app.get('/block', handler);",
      " * app.get('/star', handler);",
      "const x = 1; // app.get('/trailing', handler)",
    ].join('\n');
    expect(await listed(code)).toEqual(['1', '5']);
  });
});
