import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { readEmbeddedBundle, type BundleCounts } from './bundle';

// Minimal page: decode the embedded bundle and publish its counts on the root
// element as data-* attributes (read by the file:// smoke check). The real
// sections are built on top of this.

function App({ counts, error }: { counts: BundleCounts | null; error: string | null }) {
  if (error) return <main role="alert">Could not read the embedded data: {error}</main>;
  if (!counts) return <main>No embedded data.</main>;
  return (
    <main>
      Excavator view: {counts.nodes} nodes, {counts.edges} edges, {counts.gaps} gaps.
    </main>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  const started = performance.now();
  readEmbeddedBundle()
    .then((counts) => {
      rootElement.dataset.decodeMs = String(Math.round(performance.now() - started));
      if (counts) {
        rootElement.dataset.nodes = String(counts.nodes);
        rootElement.dataset.edges = String(counts.edges);
        rootElement.dataset.evidence = String(counts.evidence);
        rootElement.dataset.gaps = String(counts.gaps);
        rootElement.dataset.segments = String(counts.segments);
      }
      rootElement.dataset.excavatorView = counts ? 'ready' : 'empty';
      root.render(
        <StrictMode>
          <App counts={counts} error={null} />
        </StrictMode>,
      );
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      rootElement.dataset.excavatorView = 'error';
      rootElement.dataset.error = message;
      root.render(
        <StrictMode>
          <App counts={null} error={message} />
        </StrictMode>,
      );
    });
}
