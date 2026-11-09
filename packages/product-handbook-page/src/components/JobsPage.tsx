import { useLinks } from '../lib/links';
import { systemName, useText } from '../lib/text';
import type { JobRow, PageData } from '../lib/types';
import { Cell, TableScroll } from './Tables';

/** One row per scheduled-job candidate: its feature (or why it has none), the schedule the registration line gives, and what a verified item says it does. */
export function JobsPage({ data }: { data: PageData }) {
  const t = useText();
  const nav = useLinks();
  const { counts, jobs } = data.summary;
  const name = new Map(data.features.map((feature) => [feature.id, feature.name]));
  const heading = t('md.summary.jobs.heading');
  const featureCell = (job: JobRow) => (job.feature === null
    ? t('md.summary.unassigned', { reason: job.reason ?? '' })
    : <a href={nav.feature(job.feature)}>{t('md.summary.feature', { id: job.feature, name: name.get(job.feature) ?? '' })}</a>);
  return (
    <article className="page" data-view="jobs">
      <header className="page-head">
        <p className="eyebrow">{systemName(data.project, t)}</p>
        <h1 className="page-title">{heading}</h1>
      </header>
      <p className="summary-counts">{t('md.summary.jobs.counts', { total: counts.jobRows, ...counts.schedule, described: counts.described })}</p>
      <p className="muted summary-note">{t('md.summary.jobs.note')}</p>
      {jobs.length === 0 ? <p className="muted">{t('md.summary.jobs.none')}</p> : (
        <TableScroll label={heading} wide>
          <thead>
            <tr>
              <th scope="col">{t('md.table.candidate')}</th>
              <th scope="col">{t('md.table.feature')}</th>
              <th scope="col">{t('md.table.schedule')}</th>
              <th scope="col">{t('md.table.does')}</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.candidate}>
                <Cell row>{job.candidate}</Cell>
                <Cell>{featureCell(job)}</Cell>
                <td>{job.schedule.bucket === 'literal' ? <code className="schedule">{job.schedule.literal}</code> : t(`md.summary.schedule.${job.schedule.bucket}`)}</td>
                <td>
                  {job.automatic.length === 0 ? t('md.summary.noDescription') : (
                    <ul className="rule-list">
                      {job.automatic.map((item, at) => <li key={at}>{t('md.automatic.item', { when: item.when, effect: item.effect })}</li>)}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}
    </article>
  );
}
