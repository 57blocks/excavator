import { featureHash } from '../lib/route';
import { useText } from '../lib/text';
import type { PageData } from '../lib/types';
import { ReachBadge } from './ReachBadge';

/** The first page: how much the handbook holds, how readers get to the features, and the areas with their features. */
export function Overview({ data }: { data: PageData }) {
  const t = useText();
  const written = data.features.filter((feature) => feature.status === 'checked').length;
  return (
    <article className="page" data-view="overview">
      <header className="page-head">
        <p className="eyebrow">{data.project}</p>
        <h1 className="page-title">{t('page.overview.heading')}</h1>
      </header>

      <ul className="stats">
        <li className="stat"><span className="stat-value">{data.areas.length}</span><span className="stat-label">{t('page.overview.areasStat')}</span></li>
        <li className="stat"><span className="stat-value">{data.features.length}</span><span className="stat-label">{t('page.overview.featuresStat')}</span></li>
        <li className="stat"><span className="stat-value">{written}</span><span className="stat-label">{t('page.overview.writtenStat')}</span></li>
      </ul>

      <section aria-labelledby="overview-reach" className="block">
        <h2 id="overview-reach" className="block-title">{t('md.coverage.reachHeading')}</h2>
        <ul className="reach-list">
          {data.coverage.reachCounts.map(({ reach, count }) => (
            <li key={reach}>
              <ReachBadge reach={reach} />
              <span className="reach-count">{count}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="overview-areas" className="block">
        <h2 id="overview-areas" className="block-title">{t('md.areas.heading')}</h2>
        <div className="area-grid">
          {data.areas.map((area) => {
            const inArea = data.features.filter((feature) => feature.area === area.id);
            return (
              <section className="area-card" key={area.id} aria-labelledby={`area-${area.id}`}>
                <h3 className="area-name" id={`area-${area.id}`}>{area.name}</h3>
                <p className="area-count">{t('page.overview.areaCount', { count: inArea.length })}</p>
                {inArea.length === 0 ? <p className="muted">{t('md.areas.noFeatures')}</p> : (
                  <ul className="area-features">
                    {inArea.map((feature) => (
                      <li key={feature.id}>
                        <a href={featureHash(feature.id)}>{feature.name}</a>
                        <span className="area-feature-meta">
                          <ReachBadge reach={feature.reach} />
                          {feature.status !== 'checked' && <span className="status-chip" data-status={feature.status}>{t(`md.status.${feature.status}`)}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </section>
    </article>
  );
}
