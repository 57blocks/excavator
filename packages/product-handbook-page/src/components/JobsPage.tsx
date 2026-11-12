import { useLinks } from '../lib/links';
import { systemName, useText } from '../lib/text';
import type { JobRow, PageData } from '../lib/types';
import { Item, ItemField, ItemList } from './ui/ItemList';
import { StatStrip } from './ui/StatStrip';
import { PageTitle } from '../lib/outline';

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
        <PageTitle fallback={heading} />
      </header>
      <StatStrip part="jobs-stats" stats={[
        { label: t('page.stat.jobsListed'), value: counts.jobRows },
        { label: t('page.stat.jobsLiteral'), value: counts.schedule.literal },
        { label: t('page.stat.jobsComputed'), value: counts.schedule.computed },
        { label: t('page.stat.jobsAbsent'), value: counts.schedule.absent },
        { label: t('page.stat.jobsDescribed'), value: counts.described },
      ]} />
      <p className="muted summary-note">{t('md.summary.jobs.note')}</p>
      {jobs.length === 0 ? <p className="muted">{t('md.summary.jobs.none')}</p> : (
        <ItemList part="jobs" label={heading}>
          {jobs.map((job) => (
            <Item
              key={job.candidate}
              note={job.feature === null ? <p>{featureCell(job)}</p> : undefined}
              attrs={(
                <>
                  <code className="item-code">{job.candidate}</code>
                  {job.feature !== null && <span className="item-owner">{featureCell(job)}</span>}
                  <span className="channel-chip">{job.schedule.bucket === 'literal' ? <code className="schedule">{job.schedule.literal}</code> : t(`md.summary.schedule.${job.schedule.bucket}`)}</span>
                </>
              )}
            >
              <ItemField label={t('md.table.does')}>
                {job.automatic.length === 0 ? t('md.summary.noDescription') : (
                  <ul className="rule-list">
                    {job.automatic.map((item, at) => <li key={at}>{t('md.automatic.item', { when: item.when, effect: item.effect })}</li>)}
                  </ul>
                )}
              </ItemField>
            </Item>
          ))}
        </ItemList>
      )}
    </article>
  );
}
