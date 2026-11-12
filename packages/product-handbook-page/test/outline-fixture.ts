import type { Outline, OutlineChapter } from '../src/lib/types';

const TECHNICAL = new Set(['architecture', 'data', 'applications-matrix', 'dictionaries', 'applications', 'systems']);
const GROUPS: [string, [string, string][]][] = [
  ['system', [['overview', 'page.nav.overview'], ['business', 'page.nav.business'], ['architecture', 'page.nav.architecture'], ['data', 'md.data.heading'], ['roles-matrix', 'md.matrix.roleFeature.heading'], ['applications-matrix', 'md.matrix.applicationDomain.heading'], ['dictionaries', 'md.dict.heading']]],
  ['applications', [['applications', 'page.nav.group.applications']]],
  ['domains', [['domains', 'page.nav.group.domains']]],
  ['systems', [['systems', 'page.nav.group.systems']]],
  ['topics', [['notifications', 'page.nav.notifications'], ['jobs', 'page.nav.jobs'], ['topics', 'page.nav.topics']]],
  ['health', [['history', 'md.history.heading'], ['findings', 'page.nav.findings'], ['recommendations', 'page.nav.recommendations'], ['open-questions', 'md.appendix.openHeading']]],
  ['appendix', [['glossary', 'md.appendix.glossaryHeading'], ['sources', 'md.appendix.sourcesHeading']]],
];
const LISTS = new Set(['applications', 'domains', 'systems']);

/** The default outline the script writes into the page data (outline.mjs `defaultOutline`), from the table the test renders with. */
export function defaultOutline(strings: Record<string, string>, basis: 'domains' | 'areas' = 'domains'): Outline {
  const areas = basis === 'areas';
  return {
    source: 'default',
    problems: [],
    parts: GROUPS.map(([group, blocks]) => ({
      title: strings[group === 'domains' && areas ? 'page.nav.group.areas' : `page.nav.group.${group}`],
      chapters: blocks.map(([id, key]): OutlineChapter => {
        const title = strings[id === 'domains' && areas ? 'page.nav.group.areas' : key];
        return LISTS.has(id) ? { title, list: id, technical: TECHNICAL.has(id) } : { title, block: id, technical: TECHNICAL.has(id) };
      }),
    })),
    unplaced: [],
  };
}
