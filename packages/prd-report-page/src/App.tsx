import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { CoveragePage } from './components/CoveragePage';
import { FeaturePage } from './components/FeaturePage';
import { FindingsPage } from './components/FindingsPage';
import { NotFound } from './components/NotFound';
import { Outline } from './components/Outline';
import { Overview } from './components/Overview';
import { QuickJump } from './components/QuickJump';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { findingsByFeature } from './lib/counts';
import { levelCountsByFeature } from './lib/matrix';
import { parseHash, scrollTarget } from './lib/route';
import type { Route } from './lib/route';
import { flashElement, holdInView, scrollToElement } from './lib/scroll';
import type { PageData } from './lib/types';
import { useMediaQuery } from './lib/use-media';

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

/** Whether a key press happens where the reader is typing, so a bare `/` must stay a character. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** The finding card with this id on the page, if it is one of the feature's findings. */
function findingCard(id: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-findings-list="feature"] [data-finding]')).find((element) => element.getAttribute('data-finding') === id) ?? null;
}

export function App({ data }: { data: PageData }) {
  const route = useRoute();
  const [menuOpen, setMenuOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [rescroll, setRescroll] = useState(0);
  const columnRef = useRef<HTMLDivElement>(null);
  const wide = useMediaQuery('(min-width: 1280px)');
  const byFeature = useMemo(() => findingsByFeature(data.findings), [data.findings]);
  const levels = useMemo(() => levelCountsByFeature(data.findings), [data.findings]);

  const key = pageKey(route);
  const target = scrollTarget(route, route.name === 'feature' ? byFeature.get(route.id) ?? [] : []);
  useEffect(() => {
    setMenuOpen(false);
    // A feature address with a finding of that feature scrolls to its card and marks it; any other page starts at the top.
    const card = target === '' ? null : findingCard(target);
    if (card !== null) {
      scrollToElement(card, false);
      card.focus({ preventScroll: true });
      flashElement(card);
      return holdInView(card, columnRef.current);
    }
    window.scrollTo(0, 0);
  }, [key, target, rescroll]);
  useEffect(() => {
    const feature = route.name === 'feature' ? data.features.find((item) => item.id === route.id) : undefined;
    const section = { overview: 'Overview', findings: 'Findings', coverage: 'Coverage', 'not-found': 'Not found', feature: feature?.name ?? 'Not found' }[route.name];
    document.title = `${section} - ${data.project} - PRD report`;
  }, [route, data]);

  // Quick jump: Ctrl/Cmd+K anywhere, `/` when the focus is not in a field; Esc closes the drawer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setJumpOpen(true);
      } else if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !isTypingTarget(event.target)) {
        event.preventDefault();
        setJumpOpen(true);
      } else if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const choose = useCallback((hash: string) => {
    setJumpOpen(false);
    if (window.location.hash === hash) setRescroll((value) => value + 1);
    else window.location.hash = hash;
  }, []);

  let view;
  let width = 'wide';
  switch (route.name) {
    case 'overview':
      view = <Overview data={data} />;
      break;
    case 'findings':
      view = <FindingsPage data={data} filters={route.filters} />;
      width = 'list';
      break;
    case 'coverage':
      view = <CoveragePage data={data} />;
      break;
    case 'feature': {
      const feature = data.features.find((item) => item.id === route.id);
      view = feature === undefined
        ? <NotFound what={`The report has no feature ${route.id}.`} />
        : <FeaturePage feature={feature} findings={byFeature.get(feature.id) ?? []} features={data.features} />;
      width = 'reading';
      break;
    }
    case 'not-found':
      view = <NotFound what={`The address ${route.hash === '' ? '(empty)' : route.hash} is not a page of this report.`} />;
      width = 'reading';
      break;
  }
  const showOutline = wide && (route.name === 'overview' || route.name === 'coverage' || (route.name === 'feature' && data.features.some((item) => item.id === route.id)));

  return (
    <div className="app">
      <button type="button" className="skip-link" onClick={() => document.getElementById('main')?.focus()}>Skip to content</button>
      <TopBar data={data} route={route} menuOpen={menuOpen} onMenu={() => setMenuOpen(!menuOpen)} onJump={() => setJumpOpen(true)} />
      <div className="body">
        {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
        <Sidebar features={data.features} route={route} levels={levels} open={menuOpen} onNavigate={() => setMenuOpen(false)} />
        <main className="main" id="main" tabIndex={-1}>
          <div className={`page-grid${showOutline ? ' has-outline' : ''}`}>
            <div className={`page-col page-${width}`} ref={columnRef}>
              {view}
              <div data-page-end className="page-end" aria-hidden="true" />
            </div>
            {showOutline && <Outline rootRef={columnRef} pageKey={key} />}
          </div>
        </main>
      </div>
      {jumpOpen && <QuickJump data={data} onClose={() => setJumpOpen(false)} onChoose={choose} />}
    </div>
  );
}
