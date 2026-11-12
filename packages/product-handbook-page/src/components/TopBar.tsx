import { useLinks } from '../lib/links';
import { systemName, useText } from '../lib/text';
import type { View } from '../lib/types';
import { CloseIcon, MenuIcon } from './Icons';

interface Props {
  /** The verified system name, or null. */
  project: string | null;
  menuOpen: boolean;
  onMenu: () => void;
  /** The views of the page and the view the reader is in; a page with one view has no switch. */
  views: View[];
  current: View;
  /** The fragment that shows the page the reader is on in each view. */
  switchTo: Record<View, string>;
}

/** The bar above everything: the drawer button on narrow screens, the handbook's title with the system's name (or the text that says the code has none), and, when the page has both views, the view switch. */
export function TopBar({ project, menuOpen, onMenu, views, current, switchTo }: Props) {
  const t = useText();
  const nav = useLinks();
  return (
    <header className="topbar">
      <button
        type="button"
        className="menu-btn"
        onClick={onMenu}
        aria-expanded={menuOpen}
        aria-controls="rail"
        aria-label={menuOpen ? t('page.nav.close') : t('page.nav.open')}
      >
        {menuOpen ? <CloseIcon /> : <MenuIcon />}
      </button>
      <a className="brand" href={nav.overview}>
        <span className="brand-title">{t('md.title')}</span>
        <span className="brand-project">{systemName(project, t)}</span>
      </a>
      {views.length > 1 && (
        <nav className="view-switch" aria-label={t('page.view.label')} data-part="view-switch">
          {views.map((view) => (
            <a key={view} className="view-switch-link" href={switchTo[view]} data-view-link={view} aria-current={view === current ? 'page' : undefined}>
              {t(`page.view.${view}`)}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}
