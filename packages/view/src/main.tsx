import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { readEmbeddedBundle } from './bundle';
import { App, ErrorBoundary, Message } from './App';
import type { ViewData } from './data';
import { setDataMount } from './drop/host';
import { countError, watchReducedMotion } from './instrument';
import { DropZone } from './views/DropZone';

// Bootstrap: decode the embedded bundle (in a Worker), publish what the page
// decoded on the root element's data-* attributes for the file:// smoke
// check, then render. data-excavator-view becomes "ready" only after the
// first view has committed; a decode or render failure never reaches it.
// An unbaked template offers to open a local .excavator directory instead
// (task 9.2); a directory opened later is mounted the same way.

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  const dataset = rootElement.dataset;
  watchReducedMotion();
  const started = performance.now();
  let mounts = 0;

  const mount = (data: ViewData) => {
    mounts += 1;
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
    if (data.meta.origin?.mode === 'drop') {
      dataset.origin = 'drop';
      // A directory opened from #/open lands on the overview of its data.
      if (window.location.hash === '#/open') window.location.hash = '#/overview';
    } else delete dataset.origin;
    let failed = false;
    const onFirstView = () => {
      if (failed) return;
      dataset.readyMs = String(Math.round(performance.now()));
      dataset.excavatorView = 'ready';
    };
    root.render(
      <StrictMode>
        <ErrorBoundary
          key={mounts}
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
  };
  setDataMount(mount);

  readEmbeddedBundle()
    .then((data) => {
      dataset.decodeMs = String(Math.round(performance.now() - started));
      if (!data) {
        dataset.excavatorView = 'empty';
        root.render(
          <Message title="No embedded data">
            This is the unbaked view template. Run /excavator-view to bake a page, or open a local .excavator directory:
            <DropZone />
          </Message>,
        );
        return;
      }
      mount(data);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      countError();
      dataset.excavatorView = 'error';
      dataset.error = message;
      root.render(<Message title="Could not read the embedded data">{message}</Message>);
    });
}
