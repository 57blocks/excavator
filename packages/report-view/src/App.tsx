import { useEffect, useMemo } from 'react';
import { MotionConfig } from 'motion/react';

import { AppShell } from './components/shell/AppShell';
import { ErrorCard } from './components/ErrorCard';
import { PageBoundary } from './components/PageBoundary';
import type { Manifest } from './data/manifest';
import type { PayloadReader } from './data/payload';
import { useRoute } from './hooks/use-route';
import { PAGES } from './pages/registry';
import { ViewerProvider } from './state/viewer';

/** The page the route names inside the shell; a route no page has is an error card. */
export function App({ manifest, payloads }: { manifest: Manifest; payloads: PayloadReader }) {
  const { route } = useRoute();
  const page = PAGES.find((p) => p.id === route.page) ?? null;
  const nav = useMemo(() => PAGES.map((p) => ({ id: p.id, label: p.label, status: p.status(manifest) })), [manifest]);
  useEffect(() => {
    document.title = `${manifest.project.name} - Excavator view`;
  }, [manifest]);

  // A page is drawn afresh when the route moves to another page or report; a change of its own parameters it handles itself.
  const pageKey = `${route.page}/${route.rest}`;
  return (
    <MotionConfig reducedMotion="user">
      <ViewerProvider manifest={manifest} payloads={payloads}>
        <AppShell manifest={manifest} nav={nav} current={page?.id ?? ''}>
          <PageBoundary key={pageKey}>
            {page ? <page.Component /> : <ErrorCard title="No such page" error={new Error(`"${route.page}" is not a page of this viewer.`)} />}
          </PageBoundary>
        </AppShell>
      </ViewerProvider>
    </MotionConfig>
  );
}
