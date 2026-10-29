import { isApplePlatform } from '../lib/use-media';
import { shortRevision } from '../lib/filter';
import { findingsHash } from '../lib/route';
import type { Route } from '../lib/route';
import type { PageData } from '../lib/types';
import { MenuIcon, SearchIcon } from './Icons';
import { ThemeMenu } from './ThemeMenu';

interface Props {
  data: PageData;
  route: Route;
  menuOpen: boolean;
  onMenu: () => void;
  onJump: () => void;
}

/**
 * The sticky top bar (design D1): the project, the three pages as a segmented
 * switch, the quick-jump button, the source revision and the theme switch. The
 * Menu button shows below 1024px, where the feature rail is a drawer.
 */
export function TopBar({ data, route, menuOpen, onMenu, onJump }: Props) {
  const pages = [
    { name: 'overview', href: '#/', label: 'Overview', count: null },
    { name: 'findings', href: findingsHash(), label: 'Findings', count: data.findings.length },
    { name: 'coverage', href: '#/coverage', label: 'Coverage', count: null },
  ] as const;
  return (
    <header className="topbar">
      <button type="button" className="icon-btn menu-btn" aria-label="Features" aria-expanded={menuOpen} aria-controls="rail" onClick={onMenu}>
        <MenuIcon /><span className="menu-label">Menu</span>
      </button>
      <a className="brand" href="#/" title={data.project}>
        <span className="brand-name">{data.project}</span>
        <span className="brand-sub">PRD report</span>
      </a>
      <nav className="seg page-switch" aria-label="Pages">
        {pages.map((page) => (
          <a key={page.name} href={page.href} aria-current={route.name === page.name ? 'page' : undefined} data-page-link={page.name}>
            {page.label}{page.count !== null && <span className="seg-count">{page.count}</span>}
          </a>
        ))}
      </nav>
      <span className="spacer" />
      <button type="button" className="jump-btn" onClick={onJump} aria-label="Quick jump" aria-keyshortcuts="Control+K Meta+K /" data-jump-open>
        <SearchIcon />
        <span className="jump-text">Jump to feature or finding</span>
        <kbd>{isApplePlatform() ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <code className="version" title={data.sourceRevision}>{shortRevision(data.sourceRevision)}</code>
      <ThemeMenu />
    </header>
  );
}
