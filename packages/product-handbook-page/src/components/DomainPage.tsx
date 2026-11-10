import { useLinks, useView } from '../lib/links';
import { useText } from '../lib/text';
import type { Area, PageData } from '../lib/types';
import { Crumbs } from './Crumbs';
import { ReachBadge } from './ReachBadge';
import { Cell, TableScroll } from './Tables';

/**
 * A domain (a business domain, or an area of the map when the handbook has no
 * domains file, which the page then says): what it does (only the purposes of
 * its verified features, in the words of their entries) and its features, listed
 * with no line counting them (openspec change handbook-deep-entry, D11). In the technical view, also
 * the applications that hold quoted passages of its features.
 */
export function DomainPage({ data, domain: group }: { data: PageData; domain: Area }) {
  const t = useText();
  const nav = useLinks();
  const view = useView();
  const domain = data.entities.domains.find((item) => item.id === group.id);
  const features = data.features.filter((feature) => feature.domain === group.id);
  const featureText = (id: string) => t('md.summary.feature', { id, name: data.features.find((feature) => feature.id === id)?.name ?? '' });
  const technical = view === 'technical' ? data.technical : undefined;
  const cells = technical?.applicationDomain.cells.filter((cell) => cell.domain === group.id) ?? [];
  const outside = technical?.applicationDomain.unattributed.find((row) => row.domain === group.id);
  const appName = (dir: string) => data.system.applications.find((application) => application.dir === dir)?.name ?? undefined;
  return (
    <article className="page" data-view="domain" data-domain={group.id}>
      <Crumbs trail={[group.name]} />
      <header className="page-head">
        <h1 className="page-title">{group.name}</h1>
      </header>
      <p className="muted summary-note">{t(data.domainBasis === 'domains' ? 'md.entities.domains.note' : 'md.domains.fromAreas')}</p>
      <p className="muted summary-note">{t('md.entities.domains.purposesNote')}</p>

      <section className="section" aria-labelledby="dom-does">
        <h2 className="section-title" id="dom-does">{t('md.entities.domain.whatItDoes')}</h2>
        {domain === undefined || domain.purposes.length === 0 ? <p className="muted">{t('md.none')}</p> : (
          <ul className="plain-list">
            {domain.purposes.map((item) => (
              <li key={item.feature}><a href={nav.feature(item.feature)}>{t('md.entities.domain.purposeItem', { feature: featureText(item.feature), purpose: item.text })}</a></li>
            ))}
          </ul>
        )}
      </section>

      <section className="section" aria-labelledby="dom-features">
        <h2 className="section-title" id="dom-features">{t('md.table.features')}</h2>
        {features.length === 0 ? <p className="muted">{t('md.areas.noFeatures')}</p> : (
          <ul className="area-features">
            {features.map((feature) => (
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

      {technical !== undefined && (
        <section className="section" aria-labelledby="dom-apps">
          <h2 className="section-title" id="dom-apps">{t('md.entities.applications.heading')}</h2>
          {cells.length === 0 && outside === undefined ? <p className="muted">{t('md.none')}</p> : (
            <TableScroll label={t('md.entities.applications.heading')}>
              <thead><tr><th scope="col">{t('md.table.application')}</th><th scope="col" className="num">{t('md.table.citations')}</th></tr></thead>
              <tbody>
                {cells.map((cell) => (
                  <tr key={cell.application}><Cell row><a href={nav.application(cell.application)}>{appName(cell.application) ?? cell.application}</a></Cell><td className="num">{cell.citations}</td></tr>
                ))}
                {outside !== undefined && <tr><Cell row>{t('md.matrix.applicationDomain.outside')}</Cell><td className="num">{outside.citations}</td></tr>}
              </tbody>
            </TableScroll>
          )}
        </section>
      )}
    </article>
  );
}
