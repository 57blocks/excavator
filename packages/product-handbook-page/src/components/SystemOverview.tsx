import { useText } from '../lib/text';
import type { ApplicationFacts, PageData } from '../lib/types';
import { Cell, TableScroll } from './Tables';

/** The cell text of a list of facts: its items joined, or an empty cell. */
const listText = (items: string[]): string | undefined => (items.length === 0 ? undefined : items.join(', '));

function ApplicationRow({ application }: { application: ApplicationFacts }) {
  const t = useText();
  const { history } = application;
  const none = t('md.overview.noHistory');
  const unverified = t('md.overview.notVerified');
  return (
    <tr>
      <Cell row>{application.dir}</Cell>
      <Cell>{application.name ?? unverified}</Cell>
      <Cell>{application.does ?? unverified}</Cell>
      <Cell>{listText(application.languages.map((entry) => t('md.overview.languageItem', { language: entry.language, files: entry.files })))}</Cell>
      <Cell>{listText(application.frameworks.map((entry) => t('md.overview.frameworkItem', { framework: entry.framework, count: entry.candidates })))}</Cell>
      <td className="num">{application.files}</td>
      <td className="num">{application.lines}</td>
      <Cell>{history === null ? none : history.first}</Cell>
      <Cell>{history === null ? none : history.last}</Cell>
      {history === null ? <Cell>{none}</Cell> : <td className="num">{history.commits}</td>}
      {history === null ? <Cell>{none}</Cell> : <td className="num">{history.authors}</td>}
    </tr>
  );
}

/**
 * The system overview on the overview page: what the system is and who uses it
 * (from the verified overview), the counts and the applications with the
 * script's facts, the external systems, what the code does not settle, and the
 * areas with their roles. The counts, the application rows and the area table
 * are the script's and do not depend on the overview; an overview that is not
 * verified replaces only the sections a model writes with a line saying where it
 * stopped.
 */
export function SystemOverview({ data }: { data: PageData }) {
  const t = useText();
  const { system } = data;
  const { overview, counts } = system;
  return (
    <div data-part="system">
      {overview === null
        ? <p className="muted summary-note" role="note">{t('md.overview.notWritten', { step: t(`md.status.${system.status}`) })}</p>
        : <h2 className="block-title">{t('md.overview.heading')}</h2>}
      <p className="summary-counts">{t('md.overview.counts', { ...counts, verified: counts.featuresWithEntry })}</p>

      {overview !== null && (
        <>
          <section className="section" aria-labelledby="sys-purpose">
            <h2 className="section-title" id="sys-purpose">{t('md.section.purpose')}</h2>
            {overview.summary.length === 0 ? <p className="muted">{t('md.none')}</p> : overview.summary.map((text, at) => <p key={at}>{text}</p>)}
          </section>

          <section className="section" aria-labelledby="sys-audiences">
            <h2 className="section-title" id="sys-audiences">{t('md.overview.audiencesHeading')}</h2>
            {overview.audiences.length === 0 ? <p className="muted">{t('md.none')}</p> : (
              <TableScroll label={t('md.overview.audiencesHeading')}>
                <thead><tr><th scope="col">{t('md.table.who')}</th><th scope="col">{t('md.table.does')}</th></tr></thead>
                <tbody>{overview.audiences.map((entry, at) => <tr key={at}><Cell row>{entry.who}</Cell><Cell>{entry.does}</Cell></tr>)}</tbody>
              </TableScroll>
            )}
          </section>
        </>
      )}

      <section className="section" aria-labelledby="sys-applications">
        <h2 className="section-title" id="sys-applications">{t('md.overview.applicationsHeading')}</h2>
        {system.applications.length === 0 ? <p className="muted">{t('md.none')}</p> : (
          <TableScroll label={t('md.overview.applicationsHeading')} wide>
            <thead>
              <tr>
                {['md.table.directory', 'md.table.name', 'md.table.does', 'md.table.languages', 'md.table.frameworks'].map((key) => <th scope="col" key={key}>{t(key)}</th>)}
                {['md.table.files', 'md.table.lines'].map((key) => <th scope="col" className="num" key={key}>{t(key)}</th>)}
                {['md.table.firstCommit', 'md.table.lastCommit'].map((key) => <th scope="col" key={key}>{t(key)}</th>)}
                {['md.table.commits', 'md.table.authors'].map((key) => <th scope="col" className="num" key={key}>{t(key)}</th>)}
              </tr>
            </thead>
            <tbody>{system.applications.map((application, at) => <ApplicationRow application={application} key={at} />)}</tbody>
          </TableScroll>
        )}
      </section>

      {overview !== null && (
        <>
          <section className="section" aria-labelledby="sys-integrations">
            <h2 className="section-title" id="sys-integrations">{t('md.overview.integrationsHeading')}</h2>
            {overview.integrations.length === 0 ? <p className="muted">{t('md.none')}</p> : (
              <TableScroll label={t('md.overview.integrationsHeading')} wide>
                <thead><tr><th scope="col">{t('md.table.system')}</th><th scope="col">{t('md.table.use')}</th><th scope="col">{t('md.table.callers')}</th></tr></thead>
                <tbody>{overview.integrations.map((entry, at) => <tr key={at}><Cell row>{entry.system}</Cell><Cell>{entry.use}</Cell><Cell>{entry.callers.join(', ')}</Cell></tr>)}</tbody>
              </TableScroll>
            )}
          </section>

          <section className="section" aria-labelledby="sys-unknowns">
            <h2 className="section-title" id="sys-unknowns">{t('md.section.unknowns')}</h2>
            {overview.unknowns.length === 0 ? <p className="muted">{t('md.none')}</p> : (
              <ul className="plain-list">{overview.unknowns.map((entry, at) => <li key={at}>{t('md.unknown.item', { item: entry.item, searched: entry.searched })}</li>)}</ul>
            )}
          </section>
        </>
      )}

      <section className="section" aria-labelledby="sys-areas">
        <h2 className="section-title" id="sys-areas">{t('md.overview.areasHeading')}</h2>
        <TableScroll label={t('md.overview.areasHeading')} wide>
          <thead>
            <tr>
              <th scope="col">{t('md.table.area')}</th>
              <th scope="col" className="num">{t('md.table.features')}</th>
              <th scope="col" className="num">{t('md.table.verified')}</th>
              <th scope="col">{t('md.table.roles')}</th>
            </tr>
          </thead>
          <tbody>
            {system.areas.map((area) => (
              <tr key={area.id}><Cell row>{area.name}</Cell><td className="num">{area.features}</td><td className="num">{area.verified}</td><Cell>{listText(area.roles)}</Cell></tr>
            ))}
          </tbody>
        </TableScroll>
      </section>
    </div>
  );
}
