/**
 * The final check of a Markdown chapter (openspec change handbook-skill-first):
 * every citation resolves, every fact line cites, paragraphs stay short, a feature
 * chapter has a list or a table, mermaid blocks open with a diagram type, reader
 * text holds no code-shaped words and no advice (outside the remedies chapter), and a feature
 * or system chapter has its Open questions and Problems sections. Reads no file but
 * the project files a citation names; returns the reasons, never changes a chapter.
 */

import { bannedFragments, outsideLabels } from './banned-words.mjs';
import { quotedTexts } from './chapter-check.mjs';
import { chapterBlocks, splitRow } from './chapter-blocks.mjs';
import { citationGroups, resolveSpec, specKey } from './chapter-cites.mjs';
import { sentencesOf } from './chapter-sentences.mjs';
import { adviceWordsOf, wordsIn } from './word-lists.mjs';

export const MAX_SENTENCES = 4;
export const CROSS_CHAPTERS = Object.freeze(['domains', 'roles', 'notifications', 'topics', 'defects', 'remedies']);
const DIAGRAM_TYPES = ['flowchart', 'graph', 'sequenceDiagram', 'stateDiagram-v2', 'stateDiagram', 'erDiagram', 'classDiagram', 'journey', 'gantt', 'pie', 'mindmap', 'timeline'];
const COLONS = [':', String.fromCharCode(0xff1a)];
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const endsWithColon = (text) => COLONS.some((colon) => text.trimEnd().endsWith(colon));
const withoutGroups = (text) => {
  let out = text;
  for (const group of citationGroups(text).reverse()) out = `${out.slice(0, group.start)} ${out.slice(group.end)}`;
  return out;
};

/** Matchers of the fixed-text lines a chapter may carry without a citation. */
function fixedMatchers(strings) {
  return ['chapter.none', 'chapter.notVerified', 'chapter.notPassed']
    .filter((key) => typeof strings[key] === 'string')
    .map((key) => new RegExp(`^${escapeRegex(strings[key].trim()).replace(/\\\{count\\\}/g, '\\d+').replace(/\{count\}/g, '\\d+')}$`));
}

/**
 * Reasons for the chapter `text`. `kind`: system, feature or cross; `name`: the file stem.
 * `ctx`: `files` (project-files.mjs), `strings` (the run's fixed text), `memberDirs`, `cache` (a Map shared across chapters).
 */
export function lintChapter(text, { kind, name, files, strings, memberDirs = [], cache = new Map() }) {
  const reasons = [];
  const blocks = chapterBlocks(text);
  const fixed = fixedMatchers(strings);
  const isFixed = (value) => {
    const bare = value.trim().replace(/^>\s*/, '').replace(/^([-*]|\d+\.)\s+/, '').trim();
    return fixed.some((pattern) => pattern.test(bare));
  };
  const add = (line, reason) => reasons.push(`line ${line}: ${reason}`);
  const advice = name === 'remedies' ? [] : adviceWordsOf(strings);

  let openLevel = null;
  const seenHeadings = [];
  let listOrTable = false;

  const checkCitations = (line, source) => {
    for (const group of citationGroups(source)) {
      for (const spec of group.specs) {
        const key = specKey(spec);
        if (!cache.has(key)) cache.set(key, resolveSpec(spec, files));
        const result = cache.get(key);
        if (result.problem !== undefined) add(line, result.problem);
      }
    }
  };
  const checkReader = (line, source) => {
    const reader = withoutGroups(source);
    const labels = new Set(quotedTexts(reader));
    for (const hit of outsideLabels(bannedFragments(reader, { memberDirs }), reader, labels)) {
      add(line, `${JSON.stringify(hit.fragment)} is not allowed in reader text (${hit.category})`);
    }
    for (const word of wordsIn(reader, advice)) add(line, `${JSON.stringify(word)} is a word of advice; only the remedies chapter gives advice`);
  };
  const checkFact = (line, source) => {
    reasons.push(`line ${line}: a fact without a citation: ${source.trim().slice(0, 60)}`);
  };

  for (const block of blocks) {
    if (block.type === 'fence') {
      if (block.info === 'mermaid') {
        const first = block.body.find((entry) => entry.text.trim() !== '' && !entry.text.trim().startsWith('%%'));
        const ok = first !== undefined && DIAGRAM_TYPES.some((type) => new RegExp(`^${type}(?![\\w-])`).test(first.text.trim()));
        if (!ok) add(first?.line ?? block.line, `a mermaid block must start with a diagram type, found: ${first === undefined ? '(nothing)' : first.text.trim()}`);
      }
      continue;
    }
    if (block.type === 'separator') continue;
    if (block.type === 'heading') {
      seenHeadings.push({ level: block.level, text: block.text });
      if (openLevel !== null && block.level <= openLevel) openLevel = null;
      if (block.text === strings['chapter.openQuestions']) openLevel = block.level;
      checkCitations(block.line, block.text);
      checkReader(block.line, block.text);
      continue;
    }
    const inOpen = openLevel !== null;
    if (block.type === 'row') {
      checkCitations(block.line, block.text);
      checkReader(block.line, splitRow(block.text).join(' | '));
      if (!block.header) {
        listOrTable = true;
        if (!inOpen && !isFixed(block.text) && citationGroups(block.text).length === 0) checkFact(block.line, block.text);
      }
      continue;
    }
    if (block.type === 'item') {
      listOrTable = true;
      checkCitations(block.line, block.text);
      checkReader(block.line, block.text);
      if (!inOpen && !isFixed(block.text) && !endsWithColon(block.text) && citationGroups(block.text).length === 0) checkFact(block.line, block.text);
      continue;
    }
    // paragraph: each source line is checked for citations and reader text; sentences carry the fact and length rules
    block.lines.forEach((value, k) => {
      checkCitations(block.starts[k], value);
      checkReader(block.starts[k], value);
    });
    const sentences = sentencesOf(block.text).filter((sentence) => sentence.words);
    const lineAt = (offset) => {
      let at = 0;
      let line = block.starts[0];
      block.lines.forEach((value, k) => {
        if (offset >= at) line = block.starts[k];
        at += value.length + 1;
      });
      return line;
    };
    if (isFixed(block.text)) continue;
    if (sentences.length > MAX_SENTENCES) add(block.line, `a paragraph of ${sentences.length} sentences; at most ${MAX_SENTENCES}`);
    if (inOpen) continue;
    sentences.forEach((sentence, k) => {
      if (sentence.cited) return;
      if (k === sentences.length - 1 && endsWithColon(sentence.text)) return;
      checkFact(lineAt(sentence.start + (sentence.text.length === 0 ? 0 : block.text.slice(sentence.start).search(/\S/))), sentence.text);
    });
  }

  if (kind === 'feature' && !listOrTable) reasons.push('no list or table; write fields, steps and rules as lists or tables');
  if (kind === 'feature' || kind === 'system') {
    for (const key of ['chapter.openQuestions', 'chapter.problems']) {
      const wanted = strings[key];
      if (!seenHeadings.some((heading) => (heading.level === 2 || heading.level === 3) && heading.text === wanted)) reasons.push(`missing the section "${wanted}"`);
    }
  }
  return reasons;
}
