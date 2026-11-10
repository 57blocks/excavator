import type { Links } from './links';
import type { RouteBody } from './route';
import type { Text } from './text';
import type { PageData, View } from './types';

/**
 * One link of the rail: its part (the index in the outline; null for the coverage page, which is always last and in no
 * part), the key of its route (`chapterKey`), its address and its text, the title of its chapter, whether the chapter is a
 * list of entity pages, and the data attribute that names its entity.
 */
export interface Chapter { part: number | null; partTitle: string; chapterTitle: string; list: boolean; key: string; href: string; label: string; data?: Record<string, string> }

/** The key a route has in the chapter list: the route name, or the name and the entity for a page of one entity. */
export function chapterKey(route: RouteBody): string {
  switch (route.name) {
    case 'domain': return `domain:${route.id}`;
    case 'application': return `application:${route.dir}`;
    case 'system': return `system:${route.system}`;
    case 'feature': return `feature:${route.id}`;
    case 'role': return `role:${route.label}`;
    default: return route.name;
  }
}

/** The address of the page of a block. */
function blockHref(block: string, nav: Links): string | undefined {
  switch (block) {
    case 'overview': return nav.overview;
    case 'business': return nav.business;
    case 'architecture': return nav.architecture;
    case 'data': return nav.data;
    case 'roles-matrix': return nav.rolesMatrix;
    case 'applications-matrix': return nav.applicationsMatrix;
    case 'dictionaries': return nav.dictionaries;
    case 'notifications': return nav.notifications;
    case 'jobs': return nav.jobs;
    case 'topics': return nav.topics;
    case 'history': return nav.history;
    case 'findings': return nav.findings;
    case 'recommendations': return nav.recommendations;
    case 'open-questions': return nav.openQuestions;
    case 'glossary': return nav.glossary;
    case 'sources': return nav.sources;
    default: return undefined;
  }
}

/**
 * The chapters of the handbook in the order of its outline (openspec change handbook-outline, design D6): the parts and the
 * chapters of `data.outline`, each block one link and each list chapter one link per entity (the applications, the domains,
 * the external systems); the technical chapters are skipped in the product view; a part with no link left is not in the
 * list, so the rail does not show it. The coverage page is always last. The rail and the links to the previous and the next chapter
 * both read this one list.
 */
export function chapterList(data: PageData, view: View, nav: Links, t: Text): Chapter[] {
  const technical = view === 'technical';
  const out: Chapter[] = [];
  data.outline.parts.forEach((part, at) => {
    const add = (chapterTitle: string, list: boolean, key: string, href: string, label: string, attrs?: Record<string, string>) => out.push({ part: at, partTitle: part.title, chapterTitle, list, key, href, label, data: attrs });
    for (const chapter of part.chapters) {
      if (chapter.technical && !technical) continue;
      if (chapter.block !== undefined) {
        const href = blockHref(chapter.block, nav);
        if (href !== undefined) add(chapter.title, false, chapter.block, href, chapter.title);
      } else if (chapter.list === 'applications') {
        for (const application of data.system.applications) add(chapter.title, true, `application:${application.dir}`, nav.application(application.dir), application.name ?? application.dir, { 'data-application': application.dir });
      } else if (chapter.list === 'domains') {
        for (const domain of data.domains) add(chapter.title, true, `domain:${domain.id}`, nav.domain(domain.id), domain.name, { 'data-domain': domain.id });
      } else if (chapter.list === 'systems') {
        for (const item of data.technical?.integrations ?? []) add(chapter.title, true, `system:${item.system}`, nav.system(item.system), item.system, { 'data-system': item.system });
      }
    }
  });
  out.push({ part: null, partTitle: t('page.nav.coverage'), chapterTitle: t('page.nav.coverage'), list: false, key: 'coverage', href: nav.coverage, label: t('page.nav.coverage') });
  return out;
}
