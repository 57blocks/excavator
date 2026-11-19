import { useText } from '../lib/text';
import { SideBody } from './SideList';
import type { SideMode, SidePlace } from './SideList';
import type { Group, ReferenceGroup } from '../lib/groups';

interface Props { mode: SideMode; place: SidePlace; groups: Group[]; references: ReferenceGroup[]; architecture: boolean; onNavigate: () => void }

/** The phone's menu, full screen under the bar: the same list as the left list, in the same state. A click on a link closes it. */
export function Menu({ onNavigate, ...list }: Props) {
  const t = useText();
  return (
    <nav className="menu" id="menu" aria-label={t('page.nav.label')} data-side={list.mode} onClick={(event) => { if ((event.target as HTMLElement).closest('a')) onNavigate(); }}>
      <SideBody {...list} />
    </nav>
  );
}
