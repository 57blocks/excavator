import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Scaffold only: read the embedded data placeholder and report its size on the
// root element. Decoding arrives with the bundle codec.
const DATA_ELEMENT_ID = 'excavator-view-data';

function App({ payloadChars }: { payloadChars: number }) {
  return <main>{payloadChars > 0 ? 'Excavator view data present.' : 'No embedded data.'}</main>;
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const payload = document.getElementById(DATA_ELEMENT_ID)?.textContent ?? '';
  rootElement.dataset.payloadChars = String(payload.trim().length);
  rootElement.dataset.excavatorView = payload.trim().length > 0 ? 'ready' : 'empty';
  createRoot(rootElement).render(
    <StrictMode>
      <App payloadChars={payload.trim().length} />
    </StrictMode>,
  );
}
