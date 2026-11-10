import { useEffect, useRef } from 'react';

import { chapterKey, chapterList } from '../lib/chapters';
import type { ChapterGroup } from '../lib/chapters';
import type { PageData } from '../lib/types';
import { useLinks, useView } from '../lib/links';
import type { Route } from '../lib/route';
import { useText } from '../lib/text';
import { bodyOf } from '../lib/views';

interface Props {
  data: PageData;
  route: Route;
  open: boolean;
  onNavigate: () => void;
}

/**
 * The navigation (openspec change handbook-deep-entry, design D11): two levels, a group name and its links, all shown,
 * none folding or numbered, in the order of `chapterList` (the business domains are named areas when the map has no
 * domains file). No feature is listed: a feature is reached from its
 * domain's page, and on a feature page the link of its domain is marked as the current place. Below 900px it is a
 * drawer that the top bar's button opens.
 */
export function Sidebar({ data, route, open, onNavigate }: Props) {
  const t = useText();
  const nav = useLinks();
  const view = useView();
  const routeKey = JSON.stringify(route);
  const scroller = useRef<HTMLDivElement>(null);
  // Keep the current link in view inside the rail's one scroll container.
  useEffect(() => {
    const current = scroller.current?.querySelector('[aria-current]');
    if (current instanceof HTMLElement && typeof current.scrollIntoView === 'function') current.scrollIntoView({ block: 'nearest' });
  }, [routeKey]);
  const currentKey = chapterKey(bodyOf(route));
  const currentDomain = route.name === 'feature' ? data.features.find((feature) => feature.id === route.id)?.domain : undefined;
  const chapters = chapterList(data, view, nav, t);
  const group = (name: ChapterGroup, label = t(`page.nav.group.${name}`)) => {
    const links = chapters.filter((chapter) => chapter.group === name);
    if (links.length === 0) return null;
    return (
      <section className="rail-group" data-group={name} aria-labelledby={`rail-group-${name}`}>
        <h2 className="rail-group-name" id={`rail-group-${name}`}>{label}</h2>
        {links.map((chapter) => {
          const current = chapter.key === currentKey ? 'page' : currentDomain !== undefined && chapter.key === `domain:${currentDomain}` ? 'true' : undefined;
          return <a className="rail-link" key={chapter.key} {...chapter.data} href={chapter.href} aria-current={current}>{chapter.label}</a>;
        })}
      </section>
    );
  };
  return (
    <nav
      className="rail"
      id="rail"
      aria-label={t('page.nav.label')}
      data-open={open}
      data-view-nav={view}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('a')) onNavigate();
      }}
    >
      <div className="rail-scroll" ref={scroller}>
        {group('system')}
        {group('applications')}
        {group('domains', t(data.domainBasis === 'areas' ? 'page.nav.group.areas' : 'page.nav.group.domains'))}
        {group('systems')}
        {group('topics')}
        {group('health')}
        {group('appendix')}
      </div>
    </nav>
  );
}
