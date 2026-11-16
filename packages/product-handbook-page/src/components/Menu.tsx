import { useLinks } from '../lib/links';
import type { Group, ReferenceGroup } from '../lib/groups';
import type { Pair } from '../lib/strata';
import { useText } from '../lib/text';
import { Mark } from './Mark';
import { ReferenceGroups } from './ReferenceGroups';

interface Props { groups: Group[]; colours: Record<string, Pair>; references: ReferenceGroup[]; home: boolean; problems: boolean; onNavigate: () => void }

/** The phone's menu, full screen under the bar: the overview and the problems, the features by group, the references in a closed details. A click on a link closes it. */
export function Menu({ groups, colours, references, home, problems, onNavigate }: Props) {
  const t = useText();
  const nav = useLinks();
  return (
    <nav className="menu" id="menu" aria-label={t('page.nav.label')} onClick={(event) => { if ((event.target as HTMLElement).closest('a')) onNavigate(); }}>
      <a href={nav.home} aria-current={home ? 'page' : undefined}>{t('page.nav.overview')}</a>
      <a href={nav.problems()} aria-current={problems ? 'page' : undefined}>{t('page.nav.problems')}</a>
      <h2>{t('page.nav.features')}</h2>
      {groups.map((group) => (
        <a key={group.id} href={nav.domain(group.id)} data-group={group.id}><Mark colour={colours[group.id]} />{group.name}<small>{group.features.length}</small></a>
      ))}
      <details className="menu-refs" data-part="menu-references">
        <summary>{t('page.nav.references')}</summary>
        <ReferenceGroups groups={references} as="links" />
      </details>
    </nav>
  );
}
