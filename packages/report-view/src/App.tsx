import { useEffect, useMemo } from 'react';
import { MotionConfig } from 'motion/react';

import { AppShell } from './components/shell/AppShell';
import { ErrorCard } from './components/ErrorCard';
import { PageBoundary } from './components/PageBoundary';
import type { Manifest } from './data/manifest';
import type { PayloadReader } from './data/payload';
import { useRoute } from './hooks/use-route';
import { isBareHash } from './lib/route';
import { PAGES } from './pages/registry';
import { ViewerProvider } from './state/viewer';

/** The page the route names inside the shell; a route no page has is an error card. */
export function App({ manifest, payloads }: { manifest: Manifest; payloads: PayloadReader }) {
  const { route, hash } = useRoute();
  // Opened without a route, the viewer shows the graph; with no knowledge graph to draw it shows the Overview.
  const graphStatus = manifest.products.find((p) => p.name === 'knowledge-graph')?.status;
  const bareFallsBack = isBareHash(hash) && graphStatus !== 'included' && graphStatus !== 'different-revision';
  const pageId = bareFallsBack ? 'overview' : route.page;
  const page = PAGES.find((p) => p.id === pageId) ?? null;
  const nav = useMemo(() => PAGES.map((p) => ({ id: p.id, label: p.label, status: p.status(manifest) })), [manifest]);
  useEffect(() => {
    document.title = `${manifest.project.name} - Excavator view`;
  }, [manifest]);

  // A page is drawn afresh when the route moves to another page or report; a change of its own parameters it handles itself.
  const pageKey = `${pageId}/${route.rest}`;
  return (
    <MotionConfig reducedMotion="user">
      <ViewerProvider manifest={manifest} payloads={payloads}>
        <AppShell manifest={manifest} nav={nav} current={page?.id ?? ''} flush={page?.flush}>
          <PageBoundary key={pageKey}>
            {page ? <page.Component /> : <ErrorCard title="No such page" error={new Error(`"${pageId}" is not a page of this viewer.`)} />}
          </PageBoundary>
        </AppShell>
      </ViewerProvider>
    </MotionConfig>
  );
}
