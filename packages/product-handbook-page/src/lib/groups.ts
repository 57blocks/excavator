import { COVERAGE_BLOCK, inView, itemOf } from './pages';
import type { PageItem } from './pages';
import type { OutlineBlock, PageData, View } from './types';

/** A group of feature chapters the reader moves through together: a business domain, or a part of the outline when the page has no checked domains. */
export interface Group { id: string; name: string; features: PageItem[] }

/** A feature chapter is a chapter block whose id is `F` and a number. */
export const isFeature = (block: OutlineBlock): boolean => block.kind === 'chapter' && /^F\d+$/.test(block.block);

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

/**
 * The references: every outline block that is not a feature chapter in a group (the system and cross chapters, the data, the
 * dictionaries in the technical view, the history), in outline order, then the coverage page. A feature chapter that is in no
 * group is here too, so that nothing is unreachable.
 */
export function referencesOf(data: PageData, view: View, coverageTitle: string): PageItem[] {
  const grouped = new Set(groupsOf(data).flatMap((group) => group.features.map((item) => item.block)));
  const out: PageItem[] = [];
  for (const part of data.outline.parts) {
    for (const block of part.blocks) {
      if (inView(block, view) && !(isFeature(block) && grouped.has(block.block))) out.push(itemOf(block));
    }
  }
  out.push({ block: COVERAGE_BLOCK, kind: 'coverage', title: coverageTitle, key: 'coverage' });
  return out;
}

/** The group a feature chapter is in (the first, when it is in several), or undefined. */
export function groupOfFeature(groups: Group[], block: string): Group | undefined {
  return groups.find((group) => group.features.some((item) => item.block === block));
}
