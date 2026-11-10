import type { ReactNode } from 'react';

import { useLinks, useView } from '../lib/links';
import { useText } from '../lib/text';
import type { Area, DomainRelation, PageData } from '../lib/types';
import { REACHES, findingCategoryKey } from '../lib/types';
import { Crumbs } from './Crumbs';
import { FeatureDetail, FeatureScopeProvider } from './FeatureDetail';
import { PriorityBadge } from './PriorityBadge';
import { Cell, TableScroll } from './Tables';

/** The id of the element that holds the detail of a feature on its domain's page. */
const anchorId = (id: string): string => `feature-${id}`;

/**
 * A domain (a business domain, or an area of the map when the handbook has no domains file, which the page then says), in
 * the sections of the reference handbook (openspec change handbook-domain-page, D2): what it does (only the purposes of
 * its verified features), its features by how readers reach them, the states and transitions of its verified entries,
 * where its code is (technical view only), its relations with other domains (the handoffs of verified entries that cross
 * domains) and the findings of its features. A section with nothing to show says none. After the features come the full
 * detail of each verified feature (openspec change handbook-outline, D7), the same as the feature's page one heading level
 * lower, each under the anchor `feature-<id>` that the features list links to.
 */
export function DomainPage({ data, domain: group }: { data: PageData; domain: Area }) {
  const t = useText();
  const nav = useLinks();
  const view = useView();
  const domain = data.entities.domains.find((item) => item.id === group.id);
  const features = data.features.filter((feature) => feature.domain === group.id);
  const own = new Set(features.map((feature) => feature.id));
  // Only a verified feature has an entry to show; the list says nothing more of the others than they are in the domain.
  const details = features.filter((feature) => feature.status === 'verified');
  const featureNames = new Map(data.features.map((item) => [item.id, item.name]));
  const featureText = (id: string) => t('md.summary.feature', { id, name: data.features.find((feature) => feature.id === id)?.name ?? '' });
  const featureLink = (id: string) => <a href={nav.feature(id)}>{featureText(id)}</a>;
  const none = <p className="muted">{t('md.none')}</p>;
  const section = (part: string, title: string, body: ReactNode, note?: string) => (
    <section className="section" data-part={part} aria-labelledby={part}>
      <h2 className="section-title" id={part}>{title}</h2>
      {note !== undefined && <p className="muted summary-note">{note}</p>}
      {body}
    </section>
  );

  const states = domain?.states ?? [];
  const transitions = domain?.transitions ?? [];
  const stateFeatures = features.map((feature) => feature.id).filter((id) => states.some((item) => item.feature === id) || transitions.some((item) => item.feature === id));
  const relations = domain?.relations ?? [];
  const domainName = (id: string) => data.domains.find((item) => item.id === id)?.name ?? id;
  const relationTable = (items: DomainRelation[], label: string) => items.length === 0 ? none : (
    <TableScroll label={label}>
      <thead><tr>{['here', 'domain', 'there', 'text'].map((key) => <th scope="col" key={key}>{t(`page.domain.relation.${key}`)}</th>)}</tr></thead>
      <tbody>
        {items.map((item, at) => {
          const [here, there] = item.direction === 'out' ? [item.from, item.to] : [item.to, item.from];
          return (
            <tr key={at}>
              <Cell row>{featureLink(here)}</Cell>
              <td><a href={nav.domain(item.domain)}>{domainName(item.domain)}</a></td>
              <td>{featureLink(there)}</td>
              <td>{item.text}</td>
            </tr>
          );
        })}
      </tbody>
    </TableScroll>
  );
  const findings = data.findings.filter((item) => item.owners.some((owner) => owner.kind === 'feature' && own.has(owner.id)));

  return (
    <article className="page" data-view="domain" data-domain={group.id}>
      <Crumbs trail={[group.name]} />
      <header className="page-head">
        <h1 className="page-title">{group.name}</h1>
      </header>
      <p className="muted summary-note">{t(data.domainBasis === 'domains' ? 'md.entities.domains.note' : 'md.domains.fromAreas')}</p>

      {section('domain-does', t('md.entities.domain.whatItDoes'), domain === undefined || domain.purposes.length === 0 ? none : (
        <ul className="plain-list">
          {domain.purposes.map((item) => (
            <li key={item.feature}><a href={nav.feature(item.feature)}>{t('md.entities.domain.purposeItem', { feature: featureText(item.feature), purpose: item.text })}</a></li>
          ))}
        </ul>
      ), t('md.entities.domains.purposesNote'))}

      {section('domain-features', t('md.table.features'), features.length === 0 ? <p className="muted">{t('md.areas.noFeatures')}</p> : REACHES.map((reach) => {
        const reached = features.filter((feature) => feature.reach === reach);
        if (reached.length === 0) return null;
        return (
          <div className="domain-group" key={reach} data-reach={reach}>
            <h3 className="sub-title">{t('page.domain.reachGroup', { reach: t(`md.reach.${reach}`), count: reached.length })}</h3>
            <ul className="area-features">
              {reached.map((feature) => (
                <li key={feature.id}>
                  {feature.status !== 'verified' ? <a href={nav.feature(feature.id)}>{feature.name}</a> : (
                    // The anchor is in this page: a plain fragment would be read as a route, so the click scrolls and keeps the route.
                    <a href={`#${anchorId(feature.id)}`} onClick={(event) => { event.preventDefault(); document.getElementById(anchorId(feature.id))?.scrollIntoView({ block: 'start' }); }}>{feature.name}</a>
                  )}
                  <span className="area-feature-meta">
                    {feature.status !== 'verified' && <span className="status-chip" data-status={feature.status}>{t(`md.status.${feature.status}`)}</span>}
                    {feature.status === 'verified' && <a className="area-feature-page" href={nav.feature(feature.id)}>{t('page.domain.featurePage')}</a>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      }))}

      {details.length > 0 && (
        <div className="feature-details" data-part="domain-feature-details">
          {details.map((feature) => (
            <section className="feature-detail" id={anchorId(feature.id)} data-part="feature-detail" data-feature={feature.id} key={feature.id} aria-labelledby={`${anchorId(feature.id)}-title`}>
              <h2 className="feature-detail-title" id={`${anchorId(feature.id)}-title`} data-part="feature-title">{feature.name}</h2>
              <FeatureScopeProvider value={{ offset: 1, prefix: `${anchorId(feature.id)}-` }}>
                <FeatureDetail
                  feature={feature}
                  findings={data.findings.filter((group) => group.owners.some((owner) => owner.kind === 'feature' && owner.id === feature.id))}
                  locations={view === 'technical' ? data.technical?.locations.find((unit) => unit.id === feature.id) : undefined}
                  featureNames={featureNames}
                />
              </FeatureScopeProvider>
            </section>
          ))}
        </div>
      )}

      {section('domain-states', t('page.domain.statesHeading'), stateFeatures.length === 0 ? none : stateFeatures.map((id) => (
        <div className="domain-group" key={id}>
          <h3 className="sub-title">{featureLink(id)}</h3>
          <ul className="plain-list">
            {states.filter((item) => item.feature === id).map((item, at) => <li key={`s${at}`}>{t('page.domain.stateItem', { label: item.label, meaning: item.meaning })}</li>)}
            {transitions.filter((item) => item.feature === id).map((item, at) => <li key={`t${at}`}>{t('page.domain.transitionItem', { from: item.from, to: item.to, by: item.by })}</li>)}
          </ul>
        </div>
      )), t('page.domain.statesNote'))}

      {view === 'technical' && data.technical !== undefined && <DomainCode data={data} domainId={group.id} own={own} />}

      {section('domain-relations', t('md.entities.domain.relationsHeading'), (
        <>
          <h3 className="sub-title">{t('md.entities.domain.gives')}</h3>
          {relationTable(relations.filter((item) => item.direction === 'out'), t('md.entities.domain.gives'))}
          <h3 className="sub-title">{t('md.entities.domain.gets')}</h3>
          {relationTable(relations.filter((item) => item.direction === 'in'), t('md.entities.domain.gets'))}
        </>
      ), t('md.entities.domain.relationsNote'))}

      {section('domain-findings', t('page.domain.findingsHeading'), (
        <>
          {findings.length === 0 ? none : (
            <ul className="plain-list">
              {findings.map((item) => (
                <li key={item.items[0].id}><PriorityBadge priority={item.priority} /> {t('md.findings.featureItem', { category: t(findingCategoryKey(item.category)), text: item.items[0].text })}</li>
              ))}
            </ul>
          )}
          <p><a href={nav.findings}>{t('page.domain.allFindings')}</a></p>
        </>
      ), t('page.domain.findingsNote'))}
    </article>
  );
}

/**
 * Where the code of a domain is: the hotspots its features cite, the files its verified entries quote, the tables named in
 * those files and the applications that hold its passages. When the code health or the data file was not read, its part
 * says so in the same words as its own page instead of none.
 */
function DomainCode({ data, domainId, own }: { data: PageData; domainId: string; own: Set<string> }) {
  const t = useText();
  const nav = useLinks();
  const technical = data.technical!;
  const none = <p className="muted">{t('md.none')}</p>;
  const hotspots = data.history.hotspots
    .map((row, at) => ({ row, file: technical.history.hotspots[at] ?? row.name }))
    .filter(({ row }) => row.features.some((id) => own.has(id)));
  const cited = technical.domainFiles?.find((item) => item.domain === domainId)?.files ?? [];
  const citedSet = new Set(cited.map((item) => item.file));
  const tables = (technical.data?.tables ?? []).filter((table) => Object.values(table.mentions).some((list) => list.some((mention) => citedSet.has(mention.file))));
  const cells = technical.applicationDomain.cells.filter((cell) => cell.domain === domainId);
  const outside = technical.applicationDomain.unattributed.find((row) => row.domain === domainId);
  const appName = (dir: string) => data.system.applications.find((application) => application.dir === dir)?.name ?? undefined;
  return (
    <section className="section" data-part="domain-code" aria-labelledby="domain-code">
      <h2 className="section-title" id="domain-code">{t('page.domain.codeHeading')}</h2>

      <h3 className="sub-title">{t('page.domain.hotspots')}</h3>
      <p className="muted summary-note">{t('page.domain.hotspotsNote')}</p>
      {data.history.state !== 'ok' ? <p className="muted">{t(data.history.state === 'malformed' ? 'md.history.malformed' : 'md.history.notWritten')}</p> : hotspots.length === 0 ? none : (
        <ul className="plain-list">{hotspots.map(({ row, file }) => <li key={file}><code>{t('page.domain.hotspotItem', { file, commits: row.commits })}</code></li>)}</ul>
      )}

      <h3 className="sub-title">{t('page.domain.citedFiles')}</h3>
      {cited.length === 0 ? none : (
        <ul className="plain-list">{cited.map((item) => <li key={item.file}><code>{t('page.domain.citedItem', { file: item.file, count: item.citations })}</code></li>)}</ul>
      )}

      <h3 className="sub-title">{t('page.domain.tables')}</h3>
      <p className="muted summary-note">{t('page.domain.tablesNote')}</p>
      {technical.dataState !== 'ok' ? <p className="muted">{t(technical.dataState === 'malformed' ? 'md.data.malformed' : 'md.data.notWritten')}</p> : tables.length === 0 ? none : (
        <ul className="plain-list">{tables.map((table) => <li key={table.name}><a href={nav.data}><code>{table.name}</code></a></li>)}</ul>
      )}

      <h3 className="sub-title">{t('md.entities.applications.heading')}</h3>
      {cells.length === 0 && outside === undefined ? none : (
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
  );
}
