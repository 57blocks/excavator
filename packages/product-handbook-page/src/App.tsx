import { useEffect, useMemo, useState } from 'react';

import { ChapterNav } from './components/ChapterNav';
import { ChapterPage, CoveragePage } from './components/ChapterPage';
import { DataPage } from './components/DataPage';
import { DictionariesPage } from './components/DictionariesPage';
import { HistoryPage } from './components/HistoryPage';
import { NotFound } from './components/NotFound';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { LoaderContext, createLoader } from './lib/chunks';
import { LinksContext, ViewContext, makeLinks } from './lib/links';
import { bodyOf, pageOf, pagesOf, switchTarget, viewOf } from './lib/pages';
import type { Route } from './lib/route';
import { TextContext, makeText } from './lib/text';
import type { PageData, View } from './lib/types';
import { useRoute } from './lib/use-route';

/** The page a route shows in `view`: the not-found page when the view or the page is not in the data. */
function PageView({ data, route, view, coverageTitle }: { data: PageData; route: Route; view: View | null; coverageTitle: string }) {
  if (view === null) return <NotFound />;
  const item = pageOf(pagesOf(data, view, coverageTitle), route);
  if (item === undefined) return <NotFound />;
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

/** The page for a route: the shell (bar, navigation) around one view. Pure in its props, so a test can render any route to a string. */
export function AppView({ data, route }: { data: PageData; route: Route }) {
  const t = useMemo(() => makeText(data.ui.strings), [data.ui.strings]);
  const [menuOpen, setMenuOpen] = useState(false);
  const coverageTitle = t('page.nav.coverage');
  const view = viewOf(data, route, coverageTitle);
  const current: View = view ?? data.views[0];
  const links = useMemo(() => makeLinks(data.views.length > 1 ? current : null), [data.views.length, current]);
  const switchTo = Object.fromEntries(data.views.map((item) => [item, switchTarget(data, route, item, coverageTitle)])) as Record<View, string>;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <TextContext.Provider value={t}>
      <ViewContext.Provider value={current}>
        <LinksContext.Provider value={links}>
          <div className="app">
            <TopBar title={data.titles[current] ?? ''} menuOpen={menuOpen} onMenu={() => setMenuOpen(!menuOpen)} views={data.views} current={current} switchTo={switchTo} />
            <div className="shell">
              {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
              <Sidebar data={data} route={route} open={menuOpen} onNavigate={() => setMenuOpen(false)} />
              <main className="main" id="main"><PageView data={data} route={route} view={view} coverageTitle={coverageTitle} />{view !== null && <ChapterNav data={data} route={route} />}</main>
            </div>
          </div>
        </LinksContext.Provider>
      </ViewContext.Provider>
    </TextContext.Provider>
  );
}

/** The browser title of a route: the page's title and the view's title; the not-found heading when the route has no page. */
export function documentTitle(data: PageData, route: Route): string {
  const t = makeText(data.ui.strings);
  const coverageTitle = t('page.nav.coverage');
  const view = viewOf(data, route, coverageTitle);
  if (view === null) return t('page.notFound.heading');
  const item = pageOf(pagesOf(data, view, coverageTitle), route);
  const page = item?.title ?? t('page.notFound.heading');
  const title = data.titles[view];
  return title === undefined || title === '' ? page : `${page} - ${title}`;
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
