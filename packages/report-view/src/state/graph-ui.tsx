import { createContext, useContext, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';

import { NO_FILTERS, type GraphFilters } from '../lib/graph-filters';

/** The one dialog, menu or result list that is open; Esc closes it before anything else. */
export type Overlay = 'search' | 'filters' | 'path' | 'shortcuts' | null;

export type DrawerState = 'closed' | 'open' | 'full';

interface GraphUi {
  overlay: Overlay;
  setOverlay: (overlay: Overlay) => void;
  filters: GraphFilters;
  setFilters: (update: (filters: GraphFilters) => GraphFilters) => void;
  drawer: DrawerState;
  setDrawer: (drawer: DrawerState) => void;
  /** The search box, so `/` can focus it. */
  searchInput: MutableRefObject<HTMLInputElement | null>;
  /** Set by the graph page while it is shown: closes the next thing Esc closes, and says whether it closed one. */
  escape: MutableRefObject<(() => boolean) | null>;
}

const GraphUiContext = createContext<GraphUi | null>(null);

/** The state that the top bar, the graph page and the shortcuts share: the open overlay, the filters and the code drawer. */
export function GraphUiProvider({ children }: { children: ReactNode }) {
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [filters, setFiltersState] = useState<GraphFilters>(NO_FILTERS);
  const [drawer, setDrawer] = useState<DrawerState>('closed');
  const searchInput = useRef<HTMLInputElement | null>(null);
  const escape = useRef<(() => boolean) | null>(null);
  const value = useMemo<GraphUi>(
    () => ({ overlay, setOverlay, filters, setFilters: (update) => setFiltersState(update), drawer, setDrawer, searchInput, escape }),
    [overlay, filters, drawer],
  );
  return <GraphUiContext.Provider value={value}>{children}</GraphUiContext.Provider>;
}

export function useGraphUi(): GraphUi {
  const ui = useContext(GraphUiContext);
  if (!ui) throw new Error('useGraphUi was used outside a GraphUiProvider');
  return ui;
}
