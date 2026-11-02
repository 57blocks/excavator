import { featureHash } from '../lib/route';
import { useText } from '../lib/text';
import type { PageData } from '../lib/types';
import { CheckIcon } from './Icons';
import { ReachBadge } from './ReachBadge';
import { Cell, TableScroll } from './Tables';

/** What the handbook covers: the candidate count and its conservation, the unassigned candidates, link features, the features without a verified entry and the items verification removed. */
export function CoveragePage({ data }: { data: PageData }) {
  const t = useText();
  const { coverage } = data;
  const areaName = new Map(data.areas.map((area) => [area.id, area.name]));
  const itemValues = (feature: PageData['features'][number]) => ({ id: feature.id, name: feature.name, area: areaName.get(feature.area) ?? '' });
  const links = data.features.filter((feature) => feature.reach === 'link');
  const unwritten = data.features.filter((feature) => feature.status !== 'verified');
  const removed = coverage.removed.flatMap((group) => {
    const feature = data.features.find((item) => item.id === group.feature);
    return feature === undefined ? [] : [{ feature, items: group.items }];
  });
  return (
    <article className="page" data-view="coverage">
      <header className="page-head">
        <p className="eyebrow">{data.project}</p>
        <h1 className="page-title">{t('md.coverage.heading')}</h1>
      </header>

      <div className="callout" role="note">
        <CheckIcon />
        <p>{t('md.coverage.conserved', { total: coverage.candidateTotal, assigned: coverage.assigned, unassigned: coverage.unassigned.length })}</p>
      </div>

      <section className="section" aria-labelledby="cov-reach">
        <h2 className="section-title" id="cov-reach">{t('md.coverage.reachHeading')}</h2>
        <TableScroll label={t('md.coverage.reachHeading')}>
          <thead><tr><th scope="col">{t('md.table.reach')}</th><th scope="col" className="num">{t('md.table.features')}</th></tr></thead>
          <tbody>
            {coverage.reachCounts.map(({ reach, count }) => (
              <tr key={reach}><Cell row><ReachBadge reach={reach} /></Cell><td className="num">{count}</td></tr>
            ))}
          </tbody>
        </TableScroll>
      </section>

      <section className="section" aria-labelledby="cov-links">
        <h2 className="section-title" id="cov-links">{t('md.coverage.linkHeading')}</h2>
        {links.length === 0 ? <p className="muted">{t('md.none')}</p> : (
          <ul className="plain-list">
            {links.map((feature) => <li key={feature.id}><a href={featureHash(feature.id)}>{t('md.coverage.linkItem', itemValues(feature))}</a></li>)}
          </ul>
        )}
      </section>

      <section className="section" aria-labelledby="cov-unassigned">
        <h2 className="section-title" id="cov-unassigned">{t('md.coverage.unassignedHeading')}</h2>
        {coverage.unassigned.length === 0 ? <p className="muted">{t('md.none')}</p> : (
          <TableScroll label={t('md.coverage.unassignedHeading')} wide>
            <thead>
              <tr><th scope="col">{t('md.table.candidate')}</th><th scope="col">{t('md.table.kind')}</th><th scope="col">{t('md.table.reason')}</th></tr>
            </thead>
            <tbody>
              {coverage.unassigned.map((item) => (
                <tr key={item.candidate}><Cell row>{item.candidate}</Cell><Cell>{t(`md.kind.${item.kind}`)}</Cell><Cell>{item.reason}</Cell></tr>
              ))}
            </tbody>
          </TableScroll>
        )}
      </section>

      <section className="section" aria-labelledby="cov-unwritten">
        <h2 className="section-title" id="cov-unwritten">{t('md.coverage.unwrittenHeading')}</h2>
        {unwritten.length === 0 ? <p className="muted">{t('md.coverage.allWritten')}</p> : (
          <TableScroll label={t('md.coverage.unwrittenHeading')}>
            <thead><tr><th scope="col">{t('md.table.feature')}</th><th scope="col">{t('md.table.status')}</th></tr></thead>
            <tbody>
              {unwritten.map((feature) => (
                <tr key={feature.id}>
                  <Cell row><a href={featureHash(feature.id)}>{t('md.coverage.unwrittenItem', itemValues(feature))}</a></Cell>
                  <td><span className="status-chip" data-status={feature.status}>{t(`md.status.${feature.status}`)}</span></td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        )}
      </section>

      <section className="section" aria-labelledby="cov-removed">
        <h2 className="section-title" id="cov-removed">{t('md.coverage.removedHeading')}</h2>
        {removed.length === 0 ? <p className="muted">{t('md.none')}</p> : removed.map(({ feature, items }) => (
          <div key={feature.id} className="removed-group">
            <h3 className="block-title"><a href={featureHash(feature.id)}>{t('md.coverage.removedFeature', { ...itemValues(feature), count: items.length })}</a></h3>
            <TableScroll label={t('md.coverage.removedHeading')} wide>
              <thead>
                <tr><th scope="col">{t('md.table.item')}</th><th scope="col">{t('md.table.result')}</th><th scope="col">{t('md.table.reason')}</th></tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={index}><Cell row>{item.claim}</Cell><Cell>{t(`md.verdict.${item.verdict}`)}</Cell><Cell>{item.reason === '' ? undefined : item.reason}</Cell></tr>
                ))}
              </tbody>
            </TableScroll>
          </div>
        ))}
      </section>
    </article>
  );
}
