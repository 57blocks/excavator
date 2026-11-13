import { useEffect, useRef } from 'react';

import { useLinks, useView } from '../lib/links';
import { hrefOf, pageOf } from '../lib/pages';
import type { PageItem } from '../lib/pages';
import type { Route } from '../lib/route';
import { useText } from '../lib/text';
import type { PageData } from '../lib/types';
import { usePages } from '../lib/use-pages';

interface Props {
  data: PageData;
  route: Route;
  open: boolean;
  onNavigate: () => void;
}

/**
 * The navigation: one group per part of the outline, in its order, each with the title of its chapters as the links; the
 * coverage page last, in no part. All shown, none folding or numbered. A part with no page in this view is not shown. Below
 * 900px it is a drawer that the top bar's button opens.
 */
export function Sidebar({ data, route, open, onNavigate }: Props) {
  const t = useText();
  const nav = useLinks();
  const view = useView();
  const pages = usePages(data);
  const current = pageOf(pages, route);
  const scroller = useRef<HTMLDivElement>(null);
  const routeKey = JSON.stringify(route);
  // Keep the current link in view inside the rail's one scroll container.
  useEffect(() => {
    const here = scroller.current?.querySelector('[aria-current]');
    if (here instanceof HTMLElement && typeof here.scrollIntoView === 'function') here.scrollIntoView({ block: 'nearest' });
  }, [routeKey]);
  const link = (item: PageItem) => (
    <a className="rail-link" key={item.key} data-page={item.key} href={hrefOf(item, nav)} aria-current={item.key === current?.key ? 'page' : undefined}>{item.title}</a>
  );
  const groups = data.outline.parts.map((part, at) => ({ at, title: part.title, links: pages.filter((item) => item.part === at) })).filter((group) => group.links.length > 0);
  const coverage = pages.find((item) => item.part === null);
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
        {groups.map((group) => (
          <section className="rail-group" data-group={`part-${group.at}`} key={group.at} aria-labelledby={`rail-group-${group.at}`}>
            <h2 className="rail-group-name" id={`rail-group-${group.at}`}>{group.title}</h2>
            {group.links.map(link)}
          </section>
        ))}
        {coverage !== undefined && <section className="rail-group" data-group="coverage" aria-label={coverage.title}>{link(coverage)}</section>}
      </div>
    </nav>
  );
}
