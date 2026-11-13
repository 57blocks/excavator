import type { Group } from '../lib/groups';
import { useLinks } from '../lib/links';
import { hrefOf } from '../lib/pages';
import type { Pair } from '../lib/strata';
import { colourProps } from '../lib/strata';
import { useText } from '../lib/text';
import { Breadcrumbs } from './Breadcrumbs';
import { Mark } from './Mark';

/** A domain page, for now: its name and its features as a list of links (the hand-overs and the section come next). */
export function DomainPage({ group, colour, mapLabel }: { group: Group; colour: Pair; mapLabel: string }) {
  const t = useText();
  const nav = useLinks();
  return (
    <div className="wrap domain" data-view="domain" data-domain={group.id} {...colourProps(colour)}>
      <Breadcrumbs trail={[{ label: mapLabel, href: nav.home }, { label: group.name }]} />
      <h1 className="page-title"><Mark colour={colour} /> {group.name}</h1>
      <h2>{t('page.domain.features')}</h2>
      <ul className="plain-list">
        {group.features.map((item) => <li key={item.key}><a href={hrefOf(item, nav)}>{item.title}</a></li>)}
      </ul>
    </div>
  );
}
