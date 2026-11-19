import { marksOf } from './feature-split';
import type { Group } from './groups';
import { groupOfFeature } from './groups';
import type { PageItem } from './pages';
import type { SearchItem } from './types';

export const MAX_RESULTS = 40;

/** The block id of the cross-feature domains chapter. */
export const DOMAINS_CHAPTER = 'domains';

/** Where a result goes: a domain page, a chapter, a heading of a chapter (counted from 0 among its `h2` and `h3`), a process page or a problem row. */
export type Target =
  | { kind: 'domain'; id: string }
  | { kind: 'chapter'; id: string }
  | { kind: 'heading'; chapter: string; heading: number; tab?: string }
  | { kind: 'process'; id: string }
  | { kind: 'problem'; id: string };

/** A piece of a chapter's text around a match: the text before it, the matched text as written, the text after it. */
export interface Snippet { before: string; match: string; after: string }

export interface Result {
  key: string;
  title: string;
  /** What the result sits in: a domain name or a chapter title (with the section's title for a match in the text); empty for a reference chapter that is in no domain. */
  context: string;
  /** The group whose colour the result carries, or null. */
  domain: string | null;
  target: Target;
  /** For a match in the text: the first match of the section with the words around it, and the number of matching lines. */
  snippet?: Snippet;
  count?: number;
}

/** The fewest characters a query has before the text of the chapters is matched; a shorter one matches the titles only. */
export const MIN_TEXT_QUERY = 2;
/** The characters of a snippet before and after the match at most. */
export const SNIPPET_BEFORE = 24;
export const SNIPPET_AFTER = 60;

/** The Markdown of one chapter in the current view. */
export interface TextSource { chapter: string; text: string }

export interface SearchInput {
  query: string;
  groups: Group[];
  /** The page data's index. */
  items: SearchItem[];
  /** The references of the page; the chapters among them are what an empty query lists after the domains. */
  references: PageItem[];
  /** The fixed name of the system chapter in results. */
  systemTitle: string;
  domainsLabel: string;
  /** True when the domains chapter page is an index of the domains: a heading inside one domain's section then opens that domain's page. */
  domainsIndex?: boolean;
}

/**
 * The results for a query: the case-insensitive substring match of the title over the domains, then the chapters and their
 * headings in the order of the index; at most 40. An empty query lists the domains, then the reference chapters.
 */
export function searchResults(input: SearchInput): Result[] {
  return titleResults(input).slice(0, MAX_RESULTS);
}

/** The title results of `searchResults`, not cut at the limit. */
function titleResults({ query, groups, items, references, domainsLabel, systemTitle, domainsIndex = false }: SearchInput): Result[] {
  const needle = query.trim().toLowerCase();
  const titleOfChapter = new Map(items.filter((item) => item.kind === 'chapter' && item.chapter !== null).map((item) => [item.chapter as string, item.chapter === 'system' ? systemTitle : item.title]));
  const domains: Result[] = groups.map((group) => ({ key: `domain:${group.id}`, title: group.name, context: domainsLabel, domain: group.id, target: { kind: 'domain', id: group.id } }));
  // A heading of the domains chapter belongs to the domain whose name is the text of the level-2 heading it sits under (the
  // index lists the headings in chapter order); a level-2 heading that is no domain name, and what is under it, belongs to none.
  const sectionOf = new Map<SearchItem, string>();
  if (domainsIndex) {
    let current: string | null = null;
    for (const item of items) {
      if (item.kind !== 'heading' || item.chapter !== DOMAINS_CHAPTER) continue;
      if (item.level === 2) current = groups.find((group) => group.name === item.title)?.id ?? null;
      if (current !== null) sectionOf.set(item, current);
    }
  }
  const chapterResult = (item: SearchItem): Result | null => {
    // A defect or design problem by its number: it opens its row on the problems page.
    if (item.kind === 'problem' && item.id !== undefined) return { key: `problem:${item.id}`, title: item.title, context: '', domain: null, target: { kind: 'problem', id: item.id } };
    if (item.kind === 'process' && item.id !== undefined) return { key: `process:${item.id}`, title: item.title, context: '', domain: null, target: { kind: 'process', id: item.id } };
    if (item.chapter === null) return null;
    const section = sectionOf.get(item);
    if (section !== undefined && item.heading !== null) {
      return { key: `heading:${item.chapter}:${item.heading}`, title: item.title, context: titleOfChapter.get(item.chapter) ?? item.chapter, domain: section, target: { kind: 'domain', id: section } };
    }
    const group = groupOfFeature(groups, item.chapter);
    if (item.kind === 'chapter') return { key: `chapter:${item.chapter}`, title: titleOfChapter.get(item.chapter) ?? item.title, context: group?.name ?? '', domain: group?.id ?? null, target: { kind: 'chapter', id: item.chapter } };
    if (item.kind === 'heading' && item.heading !== null) {
      return { key: `heading:${item.chapter}:${item.tab === undefined ? '' : `${item.tab}:`}${item.heading}`, title: item.title, context: titleOfChapter.get(item.chapter) ?? item.chapter, domain: group?.id ?? null, target: { kind: 'heading', chapter: item.chapter, heading: item.heading, ...(item.tab === undefined ? {} : { tab: item.tab }) } };
    }
    return null;
  };
  if (needle === '') {
    const referenceBlocks = new Set(references.filter((item) => item.kind === 'chapter').map((item) => item.block));
    const chapters = items.filter((item) => item.kind === 'chapter' && item.chapter !== null && referenceBlocks.has(item.chapter)).flatMap((item) => chapterResult(item) ?? []);
    return [...domains, ...chapters];
  }
  const rest = items.flatMap((item) => chapterResult(item) ?? []);
  return [...domains, ...rest].filter((result) => result.title.toLowerCase().includes(needle));
}

const FENCE = /^\s*(```|~~~)/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** A line of Markdown as a reader sees it: no list, quote or heading marks, no emphasis or code marks, a link as its text, table cells apart; '' for a line with no words (a table rule, a comment). */
export function plainLine(line: string): string {
  if (TABLE_RULE.test(line)) return '';
  let out = line.replace(/<!--.*?-->/g, ' ').replace(/<br\s*\/?>/gi, ' ');
  out = out.replace(/^\s*(>\s*)*/, '').replace(/^#{1,6}\s+/, '').replace(/^([-*+]|\d{1,9}[.)])\s+/, '');
  if (/^\s*\|/.test(line)) out = out.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim()).filter((cell) => cell !== '').join(' \u00b7 ');
  out = out.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '').replace(/(^|\s)[*_](\S)/g, '$1$2').replace(/(\S)[*_](?=\s|$)/g, '$1');
  return out.replace(/\s+/g, ' ').trim();
}

function snippetOf(text: string, at: number, length: number): Snippet {
  const from = Math.max(0, at - SNIPPET_BEFORE);
  const to = Math.min(text.length, at + length + SNIPPET_AFTER);
  return { before: `${from > 0 ? '\u2026' : ''}${text.slice(from, at)}`, match: text.slice(at, at + length), after: `${text.slice(at + length, to)}${to < text.length ? '\u2026' : ''}` };
}

export interface TextInput extends SearchInput {
  /** The text of each chapter the page has in the current view; a chapter not listed is not matched. */
  sources: TextSource[];
}

/**
 * The matches of a query in the text of the chapters of the search index (so not the chapters the index leaves out), one result
 * per `##` or `###` section in the order of the chapters and their sections. The query's words (split at spaces) must all occur
 * in the section, each as a case-insensitive substring of some line; the result shows the line with the most of them (the first
 * such line) with the words around its first match, and counts the lines that hold any of them. A line inside a fence does not
 * count; a `####` heading is text. The text before the first section goes to the chapter; in the domains chapter, when it is
 * an index of the domains, a domain's section goes to the domain's page. Empty for a query of fewer than `MIN_TEXT_QUERY`
 * characters, spaces left out.
 */
export function textResults({ query, groups, items, sources, systemTitle, domainsIndex = false }: TextInput): Result[] {
  const terms = [...new Set(query.trim().toLowerCase().split(/\s+/).filter((term) => term !== ''))];
  if ([...terms.join('')].length < MIN_TEXT_QUERY) return [];
  const chapters = new Map(items.filter((item) => item.kind === 'chapter' && item.chapter !== null).map((item) => [item.chapter as string, item.chapter === 'system' ? systemTitle : item.title]));
  const out: Result[] = [];
  for (const { chapter, text } of sources) {
    const title = chapters.get(chapter);
    if (title === undefined) continue;
    const group = groupOfFeature(groups, chapter);
    const lines = text.split('\n');
    const markAt = new Map(marksOf(lines).map((mark) => [mark.at, mark]));
    interface Open { n: number; heading: string | null; domain: string | null; seen: Set<string>; count: number; best: { plain: string; hits: number } | null }
    let fenced = false;
    let domainOfSection: string | null = null;
    let open: Open = { n: -1, heading: null, domain: null, seen: new Set(), count: 0, best: null };
    const close = (): void => {
      const { n, heading, domain, seen, count, best } = open;
      if (best === null || seen.size < terms.length) return;
      const lower = best.plain.toLowerCase();
      const first = terms.map((term) => ({ term, at: lower.indexOf(term) })).filter((one) => one.at !== -1).sort((a, b) => a.at - b.at)[0];
      const target: Target = domain !== null ? { kind: 'domain', id: domain } : n === -1 ? { kind: 'chapter', id: chapter } : { kind: 'heading', chapter, heading: n };
      out.push({ key: `text:${chapter}:${n}`, title: best.plain, context: heading === null ? title : `${title} \u00b7 ${heading}`, domain: domain ?? group?.id ?? null, target, snippet: snippetOf(best.plain, first.at, first.term.length), count });
    };
    lines.forEach((line, at) => {
      if (FENCE.test(line)) { fenced = !fenced; return; }
      if (fenced) return;
      const mark = markAt.get(at);
      if (mark !== undefined) {
        close();
        if (mark.level === 2) domainOfSection = domainsIndex && chapter === DOMAINS_CHAPTER ? (groups.find((one) => one.name === mark.title)?.id ?? null) : null;
        open = { n: mark.n, heading: plainLine(mark.title), domain: domainOfSection, seen: new Set(), count: 0, best: null };
        return;
      }
      if (/^#\s/.test(line)) return;
      const plain = plainLine(line);
      const lower = plain.toLowerCase();
      const hits = terms.filter((term) => lower.includes(term));
      if (hits.length === 0) return;
      for (const term of hits) open.seen.add(term);
      open.count += 1;
      if (open.best === null || hits.length > open.best.hits) open.best = { plain, hits: hits.length };
    });
    close();
  }
  return out;
}

/** The title results, then the text results, cut at `MAX_RESULTS`; `total` is the number before the cut. */
export function searchAll(input: TextInput): { results: Result[]; total: number } {
  const all = [...titleResults(input), ...textResults(input)];
  return { results: all.slice(0, MAX_RESULTS), total: all.length };
}
