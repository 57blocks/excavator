import { OVERVIEW_HASH } from '../lib/route';
import { useText } from '../lib/text';
import { CloseIcon, MenuIcon } from './Icons';

interface Props {
  project: string;
  menuOpen: boolean;
  onMenu: () => void;
}

/** The bar above everything: the drawer button on narrow screens, and the handbook's title with the project's name. */
export function TopBar({ project, menuOpen, onMenu }: Props) {
  const t = useText();
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
      <a className="brand" href={OVERVIEW_HASH}>
        <span className="brand-title">{t('md.title')}</span>
        <span className="brand-project">{project}</span>
      </a>
    </header>
  );
}
