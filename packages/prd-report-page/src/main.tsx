import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import { App } from './App';
import { loadData } from './lib/data';
import { initTheme } from './lib/theme';

const container = document.getElementById('root');
if (container === null) throw new Error('the page has no #root element');
initTheme();
const loaded = loadData();
createRoot(container).render(
  <StrictMode>
    {loaded.ok ? <App data={loaded.data} /> : (
      <div className="page" data-view="no-data">
        <h1>PRD report</h1>
        <p className="lede">{loaded.reason}</p>
      </div>
    )}
  </StrictMode>,
);
