/**
 * The checks of a chapter (openspec change handbook-free-chapter D3, D4, D7):
 * every citation resolves to lines of a project file, and every item's own text
 * keeps its numbers, quoted texts, code-shaped words, advice words and language
 * within what its own citations say. Returns every problem in one run, the
 * items with their citations resolved to `{ file, lines: [a, b], passage }`
 * (the record later steps work from), and the counts check-chapter prints.
 *
 * Content findings are notes, not refusals (scope of this slice; fabrication is fixed in a later change).
 *
 * The checked text of an item is its own words: without the citation groups,
 * the heading path and a table's header cells. A heading is checked against
 * the citations it borrows from the items under it.
 */

import { bannedFragments, outsideLabels } from './banned-words.mjs';
import { parseSpec, specKey } from './chapter-cites.mjs';
import { parseChapter } from './chapter-parse.mjs';
import { wordsIn } from './word-lists.mjs';
import { narrativeProblem } from './narrative.mjs';
import { labelOccurs, missingNumbers } from './values.mjs';

export const MAX_CITED_LINES = 80;
const QUOTES = [/\u201c([^\u201d]+)\u201d/g, /"([^"]+)"/g, /\u300c([^\u300d]+)\u300d/g];

const lineCount = (lines) => (lines[lines.length - 1] === '' && lines.length > 1 ? lines.length - 1 : lines.length);

/** `{ cite }` or `{ problem }` for one spec; `files` is the project reader (project-files.mjs). */
function resolveSpec(spec, files) {
  const parsed = parseSpec(spec);
  if (parsed.problem !== undefined) return parsed;
  const { file, a, b } = parsed;
  const read = files.resolve(file);
  if (!read.ok) return { problem: `citation \`${spec}\`: ${file} ${read.reason}` };
  const lines = read.text.replace(/\r\n?/g, '\n').split('\n');
  const count = lineCount(lines);
  if (a < 1 || b < a || b > count) return { problem: `citation \`${spec}\`: lines ${a}-${b} are not inside ${file}, which has ${count} lines (1 <= a <= b <= ${count})` };
  if (b - a + 1 > MAX_CITED_LINES) return { problem: `citation \`${spec}\`: ${b - a + 1} lines; cite at most ${MAX_CITED_LINES}, a narrower range` };
  return { cite: { file, lines: [a, b], passage: lines.slice(a - 1, b).join('\n') } };
}

/** The quoted texts of `text`. */
const quotedTexts = (text) => QUOTES.flatMap((pattern) => Array.from(text.matchAll(pattern), (match) => match[1]));

function itemProblems(item, cites, { memberDirs, languageCheck, adviceWords }) {
  const lines = [];
  const passages = cites.map((cite) => cite.passage);
  const where = [...new Set(cites.map((cite) => `${cite.file}:${cite.lines[0]}-${cite.lines[1]}`))].join(', ') || 'no citation';
  const labels = new Set();
  if (cites.length === 0) return lines;
  for (const number of missingNumbers(item.own, passages)) lines.push({ kind: 'number', detail: `number ${number} does not occur in the passages of its citations (${where})` });
  for (const quoted of quotedTexts(item.own)) {
    if (labelOccurs(quoted, passages)) labels.add(quoted);
    else lines.push({ kind: 'quote', detail: `the quoted text ${JSON.stringify(quoted)} does not occur in the passages of its citations (${where})` });
  }
  for (const hit of outsideLabels(bannedFragments(item.own, { memberDirs }), item.own, labels)) {
    lines.push({ kind: 'code', detail: `${JSON.stringify(hit.fragment)} is not allowed in reader text (${hit.category}); write it in plain words` });
  }
  const advice = wordsIn(item.own, adviceWords)[0];
  if (advice !== undefined) lines.push({ kind: 'advice', detail: `${JSON.stringify(advice)} is a word of advice; describe what the product does, not what to change` });
  const wrongLanguage = languageCheck === null ? null : narrativeProblem(item.own, labels, languageCheck.language);
  if (wrongLanguage !== null) lines.push({ kind: 'language', detail: wrongLanguage });
  return lines;
}

/**
 * Check chapter text `source`. `ctx`: `files` (project-files.mjs), `memberDirs`,
 * `languageCheck` (`{ language }` or null) and `adviceWords` (the run's list).
 * Returns `{ problems, notes, noteLines, items, counts }`: `problems` are structural and refuse the chapter; the content checks
 * (numbers, quoted texts, code-shaped words, advice words, language) only produce `notes`, recorded `{ id, kind, detail }`.
 */
export function checkChapter(source, { files, memberDirs = [], languageCheck = null, adviceWords = [] }) {
  const parsed = parseChapter(source);
  const problems = [...parsed.problems];
  const notes = [];
  const byKey = new Map();
  const resolved = new Map();
  for (const item of parsed.items) {
    const cites = [];
    for (const spec of item.raw) {
      const key = specKey(spec);
      if (!byKey.has(key)) byKey.set(key, resolveSpec(spec, files));
      const result = byKey.get(key);
      if (result.cite !== undefined) cites.push(result.cite);
      else if (item.kind !== 'heading') problems.push(`${item.id} (line ${item.line}): ${result.problem}`);
    }
    resolved.set(item.id, cites);
    for (const note of itemProblems(item, cites, { memberDirs, languageCheck, adviceWords })) notes.push({ id: item.id, kind: note.kind, detail: note.detail, itemKind: item.kind, line: item.line });
  }
  if (parsed.diagrams.arrows === 0 && parsed.noDiagram === null) {
    problems.push('every chapter needs a sequence diagram with at least one arrow, or one line <!-- no-diagram: <reason> --> that says why there is none');
  }
  const items = parsed.items.map((item) => ({ id: item.id, kind: item.kind, text: item.text, claim: item.claim, own: item.own, cites: resolved.get(item.id) }));
  const count = (kind) => parsed.items.filter((item) => item.kind === kind).length;
  const counts = {
    sentences: count('sentence'),
    rows: count('row'),
    citations: items.filter((item) => item.kind !== 'heading').reduce((sum, item) => sum + item.cites.length, 0),
    diagrams: parsed.diagrams.count,
    arrows: parsed.diagrams.arrows,
  };
  return { problems, notes: notes.map(({ id, kind, detail }) => ({ id, kind, detail })), noteLines: notes.map((note) => `note: ${note.id} (${note.itemKind}, line ${note.line}) ${note.kind}: ${note.detail}`), items, counts };
}

const NOTE_KINDS = ['number', 'quote', 'code', 'advice', 'language'];

/** The summary line of the notes, one count per kind. */
export const notesLine = (notes) => `Notes: ${notes.length} (${NOTE_KINDS.map((kind) => `${kind} ${notes.filter((note) => note.kind === kind).length}`).join(', ')})`;

/** The counts line check-chapter prints. */
export const countsLine = (counts) => `Chapter: ${counts.sentences} sentences, ${counts.rows} table rows, ${counts.citations} citations, ${counts.diagrams} diagrams, ${counts.arrows} arrows`;
