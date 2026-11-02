import { REACHES } from '../lib/types';
import type { Area, Feature } from '../lib/types';
import { COVERAGE_HASH, JOBS_HASH, NOTIFICATIONS_HASH, OVERVIEW_HASH, featureHash } from '../lib/route';
import type { Route } from '../lib/route';
import { useText } from '../lib/text';
import { BellIcon, ClockIcon, CoverageIcon, OverviewIcon } from './Icons';
import { ReachDot } from './ReachBadge';

interface Props {
  areas: Area[];
  features: Feature[];
  route: Route;
  open: boolean;
  onNavigate: () => void;
}

/**
 * The navigation: overview, the two cross-cutting tables, coverage, then the areas with their features, each
 * feature marked with its reach, and a key to the marks. Below 900px it is a
 * drawer that the top bar's button opens.
 */
export function Sidebar({ areas, features, route, open, onNavigate }: Props) {
  const t = useText();
  const currentId = route.name === 'feature' ? route.id : '';
  const used = REACHES.filter((reach) => features.some((feature) => feature.reach === reach));
  return (
    <nav
      className="rail"
      id="rail"
      aria-label={t('page.nav.label')}
      data-open={open}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('a')) onNavigate();
      }}
    >
      <div className="rail-top">
        <a className="rail-link" href={OVERVIEW_HASH} aria-current={route.name === 'overview' ? 'page' : undefined}>
          <OverviewIcon />
          <span>{t('page.nav.overview')}</span>
        </a>
        <a className="rail-link" href={NOTIFICATIONS_HASH} aria-current={route.name === 'notifications' ? 'page' : undefined}>
          <BellIcon />
          <span>{t('page.nav.notifications')}</span>
        </a>
        <a className="rail-link" href={JOBS_HASH} aria-current={route.name === 'jobs' ? 'page' : undefined}>
          <ClockIcon />
          <span>{t('page.nav.jobs')}</span>
        </a>
        <a className="rail-link" href={COVERAGE_HASH} aria-current={route.name === 'coverage' ? 'page' : undefined}>
          <CoverageIcon />
          <span>{t('page.nav.coverage')}</span>
        </a>
      </div>
      <div className="rail-scroll">
        {areas.map((area) => {
          const inArea = features.filter((feature) => feature.area === area.id);
          return (
            <section className="rail-area" key={area.id} aria-labelledby={`rail-area-${area.id}`}>
              <h2 className="rail-area-name" id={`rail-area-${area.id}`}>{area.name}</h2>
              {inArea.length === 0 && <p className="rail-empty">{t('md.areas.noFeatures')}</p>}
              {inArea.map((feature) => (
                <a
                  className="rail-feature"
                  key={feature.id}
                  href={featureHash(feature.id)}
                  aria-current={currentId === feature.id ? 'page' : undefined}
                >
                  <span className="rail-feature-name">{feature.name}</span>
                  <ReachDot reach={feature.reach} />
                </a>
              ))}
            </section>
          );
        })}
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
