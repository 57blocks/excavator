/**
 * Cutting a feature chapter into the pieces of its page: the head, the level-2 sections and the level-3 items of each.
 * Pure text. Every `##` and `###` heading outside a fence gets its number n, counting from 0 in document order, which is
 * the numbering of the search index (page-domains.mjs, `pageHeadings`) and of the heading ids `h-<n>` on the page.
 */

/** The fixed section names a chapter's level-2 headings are written with, by role. */
export type Role = 'overview' | 'screens' | 'operations' | 'rules' | 'states' | 'notifications' | 'handovers' | 'openQuestions' | 'problems';

export const ROLE_KEYS: Readonly<Record<Role, string>> = Object.freeze({
  overview: 'chapter.section.overview',
  screens: 'chapter.section.screens',
  operations: 'chapter.section.operations',
  rules: 'chapter.section.rules',
  states: 'chapter.section.states',
  notifications: 'chapter.section.notifications',
  handovers: 'chapter.section.handovers',
  openQuestions: 'chapter.openQuestions',
  problems: 'chapter.problems',
});

export interface Item { title: string; n: number; body: string }
export interface Section { title: string; role: Role | null; n: number; intro: string; items: Item[] }
export interface Split { head: string; sections: Section[] }

const FENCE = /^\s*```/;
const HEADING = /^#{2,3}\s+(.*?)\s*#*\s*$/;

interface Mark { at: number; level: 2 | 3; title: string; n: number }

/** The `##` and `###` lines of `lines` outside fences, numbered; the same rule as the search index. */
function marksOf(lines: readonly string[]): Mark[] {
  const marks: Mark[] = [];
  let fenced = false;
  lines.forEach((line, at) => {
    if (FENCE.test(line)) { fenced = !fenced; return; }
    if (fenced) return;
    const found = HEADING.exec(line);
    if (found !== null && !line.startsWith('####')) marks.push({ at, level: line.startsWith('###') ? 3 : 2, title: found[1], n: marks.length });
  });
  return marks;
}

const trimBlank = (lines: readonly string[]): string => {
  let from = 0;
  let to = lines.length;
  while (from < to && lines[from].trim() === '') from += 1;
  while (to > from && lines[to - 1].trim() === '') to -= 1;
  return lines.slice(from, to).join('\n');
};

/**
 * `source` cut at its `##` and `###` headings. `titles` maps each role to the fixed text of the run. A section's role is the
 * role whose fixed text is exactly its title; the first section, when its title is none of them, is the overview (the first
 * section of an older chapter has whatever name its writer chose). A section no role names has role null.
 */
export function splitChapter(source: string, titles: Readonly<Record<Role, string>>): Split {
  const lines = source.split('\n');
  const marks = marksOf(lines);
  const firstSection = marks.findIndex((mark) => mark.level === 2);
  if (firstSection === -1) return { head: source, sections: [] };
  const head = lines.slice(0, marks[firstSection].at).join('\n').replace(/\s+$/, '');
  const roleOf = (title: string, first: boolean): Role | null => {
    const found = (Object.keys(titles) as Role[]).find((role) => titles[role] !== '' && titles[role] === title);
    return found ?? (first ? 'overview' : null);
  };
  const sections: Section[] = [];
  marks.slice(firstSection).forEach((mark, k, all) => {
    const end = k + 1 < all.length ? all[k + 1].at : lines.length;
    if (mark.level === 2) {
      sections.push({ title: mark.title, role: roleOf(mark.title, sections.length === 0), n: mark.n, intro: trimBlank(lines.slice(mark.at + 1, end)), items: [] });
    } else {
      sections[sections.length - 1].items.push({ title: mark.title, n: mark.n, body: trimBlank(lines.slice(mark.at + 1, end)) });
    }
  });
  return { head, sections };
}

/**
 * The first paragraph of `text` when the text starts with one (not a list, table, quote, fence or heading), and the rest of
 * the text after it. `lede` is '' when the text does not start with a paragraph.
 */
export function splitLede(text: string): { lede: string; rest: string } {
  const lines = text.split('\n');
  let at = 0;
  while (at < lines.length && lines[at].trim() === '') at += 1;
  if (at >= lines.length || /^(\s*([-*+]|\d+[.)])\s|\s*\||\s*>|\s*```|\s*~~~|\s*#)/.test(lines[at])) return { lede: '', rest: text };
  let end = at;
  while (end < lines.length && lines[end].trim() !== '') end += 1;
  return { lede: lines.slice(at, end).join('\n'), rest: lines.slice(end).join('\n').replace(/^\s*\n/, '') };
}

const FULL_COLON = String.fromCharCode(0xff1a);
const FULL_OPEN = String.fromCharCode(0xff08);
const FULL_CLOSE = String.fromCharCode(0xff09);
const FULL_STOP = String.fromCharCode(0x3002);
const FULL_SEMI = String.fromCharCode(0xff1b);
const endsWithColon = (line: string): boolean => line.endsWith(':') || line.endsWith(FULL_COLON);
const CITATION_GROUP = new RegExp(`\\s*[(${FULL_OPEN}]\\s*\`[^\`]*\`(?:\\s*;\\s*\`[^\`]*\`)*\\s*[)${FULL_CLOSE}]`, 'g');
const FIRST_SENTENCE = new RegExp(`^(.+?[${FULL_STOP}${FULL_SEMI};]|.+?\\.(?=\\s|$))`);

/**
 * The one line an item shows when folded: the first line that is not in a fence, a table row or a lead-in ending with a
 * colon, without its list mark, emphasis and citation groups, cut after its first sentence and at 100 characters.
 */
export function previewOf(body: string): string {
  let fenced = false;
  for (const raw of body.split('\n')) {
    if (FENCE.test(raw)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const line = raw.replace(/^\s*([-*+]|\d+[.)])\s+/, '').replace(/^>\s*/, '').replace(CITATION_GROUP, '').replace(/[*_`]/g, '').trim();
    if (line === '' || line.startsWith('|') || endsWithColon(line) || /^#{4,}\s/.test(line)) continue;
    const found = FIRST_SENTENCE.exec(line);
    return (found === null ? line : found[1]).slice(0, 100);
  }
  return '';
}

/**
 * An operation's body cut at the line equal to the fixed `marker` (a colon in either width): the steps before it, the title of
 * the fold (the line without its colon) and the server-side steps from the line after it to the end. Null without the line.
 */
export function splitServerSteps(body: string, marker: string): { before: string; title: string; after: string } | null {
  const bare = (text: string): string => (endsWithColon(text.trim()) ? text.trim().slice(0, -1).trim() : text.trim());
  if (marker.trim() === '') return null;
  const wanted = bare(marker);
  const lines = body.split('\n');
  let fenced = false;
  for (let at = 0; at < lines.length; at += 1) {
    if (FENCE.test(lines[at])) { fenced = !fenced; continue; }
    if (!fenced && endsWithColon(lines[at].trim()) && bare(lines[at]) === wanted) {
      return { before: trimBlank(lines.slice(0, at)), title: wanted, after: trimBlank(lines.slice(at + 1)) };
    }
  }
  return null;
}
