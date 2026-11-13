import { useLinks } from '../lib/links';
import type { Group, ReferenceGroup } from '../lib/groups';
import type { Pair } from '../lib/strata';
import { useText } from '../lib/text';
import { Mark } from './Mark';
import { ReferenceGroups } from './ReferenceGroups';

interface Props { groups: Group[]; colours: Record<string, Pair>; references: ReferenceGroup[]; home: boolean; onNavigate: () => void }

/** The phone's menu, full screen under the bar: the map, the domains, the references. A click on a link closes it. */
export function Menu({ groups, colours, references, home, onNavigate }: Props) {
  const t = useText();
  const nav = useLinks();
  return (
    <nav className="menu" id="menu" aria-label={t('page.nav.label')} onClick={(event) => { if ((event.target as HTMLElement).closest('a')) onNavigate(); }}>
      <a href={nav.home} aria-current={home ? 'page' : undefined}>{t('page.nav.map')}</a>
      <h2>{t('page.nav.domains')}</h2>
      {groups.map((group) => (
        <a key={group.id} href={nav.domain(group.id)} data-group={group.id}><Mark colour={colours[group.id]} />{group.name}<small>{group.features.length}</small></a>
      ))}
      <h2>{t('page.nav.references')}</h2>
      <ReferenceGroups groups={references} as="links" />
    </nav>
  );
}
