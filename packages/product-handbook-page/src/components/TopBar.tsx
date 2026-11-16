import { useLinks } from '../lib/links';
import { useText } from '../lib/text';
import type { View } from '../lib/types';
import { CloseIcon, MenuIcon, SearchIcon } from './Icons';

interface Props {
  /** The name of the system. */
  brand: string;
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

/** The bar above everything: the menu button (narrow windows only), the name of the system, the search button and, with two views, the view switch. The navigation is the left list's (the menu's on a phone). */
export function TopBar({ brand, menuOpen, onMenu, onSearch, views, current, switchTo }: Props) {
  const t = useText();
  const nav = useLinks();
  return (
    <header className="topbar">
      <button type="button" className="menu-btn" onClick={onMenu} aria-expanded={menuOpen} aria-controls="menu" aria-label={menuOpen ? t('page.nav.close') : t('page.nav.open')}>
        {menuOpen ? <CloseIcon /> : <MenuIcon />}
      </button>
      <a className="brand" href={nav.home}><b>{brand}</b></a>
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
