import type { Group } from './groups';
import { groupOfFeature } from './groups';
import type { PageItem } from './pages';
import type { SearchItem } from './types';

export const MAX_RESULTS = 40;

/** The block id of the cross-feature domains chapter. */
export const DOMAINS_CHAPTER = 'domains';

/** Where a result goes: a domain page, a chapter, or a heading of a chapter (counted from 0 among its `h2` and `h3`). */
export type Target = { kind: 'domain'; id: string } | { kind: 'chapter'; id: string } | { kind: 'heading'; chapter: string; heading: number };

export interface Result { key: string; title: string; /** What the result sits in: a domain name or a chapter title; empty for a reference chapter that is in no domain. */ context: string; /** The group whose colour the result carries, or null. */ domain: string | null; target: Target }

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
export function searchResults({ query, groups, items, references, domainsLabel, systemTitle, domainsIndex = false }: SearchInput): Result[] {
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
    if (item.chapter === null) return null;
    const section = sectionOf.get(item);
    if (section !== undefined && item.heading !== null) {
      return { key: `heading:${item.chapter}:${item.heading}`, title: item.title, context: titleOfChapter.get(item.chapter) ?? item.chapter, domain: section, target: { kind: 'domain', id: section } };
    }
    const group = groupOfFeature(groups, item.chapter);
    if (item.kind === 'chapter') return { key: `chapter:${item.chapter}`, title: titleOfChapter.get(item.chapter) ?? item.title, context: group?.name ?? '', domain: group?.id ?? null, target: { kind: 'chapter', id: item.chapter } };
    if (item.kind === 'heading' && item.heading !== null) {
      return { key: `heading:${item.chapter}:${item.heading}`, title: item.title, context: titleOfChapter.get(item.chapter) ?? item.chapter, domain: group?.id ?? null, target: { kind: 'heading', chapter: item.chapter, heading: item.heading } };
    }
    return null;
  };
  if (needle === '') {
    const referenceBlocks = new Set(references.filter((item) => item.kind === 'chapter').map((item) => item.block));
    const chapters = items.filter((item) => item.kind === 'chapter' && item.chapter !== null && referenceBlocks.has(item.chapter)).flatMap((item) => chapterResult(item) ?? []);
    return [...domains, ...chapters].slice(0, MAX_RESULTS);
  }
  const rest = items.flatMap((item) => chapterResult(item) ?? []);
  return [...domains, ...rest].filter((result) => result.title.toLowerCase().includes(needle)).slice(0, MAX_RESULTS);
}
