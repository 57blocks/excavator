import { createContext, useContext } from 'react';

import type { Group } from './groups';
import { layoutMap } from './map-layout';
import type { MapLayout } from './map-layout';
import { domainColours } from './strata';
import type { Pair } from './strata';
import type { DomainData, DomainsState, HandoverData, PageData, ProblemsData } from './types';

/**
 * What the pages share about the domains: whether the checked list is usable (`map`), the layout of the map, the colour of
 * each group (one colour per domain everywhere), the hand-overs, the domains' own texts and the title of each chapter.
 */
export interface DomainModel {
  state: DomainsState;
  /** True when the map is drawn: the list is `ok` and has at least one domain. */
  map: boolean;
  layout: MapLayout | null;
  colours: Record<string, Pair>;
  handovers: HandoverData[];
  /** The domain data by id (empty unless the list is usable). */
  domains: Record<string, DomainData>;
  /** The title of each chapter the outline places, by chapter id. */
  titles: Record<string, string>;
  /** The group (domain) each feature chapter is in, by chapter id. */
  chapterDomain: Record<string, string>;
  /** The problems of the page as the core has them (no texts); the lists of a feature are taken from these rows. */
  problems: ProblemsData;
  /** The number of problem rows that concern each feature (and `system`), 0 included: the one count the side list, the feature page and the overview show. */
  problemCount: Record<string, number>;
}

/** Count the rows of `problems` per feature; every feature of the groups and `system` has an entry. */
function countProblems(problems: ProblemsData, chapterDomain: Record<string, string>): Record<string, number> {
  const count: Record<string, number> = { system: 0 };
  for (const id of Object.keys(chapterDomain)) count[id] = 0;
  for (const row of problems.rows) for (const id of new Set(row.features)) count[id] = (count[id] ?? 0) + 1;
  return count;
}

/** The model of a page: the layout from the checked list, or no layout and the colours by the group order. */
export function buildModel(data: PageData, groups: Group[]): DomainModel {
  const usable = data.domains.state === 'ok' && data.domains.list.length > 0;
  const titles: Record<string, string> = {};
  for (const part of data.outline.parts) for (const block of part.blocks) if (block.kind === 'chapter') titles[block.block] = block.title;
  const chapterDomain: Record<string, string> = {};
  for (const group of groups) for (const item of group.features) if (chapterDomain[item.block] === undefined) chapterDomain[item.block] = group.id;
  const problems = data.problems;
  const problemCount = countProblems(problems, chapterDomain);
  if (!usable) {
    return { state: data.domains.state === 'ok' ? 'missing' : data.domains.state, map: false, layout: null, colours: domainColours(groups.map((group) => group.id)), handovers: [], domains: {}, titles, chapterDomain, problems, problemCount };
  }
  const { list, handovers } = data.domains;
  const layout = layoutMap(list.map((domain) => ({ id: domain.id, name: domain.name, features: domain.features.length })), handovers);
  return {
    state: 'ok',
    map: true,
    layout,
    colours: domainColours(layout.ring, layout.centre),
    handovers,
    domains: Object.fromEntries(list.map((domain) => [domain.id, domain])),
    titles,
    chapterDomain,
    problems,
    problemCount,
  };
}

const EMPTY: DomainModel = { state: 'missing', map: false, layout: null, colours: {}, handovers: [], domains: {}, titles: {}, chapterDomain: {}, problems: { sources: { defects: { state: 'missing', count: null }, design: { state: 'missing', count: null }, open: { state: 'missing', count: null, unmatched: [] } }, rows: [], remedies: null }, problemCount: {} };

export const ModelContext = createContext<DomainModel>(EMPTY);
export const useModel = (): DomainModel => useContext(ModelContext);
