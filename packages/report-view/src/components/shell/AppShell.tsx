import { useState, type ReactNode } from 'react';

import type { Manifest } from '../../data/manifest';
import { Nav, type NavItem } from './Nav';
import { PanelHosts } from './Panel';
import { TopBar } from './TopBar';

/**
 * The layout of the page (openspec: changes/viewer-app, design D8): a 56 px top
 * bar, the 200 px navigation on the left, the main area, the 360 px sidebar on
 * the right and the drawer along the bottom of the main area. The sidebar and
 * the drawer are empty until a page opens a Panel into them.
 */
export function AppShell({ manifest, nav, current, children }: { manifest: Manifest; nav: readonly NavItem[]; current: string; children?: ReactNode }) {
  const [sidebar, setSidebar] = useState<HTMLElement | null>(null);
  const [drawer, setDrawer] = useState<HTMLElement | null>(null);
  return (
    <PanelHosts.Provider value={{ sidebar, drawer }}>
      <div className="flex h-dvh w-full flex-col overflow-hidden bg-paper">
        <TopBar manifest={manifest} />
        <div className="relative flex min-h-0 flex-1 max-sm:flex-col">
          <Nav items={nav} current={current} />
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <main id="xv-main" className="min-h-0 flex-1 overflow-auto p-6 max-sm:p-4">
              {children}
            </main>
            <div ref={setDrawer} className="absolute inset-x-0 bottom-0 z-20" />
          </div>
          <div ref={setSidebar} className="z-30 flex shrink-0 narrow:absolute narrow:inset-y-0 narrow:right-0" />
        </div>
      </div>
    </PanelHosts.Provider>
  );
}
