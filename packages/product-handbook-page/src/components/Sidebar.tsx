import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import type { PageData } from '../lib/types';
import { useLinks, useView } from '../lib/links';
import type { Route } from '../lib/route';
import { useText } from '../lib/text';

interface Props {
  data: PageData;
  route: Route;
  open: boolean;
  onNavigate: () => void;
}

type Group = 'system' | 'applications' | 'domains' | 'systems' | 'topics' | 'health' | 'appendix';

/**
 * The navigation (openspec change handbook-deep-entry, design D11): two levels, a group name and its links, all shown,
 * none folding or numbered. The groups are the system (the overview, the roles matrix and, in the technical view, the
 * applications matrix, the data and the dictionaries pages), in the technical view the applications, the business
 * domains (named areas when the map has no domains file), in the technical view the external systems, the
 * cross-cutting pages, health and findings, and the appendix. No feature is listed: a feature is reached from its
 * domain's page, and on a feature page the link of its domain is marked as the current place. Below 900px it is a
 * drawer that the top bar's button opens.
 */
export function Sidebar({ data, route, open, onNavigate }: Props) {
  const t = useText();
  const nav = useLinks();
  const view = useView();
  const routeKey = JSON.stringify(route);
  const scroller = useRef<HTMLDivElement>(null);
  // Keep the current link in view inside the rail's one scroll container.
  useEffect(() => {
    const current = scroller.current?.querySelector('[aria-current]');
    if (current instanceof HTMLElement && typeof current.scrollIntoView === 'function') current.scrollIntoView({ block: 'nearest' });
  }, [routeKey]);
  const technical = view === 'technical';
  const currentDomain = route.name === 'feature' ? data.features.find((feature) => feature.id === route.id)?.domain : undefined;
  const link = (href: string, name: Route['name'], label: string) => (
    <a className="rail-link" key={name} href={href} aria-current={route.name === name ? 'page' : undefined}>{label}</a>
  );
  const group = (name: Group, links: ReactNode[], label = t(`page.nav.group.${name}`)) => (
    <section className="rail-group" data-group={name} aria-labelledby={`rail-group-${name}`}>
      <h2 className="rail-group-name" id={`rail-group-${name}`}>{label}</h2>
      {links}
    </section>
  );
  const integrations = data.technical?.integrations ?? [];
  return (
    <nav
      className="rail"
      id="rail"
      aria-label={t('page.nav.label')}
      data-open={open}
      data-view-nav={view}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('a')) onNavigate();
      }}
    >
      <div className="rail-scroll" ref={scroller}>
        {group('system', [
          link(nav.overview, 'overview', t('page.nav.overview')),
          link(nav.rolesMatrix, 'roles-matrix', t('md.matrix.roleFeature.heading')),
          technical && link(nav.applicationsMatrix, 'applications-matrix', t('md.matrix.applicationDomain.heading')),
          technical && link(nav.data, 'data', t('md.data.heading')),
          technical && link(nav.dictionaries, 'dictionaries', t('md.dict.heading')),
        ])}
        {technical && group('applications', data.system.applications.map((application) => (
          <a className="rail-link" key={application.dir} data-application={application.dir} href={nav.application(application.dir)} aria-current={route.name === 'application' && route.dir === application.dir ? 'page' : undefined}>
            {application.name ?? application.dir}
          </a>
        )))}
        {group('domains', data.domains.map((domain) => {
          const current = route.name === 'domain' && route.id === domain.id ? 'page' : currentDomain === domain.id ? 'true' : undefined;
          return <a className="rail-link" key={domain.id} data-domain={domain.id} href={nav.domain(domain.id)} aria-current={current}>{domain.name}</a>;
        }), t(data.domainBasis === 'areas' ? 'page.nav.group.areas' : 'page.nav.group.domains'))}
        {technical && integrations.length > 0 && group('systems', integrations.map((item) => (
          <a className="rail-link" key={item.system} data-system={item.system} href={nav.system(item.system)} aria-current={route.name === 'system' && route.system === item.system ? 'page' : undefined}>{item.system}</a>
        )))}
        {group('topics', [
          link(nav.notifications, 'notifications', t('page.nav.notifications')),
          link(nav.jobs, 'jobs', t('page.nav.jobs')),
          link(nav.topics, 'topics', t('page.nav.topics')),
        ])}
        {group('health', [
          link(nav.history, 'history', t('md.history.heading')),
          link(nav.findings, 'findings', t('page.nav.findings')),
          link(nav.recommendations, 'recommendations', t('page.nav.recommendations')),
          link(nav.openQuestions, 'open-questions', t('md.appendix.openHeading')),
        ])}
        {group('appendix', [
          link(nav.glossary, 'glossary', t('md.appendix.glossaryHeading')),
          link(nav.sources, 'sources', t('md.appendix.sourcesHeading')),
          link(nav.coverage, 'coverage', t('page.nav.coverage')),
        ])}
      </div>
    </nav>
  );
}
