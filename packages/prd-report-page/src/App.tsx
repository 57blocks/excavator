import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { CoveragePage } from './components/CoveragePage';
import { FeaturePage } from './components/FeaturePage';
import { FindingsPage } from './components/FindingsPage';
import { NotFound } from './components/NotFound';
import { Overview } from './components/Overview';
import { Sidebar } from './components/Sidebar';
import { findingsByFeature } from './lib/counts';
import { parseHash } from './lib/route';
import type { Route } from './lib/route';
import type { PageData } from './lib/types';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** The route of the current fragment; follows the back button and shared links. */
function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => '');
  return useMemo(() => parseHash(hash), [hash]);
}

/** A key that changes when the page changes but not when only a filter does. */
const pageKey = (route: Route): string => (route.name === 'feature' ? `feature/${route.id}` : route.name === 'not-found' ? `not-found/${route.hash}` : route.name);

export function App({ data }: { data: PageData }) {
  const route = useRoute();
  const [menuOpen, setMenuOpen] = useState(false);
  const byFeature = useMemo(() => findingsByFeature(data.findings), [data.findings]);
  const counts = useMemo(() => new Map(data.features.map((feature) => [feature.id, byFeature.get(feature.id)?.length ?? 0])), [data.features, byFeature]);

  const key = pageKey(route);
  useEffect(() => {
    window.scrollTo(0, 0);
    setMenuOpen(false);
  }, [key]);
  useEffect(() => {
    const feature = route.name === 'feature' ? data.features.find((item) => item.id === route.id) : undefined;
    const section = { overview: 'Overview', findings: 'Findings', coverage: 'Coverage', 'not-found': 'Not found', feature: feature?.name ?? 'Not found' }[route.name];
    document.title = `${section} - ${data.project} - PRD report`;
  }, [route, data]);

  let view;
  switch (route.name) {
    case 'overview':
      view = <Overview data={data} byFeature={byFeature} />;
      break;
    case 'findings':
      view = <FindingsPage data={data} filters={route.filters} />;
      break;
    case 'coverage':
      view = <CoveragePage data={data} />;
      break;
    case 'feature': {
      const feature = data.features.find((item) => item.id === route.id);
      view = feature === undefined
        ? <NotFound what={`The report has no feature ${route.id}.`} />
        : <FeaturePage feature={feature} findings={byFeature.get(feature.id) ?? []} />;
      break;
    }
    case 'not-found':
      view = <NotFound what={`The address ${route.hash === '' ? '(empty)' : route.hash} is not a page of this report.`} />;
      break;
  }

  return (
    <div className="shell">
      <header className="topbar">
        <button type="button" aria-expanded={menuOpen} aria-controls="sidebar" onClick={() => setMenuOpen(!menuOpen)}>Menu</button>
        <span className="title">{data.project}</span>
      </header>
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
      <Sidebar data={data} route={route} findingCounts={counts} open={menuOpen} onNavigate={() => setMenuOpen(false)} />
      <main className="main" id="main">{view}</main>
    </div>
  );
}
