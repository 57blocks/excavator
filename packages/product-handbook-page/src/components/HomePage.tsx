import type { Group } from '../lib/groups';
import { useLinks } from '../lib/links';
import { colourProps } from '../lib/strata';
import type { Pair } from '../lib/strata';
import { useText } from '../lib/text';
import { Mark } from './Mark';

/** The home page, for now: the title and the groups as a list of links (the map and the tables come next). */
export function HomePage({ title, groups, colours }: { title: string; groups: Group[]; colours: Record<string, Pair> }) {
  const t = useText();
  const nav = useLinks();
  return (
    <div className="wrap home" data-view="home">
      <h1 className="home-title">{title}</h1>
      <h2>{t('page.nav.domains')}</h2>
      <ul className="plain-list">
        {groups.map((group) => (
          <li key={group.id} {...colourProps(colours[group.id])}><Mark colour={colours[group.id]} /><a href={nav.domain(group.id)}>{group.name}</a><small>{group.features.length}</small></li>
        ))}
      </ul>
    </div>
  );
}
