import { useLinks } from '../lib/links';
import { useText } from '../lib/text';
import type { PageData, Technical } from '../lib/types';
import { Crumbs } from './Crumbs';
import { FlowChart } from './FlowChart';
import { Cell, TableScroll } from './Tables';
import { PageTitle, useBlockTitle } from '../lib/outline';

/**
 * The business flow (openspec change handbook-domain-page, D4, D6), a chapter of its own as in the reference handbook: the
 * diagram of the domains with a cross-domain handoff, one arrow per direction labelled with the count, and the same
 * handoffs as a list, each once, with both domains, both features and what is handed over. Both come from the handoffs
 * of verified entries only; with none, a fixed text says so and nothing is drawn.
 */
export function BusinessPage({ data }: { data: PageData }) {
  const t = useText();
  const nav = useLinks();
  const title = useBlockTitle('business', t('page.nav.business'));
  const flows = data.entities.domainFlows ?? [];
  const handoffs = data.entities.domains.flatMap((domain) => (domain.relations ?? []).filter((item) => item.direction === 'out').map((item) => ({ ...item, source: domain.id })));
  const domainName = (id: string) => data.domains.find((item) => item.id === id)?.name ?? id;
  const featureText = (id: string) => t('md.summary.feature', { id, name: data.features.find((feature) => feature.id === id)?.name ?? '' });
  return (
    <article className="page" data-view="business">
      <Crumbs trail={[title]} />
      <header className="page-head">
        <PageTitle fallback={title} />
        <p className="lede">{t('page.business.lede')}</p>
      </header>
      <section className="section" data-part="business-flow" aria-labelledby="business-flow">
        <h2 className="section-title" id="business-flow">{t('md.entities.domains.flowHeading')}</h2>
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
      {handoffs.length > 0 && (
        <section className="section" data-part="business-list" aria-labelledby="business-list">
          <h2 className="section-title" id="business-list">{t('page.business.listHeading')}</h2>
          <TableScroll label={t('page.business.listHeading')}>
            <thead><tr>{['fromDomain', 'fromFeature', 'toDomain', 'toFeature'].map((key) => <th scope="col" key={key}>{t(`page.business.col.${key}`)}</th>)}<th scope="col">{t('page.domain.relation.text')}</th></tr></thead>
            <tbody>
              {handoffs.map((item, at) => (
                <tr key={at}>
                  <Cell row><a href={nav.domain(item.source)}>{domainName(item.source)}</a></Cell>
                  <td><a href={nav.feature(item.from)}>{featureText(item.from)}</a></td>
                  <td><a href={nav.domain(item.domain)}>{domainName(item.domain)}</a></td>
                  <td><a href={nav.feature(item.to)}>{featureText(item.to)}</a></td>
                  <td>{item.text}</td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        </section>
      )}
    </article>
  );
}

/**
 * The technical structure (technical view only; openspec change handbook-domain-page, D5, D6), a chapter of its own as in
 * the reference handbook: the applications with their languages, frameworks and history, the diagram of the calls to
 * external systems that the verified overview shows (names a search found are not calls and are not drawn), and the
 * external systems. Calls between applications and to databases are not in the facts, and the note under the diagram says so.
 */
export function ArchitecturePage({ data, technical }: { data: PageData; technical: Technical }) {
  const t = useText();
  const nav = useLinks();
  const title = useBlockTitle('architecture', t('page.nav.architecture'));
  const calls = technical.integrations.filter((item) => item.shown.length > 0);
  const callers = [...new Set(calls.flatMap((item) => item.shown))];
  const appName = (dir: string) => data.system.applications.find((application) => application.dir === dir)?.name ?? dir;
  return (
    <article className="page" data-view="architecture">
      <Crumbs trail={[title]} />
      <header className="page-head">
        <PageTitle fallback={title} />
        <p className="lede">{t('page.architecture.lede')}</p>
      </header>

      <section className="section" data-part="architecture-applications" aria-labelledby="architecture-applications">
        <h2 className="section-title" id="architecture-applications">{t('md.entities.applications.heading')}</h2>
        {data.system.applications.length === 0 ? <p className="muted">{t('md.none')}</p> : (
          <TableScroll label={t('md.entities.applications.heading')}>
            <thead><tr>
              <th scope="col">{t('md.table.application')}</th>
              <th scope="col">{t('md.table.does')}</th>
              <th scope="col">{t('md.table.languages')}</th>
              <th scope="col">{t('md.table.frameworks')}</th>
              <th scope="col">{t('md.table.firstCommit')}</th>
              <th scope="col" className="num">{t('md.table.commits')}</th>
              <th scope="col" className="num">{t('md.table.lines')}</th>
            </tr></thead>
            <tbody>
              {data.system.applications.map((application) => (
                <tr key={application.dir}>
                  <Cell row><a href={nav.application(application.dir)}>{application.name ?? t('md.overview.notVerified')}</a> <code className="app-dir">{application.dir}</code></Cell>
                  <td>{application.does ?? t('md.overview.notVerified')}</td>
                  <td>{application.languages.length === 0 ? t('md.none') : application.languages.map((entry) => t('md.overview.languageItem', { language: entry.language, files: entry.files })).join(', ')}</td>
                  <td>{application.frameworks.length === 0 ? t('md.none') : application.frameworks.map((entry) => t('md.overview.frameworkItem', { framework: entry.framework, count: entry.candidates })).join(', ')}</td>
                  <td>{application.history?.first ?? t('md.overview.noHistory')}</td>
                  <td className="num">{application.history?.commits ?? t('md.overview.noHistory')}</td>
                  <td className="num">{application.lines}</td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        )}
      </section>

      <section className="section" data-part="architecture-calls" aria-labelledby="architecture-calls">
        <h2 className="section-title" id="architecture-calls">{t('md.entities.systems.diagramHeading')}</h2>
        {calls.length === 0 ? <p className="muted">{t('md.entities.systems.diagramNone')}</p> : (
          <>
            <p className="muted summary-note">{t('md.entities.systems.diagramNote')}</p>
            <FlowChart
              part="architecture-chart"
              label={t('md.entities.systems.diagramHeading')}
              nodes={[
                ...callers.map((dir) => ({ id: `a:${dir}`, label: appName(dir), href: nav.application(dir) })),
                ...calls.map((item) => ({ id: `s:${item.system}`, label: item.system, href: nav.system(item.system), kind: 'system' as const })),
              ]}
              edges={calls.flatMap((item) => item.shown.map((dir) => ({ from: `a:${dir}`, to: `s:${item.system}` })))}
            />
          </>
        )}
      </section>

      <section className="section" data-part="architecture-systems" aria-labelledby="architecture-systems">
        <h2 className="section-title" id="architecture-systems">{t('md.entities.systems.heading')}</h2>
        {technical.integrations.length === 0 ? <p className="muted">{t('md.none')}</p> : (
          <TableScroll label={t('md.entities.systems.heading')}>
            <thead><tr><th scope="col">{t('md.table.system')}</th><th scope="col">{t('md.table.use')}</th><th scope="col">{t('md.table.callers')}</th></tr></thead>
            <tbody>
              {technical.integrations.map((item) => (
                <tr key={item.system}>
                  <Cell row><a href={nav.system(item.system)}>{item.system}</a></Cell>
                  <td>{item.use}</td>
                  <td>{item.shown.length === 0 ? t('md.none') : item.shown.map((dir) => <a key={dir} className="inline-link" href={nav.application(dir)}>{appName(dir)}</a>)}</td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        )}
      </section>
    </article>
  );
}
