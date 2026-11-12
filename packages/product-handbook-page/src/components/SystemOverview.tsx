import { useLinks, useView } from '../lib/links';
import { useText } from '../lib/text';
import type { ApplicationFacts, PageData } from '../lib/types';
import { Cell, TableScroll } from './Tables';
import { Definition, DefinitionList, Item, ItemList } from './ui/ItemList';

/** The cell text of a list of facts: its items joined, or an empty cell. */
const listText = (items: string[]): string | undefined => (items.length === 0 ? undefined : items.join(', '));

function ApplicationItem({ application }: { application: ApplicationFacts }) {
  const t = useText();
  const nav = useLinks();
  const view = useView();
  const { history } = application;
  const none = t('md.overview.noHistory');
  const unverified = t('md.overview.notVerified');
  const facts: [string, string | number | undefined][] = [
    ['md.table.languages', listText(application.languages.map((entry) => t('md.overview.languageItem', { language: entry.language, files: entry.files })))],
    ['md.table.frameworks', listText(application.frameworks.map((entry) => t('md.overview.frameworkItem', { framework: entry.framework, count: entry.candidates })))],
    ['md.table.files', application.files],
    ['md.table.lines', application.lines],
    ['md.table.firstCommit', history === null ? none : history.first],
    ['md.table.lastCommit', history === null ? none : history.last],
    ['md.table.commits', history === null ? none : history.commits],
    ['md.table.authors', history === null ? none : history.authors],
  ];
  return (
    <Item
      attrs={(
        <>
          <span>{application.name ?? unverified}</span>
          <code className="item-code">{view === 'technical' ? <a href={nav.application(application.dir)}>{application.dir}</a> : application.dir}</code>
        </>
      )}
      note={(
        <dl className="item-facts">
          {facts.filter(([, value]) => value !== undefined).map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd>{value}</dd></div>)}
        </dl>
      )}
    >
      <p>{application.does ?? unverified}</p>
    </Item>
  );
}

/**
 * The system overview on the overview page: what the system is and who uses it
 * (from the verified overview), the counts and the applications with the
 * script's facts, the external systems, what the code does not settle, and the
 * domains (or the areas, when there is no domains file) with their roles. The counts, the application rows and the domain table
 * are the script's and do not depend on the overview; an overview that is not
 * verified replaces only the sections a model writes with a line saying where it
 * stopped.
 */
export function SystemOverview({ data }: { data: PageData }) {
  const t = useText();
  const nav = useLinks();
  const view = useView();
  const { system } = data;
  const { overview, counts } = system;
  const heading = data.domainBasis === 'domains' ? 'md.overview.domainsHeading' : 'md.overview.areasHeading';
  return (
    <div data-part="system">
      {overview === null
        ? <p className="muted summary-note" role="note">{t('md.overview.notWritten', { step: t(`md.status.${system.status}`) })}</p>
        : <h2 className="block-title">{t('md.overview.heading')}</h2>}
      <p className="summary-counts">{t(data.domainBasis === 'domains' ? 'md.overview.countsWithDomains' : 'md.overview.counts', { ...counts, domains: counts.domains ?? data.domains.length, verified: counts.featuresWithEntry })}</p>

      {overview !== null && (
        <>
          <section className="section" aria-labelledby="sys-purpose">
            <h2 className="section-title" id="sys-purpose">{t('md.section.purpose')}</h2>
            {overview.summary.length === 0 ? <p className="muted">{t('md.none')}</p> : overview.summary.map((text, at) => <p key={at}>{text}</p>)}
          </section>

          <section className="section" aria-labelledby="sys-audiences">
            <h2 className="section-title" id="sys-audiences">{t('md.overview.audiencesHeading')}</h2>
            {overview.audiences.length === 0 ? <p className="muted">{t('md.none')}</p> : (
              <DefinitionList part="audiences" label={t('md.overview.audiencesHeading')}>
                {overview.audiences.map((entry, at) => <Definition key={at} term={entry.who}>{entry.does}</Definition>)}
              </DefinitionList>
            )}
          </section>
        </>
      )}

      <section className="section" aria-labelledby="sys-applications">
        <h2 className="section-title" id="sys-applications">{t('md.overview.applicationsHeading')}</h2>
        {system.applications.length === 0 ? <p className="muted">{t('md.none')}</p> : (
          <ItemList part="applications" label={t('md.overview.applicationsHeading')}>
            {system.applications.map((application, at) => <ApplicationItem application={application} key={at} />)}
          </ItemList>
        )}
      </section>

      {overview !== null && (
        <>
          <section className="section" aria-labelledby="sys-integrations">
            <h2 className="section-title" id="sys-integrations">{t('md.overview.integrationsHeading')}</h2>
            {overview.integrations.length === 0 ? <p className="muted">{t('md.none')}</p> : (
              <ItemList part="integrations" label={t('md.overview.integrationsHeading')}>
                {overview.integrations.map((entry, at) => (
                  <Item
                    key={at}
                    attrs={view === 'technical' ? <a href={nav.system(entry.system)}>{entry.system}</a> : entry.system}
                    note={entry.callers.length === 0 ? undefined : <p><span className="inline-label">{t('md.table.callers')}</span> {entry.callers.join(', ')}</p>}
                  >
                    <p>{entry.use}</p>
                  </Item>
                ))}
              </ItemList>
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
        <h2 className="section-title" id="sys-areas">{t(heading)}</h2>
        <TableScroll label={t(heading)} wide>
          <thead>
            <tr>
              <th scope="col">{t(data.domainBasis === 'domains' ? 'md.table.domain' : 'md.table.area')}</th>
              <th scope="col" className="num">{t('md.table.features')}</th>
              <th scope="col" className="num">{t('md.table.verified')}</th>
              <th scope="col">{t('md.table.roles')}</th>
            </tr>
          </thead>
          <tbody>
            {system.domains.map((row) => (
              <tr key={row.id}><Cell row>{row.name}</Cell><td className="num">{row.features}</td><td className="num">{row.verified}</td><Cell>{listText(row.roles)}</Cell></tr>
            ))}
          </tbody>
        </TableScroll>
      </section>
    </div>
  );
}
