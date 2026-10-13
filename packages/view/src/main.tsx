import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { readEmbeddedBundle } from './bundle';
import { App, ErrorBoundary, Message } from './App';
import { countError, reducedMotion } from './instrument';

// Bootstrap: decode the embedded bundle (in a Worker), publish what the page
// decoded on the root element's data-* attributes for the file:// smoke
// check, then render. data-excavator-view becomes "ready" only after the
// first view has committed; a decode or render failure never reaches it.

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  const dataset = rootElement.dataset;
  dataset.reducedMotion = String(reducedMotion());
  const started = performance.now();
  readEmbeddedBundle()
    .then((data) => {
      dataset.decodeMs = String(Math.round(performance.now() - started));
      if (!data) {
        dataset.excavatorView = 'empty';
        root.render(<Message title="No embedded data">This is the unbaked view template. Run /excavator-view to bake a page.</Message>);
        return;
      }
      dataset.decodeMode = data.decodeMode;
      dataset.nodes = String(data.counts.nodes);
      dataset.edges = String(data.counts.edges);
      dataset.evidence = String(data.counts.evidence);
      dataset.gaps = String(data.counts.gaps);
      dataset.segments = String(data.counts.segments);
      const header = data.meta.graph?.counts ?? {};
      dataset.headerNodes = String(header.nodes ?? '');
      dataset.headerEdges = String(header.edges ?? '');
      dataset.headerGaps = String(header.gaps ?? '');
      let failed = false;
      const onFirstView = () => {
        if (failed) return;
        dataset.readyMs = String(Math.round(performance.now()));
        dataset.excavatorView = 'ready';
      };
      root.render(
        <StrictMode>
          <ErrorBoundary
            onError={(error) => {
              failed = true;
              countError();
              dataset.excavatorView = 'error';
              dataset.error = `${error.name}: ${error.message}`;
            }}
          >
            <App data={data} onFirstView={onFirstView} />
          </ErrorBoundary>
        </StrictMode>,
      );
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      countError();
      dataset.excavatorView = 'error';
      dataset.error = message;
      root.render(<Message title="Could not read the embedded data">{message}</Message>);
    });
}
