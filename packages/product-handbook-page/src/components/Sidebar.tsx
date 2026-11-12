import { Fragment, useEffect, useRef } from 'react';

import { chapterKey, chapterList } from '../lib/chapters';
import type { Chapter } from '../lib/chapters';
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
 * The navigation (openspec change handbook-deep-entry, design D11; handbook-outline, D6): two levels, a part title and its
 * links, all shown, none folding or numbered, in the order of `chapterList`, which follows the outline (a list chapter
 * whose title is not its part's has a label of its own; the coverage page is last, in no part). No feature is listed: a feature is reached from its
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
  const link = (chapter: Chapter) => {
    const current = chapter.key === currentKey ? 'page' : currentDomain !== undefined && chapter.key === `domain:${currentDomain}` ? 'true' : undefined;
    return <a className="rail-link" key={chapter.key} {...chapter.data} href={chapter.href} aria-current={current}>{chapter.label}</a>;
  };
  // One group per part of the outline, its links in the order of the chapters; a list chapter whose title is not the part's has its own label.
  const parts = data.outline.parts.map((part, at) => ({ at, title: part.title, links: chapters.filter((chapter) => chapter.part === at) })).filter((part) => part.links.length > 0);
  const coverage = chapters.find((chapter) => chapter.part === null);
  const group = (part: { at: number; title: string; links: Chapter[] }) => (
    <section className="rail-group" data-group={`part-${part.at}`} key={part.at} aria-labelledby={`rail-group-${part.at}`}>
      <h2 className="rail-group-name" id={`rail-group-${part.at}`}>{part.title}</h2>
      {part.links.map((chapter, at) => (
        <Fragment key={chapter.key}>
          {chapter.list && chapter.chapterTitle !== part.title && part.links[at - 1]?.chapterTitle !== chapter.chapterTitle && <h3 className="rail-subgroup-name">{chapter.chapterTitle}</h3>}
          {link(chapter)}
        </Fragment>
      ))}
    </section>
  );
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
        {parts.map(group)}
        {coverage !== undefined && <section className="rail-group" data-group="coverage" aria-label={coverage.label}>{link(coverage)}</section>}
      </div>
    </nav>
  );
}
