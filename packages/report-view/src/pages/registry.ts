import type { ComponentType } from 'react';

import { findProduct, type Manifest } from '../data/manifest';
import { codeStatus } from '../lib/code';
import { worstStatus } from '../lib/products';
import { CodePage } from './Code';
import { DocMapPage } from './DocMap';
import { HotspotsPage } from './Hotspots';
import { OverviewPage } from './Overview';
import { ReportsPage } from './Reports';
import { UnusedPage } from './Unused';

export interface PageDef {
  id: string;
  label: string;
  /** The state the navigation shows for this page. */
  status: (manifest: Manifest) => string;
  Component: ComponentType;
}

const productStatus = (name: string) => (manifest: Manifest) => findProduct(manifest, name)?.status ?? 'not-run';

/** The pages, in navigation order. */
export const PAGES: readonly PageDef[] = [
  { id: 'overview', label: 'Overview', status: (m) => worstStatus(m.products), Component: OverviewPage },
  { id: 'unused', label: 'Unused code', status: productStatus('unused-code'), Component: UnusedPage },
  { id: 'doc-map', label: 'Doc map', status: productStatus('doc-map'), Component: DocMapPage },
  { id: 'hotspots', label: 'Hotspots', status: productStatus('hotspots'), Component: HotspotsPage },
  { id: 'code', label: 'Code', status: (m) => codeStatus(m.source.counts), Component: CodePage },
  { id: 'reports', label: 'Reports', status: productStatus('reports'), Component: ReportsPage },
];
