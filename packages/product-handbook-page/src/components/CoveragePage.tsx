import { useLinks } from '../lib/links';
import { systemName, useText } from '../lib/text';
import { findingCategoryKey } from '../lib/types';
import type { PageData, RemovedItem } from '../lib/types';
import { CheckIcon } from './Icons';
import { ReachBadge } from './ReachBadge';
import { Cell, TableScroll } from './Tables';

/** The items one unit lost to verification: each claim with its result and the reason a reader may see. */
function RemovedTable({ items }: { items: RemovedItem[] }) {
  const t = useText();
  return (
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
  );
}

/** The ranking of the findings: the groups without a priority with the reasons of the judges, that the ranking did not finish, or that every group has a priority. */
function PriorityCoverage({ data }: { data: PageData }) {
  const t = useText();
  const { finished, unranked } = data.coverage.priority;
  return (
    <section className="section" aria-labelledby="cov-priority">
      <h2 className="section-title" id="cov-priority">{t('md.coverage.priorityHeading')}</h2>
      {data.findings.length === 0 && <p className="muted">{t('md.none')}</p>}
      {data.findings.length > 0 && !finished && <p className="muted" data-part="priority-not-finished">{t('md.coverage.priorityNotFinished', { count: data.findings.length })}</p>}
      {data.findings.length > 0 && finished && unranked.length === 0 && <p className="muted" data-part="priority-all-ranked">{t('md.coverage.priorityAllRanked')}</p>}
      {data.findings.length > 0 && finished && unranked.length > 0 && (
        <>
          <p className="muted" data-part="priority-unranked">{t('md.coverage.priorityUnranked', { count: unranked.length })}</p>
          <TableScroll label={t('md.coverage.priorityHeading')} wide>
            <thead>
              <tr><th scope="col">{t('md.findings.claimLabel')}</th><th scope="col">{t('md.table.reason')}</th></tr>
            </thead>
            <tbody>
              {unranked.map((row) => (
                <tr key={row.id}>
                  <Cell row>{t('md.findings.featureItem', { category: t(findingCategoryKey(row.category)), text: row.text })}</Cell>
                  <Cell>{row.reasons.length === 0 ? t('md.priority.notJudged') : row.reasons.join('; ')}</Cell>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        </>
      )}
    </section>
  );
}

/** The features whose findings are not verified, and the findings verification removed, as the two parts of the handbook's coverage section. */
function FindingsCoverage({ data }: { data: PageData }) {
  const t = useText();
  const nav = useLinks();
  const { coverage } = data;
  const areaName = new Map(data.areas.map((area) => [area.id, area.name]));
  const itemValues = (feature: PageData['features'][number]) => ({ id: feature.id, name: feature.name, area: areaName.get(feature.area) ?? '' });
  const unfinished = coverage.findingsUnfinished.flatMap((row) => {
    const feature = data.features.find((item) => item.id === row.feature);
    return feature === undefined ? [] : [{ feature, status: row.status }];
  });
  const removed = coverage.findingsRemoved.flatMap((group) => {
    const feature = data.features.find((item) => item.id === group.feature);
    return feature === undefined ? [] : [{ feature, items: group.items }];
  });
  return (
    <>
      <section className="section" aria-labelledby="cov-findings-unfinished">
        <h2 className="section-title" id="cov-findings-unfinished">{t('md.coverage.findingsUnfinishedHeading')}</h2>
        {coverage.findingsNotWritten > 0 && <p className="muted" data-part="findings-not-written">{t('md.coverage.findingsNotWritten', { count: coverage.findingsNotWritten })}</p>}
        {unfinished.length === 0 && coverage.findingsNotWritten === 0 ? <p className="muted">{t('md.coverage.findingsAllVerified')}</p> : unfinished.length === 0 ? null : (
          <TableScroll label={t('md.coverage.findingsUnfinishedHeading')}>
            <thead><tr><th scope="col">{t('md.table.feature')}</th><th scope="col">{t('md.table.status')}</th></tr></thead>
            <tbody>
              {unfinished.map(({ feature, status }) => (
                <tr key={feature.id}>
                  <Cell row><a href={nav.feature(feature.id)}>{t('md.coverage.findingsUnfinishedItem', itemValues(feature))}</a></Cell>
                  <td><span className="status-chip" data-status={status}>{t(`md.status.${status}`)}</span></td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        )}
        {coverage.systemFindingsNotWritten > 0 && <p className="muted" data-part="system-findings-not-written">{t('md.coverage.systemFindingsNotWritten', { count: coverage.systemFindingsNotWritten })}</p>}
        {coverage.systemFindingsNotWritten === 0 && coverage.systemFindingsUnfinished.length === 0 && coverage.systemFindingsTotal > 0 && <p className="muted" data-part="system-findings-all-verified">{t('md.coverage.systemFindingsAllVerified')}</p>}
        {coverage.systemFindingsUnfinished.length > 0 && (
          <TableScroll label={t('md.table.application')}>
            <thead><tr><th scope="col">{t('md.table.application')}</th><th scope="col">{t('md.table.status')}</th></tr></thead>
            <tbody>
              {coverage.systemFindingsUnfinished.map((row) => (
                <tr key={row.id}>
                  <Cell row>{t('md.findings.applicationOwner', { name: row.name })}</Cell>
                  <td><span className="status-chip" data-status={row.status}>{t(`md.status.${row.status}`)}</span></td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        )}
      </section>

      <section className="section" aria-labelledby="cov-findings-removed">
        <h2 className="section-title" id="cov-findings-removed">{t('md.coverage.findingsRemovedHeading')}</h2>
        {removed.length === 0 && coverage.systemFindingsRemoved.length === 0 ? <p className="muted">{t('md.none')}</p> : null}
        {removed.map(({ feature, items }) => (
          <div key={feature.id} className="removed-group">
            <h3 className="block-title"><a href={nav.feature(feature.id)}>{t('md.coverage.findingsRemovedFeature', { ...itemValues(feature), count: items.length })}</a></h3>
            <RemovedTable items={items} />
          </div>
        ))}
        {coverage.systemFindingsRemoved.map((application) => (
          <div key={application.id} className="removed-group">
            <h3 className="block-title">{t('md.coverage.systemFindingsRemoved', { owner: t('md.findings.applicationOwner', { name: application.name }), count: application.items.length })}</h3>
            <RemovedTable items={application.items} />
          </div>
        ))}
      </section>

      <PriorityCoverage data={data} />
    </>
  );
}

/** What the handbook covers: the candidate count and its conservation, the unassigned candidates, link features, the features without a verified entry and the items verification removed. */
export function CoveragePage({ data }: { data: PageData }) {
  const t = useText();
  const nav = useLinks();
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
        <p className="eyebrow">{systemName(data.project, t)}</p>
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
            {links.map((feature) => <li key={feature.id}><a href={nav.feature(feature.id)}>{t('md.coverage.linkItem', itemValues(feature))}</a></li>)}
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
                  <Cell row><a href={nav.feature(feature.id)}>{t('md.coverage.unwrittenItem', itemValues(feature))}</a></Cell>
                  <td><span className="status-chip" data-status={feature.status}>{t(`md.status.${feature.status}`)}</span></td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        )}
      </section>

      <section className="section" aria-labelledby="cov-removed">
        <h2 className="section-title" id="cov-removed">{t('md.coverage.removedHeading')}</h2>
        {removed.length === 0 && coverage.removedOverview.length === 0 ? <p className="muted">{t('md.none')}</p> : null}
        {coverage.removedOverview.length === 0 ? null : (
          <div className="removed-group">
            <h3 className="block-title">{t('md.coverage.removedOverview', { name: t('md.overview.heading'), count: coverage.removedOverview.length })}</h3>
            <RemovedTable items={coverage.removedOverview} />
          </div>
        )}
        {removed.map(({ feature, items }) => (
          <div key={feature.id} className="removed-group">
            <h3 className="block-title"><a href={nav.feature(feature.id)}>{t('md.coverage.removedFeature', { ...itemValues(feature), count: items.length })}</a></h3>
            <RemovedTable items={items} />
          </div>
        ))}
      </section>

      <FindingsCoverage data={data} />
    </article>
  );
}
