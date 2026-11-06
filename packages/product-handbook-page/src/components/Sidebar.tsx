import type { ReactNode } from 'react';

import { REACHES } from '../lib/types';
import type { Feature, PageData } from '../lib/types';
import { useLinks, useView } from '../lib/links';
import type { Route } from '../lib/route';
import { technicalNav } from '../lib/views';
import { useText } from '../lib/text';
import { BellIcon, ClockIcon, CoverageIcon, OverviewIcon } from './Icons';
import { ReachDot } from './ReachBadge';

interface Props {
  data: PageData;
  route: Route;
  open: boolean;
  onNavigate: () => void;
}

function FeatureLink({ feature, current }: { feature: Feature; current: boolean }) {
  const nav = useLinks();
  return (
    <a className="rail-feature" href={nav.feature(feature.id)} aria-current={current ? 'page' : undefined}>
      <span className="rail-feature-name">{feature.name}</span>
      <ReachDot reach={feature.reach} />
    </a>
  );
}

/** The product view's navigation: the domains, each with its features. */
function ByDomain({ data, route }: { data: PageData; route: Route }) {
  const t = useText();
  const nav = useLinks();
  const currentId = route.name === 'feature' ? route.id : '';
  return (
    <>
      {data.domains.map((domain) => {
        const inDomain = data.features.filter((feature) => feature.domain === domain.id);
        return (
          <section className="rail-area" key={domain.id} aria-labelledby={`rail-area-${domain.id}`}>
            <h2 className="rail-area-name" id={`rail-area-${domain.id}`}>
              <a className="rail-area-link" href={nav.domain(domain.id)} aria-current={route.name === 'domain' && route.id === domain.id ? 'page' : undefined}>{domain.name}</a>
            </h2>
            {inDomain.length === 0 && <p className="rail-empty">{t('md.areas.noFeatures')}</p>}
            {inDomain.map((feature) => <FeatureLink feature={feature} current={currentId === feature.id} key={feature.id} />)}
          </section>
        );
      })}
    </>
  );
}

/** The technical view's navigation: the applications, in each the domains whose features have quoted passages in it, and under each domain those features; then the features that fall in no application. */
function ByApplication({ data, route }: { data: PageData; route: Route }) {
  const t = useText();
  const nav = useLinks();
  const currentId = route.name === 'feature' ? route.id : '';
  const { applications, unplaced } = technicalNav(data);
  return (
    <>
      {applications.map((application) => (
        <section className="rail-area" key={application.dir} aria-label={application.label} data-application={application.dir}>
          <h2 className="rail-area-name">
            <a className="rail-area-link" href={nav.application(application.dir)} aria-current={route.name === 'application' && route.dir === application.dir ? 'page' : undefined}>{application.label}</a>
          </h2>
          {application.domains.length === 0 && <p className="rail-empty">{t('md.none')}</p>}
          {application.domains.map((domain) => (
            <div className="rail-domain" key={domain.id} data-domain={domain.id}>
              <a className="rail-domain-name" href={nav.domain(domain.id)} aria-current={route.name === 'domain' && route.id === domain.id ? 'page' : undefined}>{domain.name}</a>
              {domain.features.map((feature) => <FeatureLink feature={feature} current={currentId === feature.id} key={feature.id} />)}
            </div>
          ))}
        </section>
      ))}
      {unplaced.length > 0 && (
        <section className="rail-area" aria-label={t('page.nav.unplaced')} data-part="unplaced">
          <h2 className="rail-area-name">{t('page.nav.unplaced')}</h2>
          {unplaced.map((feature) => <FeatureLink feature={feature} current={currentId === feature.id} key={feature.id} />)}
        </section>
      )}
      {(data.technical?.integrations.length ?? 0) > 0 && (
        <section className="rail-area" aria-label={t('md.entities.systems.heading')} data-part="systems">
          <h2 className="rail-area-name">{t('md.entities.systems.heading')}</h2>
          {data.technical?.integrations.map((item) => (
            <a className="rail-feature rail-system" key={item.system} href={nav.system(item.system)} aria-current={route.name === 'system' && route.system === item.system ? 'page' : undefined}>
              <span className="rail-feature-name">{item.system}</span>
            </a>
          ))}
        </section>
      )}
    </>
  );
}

/**
 * The navigation: overview, the roles and (in the technical view) the
 * applications matrices, the two cross-cutting tables, the findings, the recommendations, coverage; then, in the
 * product view, the domains with their features, or, in the technical view,
 * the applications with their domains and features; and a key to the marks.
 * Below 900px it is a drawer that the top bar's button opens.
 */
export function Sidebar({ data, route, open, onNavigate }: Props) {
  const t = useText();
  const nav = useLinks();
  const view = useView();
  const used = REACHES.filter((reach) => data.features.some((feature) => feature.reach === reach));
  const link = (href: string, name: Route['name'], label: string, icon?: ReactNode) => (
    <a className="rail-link" href={href} aria-current={route.name === name ? 'page' : undefined}>
      {icon}
      <span>{label}</span>
    </a>
  );
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
      <div className="rail-top">
        {link(nav.overview, 'overview', t('page.nav.overview'), <OverviewIcon />)}
        {link(nav.rolesMatrix, 'roles-matrix', t('md.matrix.roleFeature.heading'), <OverviewIcon />)}
        {view === 'technical' && link(nav.applicationsMatrix, 'applications-matrix', t('md.matrix.applicationDomain.heading'), <OverviewIcon />)}
        {link(nav.notifications, 'notifications', t('page.nav.notifications'), <BellIcon />)}
        {link(nav.jobs, 'jobs', t('page.nav.jobs'), <ClockIcon />)}
        {view === 'technical' && link(nav.data, 'data', t('md.data.heading'), <OverviewIcon />)}
        {view === 'technical' && link(nav.dictionaries, 'dictionaries', t('md.dict.heading'), <OverviewIcon />)}
        {link(nav.findings, 'findings', t('page.nav.findings'), <CoverageIcon />)}
        {link(nav.recommendations, 'recommendations', t('page.nav.recommendations'), <CoverageIcon />)}
        {link(nav.coverage, 'coverage', t('page.nav.coverage'), <CoverageIcon />)}
      </div>
      <div className="rail-scroll">
        {view === 'technical' ? <ByApplication data={data} route={route} /> : <ByDomain data={data} route={route} />}
      </div>
      <div className="rail-key" aria-label={t('page.nav.key')} role="group">
        <p className="rail-key-title">{t('page.nav.key')}</p>
        <ul>
          {used.map((reach) => (
            <li key={reach}>
              <span className="reach-dot" data-reach={reach} aria-hidden="true" />
              <span>{t(`md.reach.${reach}`)}</span>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
