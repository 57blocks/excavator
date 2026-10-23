import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import 'virtual:xv-fonts.css';
import './index.css';
import { App } from './App';
import { ErrorCard } from './components/ErrorCard';
import { PayloadReader } from './data/payload';
import { readManifest } from './data/manifest';

const container = document.getElementById('xv-app');
if (!container) throw new Error('the page has no #xv-app element');

let content;
try {
  content = <App manifest={readManifest(document)} payloads={new PayloadReader(document)} />;
} catch (error) {
  content = <ErrorCard title="This page could not be read" error={error} />;
}
createRoot(container).render(<StrictMode>{content}</StrictMode>);
