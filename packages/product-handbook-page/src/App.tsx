import { useEffect, useMemo, useState } from 'react';

import { ChapterPage, CoveragePage } from './components/ChapterPage';
import { DataPage } from './components/DataPage';
import { DictionariesPage } from './components/DictionariesPage';
import { DomainPage } from './components/DomainPage';
import { HistoryPage } from './components/HistoryPage';
import { HomePage } from './components/HomePage';
import { Menu } from './components/Menu';
import { NotFound } from './components/NotFound';
import { Reading } from './components/Reading';
import { TopBar } from './components/TopBar';
import { LoaderContext, createLoader } from './lib/chunks';
import { groupOfFeature, groupsOf, referencesOf } from './lib/groups';
import { LinksContext, ViewContext, makeLinks } from './lib/links';
import { contextOf, switchTarget, viewOf } from './lib/navigation';
import { bodyOf, pageOf, pagesOf } from './lib/pages';
import type { PageItem } from './lib/pages';
import type { Route } from './lib/route';
import { domainColours } from './lib/strata';
import { TextContext, makeText } from './lib/text';
import type { PageData, View } from './lib/types';
import { useRoute } from './lib/use-route';

/** The pages that hold wide tables: they use the full width and have no table of contents. */
const WIDE = new Set<PageItem['kind']>(['data', 'dictionaries', 'history']);

/** The content of one page of the list, in `view`: the not-found page when its data is not there. */
function PageContent({ data, item, view }: { data: PageData; item: PageItem; view: View }) {
  const technical = view === 'technical' ? data.technical : undefined;
  switch (item.kind) {
    case 'chapter': {
      const chapter = data.chapters.find((candidate) => candidate.id === item.block);
      return chapter === undefined ? <NotFound /> : <ChapterPage chapter={chapter} />;
    }
    case 'data': return technical === undefined ? <NotFound /> : <DataPage technical={technical} />;
    case 'dictionaries': return technical === undefined ? <NotFound /> : <DictionariesPage technical={technical} />;
    case 'history': return <HistoryPage data={data} technical={technical} />;
    case 'coverage': return <CoveragePage data={data} />;
  }
}

/** The first line of the brand: the title of the system chapter when the outline has one, else the title of the view. */
function brandOf(data: PageData, view: View): string {
  for (const part of data.outline.parts) {
    for (const block of part.blocks) if (block.block === 'system' && block.kind === 'chapter') return block.title;
  }
  return data.titles[view] ?? '';
}

/** The page for a route: the shell (bar, menu) around one view. Pure in its props, so a test can render any route to a string. */
export function AppView({ data, route, onSearch = () => undefined }: { data: PageData; route: Route; onSearch?: () => void }) {
  const t = useMemo(() => makeText(data.ui.strings), [data.ui.strings]);
  const [menuOpen, setMenuOpen] = useState(false);
  const coverageTitle = t('page.nav.coverage');
  const view = viewOf(data, route, coverageTitle);
  const current: View = view ?? data.views[0];
  const links = useMemo(() => makeLinks(data.views.length > 1 ? current : null), [data.views.length, current]);
  const groups = useMemo(() => groupsOf(data), [data]);
  const colours = useMemo(() => domainColours(groups.map((group) => group.id)), [groups]);
  const references = useMemo(() => referencesOf(data, current, coverageTitle), [data, current, coverageTitle]);
  const switchTo = Object.fromEntries(data.views.map((item) => [item, switchTarget(data, route, item, coverageTitle)])) as Record<View, string>;
  const body = bodyOf(route);
  const routeText = JSON.stringify(route);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { setMenuOpen(false); }, [routeText]);

  let main = <NotFound />;
  if (view !== null) {
    if (body.name === 'home') {
      main = <HomePage title={brandOf(data, view)} groups={groups} colours={colours} />;
    } else if (body.name === 'domain') {
      const group = groups.find((candidate) => candidate.id === body.id);
      if (group !== undefined) main = <DomainPage group={group} colour={colours[group.id]} mapLabel={t('page.nav.map')} />;
    } else {
      const item = pageOf(pagesOf(data, view, coverageTitle), route);
      if (item !== undefined) {
        const context = contextOf(data, view, coverageTitle, item.key);
        const group = context.kind === 'group' ? context.group : undefined;
        const trail = [
          { label: t('page.nav.map'), href: links.home },
          group === undefined ? { label: t('page.nav.references') } : { label: group.name, href: links.domain(group.id) },
          { label: item.title },
        ];
        main = (
          <Reading item={item} context={context} colour={group === undefined ? null : colours[group.id]} trail={trail} wide={WIDE.has(item.kind)}>
            <PageContent data={data} item={item} view={view} />
          </Reading>
        );
      }
    }
  }

  return (
    <TextContext.Provider value={t}>
      <ViewContext.Provider value={current}>
        <LinksContext.Provider value={links}>
          <div className="app">
            <a className="skip" href="#main" onClick={(event) => { event.preventDefault(); const target = document.getElementById('main'); target?.focus(); target?.scrollIntoView(); }}>{t('page.skip')}</a>
            <TopBar
              brand={brandOf(data, current)}
              viewTitle={data.titles[current] ?? ''}
              groups={groups}
              colours={colours}
              references={references}
              home={view !== null && body.name === 'home'}
              menuOpen={menuOpen}
              onMenu={() => setMenuOpen(!menuOpen)}
              onSearch={onSearch}
              views={data.views}
              current={current}
              switchTo={switchTo}
            />
            {menuOpen && <Menu groups={groups} colours={colours} references={references} home={view !== null && body.name === 'home'} onNavigate={() => setMenuOpen(false)} />}
            <main id="main" tabIndex={-1}>{main}</main>
          </div>
        </LinksContext.Provider>
      </ViewContext.Provider>
    </TextContext.Provider>
  );
}

/** The browser title of a route: the page's title and the view's title; home is titled by the system chapter; the not-found heading when the route has no page. */
export function documentTitle(data: PageData, route: Route): string {
  const t = makeText(data.ui.strings);
  const coverageTitle = t('page.nav.coverage');
  const view = viewOf(data, route, coverageTitle);
  if (view === null) return t('page.notFound.heading');
  const body = bodyOf(route);
  let page: string;
  if (body.name === 'home') page = brandOf(data, view);
  else if (body.name === 'domain') page = groupsOf(data).find((group) => group.id === body.id)?.name ?? t('page.notFound.heading');
  else page = pageOf(pagesOf(data, view, coverageTitle), route)?.title ?? t('page.notFound.heading');
  const title = data.titles[view];
  return title === undefined || title === '' || title === page ? page : `${page} - ${title}`;
}

/** The document's own text: its language and its title come from the data, like everything else. */
function useDocument(data: PageData, route: Route): void {
  useEffect(() => {
    document.documentElement.lang = data.languageTag;
  }, [data.languageTag]);
  useEffect(() => {
    document.title = documentTitle(data, route);
  }, [route, data]);
}

export function App({ data }: { data: PageData }) {
  const route = useRoute();
  useDocument(data, route);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);
  const loader = useMemo(() => createLoader(data.chunks), [data.chunks]);
  return <LoaderContext.Provider value={loader}><AppView data={data} route={route} /></LoaderContext.Provider>;
}
