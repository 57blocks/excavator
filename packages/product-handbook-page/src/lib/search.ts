import type { Group } from './groups';
import { groupOfFeature } from './groups';
import type { PageItem } from './pages';
import type { SearchItem } from './types';

export const MAX_RESULTS = 40;

/** Where a result goes: a domain page, a chapter, or a heading of a chapter (counted from 0 among its `h2` and `h3`). */
export type Target = { kind: 'domain'; id: string } | { kind: 'chapter'; id: string } | { kind: 'heading'; chapter: string; heading: number };

export interface Result { key: string; title: string; /** What the result sits in: a domain name, a chapter title or the references label. */ context: string; /** The group whose colour the result carries, or null. */ domain: string | null; target: Target }

export interface SearchInput {
  query: string;
  groups: Group[];
  /** The page data's index. */
  items: SearchItem[];
  /** The references of the page; the chapters among them are what an empty query lists after the domains. */
  references: PageItem[];
  /** The fixed name of the system chapter in results. */
  systemTitle: string;
  referencesLabel: string;
  domainsLabel: string;
}

/**
 * The results for a query: the case-insensitive substring match of the title over the domains, then the chapters and their
 * headings in the order of the index; at most 40. An empty query lists the domains, then the reference chapters.
 */
export function searchResults({ query, groups, items, references, referencesLabel, domainsLabel, systemTitle }: SearchInput): Result[] {
  const needle = query.trim().toLowerCase();
  const titleOfChapter = new Map(items.filter((item) => item.kind === 'chapter' && item.chapter !== null).map((item) => [item.chapter as string, item.chapter === 'system' ? systemTitle : item.title]));
  const domains: Result[] = groups.map((group) => ({ key: `domain:${group.id}`, title: group.name, context: domainsLabel, domain: group.id, target: { kind: 'domain', id: group.id } }));
  const chapterResult = (item: SearchItem): Result | null => {
    if (item.chapter === null) return null;
    const group = groupOfFeature(groups, item.chapter);
    if (item.kind === 'chapter') return { key: `chapter:${item.chapter}`, title: titleOfChapter.get(item.chapter) ?? item.title, context: group?.name ?? referencesLabel, domain: group?.id ?? null, target: { kind: 'chapter', id: item.chapter } };
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
