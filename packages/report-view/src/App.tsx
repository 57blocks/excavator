import { useEffect, useLayoutEffect, useMemo } from 'react';
import { MotionConfig } from 'motion/react';

import { AppShell } from './components/shell/AppShell';
import { ErrorCard } from './components/ErrorCard';
import { PageBoundary } from './components/PageBoundary';
import { PathDialog } from './components/shell/PathDialog';
import { ShortcutsDialog } from './components/shell/ShortcutsDialog';
import type { Manifest } from './data/manifest';
import type { PayloadReader } from './data/payload';
import { useShortcuts } from './hooks/use-shortcuts';
import { replaceHash, useRoute } from './hooks/use-route';
import { isBareHash, parseRoute, redirectHash } from './lib/route';
import { PAGES } from './pages/registry';
import { GraphUiProvider } from './state/graph-ui';
import { ViewerProvider } from './state/viewer';

/** The keys and the dialogs that every page has. */
function Shortcuts() {
  useShortcuts();
  return (
    <>
      <ShortcutsDialog />
      <PathDialog />
    </>
  );
}

/** The page the route names inside the shell; a route no page has is an error card. */
export function App({ manifest, payloads }: { manifest: Manifest; payloads: PayloadReader }) {
  const { route: addressRoute, hash } = useRoute();
  // A moved page's old address is replaced in place (so back does not land on it again); it draws the new page at once.
  const redirect = redirectHash(hash);
  const route = useMemo(() => (redirect === null ? addressRoute : parseRoute(redirect)), [redirect, addressRoute]);
  useLayoutEffect(() => {
    if (redirect !== null) replaceHash(redirect);
  }, [redirect]);
  // Opened without a route, the viewer shows the graph; with no knowledge graph to draw it shows the Products page.
  const graphStatus = manifest.products.find((p) => p.name === 'knowledge-graph')?.status;
  const bareFallsBack = isBareHash(hash) && graphStatus !== 'included' && graphStatus !== 'different-revision';
  const pageId = bareFallsBack ? 'products' : route.page;
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
        <GraphUiProvider>
          <Shortcuts />
          <AppShell manifest={manifest} nav={nav} current={page?.id ?? ''} flush={page?.flush}>
            <PageBoundary key={pageKey}>
              {page ? <page.Component /> : <ErrorCard title="No such page" error={new Error(`"${pageId}" is not a page of this viewer.`)} />}
            </PageBoundary>
          </AppShell>
        </GraphUiProvider>
      </ViewerProvider>
    </MotionConfig>
  );
}
