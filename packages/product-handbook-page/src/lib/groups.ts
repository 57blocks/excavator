import { COVERAGE_BLOCK, inView, itemOf } from './pages';
import type { PageItem } from './pages';
import type { OutlineBlock, PageData, View } from './types';

/** A group of feature chapters the reader moves through together: a business domain, or a part of the outline when the page has no checked domains. */
export interface Group { id: string; name: string; features: PageItem[] }

/** A feature chapter is a chapter block whose id is `F` and a number. */
/** Whether a chapter id is a feature's: `F` and a number. */
export const isFeatureId = (id: string): boolean => /^F\d+$/.test(id);

export const isFeature = (block: OutlineBlock): boolean => block.kind === 'chapter' && isFeatureId(block.block);

/**
 * The groups of the page: one per domain when `domains.state` is `ok` (the feature chapters the outline has, in the domain's
 * order), else one per outline part that holds a feature chapter (`d1`, `d2`, ... in order, named by the part).
 */
export function groupsOf(data: PageData): Group[] {
  if (data.domains.state === 'ok') {
    const features = new Map<string, OutlineBlock>();
    for (const part of data.outline.parts) for (const block of part.blocks) if (isFeature(block) && !features.has(block.block)) features.set(block.block, block);
    return data.domains.list.map((domain) => ({
      id: domain.id,
      name: domain.name,
      features: domain.features.flatMap((id) => { const block = features.get(id); return block === undefined ? [] : [itemOf(block)]; }),
    }));
  }
  const groups: Group[] = [];
  for (const part of data.outline.parts) {
    const features = part.blocks.filter(isFeature).map(itemOf);
    if (features.length > 0) groups.push({ id: `d${groups.length + 1}`, name: part.title, features });
  }
  return groups;
}

/** A group of reference pages in a list: the title of an outline part that holds some, or null (the coverage page, and a list with one group only). */
export interface ReferenceGroup { title: string | null; items: PageItem[] }

/** The page of the system chapter is named by the fixed text `page.nav.system` wherever a list or a link names it. */
export const SYSTEM_BLOCK = 'system';
export const isSystemItem = (item: PageItem): boolean => item.kind === 'chapter' && item.block === SYSTEM_BLOCK;
export const named = (item: PageItem, systemTitle: string): PageItem => (isSystemItem(item) ? { ...item, title: systemTitle } : item);

/**
 * The references in groups: one group per outline part that holds a reference page (the system and cross chapters, the data,
 * the dictionaries in the technical view, the history), titled by the part, in outline order; the coverage page last in a
 * group of its own without a title. A feature chapter that is in no domain is a reference too, so that nothing is unreachable.
 * When there is only one group its title is null. The system chapter is named `systemTitle`.
 */
export function referencesOf(data: PageData, view: View, coverageTitle: string, systemTitle: string): ReferenceGroup[] {
  const grouped = new Set(groupsOf(data).flatMap((group) => group.features.map((item) => item.block)));
  const out: ReferenceGroup[] = [];
  for (const part of data.outline.parts) {
    const items = part.blocks.filter((block) => inView(block, view) && !(isFeature(block) && grouped.has(block.block))).map((block) => named(itemOf(block), systemTitle));
    if (items.length > 0) out.push({ title: part.title, items });
  }
  out.push({ title: null, items: [{ block: COVERAGE_BLOCK, kind: 'coverage', title: coverageTitle, key: 'coverage' }] });
  return out.length === 1 ? [{ title: null, items: out[0].items }] : out;
}

/** The pages of the reference groups in order, as one list. */
export const flatReferences = (groups: ReferenceGroup[]): PageItem[] => groups.flatMap((group) => group.items);

/** The group a feature chapter is in (the first, when it is in several), or undefined. */
export function groupOfFeature(groups: Group[], block: string): Group | undefined {
  return groups.find((group) => group.features.some((item) => item.block === block));
}
