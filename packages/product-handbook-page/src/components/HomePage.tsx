import type { Group } from '../lib/groups';
import { countsOf, handedOver, otherEnds, received } from '../lib/handovers';
import { useLinks, useView } from '../lib/links';
import { useModel } from '../lib/model';
import { hrefOf } from '../lib/pages';
import type { PageItem } from '../lib/pages';
import { emphasised } from '../lib/rich';
import { colourProps } from '../lib/strata';
import { useText } from '../lib/text';
import { Atlas } from './Atlas';
import { Flows } from './Flows';
import { InlineMarkdown } from './InlineMarkdown';
import { Mark } from './Mark';

interface Props { title: string; lead: string; groups: Group[]; references: PageItem[] }

/** The phone's replacement for the map: one details per domain with its counts, its two lists and the link to its page. */
function PhoneList() {
  const t = useText();
  const nav = useLinks();
  const { domains, handovers, colours } = useModel();
  return (
    <div className="rel-list" data-part="rel-list">
      {Object.values(domains).map((domain) => {
        const counts = countsOf(handovers, domain.id);
        return (
          <details key={domain.id} data-domain={domain.id} {...colourProps(colours[domain.id])}>
            <summary><Mark colour={colours[domain.id]} />{domain.name}<small>{t('page.flow.counts', { out: counts.out, in: counts.in })}</small></summary>
            <Flows id={domain.id} />
            <a className="side-go" href={nav.domain(domain.id)}>{t('page.flow.open', { name: domain.name })}</a>
          </details>
        );
      })}
    </div>
  );
}

/** The names of the domains at the other end of a list, as links, each kept on one line; a dash (drawn by the stylesheet) when there are none. */
function Ends({ ids }: { ids: string[] }) {
  const nav = useLinks();
  const { domains } = useModel();
  return (
    <td className="col-hide" data-empty={ids.length === 0 ? 'true' : undefined}>
      {ids.map((id) => <a key={id} className="end" href={nav.domain(id)}>{domains[id]?.name ?? id}</a>)}
    </td>
  );
}

/** The table of the domains: the name, what it does, the number of features and, with a map, the domains it receives from and hands over to. */
function DomainTable({ groups }: { groups: Group[] }) {
  const t = useText();
  const nav = useLinks();
  const view = useView();
  const { map, domains, handovers, colours } = useModel();
  return (
    <div className="table-scroll">
      <table className="dom-table" data-part="domain-table">
        <thead>
          <tr>
            <th scope="col">{t('page.table.name')}</th>
            {map && <th scope="col">{t('page.table.what')}</th>}
            <th scope="col" className="num">{t('page.table.features')}</th>
            {map && <th scope="col" className="col-hide">{t('page.table.receives')}</th>}
            {map && <th scope="col" className="col-hide">{t('page.table.hands')}</th>}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const domain = domains[group.id];
            // A summary column: the product text (no citations) when the page has it; the citations are on the domain's page.
            const intro = domain?.intro.product ?? domain?.intro[view] ?? '';
            return (
              <tr key={group.id} data-domain={group.id} {...colourProps(colours[group.id])}>
                <th scope="row"><span className="dom-name"><Mark colour={colours[group.id]} /><a href={nav.domain(group.id)}>{group.name}</a></span></th>
                {map && <td data-empty={intro === '' ? 'true' : undefined}>{intro !== '' && <InlineMarkdown source={intro} />}</td>}
                <td className="num">{domain === undefined ? group.features.length : domain.features.length}</td>
                {map && <Ends ids={otherEnds(received(handovers, group.id), 'from')} />}
                {map && <Ends ids={otherEnds(handedOver(handovers, group.id), 'to')} />}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The home page: the title and one sentence, the atlas (the map and its side panel; a list of domains on a phone), the table
 * of the domains and the references. Without a usable list of hand-overs the page has no map and says why in one quiet line.
 */
export function HomePage({ title, lead, groups, references }: Props) {
  const t = useText();
  const nav = useLinks();
  const model = useModel();
  const features = Object.values(model.domains).reduce((sum, domain) => sum + domain.features.length, 0);
  return (
    <div className="wrap home" data-view="home" data-map={model.map ? 'yes' : 'no'}>
      <h1 className="home-title">{title}</h1>
      <p className="home-lead">
        {lead !== '' && <><InlineMarkdown source={lead} />{' '}</>}
        {model.map && emphasised(t('page.home.counts'), { domains: Object.keys(model.domains).length, features, handovers: model.handovers.length })}
      </p>
      {!model.map && <p className="home-why" data-part="no-map">{t(`page.home.noMap.${model.state === 'ok' ? 'missing' : model.state}`)}</p>}
      {model.map && (
        <section aria-labelledby="h-map" className="atlas-section">
          <h2 id="h-map" className="map-heading">{t('page.map.label')}</h2>
          <Atlas />
          <PhoneList />
        </section>
      )}
      <section aria-labelledby="h-domains" className="sec">
        <h2 id="h-domains">{t('page.nav.domains')}</h2>
        <DomainTable groups={groups} />
      </section>
      <section aria-labelledby="h-refs" className="sec">
        <h2 id="h-refs">{t('page.nav.references')}</h2>
        <ul className="ref-list">
          {references.map((item) => <li key={item.key}><a href={hrefOf(item, nav)} data-page={item.key}>{item.title}</a></li>)}
        </ul>
      </section>
    </div>
  );
}
