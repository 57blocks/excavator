import { useLinks, useView } from '../lib/links';
import { systemName, useText } from '../lib/text';
import type { PageData } from '../lib/types';
import { Locations } from './Locations';
import { FlowChart } from './FlowChart';
import { ReachBadge } from './ReachBadge';
import { SystemOverview } from './SystemOverview';

/**
 * The first page: how much the handbook holds, the system overview, the business flow between domains, in the technical view
 * the applications and the external systems they call (openspec change handbook-domain-page, D4, D5), how readers get to the
 * features, and the domains with their features.
 */
export function Overview({ data }: { data: PageData }) {
  const t = useText();
  const nav = useLinks();
  const view = useView();
  const overviewPlaces = view === 'technical' ? data.technical?.locations.find((unit) => unit.id === 'overview') : undefined;
  const written = data.features.filter((feature) => feature.status === 'verified').length;
  const flows = data.entities.domainFlows ?? [];
  const technical = view === 'technical' ? data.technical : undefined;
  // handbook-domain-page D5: only the callers the verified overview shows; the names a search found are not calls.
  const calls = (technical?.integrations ?? []).filter((item) => item.shown.length > 0);
  const callers = [...new Set(calls.flatMap((item) => item.shown))];
  return (
    <article className="page" data-view="overview">
      <header className="page-head">
        <p className="eyebrow">{systemName(data.project, t)}</p>
        <h1 className="page-title">{t('page.overview.heading')}</h1>
      </header>

      <ul className="stats">
        <li className="stat"><span className="stat-value">{data.domains.length}</span><span className="stat-label">{t(data.domainBasis === 'domains' ? 'page.overview.domainsStat' : 'page.overview.areasStat')}</span></li>
        <li className="stat"><span className="stat-value">{data.features.length}</span><span className="stat-label">{t('page.overview.featuresStat')}</span></li>
        <li className="stat"><span className="stat-value">{written}</span><span className="stat-label">{t('page.overview.writtenStat')}</span></li>
      </ul>

      <SystemOverview data={data} />
      {overviewPlaces !== undefined && <Locations unit={overviewPlaces} id="overview-locations" title={t('md.locations.overviewHeading')} />}

      <section aria-labelledby="overview-flow" className="block" data-part="overview-flow">
        <h2 id="overview-flow" className="block-title">{t('md.entities.domains.flowHeading')}</h2>
        {flows.length === 0 ? <p className="muted">{t('md.entities.domains.flowNone')}</p> : (
          <>
            <p className="muted summary-note">{t('md.entities.domains.flowNote')}</p>
            <FlowChart
              part="flow-chart"
              label={t('md.entities.domains.flowHeading')}
              nodes={data.domains.filter((domain) => flows.some((flow) => flow.from === domain.id || flow.to === domain.id)).map((domain) => ({ id: domain.id, label: domain.name, href: nav.domain(domain.id) }))}
              edges={flows.map((flow) => ({ from: flow.from, to: flow.to, count: flow.count, href: nav.domain(flow.from) }))}
            />
          </>
        )}
      </section>

      {technical !== undefined && (
        <section aria-labelledby="overview-architecture" className="block" data-part="overview-architecture">
          <h2 id="overview-architecture" className="block-title">{t('md.entities.systems.diagramHeading')}</h2>
          {calls.length === 0 ? <p className="muted">{t('md.entities.systems.diagramNone')}</p> : (
            <>
              <p className="muted summary-note">{t('md.entities.systems.diagramNote')}</p>
              <FlowChart
                part="architecture-chart"
                label={t('md.entities.systems.diagramHeading')}
                nodes={[
                  ...callers.map((dir) => ({ id: `a:${dir}`, label: data.system.applications.find((application) => application.dir === dir)?.name ?? dir, href: nav.application(dir) })),
                  ...calls.map((item) => ({ id: `s:${item.system}`, label: item.system, href: nav.system(item.system), kind: 'system' as const })),
                ]}
                edges={calls.flatMap((item) => item.shown.map((dir) => ({ from: `a:${dir}`, to: `s:${item.system}` })))}
              />
            </>
          )}
        </section>
      )}

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
        <h2 id="overview-areas" className="block-title">{t(data.domainBasis === 'domains' ? 'md.domains.heading' : 'md.areas.heading')}</h2>
        {data.domainBasis === 'areas' && <p className="muted">{t('md.domains.fromAreas')}</p>}
        <div className="area-grid">
          {data.domains.map((domain) => {
            const inArea = data.features.filter((feature) => feature.domain === domain.id);
            return (
              <section className="area-card" key={domain.id} aria-labelledby={`area-${domain.id}`}>
                <h3 className="area-name" id={`area-${domain.id}`}><a href={nav.domain(domain.id)}>{domain.name}</a></h3>
                <p className="area-count">{t('page.overview.areaCount', { count: inArea.length })}</p>
                {inArea.length === 0 ? <p className="muted">{t('md.areas.noFeatures')}</p> : (
                  <ul className="area-features">
                    {inArea.map((feature) => (
                      <li key={feature.id}>
                        <a href={nav.feature(feature.id)}>{feature.name}</a>
                        <span className="area-feature-meta">
                          <ReachBadge reach={feature.reach} />
                          {feature.status !== 'verified' && <span className="status-chip" data-status={feature.status}>{t(`md.status.${feature.status}`)}</span>}
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
