import { useLinks } from '../lib/links';
import type { Group, ReferenceGroup } from '../lib/groups';
import type { Pair } from '../lib/strata';
import { useText } from '../lib/text';
import type { View } from '../lib/types';
import { CloseIcon, MenuIcon, SearchIcon } from './Icons';
import { Mark } from './Mark';
import { Popover } from './Popover';
import { ReferenceGroups } from './ReferenceGroups';

interface Props {
  /** The first line of the brand and the title of the view the reader is in (the second line). */
  brand: string;
  viewTitle: string;
  groups: Group[];
  colours: Record<string, Pair>;
  references: ReferenceGroup[];
  /** The route the page shows, to mark the map link. */
  home: boolean;
  menuOpen: boolean;
  onMenu: () => void;
  onSearch: () => void;
  /** The views of the page and the view the reader is in; a page with one view has no switch. */
  views: View[];
  current: View;
  /** The fragment that shows the page the reader is on in each view. */
  switchTo: Record<View, string>;
}

/** The key that opens the search, as the button shows it: the command sign on a Mac, Ctrl elsewhere. */
function shortcutHint(): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
  return mac ? `${String.fromCharCode(0x2318)}K` : 'Ctrl K';
}

/** The bar above everything: brand, the map, the domains and the references, the search button and, with two views, the view switch. On a phone the navigation is the menu button's. */
export function TopBar({ brand, viewTitle, groups, colours, references, home, menuOpen, onMenu, onSearch, views, current, switchTo }: Props) {
  const t = useText();
  const nav = useLinks();
  return (
    <header className="topbar">
      <button type="button" className="menu-btn" onClick={onMenu} aria-expanded={menuOpen} aria-controls="menu" aria-label={menuOpen ? t('page.nav.close') : t('page.nav.open')}>
        {menuOpen ? <CloseIcon /> : <MenuIcon />}
      </button>
      <a className="brand" href={nav.home}><b>{brand}</b><span>{viewTitle}</span></a>
      <nav className="nav" aria-label={t('page.nav.label')}>
        <a href={nav.home} data-nav="map" aria-current={home ? 'page' : undefined}>{t('page.nav.map')}</a>
        <Popover id="pop-domains" label={t('page.nav.domains')}>
          {groups.map((group) => (
            <a key={group.id} href={nav.domain(group.id)} data-group={group.id}><Mark colour={colours[group.id]} />{group.name}<small>{group.features.length}</small></a>
          ))}
        </Popover>
        <Popover id="pop-refs" label={t('page.nav.references')}>
          <ReferenceGroups groups={references} as="links" />
        </Popover>
      </nav>
      <div className="bar-end">
        <button type="button" className="search-btn" onClick={onSearch} aria-label={t('page.search.open')}>
          <SearchIcon /><span>{t('page.search.open')}</span><kbd data-key={shortcutHint()} aria-hidden="true" />
        </button>
        {views.length > 1 && (
          <nav className="views" aria-label={t('page.view.label')} data-part="view-switch">
            {views.map((view) => (
              <a key={view} href={switchTo[view]} data-view-link={view} aria-current={view === current ? 'page' : undefined}>{t(`page.view.${view}`)}</a>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
