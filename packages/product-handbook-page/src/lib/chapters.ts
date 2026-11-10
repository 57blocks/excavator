import type { Links } from './links';
import type { RouteBody } from './route';
import type { Text } from './text';
import type { PageData, View } from './types';

/** The groups of the rail, in its order. */
export type ChapterGroup = 'system' | 'applications' | 'domains' | 'systems' | 'topics' | 'health' | 'appendix';

/** One link of the rail: its group, the key of its route (`chapterKey`), its address and its text, and the data attribute that names its entity. */
export interface Chapter { group: ChapterGroup; key: string; href: string; label: string; data?: Record<string, string> }

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

/**
 * The chapters of the handbook in the order of the rail (openspec change handbook-deep-entry D11, handbook-domain-page D6):
 * the system (the overview, the business flow, in the technical view the technical structure and the data, the matrices
 * and, in the technical view, the dictionaries), in the technical view the applications, the domains, in the technical
 * view the external systems, the cross-cutting pages, health and findings, and the appendix. The rail and the links to
 * the previous and the next chapter both read this one list.
 */
export function chapterList(data: PageData, view: View, nav: Links, t: Text): Chapter[] {
  const technical = view === 'technical';
  const out: Chapter[] = [];
  const add = (group: ChapterGroup, key: string, href: string, label: string, attrs?: Record<string, string>) => out.push({ group, key, href, label, data: attrs });
  add('system', 'overview', nav.overview, t('page.nav.overview'));
  add('system', 'business', nav.business, t('page.nav.business'));
  if (technical) add('system', 'architecture', nav.architecture, t('page.nav.architecture'));
  if (technical) add('system', 'data', nav.data, t('md.data.heading'));
  add('system', 'roles-matrix', nav.rolesMatrix, t('md.matrix.roleFeature.heading'));
  if (technical) add('system', 'applications-matrix', nav.applicationsMatrix, t('md.matrix.applicationDomain.heading'));
  if (technical) add('system', 'dictionaries', nav.dictionaries, t('md.dict.heading'));
  if (technical) for (const application of data.system.applications) add('applications', `application:${application.dir}`, nav.application(application.dir), application.name ?? application.dir, { 'data-application': application.dir });
  for (const domain of data.domains) add('domains', `domain:${domain.id}`, nav.domain(domain.id), domain.name, { 'data-domain': domain.id });
  if (technical) for (const item of data.technical?.integrations ?? []) add('systems', `system:${item.system}`, nav.system(item.system), item.system, { 'data-system': item.system });
  add('topics', 'notifications', nav.notifications, t('page.nav.notifications'));
  add('topics', 'jobs', nav.jobs, t('page.nav.jobs'));
  add('topics', 'topics', nav.topics, t('page.nav.topics'));
  add('health', 'history', nav.history, t('md.history.heading'));
  add('health', 'findings', nav.findings, t('page.nav.findings'));
  add('health', 'recommendations', nav.recommendations, t('page.nav.recommendations'));
  add('health', 'open-questions', nav.openQuestions, t('md.appendix.openHeading'));
  add('appendix', 'glossary', nav.glossary, t('md.appendix.glossaryHeading'));
  add('appendix', 'sources', nav.sources, t('md.appendix.sourcesHeading'));
  add('appendix', 'coverage', nav.coverage, t('page.nav.coverage'));
  return out;
}
