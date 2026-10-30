import { useEffect, useMemo, useState } from 'react';

import { CoveragePage } from './components/CoveragePage';
import { FeaturePage } from './components/FeaturePage';
import { NotFound } from './components/NotFound';
import { Overview } from './components/Overview';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import type { Route } from './lib/route';
import { TextContext, makeText } from './lib/text';
import type { PageData } from './lib/types';
import { useRoute } from './lib/use-route';

/** The page for a route: the shell (bar, navigation) around one view. Pure in its props, so a test can render any route to a string. */
export function AppView({ data, route }: { data: PageData; route: Route }) {
  const t = useMemo(() => makeText(data.ui.strings), [data.ui.strings]);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  let view;
  switch (route.name) {
    case 'overview':
      view = <Overview data={data} />;
      break;
    case 'coverage':
      view = <CoveragePage data={data} />;
      break;
    case 'feature': {
      const feature = data.features.find((item) => item.id === route.id);
      view = feature === undefined
        ? <NotFound />
        : <FeaturePage feature={feature} area={data.areas.find((item) => item.id === feature.area)} />;
      break;
    }
    case 'not-found':
      view = <NotFound />;
      break;
  }

  return (
    <TextContext.Provider value={t}>
      <div className="app">
        <TopBar project={data.project} menuOpen={menuOpen} onMenu={() => setMenuOpen(!menuOpen)} />
        <div className="shell">
          {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
          <Sidebar areas={data.areas} features={data.features} route={route} open={menuOpen} onNavigate={() => setMenuOpen(false)} />
          <main className="main" id="main">{view}</main>
        </div>
      </div>
    </TextContext.Provider>
  );
}

/** The document's own text: its language and its title come from the data, like everything else. */
function useDocument(data: PageData, route: Route): void {
  useEffect(() => {
    document.documentElement.lang = data.languageTag;
  }, [data.languageTag]);
  useEffect(() => {
    const t = makeText(data.ui.strings);
    const feature = route.name === 'feature' ? data.features.find((item) => item.id === route.id) : undefined;
    document.title = t('page.documentTitle', { project: data.project, page: feature?.name ?? t(route.name === 'coverage' ? 'page.nav.coverage' : route.name === 'overview' ? 'page.nav.overview' : 'page.notFound.heading') });
  }, [route, data]);
}

export function App({ data }: { data: PageData }) {
  const route = useRoute();
  useDocument(data, route);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);
  return <AppView data={data} route={route} />;
}
