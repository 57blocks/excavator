import { useLinks } from '../lib/links';
import { systemName, useText } from '../lib/text';
import type { ApplicationFacts, PageData, Technical } from '../lib/types';
import { Crumbs } from './Crumbs';
import { Cell, TableScroll } from './Tables';

function Facts({ application }: { application: ApplicationFacts }) {
  const t = useText();
  const none = t('md.overview.noHistory');
  const { history } = application;
  const list = (items: string[]) => (items.length === 0 ? t('md.none') : items.join(', '));
  const rows: [string, string | number][] = [
    ['md.table.languages', list(application.languages.map((entry) => t('md.overview.languageItem', { language: entry.language, files: entry.files })))],
    ['md.table.frameworks', list(application.frameworks.map((entry) => t('md.overview.frameworkItem', { framework: entry.framework, count: entry.candidates })))],
    ['md.table.files', application.files],
    ['md.table.lines', application.lines],
    ['md.table.firstCommit', history === null ? none : history.first],
    ['md.table.lastCommit', history === null ? none : history.last],
    ['md.table.commits', history === null ? none : history.commits],
    ['md.table.authors', history === null ? none : history.authors],
  ];
  return (
    <dl className="facts">
      {rows.map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd>{value}</dd></div>)}
    </dl>
  );
}

/**
 * An application: what the verified overview says it is, the script's facts,
 * the features whose quoted passages fall in it (longest matching directory),
 * the domains of those features, the scheduled jobs registered in its files and
 * the external systems with each relation named for what was checked.
 */
export function ApplicationPage({ data, technical, dir }: { data: PageData; technical: Technical; dir: string }) {
  const t = useText();
  const nav = useLinks();
  const application = data.system.applications.find((item) => item.dir === dir);
  if (application === undefined) return null;
  const featureText = (id: string) => t('md.summary.feature', { id, name: data.features.find((feature) => feature.id === id)?.name ?? '' });
  const features = technical.featureApplication.filter((row) => row.application === dir);
  const domains = technical.applicationDomain.cells.filter((cell) => cell.application === dir);
  const jobs = technical.jobs.filter((job) => job.application === dir);
  const reasonOf = new Map(data.summary.jobs.map((job) => [job.candidate, job.reason ?? '']));
  const shown = technical.integrations.filter((item) => item.shown.includes(dir));
  const named = technical.integrations.flatMap((item) => item.named.filter((entry) => entry.application === dir).map((entry) => ({ system: item.system, files: entry.files })));
  const domainName = (id: string) => data.domains.find((domain) => domain.id === id)?.name ?? id;
  return (
    <article className="page" data-view="application" data-application={dir}>
      <Crumbs trail={[application.dir]} />
      <header className="page-head">
        <h1 className="page-title">{application.name ?? application.dir}</h1>
        <p className="lede">{application.does ?? t('md.overview.notVerified')}</p>
      </header>
      <p className="muted summary-note">{t('md.entities.applications.note')}</p>
      <Facts application={application} />

      <section className="section" aria-labelledby="app-features">
        <h2 className="section-title" id="app-features">{t('md.entities.app.featuresHeading')}</h2>
        {features.length === 0 ? <p className="muted">{t('md.none')}</p> : (
          <TableScroll label={t('md.entities.app.featuresHeading')}>
            <thead><tr><th scope="col">{t('md.table.feature')}</th><th scope="col" className="num">{t('md.table.citations')}</th></tr></thead>
            <tbody>{features.map((row) => <tr key={row.feature}><Cell row><a href={nav.feature(row.feature)}>{featureText(row.feature)}</a></Cell><td className="num">{row.citations}</td></tr>)}</tbody>
          </TableScroll>
        )}
      </section>

      <section className="section" aria-labelledby="app-domains">
        <h2 className="section-title" id="app-domains">{t('md.entities.app.domainsHeading')}</h2>
        {domains.length === 0 ? <p className="muted">{t('md.none')}</p> : (
          <TableScroll label={t('md.entities.app.domainsHeading')}>
            <thead><tr><th scope="col">{t('md.table.domain')}</th><th scope="col" className="num">{t('md.table.citations')}</th></tr></thead>
            <tbody>{domains.map((cell) => <tr key={cell.domain}><Cell row><a href={nav.domain(cell.domain)}>{domainName(cell.domain)}</a></Cell><td className="num">{cell.citations}</td></tr>)}</tbody>
          </TableScroll>
        )}
      </section>

      <section className="section" aria-labelledby="app-jobs">
        <h2 className="section-title" id="app-jobs">{t('md.entities.app.jobsHeading')}</h2>
        {jobs.length === 0 ? <p className="muted">{t('md.none')}</p> : (
          <TableScroll label={t('md.entities.app.jobsHeading')}>
            <thead><tr><th scope="col">{t('md.table.candidate')}</th><th scope="col">{t('md.table.feature')}</th></tr></thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.candidate}>
                  <Cell row>{job.candidate}</Cell>
                  <Cell>{job.feature === null ? t('md.summary.unassigned', { reason: reasonOf.get(job.candidate) ?? '' }) : <a href={nav.feature(job.feature)}>{featureText(job.feature)}</a>}</Cell>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        )}
      </section>

      <section className="section" aria-labelledby="app-shown">
        <h2 className="section-title" id="app-shown">{t('md.entities.app.shownHeading')}</h2>
        {shown.length === 0 ? <p className="muted">{t('md.none')}</p> : <ul className="plain-list">{shown.map((item) => <li key={item.system}><a href={nav.system(item.system)}>{item.system}</a></li>)}</ul>}
      </section>

      <section className="section" aria-labelledby="app-named">
        <h2 className="section-title" id="app-named">{t('md.entities.app.namedHeading')}</h2>
        {named.length === 0 ? <p className="muted">{t('md.none')}</p> : (
          <ul className="plain-list">{named.map((item) => <li key={item.system}><a href={nav.system(item.system)}>{t('md.entities.app.namedItem', item)}</a></li>)}</ul>
        )}
      </section>
    </article>
  );
}

/** Applications by domain: a cell is the number of quoted passages of the domain's verified features that fall in the application; the last row counts those that fall in none. */
export function ApplicationsMatrixPage({ data, technical }: { data: PageData; technical: Technical }) {
  const t = useText();
  const nav = useLinks();
  const heading = t('md.matrix.applicationDomain.heading');
  const { applications, domains, cells, unattributed } = technical.applicationDomain;
  const domainName = (id: string) => data.domains.find((domain) => domain.id === id)?.name ?? id;
  const appName = (dir: string) => data.system.applications.find((application) => application.dir === dir)?.name ?? undefined;
  return (
    <article className="page" data-view="applications-matrix">
      <header className="page-head">
        <p className="eyebrow">{systemName(data.project, t)}</p>
        <h1 className="page-title">{heading}</h1>
      </header>
      <p className="muted summary-note">{t('md.matrix.applicationDomain.note')}</p>
      {applications.length === 0 && unattributed.length === 0 ? <p className="muted">{t('md.none')}</p> : (
        <TableScroll label={heading} wide>
          <thead>
            <tr>
              <th scope="col">{t('md.table.application')}</th>
              {domains.map((id) => <th scope="col" className="num" key={id}><a href={nav.domain(id)}>{domainName(id)}</a></th>)}
            </tr>
          </thead>
          <tbody>
            {applications.map((dir) => (
              <tr key={dir}>
                <Cell row><a href={nav.application(dir)}>{appName(dir) ?? dir}</a></Cell>
                {domains.map((id) => <Cell key={id}>{cells.find((cell) => cell.application === dir && cell.domain === id)?.citations}</Cell>)}
              </tr>
            ))}
            <tr>
              <Cell row>{t('md.matrix.applicationDomain.outside')}</Cell>
              {domains.map((id) => <Cell key={id}>{unattributed.find((row) => row.domain === id)?.citations}</Cell>)}
            </tr>
          </tbody>
        </TableScroll>
      )}
    </article>
  );
}
