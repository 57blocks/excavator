import type { Group } from '../lib/groups';
import { countsOf } from '../lib/handovers';
import { useLinks } from '../lib/links';
import { useModel } from '../lib/model';
import { colourProps } from '../lib/strata';
import { useText } from '../lib/text';
import { Atlas } from './Atlas';
import { Flows } from './Flows';
import { Mark } from './Mark';

interface Props { title: string; groups: Group[] }

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

/**
 * The overview, the home page: the map (the atlas; a list of domains on a phone) with the button that opens the first domain's
 * page at its top right, above the map (none when the page has no domains). The system's name is in the top bar, so the page's
 * h1 is for screen readers only and there is no lead. It has no feature list, no counts and no domain navigation: the domains
 * and their features are the domain pages'.
 * Without a usable list of links between domains the page has no map and says why in one quiet line in the map's place.
 */
export function HomePage({ title, groups }: Props) {
  const t = useText();
  const nav = useLinks();
  const model = useModel();
  const button = groups.length > 0 ? <a className="button-link open-domains" data-part="open-domains" href={nav.domain(groups[0].id)}>{t('page.home.openDomains')}</a> : null;
  return (
    <div className="wrap home" data-view="home" data-map={model.map ? 'yes' : 'no'}>
      <h1 className="vh">{title}</h1>
      {model.map ? (
        <section aria-labelledby="h-map" className="atlas-section">
          <div className="map-head">
            <h2 id="h-map" className="map-heading">{t('page.map.label')}</h2>
            {button}
          </div>
          <Atlas />
          <PhoneList />
        </section>
      ) : (
        <>
          {button !== null && <div className="map-head">{button}</div>}
          <p className="home-why" data-part="no-map">{t(`page.home.noMap.${model.state === 'ok' ? 'missing' : model.state}`)}</p>
        </>
      )}
    </div>
  );
}
