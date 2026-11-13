import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChapterPage, CoveragePage } from './components/ChapterPage';
import { DataPage } from './components/DataPage';
import { DictionariesPage } from './components/DictionariesPage';
import { DomainPage } from './components/DomainPage';
import { HistoryPage } from './components/HistoryPage';
import { systemSections } from './components/Architecture';
import { HomePage } from './components/HomePage';
import { Menu } from './components/Menu';
import { NotFound } from './components/NotFound';
import { Reading } from './components/Reading';
import { SearchDialog } from './components/SearchDialog';
import { TopBar } from './components/TopBar';
import { LoaderContext, createLoader } from './lib/chunks';
import { groupOfFeature, groupsOf, referencesOf } from './lib/groups';
import { LinksContext, ViewContext, makeLinks } from './lib/links';
import { ModelContext, buildModel } from './lib/model';
import { contextOf, switchTarget, viewOf } from './lib/navigation';
import { bodyOf, pageOf, pagesOf } from './lib/pages';
import type { PageItem } from './lib/pages';
import type { Route } from './lib/route';
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

/** Whether a key press comes from a place the reader types in, where `/` is a character and not a shortcut. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable || (target.getAttribute('contenteditable') ?? 'false') !== 'false';
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
  const model = useMemo(() => buildModel(data, groups), [data, groups]);
  const colours = model.colours;
  const references = useMemo(() => referencesOf(data, current, coverageTitle), [data, current, coverageTitle]);
  const switchTo = Object.fromEntries(data.views.map((item) => [item, switchTarget(data, route, item, coverageTitle)])) as Record<View, string>;
  const body = bodyOf(route);
  const routeText = JSON.stringify(route);

  const [searchOpen, setSearchOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const isOpen = useRef(false);
  const openSearch = useCallback(() => {
    if (isOpen.current) return;
    isOpen.current = true;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSearchOpen(true);
  }, []);
  const closeSearch = useCallback((restore: boolean) => {
    isOpen.current = false;
    setSearchOpen(false);
    if (restore) opener.current?.focus();
    opener.current = null;
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
      else if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openSearch();
      } else if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !isTyping(event.target)) {
        event.preventDefault();
        openSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSearch]);
  useEffect(() => { setMenuOpen(false); }, [routeText]);

  let main = <NotFound />;
  if (view !== null) {
    if (body.name === 'home') {
      main = <HomePage title={brandOf(data, view)} lead={data.lead} groups={groups} references={references} architecture={view === 'technical' ? data.architecture.technical ?? '' : ''} sections={systemSections(data.search)} />;
    } else if (body.name === 'domain') {
      const group = groups.find((candidate) => candidate.id === body.id);
      if (group !== undefined) {
        const at = groups.indexOf(group);
        main = <DomainPage group={group} colour={colours[group.id]} mapLabel={t('page.nav.map')} previous={groups[at - 1]} next={groups[at + 1]} />;
      }
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
          <ModelContext.Provider value={model}>
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
              onSearch={() => { openSearch(); onSearch(); }}
              views={data.views}
              current={current}
              switchTo={switchTo}
            />
            {menuOpen && <Menu groups={groups} colours={colours} references={references} home={view !== null && body.name === 'home'} onNavigate={() => setMenuOpen(false)} />}
            <main id="main" tabIndex={-1}>{main}</main>
            {searchOpen && <SearchDialog groups={groups} colours={colours} items={data.search} references={references} onClose={() => closeSearch(true)} onDone={() => closeSearch(false)} />}
          </div>
          </ModelContext.Provider>
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
